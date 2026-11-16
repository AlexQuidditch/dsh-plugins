/**
 * Model-facing peak awareness: one dynamic system-prompt context section and
 * the `peak_hours_status` tool — no cordis imports.
 *
 * The prompt section is short on purpose (it is re-assembled into every turn
 * and may be re-materialised when a request is admitted): current peak state
 * for the Session's own model, whether peak work is allowed or the Session is
 * paused, the remaining daily budget, and one instruction telling the model to
 * check `peak_hours_status` before a long expensive task and to move expensive
 * work off-peak when it can. When the plugin is disabled the section
 * contributes nothing (`''`), so no token is spent on it.
 *
 * The tool returns the same facts as plain JSON for the model. It is a global
 * tool: the Agent that dispatched the call is discovered from the execution
 * context (`exec.agent`), so nothing is registered per session and a call
 * outside an Agent still answers with the aggregate view.
 *
 * Every read here is best-effort and guarded: a provider without a live Agent,
 * a missing `tools` registry or a teardown race must degrade to a shorter
 * answer, never to a broken prompt or a failed turn.
 */
import { allowFor } from './config.js'
import { ancestorsOf } from './session-tree.js'
import { overviewFor, scheduleKeys } from './schedule.js'

/** The model-facing tool name; the prompt instruction references it. */
export const TOOL_NAME = 'peak_hours_status'

/** Prompt-context section registration. */
const PROMPT_NAME = 'peak-hours'
const PROMPT_ORDER = 150

/** Dynamic runtime context is a budget: keep the section well under it. */
const MAX_TEXT_CHARS = 500

const TOOL_DESCRIPTION = 'Показать текущие пиковые часы, модель сессии, паузу и остаток дневного бюджета. '
  + 'Вызови перед долгой дорогой работой.'

const INSTRUCTION = 'Если задача может занять много токенов, проверь peak_hours_status и при необходимости '
  + 'отложи дорогую работу на непиковые часы; пауза включается автоматически, '
  + 'если пиковые часы запрещены.'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** ISO string for a valid Date or date-like string, else null. */
function toIso(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value !== '') {
    const ms = Date.parse(value)
    if (Number.isFinite(ms)) return new Date(ms).toISOString()
  }
  return null
}

/** `HH:MM UTC` for an instant. */
function hhmmUtc(date) {
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes} UTC`
}

/** Short Russian duration label for a countdown. */
function formatDuration(ms) {
  const minutes = Math.max(0, Math.round(Number(ms) / 60_000))
  if (minutes < 1) return 'меньше минуты'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} мин`
  if (rest === 0) return `${hours} ч`
  return `${hours} ч ${rest} мин`
}

function clip(text, limit) {
  return text.length <= limit ? text : text.slice(0, limit)
}

/** Snapshot-safe deferral count of one Session, when the pause module can read it. */
function pauseState(pause, sessionId) {
  const idle = { paused: false, pausedUntil: null, kind: null }
  if (pause === undefined || pause === null) return idle
  try {
    let view
    if (typeof pause.sessionView === 'function') view = pause.sessionView(sessionId)
    else if (typeof pause.pausedFor === 'function') view = pause.pausedFor(sessionId)
    else if (typeof pause.stateFor === 'function') view = pause.stateFor(sessionId)
    else if (typeof pause.get === 'function') view = pause.get(sessionId)
    if (view === undefined || view === null) {
      const map = typeof pause.pausedMap === 'function'
        ? pause.pausedMap()
        : (typeof pause.pausedSessions === 'function' ? pause.pausedSessions() : null)
      if (map !== null && typeof map === 'object') view = map[sessionId]
    }
    return normalizePauseView(view)
  } catch {
    return idle
  }
}

/** Accept `true`, `{paused, pauseKind, since, until}`, `{kind, until}` or a map entry. */
function normalizePauseView(view) {
  if (view === true) return { paused: true, pausedUntil: null, kind: null }
  if (view === null || view === undefined || typeof view !== 'object') {
    return { paused: false, pausedUntil: null, kind: null }
  }
  // A Promise is not a synchronous state read; do not keep it around.
  if (typeof view.then === 'function') {
    try {
      view.catch?.(() => {})
    } catch {
      // ignore
    }
    return { paused: false, pausedUntil: null, kind: null }
  }
  const kind = isNonEmptyString(view.pauseKind)
    ? view.pauseKind
    : (isNonEmptyString(view.kind) && view.kind !== 'none' ? view.kind : null)
  return {
    paused: view.paused === true || kind !== null,
    pausedUntil: toIso(view.until ?? view.pausedUntil ?? view.releaseAt),
    kind,
  }
}

/**
 * Create the prompt-context section and the `peak_hours_status` tool.
 *
 * @param {object} options
 * @param {object} options.ctx - plugin root context (services read via `get`).
 * @param {() => object} options.getResolved - effective plugin configuration.
 * @param {object} options.store - state store (`limitSecondsToday`, `sessionAllow`).
 * @param {object} [options.pause] - pause controller (`sessionView(sessionId)`).
 * @param {object} [options.stats] - savings counters (unused read paths guarded).
 * @param {{ warn: Function }} options.logger - cordis logger.
 * @param {() => Date} [options.now] - clock injection for tests.
 */
export function createPromptContext({ ctx, getResolved, store, pause, stats, logger, now = () => new Date() }) {
  const disposers = new Set()
  let started = false
  let disposed = false
  let registeredPrompt = false
  let registeredTool = false

  function warn(message, ...args) {
    try {
      logger?.warn?.(message, ...args)
    } catch {
      // a logger must never break the plugin
    }
  }

  function getService(name) {
    try {
      return ctx?.get?.(name)
    } catch {
      return undefined
    }
  }

  /** Effective configuration; a broken config resolves to the empty object. */
  function currentResolved() {
    if (typeof getResolved !== 'function') return {}
    const resolved = getResolved()
    return resolved !== null && typeof resolved === 'object' ? resolved : {}
  }

  /** The live Agent driving one AssembleContext scope, best effort. */
  function agentForScope(scope) {
    if (scope === undefined || scope === null) return undefined
    const agents = getService('agents')
    try {
      const list = agents?.list?.()
      if (Array.isArray(list)) {
        for (const agent of list) {
          if (agent === null || typeof agent !== 'object') continue
          const keys = [agent.scope?.key, agent.scopeKey, agent.ctx?.scope?.key]
          for (const key of keys) {
            if (key !== undefined && key === scope) return agent
          }
        }
      }
    } catch {
      // fall through to the id lookup
    }
    if (typeof scope === 'string' || typeof scope === 'number') {
      try {
        const byId = agents?.get?.(String(scope))
        if (byId !== undefined && byId !== null) return byId
      } catch {
        // unknown scope
      }
    }
    return undefined
  }

  /** Provider+model currently selected for one Agent, if observable. */
  function selectionOf(agent) {
    try {
      const selection = agent?.model?.current?.()
      if (isNonEmptyString(selection?.provider)) {
        return { provider: selection.provider, model: isNonEmptyString(selection.model) ? selection.model : null }
      }
    } catch {
      // fall through to the deployment default
    }
    return null
  }

  /** Deployment default selection, for calls outside a session scope. */
  function defaultSelection() {
    try {
      const selection = getService('agentDefaultModel')?.currentSelection?.()
      if (isNonEmptyString(selection?.provider)) {
        return { provider: selection.provider, model: isNonEmptyString(selection.model) ? selection.model : null }
      }
    } catch {
      // unknown default
    }
    return null
  }

  /** Provider+model for one prompt assembly, and the Agent it belongs to. */
  function sessionContext(assembly) {
    const captured = assembly?.modelSelection
    if (isNonEmptyString(captured?.provider)) {
      return {
        agent: assembly?.agent ?? agentForScope(assembly?.scope),
        selection: { provider: captured.provider, model: isNonEmptyString(captured.model) ? captured.model : null },
      }
    }
    const agent = assembly?.agent ?? agentForScope(assembly?.scope)
    return { agent, selection: selectionOf(agent) }
  }

  function sessionIdOf(agent) {
    if (isNonEmptyString(agent?.id)) return agent.id
    if (isNonEmptyString(agent?.session?.id)) return agent.session.id
    return null
  }

  /**
   * Model-aware view; falls back to the aggregate (any family) view when the
   * route is unknown. Never throws.
   */
  function overviewForSelection(selection, at, resolved) {
    const schedules = resolved?.schedules ?? {}
    if (selection !== null) return overviewFor(selection.provider, selection.model, at, schedules)
    return aggregateOverview(at, schedules)
  }

  /** Any-family aggregate: peak now? until when? next start? */
  function aggregateOverview(at, schedules) {
    let untilAt = null
    let nextStartAt = null
    for (const key of scheduleKeys(schedules)) {
      const view = overviewFor(key, undefined, at, schedules)
      if (view.inPeak === true && view.untilAt instanceof Date) {
        if (untilAt === null || view.untilAt.getTime() < untilAt.getTime()) untilAt = view.untilAt
      } else if (view.nextStartAt instanceof Date) {
        if (nextStartAt === null || view.nextStartAt.getTime() < nextStartAt.getTime()) nextStartAt = view.nextStartAt
      }
    }
    return {
      known: false,
      inPeak: untilAt !== null,
      matchedKey: null,
      modelKey: null,
      untilAt,
      untilLabel: untilAt === null ? null : hhmmUtc(untilAt),
      nextStartAt: untilAt === null ? nextStartAt : null,
      secondsToChange: null,
      offPeakDiscount: undefined,
      mode: undefined,
    }
  }

  /** `allowFor` needs a real store; a missing one degrades to the default policy. */
  function resolveAllow(resolved, sessionId) {
    if (resolved?.enabled === false) return { allow: true, source: 'disabled', until: null }
    try {
      return allowFor(resolved, store, sessionId ?? undefined, sessionId ? ancestorsOf(ctx, sessionId) : [])
    } catch {
      return { allow: resolved?.allowPeakDefault === true, source: 'default', until: null }
    }
  }

  /** Remaining daily peak-allowance minutes, or null when unlimited. */
  function remainingMinutes(resolved) {
    const limit = resolved?.dailyLimitMinutes
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return null
    let usedSeconds = null
    try {
      if (typeof store?.limitSecondsToday === 'function') {
        const used = Number(store.limitSecondsToday())
        if (Number.isFinite(used)) usedSeconds = used
      }
    } catch {
      // fall through to the stats helper
    }
    if (usedSeconds === null) {
      try {
        const remaining = stats?.remainingAllowance?.()
        if (typeof remaining === 'number' && Number.isFinite(remaining)) {
          return Math.max(0, Math.round(remaining / 60))
        }
      } catch {
        // unknown budget
      }
      return null
    }
    return Math.max(0, Math.round((limit * 60 - usedSeconds) / 60))
  }

  /** Compact schedules map for the model: families, window count, families in peak. */
  function schedulesSummary(at, schedules) {
    const keys = []
    const peakKeys = []
    let windows = 0
    for (const key of scheduleKeys(schedules)) {
      keys.push(key)
      const entry = schedules[key]
      if (Array.isArray(entry?.windows)) windows += entry.windows.length
      for (const rule of Object.values(entry?.models ?? {})) {
        if (Array.isArray(rule?.windows)) windows += rule.windows.length
      }
      if (overviewFor(key, undefined, at, schedules).inPeak === true) peakKeys.push(key)
    }
    return { keys, windows, peakKeys }
  }

  /** One-line model-facing summary of the current policy state. */
  function noteFor(resolved, view, allow, pausedState) {
    if (resolved?.enabled === false) return 'плагин пиковых часов выключен'
    if (pausedState.paused) {
      return pausedState.pausedUntil === null
        ? 'сессия на паузе до конца пика'
        : `сессия на паузе до ${hhmmUtc(new Date(pausedState.pausedUntil))}`
    }
    if (view.inPeak !== true) return 'непиковые часы — дорогая работа сейчас выгоднее'
    if (allow.source === 'limit') return 'дневной лимит пиковых минут исчерпан — работа в пик заблокирована'
    if (allow.allow === true) return 'работа в пик разрешена пользователем'
    return 'работа в пик запрещена — дорогую задачу лучше отложить'
  }

  /**
   * The dynamic prompt-context text for one assembly.
   *
   * Returns `''` when the plugin is disabled, the configuration cannot be
   * resolved, or anything else goes wrong: a missing section is harmless, a
   * throwing provider would fail the whole turn.
   *
   * @param {{scope?: object, agent?: object, modelSelection?: object}} [assembly]
   * @returns {string}
   */
  function buildText(assembly) {
    try {
      const resolved = currentResolved()
      if (resolved.enabled === false) return ''
      const at = now()
      const { agent, selection } = sessionContext(assembly)
      const sessionId = sessionIdOf(agent)
      const view = overviewForSelection(selection, at, resolved)
      const allow = resolveAllow(resolved, sessionId)
      const pausedState = pauseState(pause, sessionId)
      const remaining = remainingMinutes(resolved)

      const parts = []
      if (selection !== null) {
        const modelLabel = selection.model === null ? selection.provider : `${selection.provider}/${selection.model}`
        let state
        if (view.inPeak === true && view.untilAt instanceof Date) {
          const label = view.untilLabel ?? hhmmUtc(view.untilAt)
          state = `сейчас пик до ${label}, ещё ${formatDuration(view.untilAt.getTime() - at.getTime())}`
        } else if (view.nextStartAt instanceof Date) {
          state = `сейчас не пик; следующий пик в ${hhmmUtc(view.nextStartAt)}, через ${formatDuration(view.nextStartAt.getTime() - at.getTime())}`
        } else {
          state = 'сейчас не пик; следующие пиковые часы не заданы'
        }
        parts.push(`Пиковые часы (${modelLabel}): ${state}.`)
      } else {
        const state = view.inPeak === true && view.untilAt instanceof Date
          ? `сейчас пик до ${view.untilLabel ?? hhmmUtc(view.untilAt)}`
          : 'сейчас не пик'
        parts.push(`Пиковые часы (модель сессии неизвестна): ${state}.`)
      }

      if (allow.source === 'limit') {
        parts.push('Дневной лимит пиковых минут исчерпан — работа в пик заблокирована до завтра.')
      } else if (allow.allow === true) {
        parts.push(allow.source === 'disabled'
          ? 'Плагин пиковых часов выключен.'
          : 'Работа в пик разрешена.')
      } else {
        parts.push('Работа в пик запрещена — шаги автоматически приостанавливаются до конца окна.')
      }

      if (pausedState.paused) {
        parts.push(pausedState.pausedUntil === null
          ? 'Сессия на паузе до конца пика.'
          : `Сессия на паузе до ${hhmmUtc(new Date(pausedState.pausedUntil))}.`)
      }

      const limit = resolved.dailyLimitMinutes
      if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
        parts.push(remaining === null
          ? `Дневной лимит пиковых минут: ${limit}.`
          : `Дневной лимит пиковых минут: ${limit}, осталось ${remaining} мин.`)
      } else {
        parts.push('Дневной лимит пиковых минут не задан.')
      }

      parts.push(INSTRUCTION)
      return clip(parts.join(' '), MAX_TEXT_CHARS)
    } catch (error) {
      warn('[peak-hours] prompt context failed: %s', messageOf(error))
      return ''
    }
  }

  /**
   * JSON-safe status for the `peak_hours_status` tool.
   *
   * @param {{agent?: object}} [exec] - tool run context; the Agent is discovered from it.
   * @returns {object}
   */
  function statusValue(exec) {
    try {
      const resolved = currentResolved()
      const at = now()
      const agent = exec?.agent
      const sessionId = sessionIdOf(agent)
      const selection = selectionOf(agent) ?? defaultSelection()
      const view = overviewForSelection(selection, at, resolved)
      const allow = resolveAllow(resolved, sessionId)
      const pausedState = pauseState(pause, sessionId)
      const limit = typeof resolved.dailyLimitMinutes === 'number' && Number.isFinite(resolved.dailyLimitMinutes)
        ? resolved.dailyLimitMinutes
        : null
      return {
        now: at.toISOString(),
        provider: selection?.provider ?? null,
        model: selection?.model ?? null,
        inPeak: view.inPeak === true,
        until: toIso(view.untilAt),
        nextStart: toIso(view.nextStartAt),
        allow: allow.allow === true,
        allowSource: typeof allow.source === 'string' ? allow.source : 'default',
        paused: pausedState.paused === true,
        pausedUntil: pausedState.pausedUntil,
        mode: typeof resolved.mode === 'string' ? resolved.mode : 'pause',
        dailyLimitMinutes: limit,
        dailyRemainingMinutes: remainingMinutes(resolved),
        schedulesSummary: schedulesSummary(at, resolved.schedules ?? {}),
        note: noteFor(resolved, view, allow, pausedState),
      }
    } catch (error) {
      warn('[peak-hours] status tool failed: %s', messageOf(error))
      return {
        now: toIso(now()) ?? new Date().toISOString(),
        provider: null,
        model: null,
        inPeak: false,
        until: null,
        nextStart: null,
        allow: true,
        allowSource: 'disabled',
        paused: false,
        pausedUntil: null,
        mode: 'pause',
        dailyLimitMinutes: null,
        dailyRemainingMinutes: null,
        schedulesSummary: { keys: [], windows: 0, peakKeys: [] },
        note: 'состояние пиковых часов недоступно',
      }
    }
  }

  /** Wrap a registry disposer so effect teardown and `dispose()` can both run it. */
  function once(disposer) {
    let done = false
    return () => {
      if (done) return
      done = true
      try {
        disposer()
      } catch (error) {
        warn('[peak-hours] prompt registration disposal failed: %s', messageOf(error))
      }
    }
  }

  /** Keep a disposer locally and (when available) hand it to the Cordis effect. */
  function attach(disposer, label) {
    if (typeof disposer !== 'function') return
    const guarded = once(disposer)
    disposers.add(guarded)
    try {
      if (typeof ctx?.effect === 'function') {
        const unregister = ctx.effect(() => guarded, label)
        if (typeof unregister === 'function') disposers.add(once(unregister))
      }
    } catch (error) {
      warn('[peak-hours] could not register the %s disposer: %s', label, messageOf(error))
    }
  }

  /** Register the dynamic prompt-context section. */
  function registerPromptContext() {
    if (registeredPrompt || disposed) return
    try {
      const systemPrompt = getService('systemPrompt')
      if (systemPrompt === undefined || typeof systemPrompt.context !== 'function') return
      const disposer = systemPrompt.context({
        name: PROMPT_NAME,
        order: PROMPT_ORDER,
        required: false,
        text: (assembly) => buildText(assembly),
      })
      registeredPrompt = true
      attach(disposer, 'peak-hours: prompt context')
    } catch (error) {
      warn('[peak-hours] prompt context registration failed: %s', messageOf(error))
    }
  }

  /** Register the global `peak_hours_status` tool. */
  function registerTool() {
    if (registeredTool || disposed) return
    try {
      const tools = getService('tools')
      if (tools === undefined || typeof tools.register !== 'function') return
      const disposer = tools.register({
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        execute: async (args, exec) => statusValue(exec),
      })
      registeredTool = true
      attach(disposer, 'peak-hours: status tool')
    } catch (error) {
      warn('[peak-hours] status tool registration failed: %s', messageOf(error))
    }
  }

  /**
   * Register the prompt section and the tool.
   *
   * When the registry services are already mounted (the normal bundle order)
   * `get` resolves them immediately. When they load later, wait for them through
   * the dependency API; the isolated test fake offers only `get`, in which case
   * this is a no-op and the test drives registration with fake services.
   */
  function start() {
    if (started || disposed) return
    started = true
    registerPromptContext()
    registerTool()
    try {
      if (typeof ctx?.inject === 'function') {
        if (!registeredPrompt) ctx.inject(['systemPrompt'], () => registerPromptContext())
        if (!registeredTool) ctx.inject(['tools'], () => registerTool())
      }
    } catch (error) {
      warn('[peak-hours] could not wait for the prompt/tool registries: %s', messageOf(error))
    }
  }

  /** Run every stored disposer; never throws out of plugin teardown. */
  function dispose() {
    disposed = true
    started = false
    registeredPrompt = false
    registeredTool = false
    for (const disposer of [...disposers].reverse()) {
      try {
        disposer()
      } catch (error) {
        warn('[peak-hours] prompt context disposal failed: %s', messageOf(error))
      }
    }
    disposers.clear()
  }

  return {
    start,
    dispose,
    toolName: TOOL_NAME,
  }
}

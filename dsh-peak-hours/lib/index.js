/**
 * dsh-peak-hours, host half — wiring.
 *
 * One plugin owns the whole peak-price story for the Web profile:
 *
 * - `lib/schedule.js` decides what "peak" means for one provider *and model*;
 * - `lib/pause.js` suspends agent steps during peak windows (`mode: pause`) and
 *   releases them automatically at the window boundary;
 * - `lib/gate.js` keeps the legacy `hard`/`warn` policy for whole `llm/stream`
 *   calls, including background purposes (`session-title`, `compaction`,
 *   `auto-review`), and accounts peak-time usage;
 * - `lib/defer.js` schedules a one-shot prompt at the peak end through the
 *   Host `schedule` service;
 * - `lib/context.js` tells the model about the current peak state and exposes
 *   the `peak_hours_status` tool;
 * - this module exposes one authenticated Connection channel
 *   (`/dsh-peak-hours`) that the Web UI polls, so the pill, the composer
 *   banner, the defer button, the sidebar markers and the settings page all
 *   read ONE source of truth.
 *
 * Unknown providers/models and malformed windows fail open (warn, never block).
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import { allowFor, resolveConfig } from './config.js'
import { createPromptContext } from './context.js'
import { createDeferService } from './defer.js'
import { createLlmGate } from './gate.js'
import { createPauseController } from './pause.js'
import { peakEndsAt, peakOverview, resolveEffective, overviewFor, normalizeSchedules } from './schedule.js'
import { ancestorsOf } from './session-tree.js'
import { createStateStore } from './state.js'
import { createStats } from './stats.js'

export const name = 'peak-hours'

/** Services required before activation: the RPC registry. */
export const inject = ['connection']

/** Logical channel: absolute, one segment, never the reserved `/api`. */
const CHANNEL = '/dsh-peak-hours'

/** Settings keys the UI may write through `save-settings`. */
const SETTINGS_KEYS = new Set([
  'mode',
  'allowPeakDefault',
  'dailyLimitMinutes',
  'prePeakWarningMinutes',
  'maxHoldMinutes',
  'backgroundPolicy',
  'notifyBeforePeak',
  'deferMarginSeconds',
  'statsEnabled',
  'strategy',
])

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function overridePath() {
  return join(dshHome(), 'peak-hours.json')
}

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } }
}

function success(value) {
  return { ok: true, value }
}

function toIso(value) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null
}

/** All known provider families in one schedules map, in declaration order. */
function scheduleKeys(schedules) {
  return Object.keys(schedules ?? {})
}

/** Earliest peak end across every configured family at `now`, or null. */
function aggregatePeakEnd(now, schedules) {
  let best = null
  for (const key of scheduleKeys(schedules)) {
    const end = peakEndsAt(key, undefined, now, schedules)
    if (end !== null && (best === null || end.getTime() < best.getTime())) best = end
  }
  return best
}

/** Earliest next peak start across every configured family, or null. */
function aggregateNextStart(now, schedules) {
  let best = null
  for (const key of scheduleKeys(schedules)) {
    for (const window of schedules[key]?.windows ?? []) {
      // A synthetic single-window family keeps the engine as the only clock
      // authority; `__probe` can never match a real provider as a family.
      const probe = { __probe: { windows: [window] } }
      const start = overviewFor('__probe', undefined, now, probe).nextStartAt
      if (start !== null && (best === null || start.getTime() < best.getTime())) best = start
    }
  }
  return best
}

/**
 * Resolve the provider+model a session is using.
 *
 * The `agent/pre-step` payload is the authoritative per-step answer; outside a
 * step we read the live Agent's model fold, then the session projection, then
 * the deployment default. A client-supplied route is used only when it carries
 * an explicit provider (the client may know its projection before the host can
 * observe a request).
 */
function resolveSessionModel(ctx, sessionId, providedProvider, providedModel) {
  if (typeof providedProvider === 'string' && providedProvider !== '') {
    return {
      provider: providedProvider,
      model: typeof providedModel === 'string' && providedModel !== '' ? providedModel : null,
      reasoningEffort: null,
      source: 'client',
    }
  }
  if (typeof sessionId !== 'string' || sessionId === '') {
    return { provider: null, model: null, reasoningEffort: null, source: 'none' }
  }
  try {
    const agent = ctx.get('agents')?.get?.(sessionId)
    const selection = agent?.model?.current?.()
    if (selection?.provider) {
      return {
        provider: selection.provider,
        model: selection.model ?? null,
        reasoningEffort: selection.reasoningEffort ?? null,
        source: 'agent',
      }
    }
  } catch {
    // fall through to the projection
  }
  try {
    const sessions = ctx.get('sessions')
    const session = sessions?.get?.(sessionId)
    if (session !== undefined) {
      const snapshot = ctx.get('sessionProjections')?.snapshot?.(session, ['modelSelection'])
      const selection = snapshot?.modelSelection?.next ?? snapshot?.modelSelection?.lastUsed
      if (selection?.provider) {
        return {
          provider: selection.provider,
          model: selection.model ?? null,
          reasoningEffort: selection.reasoningEffort ?? null,
          source: 'projection',
        }
      }
      const header = session.requestHeader?.()
      const config = header?.config
      if (config?.provider) {
        return {
          provider: config.provider,
          model: config.model ?? null,
          reasoningEffort: config.reasoningEffort ?? null,
          source: 'request-header',
        }
      }
    }
  } catch {
    // fall through to the default model
  }
  try {
    const fallback = ctx.get('agentDefaultModel')?.currentSelection?.()
    if (fallback?.provider) {
      return {
        provider: fallback.provider,
        model: fallback.model ?? null,
        reasoningEffort: fallback.reasoningEffort ?? null,
        source: 'default',
      }
    }
  } catch {
    // unknown
  }
  return { provider: null, model: null, reasoningEffort: null, source: 'unknown' }
}

/**
 * Resolve the `until` field of an allow override into an ISO instant (or null).
 *
 * @param {'forever'|'peak-end'|number|undefined} spec
 */
function resolveUntil(spec, now, model, schedules) {
  if (typeof spec === 'number' && Number.isFinite(spec) && spec > 0) {
    return new Date(now.getTime() + Math.min(spec, 24 * 60 * 7) * 60_000).toISOString()
  }
  if (spec !== 'peak-end') return null
  if (model.provider) {
    const end = peakEndsAt(model.provider, model.model, now, schedules)
    return toIso(end)
  }
  return toIso(aggregatePeakEnd(now, schedules))
}

/**
 * @param {object} ctx - plugin root context.
 * @param {object} config - bundle config from `cordis.patch.yml`.
 */
export function apply(ctx, config = {}) {
  if (config.enabled === false) return

  const store = createStateStore({ file: overridePath(), logger: ctx.logger })
  const resolve = () => resolveConfig(config, store)
  const stats = createStats({ store, resolveConfig: resolve })
  const pause = createPauseController({ ctx, getResolved: resolve, store, stats, logger: ctx.logger })
  const gate = createLlmGate({ ctx, getResolved: resolve, store, stats, logger: ctx.logger })
  const defer = createDeferService({ ctx, getResolved: resolve, stats, logger: ctx.logger })
  const promptContext = createPromptContext({ ctx, getResolved: resolve, store, pause, stats, logger: ctx.logger })

  // ── snapshot ──────────────────────────────────────────────────────────────

  /** Flat list of every model-rule windows for display when the model is unknown. */
  function configuredWindows(schedules) {
    const out = []
    for (const key of scheduleKeys(schedules)) {
      const entry = schedules[key]
      for (const window of entry.windows ?? []) out.push({ key, window })
      for (const modelKey of Object.keys(entry.models ?? {})) {
        for (const window of entry.models[modelKey].windows ?? []) out.push({ key, modelKey, window })
      }
    }
    return out
  }

  /** One session's peak/allow/pause view — the part of the snapshot the UI reads. */
  function sessionSnapshot(resolved, now, request) {
    const sessionId = typeof request?.sessionId === 'string' && request.sessionId !== '' ? request.sessionId : null
    if (sessionId === null) return null
    const model = resolveSessionModel(ctx, sessionId, request?.provider, request?.model)
    const overview = model.provider
      ? overviewFor(model.provider, model.model, now, resolved.schedules)
      : {
        known: false,
        inPeak: false,
        untilAt: null,
        untilLabel: null,
        nextStartAt: null,
        secondsToChange: null,
        matchedKey: null,
        modelKey: null,
      }
    const effective = model.provider ? resolveEffective(model.provider, model.model, resolved.schedules) : undefined
    const allow = allowFor(resolved, store, sessionId, ancestorsOf(ctx, sessionId))
    const pauseView = pause.sessionView(sessionId)
    const marks = store.marksFor(sessionId)
    const scheduled = deferPendingCount(defer, sessionId)
    return {
      id: sessionId,
      provider: model.provider,
      model: model.model,
      reasoningEffort: model.reasoningEffort,
      modelKnown: model.provider !== null,
      modelSource: model.source,
      matchedKey: overview.matchedKey ?? null,
      modelKey: overview.modelKey ?? null,
      known: overview.known === true,
      inPeak: overview.inPeak === true,
      untilAt: toIso(overview.untilAt),
      untilLabel: overview.untilLabel ?? null,
      nextStartAt: toIso(overview.nextStartAt),
      secondsToChange: overview.secondsToChange ?? null,
      mode: effective?.mode ?? resolved.mode,
      offPeakDiscount: effective?.offPeakDiscount ?? resolved.offPeakDiscount,
      effectiveWindows: effective?.windows ?? [],
      allow: allow.allow,
      allowSource: allow.source,
      allowUntil: toIso(allow.until),
      paused: pauseView.paused === true,
      pauseKind: pauseView.pauseKind ?? null,
      pausedSince: toIso(pauseView.since),
      pausedUntil: toIso(pauseView.until),
      deferredCount: (pauseView.deferredCount ?? 0) + scheduled.count,
      queuedMessages: pauseView.deferredCount ?? 0,
      scheduledMessages: scheduled.count,
      peakTurns: marks.peakTurns ?? [],
      pausedTurns: marks.pausedTurns ?? [],
    }
  }

  /** Read the defer service's in-memory task counts defensively. */
  function deferPendingCount(deferService, sessionId) {
    try {
      const counts = deferService.counts?.()
      if (counts !== undefined && counts !== null) {
        return { count: Number(counts[sessionId]?.count ?? counts[sessionId] ?? 0) }
      }
    } catch {
      // defer counts are best-effort
    }
    return { count: 0 }
  }

  /** Merge the pause queue and scheduled-task counts for every session. */
  function deferredSessionMap() {
    const merged = { ...(pause.deferredMap?.() ?? {}) }
    try {
      const counts = defer.counts?.() ?? {}
      for (const [sessionId, value] of Object.entries(counts)) {
        const count = typeof value === 'number' ? value : Number(value?.count ?? 0)
        if (count > 0) merged[sessionId] = (merged[sessionId] ?? 0) + count
      }
    } catch {
      // best effort
    }
    return merged
  }

  /** The full state payload the Web UI polls. */
  async function buildSnapshot(request = {}) {
    const resolved = resolve()
    const now = new Date()
    const aggregate = peakOverview(now, resolved.schedules)
    const aggregateEnd = aggregate.peak ? aggregatePeakEnd(now, resolved.schedules) : null
    const aggregateStart = aggregate.peak ? null : aggregateNextStart(now, resolved.schedules)
    const aggregateBoundary = aggregateEnd ?? aggregateStart
    const session = sessionSnapshot(resolved, now, request)
    // Human-readable model name (the selector shows "DeepSeek-V4.1-Flash", the
    // route id is "deepseek-flash"); resolved from the provider catalog, never
    // blocking the snapshot on a failure.
    if (session !== null && typeof session.provider === 'string' && session.provider !== '') {
      try {
        const models = await ctx.get('llm')?.listModels?.(session.provider)
        const entry = Array.isArray(models) ? models.find((candidate) => candidate?.id === session.model) : undefined
        if (typeof entry?.name === 'string' && entry.name !== '') session.modelName = entry.name
      } catch {
        // The catalog is optional decoration.
      }
    }
    let scheduledForSession = { count: 0 }
    if (session !== null) {
      try {
        scheduledForSession = await defer.pendingFor(session.id)
      } catch {
        scheduledForSession = { count: 0 }
      }
      // The schedule catalog is the authoritative count for scheduled defers.
      if (scheduledForSession.count !== undefined) {
        session.scheduledMessages = scheduledForSession.count
        session.deferredCount = (session.queuedMessages ?? 0) + scheduledForSession.count
      }
    }
    const remaining = stats.remainingAllowance()
    const pausedSessions = { ...(pause.pausedMap?.() ?? {}) }
    for (const [sessionId, state] of Object.entries(pausedSessions)) {
      if (state?.until instanceof Date) pausedSessions[sessionId] = { ...state, until: state.until.toISOString() }
    }
    return {
      serverTime: now.toISOString(),
      enabled: resolved.enabled,
      mode: resolved.mode,
      pauseStrategy: resolved.pause.strategy,
      settings: {
        allowPeakDefault: resolved.allowPeakDefault,
        dailyLimitMinutes: resolved.dailyLimitMinutes,
        prePeakWarningMinutes: resolved.prePeakWarningMinutes,
        maxHoldMinutes: resolved.pause.maxHoldMinutes,
        backgroundPolicy: resolved.backgroundPolicy,
        notifyBeforePeak: resolved.notify.beforePeak,
        deferMarginSeconds: resolved.defer.marginSeconds,
        statsEnabled: resolved.statsEnabled,
        strategy: resolved.pause.strategy,
      },
      schedules: resolved.schedules,
      schedulesSource: resolved.schedulesSource,
      scheduleWarnings: resolved.scheduleWarnings,
      canDefer: defer.canDefer() === true,
      aggregate: {
        inPeak: aggregate.peak === true,
        untilLabel: aggregate.until ?? null,
        nextStartAt: toIso(aggregateStart),
        untilAt: toIso(aggregateEnd),
        secondsToChange: aggregateBoundary === null
          ? null
          : Math.max(0, Math.round((aggregateBoundary.getTime() - now.getTime()) / 1000)),
      },
      stats: stats.summary(),
      limit: {
        dailyMinutes: resolved.dailyLimitMinutes,
        usedSeconds: store.limitSecondsToday(),
        remainingSeconds: remaining,
        exhausted: stats.allowanceExhausted(),
      },
      pausedSessions,
      deferredSessions: deferredSessionMap(),
      session,
    }
  }

  // ── RPC channel ───────────────────────────────────────────────────────────

  async function handle(endpoint, payload) {
    const request = payload ?? {}
    const resolved = resolve()
    const now = new Date()

    switch (endpoint) {
      case 'state':
        return success(await buildSnapshot(request))

      case 'set-allow-peak': {
        if (typeof request.allowPeak !== 'boolean') {
          return failure('peak-hours/bad-request', 'payload.allowPeak must be a boolean')
        }
        const sessionId = typeof request.sessionId === 'string' && request.sessionId !== '' ? request.sessionId : null
        const until = resolveUntil(request.until, now, resolveSessionModel(ctx, sessionId, request.provider, request.model), resolved.schedules)
        try {
          if (request.scope === 'default' || sessionId === null) {
            store.update((draft) => {
              draft.allowPeak = request.allowPeak
              draft.settings.allowPeakDefault = request.allowPeak
            })
          } else {
            store.setSessionAllow(sessionId, request.allowPeak, until)
          }
        } catch (error) {
          return failure('peak-hours/persist-failed', error instanceof Error ? error.message : String(error))
        }
        pause.noteAllowChanged(sessionId ?? undefined)
        ctx.logger.info('[peak-hours] peak-hour override %s%s', request.allowPeak ? 'ENABLED' : 'disabled', sessionId === null ? ' (global)' : ` for ${sessionId}`)
        return success(await buildSnapshot({ ...request, sessionId }))
      }

      case 'resume-now': {
        const sessionId = typeof request.sessionId === 'string' && request.sessionId !== '' ? request.sessionId : null
        if (sessionId === null) return failure('peak-hours/bad-request', 'payload.sessionId is required')
        const model = resolveSessionModel(ctx, sessionId, request.provider, request.model)
        const until = request.minutes === undefined
          ? resolveUntil('peak-end', now, model, resolved.schedules)
          : resolveUntil(Number(request.minutes), now, model, resolved.schedules)
        store.setSessionAllow(sessionId, true, until)
        pause.noteAllowChanged(sessionId)
        let delivered = 0
        try {
          const result = await pause.releaseNow(sessionId)
          delivered = result?.delivered ?? 0
        } catch (error) {
          ctx.logger.warn('[peak-hours] resume-now release failed: %s', error instanceof Error ? error.message : String(error))
        }
        return success({ ...(await buildSnapshot(request)), delivered })
      }

      case 'pause-now': {
        const sessionId = typeof request.sessionId === 'string' && request.sessionId !== '' ? request.sessionId : null
        if (sessionId === null) return failure('peak-hours/bad-request', 'payload.sessionId is required')
        store.setSessionAllow(sessionId, false, null)
        pause.noteAllowChanged(sessionId)
        return success(await buildSnapshot(request))
      }

      case 'defer': {
        try {
          const value = await defer.defer(request)
          return success(value)
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'peak-hours/defer-failed'
          return failure(code, error instanceof Error ? error.message : String(error))
        }
      }

      case 'cancel-defer': {
        const sessionId = typeof request.sessionId === 'string' && request.sessionId !== '' ? request.sessionId : null
        if (sessionId === null) return failure('peak-hours/bad-request', 'payload.sessionId is required')
        let cancelled = 0
        try {
          cancelled = (await defer.cancelForSession(sessionId))?.cancelled ?? 0
        } catch (error) {
          ctx.logger.warn('[peak-hours] cancel-defer failed: %s', error instanceof Error ? error.message : String(error))
        }
        try {
          cancelled += pause.cancelDeferred(sessionId) ?? 0
        } catch {
          // queue may be empty
        }
        return success({ cancelled })
      }

      case 'save-settings': {
        const patch = request.patch
        if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
          return failure('peak-hours/bad-request', 'payload.patch must be an object')
        }
        const cleaned = {}
        for (const [key, value] of Object.entries(patch)) {
          if (!SETTINGS_KEYS.has(key)) continue
          cleaned[key] = value === undefined ? null : value
        }
        try {
          store.updateSettings(cleaned)
        } catch (error) {
          return failure('peak-hours/persist-failed', error instanceof Error ? error.message : String(error))
        }
        pause.onConfigChanged()
        defer.rearm?.()
        return success(await buildSnapshot(request))
      }

      case 'save-schedules': {
        try {
          if (request.schedules === null || request.schedules === undefined) {
            store.setSchedulesOverride(null)
          } else if (typeof request.schedules === 'object' && !Array.isArray(request.schedules)) {
            const { schedules } = normalizeSchedules(request.schedules)
            store.setSchedulesOverride(schedules)
          } else {
            return failure('peak-hours/bad-request', 'payload.schedules must be an object or null')
          }
        } catch (error) {
          return failure('peak-hours/persist-failed', error instanceof Error ? error.message : String(error))
        }
        pause.onConfigChanged()
        defer.rearm?.()
        return success(await buildSnapshot(request))
      }

      case 'reset-stats': {
        stats.reset()
        return success(await buildSnapshot(request))
      }

      default:
        return failure('peak-hours/unknown-endpoint', `unknown endpoint ${JSON.stringify(String(endpoint))}`)
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  try {
    pause.start()
  } catch (error) {
    ctx.logger.warn('[peak-hours] pause controller failed to start: %s', error instanceof Error ? error.message : String(error))
  }
  try {
    gate.start()
  } catch (error) {
    ctx.logger.warn('[peak-hours] llm gate failed to start: %s', error instanceof Error ? error.message : String(error))
  }
  try {
    defer.start()
  } catch (error) {
    ctx.logger.warn('[peak-hours] defer service failed to start: %s', error instanceof Error ? error.message : String(error))
  }
  try {
    promptContext.start()
  } catch (error) {
    ctx.logger.warn('[peak-hours] prompt context failed to start: %s', error instanceof Error ? error.message : String(error))
  }

  const disposeLifecycle = () => {
    for (const part of [pause, gate, defer, promptContext]) {
      try {
        part.dispose?.()
      } catch (error) {
        ctx.logger.warn('[peak-hours] dispose failed: %s', error instanceof Error ? error.message : String(error))
      }
    }
    try {
      store.dispose()
    } catch {
      // best effort
    }
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => disposeLifecycle, 'peak-hours: lifecycle')
  }

  // `rpc.handle` registers against the Context that READ the connection service,
  // so we mount the route once `webServer` exists (same pattern as dsh-halt-jobs).
  ctx.inject(['webServer'], (webCtx) => {
    const connection = webCtx.root?.get?.('connection') ?? ctx.get('connection')
    if (connection?.rpc?.handle === undefined) return
    const dispose = connection.rpc.handle(CHANNEL, handle)
    if (typeof webCtx.effect === 'function') {
      webCtx.effect(() => dispose, 'peak-hours: rpc channel')
    } else if (typeof ctx.effect === 'function') {
      ctx.effect(() => dispose, 'peak-hours: rpc channel')
    }
  })
}

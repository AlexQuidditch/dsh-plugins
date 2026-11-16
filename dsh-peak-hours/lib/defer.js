/**
 * Deferred prompts as one-shot Host `schedule` tasks — no cordis imports.
 *
 * When the user hits "⏰ до HH:MM" (or the model decides a task should move out
 * of thin ice), the prompt is stored as a real Host Schedule task that targets
 * the same Session and fires at the current peak window's end plus a small
 * margin. The `schedule` delivery machinery then wakes the session with an
 * ordinary follow-up message — this module never re-implements delivery.
 *
 * The plugin never owns the task list: it recognises its own tasks by the
 * fixed title prefix, so a restart, a configuration edit or a second plugin
 * instance converges on the same set. `start()` re-arms the tasks already
 * stored (`schedule` does not recompute timings when the schedules change),
 * and `cancelForSession()` removes exactly the tasks of one Session.
 *
 * Everything here fails soft: a missing `schedule` service disables deferral
 * (`canDefer()` is false) instead of breaking the plugin, and `start()` /
 * `rearm()` / `dispose()` never throw into the host.
 */
import { overviewFor, scheduleKeys } from './schedule.js'

/**
 * Fixed task-title marker, `[пик] отложено до конца пика` (Russian: "peak:
 * postponed until the peak ends"). Boot re-arm and cancel scan for this exact
 * prefix, so it must never be localised or made configurable.
 */
export const DEFER_TITLE_PREFIX = '[пик] отложено до конца пика'

/** Host `schedule` titles are trimmed and capped at 120 characters. */
const MAX_TITLE_CHARS = 120

/** The prompt is capped here before the Host validates it. */
const MAX_PROMPT_CHARS = 20_000

/** One page is enough: the plugin's own tasks are few, and the scan is cheap. */
const LIST_LIMIT = 100

/** Delay before the boot re-arm, so the Host schedule domain is fully loaded. */
const REARM_DELAY_MS = 1000

/** The Host refuses non-future instants; never schedule closer than this. */
const MIN_FUTURE_MS = 1000

/** Timeout for the optional session-projection lookup. */
const PROJECTION_TIMEOUT_MS = 5000

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

/** An Error with the stable `peak-hours/*` code the RPC layer maps to a reply. */
function codedError(code, message, cause) {
  const error = new Error(message)
  error.code = code
  if (cause !== undefined) error.cause = cause
  return error
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Epoch milliseconds for an ISO string, else null. */
function parseMs(value) {
  if (typeof value !== 'string' || value === '') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** `HH:MM UTC` for an instant — the fallback title label. */
function utcHHMM(date) {
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes} UTC`
}

/** Abort signal for the optional Remote call; the service may require one. */
function projectionSignal() {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(PROJECTION_TIMEOUT_MS)
    }
    if (typeof AbortController !== 'undefined') return new AbortController().signal
  } catch {
    // no signal available
  }
  return undefined
}

/**
 * Read the model selection out of a Session-projection reply.
 *
 * `SessionController.projections({ sessionId }, signal)` answers with
 * `{ kind: 'sequenced', values }`, `{ kind: 'migration-required', values }` or
 * `null`; `values.modelSelection` is `{ next, lastUsed }`.
 */
function selectionFromProjections(value) {
  if (value === null || typeof value !== 'object') return null
  const values = value.values ?? value
  const projection = values?.modelSelection
  if (projection === null || typeof projection !== 'object') return null
  const selection = projection.next ?? projection.lastUsed
  if (selection === null || typeof selection !== 'object') return null
  if (!isNonEmptyString(selection.provider)) return null
  return {
    provider: selection.provider,
    model: isNonEmptyString(selection.model) ? selection.model : null,
    source: 'projection',
  }
}

/**
 * Resolve the provider+model one Session runs on.
 *
 * The explicit API argument wins (the Web client may know its projection
 * before the Host can observe a request), then the live Agent's durable model
 * fold, then the Session projection. Every source is optional and guarded;
 * an unknown route returns nulls so the caller can fall back to the aggregate
 * (model-less) view.
 *
 * @param {object} ctx - plugin context.
 * @param {string} sessionId - Session whose route is wanted.
 * @param {string} [providedProvider] - provider supplied by the caller.
 * @param {string} [providedModel] - model supplied by the caller.
 * @param {{ warn: Function }} logger - cordis logger.
 * @returns {Promise<{provider: string|null, model: string|null, source: string}>}
 */
async function resolveSessionModel(ctx, sessionId, providedProvider, providedModel, logger) {
  if (isNonEmptyString(providedProvider)) {
    return {
      provider: providedProvider.trim(),
      model: isNonEmptyString(providedModel) ? providedModel.trim() : null,
      source: 'argument',
    }
  }
  try {
    const agent = ctx?.get?.('agents')?.get?.(sessionId)
    const selection = agent?.model?.current?.()
    if (isNonEmptyString(selection?.provider)) {
      return {
        provider: selection.provider,
        model: isNonEmptyString(selection.model) ? selection.model : null,
        source: 'agent',
      }
    }
  } catch (error) {
    logger?.warn?.('[peak-hours] could not read the live agent model: %s', messageOf(error))
  }
  try {
    const controller = ctx?.get?.('sessionController')
    if (controller !== undefined && typeof controller.projections === 'function') {
      const value = await controller.projections({ sessionId }, projectionSignal())
      const selection = selectionFromProjections(value)
      if (selection !== null) return selection
    }
  } catch (error) {
    logger?.warn?.('[peak-hours] could not read the session model projection: %s', messageOf(error))
  }
  return { provider: null, model: null, source: 'unknown' }
}

/**
 * Peak view of one provider+model at `at`, or null when it is not in peak.
 *
 * @returns {{untilAt: Date, untilLabel: string|null}|null}
 */
function peakForModel(provider, model, at, schedules) {
  const overview = overviewFor(provider, model, at, schedules ?? {})
  if (overview.inPeak !== true || !(overview.untilAt instanceof Date)) return null
  return {
    untilAt: overview.untilAt,
    untilLabel: typeof overview.untilLabel === 'string' && overview.untilLabel !== '' ? overview.untilLabel : null,
  }
}

/**
 * Earliest peak end across every configured provider family at `at`.
 *
 * Used when the Session's route is unknown: any peak that is open now is a
 * better guess than refusing to defer, and the earliest end is the instant at
 * which at least one route gets cheaper.
 *
 * @returns {{untilAt: Date, untilLabel: string|null}|null}
 */
function aggregatePeak(at, schedules) {
  let best = null
  for (const key of scheduleKeys(schedules ?? {})) {
    const overview = overviewFor(key, undefined, at, schedules)
    if (overview.inPeak !== true || !(overview.untilAt instanceof Date)) continue
    if (best !== null && best.untilAt.getTime() <= overview.untilAt.getTime()) continue
    best = {
      untilAt: overview.untilAt,
      untilLabel: typeof overview.untilLabel === 'string' && overview.untilLabel !== '' ? overview.untilLabel : null,
    }
  }
  return best
}

/** Host-schedule entry shaped like the plugin's own deferred task. */
function isDeferTask(entry) {
  return entry !== null
    && typeof entry === 'object'
    && typeof entry.title === 'string'
    && entry.title.startsWith(DEFER_TITLE_PREFIX)
}

/** Target Session id of a task, or null for other target kinds. */
function sessionTargetOf(entry) {
  const target = entry?.target
  if (target?.kind !== 'session' || !isNonEmptyString(target.sessionId)) return null
  return target.sessionId
}

/** The layout of one deferred title; the prefix survives the 120-char cap. */
function deferTitle(untilLabel, peakEnd) {
  const label = isNonEmptyString(untilLabel) ? untilLabel.trim() : utcHHMM(peakEnd)
  const title = `${DEFER_TITLE_PREFIX} · ${label}`
  return title.length <= MAX_TITLE_CHARS ? title : title.slice(0, MAX_TITLE_CHARS)
}

/**
 * Create the deferred-prompt service for one plugin instance.
 *
 * @param {object} options
 * @param {object} options.ctx - plugin root context (services read via `get`).
 * @param {() => object} options.getResolved - effective plugin configuration.
 * @param {{ noteDeferred: Function }} options.stats - savings counters.
 * @param {{ warn: Function }} options.logger - cordis logger.
 * @param {() => Date} [options.now] - clock injection for tests.
 */
export function createDeferService({ ctx, getResolved, stats, logger, now = () => new Date() }) {
  /** In-memory task ids of deferred prompts, for snapshot counts. */
  const knownTasks = new Map()

  let started = false
  let disposed = false
  let rearmTimer = null

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

  /** `schedule` service when mounted, else undefined. */
  function getSchedule() {
    const schedule = getService('schedule')
    return schedule !== undefined && schedule !== null ? schedule : undefined
  }

  function marginMs(resolved) {
    const seconds = Number(resolved?.defer?.marginSeconds)
    return (Number.isFinite(seconds) && seconds >= 0 ? seconds : 1) * 1000
  }

  /** Desired instant: peak end plus the configured safety margin. */
  function wantedInstant(peak, at, resolved) {
    const target = peak.untilAt.getTime() + marginMs(resolved)
    return new Date(Math.max(target, at.getTime() + MIN_FUTURE_MS))
  }

  /** One page of active tasks, narrowed to this plugin's deferred prompts. */
  async function listDeferTasks(schedule) {
    const result = await schedule.list({ active: true, limit: LIST_LIMIT })
    const items = Array.isArray(result)
      ? result
      : (Array.isArray(result?.items) ? result.items : [])
    return items.filter(isDeferTask)
  }

  /** Rebuild the in-memory id → Session map from a task listing. */
  function rememberTasks(tasks) {
    const next = new Map()
    for (const entry of tasks) {
      const sessionId = sessionTargetOf(entry)
      if (sessionId !== null && typeof entry.id === 'string' && entry.id !== '') next.set(entry.id, sessionId)
    }
    // Keep ids created after the listing snapshot was taken.
    for (const [id, sessionId] of knownTasks) {
      if (!next.has(id)) next.set(id, sessionId)
    }
    knownTasks.clear()
    for (const [id, sessionId] of next) knownTasks.set(id, sessionId)
  }

  /** Peak view for one stored task: its Session's route if known, else the aggregate. */
  async function peakForTask(sessionId, at, resolved) {
    const model = await resolveSessionModel(ctx, sessionId, undefined, undefined, logger)
    if (model.provider !== null) return peakForModel(model.provider, model.model, at, resolved?.schedules ?? {})
    return aggregatePeak(at, resolved?.schedules ?? {})
  }

  // ── public API ─────────────────────────────────────────────────────────────

  /** Whether the Host mounted the `schedule` service (drives the UI button). */
  function canDefer() {
    return getSchedule() !== undefined
  }

  /**
   * Defer one prompt to the end of the currently open peak window.
   *
   * @param {{sessionId?: string, text?: string, provider?: string, model?: string}} request
   * @returns {Promise<{taskId: string, scheduledAt: string, peakEndsAt: string}>}
   */
  async function defer(request = {}) {
    const sessionId = isNonEmptyString(request?.sessionId) ? request.sessionId.trim() : ''
    if (sessionId === '') {
      throw codedError('peak-hours/bad-request', 'payload.sessionId must be a non-empty string')
    }
    const text = typeof request?.text === 'string' ? request.text.trim() : ''
    if (text === '') {
      throw codedError('peak-hours/bad-request', 'payload.text must be a non-empty string')
    }
    const schedule = getSchedule()
    if (schedule === undefined || typeof schedule.create !== 'function') {
      throw codedError('peak-hours/schedule-unavailable', 'the Host schedule service is not mounted')
    }

    let resolved
    try {
      resolved = currentResolved()
    } catch (error) {
      throw codedError('peak-hours/defer-failed', `could not resolve the plugin configuration: ${messageOf(error)}`, error)
    }

    const at = now()
    let peak
    try {
      const model = await resolveSessionModel(ctx, sessionId, request?.provider, request?.model, logger)
      peak = model.provider !== null
        ? peakForModel(model.provider, model.model, at, resolved.schedules ?? {})
        : aggregatePeak(at, resolved.schedules ?? {})
    } catch (error) {
      throw codedError('peak-hours/defer-failed', `could not resolve the peak window: ${messageOf(error)}`, error)
    }
    if (peak === null) {
      throw codedError('peak-hours/not-in-peak', `session ${sessionId} is not inside a configured peak window right now`)
    }

    const peakEnd = peak.untilAt
    const target = wantedInstant(peak, at, resolved)
    const timing = { kind: 'at', at: target.toISOString() }
    const title = deferTitle(peak.untilLabel, peakEnd)
    const prompt = text.slice(0, MAX_PROMPT_CHARS)

    let entry
    try {
      entry = await schedule.create({
        title,
        prompt,
        timing,
        target: { kind: 'session', sessionId },
      }, sessionId)
    } catch (error) {
      throw codedError('peak-hours/defer-failed', `schedule.create failed: ${messageOf(error)}`, error)
    }
    if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id === '') {
      throw codedError('peak-hours/defer-failed', 'schedule.create returned no task id')
    }
    knownTasks.set(entry.id, sessionId)
    try {
      stats?.noteDeferred?.()
    } catch (error) {
      warn('[peak-hours] could not count the deferred prompt: %s', messageOf(error))
    }
    return {
      taskId: entry.id,
      scheduledAt: typeof entry.scheduledAt === 'string' && entry.scheduledAt !== '' ? entry.scheduledAt : timing.at,
      peakEndsAt: peakEnd.toISOString(),
    }
  }

  /**
   * Delete every deferred task of one Session (title prefix + session target).
   *
   * @param {string} sessionId
   * @returns {Promise<{cancelled: number}>}
   */
  async function cancelForSession(sessionId) {
    if (!isNonEmptyString(sessionId)) return { cancelled: 0 }
    const schedule = getSchedule()
    if (schedule === undefined || typeof schedule.list !== 'function') return { cancelled: 0 }

    let tasks
    try {
      tasks = await listDeferTasks(schedule)
    } catch (error) {
      warn('[peak-hours] deferred-task listing failed: %s', messageOf(error))
      return { cancelled: 0 }
    }
    rememberTasks(tasks)

    let cancelled = 0
    for (const entry of tasks) {
      if (sessionTargetOf(entry) !== sessionId) continue
      const id = entry.id
      if (typeof id !== 'string' || id === '') continue
      try {
        const result = await schedule.edit({
          id,
          action: 'delete',
          expectedUpdatedAt: entry.updatedAt ?? null,
        }, sessionId)
        if (result === undefined || result?.deleted === true) {
          cancelled += 1
          knownTasks.delete(id)
        }
      } catch (error) {
        warn('[peak-hours] could not delete deferred task %s: %s', id, messageOf(error))
      }
    }
    return { cancelled }
  }

  /**
   * Count this plugin's active deferred tasks for one Session.
   *
   * @param {string} sessionId
   * @returns {Promise<{count: number, nextAt: string|null}>}
   */
  async function pendingFor(sessionId) {
    const empty = { count: 0, nextAt: null }
    if (!isNonEmptyString(sessionId)) return empty
    const schedule = getSchedule()
    if (schedule === undefined || typeof schedule.list !== 'function') return empty

    let tasks
    try {
      tasks = await listDeferTasks(schedule)
    } catch (error) {
      warn('[peak-hours] deferred-task listing failed: %s', messageOf(error))
      return empty
    }
    rememberTasks(tasks)

    let count = 0
    let next = null
    for (const entry of tasks) {
      if (sessionTargetOf(entry) !== sessionId) continue
      count += 1
      const ms = parseMs(entry.scheduledAt)
      if (ms !== null && (next === null || ms < next)) next = ms
    }
    return { count, nextAt: next === null ? null : new Date(next).toISOString() }
  }

  /**
   * Synchronous best-effort deferred counts per Session, for the RPC snapshot.
   * Populated by `defer()`, `pendingFor()`, `cancelForSession()` and `rearm()`.
   *
   * @returns {Record<string, number>}
   */
  function counts() {
    const summary = {}
    for (const sessionId of knownTasks.values()) summary[sessionId] = (summary[sessionId] ?? 0) + 1
    return summary
  }

  /**
   * Re-arm the stored deferred tasks after boot or a configuration change.
   *
   * The Host `schedule` service does not recompute timings when the schedules
   * change: it keeps the instant stored at creation. This pass resolves each
   * task's target Session model (best effort) and moves the task to the new
   * peak end + margin, refreshing the title label. When no configured family
   * is in peak, it does nothing — the late one-shots still deliver on their own
   * and the next change re-arms them.
   *
   * Never rejects: it is also called fire-and-forget from the RPC handlers.
   *
   * @returns {Promise<{updated: number}>}
   */
  async function rearm() {
    try {
      if (disposed) return { updated: 0 }
      const resolved = currentResolved()
      if (resolved.enabled === false) return { updated: 0 }
      const schedule = getSchedule()
      if (schedule === undefined || typeof schedule.list !== 'function') return { updated: 0 }

      const at = now()
      let tasks
      try {
        tasks = await listDeferTasks(schedule)
      } catch (error) {
        warn('[peak-hours] deferred-task re-arm listing failed: %s', messageOf(error))
        return { updated: 0 }
      }
      rememberTasks(tasks)
      if (tasks.length === 0) return { updated: 0 }
      if (aggregatePeak(at, resolved.schedules ?? {}) === null) return { updated: 0 }

      let updated = 0
      for (const entry of tasks) {
        if (disposed) break
        const sessionId = sessionTargetOf(entry)
        if (sessionId === null || typeof entry.id !== 'string' || entry.id === '') continue
        let peak
        try {
          peak = await peakForTask(sessionId, at, resolved)
        } catch (error) {
          warn('[peak-hours] could not compute the re-armed instant for task %s: %s', entry.id, messageOf(error))
          continue
        }
        if (peak === null) continue
        const target = wantedInstant(peak, at, resolved)
        const wantedMs = target.getTime()
        const currentMs = parseMs(entry.scheduledAt)
        if (currentMs !== null && currentMs === wantedMs) continue
        try {
          await schedule.edit({
            id: entry.id,
            action: 'update',
            patch: {
              timing: { kind: 'at', at: target.toISOString() },
              title: deferTitle(peak.untilLabel, peak.untilAt),
            },
            expectedUpdatedAt: entry.updatedAt ?? null,
          }, sessionId)
          updated += 1
        } catch (error) {
          warn('[peak-hours] could not re-arm deferred task %s: %s', entry.id, messageOf(error))
        }
      }
      if (updated > 0) {
        warn('[peak-hours] re-armed %d deferred task(s) at the new peak end', updated)
      }
      return { updated }
    } catch (error) {
      warn('[peak-hours] deferred-task re-arm failed: %s', messageOf(error))
      return { updated: 0 }
    }
  }

  function clearRearmTimer() {
    if (rearmTimer === null) return
    try {
      clearTimeout(rearmTimer)
    } catch {
      // already fired
    }
    rearmTimer = null
  }

  /** Arm the delayed boot re-arm; a Cordis-owned disposer clears it on unload. */
  function armRearm() {
    if (disposed) return
    clearRearmTimer()
    try {
      rearmTimer = setTimeout(() => {
        rearmTimer = null
        if (disposed) return
        void rearm()
      }, REARM_DELAY_MS)
      if (typeof rearmTimer?.unref === 'function') rearmTimer.unref()
    } catch (error) {
      warn('[peak-hours] could not schedule the deferred-task re-arm: %s', messageOf(error))
    }
    try {
      if (typeof ctx?.effect === 'function') {
        ctx.effect(() => () => clearRearmTimer(), 'peak-hours: defer rearm timer')
      }
    } catch (error) {
      warn('[peak-hours] could not register the re-arm disposer: %s', messageOf(error))
    }
  }

  /** Boot: re-arm the tasks already stored by a previous host process. */
  function start() {
    if (started || disposed) return
    started = true
    try {
      armRearm()
    } catch (error) {
      warn('[peak-hours] deferred-task re-arm failed to start: %s', messageOf(error))
    }
  }

  /** Drop timers and bookkeeping; never throws out of plugin teardown. */
  function dispose() {
    disposed = true
    started = false
    clearRearmTimer()
    knownTasks.clear()
  }

  return {
    canDefer,
    start,
    dispose,
    defer,
    cancelForSession,
    pendingFor,
    counts,
    rearm,
  }
}

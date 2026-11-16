/**
 * Pause machinery for peak hours — `agent/pre-step` holds and the durable queue.
 *
 * The plugin never wants to lose the user's prompt, but it must be able to stop
 * a turn before the model call happens. Two strategies share one listener:
 *
 * - HOLD (short windows): the pre-step waterfall listener waits inside the open
 *   turn (the claimed inbox messages stay in this closure) until the peak
 *   window ends, the user explicitly resumes, the allow override flips, the
 *   model route changes, or the turn is aborted. Nothing is written to the
 *   loop's inbox while waiting *except* on abort, where the claimed messages are
 *   restored to `next-turn` before the listener returns; the loop then ends the
 *   turn and the prompts survive as queued input.
 * - REQUEUE (long windows / active goals): the claimed messages are persisted
 *   into `store.addDeferred()` *before* the listener returns `{ kind: 'reject' }`.
 *   The loop's reject drops the claimed messages, so storing first is
 *   mandatory; the turn closes `blocked`, the session goes idle, and a timer
 *   (plus `deliverDue()` on boot) hands the prompts back via
 *   `agent.send(message, 'next-turn', true)`.
 *
 * The controller is pure bookkeeping around the pure schedule/config modules —
 * no `@deepseek-ai/*` imports, all cross-service access through `ctx.get()` —
 * so a linked plugin can load it. `ctx` is the plugin's ROOT cordis Context;
 * `getResolved()` is called on every decision (never cached) so a settings or
 * schedule change takes effect on the next iteration.
 */
import { allowFor } from './config.js'
import { ancestorsOf, isDescendantOf } from './session-tree.js'
import { overviewFor } from './schedule.js'

/** Re-check cap inside one pre-step listener; each release restarts the loop. */
const MAX_PAUSE_ITERATIONS = 8
/** `setTimeout` cannot represent a longer delay; such queues are re-armed on boot. */
const MAX_TIMER_DELAY = 2 ** 31 - 1
/** Wake just after the window's declared end so the boundary is genuinely past. */
const HOLD_MARGIN_MS = 1_000
const WAKE_MARGIN_MS = 1_000
/** Retry a failed deferred delivery after this delay instead of spinning. */
const DELIVERY_RETRY_MS = 60_000
/** Bound the number of live wake timers this controller can hold. */
const MAX_WAKE_TIMERS = 512

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Best-effort logger call: a broken logger must never break a turn. */
function safeCall(logger, method, args) {
  try {
    const fn = logger?.[method]
    if (typeof fn === 'function') fn.apply(logger, args)
  } catch {
    // Logging is observability only; never let it fail the gate.
  }
}

/**
 * @param {object} options
 * @param {import('@deepseek-ai/cordis').Context} options.ctx - plugin ROOT context.
 * @param {() => object} options.getResolved - current effective config (never cached).
 * @param {object} options.store - durable state store from `./state.js`.
 * @param {object} options.stats - counters from `./stats.js`.
 * @param {object} options.logger - cordis logger with `info`/`warn`.
 * @param {() => Date} [options.now] - clock injection for tests.
 */
export function createPauseController({ ctx, getResolved, store, stats, logger, now = () => new Date() }) {
  /** sessionId -> { sessionId, since, until, finish(reason) } while a step is held. */
  const holds = new Map()
  /** sessionId -> setTimeout handle for a deferred delivery. */
  const wakeTimers = new Map()
  /** Disposers of the event listeners registered by `start()`. */
  const disposers = []
  let started = false
  let disposed = false

  function logInfo(...args) {
    safeCall(logger, 'info', args)
  }

  function logWarn(...args) {
    safeCall(logger, 'warn', args)
  }

  function currentNow() {
    const value = now()
    return value instanceof Date ? value : new Date(value)
  }

  function safeResolved() {
    try {
      return getResolved() ?? {}
    } catch (error) {
      logWarn('[peak-hours] pause: could not resolve config: %s', messageOf(error))
      return {}
    }
  }

  /** Effective allow for one session: own override, else the nearest ancestor's. */
  function allowStatus(resolved, sessionId) {
    try {
      return allowFor(resolved, store, sessionId, ancestorsOf(ctx, sessionId))
    } catch {
      return allowFor(resolved, store, sessionId)
    }
  }

  /** Release holds of every descendant session (a parent resumed/unpaused their tree). */
  function releaseDescendantHolds(ancestorId, reason) {
    const ancestor = String(ancestorId)
    for (const holdId of [...holds.keys()]) {
      if (holdId === ancestor) continue
      try {
        if (isDescendantOf(ctx, holdId, ancestor)) releaseHold(holdId, reason)
      } catch (error) {
        logWarn('[peak-hours] could not release descendant hold %s: %s', holdId, messageOf(error))
      }
    }
  }

  /** Optional-service access: `ctx.get()` first (no inject requirement), then a property read. */
  function service(name) {
    try {
      const fromGet = typeof ctx?.get === 'function' ? ctx.get(name) : undefined
      if (fromGet !== undefined) return fromGet
    } catch {
      // Fall through to a direct property read.
    }
    try {
      return ctx?.[name]
    } catch {
      return undefined
    }
  }

  // ── pause eligibility / decision inputs ───────────────────────────────────

  function isPausing(resolved) {
    return resolved?.enabled !== false && resolved?.mode === 'pause'
  }

  /** Effective mode for one provider/model: an entry-level override wins. */
  function effectiveMode(resolved, overview) {
    const mode = overview?.mode ?? resolved?.mode
    return mode === 'pause' || mode === 'hard' || mode === 'warn' ? mode : 'pause'
  }

  function markTurn(sessionId, turn, patch) {
    try {
      store.markTurn(sessionId, turn, patch)
    } catch (error) {
      logWarn('[peak-hours] could not mark turn %s of session %s: %s', turn, sessionId, messageOf(error))
    }
  }

  function noteHeldStep() {
    try {
      stats.noteHeldStep()
    } catch (error) {
      logWarn('[peak-hours] could not count a held step: %s', messageOf(error))
    }
  }

  function notePausedSeconds(seconds) {
    try {
      stats.notePausedSeconds(seconds)
    } catch (error) {
      logWarn('[peak-hours] could not account paused seconds: %s', messageOf(error))
    }
  }

  function noteDeferred() {
    try {
      stats.noteDeferred()
    } catch (error) {
      logWarn('[peak-hours] could not count a deferred prompt: %s', messageOf(error))
    }
  }

  /** Whether this agent has an active (armed) goal that must keep its automatic rounds. */
  function hasActiveGoal(agent) {
    try {
      const goals = service('goals')
      const goal = goals?.get?.(agent)
      if (goal === null || goal === undefined) return false
      return goal.phase === 'active' || goal.activation === 'armed'
    } catch (error) {
      logWarn('[peak-hours] could not read the goal of session %s: %s', String(agent?.id), messageOf(error))
      return false
    }
  }

  /** Whether requeueing would strand a subagent: a child cannot be re-activated safely. */
  function isSubagentSession(agent) {
    try {
      const header = agent?.session?.header
      if (header === null || header === undefined) return false
      if (header.origin === 'subagent') return true
      if (header.parentSession !== undefined && header.parentSession !== null) return true
      if (header.delegationDepth !== undefined && header.delegationDepth !== null) return true
      return false
    } catch {
      return false
    }
  }

  /**
   * Choose how to pause: explicit config, else `auto` by window length / goal.
   * A subagent is always held; a queued subagent cannot be re-activated safely.
   */
  function chooseStrategy(resolved, agent, remainingMs) {
    const pause = resolved?.pause ?? {}
    const maxHoldMinutes = Number(pause.maxHoldMinutes)
    const maxHoldMs = (Number.isFinite(maxHoldMinutes) ? Math.max(0, maxHoldMinutes) : 20) * 60_000
    let strategy
    if (pause.strategy === 'requeue') strategy = 'requeue'
    else if (pause.strategy === 'hold') strategy = 'hold'
    else strategy = remainingMs > maxHoldMs || hasActiveGoal(agent) ? 'requeue' : 'hold'
    if (strategy === 'requeue' && isSubagentSession(agent)) strategy = 'hold'
    return strategy
  }

  function checkpointEnabled(resolved) {
    return resolved?.pause?.checkpoint !== false
  }

  /** Durability checkpoint before pausing: flush the open turn to the session log. */
  async function checkpoint(agent) {
    const sessions = service('sessions')
    if (sessions === null || sessions === undefined || typeof sessions.flush !== 'function') return
    try {
      await sessions.flush(agent?.session)
    } catch (error) {
      logWarn('[peak-hours] pre-pause checkpoint failed for session %s: %s', String(agent?.id), messageOf(error))
    }
  }

  // ── claimed-message restore (abort / dispose / failed requeue) ────────────

  function isInboxPending(inbox, message) {
    const id = message?.id
    const lists = [inbox?.nextStep, inbox?.nextTurn]
    for (const list of lists) {
      if (!Array.isArray(list)) continue
      const found = list.some((candidate) => candidate === message
        || (id !== undefined && candidate?.id === id))
      if (found) return true
    }
    return false
  }

  /** Put claimed messages back into `next-turn` so an aborted turn does not lose them. */
  function restoreClaimed(agent, messages) {
    if (!Array.isArray(messages) || messages.length === 0) return
    const inbox = agent?.inbox
    if (inbox === null || inbox === undefined || typeof inbox.prepend !== 'function') return
    try {
      for (const message of [...messages].reverse()) {
        if (isInboxPending(inbox, message)) continue
        inbox.prepend('next-turn', message)
      }
    } catch (error) {
      logWarn('[peak-hours] could not restore claimed prompt(s) of session %s: %s', String(agent?.id), messageOf(error))
    }
  }

  function restoreAndProceed(agent, messages, proceed) {
    restoreClaimed(agent, messages)
    return proceed()
  }

  // ── hold strategy ─────────────────────────────────────────────────────────

  /** Resolve the live hold of one session (or all when no id) with a reason. */
  function releaseHold(sessionId, reason) {
    const hold = holds.get(String(sessionId))
    if (hold === undefined) return false
    hold.finish(reason)
    return true
  }

  function releaseAllHolds(reason) {
    for (const hold of [...holds.values()]) hold.finish(reason)
  }

  /**
   * Wait inside the open turn.
   *
   * Races the window end (real `setTimeout`), the turn's abort signal, and an
   * explicit release from `releaseNow` / `noteAllowChanged` / `onConfigChanged` /
   * a model-selection change. Resolves (never rejects) with a reason:
   * `timeout` | `aborted` | `resume` | `released` | `dispose`.
   */
  function holdSession(sessionId, until, signal) {
    const since = currentNow()
    return new Promise((resolve) => {
      let settled = false
      let timer = null
      const finish = (reason) => {
        if (settled) return
        settled = true
        if (timer !== null) {
          try {
            clearTimeout(timer)
          } catch {
            // Ignore: the handle is already gone.
          }
          timer = null
        }
        try {
          signal?.removeEventListener?.('abort', onAbort)
        } catch {
          // Signal implementations without removeEventListener are fine.
        }
        if (holds.get(sessionId) === hold) holds.delete(sessionId)
        resolve({ reason, since })
      }
      const onAbort = () => finish('aborted')
      const hold = { sessionId, since, until, finish }
      holds.set(sessionId, hold)
      const delay = until instanceof Date
        ? Math.max(0, until.getTime() - currentNow().getTime()) + HOLD_MARGIN_MS
        : HOLD_MARGIN_MS
      timer = setTimeout(() => finish('timeout'), Math.min(MAX_TIMER_DELAY, delay))
      if (typeof timer?.unref === 'function') timer.unref()
      if (signal !== null && signal !== undefined) {
        if (signal.aborted === true) {
          finish('aborted')
          return
        }
        try {
          signal.addEventListener('abort', onAbort, { once: true })
        } catch {
          // A signal without listener support is covered by the pre-await check.
        }
      }
    })
  }

  // ── requeue strategy ──────────────────────────────────────────────────────

  /** Persist claimed messages, arm the timer, and reject the turn. */
  function requeue(agent, sessionId, messages, until) {
    const untilDate = until instanceof Date ? until : currentNow()
    const untilISO = untilDate.toISOString()
    const stored = []
    for (const message of messages) {
      try {
        store.addDeferred(sessionId, message, untilISO)
        stored.push(message)
        noteDeferred()
      } catch (error) {
        logWarn('[peak-hours] could not queue a deferred prompt for session %s: %s', sessionId, messageOf(error))
      }
    }
    if (stored.length === 0) {
      // Without a durable copy a reject would drop the user's prompt: fail open.
      restoreClaimed(agent, messages)
      return null
    }
    const failed = messages.filter((message) => !stored.includes(message))
    if (failed.length > 0) restoreClaimed(agent, failed)
    armWake(sessionId, untilDate)
    logInfo(
      '[peak-hours] queued %d prompt(s) of session %s until peak hours end (%s)',
      stored.length,
      sessionId,
      untilISO,
    )
    return { kind: 'reject' }
  }

  // ── deferred delivery ─────────────────────────────────────────────────────

  function earliestUntil(entries) {
    let best = null
    for (const entry of Array.isArray(entries) ? entries : []) {
      const parsed = Date.parse(entry?.until)
      if (!Number.isFinite(parsed)) continue
      if (best === null || parsed < best) best = parsed
    }
    return best === null ? null : new Date(best)
  }

  function earliestSince(entries) {
    let best = null
    for (const entry of Array.isArray(entries) ? entries : []) {
      const parsed = Date.parse(entry?.since)
      if (!Number.isFinite(parsed)) continue
      if (best === null || parsed < best) best = parsed
    }
    return best === null ? null : new Date(best)
  }

  function clearWakeTimer(sessionId) {
    const id = String(sessionId)
    const timer = wakeTimers.get(id)
    if (timer === undefined) return
    wakeTimers.delete(id)
    try {
      clearTimeout(timer)
    } catch {
      // Ignore: the timer already fired or was cleared.
    }
  }

  /** One timer per queued session; it fires `wakeSession` at the window end. */
  function armWake(sessionId, until) {
    const id = String(sessionId)
    clearWakeTimer(id)
    const target = until instanceof Date ? until : new Date(until)
    if (Number.isNaN(target.getTime())) return
    if (wakeTimers.size >= MAX_WAKE_TIMERS) {
      logWarn('[peak-hours] too many pending wake timers; session %s is delivered on the next config change or boot', id)
      return
    }
    const delay = Math.min(MAX_TIMER_DELAY, Math.max(0, target.getTime() - currentNow().getTime()) + WAKE_MARGIN_MS)
    const timer = setTimeout(() => {
      wakeTimers.delete(id)
      safeWakeSession(id)
    }, delay)
    if (typeof timer?.unref === 'function') timer.unref()
    wakeTimers.set(id, timer)
  }

  /** Resolve the live agent of a session (registry first, controller resume second). */
  async function resolveAgentFor(sessionId) {
    try {
      const agents = service('agents')
      const live = agents?.get?.(sessionId)
      if (live !== undefined && live !== null) return live
    } catch (error) {
      logWarn('[peak-hours] could not read the agent registry: %s', messageOf(error))
    }
    try {
      const controller = service('sessionController')
      if (controller !== undefined && controller !== null && typeof controller.resolveAgent === 'function') {
        const result = await controller.resolveAgent(sessionId)
        if (result !== undefined && result !== null) {
          if (result.agent !== undefined) return result.agent
          if (result.error !== undefined) return undefined
          if (typeof result.send === 'function') return result
        }
      }
    } catch (error) {
      logWarn('[peak-hours] could not resolve session %s: %s', sessionId, messageOf(error))
    }
    return undefined
  }

  /**
   * Deliver every queued prompt of one session back into its `next-turn` inbox
   * and account the paused time. Entries survive a delivery failure.
   */
  async function wakeSession(sessionId) {
    const id = String(sessionId)
    clearWakeTimer(id)
    let entries
    try {
      entries = store.deferredFor(id)
    } catch (error) {
      logWarn('[peak-hours] could not read the deferred queue of session %s: %s', id, messageOf(error))
      return 0
    }
    if (!Array.isArray(entries) || entries.length === 0) return 0
    const agent = await resolveAgentFor(id)
    if (agent === undefined || agent === null) {
      logWarn('[peak-hours] session %s is not live; keeping %d prompt(s) queued', id, entries.length)
      return 0
    }
    let taken
    try {
      taken = store.takeDeferred(id)
    } catch (error) {
      logWarn('[peak-hours] could not claim the deferred queue of session %s: %s', id, messageOf(error))
      return 0
    }
    if (!Array.isArray(taken) || taken.length === 0) return 0
    let delivered = 0
    let pausedSeconds = 0
    const failed = []
    for (const entry of taken) {
      try {
        agent.send(entry.message, 'next-turn', true)
        delivered += 1
        const since = Date.parse(entry.since)
        if (Number.isFinite(since)) pausedSeconds += Math.max(0, (currentNow().getTime() - since) / 1000)
      } catch (error) {
        failed.push(entry)
        logWarn('[peak-hours] could not deliver a deferred prompt to session %s: %s', id, messageOf(error))
      }
    }
    for (const entry of failed) {
      try {
        store.addDeferred(id, entry.message, entry.until, entry.id)
      } catch (error) {
        logWarn('[peak-hours] could not re-queue a prompt of session %s: %s', id, messageOf(error))
      }
    }
    if (delivered > 0) {
      notePausedSeconds(Math.round(pausedSeconds))
      logInfo('[peak-hours] delivered %d deferred prompt(s) to session %s', delivered, id)
    }
    if (failed.length > 0) armWake(id, new Date(currentNow().getTime() + DELIVERY_RETRY_MS))
    return delivered
  }

  /** Fire-and-forget wake that can never produce an unhandled rejection. */
  function safeWakeSession(sessionId) {
    void wakeSession(sessionId).catch((error) => {
      logWarn('[peak-hours] deferred delivery for session %s failed: %s', String(sessionId), messageOf(error))
    })
  }

  /** Wake every queued session whose earliest release instant is at or before `at`. */
  async function deliverDue(at = currentNow()) {
    const instant = at instanceof Date ? at : new Date(at)
    let summary
    try {
      summary = store.deferredSummary()
    } catch (error) {
      logWarn('[peak-hours] could not read the deferred summary: %s', messageOf(error))
      return 0
    }
    let delivered = 0
    for (const sessionId of Object.keys(summary ?? {})) {
      let entries
      try {
        entries = store.deferredFor(sessionId)
      } catch {
        continue
      }
      if (!Array.isArray(entries) || entries.length === 0) continue
      const until = earliestUntil(entries)
      if (until === null || until.getTime() <= instant.getTime()) {
        try {
          delivered += await wakeSession(sessionId)
        } catch (error) {
          logWarn('[peak-hours] deferred delivery for session %s failed: %s', sessionId, messageOf(error))
        }
        continue
      }
      armWake(sessionId, until)
    }
    return delivered
  }

  // ── the pre-step waterfall listener ───────────────────────────────────────

  function noteHoldEnded(held) {
    const elapsed = Math.max(0, (currentNow().getTime() - held.since.getTime()) / 1000)
    notePausedSeconds(elapsed)
  }

  async function pauseDecision(payload, proceed) {
    const { agent, messages, turn, signal, modelSelection } = payload ?? {}
    if (agent === null || agent === undefined) return proceed()
    const resolved = safeResolved()
    if (!isPausing(resolved)) return proceed()
    const provider = typeof modelSelection?.provider === 'string' ? modelSelection.provider : ''
    if (provider === '') return proceed()
    const model = typeof modelSelection?.model === 'string' ? modelSelection.model : undefined
    const sessionId = String(agent.id)
    const claimed = Array.isArray(messages) ? messages : []

    let overview = overviewFor(provider, model, currentNow(), resolved.schedules)
    if (!overview.known || !overview.inPeak) return proceed()
    if (effectiveMode(resolved, overview) !== 'pause') return proceed()
    markTurn(sessionId, turn, { peak: true })
    if (allowStatus(resolved, sessionId).allow) return proceed()

    for (let iteration = 0; iteration < MAX_PAUSE_ITERATIONS; iteration += 1) {
      if (signal?.aborted === true) return restoreAndProceed(agent, claimed, proceed)
      const current = safeResolved()
      if (!isPausing(current)) return proceed()
      overview = overviewFor(provider, model, currentNow(), current.schedules)
      if (!overview.known || !overview.inPeak) return proceed()
      if (effectiveMode(current, overview) !== 'pause') return proceed()
      if (allowStatus(current, sessionId).allow) return proceed()
      const until = overview.untilAt instanceof Date ? overview.untilAt : null
      const remainingMs = until === null ? 0 : until.getTime() - currentNow().getTime()
      if (remainingMs <= 0) return proceed()
      if (checkpointEnabled(current)) await checkpoint(agent)
      if (signal?.aborted === true) return restoreAndProceed(agent, claimed, proceed)
      noteHeldStep()
      markTurn(sessionId, turn, { peak: true, paused: true })
      if (chooseStrategy(current, agent, remainingMs) === 'requeue') {
        const rejected = requeue(agent, sessionId, claimed, until)
        if (rejected !== null) return rejected
        return proceed()
      }
      const held = await holdSession(sessionId, until, signal)
      if (held.reason === 'aborted' || held.reason === 'dispose') {
        return restoreAndProceed(agent, claimed, proceed)
      }
      noteHoldEnded(held)
      if (held.reason === 'resume') {
        logInfo('[peak-hours] session %s resumed during peak hours on user request', sessionId)
        return proceed()
      }
      // 'released' / 'timeout': the window may have ended or the allow flag may
      // have flipped, so re-evaluate from the top of the loop.
    }
    // Re-check budget exhausted: fail open rather than hang the turn forever.
    logWarn('[peak-hours] pause loop budget exhausted for session %s; letting the step through', sessionId)
    return proceed()
  }

  async function onPreStep(payload, next) {
    let nextIssued = false
    const proceed = () => {
      nextIssued = true
      return next()
    }
    try {
      return await pauseDecision(payload, proceed)
    } catch (error) {
      if (nextIssued) throw error
      if (payload?.signal?.aborted === true) return restoreAndProceed(payload?.agent, payload?.messages, proceed)
      logWarn('[peak-hours] pause gate failed, letting the step through: %s', messageOf(error))
      try {
        return await next()
      } catch (nextError) {
        throw nextError
      }
    }
  }

  // ── reactions to configuration / model changes ────────────────────────────

  function onSessionEvent(session, event) {
    try {
      if (event === null || typeof event !== 'object') return
      if (event.type !== 'model/selection') return
      const sessionId = session?.id
      if (sessionId === undefined || sessionId === null) return
      releaseHold(String(sessionId), 'released')
    } catch (error) {
      logWarn('[peak-hours] session/event handler failed: %s', messageOf(error))
    }
  }

  /**
   * An allow override changed. Resolve the hold so the listener re-evaluates
   * `allowFor()`; deliver the queued prompts of a session that is now allowed.
   */
  function noteAllowChanged(sessionId) {
    const resolved = safeResolved()
    if (sessionId !== undefined && sessionId !== null) {
      const id = String(sessionId)
      releaseHold(id, 'released')
      releaseDescendantHolds(id, 'released')
      try {
        if (store.deferredFor(id).length > 0 && allowStatus(resolved, id).allow) safeWakeSession(id)
      } catch {
        // The queue may have been cleared concurrently; nothing to deliver.
      }
      return
    }
    releaseAllHolds('released')
    let summary = {}
    try {
      summary = store.deferredSummary()
    } catch (error) {
      logWarn('[peak-hours] could not read deferred sessions: %s', messageOf(error))
      return
    }
    for (const id of Object.keys(summary ?? {})) {
      try {
        if (allowStatus(resolved, id).allow) safeWakeSession(id)
      } catch (error) {
        logWarn('[peak-hours] could not deliver queued prompts of session %s: %s', id, messageOf(error))
      }
    }
  }

  /** Effective config / state changed: re-evaluate holds and re-arm wake timers. */
  function onConfigChanged() {
    const resolved = safeResolved()
    releaseAllHolds('released')
    let summary = {}
    try {
      summary = store.deferredSummary()
    } catch (error) {
      logWarn('[peak-hours] could not read deferred sessions: %s', messageOf(error))
    }
    for (const [id, count] of Object.entries(summary ?? {})) {
      if (!(count > 0)) continue
      let allowed = false
      try {
        allowed = allowStatus(resolved, id).allow
      } catch {
        allowed = false
      }
      if (allowed) {
        safeWakeSession(id)
        continue
      }
      let entries = []
      try {
        entries = store.deferredFor(id)
      } catch {
        continue
      }
      const until = earliestUntil(entries)
      if (until !== null) armWake(id, until)
    }
    for (const id of [...wakeTimers.keys()]) {
      if (!(id in (summary ?? {}))) clearWakeTimer(id)
    }
  }

  // ── explicit user actions ─────────────────────────────────────────────────

  /** Resume-now: release the held step and deliver its queued prompts immediately. */
  async function releaseNow(sessionId) {
    const id = String(sessionId)
    clearWakeTimer(id)
    const hadHold = releaseHold(id, 'resume')
    releaseDescendantHolds(id, 'released')
    let delivered = 0
    try {
      const queued = store.deferredFor(id)
      if (Array.isArray(queued) && queued.length > 0) delivered = await wakeSession(id)
    } catch (error) {
      logWarn('[peak-hours] could not deliver queued prompts of session %s: %s', id, messageOf(error))
    }
    if (hadHold) logInfo('[peak-hours] released the paused step of session %s on user request', id)
    return { delivered }
  }

  /** Drop the queued prompts of one session without delivering anything. */
  function cancelDeferred(sessionId) {
    const id = String(sessionId)
    clearWakeTimer(id)
    let removed = 0
    try {
      removed = store.deferredFor(id).length
      if (removed > 0) store.clearDeferred(id)
    } catch (error) {
      logWarn('[peak-hours] could not clear the deferred queue of session %s: %s', id, messageOf(error))
    }
    return removed
  }

  // ── view snapshots for the RPC channel ────────────────────────────────────

  function deferredMap() {
    try {
      return { ...(store.deferredSummary() ?? {}) }
    } catch {
      return {}
    }
  }

  function pausedMap() {
    const out = {}
    for (const hold of holds.values()) {
      out[hold.sessionId] = {
        kind: 'hold',
        until: hold.until instanceof Date ? hold.until.toISOString() : null,
      }
    }
    for (const sessionId of Object.keys(deferredMap())) {
      if (out[sessionId] !== undefined) continue
      let entries = []
      try {
        entries = store.deferredFor(sessionId)
      } catch {
        entries = []
      }
      const until = earliestUntil(entries)
      out[sessionId] = { kind: 'queued', until: until === null ? null : until.toISOString() }
    }
    return out
  }

  function sessionView(sessionId) {
    const id = String(sessionId)
    const hold = holds.get(id)
    let entries = []
    let marks = { peakTurns: [], pausedTurns: [] }
    try {
      entries = store.deferredFor(id) ?? []
    } catch {
      entries = []
    }
    try {
      marks = store.marksFor(id) ?? marks
    } catch {
      marks = { peakTurns: [], pausedTurns: [] }
    }
    const queued = Array.isArray(entries) ? entries.length : 0
    return {
      paused: hold !== undefined || queued > 0,
      pauseKind: hold !== undefined ? 'hold' : queued > 0 ? 'queued' : null,
      since: hold !== undefined ? hold.since : earliestSince(entries),
      until: hold !== undefined ? hold.until : earliestUntil(entries),
      deferredCount: queued,
      peakTurns: [...(marks?.peakTurns ?? [])],
      pausedTurns: [...(marks?.pausedTurns ?? [])],
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  function start() {
    if (started || disposed) return
    started = true
    try {
      disposers.push(ctx.on('agent/pre-step', onPreStep, { prepend: true }))
    } catch (error) {
      logWarn('[peak-hours] could not register the pre-step pause listener: %s', messageOf(error))
    }
    try {
      disposers.push(ctx.on('session/event', onSessionEvent))
    } catch (error) {
      logWarn('[peak-hours] could not register the session/event listener: %s', messageOf(error))
    }
    // Recover a queue that came due while the host was down.
    void deliverDue().catch((error) => {
      logWarn('[peak-hours] boot delivery of deferred prompts failed: %s', messageOf(error))
    })
  }

  function dispose() {
    if (disposed) return
    disposed = true
    for (const hold of [...holds.values()]) {
      try {
        hold.finish('dispose')
      } catch {
        // Waiter already gone.
      }
    }
    holds.clear()
    for (const id of [...wakeTimers.keys()]) clearWakeTimer(id)
    while (disposers.length > 0) {
      const disposer = disposers.pop()
      if (typeof disposer !== 'function') continue
      try {
        disposer()
      } catch (error) {
        logWarn('[peak-hours] could not remove a pause listener: %s', messageOf(error))
      }
    }
    started = false
  }

  return {
    start,
    dispose,
    sessionView,
    pausedMap,
    deferredMap,
    releaseNow,
    cancelDeferred,
    noteAllowChanged,
    onConfigChanged,
    deliverDue,
  }
}

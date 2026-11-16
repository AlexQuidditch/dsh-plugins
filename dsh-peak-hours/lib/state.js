/**
 * Durable plugin state under `$DSH_HOME/peak-hours.json` — no cordis imports.
 *
 * The file is the plugin's user-facing memory: per-session "allow peak work"
 * overrides, user-edited schedule overrides, settings, daily allowance, the
 * deferred-message queue and the savings counters. It migrates the legacy
 * `{ allowPeak }` file written by the first generation of the plugin, is
 * written atomically, and never throws into the plugin: a corrupt file starts a
 * fresh state and reports the reason.
 *
 * All clock reads go through the injected `now()` so tests can pin time.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const STATE_VERSION = 1

/** The largest number of deferred messages kept for one session. */
const DEFERRED_PER_SESSION_LIMIT = 20
/** Deferred messages older than this are dropped as stale. */
const DEFERRED_MAX_AGE_DAYS = 7
/** Recent turn marks kept for one session (transcript markers). */
const TURN_MARKS_LIMIT = 60
/** Stats counters are additive estimates; guard against overflow. */
const STATS_CEILING = 1e12

function emptyState() {
  return {
    version: STATE_VERSION,
    allowPeak: false,
    sessions: {},
    schedules: null,
    settings: {},
    stats: emptyStats(),
    limit: { day: null, seconds: 0 },
    deferred: {},
    marks: {},
    updatedAt: new Date(0).toISOString(),
  }
}

function emptyStats() {
  return {
    day: null,
    pausedSeconds: 0,
    heldSteps: 0,
    deferredMessages: 0,
    peakCalls: 0,
    peakTokens: 0,
    allowedPeakSeconds: 0,
    movedTokensEstimate: 0,
    lastAvgTokens: 0,
  }
}

function clampCounter(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.min(STATS_CEILING, Math.round(number))
}

/** Local calendar day key, e.g. `2026-11-11`. */
export function localDayKey(now) {
  const date = now ?? new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/**
 * Create the state store for one plugin instance.
 *
 * @param {object} options
 * @param {string} options.file - absolute JSON file path.
 * @param {{ warn: Function, info?: Function }} options.logger - cordis logger.
 * @param {() => Date} [options.now] - clock injection for tests.
 */
export function createStateStore({ file, logger, now = () => new Date() }) {
  const listeners = new Set()
  let state = load()
  let saveTimer = null
  let saveErrorReported = false

  function notify() {
    for (const listener of listeners) {
      try {
        listener(state)
      } catch (error) {
        logger.warn('[peak-hours] state listener failed: %s', error instanceof Error ? error.message : String(error))
      }
    }
  }

  function load() {
    let raw
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      return emptyState()
    }
    try {
      const parsed = JSON.parse(raw)
      return migrate(parsed)
    } catch (error) {
      logger.warn('[peak-hours] state file is not valid JSON (%s); starting fresh', error instanceof Error ? error.message : String(error))
      return emptyState()
    }
  }

  function migrate(parsed) {
    const next = emptyState()
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return next
    next.allowPeak = parsed.allowPeak === true
    next.updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : next.updatedAt
    if (parsed.version !== STATE_VERSION) {
      // Legacy generation wrote `{ allowPeak, updatedAt }` only.
      return next
    }
    if (parsed.sessions !== null && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions)) {
      for (const [sessionId, entry] of Object.entries(parsed.sessions)) {
        if (entry === null || typeof entry !== 'object') continue
        if (typeof entry.allowPeak !== 'boolean') continue
        next.sessions[sessionId] = {
          allowPeak: entry.allowPeak,
          until: typeof entry.until === 'string' ? entry.until : null,
        }
      }
    }
    if (parsed.schedules === null) {
      next.schedules = null
    } else if (parsed.schedules !== undefined && typeof parsed.schedules === 'object' && !Array.isArray(parsed.schedules)) {
      next.schedules = clone(parsed.schedules)
    }
    if (parsed.settings !== null && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings)) {
      next.settings = clone(parsed.settings)
    }
    if (parsed.stats !== null && typeof parsed.stats === 'object') {
      next.stats = { ...emptyStats(), ...parsed.stats }
    }
    if (parsed.limit !== null && typeof parsed.limit === 'object') {
      next.limit = {
        day: typeof parsed.limit.day === 'string' ? parsed.limit.day : null,
        seconds: clampCounter(parsed.limit.seconds),
      }
    }
    if (parsed.deferred !== null && typeof parsed.deferred === 'object' && !Array.isArray(parsed.deferred)) {
      for (const [sessionId, entries] of Object.entries(parsed.deferred)) {
        if (!Array.isArray(entries)) continue
        const kept = entries.filter((entry) => entry !== null
          && typeof entry === 'object'
          && typeof entry.id === 'string'
          && entry.message !== undefined
          && typeof entry.since === 'string')
        if (kept.length > 0) next.deferred[sessionId] = kept.slice(-DEFERRED_PER_SESSION_LIMIT)
      }
    }
    if (parsed.marks !== null && typeof parsed.marks === 'object' && !Array.isArray(parsed.marks)) {
      for (const [sessionId, marks] of Object.entries(parsed.marks)) {
        if (marks === null || typeof marks !== 'object') continue
        const peakTurns = Array.isArray(marks.peakTurns) ? marks.peakTurns.filter((turn) => Number.isInteger(turn)) : []
        const pausedTurns = Array.isArray(marks.pausedTurns) ? marks.pausedTurns.filter((turn) => Number.isInteger(turn)) : []
        if (peakTurns.length > 0 || pausedTurns.length > 0) {
          next.marks[sessionId] = {
            peakTurns: peakTurns.slice(-TURN_MARKS_LIMIT),
            pausedTurns: pausedTurns.slice(-TURN_MARKS_LIMIT),
          }
        }
      }
    }
    return next
  }

  function writeNow() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    try {
      mkdirSync(dirname(file), { recursive: true })
      state.updatedAt = now().toISOString()
      const temporary = `${file}.tmp`
      writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`)
      renameSync(temporary, file)
      saveErrorReported = false
    } catch (error) {
      if (!saveErrorReported) {
        saveErrorReported = true
        logger.warn('[peak-hours] could not persist state to %s: %s', file, error instanceof Error ? error.message : String(error))
      }
    }
  }

  /** Persist within a short debounce window (bursty counters). */
  function saveSoon() {
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      writeNow()
    }, 400)
    if (typeof saveTimer.unref === 'function') saveTimer.unref()
  }

  /** Apply a mutation, persist immediately and notify listeners. */
  function update(mutate) {
    mutate(state)
    writeNow()
    notify()
    return state
  }

  /** Apply a mutation, persist with the debounce, notify listeners. */
  function updateLazy(mutate) {
    mutate(state)
    saveSoon()
    notify()
    return state
  }

  function onChange(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  // ── allow overrides ────────────────────────────────────────────────────────

  function defaultAllowPeak() {
    return state.settings.allowPeakDefault === true || state.allowPeak === true
  }

  /** Live per-session override, expired entries are cleaned lazily. */
  function sessionAllow(sessionId) {
    if (typeof sessionId !== 'string') return undefined
    const entry = state.sessions[sessionId]
    if (entry === undefined) return undefined
    if (entry.until !== null && Date.parse(entry.until) <= now().getTime()) {
      delete state.sessions[sessionId]
      saveSoon()
      return undefined
    }
    return entry
  }

  function setSessionAllow(sessionId, allowPeak, until = null) {
    update((draft) => {
      draft.sessions[sessionId] = {
        allowPeak: allowPeak === true,
        until: typeof until === 'string' ? until : null,
      }
    })
  }

  function clearSessionAllow(sessionId) {
    update((draft) => {
      delete draft.sessions[sessionId]
    })
  }

  // ── settings and schedule overrides ────────────────────────────────────────

  function settings() {
    return state.settings ?? {}
  }

  function updateSettings(patch) {
    update((draft) => {
      draft.settings = { ...draft.settings, ...(patch ?? {}) }
      for (const key of Object.keys(draft.settings)) {
        if (draft.settings[key] === undefined) delete draft.settings[key]
      }
    })
  }

  function schedulesOverride() {
    return state.schedules ?? null
  }

  function setSchedulesOverride(schedules) {
    update((draft) => {
      draft.schedules = schedules === null || schedules === undefined ? null : clone(schedules)
    })
  }

  // ── stats and daily allowance ──────────────────────────────────────────────

  function stats() {
    return state.stats
  }

  function bumpStats(patch) {
    const day = localDayKey(now())
    if (state.stats.day !== day) {
      // Account for the caller's previous-day values before rolling over: the
      // caller may be reporting an action that straddled midnight; counting it
      // in the new day is the least surprising choice.
      state.stats = { ...emptyStats(), day }
    }
    updateLazy((draft) => {
      for (const [key, value] of Object.entries(patch ?? {})) {
        if (key === 'day') continue
        draft.stats[key] = clampCounter((draft.stats[key] ?? 0) + Number(value))
      }
      draft.stats.day = day
    })
  }

  function resetStats() {
    update((draft) => {
      draft.stats = { ...emptyStats(), day: localDayKey(now()) }
    })
  }

  function limitSecondsToday() {
    const day = localDayKey(now())
    if (state.limit.day !== day) {
      state.limit = { day, seconds: 0 }
      saveSoon()
    }
    return state.limit.seconds
  }

  function addAllowedSeconds(seconds) {
    const amount = Number(seconds)
    if (!Number.isFinite(amount) || amount <= 0) return 0
    const day = localDayKey(now())
    updateLazy((draft) => {
      if (draft.limit.day !== day) draft.limit = { day, seconds: 0 }
      draft.limit.seconds = clampCounter(draft.limit.seconds + amount)
    })
    return state.limit.seconds
  }

  function limitExhausted(dailyLimitMinutes) {
    if (typeof dailyLimitMinutes !== 'number' || !(dailyLimitMinutes > 0)) return false
    return limitSecondsToday() >= dailyLimitMinutes * 60
  }

  // ── deferred messages (paused prompts awaiting the peak end) ───────────────

  function pruneDeferred() {
    const cutoff = now().getTime() - DEFERRED_MAX_AGE_DAYS * 86_400_000
    let changed = false
    for (const [sessionId, entries] of Object.entries(state.deferred)) {
      const kept = entries.filter((entry) => {
        const since = Date.parse(entry.since)
        return Number.isFinite(since) && since >= cutoff
      })
      if (kept.length !== entries.length) changed = true
      if (kept.length === 0) delete state.deferred[sessionId]
      else state.deferred[sessionId] = kept
    }
    if (changed) saveSoon()
  }

  /** Deferred messages of one session, oldest first. */
  function deferredFor(sessionId) {
    pruneDeferred()
    return state.deferred[sessionId] ?? []
  }

  /** Every session's deferred count. */
  function deferredSummary() {
    pruneDeferred()
    const summary = {}
    for (const [sessionId, entries] of Object.entries(state.deferred)) {
      if (entries.length > 0) summary[sessionId] = entries.length
    }
    return summary
  }

  /**
   * Queue one claimed message for later delivery.
   *
   * @param {string} sessionId
   * @param {object} message - the claimed UserMessage, stored verbatim.
   * @param {string} until - ISO instant of the planned release.
   * @param {string} [id] - stable identity for the queue entry.
   */
  function addDeferred(sessionId, message, until, id = `d-${now().getTime()}-${Math.random().toString(36).slice(2, 8)}`) {
    return update((draft) => {
      const entries = draft.deferred[sessionId] ?? []
      entries.push({ id, since: now().toISOString(), until, message: clone(message) })
      draft.deferred[sessionId] = entries.slice(-DEFERRED_PER_SESSION_LIMIT)
    })
  }

  /** Remove and return every deferred message of one session (oldest first). */
  function takeDeferred(sessionId) {
    const entries = deferredFor(sessionId)
    if (entries.length === 0) return []
    update((draft) => {
      delete draft.deferred[sessionId]
    })
    return entries
  }

  function removeDeferred(sessionId, id) {
    update((draft) => {
      const entries = draft.deferred[sessionId] ?? []
      draft.deferred[sessionId] = entries.filter((entry) => entry.id !== id)
      if (draft.deferred[sessionId].length === 0) delete draft.deferred[sessionId]
    })
  }

  function clearDeferred(sessionId) {
    update((draft) => {
      delete draft.deferred[sessionId]
    })
  }

  // ── turn marks (transcript markers) ────────────────────────────────────────

  /** Recent peak/paused turn numbers of one session. */
  function marksFor(sessionId) {
    return state.marks[sessionId] ?? { peakTurns: [], pausedTurns: [] }
  }

  /** Mark one turn as peak-priced and/or paused. Idempotent per turn. */
  function markTurn(sessionId, turn, { peak = false, paused = false } = {}) {
    if (!Number.isInteger(turn) || turn <= 0) return
    const current = marksFor(sessionId)
    const peakTurns = peak && !current.peakTurns.includes(turn) ? [...current.peakTurns, turn].slice(-TURN_MARKS_LIMIT) : current.peakTurns
    const pausedTurns = paused && !current.pausedTurns.includes(turn) ? [...current.pausedTurns, turn].slice(-TURN_MARKS_LIMIT) : current.pausedTurns
    if (peakTurns === current.peakTurns && pausedTurns === current.pausedTurns) return
    updateLazy((draft) => {
      draft.marks[sessionId] = { peakTurns, pausedTurns }
    })
  }

  function resetMarks(sessionId) {
    update((draft) => {
      delete draft.marks[sessionId]
    })
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  function flush() {
    if (saveTimer !== null) writeNow()
    else writeNow()
    pruneDeferred()
  }

  function dispose() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    writeNow()
    listeners.clear()
  }

  return {
    file,
    get: () => state,
    onChange,
    update,
    updateLazy,
    flush,
    dispose,
    defaultAllowPeak,
    sessionAllow,
    setSessionAllow,
    clearSessionAllow,
    settings,
    updateSettings,
    schedulesOverride,
    setSchedulesOverride,
    stats,
    bumpStats,
    resetStats,
    limitSecondsToday,
    addAllowedSeconds,
    limitExhausted,
    deferredFor,
    deferredSummary,
    addDeferred,
    takeDeferred,
    removeDeferred,
    clearDeferred,
    marksFor,
    markTurn,
    resetMarks,
  }
}

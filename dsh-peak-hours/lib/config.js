/**
 * Plugin configuration resolution — no cordis imports.
 *
 * Bundle config (`cordis.patch.yml`) supplies deployment defaults; the state
 * file supplies user edits (settings page). `resolveConfig` merges both into
 * one frozen-shaped object that the pause gate, the LLM gate, the schedule
 * engine, the defer service, the tool and the Web UI all read from one place.
 *
 * Backward compatibility: the first generation spoke `mode: soft|hard`; `soft`
 * now normalizes to `warn` (log only) and `pause` is the new default.
 */
import { DEFAULT_OFF_PEAK_DISCOUNT, normalizeSchedules } from './schedule.js'

/** Gate behaviors. `pause` suspends steps, `hard` rejects calls, `warn` logs. */
export const MODES = ['pause', 'hard', 'warn']
export const PAUSE_STRATEGIES = ['auto', 'hold', 'requeue']
export const BACKGROUND_POLICIES = ['allow', 'warn', 'block']

const MINUTE = 60_000

function pick(settings, bundle, key, fallback) {
  if (settings[key] !== undefined && settings[key] !== null) return settings[key]
  if (bundle[key] !== undefined && bundle[key] !== null) return bundle[key]
  return fallback
}

function number(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function nullableNumber(value, { min = 0, max = Infinity } = {}) {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < min) return null
  return Math.min(max, parsed)
}

/** Normalize a legacy or current mode string. */
export function normalizeMode(mode) {
  if (mode === 'soft') return 'warn'
  if (mode === 'hard') return 'hard'
  if (mode === 'warn') return 'warn'
  if (mode === 'pause') return 'pause'
  return 'pause'
}

/**
 * Merge deployment config with user state into the effective configuration.
 *
 * @param {object} bundleConfig - config from `cordis.patch.yml`.
 * @param {object} store - state store from `./state.js`.
 * @returns {object} effective configuration (new object per call).
 */
export function resolveConfig(bundleConfig = {}, store) {
  const bundle = bundleConfig ?? {}
  const settings = store?.settings?.() ?? {}
  const schedulesSource = store?.schedulesOverride?.() ?? null
  const rawSchedules = schedulesSource ?? bundle.schedules ?? {}
  const { schedules, warnings } = normalizeSchedules(rawSchedules)
  const pauseRaw = bundle.pause !== null && typeof bundle.pause === 'object' ? bundle.pause : {}
  const strategy = pick(settings, pauseRaw, 'strategy', 'auto')
  const backgroundPolicy = pick(settings, bundle, 'backgroundPolicy', 'allow')
  return {
    enabled: bundle.enabled !== false,
    mode: normalizeMode(pick(settings, bundle, 'mode', 'pause')),
    pause: {
      strategy: PAUSE_STRATEGIES.includes(strategy) ? strategy : 'auto',
      maxHoldMinutes: number(pick(settings, pauseRaw, 'maxHoldMinutes', pick(settings, bundle, 'maxHoldMinutes', 20)), 20, { min: 1, max: 24 * 60 }),
      checkpoint: pick(settings, pauseRaw, 'checkpoint', pick(settings, bundle, 'checkpoint', true)) !== false,
    },
    allowPeakDefault: pick(settings, bundle, 'allowPeakDefault', bundle.allowPeak === true) === true,
    dailyLimitMinutes: nullableNumber(
      Object.prototype.hasOwnProperty.call(settings, 'dailyLimitMinutes')
        ? settings.dailyLimitMinutes
        : bundle.dailyLimitMinutes,
      { min: 0, max: 24 * 60 },
    ),
    prePeakWarningMinutes: number(pick(settings, bundle, 'prePeakWarningMinutes', 10), 10, { min: 0, max: 180 }),
    backgroundPolicy: BACKGROUND_POLICIES.includes(backgroundPolicy) ? backgroundPolicy : 'allow',
    defer: {
      marginSeconds: number(pick(settings, bundle, 'deferMarginSeconds', 1), 1, { min: 0, max: 300 }),
    },
    notify: {
      beforePeak: pick(settings, bundle, 'notifyBeforePeak', true) !== false,
    },
    statsEnabled: pick(settings, bundle, 'statsEnabled', true) !== false,
    schedules,
    scheduleWarnings: warnings,
    schedulesSource: schedulesSource === null ? 'bundle' : 'user',
    offPeakDiscount: effectiveDiscount(schedules),
  }
}

/** Conservative display discount: the smallest declared one, default 50%. */
function effectiveDiscount(schedules) {
  let best = null
  for (const entry of Object.values(schedules ?? {})) {
    const values = [entry.offPeakDiscount]
    for (const rule of Object.values(entry.models ?? {})) values.push(rule.offPeakDiscount)
    for (const value of values) {
      if (typeof value !== 'number') continue
      if (best === null || value > best) best = value
    }
  }
  return best === null ? DEFAULT_OFF_PEAK_DISCOUNT : best
}

/**
 * The effective "allow work in peak hours" answer for one session.
 *
 * Resolution order: daily allowance exhausted → hard no; the session's own
 * override; the nearest ancestor's override (a subagent child inherits the
 * parent's choice, so allowing a parent never leaves its children paused);
 * otherwise the deployment/user default. `until` carries the temporary
 * override expiry, when the caller set one.
 *
 * @param {string[]} [ancestors] - direct ancestors, nearest first
 *   (`ancestorsOf()` from `./session-tree.js`).
 */
export function allowFor(resolved, store, sessionId, ancestors = []) {
  if (!resolved.enabled) return { allow: true, source: 'disabled', until: null }
  if (store.limitExhausted(resolved.dailyLimitMinutes)) {
    return { allow: false, source: 'limit', until: null }
  }
  const entry = typeof sessionId === 'string' ? store.sessionAllow(sessionId) : undefined
  if (entry !== undefined) {
    return {
      allow: entry.allowPeak === true,
      source: 'session',
      until: entry.until === null ? null : new Date(entry.until),
    }
  }
  for (const ancestor of Array.isArray(ancestors) ? ancestors : []) {
    if (typeof ancestor !== 'string' || ancestor === '') continue
    const inherited = store.sessionAllow(ancestor)
    if (inherited === undefined) continue
    return {
      allow: inherited.allowPeak === true,
      source: 'inherited',
      until: inherited.until === null ? null : new Date(inherited.until),
    }
  }
  return { allow: resolved.allowPeakDefault === true, source: 'default', until: null }
}

/** Milliseconds until a wall-clock HH:MM tomorrow-or-today in local time. */
export function minutesUntilLocal(hour, minute, now = new Date()) {
  const target = new Date(now)
  target.setHours(hour, minute, 0, 0)
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1)
  return Math.round((target.getTime() - now.getTime()) / MINUTE)
}

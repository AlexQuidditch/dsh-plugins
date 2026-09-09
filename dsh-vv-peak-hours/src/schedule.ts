/**
 * Pure peak-hour schedule engine — no cordis, no IO.
 *
 * Windows are HH:MM ranges in an explicit timezone (default UTC), may cross
 * midnight, and may be restricted to weekdays (0=Sunday..6=Saturday). Matching
 * is against PROVIDERS, not models, and every malformed entry fails open:
 * a broken window is reported and skipped, never a block.
 */

/** One peak window in a provider schedule. */
export interface PeakWindow {
  start: string
  end: string
  /** IANA or fixed-offset timezone; default 'UTC'. */
  tz?: string
  /** Weekday restriction, 0=Sunday..6=Saturday; default all days. */
  days?: number[]
}

/** One provider's schedule. */
export interface ProviderSchedule {
  windows: PeakWindow[]
  /** Provider-level mode override. */
  mode?: 'soft' | 'hard'
}

/** The whole schedules map from bundle config. */
export type PeakSchedules = Record<string, ProviderSchedule>

/** The resolved answer for one provider at one instant. */
export interface PeakDecision {
  /** Whether the provider is inside a peak window right now. */
  inPeak: boolean
  /** HH:MM (UTC) of the window end when in peak. */
  until?: string
  /** Malformed windows skipped while resolving (fail-open). */
  broken: string[]
}

/** A window resolved into week-absolute minute bounds. */
interface ResolvedWindow {
  startAbs: number
  endAbs: number
  days: Set<number> | null
  untilLabel: string
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const DAY_MINUTES = 1440

function minutesOf(time: string): number {
  const match = HHMM_RE.exec(time)
  if (match === null) throw new Error(`invalid HH:MM time "${time}"`)
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Offset a UTC instant into a named timezone and give week-aligned minutes.
 *
 * Uses the platform Intl API: the local wall-clock of `now` is computed by
 * formatting each calendar field in the target timezone, which keeps the
 * engine dependency-free while honouring real DST transitions.
 */
function wallClockParts(now: Date, tz: string): { weekday: number; hour: number; minute: number } {
  const format = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  const parts: Record<string, string> = {}
  for (const part of format.formatToParts(now)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  const weekday = ({ sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 } as Record<string, number>)[(parts.weekday ?? '').toLowerCase()]
  const hour = Number(parts.hour === '24' ? '0' : parts.hour)
  return { weekday: weekday ?? 0, hour, minute: Number(parts.minute) }
}

function resolveWindow(window: PeakWindow): ResolvedWindow {
  const start = minutesOf(window.start)
  const end = minutesOf(window.end)
  const crossesMidnight = end <= start
  const startAbs = start
  const endAbs = crossesMidnight ? end + DAY_MINUTES : end
  return {
    startAbs,
    endAbs,
    days: window.days === undefined ? null : new Set(window.days),
    untilLabel: window.end,
  }
}

/**
 * Decide whether `provider` is inside one of its configured peak windows at `now`.
 *
 * The wall clock of the provider's timezone decides day-of-week and
 * minute-of-day; windows that cross midnight also match the early-morning
 * hours of the next calendar day, and the weekday restriction always applies
 * to the evaluated instant's own day. Unknown providers and broken windows
 * are never a block.
 */
export function decidePeak(provider: string, now: Date, schedules: PeakSchedules): PeakDecision {
  const broken: string[] = []
  const schedule = schedules[provider]
  if (schedule === undefined) return { inPeak: false, broken }

  for (const window of schedule.windows) {
    let resolved: ResolvedWindow
    try {
      resolved = resolveWindow(window)
    } catch (error) {
      broken.push(`${provider} window ${window.start}-${window.end}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const tz = window.tz ?? 'UTC'
    const clock = wallClockParts(now, tz)
    const minuteOfDay = clock.hour * 60 + clock.minute
    const sameDay = minuteOfDay >= resolved.startAbs && minuteOfDay < resolved.endAbs
    const afterMidnight = minuteOfDay < resolved.endAbs - DAY_MINUTES && resolved.endAbs > DAY_MINUTES
    const inside = sameDay || afterMidnight
    if (!inside) continue
    if (resolved.days !== null && !resolved.days.has(clock.weekday)) continue
    return { inPeak: true, until: `${resolved.untilLabel} ${tz}`, broken }
  }
  return { inPeak: false, broken }
}

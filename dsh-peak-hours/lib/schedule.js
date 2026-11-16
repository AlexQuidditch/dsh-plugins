/**
 * Pure peak-hour schedule engine — no cordis, no IO, no process state beyond
 * an Intl formatter cache.
 *
 * One schedule entry describes one provider FAMILY (or one exact model of it):
 * time windows in an explicit timezone (default UTC), optionally restricted to
 * weekdays (0=Sunday..6=Saturday), optionally overridden per model id. A key
 * matches exact provider ids first, then the longest `-`-delimited prefix, so
 * `deepseek` covers `deepseek-official` while `deep` never matches it.
 *
 * Model-level rules live under an entry's `models` map: an exact model id wins,
 * `*` is the fallback rule. A model rule may replace the windows, the mode and
 * the off-peak discount; it is a full override, not a merge (an empty rule adds
 * nothing).
 *
 * Every malformed input fails open: a broken window is reported and skipped,
 * never a block. All boundary computations are derived from real instants, so
 * DST transitions and midnight-crossing windows stay honest.
 */

export const DEFAULT_OFF_PEAK_DISCOUNT = 0.5

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const DAY_MINUTES = 1440
const MINUTE_MS = 60_000
const DAY_MS = 86_400_000
const MAX_WEEK_LOOKAHEAD_DAYS = 9
const WEEKDAY_BY_NAME = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
/** Default timezone of holiday exclusion calendars (Chinese public holidays). */
export const HOLIDAY_TZ_DEFAULT = 'Asia/Shanghai'
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Cached Intl formatter per timezone; creating one per call dominates a scan. */
const formatterCache = new Map()

function formatterOf(tz) {
  let formatter = formatterCache.get(tz)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    formatterCache.set(tz, formatter)
  }
  return formatter
}

/** Whether `tz` is a timezone Intl understands. */
export function isTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length === 0) return false
  try {
    formatterOf(tz)
    return true
  } catch {
    return false
  }
}

/** Whether `date` is a real calendar date (YYYY-MM-DD). */
function isCalendarDate(date) {
  const match = DATE_RE.exec(String(date))
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const probe = new Date(Date.UTC(year, month - 1, day))
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

/**
 * Normalize one schedule entry's holiday exclusion calendar.
 *
 * Accepted shapes: an array of dates, or `{ tz, dates, ranges }` where `ranges`
 * are inclusive `[from, to]` date pairs. Holiday dates are evaluated in `tz`
 * (default Asia/Shanghai) because Chinese public holidays are declared in China
 * time; on such a date no configured peak window applies.
 */
export function normalizeHolidays(raw) {
  const warnings = []
  if (raw === undefined || raw === null) return { holidays: undefined, warnings }
  let tz = HOLIDAY_TZ_DEFAULT
  let dates = []
  let ranges = []
  if (Array.isArray(raw)) {
    dates = raw
  } else if (typeof raw === 'object') {
    if (typeof raw.tz === 'string' && raw.tz !== '') {
      if (!isTimeZone(raw.tz)) {
        warnings.push(`holidays: unknown timezone "${raw.tz}"; using ${HOLIDAY_TZ_DEFAULT}`)
      } else {
        tz = raw.tz
      }
    }
    dates = Array.isArray(raw.dates) ? raw.dates : []
    ranges = Array.isArray(raw.ranges) ? raw.ranges : []
  } else {
    warnings.push('holidays must be an array of dates or an object; ignoring it')
    return { holidays: undefined, warnings }
  }
  const normalizedRanges = []
  for (const date of dates) {
    if (!isCalendarDate(date)) {
      warnings.push(`holidays: invalid date "${date}"`)
      continue
    }
    normalizedRanges.push([date, date])
  }
  for (const range of ranges) {
    if (!Array.isArray(range) || range.length !== 2) {
      warnings.push('holidays: a range must be a [from, to] date pair')
      continue
    }
    const [from, to] = range
    if (!isCalendarDate(from) || !isCalendarDate(to)) {
      warnings.push(`holidays: invalid range "${from}".."${to}"`)
      continue
    }
    normalizedRanges.push(from <= to ? [from, to] : [to, from])
  }
  normalizedRanges.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  if (normalizedRanges.length === 0) return { holidays: undefined, warnings }
  return { holidays: { tz, ranges: normalizedRanges }, warnings }
}

/** Cached date-only formatter per holiday timezone. */
const holidayFormatterCache = new Map()

/** One instant's calendar date (YYYY-MM-DD) in the holiday calendar's timezone. */
function holidayDateOf(instant, holidays) {
  try {
    let format = holidayFormatterCache.get(holidays.tz)
    if (format === undefined) {
      format = new Intl.DateTimeFormat('en-CA', {
        timeZone: holidays.tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      holidayFormatterCache.set(holidays.tz, format)
    }
    return format.format(instant)
  } catch {
    return ''
  }
}

/** Whether `instant` falls on an excluded holiday date. */
export function isHolidayInstant(instant, holidays) {
  if (holidays === null || holidays === undefined || !Array.isArray(holidays.ranges)) return false
  const date = holidayDateOf(instant, holidays)
  if (date === '') return false
  for (const [from, to] of holidays.ranges) {
    if (date >= from && date <= to) return true
  }
  return false
}

/** Merge an entry-level holiday calendar into every window of that schedule. */
function windowsWithHolidays(windows, holidays) {
  if (holidays === undefined) return windows
  return windows.map((window) => ({ ...window, holidays }))
}

function minutesOf(time) {
  const match = HHMM_RE.exec(String(time))
  if (match === null) throw new Error(`invalid HH:MM time "${time}"`)
  return Number(match[1]) * 60 + Number(match[2])
}

/** Wall-clock parts of one instant in one timezone. */
function wallClock(now, tz) {
  const parts = {}
  for (const part of formatterOf(tz).formatToParts(now)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  const hour = Number(parts.hour === '24' ? '0' : parts.hour)
  const minute = Number(parts.minute)
  return {
    weekday: WEEKDAY_BY_NAME[(parts.weekday ?? '').toLowerCase()],
    hour,
    minute,
    minuteOfDay: hour * 60 + minute,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  }
}

/** Platform offset of `tz` at one instant, in milliseconds. */
function tzOffsetMs(tz, instant) {
  const clock = wallClock(instant, tz)
  return Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    instant.getUTCSeconds(),
    instant.getUTCMilliseconds(),
  ) - instant.getTime()
}

/** Convert one local wall-clock minute in `tz` into the corresponding instant. */
function zonedToInstant(tz, { year, month, day, hour, minute }) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  let timestamp = guess - tzOffsetMs(tz, new Date(guess))
  timestamp = guess - tzOffsetMs(tz, new Date(timestamp))
  return new Date(timestamp)
}

/** Shift a local calendar date by whole days, keeping it a local date. */
function shiftLocalDate(parts, days) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

/** Calendar weekday (0=Sunday) of a plain date. */
function weekdayOfDate({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Resolve one raw window into comparison values; throws on malformed input. */
function resolveWindow(window) {
  if (window === null || typeof window !== 'object') throw new Error('window must be an object')
  const start = minutesOf(window.start)
  const end = minutesOf(window.end)
  const tz = window.tz === undefined ? 'UTC' : window.tz
  if (!isTimeZone(tz)) throw new Error(`unknown timezone "${tz}"`)
  if (start === end) throw new Error(`zero-length window ${window.start}-${window.end} (use 00:00-23:59 for all day)`)
  const crossesMidnight = end < start
  const days = window.days === undefined
    ? null
    : new Set(window.days.map((day) => {
      const value = Number(day)
      if (!Number.isInteger(value) || value < 0 || value > 6) throw new Error(`invalid weekday "${day}"`)
      return value
    }))
  return {
    startAbs: start,
    endAbs: crossesMidnight ? end + DAY_MINUTES : end,
    startHour: Math.floor(start / 60),
    startMinute: start % 60,
    endHour: Math.floor(end / 60),
    endMinute: end % 60,
    crossesMidnight,
    days,
    tz,
    startLabel: window.start,
    endLabel: window.end,
  }
}

/**
 * Normalize the raw schedules map from plugin config or the user state file.
 *
 * Returns `{ schedules, warnings }`: invalid entries and invalid windows are
 * dropped with a human-readable warning instead of failing the plugin.
 */
export function normalizeSchedules(raw) {
  const warnings = []
  const schedules = {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) warnings.push('schedules must be an object; ignoring it')
    return { schedules, warnings }
  }
  for (const key of Object.keys(raw)) {
    const entry = raw[key]
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      warnings.push(`schedule "${key}": entry must be an object; ignoring it`)
      continue
    }
    const normalized = { windows: [] }
    const entryHolidays = normalizeHolidays(entry.holidays)
    for (const warning of entryHolidays.warnings) warnings.push(`schedule "${key}": ${warning}`)
    const windows = Array.isArray(entry.windows) ? entry.windows : []
    if (windows.length === 0 && entry.models === undefined) {
      warnings.push(`schedule "${key}": no windows; ignoring it`)
      continue
    }
    for (const window of windows) {
      try {
        const resolved = resolveWindow(window)
        normalized.windows.push({
          start: window.start,
          end: window.end,
          tz: resolved.tz,
          ...(resolved.days === null ? {} : { days: [...resolved.days].sort((a, b) => a - b) }),
        })
      } catch (error) {
        warnings.push(`schedule "${key}": ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (typeof entry.mode === 'string' && (entry.mode === 'soft' || entry.mode === 'hard' || entry.mode === 'pause' || entry.mode === 'warn')) {
      normalized.mode = entry.mode === 'soft' ? 'warn' : entry.mode
    }
    if (typeof entry.offPeakDiscount === 'number' && entry.offPeakDiscount >= 0 && entry.offPeakDiscount <= 1) {
      normalized.offPeakDiscount = entry.offPeakDiscount
    }
    if (typeof entry.label === 'string' && entry.label.trim() !== '') normalized.label = entry.label.trim()
    if (entry.models !== undefined && entry.models !== null) {
      if (typeof entry.models !== 'object' || Array.isArray(entry.models)) {
        warnings.push(`schedule "${key}": models must be an object; ignoring it`)
      } else {
        const models = {}
        for (const modelKey of Object.keys(entry.models)) {
          const rule = entry.models[modelKey]
          if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
            warnings.push(`schedule "${key}" model "${modelKey}": rule must be an object; ignoring it`)
            continue
          }
          const modelRule = {}
          const ruleHolidays = normalizeHolidays(rule.holidays)
          for (const warning of ruleHolidays.warnings) warnings.push(`schedule "${key}" model "${modelKey}": ${warning}`)
          if (rule.windows !== undefined) {
            const modelWindows = Array.isArray(rule.windows) ? rule.windows : []
            modelRule.windows = []
            for (const window of modelWindows) {
              try {
                const resolved = resolveWindow(window)
                modelRule.windows.push({
                  start: window.start,
                  end: window.end,
                  tz: resolved.tz,
                  ...(resolved.days === null ? {} : { days: [...resolved.days].sort((a, b) => a - b) }),
                })
              } catch (error) {
                warnings.push(`schedule "${key}" model "${modelKey}": ${error instanceof Error ? error.message : String(error)}`)
              }
            }
          }
          if (modelRule.windows !== undefined && ruleHolidays.holidays !== undefined) {
            modelRule.windows = windowsWithHolidays(modelRule.windows, ruleHolidays.holidays)
          } else if (modelRule.windows !== undefined && entryHolidays.holidays !== undefined) {
            modelRule.windows = windowsWithHolidays(modelRule.windows, entryHolidays.holidays)
          }
          if (typeof rule.mode === 'string' && (rule.mode === 'soft' || rule.mode === 'hard' || rule.mode === 'pause' || rule.mode === 'warn')) {
            modelRule.mode = rule.mode === 'soft' ? 'warn' : rule.mode
          }
          if (typeof rule.offPeakDiscount === 'number' && rule.offPeakDiscount >= 0 && rule.offPeakDiscount <= 1) {
            modelRule.offPeakDiscount = rule.offPeakDiscount
          }
          models[modelKey] = modelRule
        }
        if (Object.keys(models).length > 0) normalized.models = models
      }
    }
    if (normalized.windows.length === 0 && normalized.models === undefined) {
      warnings.push(`schedule "${key}": only broken windows; ignoring it`)
      continue
    }
    if (normalized.windows.length > 0 && entryHolidays.holidays !== undefined) {
      normalized.windows = windowsWithHolidays(normalized.windows, entryHolidays.holidays)
    }
    schedules[key] = normalized
  }
  return { schedules, warnings }
}

/**
 * Resolve the schedule entry for a provider id.
 *
 * An exact key wins outright. Otherwise the LONGEST key that is a
 * `-`-delimited prefix of the id matches, so `deepseek` covers
 * `deepseek-official` while a more specific `deepseek-vision` entry would cover
 * only that variant. A key never matches a provider that merely shares a prefix
 * without the separator, and an unmatched provider is not an error.
 */
export function resolveSchedule(provider, schedules) {
  if (typeof provider !== 'string' || provider === '') return undefined
  if (schedules === null || typeof schedules !== 'object') return undefined
  const exact = schedules[provider]
  if (exact !== undefined) return { key: provider, schedule: exact }
  let best
  for (const key of Object.keys(schedules)) {
    if (!provider.startsWith(`${key}-`)) continue
    if (best === undefined || key.length > best.key.length) best = { key, schedule: schedules[key] }
  }
  return best
}

/**
 * Effective windows, mode and discount for one provider+model.
 *
 * Model rules replace the family windows; an exact model id beats `*`.
 */
export function resolveEffective(provider, model, schedules) {
  const hit = resolveSchedule(provider, schedules)
  if (hit === undefined) return undefined
  const entry = hit.schedule ?? {}
  let modelKey
  let rule
  if (typeof model === 'string' && model !== '' && entry.models !== undefined && entry.models !== null) {
    if (entry.models[model] !== undefined) {
      modelKey = model
      rule = entry.models[model]
    } else if (entry.models['*'] !== undefined) {
      modelKey = '*'
      rule = entry.models['*']
    }
  }
  const windows = rule?.windows !== undefined ? rule.windows : entry.windows
  if (!Array.isArray(windows) || windows.length === 0) return undefined
  return {
    key: hit.key,
    providerSchedule: entry,
    modelKey,
    windows,
    mode: rule?.mode ?? entry.mode,
    offPeakDiscount: rule?.offPeakDiscount ?? entry.offPeakDiscount ?? DEFAULT_OFF_PEAK_DISCOUNT,
    label: entry.label ?? hit.key,
  }
}

/** Whether ONE window covers `now`. A malformed window covers nothing. */
export function windowContains(window, now) {
  let resolved
  try {
    resolved = resolveWindow(window)
  } catch {
    return false
  }
  if (window.holidays !== undefined && isHolidayInstant(now, window.holidays)) return false
  const clock = wallClock(now, resolved.tz)
  const sameDay = clock.minuteOfDay >= resolved.startAbs && clock.minuteOfDay < resolved.endAbs
  const afterMidnight = resolved.crossesMidnight && clock.minuteOfDay < resolved.endAbs - DAY_MINUTES
  if (!sameDay && !afterMidnight) return false
  return resolved.days === null || resolved.days.has(clock.weekday)
}

/** Instant at which the covering window `window` ends, relative to `now`. */
function windowEndInstant(window, now, resolved) {
  const clock = wallClock(now, resolved.tz)
  let dayOffset = 0
  if (resolved.crossesMidnight) {
    const afterMidnight = clock.minuteOfDay < resolved.endAbs - DAY_MINUTES
    dayOffset = afterMidnight ? 0 : 1
  }
  const date = shiftLocalDate(clock, dayOffset)
  let end = zonedToInstant(resolved.tz, { ...date, hour: resolved.endHour, minute: resolved.endMinute })
  if (end.getTime() <= now.getTime()) end = new Date(end.getTime() + DAY_MS)
  return end
}

/**
 * First instant after `now` at which the provider/model is no longer in peak,
 * or `null` when it is not in peak now.
 *
 * Multiple overlapping windows are handled by advancing through their ends.
 */
export function peakEndsAt(provider, model, now, schedules) {
  const effective = resolveEffective(provider, model, schedules)
  if (effective === undefined) return null
  let cursor = now
  for (let step = 0; step < 16; step += 1) {
    let next = null
    for (const window of effective.windows) {
      if (!windowContains(window, cursor)) continue
      let resolved
      try {
        resolved = resolveWindow(window)
      } catch {
        continue
      }
      const end = windowEndInstant(window, cursor, resolved)
      if (next === null || end.getTime() < next.getTime()) next = end
    }
    if (next === null) return cursor.getTime() === now.getTime() ? null : cursor
    cursor = next
    if (cursor.getTime() - now.getTime() > MAX_WEEK_LOOKAHEAD_DAYS * DAY_MS) return null
  }
  return cursor
}

/**
 * First instant after `now` at which the provider/model enters peak, or `null`
 * when its windows never open again within the week lookahead.
 */
export function nextPeakStartAt(provider, model, now, schedules) {
  const effective = resolveEffective(provider, model, schedules)
  if (effective === undefined) return null
  let best = null
  for (const window of effective.windows) {
    let resolved
    try {
      resolved = resolveWindow(window)
    } catch {
      continue
    }
    const clock = wallClock(now, resolved.tz)
    for (let day = 0; day <= MAX_WEEK_LOOKAHEAD_DAYS; day += 1) {
      const date = shiftLocalDate(clock, day)
      if (resolved.days !== null && !resolved.days.has(weekdayOfDate(date))) continue
      const start = zonedToInstant(resolved.tz, { ...date, hour: resolved.startHour, minute: resolved.startMinute })
      if (start.getTime() <= now.getTime()) continue
      if (!windowContains(window, start)) continue
      if (best === null || start.getTime() < best.getTime()) best = start
      break
    }
  }
  return best
}

/**
 * One provider/model's full view: peak now, when it ends, when the next window
 * starts, and how long until that status flips.
 */
export function overviewFor(provider, model, now, schedules) {
  const effective = resolveEffective(provider, model, schedules)
  if (effective === undefined) {
    return {
      known: false,
      inPeak: false,
      matchedKey: null,
      modelKey: null,
      untilAt: null,
      untilLabel: null,
      nextStartAt: null,
      secondsToChange: null,
    }
  }
  let untilLabel = null
  for (const window of effective.windows) {
    if (!windowContains(window, now)) continue
    untilLabel = `${window.end} ${window.tz ?? 'UTC'}`
    break
  }
  const inPeak = effective.windows.some((window) => windowContains(window, now))
  const untilAt = inPeak ? peakEndsAt(provider, model, now, schedules) : null
  const nextStartAt = inPeak ? null : nextPeakStartAt(provider, model, now, schedules)
  const boundary = untilAt ?? nextStartAt
  return {
    known: true,
    inPeak,
    matchedKey: effective.key,
    modelKey: effective.modelKey,
    offPeakDiscount: effective.offPeakDiscount,
    mode: effective.mode,
    untilAt,
    untilLabel,
    nextStartAt,
    secondsToChange: boundary === null ? null : Math.max(0, Math.round((boundary.getTime() - now.getTime()) / 1000)),
  }
}

/**
 * Decide whether `provider` is inside one of its configured peak windows at `now`.
 *
 * Backwards-compatible overload: `decidePeak(provider, now, schedules)` keeps
 * the original provider-only signature; the model-aware form is
 * `decidePeak(provider, model, now, schedules)`.
 */
export function decidePeak(provider, modelOrNow, nowOrSchedules, maybeSchedules) {
  let model
  let now
  let schedules
  if (modelOrNow instanceof Date) {
    now = modelOrNow
    schedules = nowOrSchedules ?? {}
    model = undefined
  } else {
    model = modelOrNow
    now = nowOrSchedules instanceof Date ? nowOrSchedules : new Date()
    schedules = maybeSchedules ?? {}
  }
  const broken = []
  const hit = resolveSchedule(provider, schedules)
  if (hit === undefined) return { inPeak: false, broken }
  const effective = resolveEffective(provider, model, schedules)
  if (effective === undefined) return { inPeak: false, broken, matched: hit.key }
  for (const window of effective.windows) {
    try {
      resolveWindow(window)
    } catch (error) {
      broken.push(`${hit.key} window ${window.start}-${window.end}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!windowContains(window, now)) continue
    return {
      inPeak: true,
      until: `${window.end} ${window.tz ?? 'UTC'}`,
      matched: hit.key,
      modelKey: effective.modelKey,
      broken,
    }
  }
  return { inPeak: false, broken, matched: hit.key, modelKey: effective.modelKey }
}

/** Every configured window of every entry, flattened for display. */
export function allWindows(schedules) {
  const out = []
  for (const key of Object.keys(schedules ?? {})) {
    for (const window of schedules[key].windows ?? []) out.push({ key, window })
    for (const modelKey of Object.keys(schedules[key].models ?? {})) {
      for (const window of schedules[key].models[modelKey].windows ?? []) {
        out.push({ key, modelKey, window })
      }
    }
  }
  return out
}

/** Display label of one effective window in the viewer's clock. */
export function windowLabelFor(window, locale) {
  const tz = window.tz ?? 'UTC'
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date()) + ' ' + tz
  } catch {
    return String(window.start)
  }
}

/**
 * Seconds until the next boundary (any window's start or end) after `now`.
 *
 * Computed on the window's own wall clock; a DST shift inside the countdown is
 * ignored, which is what an indicator wants (authoritative decisions stay in
 * `decidePeak` / `overviewFor`).
 */
export function secondsToNextBoundary(windows, now) {
  let best = Number.POSITIVE_INFINITY
  for (const window of windows) {
    let resolved
    try {
      resolved = resolveWindow(window)
    } catch {
      continue
    }
    const clock = wallClock(now, resolved.tz)
    const localSeconds = (clock.hour * 60 + clock.minute) * 60 + now.getUTCSeconds()
    for (const boundary of [resolved.startAbs, resolved.endAbs]) {
      for (let day = 0; day <= MAX_WEEK_LOOKAHEAD_DAYS; day += 1) {
        const delta = (day * DAY_MINUTES + boundary) * 60 - localSeconds
        if (delta <= 0 || delta >= best) continue
        if (boundary === resolved.startAbs && window.holidays !== undefined) {
          if (isHolidayInstant(new Date(now.getTime() + delta * 1000), window.holidays)) continue
        }
        best = delta
      }
    }
  }
  return Number.isFinite(best) ? best : DAY_MINUTES * 60
}

/**
 * Legacy whole-configulation view: is ANY window of ANY entry open right now,
 * and when does the status next flip. Kept for the aggregate indicator when no
 * session model is known.
 */
export function peakOverview(now, schedules) {
  const windows = []
  for (const entry of Object.values(schedules ?? {})) {
    for (const window of entry.windows ?? []) windows.push(window)
    for (const rule of Object.values(entry.models ?? {})) {
      for (const window of rule.windows ?? []) windows.push(window)
    }
  }
  let peak = false
  let until
  for (const window of windows) {
    if (!windowContains(window, now)) continue
    peak = true
    if (until === undefined) until = `${window.end} ${window.tz ?? 'UTC'}`
  }
  const windowsSeconds = secondsToNextBoundary(windows, now)
  return { peak, until, secondsToChange: windowsSeconds }
}

/** Every provider-family key in one schedules map, in declaration order. */
export function scheduleKeys(schedules) {
  return Object.keys(schedules ?? {})
}

/**
 * Pure peak-hour schedule engine — no cordis, no IO.
 *
 * Windows are HH:MM ranges in an explicit timezone (default UTC), may cross
 * midnight, and may be restricted to weekdays (0=Sunday..6=Saturday). Matching
 * is against PROVIDERS, not models, and every malformed entry fails open:
 * a broken window is reported and skipped, never a block.
 */
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MINUTES = 1440;
function minutesOf(time) {
    const match = HHMM_RE.exec(time);
    if (match === null)
        throw new Error(`invalid HH:MM time "${time}"`);
    return Number(match[1]) * 60 + Number(match[2]);
}
/**
 * Offset a UTC instant into a named timezone and give week-aligned minutes.
 *
 * Uses the platform Intl API: the local wall-clock of `now` is computed by
 * formatting each calendar field in the target timezone, which keeps the
 * engine dependency-free while honouring real DST transitions.
 */
function wallClockParts(now, tz) {
    const format = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = {};
    for (const part of format.formatToParts(now)) {
        if (part.type !== 'literal')
            parts[part.type] = part.value;
    }
    const weekday = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }[(parts.weekday ?? '').toLowerCase()];
    const hour = Number(parts.hour === '24' ? '0' : parts.hour);
    return { weekday: weekday ?? 0, hour, minute: Number(parts.minute) };
}
function resolveWindow(window) {
    const start = minutesOf(window.start);
    const end = minutesOf(window.end);
    const crossesMidnight = end <= start;
    const startAbs = start;
    const endAbs = crossesMidnight ? end + DAY_MINUTES : end;
    return {
        startAbs,
        endAbs,
        days: window.days === undefined ? null : new Set(window.days),
        untilLabel: window.end,
    };
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
export function decidePeak(provider, now, schedules) {
    const broken = [];
    const schedule = schedules[provider];
    if (schedule === undefined)
        return { inPeak: false, broken };
    for (const window of schedule.windows) {
        let resolved;
        try {
            resolved = resolveWindow(window);
        }
        catch (error) {
            broken.push(`${provider} window ${window.start}-${window.end}: ${error instanceof Error ? error.message : String(error)}`);
            continue;
        }
        const tz = window.tz ?? 'UTC';
        const clock = wallClockParts(now, tz);
        const minuteOfDay = clock.hour * 60 + clock.minute;
        const sameDay = minuteOfDay >= resolved.startAbs && minuteOfDay < resolved.endAbs;
        const afterMidnight = minuteOfDay < resolved.endAbs - DAY_MINUTES && resolved.endAbs > DAY_MINUTES;
        const inside = sameDay || afterMidnight;
        if (!inside)
            continue;
        if (resolved.days !== null && !resolved.days.has(clock.weekday))
            continue;
        return { inPeak: true, until: `${resolved.untilLabel} ${tz}`, broken };
    }
    return { inPeak: false, broken };
}

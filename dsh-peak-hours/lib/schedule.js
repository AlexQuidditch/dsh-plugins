/**
 * Pure peak-hour schedule engine — no cordis, no IO.
 *
 * Windows are HH:MM ranges in an explicit timezone (default UTC), may cross
 * midnight, and may be restricted to weekdays (0=Sunday..6=Saturday). Matching
 * is against PROVIDERS, not models, and every malformed entry fails open:
 * a broken window is reported and skipped, never a block.
 *
 * A schedule key names a provider FAMILY and also matches every variant route
 * of it: a config that says `deepseek` covers the runtime ids `deepseek`,
 * `deepseek-official` and `deepseek-vision`. An exact key always wins over a
 * family key, so one variant can still carry its own windows or mode.
 */
/**
 * Resolve the schedule entry for a provider id.
 *
 * An exact key wins outright. Otherwise the LONGEST key that is a `-`-delimited
 * prefix of the id matches, so `deepseek` covers `deepseek-official` while a
 * more specific `deepseek-vision` entry would cover only that variant. A key
 * never matches a provider that merely shares a prefix without the separator
 * (`deep` must not match `deepseek`), and an unmatched provider is not an error:
 * the gate stays open, exactly like an unknown provider.
 */
export function resolveSchedule(provider, schedules) {
    const exact = schedules[provider];
    if (exact !== undefined)
        return { key: provider, schedule: exact };
    let best;
    for (const key of Object.keys(schedules)) {
        if (!provider.startsWith(`${key}-`))
            continue;
        if (best === undefined || key.length > best.key.length)
            best = { key, schedule: schedules[key] };
    }
    return best;
}
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
 *
 * The schedule is located through {@link resolveSchedule}, so a family key
 * covers every variant route of the provider.
 */
export function decidePeak(provider, now, schedules) {
    const broken = [];
    const resolvedSchedule = resolveSchedule(provider, schedules);
    if (resolvedSchedule === undefined)
        return { inPeak: false, broken };
    const schedule = resolvedSchedule.schedule;
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
        return { inPeak: true, until: `${resolved.untilLabel} ${tz}`, matched: resolvedSchedule.key, broken };
    }
    return { inPeak: false, broken };
}
/** Whether ONE window covers `now`. A malformed window covers nothing. */
export function windowContains(window, now) {
    let resolved;
    try {
        resolved = resolveWindow(window);
    }
    catch {
        return false;
    }
    const tz = window.tz ?? 'UTC';
    const clock = wallClockParts(now, tz);
    const minuteOfDay = clock.hour * 60 + clock.minute;
    const sameDay = minuteOfDay >= resolved.startAbs && minuteOfDay < resolved.endAbs;
    const afterMidnight = minuteOfDay < resolved.endAbs - DAY_MINUTES && resolved.endAbs > DAY_MINUTES;
    if (!sameDay && !afterMidnight)
        return false;
    return resolved.days === null || resolved.days.has(clock.weekday);
}
/**
 * Seconds until the next boundary (any window's start or end) after `now`.
 *
 * Computed on the window's own wall clock, so a timezone offset never has to be
 * turned into an instant; a DST shift inside the countdown is ignored, which is
 * what an indicator wants (the authoritative decision stays {@link decidePeak}).
 * The scan crosses a weekend, and an all-broken set falls back to one day.
 */
export function secondsToNextBoundary(windows, now) {
    let best = Number.POSITIVE_INFINITY;
    for (const window of windows) {
        let resolved;
        try {
            resolved = resolveWindow(window);
        }
        catch {
            continue;
        }
        const clock = wallClockParts(now, window.tz ?? 'UTC');
        // Local minute-of-day; the seconds component is timezone-independent.
        const localSeconds = (clock.hour * 60 + clock.minute) * 60 + now.getUTCSeconds();
        for (const boundary of [resolved.startAbs, resolved.endAbs]) {
            for (let d = 0; d <= 9; d += 1) {
                const delta = (d * DAY_MINUTES + boundary) * 60 - localSeconds;
                if (delta > 0 && delta < best)
                    best = delta;
            }
        }
    }
    return Number.isFinite(best) ? best : DAY_MINUTES * 60;
}
/**
 * The header-indicator view: is ANY configured window open right now, and when
 * does that status next flip. One schedule drives both the pill and the gate,
 * so they can never disagree about what "peak" means.
 */
export function peakOverview(now, schedules) {
    const windows = [];
    for (const key of Object.keys(schedules)) {
        for (const window of schedules[key].windows ?? [])
            windows.push(window);
    }
    let peak = false;
    let until;
    for (const window of windows) {
        if (!windowContains(window, now))
            continue;
        peak = true;
        if (until === undefined)
            until = `${window.end} ${window.tz ?? 'UTC'}`;
    }
    return { peak, until, secondsToChange: secondsToNextBoundary(windows, now) };
}


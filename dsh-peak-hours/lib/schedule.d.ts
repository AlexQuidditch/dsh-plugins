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
/** One peak window in a provider schedule. */
export interface PeakWindow {
    start: string;
    end: string;
    /** IANA or fixed-offset timezone; default 'UTC'. */
    tz?: string;
    /** Weekday restriction, 0=Sunday..6=Saturday; default all days. */
    days?: number[];
}
/** One provider's schedule. */
export interface ProviderSchedule {
    windows: PeakWindow[];
    /** Provider-level mode override. */
    mode?: 'soft' | 'hard';
}
/** The whole schedules map from bundle config. */
export type PeakSchedules = Record<string, ProviderSchedule>;
/** A schedule entry together with the config key that supplied it. */
export interface ResolvedSchedule {
    /** The config key that matched — not necessarily the provider id. */
    key: string;
    schedule: ProviderSchedule;
}
/** The resolved answer for one provider at one instant. */
export interface PeakDecision {
    /** Whether the provider is inside a peak window right now. */
    inPeak: boolean;
    /** HH:MM (UTC) of the window end when in peak. */
    until?: string;
    /** The config key whose schedule matched, when one did. */
    matched?: string;
    /** Malformed windows skipped while resolving (fail-open). */
    broken: string[];
}
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
export declare function resolveSchedule(provider: string, schedules: PeakSchedules): ResolvedSchedule | undefined;
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
export declare function decidePeak(provider: string, now: Date, schedules: PeakSchedules): PeakDecision;
/** Whether ONE window covers `now`. A malformed window covers nothing. */
export declare function windowContains(window: PeakWindow, now: Date): boolean;
/**
 * Seconds until the next boundary (any window's start or end) after `now`.
 *
 * Computed on the window's own wall clock, so a timezone offset never has to be
 * turned into an instant; a DST shift inside the countdown is ignored, which is
 * what an indicator wants (the authoritative decision stays {@link decidePeak}).
 * The scan crosses a weekend, and an all-broken set falls back to one day.
 */
export declare function secondsToNextBoundary(windows: PeakWindow[], now: Date): number;
/** The header-indicator view: which windows are open now and when that flips. */
export interface PeakOverview {
    /** Whether ANY configured window is open right now. */
    peak: boolean;
    /** `<HH:MM> <tz>` of the first open window's end, when peaking. */
    until?: string;
    /** Seconds until the peak status next flips. */
    secondsToChange: number;
}
/**
 * The header-indicator view: is ANY configured window open right now, and when
 * does that status next flip. One schedule drives both the pill and the gate,
 * so they can never disagree about what "peak" means.
 */
export declare function peakOverview(now: Date, schedules: PeakSchedules): PeakOverview;

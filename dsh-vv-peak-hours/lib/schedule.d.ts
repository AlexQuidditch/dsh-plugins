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
/** The resolved answer for one provider at one instant. */
export interface PeakDecision {
    /** Whether the provider is inside a peak window right now. */
    inPeak: boolean;
    /** HH:MM (UTC) of the window end when in peak. */
    until?: string;
    /** Malformed windows skipped while resolving (fail-open). */
    broken: string[];
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
export declare function decidePeak(provider: string, now: Date, schedules: PeakSchedules): PeakDecision;

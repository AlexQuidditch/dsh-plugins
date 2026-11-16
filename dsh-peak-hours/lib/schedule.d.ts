/**
 * Pure peak-hour schedule engine — type surface.
 *
 * Windows are HH:MM ranges in an explicit timezone (default UTC), may cross
 * midnight, and may be restricted to weekdays (0=Sunday..6=Saturday). Matching
 * is against provider FAMILIES, not models, and every malformed entry fails
 * open: a broken window is reported and skipped, never a block. An entry may
 * override its windows/mode/discount for one exact model id or `*`.
 *
 * This is a declaration-only mirror of `lib/schedule.js`; it is not imported at
 * runtime and exists for editor/type consumers.
 */

/** Normalized holiday exclusion calendar attached to windows. */
export interface HolidayCalendar {
  /** Timezone the holiday dates are declared in; default Asia/Shanghai. */
  tz: string
  /** Inclusive [from, to] date ranges (YYYY-MM-DD), sorted. */
  ranges: Array<[string, string]>
}

/** Raw holiday calendar accepted from config: dates, ranges, or both. */
export type HolidayInput = string[] | {
  tz?: string
  dates?: string[]
  ranges?: Array<[string, string]>
}

/** One peak window in a provider schedule. */
export interface PeakWindow {
  start: string
  end: string
  /** IANA or fixed-offset timezone; default 'UTC'. */
  tz?: string
  /** Weekday restriction, 0=Sunday..6=Saturday; default all days. */
  days?: number[]
  /** Normalized by `normalizeSchedules` from the owning entry/model rule. */
  holidays?: HolidayCalendar
}

/** Per-model override of a provider schedule; a full replacement, not a merge. */
export interface PeakModelRule {
  windows?: PeakWindow[]
  holidays?: HolidayInput
  /** Provider-level mode override. */
  mode?: 'pause' | 'hard' | 'warn'
  /** Share of the price saved by moving a call off-peak, 0..1. */
  offPeakDiscount?: number
}

/** One provider's schedule. */
export interface ProviderSchedule {
  windows: PeakWindow[]
  models?: Record<string, PeakModelRule>
  holidays?: HolidayInput
  mode?: 'pause' | 'hard' | 'warn'
  offPeakDiscount?: number
  label?: string
}

/** The whole schedules map from bundle config or the user state file. */
export type PeakSchedules = Record<string, ProviderSchedule>

/** Result of normalizing a raw schedules map. */
export interface NormalizedSchedules {
  schedules: PeakSchedules
  warnings: string[]
}

/** A schedule entry together with the config key that supplied it. */
export interface ResolvedSchedule {
  key: string
  schedule: ProviderSchedule
}

/** Effective windows/mode/discount for one provider+model. */
export interface EffectiveSchedule {
  key: string
  providerSchedule: ProviderSchedule
  modelKey?: string
  windows: PeakWindow[]
  mode?: 'pause' | 'hard' | 'warn'
  offPeakDiscount: number
  label: string
}

/** The resolved answer for one provider at one instant. */
export interface PeakDecision {
  inPeak: boolean
  until?: string
  matched?: string
  modelKey?: string
  broken: string[]
}

/** One provider/model's full view. */
export interface PeakOverview {
  known: boolean
  inPeak: boolean
  matchedKey: string | null
  modelKey: string | null
  untilAt: Date | null
  untilLabel: string | null
  nextStartAt: Date | null
  secondsToChange: number | null
  offPeakDiscount?: number
  mode?: 'pause' | 'hard' | 'warn'
}

export declare const DEFAULT_OFF_PEAK_DISCOUNT = 0.5
export declare const HOLIDAY_TZ_DEFAULT = 'Asia/Shanghai'

export declare function isTimeZone(tz: string): boolean
export declare function normalizeSchedules(raw: unknown): NormalizedSchedules
export declare function normalizeHolidays(raw: unknown): { holidays: HolidayCalendar | undefined; warnings: string[] }
export declare function isHolidayInstant(instant: Date, holidays: HolidayCalendar | undefined): boolean
export declare function resolveSchedule(provider: string, schedules: PeakSchedules): ResolvedSchedule | undefined
export declare function resolveEffective(provider: string, model: string | null | undefined, schedules: PeakSchedules): EffectiveSchedule | undefined
export declare function windowContains(window: PeakWindow, now: Date): boolean
export declare function peakEndsAt(provider: string, model: string | null | undefined, now: Date, schedules: PeakSchedules): Date | null
export declare function nextPeakStartAt(provider: string, model: string | null | undefined, now: Date, schedules: PeakSchedules): Date | null
export declare function overviewFor(provider: string, model: string | null | undefined, now: Date, schedules: PeakSchedules): PeakOverview
export declare function decidePeak(provider: string, now: Date, schedules: PeakSchedules): PeakDecision
export declare function decidePeak(provider: string, model: string | null | undefined, now: Date, schedules: PeakSchedules): PeakDecision
export declare function allWindows(schedules: PeakSchedules): Array<{ key: string; modelKey?: string; window: PeakWindow }>
export declare function windowLabelFor(window: PeakWindow, locale?: string): string
export declare function secondsToNextBoundary(windows: PeakWindow[], now: Date): number
export declare function peakOverview(now: Date, schedules: PeakSchedules): { peak: boolean; until?: string; secondsToChange: number }
export declare function scheduleKeys(schedules: PeakSchedules): string[]

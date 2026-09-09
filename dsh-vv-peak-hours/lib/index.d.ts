/**
 * dsh-vv-peak-hours, host half.
 *
 * vv PeakHoursPlugin port: a `llm/stream` waterfall listener (prepended and
 * global) that gates model calls by provider peak-price schedules.
 *
 * - soft (default): the call proceeds and a warning lands in the plugin log.
 * - hard: the call is rejected with a PEAK_HOURS_BLOCK error before any
 *   adapter work — the message stays in history and the failure renders as a
 *   regular error entry, mirroring the vv contract.
 *
 * Schedules match providers, not models; unknown providers and malformed
 * windows fail open (see ./schedule.ts). The decision runs once per stream
 * call on the options the loop already assembled, so it adds no per-chunk cost.
 */
import type { Context } from '@deepseek-ai/cordis';
import { type PeakSchedules } from './schedule.js';
export declare const name = "vv-peak-hours";
/** Bundle config (see cordis.patch.yml). */
export interface VvPeakHoursConfig {
    /** Whether the gate is active. Default: true. */
    enabled?: boolean;
    /** Global mode; a provider schedule may override it. Default: 'soft'. */
    mode?: 'soft' | 'hard';
    /** Provider schedules, keyed by provider id. */
    schedules?: PeakSchedules;
}
/** Minimal structural shape of one llm/stream payload. */
interface GenerateOptionsLike {
    provider?: unknown;
}
declare module '@deepseek-ai/cordis' {
    interface Events {
        'llm/stream'(options: GenerateOptionsLike, next: () => unknown): unknown;
    }
}
export declare function apply(ctx: Context, config?: VvPeakHoursConfig): void;
export {};

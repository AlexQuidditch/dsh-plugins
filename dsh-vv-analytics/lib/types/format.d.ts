/**
 * Pure cache-hit-rate helpers shared by the host recorder and the browser pill.
 * No DOM, no React, no cordis — only numbers and labels.
 */
/** Disjoint token buckets of one completed model step. */
export interface UsageBuckets {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
/** The durable tokenUsage projection shape token-meter serves. */
export interface TokenUsageProjection {
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
/**
 * Token-weighted cache hit rate of one step or session total.
 *
 * The denominator is the prompt's traffic — uncached input plus cache reads
 * and writes — and the numerator is the cache-read share. A step without any
 * prompt traffic yields `undefined` (the "n/a" state), because a misleading 0%
 * is worse than no number.
 */
export declare function cacheHitRate(buckets: Pick<UsageBuckets, 'inputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>): number | undefined;
/** Human label for the pill: "кэш 84%" or "кэш n/a". */
export declare function formatHitRate(rate: number | undefined): string;
/** CSS class tier for a hit rate; undefined rate is the neutral tier. */
export declare function hitRateTier(rate: number | undefined): 'neutral' | 'red' | 'yellow' | 'green';

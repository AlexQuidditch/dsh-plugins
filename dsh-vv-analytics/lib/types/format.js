/**
 * Pure cache-hit-rate helpers shared by the host recorder and the browser pill.
 * No DOM, no React, no cordis — only numbers and labels.
 */
/**
 * Token-weighted cache hit rate of one step or session total.
 *
 * The denominator is the prompt's traffic — uncached input plus cache reads
 * and writes — and the numerator is the cache-read share. A step without any
 * prompt traffic yields `undefined` (the "n/a" state), because a misleading 0%
 * is worse than no number.
 */
export function cacheHitRate(buckets) {
    const prompt = buckets.inputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens;
    if (prompt <= 0)
        return undefined;
    return buckets.cacheReadTokens / prompt;
}
/** Human label for the pill: "кэш 84%" or "кэш n/a". */
export function formatHitRate(rate) {
    if (rate === undefined)
        return 'кэш n/a';
    return `кэш ${Math.round(rate * 100)}%`;
}
/** CSS class tier for a hit rate; undefined rate is the neutral tier. */
export function hitRateTier(rate) {
    if (rate === undefined)
        return 'neutral';
    if (rate >= 0.8)
        return 'green';
    if (rate >= 0.5)
        return 'yellow';
    return 'red';
}

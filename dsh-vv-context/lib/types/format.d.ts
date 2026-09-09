/**
 * Pure formatting helpers for the context panel. No DOM, no React — only
 * numbers and text, so the host entry can re-export them for the activation
 * test (the client preset bundles this file into the entry).
 */
/** Compact token notation: 1234 → "1.2k", 1234567 → "1.2M". */
export declare function formatTokens(tokens: number): string;
/**
 * Percentage of a total as a plain number (0..1), or undefined when the
 * denominator is absent or non-positive — an honest "no data" instead of a
 * fabricated zero.
 */
export declare function shareOf(part: number, total: number | undefined): number | undefined;
/** "84%" or "—". */
export declare function formatPercent(share: number | undefined): string;

/**
 * Pure formatting helpers for the context panel. No DOM, no React — only
 * numbers and text, so the host entry can re-export them for the activation
 * test (the client preset bundles this file into the entry).
 */

/** Compact token notation: 1234 → "1.2k", 1234567 → "1.2M". */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return '—'
  if (tokens < 1000) return String(Math.round(tokens))
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

/**
 * Percentage of a total as a plain number (0..1), or undefined when the
 * denominator is absent or non-positive — an honest "no data" instead of a
 * fabricated zero.
 */
export function shareOf(part: number, total: number | undefined): number | undefined {
  if (total === undefined || !Number.isFinite(total) || total <= 0) return undefined
  if (!Number.isFinite(part) || part < 0) return undefined
  return part / total
}

/** "84%" or "—". */
export function formatPercent(share: number | undefined): string {
  if (share === undefined) return '—'
  return `${Math.round(share * 100)}%`
}

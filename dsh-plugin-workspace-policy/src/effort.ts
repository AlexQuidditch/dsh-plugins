/**
 * Reasoning-effort ordering shared by the budget clamp and diagnostics.
 *
 * Effort ids are adapter-owned opaque strings; the ordinal table covers the
 * ids used by the adapters shipped with DSH. Unknown ids are unordered: the
 * clamp passes them through untouched rather than guessing.
 */

/** Ascending ordinal per known effort id; unknown ids are absent. */
const EFFORT_RANK: Readonly<Record<string, number>> = Object.freeze({
  off: 0,
  low: 1,
  medium: 2,
  high: 3,
  max: 4,
})

/** Ordinal of one effort id, or `undefined` when the id is not known. */
export function effortRank(id: string | undefined): number | undefined {
  if (id === undefined) return undefined
  const rank = EFFORT_RANK[id]
  return rank === undefined ? undefined : rank
}

/**
 * Clamp one effort id under a budget ceiling: return the ceiling when the
 * effort is known to rank above it, the effort itself when it does not, and
 * `undefined` when either side is unknown or absent (nothing to order).
 */
export function clampEffort(effort: string | undefined, ceiling: string | undefined): string | undefined {
  if (effort === undefined || ceiling === undefined) return effort
  const effortValue = effortRank(effort)
  const ceilingValue = effortRank(ceiling)
  if (effortValue === undefined || ceilingValue === undefined) return effort
  return effortValue > ceilingValue ? ceiling : effort
}

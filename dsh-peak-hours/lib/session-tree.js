/**
 * Session lineage helpers — read-only, service-optional, no cordis imports.
 *
 * A subagent child Session carries `header.parentSession` (direct creator) and
 * `header.origin === 'subagent'` / `header.delegationDepth`; agent teams spawn
 * ordinary root sessions. For the peak-hours policy a child inherits the
 * nearest ancestor's "allow work in peak hours" override, so allowing a parent
 * never leaves its subagents paused (and vice versa: the parent's resume
 * releases the whole tree).
 *
 * All lookups are defensive: a cold session may not be in the live store, an
 * older harness may not populate the header, and a malformed chain must never
 * throw into the pause gate.
 */

/** Maximum ancestry walk; subagent nesting is small, the guard only stops cycles. */
const MAX_ANCESTRY_DEPTH = 8

/** The durable header of one Session, live store first, agent registry second. */
export function sessionHeaderOf(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  try {
    const header = ctx?.get?.('sessions')?.get?.(sessionId)?.header
    if (header !== null && header !== undefined) return header
  } catch {
    // fall through to the agent registry
  }
  try {
    const header = ctx?.get?.('agents')?.get?.(sessionId)?.session?.header
    if (header !== null && header !== undefined) return header
  } catch {
    // unknown session
  }
  return undefined
}

/**
 * Direct ancestors of one Session, nearest first (up to {@link MAX_ANCESTRY_DEPTH}).
 *
 * @returns {string[]} ancestor session ids; empty for a root or unknown session.
 */
export function ancestorsOf(ctx, sessionId) {
  const ancestors = []
  const seen = new Set()
  if (typeof sessionId !== 'string' || sessionId === '') return ancestors
  seen.add(sessionId)
  let current = sessionId
  for (let depth = 0; depth < MAX_ANCESTRY_DEPTH; depth += 1) {
    const header = sessionHeaderOf(ctx, current)
    const parent = header?.parentSession
    if (typeof parent !== 'string' || parent === '' || seen.has(parent)) break
    ancestors.push(parent)
    seen.add(parent)
    current = parent
  }
  return ancestors
}

/** Whether `sessionId` is a descendant (any depth) of `ancestorId`. */
export function isDescendantOf(ctx, sessionId, ancestorId) {
  if (typeof ancestorId !== 'string' || ancestorId === '') return false
  return ancestorsOf(ctx, sessionId).includes(ancestorId)
}

/** Whether one Session is a subagent child (never requeued by the pause gate). */
export function isSubagentSessionHeader(header) {
  if (header === null || header === undefined) return false
  if (header.origin === 'subagent') return true
  if (header.parentSession !== undefined && header.parentSession !== null) return true
  if (header.delegationDepth !== undefined && header.delegationDepth !== null) return true
  return false
}

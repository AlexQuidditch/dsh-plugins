/**
 * Plain-data vocabulary of the per-workspace policy model.
 *
 * Everything in this module is JSON-shaped, serializable data. No Cordis
 * context, Agent, Session, or service object ever appears here: the policy
 * loaded from disk, the per-agent decision state, and the decisions returned
 * by the pure core are all owned plain data, safe to log, cache, and test.
 */

/** One LLM route target as expressed in `.dsh/workspace.yaml`. */
export interface PolicyRoute {
  /** Registered provider route id (must have a live adapter at request time). */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Optional adapter-owned reasoning effort for the exact provider/model route. */
  reasoningEffort?: string
}

/** `model:` section of the workspace policy file. */
export interface PolicyModelSection {
  /** Route for top-level (master) sessions of this workspace. */
  default?: PolicyRoute
  /** Route for every delegated child agent (subagent/fork/workflow/ralph). */
  workers?: PolicyRoute
  /** Ordered one-shot degradation chain for terminal route failures. */
  fallback?: PolicyRoute[]
}

/** `budget:` section of the workspace policy file. */
export interface PolicyBudgetSection {
  /** Ceiling for reasoning effort in replaced configs; lowers, never raises. */
  maxReasoningEffort?: string
}

/** Fully parsed and shape-validated workspace policy. */
export interface WorkspacePolicy {
  model: PolicyModelSection
  budget: PolicyBudgetSection
}

/** Whether a parsed policy carries any actionable instruction. */
export function isPolicyActionable(policy: WorkspacePolicy | null | undefined): boolean {
  if (policy === null || policy === undefined) return false
  const { model } = policy
  return model.default !== undefined || model.workers !== undefined || (model.fallback?.length ?? 0) > 0
}

/** Lifecycle status of one workspace-root policy slot inside the store. */
export type PolicySlotStatus = 'unloaded' | 'missing' | 'loaded' | 'invalid'

/** Snapshot of one workspace root's policy state, as consumed by listeners. */
export interface PolicySlot {
  status: PolicySlotStatus
  /** Last successfully parsed policy; survives a broken edit (last-good). */
  policy: WorkspacePolicy | null
  /** Human-readable problem for `invalid` slots; empty otherwise. */
  problem: string | null
  /** Absolute path of the policy file this slot watches. */
  filePath: string
}

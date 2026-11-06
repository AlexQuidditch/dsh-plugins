/**
 * Pure decision core of the workspace policy engine.
 *
 * Every function here is plain data in, plain data out (plus mutation of the
 * caller-owned per-agent state object): no Cordis context, no host services,
 * no clock, no I/O. The plugin glue in `index.ts` owns all asynchronous and
 * environmental work — gathering guards from the llm service, reading the
 * durable session state — and this module turns those facts into decisions.
 *
 * 0.2.2 port. DSH 0.2.2 fixes an agent step's provider/model/effort BEFORE
 * the `agent/request` waterfall (which may now adjust only request controls):
 * a listener that rewrites the route there fails the turn with
 * "agent/request proposed … after step preparation fixed …". Route changes
 * travel through `agent.model.select()` — the durable model-selection event —
 * before step preparation instead. The rules this core now implements:
 *
 * - Master sessions get the `model.default` route selected at `agent/created`
 *   (the awaited serial lifecycle event that precedes every step), only when
 *   the session started fresh (`agent/created` source `startup`; 0.1's
 *   `agent/session-start`), only when no request header is logged yet, and
 *   only when no explicit user model selection is pending.
 * - Worker agents (delegation depth > 0) get the `model.workers` route
 *   selected at `agent/created`, unconditionally: the workspace policy
 *   overrides preset `agentOptions` pins by design.
 * - A terminal QUOTA / RATE_LIMIT failure selects the next `model.fallback`
 *   chain entry at `agent/request-error`. The failed step's selection is
 *   already fixed, so the listener delegates (the turn ends with the terminal
 *   error) and the session's next turn reads the degraded selection. The
 *   chain index is monotonic for the agent lifetime, so cycles are impossible.
 */

import { clampEffort } from './effort.ts'
import type { PolicyBudgetSection, PolicyRoute, WorkspacePolicy } from './types.ts'

/** Why a session lifecycle began, as reported by `agent/created`. */
export type SessionStartSourceLite = 'startup' | 'resume' | 'clear' | 'compact'

/** A complete model route as `agent.model.select()` records it. */
export interface RouteSelection {
  /** Provider route id. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Explicit effort; omission follows adapter defaults. */
  reasoningEffort?: string
}

/** Per-agent decision state, owned by the plugin glue, mutated only here. */
export interface AgentPolicyState {
  /** Session-start source once seen; `null` before the lifecycle event. */
  sessionSource: SessionStartSourceLite | null
  /** Startup decision is final for the agent (selection or deliberate pass-through). */
  resolved: boolean
  /** Next fallback-chain index to try for this agent (monotonic, never resets). */
  fallbackIndex: number
}

/** Fresh state for one agent. */
export function initialAgentState(): AgentPolicyState {
  return {
    sessionSource: null,
    resolved: false,
    fallbackIndex: 0,
  }
}

/** Environmental facts the pure core needs to judge a candidate route. */
export interface RequestGuards {
  /** Registered provider ids; `null` when the provider list is unavailable. */
  providers: ReadonlySet<string> | null
  /** Effort ids offered by the target model; `null` when unknown. */
  targetEfforts: ReadonlySet<string> | null
  /** Input modalities of the target model; `null` when unknown. */
  targetInputModalities: ReadonlySet<string> | null
  /** Input modalities of the current (source) route; `null` when unknown. */
  sourceInputModalities: ReadonlySet<string> | null
  /** The target route could not be resolved by the llm service at all. */
  targetUnresolvable: boolean
}

/** Guards that skip every check (used when the llm service is absent). */
export const NO_GUARDS: RequestGuards = {
  providers: null,
  targetEfforts: null,
  targetInputModalities: null,
  sourceInputModalities: null,
  targetUnresolvable: false,
}

/** Why no selection happens for an agent. */
export type PassthroughReason =
  | 'already-decided'
  | 'not-fresh-session'
  | 'logged-header-exists'
  | 'user-selection-pending'
  | 'no-default-route'
  | 'no-workers-route'

/** Result of choosing what route applies to one newly created agent. */
export type StartupRoutePick =
  | { kind: 'route'; route: PolicyRoute; reason: 'master-policy' | 'workers-policy' }
  | { kind: 'passthrough'; reason: PassthroughReason }

/** Inputs of {@link pickStartupRoute}. */
export interface PickStartupRouteInput {
  state: AgentPolicyState
  policy: WorkspacePolicy
  isWorker: boolean
  /** Lifecycle source as delivered by `agent/created` (or recorded earlier). */
  sessionSource: SessionStartSourceLite | null
  hasLoggedHeader: boolean
  hasPendingUserSelection: boolean
}

/**
 * Choose the route to select for one agent at creation and advance the
 * per-agent state.
 *
 * Every branch marks the agent resolved — the startup decision is final, so
 * anything the user switches in the composer afterwards passes through
 * untouched (a later durable selection simply supersedes the policy's).
 */
export function pickStartupRoute(input: PickStartupRouteInput): StartupRoutePick {
  const { state, policy, isWorker, sessionSource, hasLoggedHeader, hasPendingUserSelection } = input

  if (state.resolved) return { kind: 'passthrough', reason: 'already-decided' }

  if (isWorker) {
    state.resolved = true
    const route = policy.model.workers
    if (route === undefined) return { kind: 'passthrough', reason: 'no-workers-route' }
    return { kind: 'route', route, reason: 'workers-policy' }
  }

  if (sessionSource !== 'startup') {
    state.resolved = true
    return { kind: 'passthrough', reason: 'not-fresh-session' }
  }
  if (hasLoggedHeader) {
    state.resolved = true
    return { kind: 'passthrough', reason: 'logged-header-exists' }
  }
  if (hasPendingUserSelection) {
    state.resolved = true
    return { kind: 'passthrough', reason: 'user-selection-pending' }
  }

  state.resolved = true
  const route = policy.model.default
  if (route === undefined) return { kind: 'passthrough', reason: 'no-default-route' }
  return { kind: 'route', route, reason: 'master-policy' }
}

/** Result of validating one candidate route into a selectable route. */
export type SelectionResult =
  | { kind: 'select'; selection: RouteSelection; warnings: string[] }
  | { kind: 'passthrough'; warnings: string[] }

/** Inputs of {@link resolveRouteSelection}. */
export interface ResolveSelectionInput {
  /** Policy route to validate. */
  route: PolicyRoute
  /** The agent's current route, when known; fuels the modality warning. */
  source: RouteSelection | undefined
  budget: PolicyBudgetSection
  guards: RequestGuards
}

/**
 * Build the `agent.model.select()` payload for one chosen route, or decline
 * with warnings when the guards reject the target.
 *
 * The selection names provider and model from the policy route plus the
 * reasoning effort after the budget clamp — omitted entirely when the target
 * model does not offer it. A policy route without an effort selects no effort
 * field, restoring the target model's adapter-default behavior.
 */
export function resolveRouteSelection(input: ResolveSelectionInput): SelectionResult {
  const { route, source, budget, guards } = input
  const warnings: string[] = []

  if (guards.providers !== null && !guards.providers.has(route.provider)) {
    warnings.push(
      `target provider "${route.provider}" is not registered; keeping the current route`,
    )
    return { kind: 'passthrough', warnings }
  }
  if (guards.targetUnresolvable) {
    warnings.push(
      `target route "${route.provider}/${route.model}" could not be resolved by the llm service; keeping the current route`,
    )
    return { kind: 'passthrough', warnings }
  }

  const sourceHasImage = guards.sourceInputModalities?.has('image') === true
  const targetDropsImages = guards.targetInputModalities !== null && !guards.targetInputModalities.has('image')
  if (source !== undefined && sourceHasImage && targetDropsImages) {
    warnings.push(
      `current route "${source.provider}/${source.model}" accepts image input but target "${route.provider}/${route.model}" does not; selecting anyway (image-bearing history may fail with UNSUPPORTED_CONTENT)`,
    )
  }

  let effort = clampEffort(route.reasoningEffort, budget.maxReasoningEffort)
  if (effort !== undefined && guards.targetEfforts !== null && !guards.targetEfforts.has(effort)) {
    warnings.push(
      `effort "${effort}" is not offered by "${route.provider}/${route.model}"; omitting the field`,
    )
    effort = undefined
  }

  const selection: RouteSelection = { provider: route.provider, model: route.model }
  if (effort !== undefined) selection.reasoningEffort = effort
  return { kind: 'select', selection, warnings }
}

/** Result of the request-error decision. */
export type RequestErrorDecision =
  | { kind: 'delegate' }
  | { kind: 'takeover'; route: PolicyRoute; index: number }

/** Inputs of {@link decideRequestError}. */
export interface RequestErrorInput {
  state: AgentPolicyState
  policy: WorkspacePolicy
  code: string
  failedProvider: string
}

/** Failure codes that justify degrading the route (quota is account-level). */
const DEGRADABLE_CODES: ReadonlySet<string> = new Set(['QUOTA', 'RATE_LIMIT'])

/**
 * Decide whether one failed request attempt should degrade the route for the
 * session's next turn. Degrades only on terminal-for-route codes — QUOTA and
 * RATE_LIMIT — because AUTH and credential problems are fixed by keys, not by
 * routes.
 *
 * On takeover the caller selects the returned route through
 * `agent.model.select()` and then delegates the failure: the failed step's
 * selection is already fixed, so an immediate `{ kind: 'retry' }` would re-run
 * the dead route, while the recorded selection guarantees the next turn
 * leaves on the fallback route.
 */
export function decideRequestError(input: RequestErrorInput): RequestErrorDecision {
  const { state, policy, code, failedProvider } = input
  if (!DEGRADABLE_CODES.has(code)) return { kind: 'delegate' }

  const chain = policy.model.fallback ?? []
  for (let index = state.fallbackIndex; index < chain.length; index += 1) {
    const entry = chain[index]
    if (entry === undefined) break
    if (entry.provider === failedProvider) continue
    state.fallbackIndex = index + 1
    return { kind: 'takeover', route: entry, index }
  }
  state.fallbackIndex = chain.length
  return { kind: 'delegate' }
}

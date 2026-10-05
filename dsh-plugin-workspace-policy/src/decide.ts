/**
 * Pure decision core of the workspace policy engine.
 *
 * Every function here is plain data in, plain data out (plus mutation of the
 * caller-owned per-agent state object): no Cordis context, no host services,
 * no clock, no I/O. The plugin glue in `index.ts` owns all asynchronous and
 * environmental work — gathering guards from the llm service, reading the
 * durable session state — and this module turns those facts into decisions.
 *
 * Decision rules implemented here:
 * - Master sessions get the `model.default` route only on their very first
 *   request (turn 1, step 1), only when the session started fresh
 *   (`agent/created` source `startup`, 0.1's `agent/session-start`), only when no request header is
 *   logged yet, and only when no explicit user model selection is pending.
 * - Worker agents (delegation depth > 0) get the `model.workers` route on
 *   their first request in this process, unconditionally: the workspace
 *   policy overrides preset `agentOptions` pins by design.
 * - A terminal QUOTA / RATE_LIMIT failure arms the fallback chain: the retry
 *   re-enters `agent/request`, where the armed index substitutes the next
 *   chain entry. At most one substitution per step; the chain index is
 *   monotonic for the agent lifetime, so cycles are impossible.
 */

import { clampEffort } from './effort.ts'
import type { PolicyBudgetSection, PolicyRoute, WorkspacePolicy } from './types.ts'

import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'

/** Why a session lifecycle began, as reported by `agent/created`. */
export type SessionStartSourceLite = 'startup' | 'resume' | 'clear' | 'compact'

/** The exact request-config type crossing the `agent/request` waterfall. */
export type CallConfigShape = LlmCallConfig

/** Per-agent decision state, owned by the plugin glue, mutated only here. */
export interface AgentPolicyState {
  /** Session-start source once seen; `null` before the lifecycle event. */
  sessionSource: SessionStartSourceLite | null
  /** First-request decision is final for the agent (replacement or deliberate pass-through). */
  resolved: boolean
  /** Next fallback-chain index to try for this agent (monotonic, never resets). */
  fallbackIndex: number
  /** Armed by a terminal failure: substitute `chain[index]` at this exact turn/step. */
  pendingFallback: { turn: number; step: number; index: number } | null
  /** Turn/step of the last applied fallback substitution; at most one per step. */
  lastSubstitution: { turn: number; step: number } | null
}

/** Fresh state for one agent. */
export function initialAgentState(): AgentPolicyState {
  return {
    sessionSource: null,
    resolved: false,
    fallbackIndex: 0,
    pendingFallback: null,
    lastSubstitution: null,
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
  /** Input modalities of the current (base) route; `null` when unknown. */
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

/** Why no replacement happens for a request. */
export type PassthroughReason =
  | 'already-decided'
  | 'not-fresh-session'
  | 'not-first-request'
  | 'logged-header-exists'
  | 'user-selection-pending'
  | 'no-default-route'
  | 'no-workers-route'
  | 'fallback-chain-empty'
  | 'unregistered-provider'
  | 'target-unresolvable'

/** Result of choosing what route conceptually applies to one request. */
export type RoutePick =
  | { kind: 'route'; route: PolicyRoute; reason: 'master-policy' | 'workers-policy' | 'fallback-step' }
  | { kind: 'passthrough'; reason: PassthroughReason }

/** Inputs of {@link pickRoute}. */
export interface PickRouteInput {
  state: AgentPolicyState
  policy: WorkspacePolicy
  isWorker: boolean
  turn: number
  step: number
  hasLoggedHeader: boolean
  hasPendingUserSelection: boolean
}

/**
 * Choose the route for one model request and advance the per-agent state.
 *
 * The armed-fallback branch runs first: a substitution armed by
 * `agent/request-error` bypasses the first-request rule (§: a fallback retry
 * must be able to change the route of an already-resolved agent). Every other
 * branch marks the agent resolved — the first decision is final, so anything
 * the user switches in the composer afterwards passes through untouched.
 */
export function pickRoute(input: PickRouteInput): RoutePick {
  const { state, policy, isWorker, turn, step, hasLoggedHeader, hasPendingUserSelection } = input

  // START_BLOCK_ARMED_FALLBACK: [Substitute the armed fallback-chain entry]
  const armed = state.pendingFallback
  if (armed !== null) {
    state.pendingFallback = null
    if (armed.turn === turn && armed.step === step) {
      const chain = policy.model.fallback ?? []
      const route = chain[armed.index]
      if (route !== undefined) {
        state.lastSubstitution = { turn, step }
        if (state.fallbackIndex < armed.index + 1) state.fallbackIndex = armed.index + 1
        return { kind: 'route', route, reason: 'fallback-step' }
      }
      // The chain shrank (hot reload); fall through to the normal rules.
    }
    // A stale armed entry (different turn/step) is dropped; a new terminal
    // failure re-arms with a fresh index.
  }
  // END_BLOCK_ARMED_FALLBACK

  if (state.resolved) return { kind: 'passthrough', reason: 'already-decided' }

  if (isWorker) {
    const route = policy.model.workers
    state.resolved = true
    if (route === undefined) return { kind: 'passthrough', reason: 'no-workers-route' }
    return { kind: 'route', route, reason: 'workers-policy' }
  }

  // START_BLOCK_MASTER_GUARDS: [Master replacement requires a route-less fresh session]
  if (state.sessionSource !== 'startup') {
    state.resolved = true
    return { kind: 'passthrough', reason: 'not-fresh-session' }
  }
  if (turn !== 1 || step !== 1) {
    state.resolved = true
    return { kind: 'passthrough', reason: 'not-first-request' }
  }
  if (hasLoggedHeader) {
    state.resolved = true
    return { kind: 'passthrough', reason: 'logged-header-exists' }
  }
  if (hasPendingUserSelection) {
    state.resolved = true
    return { kind: 'passthrough', reason: 'user-selection-pending' }
  }
  // END_BLOCK_MASTER_GUARDS

  const route = policy.model.default
  state.resolved = true
  if (route === undefined) return { kind: 'passthrough', reason: 'no-default-route' }
  return { kind: 'route', route, reason: 'master-policy' }
}

/** Inputs of {@link previewRoute}. */
export interface PreviewRouteInput {
  state: AgentPolicyState
  policy: WorkspacePolicy
  isWorker: boolean
  hasLoggedHeader: boolean
  hasPendingUserSelection: boolean
}

/**
 * Predict which route {@link pickRoute} would choose for the request that is
 * about to be assembled — without mutating the per-agent state.
 *
 * Prompt assembly runs BEFORE the `agent/request` waterfall, so the system
 * prompt a session renders must be able to name the route the request will
 * actually use. This mirror of the first-request rule answers that question:
 * `undefined` means the plugin will not touch this agent, and the caller must
 * leave the assembly's own variables alone.
 */
export function previewRoute(input: PreviewRouteInput): PolicyRoute | undefined {
  const { state, policy, isWorker, hasLoggedHeader, hasPendingUserSelection } = input
  if (state.pendingFallback !== null) {
    return (policy.model.fallback ?? [])[state.pendingFallback.index]
  }
  if (state.resolved) return undefined
  if (isWorker) return policy.model.workers
  if (state.sessionSource !== 'startup') return undefined
  if (hasLoggedHeader) return undefined
  if (hasPendingUserSelection) return undefined
  return policy.model.default
}

/** Result of turning a chosen route into a concrete call config. */
export type MaterializeResult =
  | { kind: 'replace'; config: CallConfigShape; warnings: string[] }
  | { kind: 'passthrough'; warnings: string[] }

/** Inputs of {@link materializeRoute}. */
export interface MaterializeInput {
  route: PolicyRoute
  base: CallConfigShape
  budget: PolicyBudgetSection
  guards: RequestGuards
}

/**
 * Build the replacement `LlmCallConfig` for one chosen route, or decline with
 * warnings when the guards reject the target.
 *
 * The replacement is always a complete config: provider and model come from
 * the policy route, `temperature` / `maxTokens` / `stop` carry over from the
 * base config, and the reasoning effort is the policy effort after the
 * budget clamp — omitted entirely when the target model does not offer it.
 * A policy route without an effort clears any inherited effort, restoring
 * the target model's adapter-default behavior.
 */
export function materializeRoute(input: MaterializeInput): MaterializeResult {
  const { route, base, budget, guards } = input
  const warnings: string[] = []

  // START_BLOCK_ROUTE_GUARDS: [Validity gates before any replacement]
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
  // END_BLOCK_ROUTE_GUARDS

  // START_BLOCK_MODALITY_GUARD: [Warn when dropping image support]
  const sourceHasImage = guards.sourceInputModalities?.has('image') === true
  const targetDropsImages = guards.targetInputModalities !== null && !guards.targetInputModalities.has('image')
  if (sourceHasImage && targetDropsImages) {
    warnings.push(
      `current route "${base.provider}/${base.model}" accepts image input but target "${route.provider}/${route.model}" does not; replacing anyway (image-bearing history may fail with UNSUPPORTED_CONTENT)`,
    )
  }
  // END_BLOCK_MODALITY_GUARD

  // START_BLOCK_EFFORT_RESOLUTION: [Clamp under budget, then validate against the target]
  let effort = clampEffort(route.reasoningEffort, budget.maxReasoningEffort)
  if (effort !== undefined && guards.targetEfforts !== null && !guards.targetEfforts.has(effort)) {
    warnings.push(
      `effort "${effort}" is not offered by "${route.provider}/${route.model}"; omitting the field`,
    )
    effort = undefined
  }
  // END_BLOCK_EFFORT_RESOLUTION

  const config: CallConfigShape = { ...base, provider: route.provider, model: route.model }
  if (effort === undefined) delete config.reasoningEffort
  else config.reasoningEffort = effort as Exclude<LlmCallConfig['reasoningEffort'], undefined>
  return { kind: 'replace', config, warnings }
}

/** Result of the request-error decision. */
export type RequestErrorDecision =
  | { kind: 'delegate' }
  | { kind: 'takeover'; index: number }

/** Inputs of {@link decideRequestError}. */
export interface RequestErrorInput {
  state: AgentPolicyState
  policy: WorkspacePolicy
  turn: number
  step: number
  code: string
  failedProvider: string
}

/** Failure codes that justify degrading the route (quota is account-level). */
const DEGRADABLE_CODES: ReadonlySet<string> = new Set(['QUOTA', 'RATE_LIMIT'])

/**
 * Decide whether one failed request attempt should be recovered by degrading
 * the route. Degrades only on terminal-for-route codes — QUOTA and
 * RATE_LIMIT — and only when the standard retry handling has declined (this
 * listener runs past it in the waterfall). AUTH and credential problems never
 * degrade: they are fixed by keys, not by routes.
 */
export function decideRequestError(input: RequestErrorInput): RequestErrorDecision {
  const { state, policy, turn, step, code, failedProvider } = input
  if (!DEGRADABLE_CODES.has(code)) return { kind: 'delegate' }

  const chain = policy.model.fallback ?? []
  if (chain.length === 0) return { kind: 'delegate' }

  // One substitution per step: if this step already consumed a fallback, the
  // next degradation waits for a later step.
  if (
    state.lastSubstitution !== null
    && state.lastSubstitution.turn === turn
    && state.lastSubstitution.step === step
  ) {
    return { kind: 'delegate' }
  }

  // START_BLOCK_CHAIN_WALK: [Pick the next entry on a different provider]
  for (let index = state.fallbackIndex; index < chain.length; index += 1) {
    const entry = chain[index]
    if (entry === undefined) break
    if (entry.provider === failedProvider) continue
    state.pendingFallback = { turn, step, index }
    return { kind: 'takeover', index }
  }
  // END_BLOCK_CHAIN_WALK
  state.fallbackIndex = chain.length
  return { kind: 'delegate' }
}

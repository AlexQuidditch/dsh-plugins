/**
 * dsh-plugin-workspace-policy, host half.
 *
 * Gives each workspace its own LLM route policy: a `.dsh/workspace.yaml`
 * file at the workspace root defines the route for master sessions
 * (`model.default`), the route for every delegated child agent
 * (`model.workers`), and an ordered one-shot fallback chain for terminal
 * route failures. The policy is applied at the `agent/request` waterfall —
 * the one seam every conversation model request of every agent crosses — so
 * it covers subagent, fork, workflow, and ralph children without touching
 * presets, session options, or the global `agent-default-model` setting.
 *
 * Inert by default: a workspace without a policy file (or with a broken one,
 * which keeps only a warning) changes nothing. Master sessions are only
 * touched on their very first request of a fresh, route-less session with no
 * explicit user selection; anything the user switches in the composer after
 * that passes through untouched. The workspace policy for workers is
 * deliberately absolute — it overrides preset `agentOptions` pins — and is
 * documented as such in the README.
 *
 * Namespace plugin shape (named exports; no default export).
 */

import z from 'schemastery'

import { decideRequestError, initialAgentState, materializeRoute, NO_GUARDS, pickRoute, previewRoute } from './decide.ts'
import type { AgentPolicyState, CallConfigShape, RequestGuards, SessionStartSourceLite } from './decide.ts'
import { WorkspacePolicyStore } from './policy-store.ts'
import type { PolicySlot } from './types.ts'
import { isPolicyActionable } from './types.ts'

// Type-only imports: they load the Cordis module augmentations (agent events,
// the llm service surface, the prompt-assembly waterfall) without adding
// runtime dependencies.
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'workspace-policy'

/** No hard service dependencies: everything is read through `ctx.get`. */
export const inject: string[] = []

/** Single source of truth for defaults (schema + resolver). */
const DEFAULTS = {
  configFileName: '.dsh/workspace.yaml',
  watch: true,
  debounceMs: 100,
  log: true,
} as const

/** Loader-validated row config schema. */
export const Config = z.object({
  configFileName: z.string().default(DEFAULTS.configFileName),
  watch: z.boolean().default(DEFAULTS.watch),
  debounceMs: z.number().min(0).default(DEFAULTS.debounceMs),
  log: z.boolean().default(DEFAULTS.log),
})

/** Row config as `apply` receives it (the loader validates it against {@link Config}). */
export interface WorkspacePolicyRowConfig {
  configFileName?: string
  watch?: boolean
  debounceMs?: number
  log?: boolean
}

/** Resolved row config. */
interface Settings {
  configFileName: string
  watchEnabled: boolean
  debounceMs: number
  log: boolean
}

/** Minimal structural view of the llm service this plugin needs. */
interface LlmLike {
  listProviders(): { id: string }[]
  resolveModelInfo(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<{
    inputModalities?: string[]
    reasoning?: { efforts: { id: string }[] }
  }>
}

/** Minimal structural view of the workspace registry. */
interface WorkspaceRegistryLike {
  resolveByPath(path: string): Promise<{ path: string } | undefined>
}

/** Minimal structural view of the session-projection service. */
interface SessionProjectionsLike {
  stateOf(session: object, key: string): { pending?: unknown } | undefined
}

/** Resolved model facts used to build request guards. */
interface ModelFacts {
  efforts: ReadonlySet<string> | null
  modalities: ReadonlySet<string> | null
}

export function apply(ctx: Context, input: WorkspacePolicyRowConfig = {}): void {
  const settings: Settings = {
    configFileName: input.configFileName ?? DEFAULTS.configFileName,
    watchEnabled: input.watch ?? DEFAULTS.watch,
    debounceMs: input.debounceMs ?? DEFAULTS.debounceMs,
    log: input.log ?? DEFAULTS.log,
  }

  const llm = ctx.get('llm') as LlmLike | undefined
  const workspaceRegistry = ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
  const sessionProjections = ctx.get('sessionProjections') as SessionProjectionsLike | undefined

  const store = new WorkspacePolicyStore({
    configFileName: settings.configFileName,
    watchEnabled: settings.watchEnabled,
    debounceMs: settings.debounceMs,
    logger: {
      info: (message, ...args) => ctx.logger.info(message, ...args),
      warn: (message, ...args) => ctx.logger.warn(message, ...args),
    },
  })
  ctx.effect(() => () => store.dispose(), 'workspace-policy: dispose policy store and watchers')

  const agentStates = new WeakMap<object, AgentPolicyState>()
  const rootCache = new Map<string, Promise<string>>()

  // ── helpers ────────────────────────────────────────────────────────────────

  function stateFor(agent: Agent): AgentPolicyState {
    let state = agentStates.get(agent)
    if (state === undefined) {
      state = initialAgentState()
      agentStates.set(agent, state)
    }
    return state
  }

  /** Delegated child: honest session-header lineage first, id heuristic fallback. */
  function isWorkerAgent(agent: Agent): boolean {
    const header = agent.session.header
    if (typeof header.delegationDepth === 'number') return header.delegationDepth > 0
    if (header.origin === 'subagent') return true
    if (header.parentSession !== undefined) return true
    const id = String(header.id ?? '')
    return id.length > 0 && !id.startsWith('session-')
  }

  /** Durable explicit model selection not yet consumed by a request header. */
  function hasPendingUserSelection(agent: Agent): boolean {
    if (sessionProjections === undefined) return false
    try {
      const state = sessionProjections.stateOf(agent.session, 'modelSelection')
      return state?.pending !== undefined && state.pending !== null
    } catch {
      return false
    }
  }

  async function workspaceRootFor(cwd: string): Promise<string> {
    let promise = rootCache.get(cwd)
    if (promise === undefined) {
      promise = (async () => {
        if (workspaceRegistry !== undefined) {
          try {
            const workspace = await workspaceRegistry.resolveByPath(cwd)
            if (workspace !== undefined) return workspace.path
          } catch {
            // fall back to the raw cwd below
          }
        }
        return cwd
      })()
      rootCache.set(cwd, promise)
    }
    return promise
  }

  /** Policy slot for the agent's workspace, or `null` when inert. */
  async function policySlotFor(agent: Agent): Promise<PolicySlot | null> {
    const cwd = agent.session.header.cwd
    if (cwd === undefined || cwd.length === 0) return null
    const root = await workspaceRootFor(cwd)
    const slot = await store.load(root)
    return isPolicyActionable(slot.policy) ? slot : null
  }

  /** Registered provider ids, or `null` when the list is unavailable. */
  function registeredProviders(): ReadonlySet<string> | null {
    if (llm === undefined) return null
    try {
      return new Set(llm.listProviders().map((entry) => entry.id))
    } catch {
      return null
    }
  }

  async function modelFactsFor(provider: string, model: string): Promise<ModelFacts | null> {
    if (llm === undefined) return null
    try {
      const info = await llm.resolveModelInfo(provider, model)
      return {
        efforts: info.reasoning?.efforts ? new Set(info.reasoning.efforts.map((e) => e.id)) : null,
        modalities: info.inputModalities ? new Set(info.inputModalities) : null,
      }
    } catch {
      return null
    }
  }

  async function guardsFor(route: { provider: string; model: string }, base: CallConfigShape): Promise<RequestGuards> {
    if (llm === undefined) return NO_GUARDS
    const providers = registeredProviders()
    const target = await modelFactsFor(route.provider, route.model)
    const source = await modelFactsFor(base.provider, base.model)
    return {
      providers,
      targetEfforts: target?.efforts ?? null,
      targetInputModalities: target?.modalities ?? null,
      sourceInputModalities: source?.modalities ?? null,
      targetUnresolvable: target === null,
    }
  }

  function describeConfig(config: CallConfigShape): string {
    return `${config.provider}/${config.model}${config.reasoningEffort === undefined ? '' : `/${config.reasoningEffort}`}`
  }

  // ── lifecycle bookkeeping ──────────────────────────────────────────────────

  /**
   * Record why this agent's session began, for the first-request rule.
   *
   * 0.2 delivers that origin as `agent/created`'s `source`; 0.1 delivered the
   * same `SessionStartSource` value from `agent/session-start`. A payload
   * without a `source` is ignored, so binding both never clobbers a known one.
   */
  const recordSessionSource = (payload: { agent: Agent; source?: SessionStartSourceLite }): void => {
    if (typeof payload.source === 'string') stateFor(payload.agent).sessionSource = payload.source
  }

  ctx.on('agent/created', recordSessionSource)
  // The legacy 0.1 spelling. It is declared only by pre-0.2 typings and never
  // emitted by 0.2, where binding it is inert — the cast keeps one build
  // compiling against either event map.
  const legacyOn = ctx.on as unknown as (name: string, listener: (payload: { agent: Agent; source?: SessionStartSourceLite }) => void) => unknown
  legacyOn('agent/session-start', recordSessionSource)

  ctx.on('agent/disposed', (payload) => {
    agentStates.delete(payload.agent)
  })

  // ── prompt-assembly seam: name the route the request will actually use ─────
  //
  // Assembly runs BEFORE `agent/request`, and the entry point's own listener
  // fills `{{provider}}` / `{{model}}` from its pre-request selection — the
  // ambient default for a fresh session. This listener is registered at host
  // boot, so it wraps that per-session listener and can restate the variables
  // with the route the policy is about to apply, keeping the system prompt
  // ("powered by the {{model}} model") truthful from the very first request.

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const result = await next()
    try {
      const agent = context.agent
      if (agent === undefined) return result
      const slot = await policySlotFor(agent)
      if (slot === null || slot.policy === null) return result
      const route = previewRoute({
        state: stateFor(agent),
        policy: slot.policy,
        isWorker: isWorkerAgent(agent),
        hasLoggedHeader: agent.session.requestHeader() !== undefined,
        hasPendingUserSelection: hasPendingUserSelection(agent),
      })
      if (route === undefined) return result
      const providers = registeredProviders()
      if (providers !== null && !providers.has(route.provider)) return result
      return {
        ...result,
        variables: { ...result.variables, provider: route.provider, model: route.model },
      }
    } catch (error) {
      ctx.logger.warn('[workspace-policy] prompt-assembly listener failed; leaving assembly unchanged: %o', error)
      return result
    }
  })

  // ── main seam: agent/request ───────────────────────────────────────────────

  ctx.on('agent/request', async (payload, next) => {
    const base: CallConfigShape = await next()
    try {
      if (payload.signal.aborted) return base
      const slot = await policySlotFor(payload.agent)
      if (slot === null || slot.policy === null) return base
      const policy = slot.policy
      const { agent, turn, step } = payload
      const state = stateFor(agent)

      const pick = pickRoute({
        state,
        policy,
        isWorker: isWorkerAgent(agent),
        turn,
        step,
        hasLoggedHeader: agent.session.requestHeader() !== undefined,
        hasPendingUserSelection: hasPendingUserSelection(agent),
      })
      if (pick.kind === 'passthrough') {
        if (settings.log && pick.reason !== 'already-decided') {
          ctx.logger.info(
            '[workspace-policy] agent %s: passing through (%s)',
            String(agent.session.header.id ?? ''),
            pick.reason,
          )
        }
        return base
      }

      const guards = await guardsFor(pick.route, base)
      const materialized = materializeRoute({ route: pick.route, base, budget: policy.budget, guards })
      for (const warning of materialized.warnings) {
        ctx.logger.warn('[workspace-policy] agent %s: %s', String(agent.session.header.id ?? ''), warning)
      }
      if (materialized.kind === 'passthrough') return base
      if (settings.log) {
        ctx.logger.info(
          '[workspace-policy] agent %s: %s route %s -> %s',
          String(agent.session.header.id ?? ''),
          pick.reason,
          describeConfig(base),
          describeConfig(materialized.config),
        )
      }
      return materialized.config
    } catch (error) {
      ctx.logger.warn('[workspace-policy] request listener failed; passing through: %o', error)
      return base
    }
  })

  // ── fallback seam: agent/request-error ─────────────────────────────────────

  ctx.on('agent/request-error', async (payload, next) => {
    try {
      if (!payload.signal.aborted) {
        const slot = await policySlotFor(payload.agent)
        if (slot !== null && slot.policy !== null) {
          const state = stateFor(payload.agent)
          const decision = decideRequestError({
            state,
            policy: slot.policy,
            turn: payload.turn,
            step: payload.step,
            code: payload.failure.code,
            failedProvider: payload.provider,
          })
          if (decision.kind === 'takeover') {
            if (settings.log) {
              ctx.logger.info(
                '[workspace-policy] agent %s: %s on %s; degrading to fallback #%d',
                String(payload.agent.session.header.id ?? ''),
                payload.failure.code,
                payload.provider,
                decision.index + 1,
              )
            }
            return { kind: 'retry' }
          }
        }
      }
    } catch (error) {
      ctx.logger.warn('[workspace-policy] request-error listener failed; delegating: %o', error)
    }
    return next()
  })
}

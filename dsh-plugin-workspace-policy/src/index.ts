/**
 * dsh-plugin-workspace-policy, host half.
 *
 * Gives each workspace its own LLM route policy: a `.dsh/workspace.yaml`
 * file at the workspace root defines the route for master sessions
 * (`model.default`), the route for every delegated child agent
 * (`model.workers`), per-agent-preset routes (`model.presets`, keyed by the
 * Session projection's `agentPreset` id — e.g. `cursor/vv-controller`), and an
 * ordered fallback chain for terminal route failures.
 *
 * 0.2.2 seam. DSH 0.2.2 fixes an agent step's provider/model/effort before
 * the `agent/request` waterfall, which may adjust only request controls;
 * route changes travel through `agent.model.select()` before step
 * preparation. The policy therefore:
 *
 * - selects the master/workers route at `agent/created` — the awaited serial
 *   lifecycle event that precedes every step, so the selection is durable
 *   before the first `preStep` reads it;
 * - degrades through `select()` at `agent/request-error` after a terminal
 *   QUOTA / RATE_LIMIT failure, then delegates the failure: the failed
 *   step's selection is already fixed, so the session's next turn is the
 *   first one on the fallback route.
 *
 * Inert by default: a workspace without a policy file (or with a broken one,
 * which keeps only a warning) changes nothing. Master sessions are only
 * touched when they start fresh, route-less, and with no explicit user
 * selection; anything the user switches in the composer passes through
 * untouched. `model.workers` is the default for delegated children whose
 * route was inherited from the parent — a route the caller explicitly
 * requested (per-call `subagent` provider/model or a preset `agentOptions`
 * pin) is left alone, and a `model.presets` hit for the child's own preset
 * outranks both. See the README for the precedence table.
 *
 * Namespace plugin shape (named exports; no default export).
 */

import z from 'schemastery'

import {
  decideRequestError,
  initialAgentState,
  NO_GUARDS,
  pickStartupRoute,
  resolveRouteSelection,
} from './decide.ts'
import type {
  AgentPolicyState,
  RequestGuards,
  RouteSelection,
  SessionStartSourceLite,
} from './decide.ts'
import { WorkspacePolicyStore } from './policy-store.ts'
import type { PolicySlot, WorkspacePolicy } from './types.ts'
import { isPolicyActionable } from './types.ts'

// Type-only imports: they load the Cordis module augmentations (the agent
// event map, the llm service surface) without adding runtime dependencies.
// The Agent type itself is NOT imported: the pinned devDependency typings
// predate the 0.2.2 `model` seam, so this glue reads agents structurally.
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'

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

/** Minimal structural view of the agents service (live Agent by session id). */
interface AgentsLike {
  get(id: string): AgentLike | undefined
}

/** Minimal structural view of the session-projection service. */
interface SessionProjectionsLike {
  stateOf(session: object, key: string): unknown | undefined
}

/** Minimal structural view of `AgentModel` (0.2.2 model-selection seam). */
interface AgentModelLike {
  current(): RouteSelection | undefined
  select(selection: RouteSelection): void
}

/**
 * The slice of one Agent the policy seams read. 0.2.2 delivers `model` as a
 * live object; older typings do not carry it, so the glue stays structural.
 */
interface AgentLike {
  id?: string
  session: {
    header: {
      id?: string
      cwd?: string
      delegationDepth?: number
      origin?: string
      parentSession?: unknown
    }
    requestHeader(): unknown
  }
  /** Creation options (`AgentOptions`): the route fallback before any selection or header. */
  options?: {
    provider?: string
    model?: string
    reasoningEffort?: string
  }
  /** Present on 0.2.2 hosts; absent on 0.1, where the plugin is inert. */
  model?: AgentModelLike
}

/** The agent's model seam, when the host provides one. */
function modelOf(agent: AgentLike): AgentModelLike | null {
  return agent.model ?? null
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

  // Services are resolved lazily at use time, never captured at apply time: a
  // plugin without service dependencies may be mounted before the providing
  // fiber finishes its async startup, and a snapshot taken then would stay
  // undefined for the life of the process.
  const llmOf = () => ctx.get('llm') as LlmLike | undefined
  const workspaceRegistryOf = () => ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
  const sessionProjectionsOf = () => ctx.get('sessionProjections') as SessionProjectionsLike | undefined
  const agentsOf = () => ctx.get('agents') as AgentsLike | undefined

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

  function stateFor(agent: AgentLike): AgentPolicyState {
    let state = agentStates.get(agent)
    if (state === undefined) {
      state = initialAgentState()
      agentStates.set(agent, state)
    }
    return state
  }

  /** Delegated child: honest session-header lineage first, id heuristic fallback. */
  function isWorkerAgent(agent: AgentLike): boolean {
    const header = agent.session.header
    if (typeof header.delegationDepth === 'number') return header.delegationDepth > 0
    if (header.origin === 'subagent') return true
    if (header.parentSession !== undefined) return true
    const id = String(header.id ?? '')
    return id.length > 0 && !id.startsWith('session-')
  }

  /** Durable explicit model selection not yet consumed by a request header. */
  function hasPendingUserSelection(agent: AgentLike): boolean {
    const sessionProjections = sessionProjectionsOf()
    if (sessionProjections === undefined) return false
    try {
      const state = sessionProjections.stateOf(agent.session, 'modelSelection') as { pending?: unknown } | undefined
      return state?.pending !== undefined && state.pending !== null
    } catch {
      return false
    }
  }

  /**
   * The Session projection's `agentPreset` id, maintained by the preset
   * registry from the session header and `agent-preset/selected` events. It
   * is authoritative after a mid-lifecycle preset switch, where the header
   * alone would be stale.
   */
  function presetOf(agent: AgentLike): string | undefined {
    const sessionProjections = sessionProjectionsOf()
    if (sessionProjections === undefined) return undefined
    try {
      const state = sessionProjections.stateOf(agent.session, 'agentPreset')
      return typeof state === 'string' && state.length > 0 ? state : undefined
    } catch {
      return undefined
    }
  }

  /** Route registered for this agent's exact preset id, when the policy has one. */
  function presetRouteFor(policy: WorkspacePolicy, presetId: string | undefined) {
    if (presetId === undefined) return undefined
    return policy.model.presets?.[presetId]
  }

  /** A creation route triple from one agent's `AgentOptions`, when it names a full route. */
  function routeFromOptions(
    options: { provider?: string; model?: string; reasoningEffort?: string } | undefined,
  ): { provider: string; model: string; reasoningEffort?: string } | undefined {
    if (options === undefined) return undefined
    if (typeof options.provider !== 'string' || options.provider.length === 0) return undefined
    if (typeof options.model !== 'string' || options.model.length === 0) return undefined
    return {
      provider: options.provider,
      model: options.model,
      ...(typeof options.reasoningEffort === 'string' && options.reasoningEffort.length > 0
        ? { reasoningEffort: options.reasoningEffort }
        : {}),
    }
  }

  /**
   * True when this delegated child was created with a route explicitly
   * requested by the caller — a per-call `subagent` `provider`/`model` or a
   * preset `agentOptions` pin — instead of inheriting the parent's live route.
   *
   * Mirrors `resolveChildAgentOptions` in `dsh-subagent`: the child's creation
   * options are the parent's delegation route merged with the request, so a
   * difference in provider, model, or effort is the only observable trace of
   * an explicit request. A child whose requested route happens to equal the
   * parent's route is indistinguishable from inheritance and keeps the
   * `model.workers` default.
   */
  function childRouteWasRequested(agent: AgentLike): boolean {
    if (!isWorkerAgent(agent)) return false
    const agents = agentsOf()
    const parentId = agent.session.header.parentSession
    const parent = agents !== undefined && typeof parentId === 'string' && parentId.length > 0
      ? agents.get(parentId)
      : undefined
    const child = routeFromOptions(agent.options)
    const header = parent?.session.requestHeader() as
      | { config?: { provider?: string; model?: string; reasoningEffort?: string } }
      | undefined
    const base = routeFromOptions(header?.config) ?? routeFromOptions(parent?.options)
    if (child === undefined || base === undefined) return false
    return child.provider !== base.provider
      || child.model !== base.model
      || (child.reasoningEffort ?? undefined) !== (base.reasoningEffort ?? undefined)
  }

  async function workspaceRootFor(cwd: string): Promise<string> {
    let promise = rootCache.get(cwd)
    if (promise === undefined) {
      promise = (async () => {
        const workspaceRegistry = workspaceRegistryOf()
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
  async function policySlotFor(agent: AgentLike): Promise<PolicySlot | null> {
    const cwd = agent.session.header.cwd
    if (cwd === undefined || cwd.length === 0) return null
    const root = await workspaceRootFor(cwd)
    const slot = await store.load(root)
    return isPolicyActionable(slot.policy) ? slot : null
  }

  /** Registered provider ids, or `null` when the list is unavailable. */
  function registeredProviders(): ReadonlySet<string> | null {
    const llm = llmOf()
    if (llm === undefined) return null
    try {
      return new Set(llm.listProviders().map((entry) => entry.id))
    } catch {
      return null
    }
  }

  async function modelFactsFor(provider: string, model: string): Promise<ModelFacts | null> {
    const llm = llmOf()
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

  async function guardsFor(
    route: { provider: string; model: string },
    source: RouteSelection | undefined,
  ): Promise<RequestGuards> {
    if (llmOf() === undefined) return NO_GUARDS
    const providers = registeredProviders()
    const target = await modelFactsFor(route.provider, route.model)
    const sourceFacts = source === undefined ? null : await modelFactsFor(source.provider, source.model)
    return {
      providers,
      targetEfforts: target?.efforts ?? null,
      targetInputModalities: target?.modalities ?? null,
      sourceInputModalities: sourceFacts?.modalities ?? null,
      targetUnresolvable: target === null,
    }
  }

  function describeRoute(route: { provider: string; model: string }): string {
    return `${route.provider}/${route.model}`
  }

  /**
   * Validate one policy route and record it as the agent's durable model
   * selection. Declines (with warnings logged) when the guards reject it.
   */
  async function selectRoute(
    agent: AgentLike,
    route: { provider: string; model: string; reasoningEffort?: string },
    budget: Parameters<typeof resolveRouteSelection>[0]['budget'],
    reason: string,
  ): Promise<boolean> {
    const model = modelOf(agent)
    if (model === null) return false
    const source = model.current()
    const guards = await guardsFor(route, source)
    const result = resolveRouteSelection({
      route,
      source,
      budget,
      guards,
    })
    for (const warning of result.warnings) {
      ctx.logger.warn('[workspace-policy] agent %s: %s', String(agent.session.header.id ?? ''), warning)
    }
    if (result.kind === 'passthrough') return false
    model.select(result.selection)
    if (settings.log) {
      ctx.logger.info(
        '[workspace-policy] agent %s: %s route %s -> %s',
        String(agent.session.header.id ?? ''),
        reason,
        source === undefined ? '(unset)' : describeRoute(source),
        describeRoute(result.selection),
      )
    }
    return true
  }

  // ── lifecycle: select the startup route before any step preparation ────────

  /**
   * Record why this agent's session began, then select the policy route.
   *
   * 0.2 delivers the origin as `agent/created`'s `source`; 0.1 delivered the
   * same `SessionStartSource` value from `agent/session-start`. A payload
   * without a `source` is ignored, so binding both never clobbers a known one.
   * `agent/created` is dispatched serially and awaited before the agent's
   * queued work is released, so the selection lands before the first step.
   */
  const recordSessionSource = (payload: { agent: AgentLike; source?: SessionStartSourceLite }): void => {
    if (typeof payload.source === 'string') stateFor(payload.agent).sessionSource = payload.source
  }

  ctx.on('agent/created', async (payload: { agent: AgentLike; source?: SessionStartSourceLite }) => {
    recordSessionSource(payload)
    try {
      const agent = payload.agent
      if (modelOf(agent) === null) return
      const slot = await policySlotFor(agent)
      if (slot === null || slot.policy === null) return
      const state = stateFor(agent)

      const pick = pickStartupRoute({
        state,
        policy: slot.policy,
        isWorker: isWorkerAgent(agent),
        sessionSource: state.sessionSource,
        hasLoggedHeader: agent.session.requestHeader() !== undefined,
        hasPendingUserSelection: hasPendingUserSelection(agent),
        presetRoute: presetRouteFor(slot.policy, presetOf(agent)),
        explicitChildRoute: childRouteWasRequested(agent),
      })
      if (pick.kind === 'passthrough') {
        if (settings.log && pick.reason !== 'already-decided') {
          ctx.logger.info(
            '[workspace-policy] agent %s: passing through (%s)',
            String(agent.session.header.id ?? ''),
            pick.reason,
          )
        }
        return
      }

      await selectRoute(agent, pick.route, slot.policy.budget, pick.reason)
    } catch (error) {
      ctx.logger.warn('[workspace-policy] agent/created listener failed; leaving the route untouched: %o', error)
    }
  })

  // ── preset switch on a fresh session ──────────────────────────────────────
  //
  // The GUI creates a draft Session immediately (with the default preset), so
  // `agent/created` has already resolved the route by the time the composer's
  // preset picker switches to e.g. `cursor/vv-controller`. The registry emits
  // `agent-preset/selected` only for sessions that have not started a turn, so
  // this listener re-selects the route for the new preset (or restores the
  // workspace default when the new preset has no `model.presets` entry).
  // A pending user model selection still wins.
  const presetOn = ctx.on as unknown as (
    name: string,
    listener: (sessionId: string, presetId: string) => unknown,
  ) => unknown

  presetOn('agent-preset/selected', async (sessionId: string, presetId: string) => {
    try {
      const agent = agentsOf()?.get?.(sessionId)
      if (agent === undefined || modelOf(agent) === null) return
      if (agent.session.requestHeader() !== undefined) return
      if (hasPendingUserSelection(agent)) return
      const slot = await policySlotFor(agent)
      if (slot === null || slot.policy === null) return
      const id = typeof presetId === 'string' && presetId.length > 0 ? presetId : undefined
      const route = presetRouteFor(slot.policy, id)
        ?? (isWorkerAgent(agent) ? slot.policy.model.workers : slot.policy.model.default)
      if (route === undefined) return
      const selected = await selectRoute(agent, route, slot.policy.budget, `preset ${id ?? '(none)'}`)
      if (selected && settings.log) {
        ctx.logger.info(
          '[workspace-policy] agent %s: preset switched to %s; route re-selected',
          String(agent.session.header.id ?? ''),
          id ?? '(none)',
        )
      }
    } catch (error) {
      ctx.logger.warn('[workspace-policy] agent-preset/selected listener failed; leaving the route untouched: %o', error)
    }
  })
  // The legacy 0.1 spelling. It is declared only by pre-0.2 typings and never
  // emitted by 0.2, where binding it is inert — the cast keeps one build
  // compiling against either event map.
  const legacyOn = ctx.on as unknown as (name: string, listener: (payload: { agent: AgentLike; source?: SessionStartSourceLite }) => void) => unknown
  legacyOn('agent/session-start', recordSessionSource)

  ctx.on('agent/disposed', (payload: { agent: AgentLike }) => {
    agentStates.delete(payload.agent)
  })

  // ── fallback seam: agent/request-error ─────────────────────────────────────
  //
  // Registered through a local cast: the pinned devDependency typings type the
  // waterfall's `next` as a concrete action union this glue only passes
  // through, and the runtime contract (delegate via next) is identical.

  const onRequestError = ctx.on as unknown as (
    name: string,
    listener: (payload: {
      agent: AgentLike
      signal: { aborted: boolean }
      provider: string
      failure: { code: string }
    }, next: () => Promise<unknown>) => Promise<unknown>,
  ) => unknown

  onRequestError('agent/request-error', async (payload, next) => {
    try {
      if (!payload.signal.aborted && modelOf(payload.agent) !== null) {
        const slot = await policySlotFor(payload.agent)
        if (slot !== null && slot.policy !== null) {
          const state = stateFor(payload.agent)
          const decision = decideRequestError({
            state,
            policy: slot.policy,
            code: payload.failure.code,
            failedProvider: payload.provider,
          })
          if (decision.kind === 'takeover') {
            const selected = await selectRoute(
              payload.agent,
              decision.route,
              slot.policy.budget,
              `fallback #${decision.index + 1} after ${payload.failure.code}`,
            )
            if (selected && settings.log) {
              ctx.logger.info(
                '[workspace-policy] agent %s: %s on %s; next turn degrades to the fallback route (the failed step keeps its fixed selection)',
                String(payload.agent.session.header.id ?? ''),
                payload.failure.code,
                payload.provider,
              )
            }
          }
        }
      }
    } catch (error) {
      ctx.logger.warn('[workspace-policy] request-error listener failed; delegating: %o', error)
    }
    // Always delegate: a { kind: 'retry' } would re-run the failed step on its
    // already-fixed (dead) route; the recorded selection takes over on the
    // session's next turn instead.
    return next()
  })
}

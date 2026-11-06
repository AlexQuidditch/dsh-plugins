/**
 * Decision-matrix tests for the pure core (0.2.2 model-selection seam).
 */
import { describe, expect, it } from 'vitest'

import {
  decideRequestError,
  initialAgentState,
  NO_GUARDS,
  pickStartupRoute,
  resolveRouteSelection,
} from '../src/decide.ts'
import type { AgentPolicyState, RequestGuards } from '../src/decide.ts'
import type { PolicyRoute, WorkspacePolicy } from '../src/types.ts'

const DEFAULT_ROUTE: PolicyRoute = { provider: 'zai', model: 'glm-5.3', reasoningEffort: 'max' }
const WORKERS_ROUTE: PolicyRoute = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' }

const POLICY: WorkspacePolicy = {
  model: {
    default: DEFAULT_ROUTE,
    workers: WORKERS_ROUTE,
    fallback: [
      { provider: 'deepseek-official', model: 'deepseek-flash' },
      { provider: 'openrouter', model: 'backup-model' },
    ],
  },
  budget: {},
}

const SOURCE = { provider: 'ambient', model: 'ambient-model', reasoningEffort: 'low' }

function guards(overrides: Partial<RequestGuards> = {}): RequestGuards {
  return { ...NO_GUARDS, ...overrides }
}

function freshState(source: AgentPolicyState['sessionSource'] = 'startup'): AgentPolicyState {
  const state = initialAgentState()
  state.sessionSource = source
  return state
}

function startupPick(state: AgentPolicyState, overrides: Partial<Parameters<typeof pickStartupRoute>[0]> = {}) {
  return pickStartupRoute({
    state,
    policy: POLICY,
    isWorker: false,
    sessionSource: state.sessionSource,
    hasLoggedHeader: false,
    hasPendingUserSelection: false,
    ...overrides,
  })
}

describe('pickStartupRoute — master sessions', () => {
  it('selects the master route for a fresh route-less session', () => {
    const state = freshState('startup')
    const pick = startupPick(state)
    expect(pick).toEqual({
      kind: 'route',
      route: POLICY.model.default,
      reason: 'master-policy',
    })
    expect(state.resolved).toBe(true)
  })

  it('passes through an agent whose startup decision already happened', () => {
    const state = freshState('startup')
    startupPick(state)
    expect(startupPick(state)).toEqual({ kind: 'passthrough', reason: 'already-decided' })
  })

  it('never touches a resumed session', () => {
    const state = freshState('resume')
    const pick = startupPick(state)
    expect(pick).toEqual({ kind: 'passthrough', reason: 'not-fresh-session' })
    expect(state.resolved).toBe(true)
  })

  it('never touches a compacted or cleared session lifecycle', () => {
    for (const source of ['compact', 'clear'] as const) {
      const state = freshState(source)
      const pick = startupPick(state)
      expect(pick).toEqual({ kind: 'passthrough', reason: 'not-fresh-session' })
    }
  })

  it('never touches an agent whose source is still unknown', () => {
    const state = initialAgentState()
    expect(startupPick(state)).toEqual({ kind: 'passthrough', reason: 'not-fresh-session' })
  })

  it('respects an already logged request header', () => {
    const state = freshState('startup')
    expect(startupPick(state, { hasLoggedHeader: true })).toEqual({
      kind: 'passthrough',
      reason: 'logged-header-exists',
    })
  })

  it('respects a durable explicit user selection made before the first message', () => {
    const state = freshState('startup')
    expect(startupPick(state, { hasPendingUserSelection: true })).toEqual({
      kind: 'passthrough',
      reason: 'user-selection-pending',
    })
  })

  it('is inert when the policy has no default route', () => {
    const state = freshState('startup')
    const pick = startupPick(state, { policy: { model: { workers: WORKERS_ROUTE }, budget: {} } })
    expect(pick).toEqual({ kind: 'passthrough', reason: 'no-default-route' })
  })
})

describe('pickStartupRoute — workers', () => {
  it('selects the workers route for every child, header and source notwithstanding', () => {
    const state = freshState('resume')
    const pick = startupPick(state, { isWorker: true, hasLoggedHeader: true })
    expect(pick).toEqual({ kind: 'route', route: POLICY.model.workers, reason: 'workers-policy' })
  })

  it('passes through when the policy has no workers route', () => {
    const state = freshState('startup')
    const pick = startupPick(state, { isWorker: true, policy: { model: { default: DEFAULT_ROUTE }, budget: {} } })
    expect(pick).toEqual({ kind: 'passthrough', reason: 'no-workers-route' })
  })
})

describe('resolveRouteSelection', () => {
  it('produces a selection naming provider, model, and effort', () => {
    const result = resolveRouteSelection({
      route: { provider: 'zai', model: 'glm-5.3', reasoningEffort: 'max' },
      source: SOURCE,
      budget: {},
      guards: guards(),
    })
    expect(result.kind).toBe('select')
    if (result.kind !== 'select') return
    expect(result.selection).toEqual({ provider: 'zai', model: 'glm-5.3', reasoningEffort: 'max' })
    expect(result.warnings).toEqual([])
  })

  it('keeps the current route when the target provider is not registered', () => {
    const result = resolveRouteSelection({
      route: { provider: 'ghost', model: 'nope' },
      source: SOURCE,
      budget: {},
      guards: guards({ providers: new Set(['zai', 'deepseek-official']) }),
    })
    expect(result.kind).toBe('passthrough')
    expect(result.warnings.join(' ')).toContain('ghost')
  })

  it('keeps the current route when the llm service cannot resolve the target', () => {
    const result = resolveRouteSelection({
      route: { provider: 'zai', model: 'nope' },
      source: SOURCE,
      budget: {},
      guards: guards({ targetUnresolvable: true }),
    })
    expect(result.kind).toBe('passthrough')
    expect(result.warnings.join(' ')).toContain('could not be resolved')
  })

  it('omits an effort the target model does not offer', () => {
    const result = resolveRouteSelection({
      route: { provider: 'zai', model: 'glm-5.3', reasoningEffort: 'off' },
      source: SOURCE,
      budget: {},
      guards: guards({ targetEfforts: new Set(['low', 'high', 'max']) }),
    })
    expect(result.kind).toBe('select')
    if (result.kind !== 'select') return
    expect(result.selection.reasoningEffort).toBeUndefined()
    expect(result.warnings.join(' ')).toContain('off')
  })

  it('keeps a valid effort', () => {
    const result = resolveRouteSelection({
      route: { provider: 'zai', model: 'glm-5.3', reasoningEffort: 'high' },
      source: SOURCE,
      budget: {},
      guards: guards({ targetEfforts: new Set(['low', 'high', 'max']) }),
    })
    expect(result.kind).toBe('select')
    if (result.kind === 'select') expect(result.selection.reasoningEffort).toBe('high')
  })

  it('selects without an effort when the route declares none', () => {
    const result = resolveRouteSelection({
      route: { provider: 'zai', model: 'glm-5.3' },
      source: SOURCE,
      budget: {},
      guards: guards(),
    })
    expect(result.kind).toBe('select')
    if (result.kind === 'select') expect(result.selection.reasoningEffort).toBeUndefined()
  })

  it('clamps the effort under budget.maxReasoningEffort', () => {
    const result = resolveRouteSelection({
      route: { provider: 'zai', model: 'glm-5.3', reasoningEffort: 'max' },
      source: SOURCE,
      budget: { maxReasoningEffort: 'high' },
      guards: guards(),
    })
    expect(result.kind).toBe('select')
    if (result.kind === 'select') expect(result.selection.reasoningEffort).toBe('high')
  })

  it('leaves unknown effort ids unclamped', () => {
    const result = resolveRouteSelection({
      route: { provider: 'zai', model: 'glm-5.3', reasoningEffort: 'turbo' },
      source: SOURCE,
      budget: { maxReasoningEffort: 'high' },
      guards: guards(),
    })
    expect(result.kind).toBe('select')
    if (result.kind === 'select') expect(result.selection.reasoningEffort).toBe('turbo')
  })

  it('selects anyway but warns when image support is dropped', () => {
    const result = resolveRouteSelection({
      route: { provider: 'text-only', model: 'm1' },
      source: { ...SOURCE, provider: 'vision', model: 'v1' },
      budget: {},
      guards: guards({
        sourceInputModalities: new Set(['text', 'image']),
        targetInputModalities: new Set(['text']),
      }),
    })
    expect(result.kind).toBe('select')
    expect(result.warnings.join(' ')).toContain('image')
  })

  it('does not warn when the source route is unknown', () => {
    const result = resolveRouteSelection({
      route: { provider: 'text-only', model: 'm1' },
      source: undefined,
      budget: {},
      guards: guards({
        sourceInputModalities: new Set(['text', 'image']),
        targetInputModalities: new Set(['text']),
      }),
    })
    expect(result.kind).toBe('select')
    expect(result.warnings).toEqual([])
  })
})

describe('decideRequestError — fallback matrix', () => {
  function errorInput(state: AgentPolicyState, code: string, failedProvider = 'zai') {
    return { state, policy: POLICY, code, failedProvider }
  }

  it('degrades to the first chain entry after a terminal QUOTA failure', () => {
    const state = freshState('startup')
    const decision = decideRequestError(errorInput(state, 'QUOTA'))
    expect(decision).toEqual({ kind: 'takeover', route: POLICY.model.fallback?.[0], index: 0 })
    expect(state.fallbackIndex).toBe(1)
  })

  it('degrades after a terminal RATE_LIMIT failure', () => {
    const state = freshState('startup')
    expect(decideRequestError(errorInput(state, 'RATE_LIMIT')).kind).toBe('takeover')
  })

  it('delegates AUTH failures — keys, not routes, fix them', () => {
    const state = freshState('startup')
    expect(decideRequestError(errorInput(state, 'AUTH'))).toEqual({ kind: 'delegate' })
    expect(state.fallbackIndex).toBe(0)
  })

  it('delegates MISSING_CREDENTIAL failures', () => {
    const state = freshState('startup')
    expect(decideRequestError(errorInput(state, 'MISSING_CREDENTIAL'))).toEqual({ kind: 'delegate' })
  })

  it('delegates when the chain is exhausted', () => {
    const state = freshState('startup')
    state.fallbackIndex = 2
    expect(decideRequestError(errorInput(state, 'QUOTA'))).toEqual({ kind: 'delegate' })
  })

  it('walks the chain monotonically across failures', () => {
    const state = freshState('startup')
    const first = decideRequestError(errorInput(state, 'QUOTA', 'zai'))
    if (first.kind !== 'takeover') throw new Error('expected takeover')
    const second = decideRequestError(errorInput(state, 'QUOTA', first.route.provider))
    expect(second).toEqual({ kind: 'takeover', route: POLICY.model.fallback?.[1], index: 1 })
  })

  it('skips chain entries on the failed provider', () => {
    const policy: WorkspacePolicy = {
      model: {
        fallback: [
          { provider: 'zai', model: 'same-account' },
          { provider: 'other', model: 'm' },
        ],
      },
      budget: {},
    }
    const state = freshState('startup')
    const decision = decideRequestError({ state, policy, code: 'QUOTA', failedProvider: 'zai' })
    expect(decision).toEqual({ kind: 'takeover', route: { provider: 'other', model: 'm' }, index: 1 })
  })

  it('delegates when every remaining entry is on the failed provider', () => {
    const policy: WorkspacePolicy = {
      model: { fallback: [{ provider: 'zai', model: 'same-account' }] },
      budget: {},
    }
    const state = freshState('startup')
    expect(decideRequestError({ state, policy, code: 'QUOTA', failedProvider: 'zai' })).toEqual({ kind: 'delegate' })
    expect(state.fallbackIndex).toBe(1)
  })

  it('delegates when the policy has no fallback chain', () => {
    const state = freshState('startup')
    const decision = decideRequestError({
      state,
      policy: { model: { default: DEFAULT_ROUTE }, budget: {} },
      code: 'QUOTA',
      failedProvider: 'zai',
    })
    expect(decision).toEqual({ kind: 'delegate' })
  })
})

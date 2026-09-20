/**
 * Decision-matrix tests for the pure core (spec §7.1).
 */
import { describe, expect, it } from 'vitest'

import {
  decideRequestError,
  initialAgentState,
  materializeRoute,
  NO_GUARDS,
  pickRoute,
  previewRoute,
} from '../src/decide.ts'
import type { AgentPolicyState, CallConfigShape, RequestGuards } from '../src/decide.ts'
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

const BASE = {
  provider: 'ambient',
  model: 'ambient-model',
  reasoningEffort: 'low',
  temperature: 0.3,
  maxTokens: 4096,
  stop: ['\n\n'],
} as unknown as CallConfigShape

function guards(overrides: Partial<RequestGuards> = {}): RequestGuards {
  return { ...NO_GUARDS, ...overrides }
}

function freshState(source: AgentPolicyState['sessionSource'] = 'startup'): AgentPolicyState {
  const state = initialAgentState()
  state.sessionSource = source
  return state
}

describe('pickRoute — master sessions', () => {
  it('replaces the first request of a fresh route-less session', () => {
    const state = freshState('startup')
    const pick = pickRoute({
      state,
      policy: POLICY,
      isWorker: false,
      turn: 1,
      step: 1,
      hasLoggedHeader: false,
      hasPendingUserSelection: false,
    })
    expect(pick).toEqual({
      kind: 'route',
      route: POLICY.model.default,
      reason: 'master-policy',
    })
    expect(state.resolved).toBe(true)
  })

  it('passes through every later request of the same agent', () => {
    const state = freshState('startup')
    pickRoute({ state, policy: POLICY, isWorker: false, turn: 1, step: 1, hasLoggedHeader: false, hasPendingUserSelection: false })
    const second = pickRoute({ state, policy: POLICY, isWorker: false, turn: 1, step: 2, hasLoggedHeader: true, hasPendingUserSelection: false })
    expect(second).toEqual({ kind: 'passthrough', reason: 'already-decided' })
  })

  it('never touches a resumed session', () => {
    const state = freshState('resume')
    const pick = pickRoute({ state, policy: POLICY, isWorker: false, turn: 1, step: 1, hasLoggedHeader: false, hasPendingUserSelection: false })
    expect(pick).toEqual({ kind: 'passthrough', reason: 'not-fresh-session' })
    expect(state.resolved).toBe(true)
  })

  it('never touches a compacted or cleared session lifecycle', () => {
    for (const source of ['compact', 'clear'] as const) {
      const state = freshState(source)
      const pick = pickRoute({ state, policy: POLICY, isWorker: false, turn: 1, step: 1, hasLoggedHeader: false, hasPendingUserSelection: false })
      expect(pick).toEqual({ kind: 'passthrough', reason: 'not-fresh-session' })
    }
  })

  it('ignores an agent that arrives past turn 1 / step 1', () => {
    const state = freshState('startup')
    const pick = pickRoute({ state, policy: POLICY, isWorker: false, turn: 2, step: 1, hasLoggedHeader: false, hasPendingUserSelection: false })
    expect(pick).toEqual({ kind: 'passthrough', reason: 'not-first-request' })
  })

  it('respects an already logged request header', () => {
    const state = freshState('startup')
    const pick = pickRoute({ state, policy: POLICY, isWorker: false, turn: 1, step: 1, hasLoggedHeader: true, hasPendingUserSelection: false })
    expect(pick).toEqual({ kind: 'passthrough', reason: 'logged-header-exists' })
  })

  it('respects a durable explicit user selection made before the first message', () => {
    const state = freshState('startup')
    const pick = pickRoute({ state, policy: POLICY, isWorker: false, turn: 1, step: 1, hasLoggedHeader: false, hasPendingUserSelection: true })
    expect(pick).toEqual({ kind: 'passthrough', reason: 'user-selection-pending' })
  })

  it('is inert when the policy has no default route', () => {
    const state = freshState('startup')
    const pick = pickRoute({
      state,
      policy: { model: { workers: WORKERS_ROUTE }, budget: {} },
      isWorker: false,
      turn: 1,
      step: 1,
      hasLoggedHeader: false,
      hasPendingUserSelection: false,
    })
    expect(pick).toEqual({ kind: 'passthrough', reason: 'no-default-route' })
  })
})

describe('pickRoute — workers', () => {
  it('replaces the first request of every child, header and source notwithstanding', () => {
    const state = freshState('resume')
    const pick = pickRoute({ state, policy: POLICY, isWorker: true, turn: 3, step: 1, hasLoggedHeader: true, hasPendingUserSelection: false })
    expect(pick).toEqual({ kind: 'route', route: POLICY.model.workers, reason: 'workers-policy' })
  })

  it('passes through when the policy has no workers route', () => {
    const state = freshState('startup')
    const pick = pickRoute({
      state,
      policy: { model: { default: DEFAULT_ROUTE }, budget: {} },
      isWorker: true,
      turn: 1,
      step: 1,
      hasLoggedHeader: false,
      hasPendingUserSelection: false,
    })
    expect(pick).toEqual({ kind: 'passthrough', reason: 'no-workers-route' })
  })
})

describe('pickRoute — armed fallback', () => {
  it('substitutes the armed chain entry at the retrying turn/step', () => {
    const state = freshState('startup')
    state.resolved = true
    state.fallbackIndex = 0
    state.pendingFallback = { turn: 4, step: 2, index: 0 }
    const pick = pickRoute({ state, policy: POLICY, isWorker: false, turn: 4, step: 2, hasLoggedHeader: true, hasPendingUserSelection: false })
    expect(pick.kind).toBe('route')
    if (pick.kind === 'route') {
      expect(pick.reason).toBe('fallback-step')
      expect(pick.route).toEqual(POLICY.model.fallback?.[0])
    }
    expect(state.pendingFallback).toBeNull()
    expect(state.lastSubstitution).toEqual({ turn: 4, step: 2 })
    expect(state.fallbackIndex).toBe(1)
  })

  it('drops a stale armed entry from another turn/step', () => {
    const state = freshState('startup')
    state.resolved = true
    state.pendingFallback = { turn: 4, step: 2, index: 0 }
    const pick = pickRoute({ state, policy: POLICY, isWorker: false, turn: 5, step: 1, hasLoggedHeader: true, hasPendingUserSelection: false })
    expect(pick).toEqual({ kind: 'passthrough', reason: 'already-decided' })
    expect(state.pendingFallback).toBeNull()
  })

  it('falls through when the chain shrank below the armed index', () => {
    const state = freshState('startup')
    state.resolved = true
    state.pendingFallback = { turn: 4, step: 2, index: 5 }
    const pick = pickRoute({ state, policy: POLICY, isWorker: false, turn: 4, step: 2, hasLoggedHeader: true, hasPendingUserSelection: false })
    expect(pick).toEqual({ kind: 'passthrough', reason: 'already-decided' })
    expect(state.pendingFallback).toBeNull()
  })
})

describe('materializeRoute', () => {
  it('produces a complete config carrying over sampling fields', () => {
    const result = materializeRoute({
      route: { provider: 'zai', model: 'glm-5.3', reasoningEffort: 'max' },
      base: BASE,
      budget: {},
      guards: guards(),
    })
    expect(result.kind).toBe('replace')
    if (result.kind !== 'replace') return
    expect(result.config.provider).toBe('zai')
    expect(result.config.model).toBe('glm-5.3')
    expect(result.config.reasoningEffort).toBe('max')
    expect(result.config.temperature).toBe(BASE.temperature)
    expect(result.config.maxTokens).toBe(BASE.maxTokens)
    expect(result.config.stop).toEqual(BASE.stop)
    expect(result.warnings).toEqual([])
  })

  it('keeps the current route when the target provider is not registered', () => {
    const result = materializeRoute({
      route: { provider: 'ghost', model: 'nope' },
      base: BASE,
      budget: {},
      guards: guards({ providers: new Set(['zai', 'deepseek-official']) }),
    })
    expect(result.kind).toBe('passthrough')
    expect(result.warnings.join(' ')).toContain('ghost')
  })

  it('keeps the current route when the llm service cannot resolve the target', () => {
    const result = materializeRoute({
      route: { provider: 'zai', model: 'nope' },
      base: BASE,
      budget: {},
      guards: guards({ targetUnresolvable: true }),
    })
    expect(result.kind).toBe('passthrough')
    expect(result.warnings.join(' ')).toContain('could not be resolved')
  })

  it('omits an effort the target model does not offer', () => {
    const result = materializeRoute({
      route: { provider: 'zai', model: 'glm-5.3', reasoningEffort: 'off' },
      base: BASE,
      budget: {},
      guards: guards({ targetEfforts: new Set(['low', 'high', 'max']) }),
    })
    expect(result.kind).toBe('replace')
    if (result.kind !== 'replace') return
    expect(result.config.reasoningEffort).toBeUndefined()
    expect(result.warnings.join(' ')).toContain('off')
  })

  it('keeps a valid effort', () => {
    const result = materializeRoute({
      route: { provider: 'zai', model: 'glm-5.3', reasoningEffort: 'high' },
      base: BASE,
      budget: {},
      guards: guards({ targetEfforts: new Set(['low', 'high', 'max']) }),
    })
    expect(result.kind).toBe('replace')
    if (result.kind === 'replace') expect(result.config.reasoningEffort).toBe('high')
  })

  it('clears an inherited effort when the route declares none', () => {
    const result = materializeRoute({
      route: { provider: 'zai', model: 'glm-5.3' },
      base: BASE,
      budget: {},
      guards: guards(),
    })
    expect(result.kind).toBe('replace')
    if (result.kind === 'replace') expect(result.config.reasoningEffort).toBeUndefined()
  })

  it('clamps the effort under budget.maxReasoningEffort', () => {
    const result = materializeRoute({
      route: { provider: 'zai', model: 'glm-5.3', reasoningEffort: 'max' },
      base: BASE,
      budget: { maxReasoningEffort: 'high' },
      guards: guards(),
    })
    expect(result.kind).toBe('replace')
    if (result.kind === 'replace') expect(result.config.reasoningEffort).toBe('high')
  })

  it('leaves unknown effort ids unclamped', () => {
    const result = materializeRoute({
      route: { provider: 'zai', model: 'glm-5.3', reasoningEffort: 'turbo' },
      base: BASE,
      budget: { maxReasoningEffort: 'high' },
      guards: guards(),
    })
    expect(result.kind).toBe('replace')
    if (result.kind === 'replace') expect(result.config.reasoningEffort).toBe('turbo')
  })

  it('replaces anyway but warns when image support is dropped', () => {
    const result = materializeRoute({
      route: { provider: 'text-only', model: 'm1' },
      base: { ...BASE, provider: 'vision', model: 'v1' },
      budget: {},
      guards: guards({
        sourceInputModalities: new Set(['text', 'image']),
        targetInputModalities: new Set(['text']),
      }),
    })
    expect(result.kind).toBe('replace')
    expect(result.warnings.join(' ')).toContain('image')
  })

  it('does not warn when target modalities are unknown', () => {
    const result = materializeRoute({
      route: { provider: 'text-only', model: 'm1' },
      base: { ...BASE, provider: 'vision', model: 'v1' },
      budget: {},
      guards: guards({ sourceInputModalities: new Set(['text', 'image']) }),
    })
    expect(result.kind).toBe('replace')
    expect(result.warnings).toEqual([])
  })
})

describe('decideRequestError — fallback matrix', () => {
  function errorInput(state: AgentPolicyState, code: string, failedProvider = 'zai', turn = 4, step = 2) {
    return {
      state,
      policy: POLICY,
      turn,
      step,
      code,
      failedProvider,
    }
  }

  it('arms the chain after a terminal QUOTA failure', () => {
    const state = freshState('startup')
    state.resolved = true
    const decision = decideRequestError(errorInput(state, 'QUOTA'))
    expect(decision).toEqual({ kind: 'takeover', index: 0 })
    expect(state.pendingFallback).toEqual({ turn: 4, step: 2, index: 0 })
  })

  it('arms the chain after a terminal RATE_LIMIT failure', () => {
    const state = freshState('startup')
    const decision = decideRequestError(errorInput(state, 'RATE_LIMIT'))
    expect(decision.kind).toBe('takeover')
  })

  it('delegates AUTH failures — keys, not routes, fix them', () => {
    const state = freshState('startup')
    expect(decideRequestError(errorInput(state, 'AUTH'))).toEqual({ kind: 'delegate' })
    expect(state.pendingFallback).toBeNull()
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

  it('allows at most one substitution per step', () => {
    const state = freshState('startup')
    state.resolved = true
    state.fallbackIndex = 1
    state.lastSubstitution = { turn: 4, step: 2 }
    expect(decideRequestError(errorInput(state, 'QUOTA', 'deepseek-official'))).toEqual({ kind: 'delegate' })
  })

  it('re-arms on a later step after a substitution', () => {
    const state = freshState('startup')
    state.resolved = true
    state.fallbackIndex = 1
    state.lastSubstitution = { turn: 4, step: 2 }
    const decision = decideRequestError(errorInput(state, 'QUOTA', 'deepseek-official', 5, 1))
    expect(decision).toEqual({ kind: 'takeover', index: 1 })
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
    const decision = decideRequestError({ state, policy, turn: 1, step: 1, code: 'QUOTA', failedProvider: 'zai' })
    expect(decision).toEqual({ kind: 'takeover', index: 1 })
  })

  it('delegates when every remaining entry is on the failed provider', () => {
    const policy: WorkspacePolicy = {
      model: { fallback: [{ provider: 'zai', model: 'same-account' }] },
      budget: {},
    }
    const state = freshState('startup')
    expect(decideRequestError({ state, policy, turn: 1, step: 1, code: 'QUOTA', failedProvider: 'zai' })).toEqual({ kind: 'delegate' })
    expect(state.fallbackIndex).toBe(1)
  })

  it('delegates when the policy has no fallback chain', () => {
    const state = freshState('startup')
    const decision = decideRequestError({
      state,
      policy: { model: { default: DEFAULT_ROUTE }, budget: {} },
      turn: 1,
      step: 1,
      code: 'QUOTA',
      failedProvider: 'zai',
    })
    expect(decision).toEqual({ kind: 'delegate' })
  })
})

describe('previewRoute — prompt-assembly mirror', () => {
  function preview(partial: Partial<{
    state: AgentPolicyState
    isWorker: boolean
    hasLoggedHeader: boolean
    hasPendingUserSelection: boolean
  }> = {}) {
    return previewRoute({
      state: partial.state ?? freshState('startup'),
      policy: POLICY,
      isWorker: partial.isWorker ?? false,
      hasLoggedHeader: partial.hasLoggedHeader ?? false,
      hasPendingUserSelection: partial.hasPendingUserSelection ?? false,
    })
  }

  it('previews the master route for a fresh route-less session', () => {
    expect(preview()).toEqual(DEFAULT_ROUTE)
  })

  it('previews the workers route for a child', () => {
    expect(preview({ isWorker: true, hasLoggedHeader: true })).toEqual(WORKERS_ROUTE)
  })

  it('never previews after the first decision', () => {
    const state = freshState('startup')
    state.resolved = true
    expect(preview({ state })).toBeUndefined()
  })

  it('never previews for non-fresh lifecycles or existing headers', () => {
    expect(preview({ state: freshState('resume') })).toBeUndefined()
    expect(preview({ hasLoggedHeader: true })).toBeUndefined()
    expect(preview({ hasPendingUserSelection: true })).toBeUndefined()
  })

  it('previews the armed fallback entry while a degradation is pending', () => {
    const state = freshState('startup')
    state.resolved = true
    state.pendingFallback = { turn: 3, step: 1, index: 1 }
    expect(preview({ state })).toEqual(POLICY.model.fallback?.[1])
  })

  it('does not mutate the state it inspects', () => {
    const state = freshState('startup')
    preview({ state })
    expect(state.resolved).toBe(false)
    expect(state.fallbackIndex).toBe(0)
  })
})

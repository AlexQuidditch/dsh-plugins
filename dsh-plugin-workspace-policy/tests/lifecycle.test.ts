/**
 * Проводка жизненного цикла агента в шов `agent.model.select()` (0.2.2).
 *
 * Регрессии, которые эти кейсы держат:
 *
 * 1. 0.2 переименовал `agent/session-start` в `agent/created`. Пока плагин
 *    слушал только старое имя, `sessionSource` оставался `null`, и правило
 *    первого запроса всегда уходило в passthrough «not-fresh-session» —
 *    маршрут `model.default` мастер-сессий не применялся никогда.
 * 2. 0.2.2 зафиксировал provider/model шага до водопада `agent/request`:
 *    слушатель, переписывавший там маршрут, ронял ход с «agent/request
 *    proposed … after step preparation fixed …». Плагин теперь записывает
 *    маршрут через `agent.model.select()` на `agent/created`, а деградацию —
 *    на `agent/request-error` c делегированием сбоя.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import * as plugin from '../src/index.ts'
import type { RouteSelection } from '../src/decide.ts'

const POLICY = `
model:
  default:
    provider: zai
    model: glm-5.3
    reasoningEffort: max
  workers:
    provider: deepseek-official
    model: deepseek-flash
    reasoningEffort: max
  fallback:
    - provider: deepseek-official
      model: deepseek-flash
  presets:
    "cursor/vv-controller":
      provider: cursor
      model: default
    "cursor/vv-worker":
      provider: cursor
      model: default
`

let workspace: string

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'workspace-policy-lifecycle-'))
  await mkdir(join(workspace, '.dsh'), { recursive: true })
  await writeFile(join(workspace, '.dsh', 'workspace.yaml'), POLICY)
})

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true })
})

/** The slice of one Agent the policy seams read (0.2.2 model-selection seam). */
function fakeAgent(id = 'session-1', header: Record<string, unknown> = {}, loggedHeader = false) {
  const selections: RouteSelection[] = []
  return {
    id,
    session: {
      header: { id, cwd: workspace, isSeeded: false, ...header },
      requestHeader: () => (loggedHeader ? { config: { provider: 'zai', model: 'glm-5.3' } } : undefined),
    },
    model: {
      current: () => selections.at(-1),
      select: (selection: RouteSelection) => {
        selections.push(selection)
      },
    },
    selections,
  }
}

/** Mount the plugin with watching off, so no timer outlives the case. */
async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(plugin, { configFileName: '.dsh/workspace.yaml', watch: false, log: false })
  return ctx
}

/**
 * Mount with `sessionProjections` and `agents` stand-ins so the preset seams
 * are real: `agentPreset` answers the id recorded on the session header
 * (mirroring the registry-maintained projection), `agents.get` returns the
 * registered fake agent, and `modelSelection` reports a pending user choice
 * only when the caller asks for one.
 */
async function mountWithProjections(
  agentsById: Map<string, object> = new Map(),
  pendingUserSelection = false,
): Promise<Context> {
  const ctx = new Context()
  ctx.provide('sessionProjections', {
    stateOf(session: object, key: string) {
      if (key === 'agentPreset') return (session as { header?: { agentPreset?: string | null } }).header?.agentPreset ?? null
      if (key === 'modelSelection' && pendingUserSelection) return { pending: { provider: 'zai', model: 'glm-5.3' } }
      return undefined
    },
  })
  ctx.provide('agents', {
    get(id: string) {
      return agentsById.get(id)
    },
  })
  await ctx.plugin(plugin, { configFileName: '.dsh/workspace.yaml', watch: false, log: false })
  return ctx
}

/**
 * The agent seams are declared `Scoped<Agent>`, but a test drives them with a
 * stand-in `this` and a hand-built payload; this is the untyped view of the
 * very same shared event bus, so the assertions stay about real dispatch.
 */
interface RawDispatcher {
  emit(thisArg: object, name: string, ...args: unknown[]): void
  waterfall(thisArg: object, name: string, payload: unknown, next: () => Promise<unknown>): Promise<unknown>
}

function dispatcher(ctx: Context): RawDispatcher {
  return ctx as unknown as RawDispatcher
}

describe('agent lifecycle → model.select at creation', () => {
  it('selects the master route for a fresh session announced as `agent/created`', async () => {
    const ctx = await mount()
    const agent = fakeAgent()
    dispatcher(ctx).emit({}, 'agent/created', { agent, source: 'startup' })
    await vi.waitFor(() => expect(agent.selections).toHaveLength(1))
    expect(agent.selections[0]).toEqual({ provider: 'zai', model: 'glm-5.3', reasoningEffort: 'max' })
    await ctx.fiber.dispose()
  })

  it('still selects the master route when only the legacy `agent/session-start` source arrives', async () => {
    const ctx = await mount()
    const agent = fakeAgent()
    // The legacy spelling only records the source; the selection itself needs
    // the 0.2 `agent/created` event, so drive the pair as 0.1→0.2 migration did.
    dispatcher(ctx).emit({}, 'agent/session-start', { agent, source: 'startup' })
    dispatcher(ctx).emit({}, 'agent/created', { agent })
    await vi.waitFor(() => expect(agent.selections).toHaveLength(1))
    expect(agent.selections[0]).toEqual({ provider: 'zai', model: 'glm-5.3', reasoningEffort: 'max' })
    await ctx.fiber.dispose()
  })

  it('leaves a resumed session on its own route', async () => {
    const ctx = await mount()
    const agent = fakeAgent()
    dispatcher(ctx).emit({}, 'agent/created', { agent, source: 'resume' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(agent.selections).toEqual([])
    await ctx.fiber.dispose()
  })

  it('routes a delegated child to the workers route without any lifecycle source', async () => {
    const ctx = await mount()
    const agent = fakeAgent('child-1', { delegationDepth: 1 })
    dispatcher(ctx).emit({}, 'agent/created', { agent, source: 'resume' })
    await vi.waitFor(() => expect(agent.selections).toHaveLength(1))
    expect(agent.selections[0]).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' })
    await ctx.fiber.dispose()
  })

  it('selects the preset route for a fresh session whose preset is registered', async () => {
    const ctx = await mountWithProjections()
    const agent = fakeAgent('session-9', { agentPreset: 'cursor/vv-controller' })
    dispatcher(ctx).emit({}, 'agent/created', { agent, source: 'startup' })
    await vi.waitFor(() => expect(agent.selections).toHaveLength(1))
    expect(agent.selections[0]).toEqual({ provider: 'cursor', model: 'default' })
    await ctx.fiber.dispose()
  })

  it('routes a delegated child by its own preset id, unconditionally', async () => {
    const ctx = await mountWithProjections()
    const agent = fakeAgent('child-9', { delegationDepth: 1, agentPreset: 'cursor/vv-worker' })
    dispatcher(ctx).emit({}, 'agent/created', { agent, source: 'resume' })
    await vi.waitFor(() => expect(agent.selections).toHaveLength(1))
    expect(agent.selections[0]).toEqual({ provider: 'cursor', model: 'default' })
    await ctx.fiber.dispose()
  })
})

describe('preset switch on a fresh session → re-select the route', () => {
  it('applies the preset route when the composer switches to a cursor preset', async () => {
    const agent = fakeAgent('session-10', { agentPreset: 'vv-controller' })
    const ctx = await mountWithProjections(new Map([[agent.id, agent]]))
    dispatcher(ctx).emit({}, 'agent/created', { agent, source: 'startup' })
    await vi.waitFor(() => expect(agent.selections).toHaveLength(1))
    expect(agent.selections[0]).toEqual({ provider: 'zai', model: 'glm-5.3', reasoningEffort: 'max' })

    dispatcher(ctx).emit({}, 'agent-preset/selected', agent.id, 'cursor/vv-controller')
    await vi.waitFor(() => expect(agent.selections).toHaveLength(2))
    expect(agent.selections[1]).toEqual({ provider: 'cursor', model: 'default' })
    await ctx.fiber.dispose()
  })

  it('restores the workspace default when the new preset has no route', async () => {
    const agent = fakeAgent('session-11', { agentPreset: 'cursor/vv-controller' })
    const ctx = await mountWithProjections(new Map([[agent.id, agent]]))
    dispatcher(ctx).emit({}, 'agent/created', { agent, source: 'startup' })
    await vi.waitFor(() => expect(agent.selections).toHaveLength(1))
    expect(agent.selections[0]).toEqual({ provider: 'cursor', model: 'default' })

    dispatcher(ctx).emit({}, 'agent-preset/selected', agent.id, 'vv-controller')
    await vi.waitFor(() => expect(agent.selections).toHaveLength(2))
    expect(agent.selections[1]).toEqual({ provider: 'zai', model: 'glm-5.3', reasoningEffort: 'max' })
    await ctx.fiber.dispose()
  })

  it('leaves the route alone once the session has logged a request header', async () => {
    const agent = fakeAgent('session-12', { agentPreset: 'vv-controller' }, true)
    const ctx = await mountWithProjections(new Map([[agent.id, agent]]))
    dispatcher(ctx).emit({}, 'agent-preset/selected', agent.id, 'cursor/vv-controller')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(agent.selections).toEqual([])
    await ctx.fiber.dispose()
  })

  it('never overrides a pending user model selection', async () => {
    const agent = fakeAgent('session-13', { agentPreset: 'vv-controller' })
    const ctx = await mountWithProjections(new Map([[agent.id, agent]]), true)
    dispatcher(ctx).emit({}, 'agent-preset/selected', agent.id, 'cursor/vv-controller')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(agent.selections).toEqual([])
    await ctx.fiber.dispose()
  })
})

describe('agent/request-error → degrade through model.select', () => {
  it('records the fallback route and delegates the failure', async () => {
    const ctx = await mount()
    const agent = fakeAgent()
    dispatcher(ctx).emit({}, 'agent/created', { agent, source: 'startup' })
    await vi.waitFor(() => expect(agent.selections).toHaveLength(1))

    const outcome = await dispatcher(ctx).waterfall(
      {},
      'agent/request-error',
      {
        agent,
        turn: 2,
        step: 1,
        signal: new AbortController().signal,
        provider: 'zai',
        failure: { code: 'QUOTA', message: 'quota exhausted' },
      },
      () => Promise.resolve(undefined),
    )
    // Delegation: the waterfall result is the next listener's (here: the seed).
    expect(outcome).toBeUndefined()
    await vi.waitFor(() => expect(agent.selections).toHaveLength(2))
    expect(agent.selections[1]).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' })
    await ctx.fiber.dispose()
  })

  it('never delegates AUTH problems into a route change', async () => {
    const ctx = await mount()
    const agent = fakeAgent()
    dispatcher(ctx).emit({}, 'agent/created', { agent, source: 'startup' })
    await vi.waitFor(() => expect(agent.selections).toHaveLength(1))

    await dispatcher(ctx).waterfall(
      {},
      'agent/request-error',
      {
        agent,
        turn: 2,
        step: 1,
        signal: new AbortController().signal,
        provider: 'zai',
        failure: { code: 'AUTH', message: 'bad key' },
      },
      () => Promise.resolve(undefined),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(agent.selections).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})

/**
 * Проводка жизненного цикла агента в шов `agent/request`.
 *
 * Регрессия, которую эти кейсы держат: 0.2 переименовал `agent/session-start`
 * в `agent/created`. Пока плагин слушал только старое имя, `sessionSource`
 * оставался `null`, и правило первого запроса всегда уходило в passthrough
 * «not-fresh-session» — маршрут `model.default` мастер-сессий не применялся
 * никогда, хотя юнит-тесты `decide` были зелёными.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as plugin from '../src/index.ts'

const POLICY = `
model:
  default:
    provider: zai
    model: glm-5.3
    reasoningEffort: max
  workers:
    provider: deepseek-official
    model: deepseek-flash
`

const BASE = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' }

let workspace: string

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'workspace-policy-lifecycle-'))
  await mkdir(join(workspace, '.dsh'), { recursive: true })
  await writeFile(join(workspace, '.dsh', 'workspace.yaml'), POLICY)
})

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true })
})

/** The slice of one Agent the policy seams read. */
function fakeAgent(id = 'session-1', header: Record<string, unknown> = {}) {
  return {
    id,
    session: {
      header: { id, cwd: workspace, isSeeded: false, ...header },
      requestHeader: () => undefined,
    },
  }
}

/** Mount the plugin with watching off, so no timer outlives the case. */
async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(plugin, { configFileName: '.dsh/workspace.yaml', watch: false, log: false })
  return ctx
}

/**
 * The agent seams are declared `Scoped<Agent>`, but a test drives them with a
 * stand-in `this` and a hand-built payload; this is the untyped view of the
 * very same shared event bus, so the assertions stay about real dispatch.
 */
interface RawDispatcher {
  emit(thisArg: object, name: string, payload: unknown): void
  waterfall(thisArg: object, name: string, payload: unknown, next: () => Promise<unknown>): Promise<unknown>
}

function dispatcher(ctx: Context): RawDispatcher {
  return ctx as unknown as RawDispatcher
}

/** Drive one first request through the request seam for the given agent. */
async function firstRequest(ctx: Context, agent: ReturnType<typeof fakeAgent>) {
  return dispatcher(ctx).waterfall(
    {},
    'agent/request',
    { agent, turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ ...BASE }),
  )
}

describe('agent lifecycle → first-request route', () => {
  it('applies the master route for a fresh session announced as `agent/created`', async () => {
    const ctx = await mount()
    const agent = fakeAgent()
    dispatcher(ctx).emit({}, 'agent/created', { agent, source: 'startup' })
    expect(await firstRequest(ctx, agent)).toEqual({ provider: 'zai', model: 'glm-5.3', reasoningEffort: 'max' })
    await ctx.fiber.dispose()
  })

  it('still applies the master route when only the legacy `agent/session-start` arrives', async () => {
    const ctx = await mount()
    const agent = fakeAgent()
    dispatcher(ctx).emit({}, 'agent/session-start', { agent, source: 'startup' })
    expect(await firstRequest(ctx, agent)).toEqual({ provider: 'zai', model: 'glm-5.3', reasoningEffort: 'max' })
    await ctx.fiber.dispose()
  })

  it('leaves a resumed session on its own route', async () => {
    const ctx = await mount()
    const agent = fakeAgent()
    dispatcher(ctx).emit({}, 'agent/created', { agent, source: 'resume' })
    expect(await firstRequest(ctx, agent)).toEqual(BASE)
    await ctx.fiber.dispose()
  })

  it('routes a delegated child to the workers route without any lifecycle source', async () => {
    const ctx = await mount()
    const agent = fakeAgent('child-1', { delegationDepth: 1 })
    dispatcher(ctx).emit({}, 'agent/created', { agent, source: 'startup' })
    expect(await firstRequest(ctx, agent)).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' })
    await ctx.fiber.dispose()
  })
})

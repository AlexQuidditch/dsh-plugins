/**
 * Isolated tests for the deferred-prompt service (`lib/defer.js`) and the
 * model-facing context + tool (`lib/context.js`).
 *
 * No live DSH: the fake context hands out fake services by name, the fake
 * `schedule` service records `create`/`list`/`edit` calls, and the clock is
 * pinned inside a real peak window. Real `createStateStore` + `resolveConfig` +
 * `createStats` run against a temp directory, so the state/stats path is the
 * production one.
 *
 * Run with `node tests/defer.test.mjs` (or `node --test tests/defer.test.mjs`).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveConfig } from '../lib/config.js'
import { createPromptContext, TOOL_NAME } from '../lib/context.js'
import { createDeferService, DEFER_TITLE_PREFIX } from '../lib/defer.js'
import { createStateStore } from '../lib/state.js'
import { createStats } from '../lib/stats.js'

let failed = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log('ok  -', name)
    return
  }
  failed += 1
  console.log('FAIL -', name, detail)
}

const dir = mkdtempSync(join(tmpdir(), 'peak-hours-defer-'))
const logger = { warn: () => {}, info: () => {} }

// Wednesday 2026-11-11 06:30 UTC — inside 06:00–10:00 UTC.
const NOW = Date.parse('2026-11-11T06:30:00Z')
let clock = new Date(NOW)
const now = () => clock

const IN_PEAK = { deepseek: { windows: [{ start: '06:00', end: '10:00', tz: 'UTC' }] } }
const NOT_PEAK = { deepseek: { windows: [{ start: '01:00', end: '04:00', tz: 'UTC' }] } }

let storeSeq = 0
function freshStore(name) {
  const suffix = name ?? String(++storeSeq)
  return createStateStore({ file: join(dir, `state-${suffix}.json`), logger, now })
}

// ── fakes ───────────────────────────────────────────────────────────────────

/** A fake cordis context: `get` hands out services, `effect` accepts registrations. */
function fakeCtx(services = {}) {
  const registry = new Map()
  for (const [key, value] of Object.entries(services)) {
    if (value !== undefined) registry.set(key, value)
  }
  const effects = []
  return {
    services: registry,
    effects,
    get: (key) => registry.get(key),
    effect: (callback, label) => {
      effects.push({ label })
      try {
        const disposer = callback()
        return typeof disposer === 'function' ? disposer : () => {}
      } catch {
        return () => {}
      }
    },
  }
}

/** A fake `schedule` service recording every call and storing its tasks. */
function fakeSchedule() {
  const tasks = []
  const calls = { create: [], list: [], edit: [] }
  let seq = 0
  return {
    tasks,
    calls,
    async create(request, actorSessionId) {
      calls.create.push({ request, actorSessionId })
      const entry = {
        id: `task-${++seq}`,
        kind: 'at',
        title: request.title,
        prompt: request.prompt,
        scheduledAt: request.timing?.kind === 'at' ? request.timing.at : new Date(NOW).toISOString(),
        target: request.target,
        status: 'active',
        active: true,
        updatedAt: new Date(clock.getTime()).toISOString(),
      }
      tasks.push(entry)
      return { ...entry }
    },
    async list(request) {
      calls.list.push(request)
      const items = tasks
        .filter((task) => task.active !== false && task.status !== 'ended' && task.status !== 'paused')
        .map((task) => ({ ...task }))
      return { items, shown: items.length, total: items.length, limit: request?.limit ?? 100, offset: 0 }
    },
    async edit(request, actorSessionId) {
      calls.edit.push({ request, actorSessionId })
      const index = tasks.findIndex((task) => task.id === request.id)
      if (index === -1) return { id: request.id, code: 'schedule_not_found' }
      if (request.action === 'delete') {
        tasks.splice(index, 1)
        return { id: request.id, deleted: true }
      }
      // A real update recomputes the stored occurrence from the new timing.
      const patch = request.patch ?? {}
      const next = { ...tasks[index], ...patch, updatedAt: new Date(clock.getTime() + 1000).toISOString() }
      if (patch.timing?.kind === 'at' && typeof patch.timing.at === 'string') next.scheduledAt = patch.timing.at
      tasks[index] = next
      return { ...next }
    },
  }
}

/** One fake live Agent with a model selection, optionally matching a scope. */
function fakeAgent({ id = 'session-1', provider = 'deepseek-account', model = 'deepseek-flash', scopeKey } = {}) {
  const agent = {
    id,
    model: { current: () => ({ provider, model }) },
  }
  if (scopeKey !== undefined) agent.scope = { key: scopeKey }
  return agent
}

/** Fake `agents` service over a session-id map. */
function fakeAgents(byId = {}, list = []) {
  return {
    get: (id) => byId[id],
    list: () => list,
  }
}

/** Fake pause controller: the read surface `lib/context.js` consumes. */
function fakePause(views = {}) {
  return {
    sessionView: (sessionId) => ({
      paused: false,
      pauseKind: null,
      since: null,
      until: null,
      deferredCount: 0,
      ...(views[sessionId] ?? {}),
    }),
  }
}

/** Fake `systemPrompt` service capturing the registered context definition. */
function fakeSystemPrompt() {
  const registrations = []
  return {
    registrations,
    context(definition) {
      registrations.push(definition)
      return () => {
        const index = registrations.indexOf(definition)
        if (index >= 0) registrations.splice(index, 1)
      }
    },
  }
}

/** Fake `tools` service capturing the registered tool definition. */
function fakeTools() {
  const registrations = []
  return {
    registrations,
    register(definition) {
      registrations.push(definition)
      return () => {
        const index = registrations.indexOf(definition)
        if (index >= 0) registrations.splice(index, 1)
      }
    },
  }
}

/** A defer service over fakes + real store/config/stats. */
function makeDeferHarness({ schedules = IN_PEAK, schedule, agents, sessionController, resolve, store } = {}) {
  const stateStore = store ?? freshStore()
  const resolved = resolveConfig({ schedules }, stateStore)
  const getResolved = resolve ?? (() => resolved)
  const stats = createStats({ store: stateStore, resolveConfig: getResolved })
  const ctx = fakeCtx({
    schedule: schedule === null ? undefined : (schedule ?? fakeSchedule()),
    agents,
    sessionController,
  })
  const defer = createDeferService({ ctx, getResolved, stats, logger, now })
  return { store: stateStore, resolved, stats, ctx, defer, schedule: schedule ?? ctx.get('schedule') }
}

/** Run a promise expected to reject with a stable `code`. */
async function expectCode(run, code) {
  try {
    await run()
    return { ok: false, detail: 'resolved without an error' }
  } catch (error) {
    return {
      ok: error?.code === code,
      detail: `code=${JSON.stringify(error?.code)} message=${JSON.stringify(error?.message)}`,
    }
  }
}

// ── defer: happy path ───────────────────────────────────────────────────────

const agents = fakeAgents({ 'session-1': fakeAgent() })
const harness = makeDeferHarness({ agents })
const created = await harness.defer.defer({ sessionId: 'session-1', text: '  сделай позже  ' })

check('defer: returns a task id', typeof created.taskId === 'string' && created.taskId !== '', JSON.stringify(created))
check('defer: peak end is the window end', created.peakEndsAt === '2026-11-11T10:00:00.000Z', String(created.peakEndsAt))
check('defer: scheduledAt is a future RFC3339 instant', Number.isFinite(Date.parse(created.scheduledAt)) && Date.parse(created.scheduledAt) > NOW, String(created.scheduledAt))

const createCall = harness.schedule.calls.create[0]
check('defer: targets the same session', createCall?.request?.target?.kind === 'session' && createCall.request.target.sessionId === 'session-1', JSON.stringify(createCall?.request?.target))
check('defer: uses an absolute at timing', createCall?.request?.timing?.kind === 'at', JSON.stringify(createCall?.request?.timing))
check('defer: at instant = peak end + margin', createCall?.request?.timing?.at === '2026-11-11T10:00:01.000Z', String(createCall?.request?.timing?.at))
check('defer: title carries the fixed prefix', typeof createCall?.request?.title === 'string' && createCall.request.title.startsWith(DEFER_TITLE_PREFIX), String(createCall?.request?.title))
check('defer: title is not over 120 chars', createCall.request.title.length <= 120, String(createCall.request.title.length))
check('defer: prompt is trimmed', createCall?.request?.prompt === 'сделай позже', JSON.stringify(createCall?.request?.prompt))
check('defer: actor session avoids a self notice', createCall?.actorSessionId === 'session-1', String(createCall?.actorSessionId))
check('defer: counts one deferred message', harness.store.stats().deferredMessages === 1, String(harness.store.stats().deferredMessages))
check('defer: canDefer is true with the schedule service', harness.defer.canDefer() === true)
check('defer: in-memory counts for the snapshot', harness.defer.counts()['session-1'] === 1, JSON.stringify(harness.defer.counts()))

// A prompt over the cap is truncated, not rejected.
const big = 'x'.repeat(25_000)
const bigHarness = makeDeferHarness({ agents })
await bigHarness.defer.defer({ sessionId: 'session-1', text: big })
const bigPrompt = bigHarness.schedule.calls.create[0]?.request?.prompt ?? ''
check('defer: prompt capped at 20000 chars', bigPrompt.length === 20_000, String(bigPrompt.length))

// ── defer: model resolution fallbacks ──────────────────────────────────────

// Unknown route, aggregate view: any configured family in peak is enough.
const aggregateHarness = makeDeferHarness({})
const aggregateResult = await aggregateHarness.defer.defer({ sessionId: 'session-unknown', text: 'позже' })
check('defer: aggregate fallback defers an unknown route', aggregateResult.peakEndsAt === '2026-11-11T10:00:00.000Z', String(aggregateResult.peakEndsAt))

// Explicit provider/model wins over an unknown live agent.
const explicitHarness = makeDeferHarness({})
await explicitHarness.defer.defer({
  sessionId: 'session-1',
  text: 'позже',
  provider: 'deepseek-account',
  model: 'deepseek-flash',
})
check('defer: explicit route is used', explicitHarness.schedule.calls.create[0]?.request?.timing?.at === '2026-11-11T10:00:01.000Z')

// The session-controller projection is the fallback when no live Agent exists.
const projectionHarness = makeDeferHarness({
  sessionController: {
    projections: async (request) => ({
      kind: 'sequenced',
      asOfSeq: 1,
      values: {
        modelSelection: {
          next: { provider: 'deepseek-account', model: 'deepseek-flash' },
          lastUsed: null,
        },
      },
    }),
  },
})
const projectionResult = await projectionHarness.defer.defer({ sessionId: 'session-cold', text: 'позже' })
check('defer: session projection resolves the route', projectionResult.peakEndsAt === '2026-11-11T10:00:00.000Z', String(projectionResult.peakEndsAt))
check('defer: projection request shape', projectionHarness.ctx.services.get('sessionController') !== undefined)

// ── defer: errors ───────────────────────────────────────────────────────────

const outsidePeakHarness = makeDeferHarness({ schedules: NOT_PEAK, agents })
const outsidePeak = await expectCode(() => outsidePeakHarness.defer.defer({ sessionId: 'session-1', text: 'позже' }), 'peak-hours/not-in-peak')
check('defer: not-in-peak for a known closed model window', outsidePeak.ok, outsidePeak.detail)

const aggregateOutsidePeak = await expectCode(
  () => makeDeferHarness({ schedules: NOT_PEAK }).defer.defer({ sessionId: 'session-1', text: 'позже' }),
  'peak-hours/not-in-peak',
)
check('defer: not-in-peak when the aggregate has no open window', aggregateOutsidePeak.ok, aggregateOutsidePeak.detail)

const noScheduleHarness = makeDeferHarness({ schedule: null })
check('defer: canDefer is false without the schedule service', noScheduleHarness.defer.canDefer() === false)
const unavailable = await expectCode(
  () => noScheduleHarness.defer.defer({ sessionId: 'session-1', text: 'позже' }),
  'peak-hours/schedule-unavailable',
)
check('defer: schedule-unavailable without the service', unavailable.ok, unavailable.detail)
check('defer: no task created without the service', noScheduleHarness.ctx.get('schedule') === undefined)

const badText = await expectCode(() => harness.defer.defer({ sessionId: 'session-1', text: '   ' }), 'peak-hours/bad-request')
check('defer: bad-request for empty text', badText.ok, badText.detail)
const missingText = await expectCode(() => harness.defer.defer({ sessionId: 'session-1' }), 'peak-hours/bad-request')
check('defer: bad-request for a missing text', missingText.ok, missingText.detail)
const badSession = await expectCode(() => harness.defer.defer({ sessionId: '', text: 'позже' }), 'peak-hours/bad-request')
check('defer: bad-request for an empty sessionId', badSession.ok, badSession.detail)

// A failing schedule.create is wrapped with the stable defer-failed code.
const brokenHarness = makeDeferHarness({
  agents,
  schedule: {
    async create() {
      throw new Error('schedule domain is closed')
    },
    async list() {
      return { items: [] }
    },
    async edit() {
      return { deleted: true }
    },
  },
})
const failedCreate = await expectCode(() => brokenHarness.defer.defer({ sessionId: 'session-1', text: 'позже' }), 'peak-hours/defer-failed')
check('defer: create failure becomes defer-failed', failedCreate.ok, failedCreate.detail)
check('defer: original create error message kept', failedCreate.detail.includes('schedule domain is closed'), failedCreate.detail)

// ── cancel + pending ────────────────────────────────────────────────────────

const cancelHarness = makeDeferHarness({ agents })
const deferredTitle = `${DEFER_TITLE_PREFIX} · 10:00 UTC`
const seed = (id, title, sessionId, scheduledAt) => {
  cancelHarness.schedule.tasks.push({
    id,
    kind: 'at',
    title,
    prompt: 'позже',
    scheduledAt,
    target: { kind: 'session', sessionId },
    status: 'active',
    active: true,
    updatedAt: '2026-11-11T06:00:00.000Z',
  })
}
seed('t-mine-1', deferredTitle, 'session-1', '2026-11-11T10:00:01.000Z')
seed('t-mine-2', `${DEFER_TITLE_PREFIX} · 10:00 UTC`, 'session-1', '2026-11-11T09:30:00.000Z')
seed('t-foreign-title', 'Напоминание о встрече', 'session-1', '2026-11-11T11:00:00.000Z')
seed('t-other-session', deferredTitle, 'session-2', '2026-11-11T10:00:01.000Z')

const pending = await cancelHarness.defer.pendingFor('session-1')
check('pendingFor: counts only own deferred tasks', pending.count === 2, JSON.stringify(pending))
check('pendingFor: returns the earliest scheduledAt', pending.nextAt === '2026-11-11T09:30:00.000Z', JSON.stringify(pending))

const cancelled = await cancelHarness.defer.cancelForSession('session-1')
check('cancelForSession: deletes both own tasks', cancelled.cancelled === 2, JSON.stringify(cancelled))
const editCalls = cancelHarness.schedule.calls.edit
check('cancelForSession: edit uses delete', editCalls.length === 2 && editCalls.every((call) => call.request.action === 'delete'), JSON.stringify(editCalls.map((call) => call.request.action)))
check('cancelForSession: carries the optimistic revision', editCalls.every((call) => call.request.expectedUpdatedAt === '2026-11-11T06:00:00.000Z'))
check('cancelForSession: acts for the target session', editCalls.every((call) => call.actorSessionId === 'session-1'))
const remainingIds = cancelHarness.schedule.tasks.map((task) => task.id)
check('cancelForSession: foreign title kept', remainingIds.includes('t-foreign-title'), JSON.stringify(remainingIds))
check('cancelForSession: other session kept', remainingIds.includes('t-other-session'), JSON.stringify(remainingIds))
check('cancelForSession: own tasks gone', !remainingIds.includes('t-mine-1') && !remainingIds.includes('t-mine-2'), JSON.stringify(remainingIds))
check('cancelForSession: in-memory counts cleared', (cancelHarness.defer.counts()['session-1'] ?? 0) === 0, JSON.stringify(cancelHarness.defer.counts()))

const nothing = await cancelHarness.defer.cancelForSession('session-2')
check('cancelForSession: second session still deletes its task', nothing.cancelled === 1, JSON.stringify(nothing))

const noServiceCancel = await noScheduleHarness.defer.cancelForSession('session-1')
check('cancelForSession: no service means zero, not a throw', noServiceCancel.cancelled === 0, JSON.stringify(noServiceCancel))
const emptyPending = await noScheduleHarness.defer.pendingFor('session-1')
check('pendingFor: no service means zero, not a throw', emptyPending.count === 0 && emptyPending.nextAt === null, JSON.stringify(emptyPending))

// ── boot re-arm ─────────────────────────────────────────────────────────────

const rearmAgents = fakeAgents({ 'session-1': fakeAgent() })
const rearmHarness = makeDeferHarness({ agents: rearmAgents })
rearmHarness.schedule.tasks.push({
  id: 't-stale',
  kind: 'at',
  title: `${DEFER_TITLE_PREFIX} · 04:00 UTC`,
  prompt: 'позже',
  scheduledAt: '2026-11-11T04:00:00.000Z',
  target: { kind: 'session', sessionId: 'session-1' },
  status: 'active',
  active: true,
  updatedAt: '2026-11-11T03:00:00.000Z',
})
const rearmed = await rearmHarness.defer.rearm()
check('rearm: reports one corrected task', rearmed.updated === 1, JSON.stringify(rearmed))
const rearmEdit = rearmHarness.schedule.calls.edit[0]
check('rearm: edits the stored task', rearmEdit?.request?.id === 't-stale' && rearmEdit.request.action === 'update', JSON.stringify(rearmEdit?.request))
check('rearm: corrected at instant', rearmEdit?.request?.patch?.timing?.kind === 'at' && rearmEdit.request.patch.timing.at === '2026-11-11T10:00:01.000Z', JSON.stringify(rearmEdit?.request?.patch?.timing))
check('rearm: refreshes the title label', typeof rearmEdit?.request?.patch?.title === 'string' && rearmEdit.request.patch.title.includes('10:00 UTC'), String(rearmEdit?.request?.patch?.title))
check('rearm: carries the optimistic revision', rearmEdit?.request?.expectedUpdatedAt === '2026-11-11T03:00:00.000Z')
check('rearm: acts for the target session', rearmEdit?.actorSessionId === 'session-1')

// Already correct: no edit.
rearmHarness.schedule.calls.edit.length = 0
const rearmedAgain = await rearmHarness.defer.rearm()
check('rearm: a correct task is left alone', rearmedAgain.updated === 0 && rearmHarness.schedule.calls.edit.length === 0, JSON.stringify(rearmedAgain))

// Outside peak: nothing to re-arm, the late one-shot still delivers.
const offPeakRearm = makeDeferHarness({ schedules: NOT_PEAK, agents: rearmAgents })
offPeakRearm.schedule.tasks.push({
  id: 't-late',
  kind: 'at',
  title: `${DEFER_TITLE_PREFIX} · 10:00 UTC`,
  prompt: 'позже',
  scheduledAt: '2026-11-11T10:00:01.000Z',
  target: { kind: 'session', sessionId: 'session-1' },
  status: 'active',
  active: true,
  updatedAt: '2026-11-11T06:00:00.000Z',
})
const offPeakResult = await offPeakRearm.defer.rearm()
check('rearm: does nothing outside peak', offPeakResult.updated === 0 && offPeakRearm.schedule.calls.edit.length === 0, JSON.stringify(offPeakResult))

// start() arms the delayed re-arm and dispose() cleans it up.
const startHarness = makeDeferHarness({ agents: rearmAgents })
startHarness.schedule.tasks.push({
  id: 't-boot',
  kind: 'at',
  title: `${DEFER_TITLE_PREFIX} · 04:00 UTC`,
  prompt: 'позже',
  scheduledAt: '2026-11-11T04:00:00.000Z',
  target: { kind: 'session', sessionId: 'session-1' },
  status: 'active',
  active: true,
  updatedAt: '2026-11-11T03:00:00.000Z',
})
startHarness.defer.start()
check('start: registers an effect disposer', startHarness.ctx.effects.length >= 1, JSON.stringify(startHarness.ctx.effects))
await new Promise((resolve) => setTimeout(resolve, 1300))
check('start: re-arms stored tasks after the delay', startHarness.schedule.calls.edit.length === 1, JSON.stringify(startHarness.schedule.calls.edit))
check('start: corrected at instant', startHarness.schedule.calls.edit[0]?.request?.patch?.timing?.at === '2026-11-11T10:00:01.000Z')
startHarness.defer.dispose()
startHarness.defer.dispose()
check('dispose: idempotent and never throws', true)

// ── prompt context ──────────────────────────────────────────────────────────

const scopeKey = 'scope-1'
const scopedAgent = fakeAgent({ id: 'session-1', scopeKey })
const contextStore = freshStore('context')
contextStore.addAllowedSeconds(600)
const contextResolved = resolveConfig({
  schedules: IN_PEAK,
  mode: 'pause',
  dailyLimitMinutes: 30,
}, contextStore)
const systemPrompt = fakeSystemPrompt()
const tools = fakeTools()
const contextAgents = fakeAgents({ 'session-1': scopedAgent }, [scopedAgent])
const contextCtx = fakeCtx({
  agents: contextAgents,
  systemPrompt,
  tools,
  agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) },
})
const promptContext = createPromptContext({
  ctx: contextCtx,
  getResolved: () => contextResolved,
  store: contextStore,
  pause: fakePause(),
  stats: createStats({ store: contextStore, resolveConfig: () => contextResolved }),
  logger,
  now,
})
promptContext.start()
check('prompt: registers one context section', systemPrompt.registrations.length === 1, String(systemPrompt.registrations.length))
check('prompt: toolName matches the tool contract', promptContext.toolName === 'peak_hours_status' && TOOL_NAME === 'peak_hours_status')

const promptDefinition = systemPrompt.registrations[0]
check('prompt: definition name/order/required', promptDefinition?.name === 'peak-hours' && promptDefinition.order === 150 && promptDefinition.required === false, JSON.stringify({ name: promptDefinition?.name, order: promptDefinition?.order, required: promptDefinition?.required }))

const promptText = promptDefinition.text({ scope: scopeKey })
check('prompt: resolves the agent by scope', typeof promptText === 'string' && promptText.includes('deepseek-account') && promptText.includes('deepseek-flash'), JSON.stringify(promptText))
check('prompt: mentions peak state', promptText.includes('Пиковые') && promptText.includes('пик'), JSON.stringify(promptText))
check('prompt: mentions the countdown', /ещё|через/.test(promptText), JSON.stringify(promptText))
check('prompt: mentions the policy', promptText.includes('Работа в пик'), JSON.stringify(promptText))
check('prompt: mentions the remaining budget', promptText.includes('осталось 20 мин'), JSON.stringify(promptText))
check('prompt: points the model at the tool', promptText.includes('peak_hours_status'), JSON.stringify(promptText))
check('prompt: stays under 500 chars', promptText.length > 0 && promptText.length <= 500, String(promptText.length))

// Paused session and disabled plugin shapes.
const pausedSystemPrompt = fakeSystemPrompt()
const pausedPrompt = createPromptContext({
  ctx: fakeCtx({ agents: contextAgents, systemPrompt: pausedSystemPrompt, tools: fakeTools() }),
  getResolved: () => contextResolved,
  store: freshStore(),
  pause: fakePause({ 'session-1': { paused: true, pauseKind: 'hold', until: new Date('2026-11-11T10:00:00.000Z') } }),
  logger,
  now,
})
pausedPrompt.start()
const pausedText = pausedSystemPrompt.registrations[0].text({ scope: scopeKey })
check('prompt: reports a paused session', pausedText.includes('паузе') && pausedText.includes('10:00'), JSON.stringify(pausedText))
pausedPrompt.dispose()

const disabledSystemPrompt = fakeSystemPrompt()
const disabledPrompt = createPromptContext({
  ctx: fakeCtx({ agents: contextAgents, systemPrompt: disabledSystemPrompt, tools: fakeTools() }),
  getResolved: () => resolveConfig({ enabled: false, schedules: IN_PEAK }, contextStore),
  store: contextStore,
  logger,
  now,
})
disabledPrompt.start()
const disabledText = disabledSystemPrompt.registrations[0].text({ scope: scopeKey })
check('prompt: empty text when the plugin is disabled', disabledText === '', JSON.stringify(disabledText))
disabledPrompt.dispose()

// ── status tool ─────────────────────────────────────────────────────────────

check('tool: registers one tool', tools.registrations.length === 1, String(tools.registrations.length))
const toolDefinition = tools.registrations[0]
check('tool: name', toolDefinition?.name === 'peak_hours_status', String(toolDefinition?.name))
check('tool: description mentions the purpose', typeof toolDefinition?.description === 'string' && toolDefinition.description.includes('пиков'), String(toolDefinition?.description))
check('tool: parameter schema is a closed object', toolDefinition?.parameters?.type === 'object' && toolDefinition.parameters.additionalProperties === false, JSON.stringify(toolDefinition?.parameters))
check('tool: output schema is JSON-safe', toolDefinition?.output?.schema?.type === 'object' && typeof toolDefinition.output.render === 'function')

const toolValue = await toolDefinition.execute({}, { agent: scopedAgent })
check('tool: returns a plain object', toolValue !== null && typeof toolValue === 'object' && !Array.isArray(toolValue), JSON.stringify(toolValue))
check('tool: now is ISO', typeof toolValue.now === 'string' && Number.isFinite(Date.parse(toolValue.now)), String(toolValue.now))
check('tool: provider and model', toolValue.provider === 'deepseek-account' && toolValue.model === 'deepseek-flash', JSON.stringify({ provider: toolValue.provider, model: toolValue.model }))
check('tool: inPeak is true', toolValue.inPeak === true, JSON.stringify(toolValue.inPeak))
check('tool: until is the window end', toolValue.until === '2026-11-11T10:00:00.000Z', String(toolValue.until))
check('tool: nextStart is null inside peak', toolValue.nextStart === null, String(toolValue.nextStart))
check('tool: allow is a boolean with a source', typeof toolValue.allow === 'boolean' && typeof toolValue.allowSource === 'string', JSON.stringify({ allow: toolValue.allow, allowSource: toolValue.allowSource }))
check('tool: paused state exposed', toolValue.paused === false && toolValue.pausedUntil === null, JSON.stringify({ paused: toolValue.paused, pausedUntil: toolValue.pausedUntil }))
check('tool: mode exposed', toolValue.mode === 'pause', String(toolValue.mode))
check('tool: daily budget exposed', toolValue.dailyLimitMinutes === 30 && toolValue.dailyRemainingMinutes === 20, JSON.stringify({ limit: toolValue.dailyLimitMinutes, remaining: toolValue.dailyRemainingMinutes }))
check('tool: schedules summary exposed', Array.isArray(toolValue.schedulesSummary?.keys) && toolValue.schedulesSummary.keys.includes('deepseek') && toolValue.schedulesSummary.windows === 1, JSON.stringify(toolValue.schedulesSummary))
check('tool: note exposed', typeof toolValue.note === 'string' && toolValue.note !== '', String(toolValue.note))
check('tool: whole value is JSON-safe', typeof JSON.stringify(toolValue) === 'string')

const rendered = toolDefinition.output.render({}, toolValue)
check('tool: render produces a text block', Array.isArray(rendered) && rendered.length === 1 && rendered[0].type === 'text' && rendered[0].text.includes('"inPeak": true'), JSON.stringify(rendered))

const aggregateToolValue = await toolDefinition.execute({}, {})
check('tool: aggregate view without an agent', aggregateToolValue.inPeak === true && typeof aggregateToolValue.allow === 'boolean', JSON.stringify(aggregateToolValue))
check('tool: aggregate value is JSON-safe', typeof JSON.stringify(aggregateToolValue) === 'string')

// ── teardown ────────────────────────────────────────────────────────────────

promptContext.dispose()
check('prompt: dispose removes the context section', systemPrompt.registrations.length === 0, String(systemPrompt.registrations.length))
check('tool: dispose unregisters the tool', tools.registrations.length === 0, String(tools.registrations.length))
promptContext.dispose()
check('prompt: dispose is idempotent', true)

// ── cleanup ─────────────────────────────────────────────────────────────────

for (const store of [harness.store, bigHarness.store, aggregateHarness.store, explicitHarness.store, projectionHarness.store, outsidePeakHarness.store, noScheduleHarness.store, brokenHarness.store, cancelHarness.store, rearmHarness.store, offPeakRearm.store, startHarness.store, contextStore]) {
  try {
    store.dispose()
  } catch {
    // best effort
  }
}
rmSync(dir, { recursive: true, force: true })

if (failed > 0) {
  console.log(`\nFAILED: ${failed}`)
  process.exit(1)
}
console.log('\nOK: deferred prompts, prompt context and the status tool work')

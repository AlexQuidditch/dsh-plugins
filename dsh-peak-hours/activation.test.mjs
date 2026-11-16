/**
 * Isolated integration test for dsh-peak-hours (host half).
 *
 * Mounts the real `apply()` over a hand-made cordis-like context, so the test
 * exercises the real wiring: the `agent/pre-step` pause controller, the
 * `llm/stream` gate, the Connection RPC channel, the prompt context/tool and
 * the persisted state file. Nothing live is touched: `DSH_HOME` points at a
 * temp directory and every Host service is a fake.
 *
 * Run with `node activation.test.mjs`.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFER_TITLE_PREFIX } from './lib/defer.js'
import { TOOL_NAME } from './lib/context.js'
import { apply, inject as pluginInject, name as pluginName } from './lib/index.js'

let failed = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log('ok  -', name)
    return
  }
  failed += 1
  console.log('FAIL -', name, detail)
}

const SESSION_ID = 'session-1'
const MODEL = { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'max' }

/** A UTC HH:MM window covering the current minute entirely. */
function allDayWindow() {
  return { start: '00:00', end: '23:59', tz: 'UTC' }
}

function createAgentOverrides() {
  const calls = { restored: [], sent: [], flushes: 0 }
  const agent = {
    id: SESSION_ID,
    session: { id: SESSION_ID, header: { origin: 'user' } },
    model: { current: () => MODEL },
    inbox: {
      nextStep: [],
      nextTurn: [],
      prepend(target, message) {
        calls.restored.push({ target, message })
      },
    },
    send(message, target, wakeup) {
      calls.sent.push({ message, target, wakeup })
    },
  }
  return { agent, calls }
}

/**
 * Mount the plugin over a fake Host context.
 *
 * @param {object} options
 * @param {object} options.config - bundle config passed to `apply`.
 * @param {object} [options.agentOverrides] - agent/call recorder override.
 */
async function mount({ config, agentOverrides }) {
  const home = mkdtempSync(join(tmpdir(), 'peak-hours-activation-'))
  process.env.DSH_HOME = home
  const previousHome = process.env.DSH_HOME
  const { agent, calls } = agentOverrides ?? createAgentOverrides()
  const captured = {
    listeners: new Map(),
    rpcChannel: null,
    rpcHandler: null,
    promptContext: null,
    tool: null,
    contexts: [],
    handlers: {},
    schedule: {
      created: [],
      edited: [],
      deleted: [],
      async create(request, actorSessionId) {
        captured.schedule.created.push({ request, actorSessionId })
        return {
          id: `task-${captured.schedule.created.length}`,
          title: request.title,
          scheduledAt: request.timing.at ?? new Date(Date.now() + 60_000).toISOString(),
          kind: 'at',
          target: request.target,
          updatedAt: '2026-11-11T08:00:00.000Z',
          active: true,
        }
      },
      async list() {
        return { items: [], shown: 0, total: 0, limit: 100, offset: 0 }
      },
      async edit(request) {
        captured.schedule.edited.push(request)
        return { id: request.id, deleted: true }
      },
    },
  }
  const session = { id: SESSION_ID, header: { origin: 'user' }, requestHeader: () => undefined }
  const services = {
    connection: {
      rpc: {
        handle(channel, handler) {
          captured.rpcChannel = channel
          captured.rpcHandler = handler
          return () => {}
        },
      },
    },
    webServer: {},
    agents: {
      get: (id) => (id === SESSION_ID ? agent : undefined),
      list: () => [agent],
    },
    sessions: {
      get: (id) => (id === SESSION_ID ? session : undefined),
      async flush() {
        calls.flushes += 1
        return true
      },
    },
    sessionProjections: {
      snapshot: () => ({ modelSelection: { lastUsed: null, next: null } }),
    },
    agentDefaultModel: {
      currentSelection: () => MODEL,
    },
    schedule: captured.schedule,
    llm: {
      async listModels(provider) {
        return provider === 'deepseek-account' ? [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }] : []
      },
    },
    goals: { get: () => undefined },
    systemPrompt: {
      context(definition) {
        captured.promptContext = definition
        return () => {}
      },
    },
    tools: {
      register(definition) {
        captured.tool = definition
        return () => {}
      },
    },
  }
  const disposers = []
  const fakeWebCtx = {
    root: { get: (key) => services[key] },
    get: (key) => services[key],
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
      return () => {}
    },
  }
  const ctx = {
    logger: {
      info() {},
      warn() {},
      debug() {},
    },
    services,
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
      return () => {}
    },
    on(event, listener, options) {
      captured.listeners.set(event, { listener, options })
      return () => captured.listeners.delete(event)
    },
    get(key) {
      return services[key]
    },
    inject(keys, callback) {
      callback(fakeWebCtx)
    },
    root: fakeWebCtx,
  }
  apply(ctx, config)
  // The lifecycle disposer captured by apply() unwinds the controllers.
  const dispose = () => {
    for (const disposer of disposers.splice(0)) {
      try {
        disposer()
      } catch {
        // best effort
      }
    }
    rmSync(home, { recursive: true, force: true })
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
  return { ctx, captured, calls, agent, home, dispose }
}

async function rpc(mounted, endpoint, payload) {
  return mounted.captured.rpcHandler(endpoint, payload)
}

// ── 1. wiring + snapshot ────────────────────────────────────────────────────
{
  const mounted = await mount({
    config: {
      enabled: true,
      mode: 'pause',
      allowPeak: false,
      dailyLimitMinutes: 30,
      schedules: {
        deepseek: {
          windows: [allDayWindow()],
          holidays: { tz: 'Asia/Shanghai', ranges: [['2026-12-25', '2026-12-26']] },
        },
      },
    },
  })
  try {
    check('wiring: rpc channel path', mounted.captured.rpcChannel === '/dsh-peak-hours', String(mounted.captured.rpcChannel))
    check('wiring: pre-step listener registered', typeof mounted.captured.listeners.get('agent/pre-step')?.listener === 'function')
    check('wiring: llm/stream listener registered', typeof mounted.captured.listeners.get('llm/stream')?.listener === 'function')
    check('wiring: prompt context registered', mounted.captured.promptContext?.name === 'peak-hours')
    check('wiring: status tool registered', mounted.captured.tool?.name === TOOL_NAME)

    const state = await rpc(mounted, 'state', { sessionId: SESSION_ID })
    check('state: ok envelope', state.ok === true, JSON.stringify(state))
    const value = state.value
    check('state: session model resolved from the live agent', value.session?.provider === 'deepseek-account' && value.session?.model === 'deepseek-flash', JSON.stringify(value.session))
    check('state: in peak', value.session?.inPeak === true && value.session?.known === true, JSON.stringify(value.session))
    check('state: peak work not allowed by default', value.session?.allow === false && value.session?.allowSource === 'default')
    check('state: effective windows', value.session?.effectiveWindows?.length === 1)
    check('state: model display name resolved from the catalog', value.session?.modelName === 'DeepSeek-V4.1-Flash', JSON.stringify(value.session?.modelName))
    check('state: holiday exclusions carried with the effective windows', value.session?.effectiveWindows?.[0]?.holidays?.ranges?.length === 1, JSON.stringify(value.session?.effectiveWindows?.[0]?.holidays))
    check('state: can defer with the schedule service', value.canDefer === true)
    check('state: daily limit exposed', value.limit?.dailyMinutes === 30 && value.limit?.remainingSeconds === 1800, JSON.stringify(value.limit))
    check('state: schedules carried for the settings page', value.schedules?.deepseek?.windows?.length === 1)
    check('state: no session snapshot without sessionId', (await rpc(mounted, 'state', {})).value.session === null)

    const globalAllow = await rpc(mounted, 'set-allow-peak', { allowPeak: true, scope: 'default' })
    check('set-allow-peak: global default flips', globalAllow.ok === true && globalAllow.value.settings.allowPeakDefault === true)
    check('set-allow-peak: persisted globally', JSON.parse(readFileSync(join(mounted.home, 'peak-hours.json'), 'utf8')).settings.allowPeakDefault === true)
    await rpc(mounted, 'set-allow-peak', { allowPeak: false, scope: 'default' })

    const sessionAllow = await rpc(mounted, 'set-allow-peak', { sessionId: SESSION_ID, allowPeak: true, until: 'peak-end' })
    check('set-allow-peak: session override with peak-end expiry', sessionAllow.value.session?.allow === true && typeof sessionAllow.value.session?.allowUntil === 'string', JSON.stringify(sessionAllow.value.session))
    const stored = JSON.parse(readFileSync(join(mounted.home, 'peak-hours.json'), 'utf8'))
    check('set-allow-peak: session override persisted', stored.sessions?.[SESSION_ID]?.allowPeak === true && typeof stored.sessions[SESSION_ID].until === 'string')

    const paused = await rpc(mounted, 'pause-now', { sessionId: SESSION_ID })
    check('pause-now: override off', paused.value.session?.allow === false && paused.value.session?.allowSource === 'session')

    const deferred = await rpc(mounted, 'defer', { sessionId: SESSION_ID, text: 'сделай отчёт после пика' })
    check('defer: schedule task created', deferred.ok === true && mounted.captured.schedule.created.length === 1, JSON.stringify(deferred))
    const created = mounted.captured.schedule.created[0]
    check('defer: title marker', created.request.title.startsWith(DEFER_TITLE_PREFIX), created.request.title)
    check('defer: targets the session', created.request.target?.kind === 'session' && created.request.target.sessionId === SESSION_ID)
    check('defer: at-timing in the future', created.request.timing?.kind === 'at' && Date.parse(created.request.timing.at) > Date.now())
    check('defer: actor session suppresses the notice', created.actorSessionId === SESSION_ID)
    check('defer: stats counted', (await rpc(mounted, 'state', { sessionId: SESSION_ID })).value.stats.deferredMessages >= 1)

    const badDefer = await rpc(mounted, 'defer', { sessionId: SESSION_ID, text: '   ' })
    check('defer: empty text rejected', badDefer.ok === false && badDefer.error.code === 'peak-hours/bad-request', JSON.stringify(badDefer))

    const savedSchedules = await rpc(mounted, 'save-schedules', {
      schedules: { zai: { windows: [{ start: '14:00', end: '18:00', tz: 'Asia/Shanghai' }] } },
    })
    check('save-schedules: user override applied', savedSchedules.ok === true && savedSchedules.value.schedules.deepseek === undefined && savedSchedules.value.schedulesSource === 'user')
    const resetSchedules = await rpc(mounted, 'save-schedules', { schedules: null })
    check('save-schedules: reset to bundle', resetSchedules.value.schedulesSource === 'bundle' && resetSchedules.value.schedules.deepseek !== undefined)

    const savedSettings = await rpc(mounted, 'save-settings', { patch: { mode: 'hard', dailyLimitMinutes: null } })
    check('save-settings: mode applied', savedSettings.value.mode === 'hard')
    check('save-settings: null limit means unlimited', savedSettings.value.limit.dailyMinutes === null)

    const resetStats = await rpc(mounted, 'reset-stats', {})
    check('reset-stats: counters cleared', resetStats.value.stats.deferredMessages === 0)

    check('rpc: unknown endpoint refuses', (await rpc(mounted, 'nope', {})).error.code === 'peak-hours/unknown-endpoint')
  } finally {
    mounted.dispose()
  }
}

// ── 2. pre-step HOLD + resume-now ───────────────────────────────────────────
{
  const mounted = await mount({
    config: {
      enabled: true,
      mode: 'pause',
      allowPeak: false,
      pause: { strategy: 'hold', maxHoldMinutes: 60 },
      schedules: { deepseek: { windows: [allDayWindow()] } },
    },
  })
  try {
    const listener = mounted.captured.listeners.get('agent/pre-step').listener
    let nextCalled = 0
    const decision = listener(
      {
        agent: mounted.agent,
        messages: [{ id: 'm-1', role: 'user', content: [{ type: 'text', text: 'продолжай' }], source: { kind: 'user' } }],
        turn: 1,
        step: 1,
        signal: new AbortController().signal,
        modelSelection: MODEL,
      },
      async () => {
        nextCalled += 1
        return { kind: 'enter', messages: [] }
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    check('pause: the step is held while in peak', nextCalled === 0)
    const during = await rpc(mounted, 'state', { sessionId: SESSION_ID })
    check('pause: snapshot reports a hold', during.value.session?.paused === true && during.value.session?.pauseKind === 'hold', JSON.stringify(during.value.session))
    check('pause: checkpoint flushed the session', mounted.calls.flushes >= 1)

    const resumed = await rpc(mounted, 'resume-now', { sessionId: SESSION_ID })
    check('pause: resume-now acknowledged', resumed.ok === true && resumed.value.delivered >= 0)
    const settled = await decision
    check('pause: step enters after resume', settled.kind === 'enter' && nextCalled === 1, JSON.stringify(settled))
    const after = await rpc(mounted, 'state', { sessionId: SESSION_ID })
    check('pause: no longer paused', after.value.session?.paused === false)
    check('pause: held step counted', after.value.stats.heldSteps === 1, JSON.stringify(after.value.stats))
    check('pause: marked turns persisted', JSON.stringify(after.value.session?.pausedTurns) === '[1]', JSON.stringify(after.value.session?.pausedTurns))
  } finally {
    mounted.dispose()
  }
}

// ── 3. pre-step REQUEUE (long pause) ────────────────────────────────────────
{
  const mounted = await mount({
    config: {
      enabled: true,
      mode: 'pause',
      allowPeak: false,
      pause: { strategy: 'requeue' },
      schedules: { deepseek: { windows: [allDayWindow()] } },
    },
  })
  try {
    const listener = mounted.captured.listeners.get('agent/pre-step').listener
    const decision = await listener(
      {
        agent: mounted.agent,
        messages: [{ id: 'm-2', role: 'user', content: [{ type: 'text', text: 'сделай анализ' }], source: { kind: 'user' } }],
        turn: 2,
        step: 1,
        signal: new AbortController().signal,
        modelSelection: MODEL,
      },
      async () => ({ kind: 'enter', messages: [] }),
    )
    check('requeue: the step is rejected instead of held', decision.kind === 'reject', JSON.stringify(decision))
    const state = await rpc(mounted, 'state', { sessionId: SESSION_ID })
    check('requeue: published as a queued pause', state.value.session?.pauseKind === 'queued' && state.value.session?.paused === true, JSON.stringify(state.value.session))
    const stored = JSON.parse(readFileSync(join(mounted.home, 'peak-hours.json'), 'utf8'))
    check('requeue: message queued durably', stored.deferred?.[SESSION_ID]?.length === 1 && stored.deferred[SESSION_ID][0].message.id === 'm-2', JSON.stringify(stored.deferred))
    check('requeue: deferred counted', state.value.stats.deferredMessages === 1)
  } finally {
    mounted.dispose()
  }
}

// ── 4. hard mode in the llm/stream gate ─────────────────────────────────────
{
  const mounted = await mount({
    config: { enabled: true, mode: 'hard', allowPeak: false, schedules: { deepseek: { windows: [allDayWindow()] } } },
  })
  try {
    const gate = mounted.captured.listeners.get('llm/stream').listener
    let blocked
    try {
      gate({ provider: 'deepseek-account', model: 'deepseek-flash', sessionId: SESSION_ID }, function* () {})
      blocked = false
    } catch (error) {
      blocked = true
      check('hard: PEAK_HOURS_BLOCK names the provider', String(error?.message).includes('PEAK_HOURS_BLOCK') && String(error?.message).includes('deepseek-account'), String(error?.message))
      check('hard: structured error code', error?.code === 'PEAK_HOURS_BLOCK', String(error?.code))
    }
    check('hard: conversation call blocked in peak', blocked === true)

    let passThrough = false
    try {
      gate({ provider: 'zai', model: 'glm-5.3', sessionId: SESSION_ID }, function* () { passThrough = true })
      passThrough = true
    } catch {
      passThrough = false
    }
    check('hard: unrelated provider passes', passThrough === true)

    await rpc(mounted, 'set-allow-peak', { sessionId: SESSION_ID, allowPeak: true })
    let allowed = false
    try {
      gate({ provider: 'deepseek-account', model: 'deepseek-flash', sessionId: SESSION_ID }, function* () {})
      allowed = true
    } catch {
      allowed = false
    }
    check('hard: session override suspends blocking', allowed === true)
  } finally {
    mounted.dispose()
  }
}

// ── 5. prompt context + status tool ─────────────────────────────────────────
{
  const mounted = await mount({
    config: { enabled: true, mode: 'pause', allowPeak: false, schedules: { deepseek: { windows: [allDayWindow()] } } },
  })
  try {
    const text = mounted.captured.promptContext.text
    const rendered = typeof text === 'function' ? text({ scope: 'scope-1' }) : String(text)
    check('prompt: context mentions the peak state', typeof rendered === 'string' && rendered.includes('пик'), rendered.slice(0, 200))
    const value = await mounted.captured.tool.execute({}, { agent: mounted.agent })
    check('tool: status value is JSON-safe', JSON.stringify(value).length > 0 && value.inPeak === true, JSON.stringify(value))
    check('tool: status names the model', value.provider === 'deepseek-account' && value.model === 'deepseek-flash', JSON.stringify(value))
  } finally {
    mounted.dispose()
  }
}

// ── 6. plugin metadata ──────────────────────────────────────────────────────
check('plugin: name', pluginName === 'peak-hours')
check('plugin: inject declares connection', Array.isArray(pluginInject) && pluginInject.includes('connection'))

if (failed > 0) {
  console.log(`\nFAILED: ${failed}`)
  process.exit(1)
}
console.log('\nOK: host wiring, pause controller, llm gate, defer, context/tool and RPC work')

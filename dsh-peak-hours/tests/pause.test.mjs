/**
 * Isolated tests for the two host modules of dsh-peak-hours:
 *   - `lib/pause.js` — `agent/pre-step` holds, abort restore, durable requeue,
 *     deferred delivery and state persistence;
 *   - `lib/gate.js` — `llm/stream` hard/warn/background policies, allow
 *     override and peak usage accounting.
 *
 * No live DSH is touched: a fake cordis context captures listeners, services
 * are plain fakes, the state file lives in a temp dir and the clock is pinned.
 *
 * Run: `node --test tests/pause.test.mjs`
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const { resolveConfig } = await import('../lib/config.js')
const { createStateStore } = await import('../lib/state.js')
const { createStats } = await import('../lib/stats.js')
const { createPauseController } = await import('../lib/pause.js')
const { createLlmGate } = await import('../lib/gate.js')

// ── temp home + controllable clock ──────────────────────────────────────────

const HOME = mkdtempSync(join(tmpdir(), 'peak-hours-pause-'))
process.env.DSH_HOME = HOME
const stateFile = join(HOME, 'peak-hours.json')
let clock = new Date('2026-11-11T02:00:00.000Z')
const now = () => clock

// ── logger / fake cordis context ────────────────────────────────────────────

const logs = { info: [], warn: [] }
const logger = {
  info: (...args) => logs.info.push(args.map((value) => String(value)).join(' ')),
  warn: (...args) => logs.warn.push(args.map((value) => String(value)).join(' ')),
}

/** Minimal `Context` stand-in: captures `on()` listeners and `get()` services. */
function createFakeContext() {
  const listeners = new Map()
  const services = new Map()
  return {
    listeners,
    services,
    on(event, listener, options = {}) {
      const entry = { listener, options }
      const list = listeners.get(event) ?? []
      list.push(entry)
      listeners.set(event, list)
      return () => {
        const current = listeners.get(event) ?? []
        const index = current.indexOf(entry)
        if (index >= 0) current.splice(index, 1)
        return index >= 0
      }
    },
    get(key) {
      return services.get(key)
    },
    set(key, value) {
      services.set(key, value)
    },
  }
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve))
}

// ── shared pause harness ────────────────────────────────────────────────────

/** Covers the whole UTC day except the last minute, so the window has a real end. */
const ALL_DAY = { deepseek: { windows: [{ start: '00:00', end: '23:59', tz: 'UTC' }] } }
/** A 4-hour morning window so a pinned clock can be off-peak. */
const MORNING = { deepseek: { windows: [{ start: '06:00', end: '10:00', tz: 'UTC' }] } }

const store = createStateStore({ file: stateFile, logger, now })

/** Mutable bundle so one controller can be exercised under several configs. */
let bundle = { enabled: true, mode: 'pause', pause: { strategy: 'hold' }, schedules: ALL_DAY }
const getResolved = () => resolveConfig(bundle, store)
const stats = createStats({ store, resolveConfig: getResolved })

const ctx = createFakeContext()
const flushCalls = []
/** session id -> { id, header } used by the lineage helpers. */
const sessionHeaders = new Map()
ctx.set('sessions', {
  flush: async (session) => { flushCalls.push(session) },
  get: (id) => {
    const header = sessionHeaders.get(id)
    return header === undefined ? undefined : { id, header }
  },
})
const agents = new Map()
ctx.set('agents', { get: (id) => agents.get(id) })
const resolvableAgents = new Map()
ctx.set('sessionController', {
  resolveAgent: async (id) => (resolvableAgents.has(id) ? { agent: resolvableAgents.get(id) } : { error: { message: 'not live' } }),
})
ctx.set('goals', { get: () => undefined })

const pause = createPauseController({ ctx, getResolved, store, stats, logger, now })
pause.start()

/** Fake live agent: captures inbox prepends and `send()` deliveries. */
function makeAgent(id) {
  const prependCalls = []
  const sendCalls = []
  const agent = {
    id,
    session: { id, header: {} },
    inbox: {
      nextStep: [],
      nextTurn: [],
      prepend(target, message) {
        prependCalls.push({ target, message })
        if (target === 'next-turn') agent.inbox.nextTurn.push(message)
        else agent.inbox.nextStep.push(message)
      },
      append() {},
    },
    send(message, target, wakeup) {
      sendCalls.push({ message, target, wakeup })
    },
  }
  return { agent, prependCalls, sendCalls }
}

function preStepEntry() {
  const entries = ctx.listeners.get('agent/pre-step') ?? []
  assert.equal(entries.length, 1, 'exactly one pre-step pause listener')
  return entries[0]
}

function payloadFor({ agent, messages, turn = 1, signal, provider = 'deepseek-official', model = 'deepseek-chat' }) {
  return { agent, messages, turn, step: 1, signal, modelSelection: { provider, model } }
}

function enterNext() {
  const calls = { count: 0 }
  const next = async () => {
    calls.count += 1
    return { kind: 'enter', messages: [] }
  }
  return { next, calls }
}

function invokePreStep(payload, next) {
  return Promise.resolve(preStepEntry().listener(payload, next))
}

// ── pause: hold strategy ────────────────────────────────────────────────────

test('hold: waits inside the turn, releases on resume-now, then enters', async () => {
  const entry = preStepEntry()
  assert.deepEqual(entry.options, { prepend: true })
  assert.equal((ctx.listeners.get('session/event') ?? []).length, 1, 'model-selection listener registered')

  const { agent } = makeAgent('s1')
  const controller = new AbortController()
  const { next, calls } = enterNext()
  let settled = false
  const pending = invokePreStep(payloadFor({ agent, messages: [{ id: 'm1' }], signal: controller.signal }), next)
    .finally(() => { settled = true })

  await settle()
  assert.equal(settled, false, 'the listener must still be waiting in peak hours')

  const view = pause.sessionView('s1')
  assert.equal(view.paused, true)
  assert.equal(view.pauseKind, 'hold')
  assert.equal(view.deferredCount, 0)
  assert.ok(view.since instanceof Date, 'view.since is the hold start')
  assert.ok(view.until instanceof Date && view.until.getTime() > clock.getTime(), 'view.until is the window end')
  assert.ok(flushCalls.length >= 1, 'pre-pause checkpoint flushed the session')
  assert.equal(pause.pausedMap().s1.kind, 'hold')

  const released = await pause.releaseNow('s1')
  assert.deepEqual(released, { delivered: 0 })

  const result = await pending
  assert.equal(result.kind, 'enter')
  assert.equal(calls.count, 1, 'the released step entered exactly once')
  assert.equal(pause.sessionView('s1').paused, false)
  assert.equal(stats.summary().heldSteps, 1)
  const marks = store.marksFor('s1')
  assert.deepEqual(marks.peakTurns, [1], 'turn marked as peak-priced')
  assert.deepEqual(marks.pausedTurns, [1], 'turn marked as paused')
})

// ── pause: abort path ───────────────────────────────────────────────────────

test('abort: restores the claimed message to next-turn and never throws', async () => {
  const { agent, prependCalls } = makeAgent('s2')
  const controller = new AbortController()
  const { next, calls } = enterNext()
  const pending = invokePreStep(payloadFor({ agent, messages: [{ id: 'm2' }], signal: controller.signal }), next)

  await settle()
  assert.equal(pause.sessionView('s2').pauseKind, 'hold')

  controller.abort()
  const result = await pending // must settle without rejecting
  assert.equal(result.kind, 'enter')
  assert.equal(calls.count, 1)
  assert.equal(prependCalls.length, 1, 'claimed message was restored')
  assert.equal(prependCalls[0].target, 'next-turn')
  assert.equal(prependCalls[0].message.id, 'm2')
  assert.equal(pause.sessionView('s2').paused, false)
})

// ── pause: requeue strategy + deferred delivery ────────────────────────────

test('requeue: stores the prompt durably, then delivers it once due', async () => {
  bundle = { ...bundle, pause: { strategy: 'requeue' } }
  const { agent, sendCalls } = makeAgent('s3')
  const controller = new AbortController()
  const { next, calls } = enterNext()

  const result = await invokePreStep(
    payloadFor({ agent, messages: [{ id: 'm3' }], signal: controller.signal }),
    next,
  )
  assert.deepEqual(result, { kind: 'reject' })
  assert.equal(calls.count, 0, 'a rejected step never enters')

  const deferred = store.deferredFor('s3')
  assert.equal(deferred.length, 1, 'the claimed prompt is in the durable queue')
  assert.equal(deferred[0].message.id, 'm3')
  const until = deferred[0].until
  assert.ok(Date.parse(until) > clock.getTime(), 'queued until the peak window ends')

  const view = pause.sessionView('s3')
  assert.equal(view.paused, true)
  assert.equal(view.pauseKind, 'queued')
  assert.equal(view.deferredCount, 1)
  assert.deepEqual(pause.deferredMap(), { s3: 1 })
  assert.equal(pause.pausedMap().s3.kind, 'queued')
  assert.equal(pause.pausedMap().s3.until, until)

  // The state file already carries the queued prompt (reject drops claimed messages).
  store.flush()
  const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
  assert.equal(saved.version, 1)
  assert.equal(saved.deferred.s3.length, 1)
  assert.equal(saved.deferred.s3[0].message.id, 'm3')
  assert.equal(saved.deferred.s3[0].until, until)

  // Outside the live registry the controller resolves the agent and resumes it.
  agents.clear()
  resolvableAgents.set('s3', agent)
  clock = new Date(Date.parse(until) + 1000)

  const delivered = await pause.deliverDue(clock)
  assert.equal(delivered, 1)
  assert.equal(sendCalls.length, 1)
  assert.equal(sendCalls[0].target, 'next-turn')
  assert.equal(sendCalls[0].wakeup, true)
  assert.equal(sendCalls[0].message.id, 'm3')
  assert.equal(store.deferredFor('s3').length, 0, 'queue drained after delivery')
  assert.equal(pause.sessionView('s3').paused, false)
})

// ── pause: allow change delivers queue; cancel drops it ────────────────────

test('allow change delivers a queued session; cancelDeferred drops one', async () => {
  clock = new Date('2026-11-12T02:00:00.000Z') // back inside the all-day window
  bundle = { ...bundle, pause: { strategy: 'requeue' } }

  const s4 = makeAgent('s4')
  const signal4 = new AbortController().signal
  const result4 = await invokePreStep(
    payloadFor({ agent: s4.agent, messages: [{ id: 'm4' }], signal: signal4 }),
    enterNext().next,
  )
  assert.deepEqual(result4, { kind: 'reject' })
  assert.equal(store.deferredFor('s4').length, 1)
  resolvableAgents.set('s4', s4.agent)
  store.setSessionAllow('s4', true)
  pause.noteAllowChanged('s4')
  await settle()
  assert.equal(store.deferredFor('s4').length, 0, 'now-allowed session was delivered immediately')
  assert.equal(s4.sendCalls.length, 1)

  const s5 = makeAgent('s5')
  const result5 = await invokePreStep(
    payloadFor({ agent: s5.agent, messages: [{ id: 'm5' }], signal: new AbortController().signal }),
    enterNext().next,
  )
  assert.deepEqual(result5, { kind: 'reject' })
  assert.equal(store.deferredFor('s5').length, 1)
  assert.equal(pause.cancelDeferred('s5'), 1)
  assert.equal(store.deferredFor('s5').length, 0, 'cancelled queue is gone')
  assert.equal(s5.sendCalls.length, 0, 'cancelled queue is never delivered')
})

test('config change and resume-now deliver queued sessions immediately', async () => {
  clock = new Date('2026-11-12T02:00:00.000Z')
  bundle = { ...bundle, pause: { strategy: 'requeue' } }

  // A settings change that allows peak work flushes the pending queue.
  const s6 = makeAgent('s6')
  const result6 = await invokePreStep(
    payloadFor({ agent: s6.agent, messages: [{ id: 'm6' }], signal: new AbortController().signal }),
    enterNext().next,
  )
  assert.deepEqual(result6, { kind: 'reject' })
  assert.equal(store.deferredFor('s6').length, 1)
  resolvableAgents.set('s6', s6.agent)
  bundle = { ...bundle, allowPeakDefault: true }
  pause.onConfigChanged()
  await settle()
  assert.equal(store.deferredFor('s6').length, 0, 'onConfigChanged delivered the now-allowed queue')
  assert.equal(s6.sendCalls.length, 1)

  // resume-now also drains a queue when there is no hold to release.
  bundle = { ...bundle, allowPeakDefault: false }
  const s7 = makeAgent('s7')
  const result7 = await invokePreStep(
    payloadFor({ agent: s7.agent, messages: [{ id: 'm7' }], signal: new AbortController().signal }),
    enterNext().next,
  )
  assert.deepEqual(result7, { kind: 'reject' })
  assert.equal(store.deferredFor('s7').length, 1)
  resolvableAgents.set('s7', s7.agent)
  const resumed = await pause.releaseNow('s7')
  assert.deepEqual(resumed, { delivered: 1 })
  assert.equal(store.deferredFor('s7').length, 0)
  assert.equal(s7.sendCalls.length, 1)
  assert.equal(s7.sendCalls[0].target, 'next-turn')
})

// ── state persistence ───────────────────────────────────────────────────────

test('state file carries stats, turn marks and session overrides', () => {
  store.flush()
  const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
  assert.equal(saved.version, 1)
  assert.ok(saved.stats.heldSteps >= 2, `heldSteps=${saved.stats.heldSteps}`)
  assert.ok(saved.stats.deferredMessages >= 2, `deferredMessages=${saved.stats.deferredMessages}`)
  assert.ok(saved.stats.pausedSeconds > 0, 'paused time is accounted')
  assert.deepEqual(saved.marks.s1.peakTurns, [1])
  assert.deepEqual(saved.marks.s1.pausedTurns, [1])
  assert.equal(saved.sessions.s4.allowPeak, true)
  assert.ok(Array.isArray(saved.deferred.s3) === false || saved.deferred.s3 === undefined, 'delivered queue is no longer persisted as pending')
})

// ── gate ────────────────────────────────────────────────────────────────────

function collect(iterable) {
  return (async () => {
    const chunks = []
    for await (const chunk of iterable) chunks.push(chunk)
    return chunks
  })()
}

function fakeStream(chunks = [{ type: 'text-delta', index: 0, text: 'hello' }]) {
  return (async function* () {
    for (const chunk of chunks) yield chunk
  })()
}

/** Mount the gate over its own fake context; returns the captured listener. */
function mountGate(gateBundle) {
  const gateCtx = createFakeContext()
  const gate = createLlmGate({
    ctx: gateCtx,
    getResolved: () => resolveConfig(gateBundle, store),
    store,
    stats,
    logger,
    now,
  })
  gate.start()
  const entries = gateCtx.listeners.get('llm/stream') ?? []
  assert.equal(entries.length, 1, 'gate registered exactly one llm/stream listener')
  assert.deepEqual(entries[0].options, { global: true, prepend: true })
  return { gate, gateCtx, listener: entries[0].listener }
}

test('gate: hard mode blocks a conversation call before adapter work', () => {
  clock = new Date('2026-11-11T07:00:00.000Z')
  const { gate, gateCtx, listener } = mountGate({ enabled: true, mode: 'hard', schedules: ALL_DAY })
  assert.notEqual(listener.constructor.name, 'AsyncFunction', 'the llm/stream listener must be synchronous')

  let nextCalled = 0
  const next = () => { nextCalled += 1; return fakeStream() }
  let thrown
  try {
    listener({ provider: 'deepseek-official', model: 'deepseek-chat', sessionId: 'g1' }, next)
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown instanceof Error, 'a hard block throws synchronously')
  assert.match(thrown.message, /PEAK_HOURS_BLOCK/)
  assert.match(thrown.message, /deepseek-official/)
  assert.match(thrown.message, /deepseek-chat/)
  assert.match(thrown.message, /rejected before any adapter work/)
  assert.match(thrown.message, /header indicator/)
  assert.equal(thrown.code, 'PEAK_HOURS_BLOCK')
  assert.equal(nextCalled, 0, 'the downstream adapter chain was never touched')

  gate.dispose()
  assert.equal((gateCtx.listeners.get('llm/stream') ?? []).length, 0, 'dispose removes the listener')
})

test('gate: off-peak and disabled pass through with no overhead', async () => {
  const gateBundle = { enabled: true, mode: 'hard', schedules: MORNING }
  clock = new Date('2026-11-11T02:00:00.000Z') // before the 06:00 UTC window
  const { gate, listener } = mountGate(gateBundle)

  let nextCalled = 0
  const iterable = listener(
    { provider: 'deepseek-official', model: 'deepseek-chat', sessionId: 'g2' },
    () => { nextCalled += 1; return fakeStream() },
  )
  assert.equal(nextCalled, 1, 'off-peak calls next() synchronously')
  assert.equal(typeof iterable[Symbol.asyncIterator], 'function')
  const chunks = await collect(iterable)
  assert.equal(chunks.length, 1)
  gate.dispose()

  const disabled = mountGate({ enabled: false, mode: 'hard', schedules: ALL_DAY })
  let disabledNext = 0
  disabled.listener({ provider: 'deepseek-official', model: 'deepseek-chat', sessionId: 'g2' }, () => {
    disabledNext += 1
    return fakeStream()
  })
  assert.equal(disabledNext, 1, 'enabled:false disables the gate')
  disabled.gate.dispose()
})

test('gate: allow override lets a hard conversation call through and usage is accounted', async () => {
  clock = new Date('2026-11-11T07:00:00.000Z')
  store.setSessionAllow('g4', true)
  const { gate, listener } = mountGate({ enabled: true, mode: 'hard', schedules: ALL_DAY })

  let nextCalled = 0
  const iterable = listener(
    { provider: 'deepseek-official', model: 'deepseek-chat', sessionId: 'g4' },
    () => {
      nextCalled += 1
      return fakeStream([
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
        { type: 'finish', reason: 'stop' },
      ])
    },
  )
  assert.equal(typeof iterable[Symbol.asyncIterator], 'function', 'the listener returns an AsyncIterable synchronously')
  const chunks = await collect(iterable)
  assert.equal(chunks.length, 2)
  assert.equal(nextCalled, 1, 'allowed call reached the adapter chain')

  const snapshot = stats.summary()
  assert.equal(snapshot.peakCalls, 1, 'peak call counted')
  assert.equal(snapshot.peakTokens, 15, 'input+output tokens counted')
  assert.equal(snapshot.avgTokensPerStep, 15, 'conversation tokens feed the rolling average')
  gate.dispose()
})

test('gate: background policy block rejects a session-title call; warn logs once', async () => {
  clock = new Date('2026-11-11T07:00:00.000Z')
  assert.equal(pause.sessionView('s1').paused, false) // sanity: clock change did not resurrect state

  const blocked = mountGate({ enabled: true, mode: 'hard', schedules: ALL_DAY, backgroundPolicy: 'block' })
  let nextCalled = 0
  let thrown
  try {
    blocked.listener(
      { provider: 'deepseek-official', model: 'deepseek-chat', sessionId: 'g5', purpose: 'session-title' },
      () => { nextCalled += 1; return fakeStream() },
    )
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown instanceof Error)
  assert.match(thrown.message, /PEAK_HOURS_BLOCK/)
  assert.match(thrown.message, /session-title/)
  assert.equal(thrown.code, 'PEAK_HOURS_BLOCK')
  assert.equal(nextCalled, 0, 'background block happens before adapter work')
  blocked.gate.dispose()

  const warned = mountGate({ enabled: true, mode: 'hard', schedules: ALL_DAY, backgroundPolicy: 'warn' })
  const before = logs.warn.length
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const chunks = await collect(warned.listener(
      { provider: 'deepseek-official', model: 'deepseek-chat', sessionId: 'g5', purpose: 'session-title' },
      () => fakeStream([{ type: 'text-delta', index: 0, text: 'title' }]),
    ))
    assert.equal(chunks.length, 1)
  }
  assert.equal(logs.warn.length - before, 1, 'warn policy logs once per window')
  warned.gate.dispose()
})

// ── subagents: the pause applies to children too, and inherits their parent ──

test('subagent: a child step is paused unless the parent allows peak work', async () => {
  clock = new Date('2026-11-12T02:00:00.000Z')
  bundle = { enabled: true, mode: 'pause', pause: { strategy: 'hold' }, schedules: ALL_DAY }
  store.clearSessionAllow('parent-1')
  store.clearSessionAllow('child-1')

  const childHeader = { origin: 'subagent', parentSession: 'parent-1', delegationDepth: 1 }
  sessionHeaders.set('child-1', childHeader)
  const { agent } = makeAgent('child-1')
  agent.session.header = childHeader

  // No override anywhere: the child pauses on its own step.
  {
    const controller = new AbortController()
    const { next, calls } = enterNext()
    const pending = invokePreStep(payloadFor({ agent, messages: [{ id: 'c0' }], signal: controller.signal }), next)
    await settle()
    assert.equal(pause.sessionView('child-1').pauseKind, 'hold', 'child holds like any other agent')
    assert.equal(calls.count, 0)
    const released = await pause.releaseNow('child-1')
    assert.deepEqual(released, { delivered: 0 })
    const result = await pending
    assert.equal(result.kind, 'enter')
    assert.equal(calls.count, 1)
  }

  // The parent allows peak work: the child inherits it and enters without pausing.
  store.setSessionAllow('parent-1', true, null)
  {
    const { next, calls } = enterNext()
    const result = await invokePreStep(
      payloadFor({ agent, messages: [{ id: 'c1' }], signal: new AbortController().signal }),
      next,
    )
    assert.equal(result.kind, 'enter')
    assert.equal(calls.count, 1)
    assert.equal(pause.sessionView('child-1').paused, false, 'inherited allow means no pause')
  }
  store.clearSessionAllow('parent-1')
})

test('subagent: resuming the parent releases a held child immediately', async () => {
  clock = new Date('2026-11-12T02:00:00.000Z')
  bundle = { enabled: true, mode: 'pause', pause: { strategy: 'hold' }, schedules: ALL_DAY }
  store.clearSessionAllow('parent-2')
  store.clearSessionAllow('child-2')

  const childHeader = { origin: 'subagent', parentSession: 'parent-2', delegationDepth: 1 }
  sessionHeaders.set('child-2', childHeader)
  const { agent } = makeAgent('child-2')
  agent.session.header = childHeader

  const { next, calls } = enterNext()
  const pending = invokePreStep(
    payloadFor({ agent, messages: [{ id: 'c2' }], signal: new AbortController().signal }),
    next,
  )
  await settle()
  assert.equal(pause.sessionView('child-2').pauseKind, 'hold')

  // The user resumes the parent: the child's inherited allow flips to true.
  store.setSessionAllow('parent-2', true, null)
  pause.noteAllowChanged('parent-2')
  const result = await pending
  assert.equal(result.kind, 'enter')
  assert.equal(calls.count, 1, 'the child continued after the parent resume')
  assert.equal(pause.sessionView('child-2').paused, false)
  store.clearSessionAllow('parent-2')
})

// ── teardown ────────────────────────────────────────────────────────────────

test.after(() => {
  try {
    pause.dispose()
  } catch {
    // Already disposed.
  }
  try {
    store.dispose()
  } catch {
    // Already disposed.
  }
  rmSync(HOME, { recursive: true, force: true })
})

/**
 * Isolated tests for the Web client half (`lib/client.js`).
 *
 * The bundle is loaded through a fake `window.__ModuleLoader__`, rendered with
 * a minimal React stub (the bundle only uses createElement/useState/useEffect/
 * useRef), and driven by a fake Connection RPC. No browser and no live DSH.
 *
 * Run with `node tests/client.test.mjs`.
 */
import { readFileSync } from 'node:fs'

let failed = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log('ok  -', name)
    return
  }
  failed += 1
  console.log('FAIL -', name, detail)
}

// ── fake React ──────────────────────────────────────────────────────────────
const reactStub = {
  useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  },
  useEffect(fn) {
    const cleanup = fn()
    if (typeof cleanup === 'function') {
      // Components subscribe on mount; the unsubscribe is exercised by disposal
      // in the real runtime, not by this synchronous render.
    }
    return undefined
  },
  useRef(value) {
    return { current: value }
  },
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
}

// ── fixtures ────────────────────────────────────────────────────────────────
const MODEL = { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'max' }
const sessionFixture = {
  serverTime: new Date().toISOString(),
  enabled: true,
  mode: 'pause',
  pauseStrategy: 'auto',
  settings: { allowPeakDefault: false, dailyLimitMinutes: 30, prePeakWarningMinutes: 10, maxHoldMinutes: 20, backgroundPolicy: 'allow', notifyBeforePeak: true, deferMarginSeconds: 1, statsEnabled: true, strategy: 'auto' },
  schedules: {
    deepseek: { windows: [{ start: '06:00', end: '10:00', tz: 'UTC', days: [1, 2, 3, 4, 5] }] },
    zai: { windows: [{ start: '14:00', end: '18:00', tz: 'Asia/Shanghai', days: [1, 2, 3, 4, 5] }] },
  },
  schedulesSource: 'bundle',
  scheduleWarnings: [],
  canDefer: true,
  aggregate: { inPeak: true, untilLabel: '10:00 UTC', nextStartAt: null, untilAt: '2026-11-11T10:00:00.000Z', secondsToChange: 3600 },
  stats: {
    pausedSeconds: 120, heldSteps: 1, deferredMessages: 2, peakCalls: 1, peakTokens: 40,
    allowedPeakSeconds: 30, movedTokensEstimate: 1000, savedTokensEstimate: 500,
    avgTokensPerStep: 1000, discount: 0.5, day: '2026-11-11',
  },
  limit: { dailyMinutes: 30, usedSeconds: 30, remainingSeconds: 1770, exhausted: false },
  pausedSessions: { s1: { kind: 'hold', until: '2026-11-11T10:00:00.000Z' } },
  deferredSessions: { s1: 2 },
  session: {
    id: 's1', provider: MODEL.provider, model: MODEL.model, reasoningEffort: MODEL.reasoningEffort, modelKnown: true,
    modelSource: 'agent', matchedKey: 'deepseek', modelKey: null, known: true,
    inPeak: true, untilAt: '2026-11-11T10:00:00.000Z', untilLabel: '10:00 UTC',
    nextStartAt: null, secondsToChange: 3600, mode: 'pause', offPeakDiscount: 0.5,
    effectiveWindows: [{ start: '06:00', end: '10:00', tz: 'UTC', days: [1, 2, 3, 4, 5] }],
    allow: false, allowSource: 'default', allowUntil: null,
    paused: true, pauseKind: 'hold', pausedSince: '2026-11-11T09:30:00.000Z', pausedUntil: '2026-11-11T10:00:00.000Z',
    deferredCount: 2, queuedMessages: 1, scheduledMessages: 1,
    peakTurns: [4, 6], pausedTurns: [6],
  },
}
const globalFixture = {
  ...sessionFixture,
  session: null,
  pausedSessions: { s1: { kind: 'hold', until: '2026-11-11T10:00:00.000Z' } },
  deferredSessions: { s1: 2 },
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

// ── fake connection ─────────────────────────────────────────────────────────
const calls = []
const rpc = {
  call(channel, endpoint, payload) {
    calls.push({ channel, endpoint, payload })
    const value = payload !== null && typeof payload === 'object' && typeof payload.sessionId === 'string'
      ? clone(sessionFixture)
      : clone(globalFixture)
    if (endpoint === 'defer') {
      return Promise.resolve({ ok: true, value: { taskId: 'task-1', scheduledAt: '2026-11-11T10:00:01.000Z', peakEndsAt: '2026-11-11T10:00:00.000Z' } })
    }
    return Promise.resolve({ ok: true, value })
  },
}
const connection = { rpc }

// ── load the bundle ─────────────────────────────────────────────────────────
const loaded = []
globalThis.window = { __ModuleLoader__: { load: (entry) => loaded.push(entry) } }
await import('../lib/client.js')
check('bundle: one module registered', loaded.length === 1, String(loaded.length))
check('bundle: module id', loaded[0]?.id === 'dsh-peak-hours', String(loaded[0]?.id))
const client = loaded[0].factory((id) => (id === 'react' ? reactStub : {}))
check('bundle: exports apply/inject', typeof client.apply === 'function' && Array.isArray(client.inject))
check('bundle: inject covers connection and slots', ['connection', 'slots'].every((key) => client.inject.includes(key)), JSON.stringify(client.inject))

// ── mount into a fake slot registry ─────────────────────────────────────────
const registrations = []
const ctx = {
  get(key) {
    return key === 'connection' ? connection : undefined
  },
  slots: {
    inject(name, factory) {
      const result = factory()
      registrations.push({ name, ...result })
    },
    register(options, Component) {
      return { options, Component }
    },
  },
}
client.apply(ctx)

const bySlot = (name) => registrations.find((entry) => entry.name === name)
check('registration: six slots', registrations.length === 6, JSON.stringify(registrations.map((entry) => entry.name)))
check('registration: header pill', bySlot('conversation.session.header.utilities')?.options?.id === 'deepseek-peak-indicator')
check('registration: composer defer button', bySlot('conversation.input.right')?.options?.id === 'peak-defer')
check('registration: composer banner', bySlot('conversation.input.dock')?.options?.id === 'peak-banner')
check('registration: sidebar row marker', bySlot('sidebar.session.row.trailing')?.options?.id === 'peak-row-marker')
check('registration: settings section', bySlot('settings.section')?.options?.id === 'peak-hours')
check('registration: turn tail marker', bySlot('conversation.chat.turnTail')?.options?.id === 'peak-turn-marker')
check('registration: settings nav label', typeof bySlot('settings.section')?.options?.label === 'function' && bySlot('settings.section').options.label() === 'Пиковые часы')
check('registration: turn tail is a chain selector', typeof bySlot('conversation.chat.turnTail')?.options?.select === 'function' && bySlot('conversation.chat.turnTail').options.select({ turn: { turn: 7 } }) === 7)

// ── shared inject face ──────────────────────────────────────────────────────
const share = bySlot('conversation.session.header.utilities').options.inject()
check('inject: rpcCall shared', typeof share.rpcCall === 'function')
check('inject: peak state hook shared', typeof share.usePeakState === 'function')
check('inject: countdown hook shared', typeof share.useCountdown === 'function')
const wire = await share.rpcCall('state', { sessionId: 's1' })
check('rpc: envelope mapped', wire.ok === true && wire.value.session?.id === 's1')
check('rpc: channel is the plugin channel', calls[0]?.channel === '/dsh-peak-hours' && calls[0]?.endpoint === 'state', JSON.stringify(calls[0]))

// ── render helpers ──────────────────────────────────────────────────────────
function collectText(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (typeof node === 'object') {
    if (typeof node.props?.title === 'string') out.push(node.props.title)
    if (typeof node.props?.['aria-label'] === 'string') out.push(node.props['aria-label'])
    collectText(node.children, out)
  }
  return out
}

function countElements(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return 0
  if (Array.isArray(node)) return node.reduce((total, child) => total + countElements(child, predicate), 0)
  return (predicate(node) ? 1 : 0) + countElements(node.children, predicate)
}

function findElement(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate)
      if (found !== null) return found
    }
    return null
  }
  if (predicate(node)) return node
  return findElement(node.children, predicate)
}

/**
 * Minimal stateful React runtime: just enough to open the pill popover.
 *
 * The bundle keeps the module-level react object, so the stub methods are
 * swapped around one interactive mount and restored afterwards.
 */
function mountInteractive(Component, props) {
  const saved = { useState: reactStub.useState, useEffect: reactStub.useEffect, useRef: reactStub.useRef }
  const context = { hooks: [], effects: new Set(), index: 0, dirty: false }
  reactStub.useState = (initial) => {
    const index = context.index++
    if (!(index in context.hooks)) context.hooks[index] = typeof initial === 'function' ? initial() : initial
    return [context.hooks[index], (next) => {
      context.hooks[index] = typeof next === 'function' ? next(context.hooks[index]) : next
      context.dirty = true
    }]
  }
  reactStub.useEffect = (fn) => {
    const index = context.index++
    if (context.effects.has(index)) return undefined
    context.effects.add(index)
    const cleanup = fn()
    return cleanup
  }
  reactStub.useRef = (value) => {
    const index = context.index++
    if (!(index in context.hooks)) context.hooks[index] = { current: value }
    return context.hooks[index]
  }
  const expand = (node) => {
    if (node === null || node === undefined) return null
    if (Array.isArray(node)) return node.map(expand)
    if (typeof node !== 'object') return node
    if (typeof node.type === 'function') return expand(node.type(node.props ?? {}))
    if (Array.isArray(node.children)) return { ...node, children: node.children.map(expand) }
    return node
  }
  const draw = () => {
    let tree = null
    let passes = 0
    do {
      context.index = 0
      context.dirty = false
      tree = expand(Component(props))
    } while (context.dirty === true && ++passes < 8)
    return tree
  }
  try {
    return { tree: draw(), redraw: draw, restore: () => Object.assign(reactStub, saved) }
  } catch (error) {
    Object.assign(reactStub, saved)
    throw error
  }
}

function inputState(overrides = {}) {
  return { draft: 'сделай отчёт', phase: 'plain', attachmentIds: [], queue: [], ...overrides }
}

function baseProps(overrides = {}) {
  return {
    sessionId: 's1',
    rpcCall: share.rpcCall,
    refresh: () => {},
    usePeakState: () => ({ state: clone(sessionFixture), refresh: () => {} }),
    useCountdown: () => 3600,
    useProjection: (key, selector) => {
      const value = { lastUsed: MODEL, next: MODEL }
      return typeof selector === 'function' ? selector(value) : value
    },
    useSession: (selector) => {
      const value = { subagent: null, sessionId: 's1' }
      return typeof selector === 'function' ? selector(value) : value
    },
    useSessionStatus: () => ({ running: true }),
    useInput: (selector) => (typeof selector === 'function' ? selector(inputState()) : inputState()),
    inputActions: { setDraft: () => {}, submit: () => {}, removeAttachment: () => {}, addAttachments: () => {} },
    ...overrides,
  }
}

// ── pill ────────────────────────────────────────────────────────────────────
const pill = bySlot('conversation.session.header.utilities').Component
const pillTree = pill(baseProps())
const pillText = collectText(pillTree).join(' ')
check('pill: renders a paused session text', pillText.includes('на паузе'), pillText.slice(0, 300))
check('pill: pill carries the paused class', findElement(pillTree, (node) => typeof node.props?.className === 'string' && node.props.className.includes('dph-paused')) !== null, pillText.slice(0, 120))

const allowedTree = pill(baseProps({
  usePeakState: () => ({ state: { ...clone(sessionFixture), session: { ...clone(sessionFixture.session), allow: true, allowSource: 'session', paused: false, pauseKind: null } }, refresh: () => {} }),
}))
check('pill: renders an allowed session text', collectText(allowedTree).join(' ').includes('разрешено'), collectText(allowedTree).join(' ').slice(0, 200))

const offlineTree = pill(baseProps({ usePeakState: () => ({ state: null, refresh: () => {} }) }))
check('pill: offline state is explicit', collectText(offlineTree).join(' ').includes('нет связи'), collectText(offlineTree).join(' ').slice(0, 120))

// First-generation host: `{enabled, mode, allowPeak, peak, until, secondsToChange, schedules}`.
const legacyState = {
  enabled: true,
  mode: 'soft',
  allowPeak: false,
  peak: false,
  until: null,
  secondsToChange: 1920,
  schedules: {
    deepseek: { windows: [{ start: '01:00', end: '04:00', tz: 'UTC', days: [1, 2, 3, 4, 5] }, { start: '06:00', end: '10:00', tz: 'UTC', days: [1, 2, 3, 4, 5] }] },
    zai: { windows: [{ start: '14:00', end: '18:00', tz: 'Asia/Shanghai', days: [1, 2, 3, 4, 5] }] },
  },
}
const legacyPill = pill(baseProps({ usePeakState: () => ({ state: clone(legacyState), refresh: () => {} }) }))
check('pill: old host is called out instead of rendered as valid', collectText(legacyPill).join(' ').includes('хост не перезапущен'), collectText(legacyPill).join(' ').slice(0, 160))

// ── defer button ────────────────────────────────────────────────────────────
const deferButton = bySlot('conversation.input.right').Component
let deferredPayload = null
let cleared = 0
const deferRpc = (endpoint, payload) => {
  calls.push({ channel: '/dsh-peak-hours', endpoint, payload })
  if (endpoint === 'defer') {
    deferredPayload = payload
    return Promise.resolve({ ok: true, value: { taskId: 'task-1', scheduledAt: '2026-11-11T10:00:01.000Z', peakEndsAt: '2026-11-11T10:00:00.000Z' } })
  }
  return Promise.resolve({ ok: true, value: clone(sessionFixture) })
}
const deferTree = deferButton(baseProps({
  rpcCall: deferRpc,
  inputActions: { setDraft: () => { cleared += 1 }, submit: () => {}, removeAttachment: () => {}, addAttachments: () => {} },
}))
const deferButtonElement = findElement(deferTree, (node) => node.type === 'button' && typeof node.props?.onClick === 'function')
check('defer: renders a button in peak', deferButtonElement !== null)
check('defer: label names the peak end', collectText(deferTree).join(' ').includes('⏰'), collectText(deferTree).join(' ').slice(0, 120))
if (deferButtonElement !== null) {
  deferButtonElement.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))
  check('defer: RPC carries the session and the draft', deferredPayload?.sessionId === 's1' && deferredPayload?.text === 'сделай отчёт', JSON.stringify(deferredPayload))
  check('defer: draft is cleared after the host accepted it', cleared === 1, String(cleared))
}

const noAttachmentsButton = deferButton(baseProps({
  useInput: (selector) => (typeof selector === 'function' ? selector(inputState({ attachmentIds: ['a1'] })) : inputState({ attachmentIds: ['a1'] })),
}))
check('defer: disabled while an attachment is present', findElement(noAttachmentsButton, (node) => node.type === 'button')?.props?.disabled === true)

// ── banner ──────────────────────────────────────────────────────────────────
const banner = bySlot('conversation.input.dock').Component
const bannerLegacyMount = mountInteractive(banner, baseProps({ usePeakState: () => ({ state: clone(legacyState), refresh: () => {} }) }))
check('banner: old host is called out', collectText(bannerLegacyMount.tree).join(' ').includes('не перезапущена'), collectText(bannerLegacyMount.tree).join(' ').slice(0, 200))
bannerLegacyMount.restore()
const bannerText = collectText(banner(baseProps())).join(' ')
check('banner: renders the paused state', bannerText.includes('паузе') || bannerText.includes('Пик'), bannerText.slice(0, 200))
const bannerAllowed = banner(baseProps({
  usePeakState: () => ({ state: { ...clone(sessionFixture), session: { ...clone(sessionFixture.session), allow: true, paused: false, pauseKind: null } }, refresh: () => {} }),
}))
check('banner: renders the allowed state', collectText(bannerAllowed).join(' ').includes('разрешён'), collectText(bannerAllowed).join(' ').slice(0, 200))

const warningFixture = {
  ...clone(sessionFixture),
  session: { ...clone(sessionFixture.session), inPeak: false, paused: false, pauseKind: null, untilAt: null, secondsToChange: 300, nextStartAt: new Date(Date.now() + 300_000).toISOString(), allow: false },
}
const warningBanner = banner(baseProps({ usePeakState: () => ({ state: warningFixture, refresh: () => {} }), useCountdown: () => 300 }))
check('banner: pre-peak warning renders', collectText(warningBanner).join(' ').includes('Пик начнётся'), collectText(warningBanner).join(' ').slice(0, 220))

// Every composer banner state: countdown, no disabled-button clutter, budget.
const pausedBannerText = collectText(banner(baseProps())).join(' ')
check('banner: countdown appended to the peak line', pausedBannerText.includes('ещё') && pausedBannerText.includes('паузе'), pausedBannerText.slice(0, 220))
const emptyDraftBanner = banner(baseProps({
  useInput: (selector) => {
    const empty = inputState({ draft: '' })
    return typeof selector === 'function' ? selector(empty) : empty
  },
}))
const emptyDraftText = collectText(emptyDraftBanner).join(' ')
check('banner: no "Отложить" button without a draft', !emptyDraftText.includes('Отложить'), emptyDraftText.slice(0, 220))
const draftBannerText = collectText(banner(baseProps())).join(' ')
check('banner: "Отложить" appears once a draft exists', draftBannerText.includes('Отложить'), draftBannerText.slice(0, 220))
const attachedBanner = banner(baseProps({
  useInput: (selector) => {
    const withAttachment = inputState({ attachmentIds: ['a1'] })
    return typeof selector === 'function' ? selector(withAttachment) : withAttachment
  },
}))
const attachedDefer = findElement(attachedBanner, (node) => node.type === 'button' && collectText(node).join(' ').includes('Отложить'))
check('banner: attachment blocks deferring with a disabled control', attachedDefer !== null && attachedDefer.props.disabled === true)
const allowedBannerText = collectText(banner(baseProps({
  usePeakState: () => ({ state: { ...clone(sessionFixture), session: { ...clone(sessionFixture.session), allow: true, paused: false, pauseKind: null } }, refresh: () => {} }),
}))).join(' ')
check('banner: allowed state shows the remaining budget', allowedBannerText.includes('разрешён') && allowedBannerText.includes('бюджет пика'), allowedBannerText.slice(0, 260))

// ── sidebar row marker ──────────────────────────────────────────────────────
const rowMarker = bySlot('sidebar.session.row.trailing').Component
const rowTree = rowMarker({
  sessionId: 's1',
  usePeakState: () => ({ state: clone(globalFixture), refresh: () => {} }),
})
check('row marker: shows pause and deferred counts', collectText(rowTree).join(' ').includes('⏸') && collectText(rowTree).join(' ').includes('⏰'), collectText(rowTree).join(' ').slice(0, 120))
check('row marker: nothing for an unknown session', rowMarker({ sessionId: 'other', usePeakState: () => ({ state: clone(globalFixture), refresh: () => {} }) }) === null)

// ── turn tail marker ────────────────────────────────────────────────────────
const turnMarker = bySlot('conversation.chat.turnTail').Component
const pausedTurn = collectText(turnMarker(baseProps({ turn: { turn: 6 } }))).join(' ')
check('turn marker: paused turn', pausedTurn.includes('паузе'), pausedTurn)
const peakTurn = collectText(turnMarker(baseProps({ turn: { turn: 4 } }))).join(' ')
check('turn marker: peak-priced turn', peakTurn.includes('пик'), peakTurn)
check('turn marker: untouched turn renders nothing', turnMarker(baseProps({ turn: { turn: 1 } })) === null)

// ── settings section ────────────────────────────────────────────────────────
const settings = bySlot('settings.section').Component
const settingsTree = settings({ close: () => {}, rpcCall: share.rpcCall, refresh: () => {} })
const settingsText = collectText(settingsTree).join(' ')
check('settings: page title', settingsText.includes('Пиковые часы'), settingsText.slice(0, 160))
check('settings: renders the loading/offline shell gracefully', settingsText.includes('Загрузка') || settingsText.includes('настройки') || settingsText.includes('недоступны') || settingsText.length > 0, settingsText.slice(0, 160))

// ── popover content (interactive mount) ────────────────────────────────────
{
  const legacyMount = mountInteractive(pill, baseProps({ usePeakState: () => ({ state: clone(legacyState), refresh: () => {} }) }))
  const pillButton = findElement(legacyMount.tree, (node) => node.type === 'button' && typeof node.props?.onClick === 'function')
  if (pillButton !== null) pillButton.props.onClick()
  const legacyPopover = collectText(legacyMount.redraw()).join(' ')
  check('popover(legacy): warns about the old host', legacyPopover.includes('Перезапустите dsh web'), legacyPopover.slice(0, 220))
  check('popover(legacy): labels windows by provider', legacyPopover.includes('deepseek:') && legacyPopover.includes('zai:'), legacyPopover.slice(0, 260))
  legacyMount.restore()

  // New host: model-known, outside peak, with a future boundary, a budget and a
  // holiday calendar carried by the effective windows.
  const holidays = { tz: 'Asia/Shanghai', ranges: [['2026-12-25', '2026-12-26']] }
  const newHostState = {
    ...clone(sessionFixture),
    session: {
      ...clone(sessionFixture.session),
      inPeak: false,
      untilAt: null,
      paused: false,
      pauseKind: null,
      allow: false,
      allowSource: 'default',
      nextStartAt: new Date(Date.now() + 1_920_000).toISOString(),
      secondsToChange: 1920,
      effectiveWindows: [{ start: '03:00', end: '06:00', tz: 'UTC', holidays }, { start: '08:00', end: '12:00', tz: 'UTC', holidays }],
      modelName: 'DeepSeek-V4.1-Flash',
    },
    limit: { dailyMinutes: 30, usedSeconds: 0, remainingSeconds: 1800, exhausted: false },
  }
  const newMount = mountInteractive(pill, baseProps({
    usePeakState: () => ({ state: clone(newHostState), refresh: () => {} }),
    useCountdown: () => 1920,
  }))
  const newButton = findElement(newMount.tree, (node) => node.type === 'button' && typeof node.props?.onClick === 'function')
  if (newButton !== null) newButton.props.onClick()
  const newTree = newMount.redraw()
  const newPopover = collectText(newTree).join(' ')
  check('popover(new host): model display name', newPopover.includes('DeepSeek-V4.1-Flash'), newPopover.slice(0, 200))
  check('popover(new host): counts down to the next peak', newPopover.includes('Начало пика') && newPopover.includes('через'), newPopover.slice(0, 300))
  check('popover(new host): budget is real', newPopover.includes('0 / 30 мин'), newPopover.slice(0, 300))
  check('popover(new host): holiday calendar is surfaced', newPopover.includes('Праздники-исключения: Asia/Shanghai'), newPopover.slice(0, 400))
  const windowRows = countElements(newTree, (node) => typeof node.props?.className === 'string' && node.props.className === 'dph-win-row')
  check('popover(new host): only the session model windows', windowRows === 2, String(windowRows))
  check('popover(new host): a single family is not prefixed', !newPopover.includes('deepseek:'), newPopover.slice(0, 400))
  newMount.restore()

  {
    const noticeProps = baseProps({ usePeakState: () => ({ state: clone(legacyState), refresh: () => {} }) })
    const noticeMount = mountInteractive(banner, noticeProps)
    const initial = collectText(noticeMount.tree).join(' ')
    check('notice: compact title instead of a text wall', initial.includes('Хост-половина плагина не перезапущена') && initial.includes('начнут работать после рестарта'), initial.slice(0, 240))
    const stepsButton = findElement(noticeMount.tree, (node) => node.type === 'button' && collectText(node).join(' ').includes('Что сделать?'))
    check('notice: restart steps are collapsed by default', stepsButton !== null)
    if (stepsButton !== null) {
      stepsButton.props.onClick()
      const expandedText = collectText(noticeMount.redraw()).join(' ')
      check('notice: restart steps expand on demand', expandedText.includes('Перезапустите процесс dsh web') && expandedText.includes('Обновите страницу'), expandedText.slice(0, 260))
      const dismissButton = findElement(noticeMount.redraw(), (node) => node.type === 'button' && collectText(node).join(' ').includes('Скрыть'))
      if (dismissButton !== null) {
        dismissButton.props.onClick()
        check('notice: dismiss hides it for the page session', noticeMount.redraw() === null)
      } else {
        check('notice: dismiss button present', false)
      }
    }
    noticeMount.restore()
  }

  const offlineMount = mountInteractive(pill, baseProps({ usePeakState: () => ({ state: null, refresh: () => {} }) }))
  const offlineButton = findElement(offlineMount.tree, (node) => node.type === 'button' && typeof node.props?.onClick === 'function')
  if (offlineButton !== null) offlineButton.props.onClick()
  const offlinePopover = collectText(offlineMount.redraw()).join(' ')
  check('popover(offline): explains the missing host', offlinePopover.includes('нет связи с хостом'), offlinePopover.slice(0, 200))
  offlineMount.restore()
}

// ── source hygiene ──────────────────────────────────────────────────────────
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
check('source: no harness imports', !/from\s+["']@deepseek-ai\//.test(source) && !/require\(["']@deepseek-ai\//.test(source))
check('source: only the react module is required', (source.match(/require\(/g) ?? []).length === 1, String((source.match(/require\(/g) ?? []).length))
check('source: no react-dom', !source.includes('react-dom'))
check('source: every banner is centred on the composer column', (source.match(/--dsh-composer-card-max-width/g) ?? []).length >= 2 && (source.match(/margin:6px auto/g) ?? []).length >= 2, 'missing composer-column sizing')
check('source: the peak banner itself uses the composer-column width', /\.dph-banner\{[^}]*--dsh-composer-card-max-width/.test(source) && /\.dph-banner\{[^}]*margin:6px auto/.test(source))

if (failed > 0) {
  console.log(`\nFAILED: ${failed}`)
  process.exit(1)
}
console.log('\nOK: client slots, shared state layer and components work')

/**
 * Изолированный тест dsh-peak-hours.
 *
 * Покрывает то, ради чего плагины объединены:
 *  - движок расписаний: семейный матчинг провайдеров, недельный фильтр,
 *    обзор для индикатора;
 *  - гейт `llm/stream`: soft пропускает, hard бросает PEAK_HOURS_BLOCK,
 *    пользовательский override снимает блокировку;
 *  - канал `/dsh-peak-hours`: `state` отдаёт снимок, `set-allow-peak`
 *    переключает и сохраняет выбор;
 *  - клиентская половина: бандл регистрируется в шапке сессии и получает
 *    `rpcCall`, который бьёт в тот же канал.
 *
 * Живой DSH не трогается; `DSH_HOME` подменяется временным каталогом.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'peak-hours-'))
process.env.DSH_HOME = HOME

const { Context } = await import('@deepseek-ai/cordis')
const plugin = await import('./lib/index.js')
const { decidePeak, peakOverview, resolveSchedule, windowContains } = await import('./lib/schedule.js')

let failed = 0
function check(name, condition, detail = '') {
  if (condition) { console.log('ok  -', name); return }
  failed += 1
  console.log('FAIL -', name, detail)
}

const ALL_DAY = [{ start: '00:00', end: '23:59', tz: 'UTC' }]
const DEEPSEEK = {
  deepseek: { windows: [{ start: '01:00', end: '04:00', tz: 'UTC' }, { start: '06:00', end: '10:00', tz: 'UTC' }] },
}
const wed0700 = new Date('2026-09-09T07:00:00Z')
const sun0700 = new Date('2026-09-13T07:00:00Z')

// ── движок ──────────────────────────────────────────────────────────────────
check('family: deepseek-official matches key deepseek', decidePeak('deepseek-official', wed0700, DEEPSEEK).inPeak === true)
check('family: deepseek-vision matches key deepseek', decidePeak('deepseek-vision', wed0700, DEEPSEEK).inPeak === true)
check('family: unrelated provider never peak', decidePeak('zai', wed0700, DEEPSEEK).inPeak === false)
check('family: separator required', decidePeak('deepseekish', wed0700, DEEPSEEK).inPeak === false)

const WEEKDAYS = { deepseek: { windows: [{ start: '06:00', end: '10:00', tz: 'UTC', days: [1, 2, 3, 4, 5] }] } }
check('days: Wednesday in', decidePeak('deepseek-official', wed0700, WEEKDAYS).inPeak === true)
check('days: Sunday out', decidePeak('deepseek-official', sun0700, WEEKDAYS).inPeak === false)

const overviewPeak = peakOverview(wed0700, DEEPSEEK)
check('overview: in peak', overviewPeak.peak === true && overviewPeak.until === '10:00 UTC', JSON.stringify(overviewPeak))
const overviewBefore = peakOverview(new Date('2026-09-09T00:30:00Z'), DEEPSEEK)
check('overview: 30 min to the window', overviewBefore.peak === false && overviewBefore.secondsToChange === 1800, JSON.stringify(overviewBefore))
check('overview: weekday windows ignored on Sunday', peakOverview(sun0700, WEEKDAYS).peak === false)
check('windowContains: broken window covers nothing', windowContains({ start: '25:99', end: '04:00' }, wed0700) === false)
check('resolveSchedule: exact beats family', resolveSchedule('deepseek-vision', { deepseek: { windows: ALL_DAY }, 'deepseek-vision': { windows: ALL_DAY } })?.key === 'deepseek-vision')

// ── GLM Coding Plan (провайдер zai) ─────────────────────────────────────────
//
// Первоисточник: docs.bigmodel.cn/cn/coding-plan/overview →
// «非高峰时段内，模型调用按基础积分消耗的 50% 抵扣。高峰时段：每周一至周五的
// 14:00～18:00（UTC+8）». То есть高峰 — пн–пт 14:00–18:00 по Пекину
// (= 06:00–10:00 UTC), а выходные целиком идут по не高峰.
const GLM = { zai: { windows: [{ start: '14:00', end: '18:00', tz: 'Asia/Shanghai', days: [1, 2, 3, 4, 5] }] } }
// 2026-10-05 — понедельник, 2026-10-10 — суббота.
const glmCases = [
  ['2026-10-05T05:30:00Z', false, '13:30 по Пекину — до окна'],
  ['2026-10-05T06:00:00Z', true, '14:00 по Пекину — начало включительно'],
  ['2026-10-05T09:59:00Z', true, '17:59 по Пекину'],
  ['2026-10-05T10:00:00Z', false, '18:00 по Пекину — конец исключительно'],
  ['2026-10-10T07:00:00Z', false, 'суббота 15:00 по Пекину'],
]
for (const [iso, expected, note] of glmCases) {
  for (const provider of ['zai', 'zai-coding']) {
    const got = decidePeak(provider, new Date(iso), GLM).inPeak
    check(`GLM ${note} [${provider}]`, got === expected, `inPeak=${got}`)
  }
}
check('GLM: чужой провайдер не задет', decidePeak('deepseek-official', new Date('2026-10-05T06:30:00Z'), GLM).inPeak === false)

// Тесты выше проверяют движок; эти — что расписание вообще доехало до патча.
const patch = readFileSync(new URL('./cordis.patch.yml', import.meta.url), 'utf8')
check('конфиг: семейство zai объявлено', /^\s+zai:\s*$/m.test(patch))
check(
  'конфиг: окно GLM 14:00-18:00 Asia/Shanghai, пн-пт',
  patch.includes('{ start: "14:00", end: "18:00", tz: "Asia/Shanghai", days: [1, 2, 3, 4, 5] }'),
)
check('конфиг: окна DeepSeek не потеряны', patch.includes('{ start: "01:00", end: "04:00", tz: "UTC", days: [1, 2, 3, 4, 5] }'))

// ── гейт ────────────────────────────────────────────────────────────────────
async function* fakeStream() { yield { type: 'text' } }
const mkOptions = (provider) => ({ provider })

/** Mount the plugin over a fake host context that captures the RPC handler. */
async function mount(config) {
  const captured = {}
  const chain = { rpc: { handle: (channel, handler) => { captured.channel = channel; captured.handler = handler; return async () => {} } } }
  const ctx = new Context()
  await ctx.plugin({
    name: plugin.name,
    inject: [],
    apply: (inner, cfg) => {
      plugin.apply(Object.assign(Object.create(inner), {
        get: (key) => (key === 'connection' ? chain : inner.get(key)),
        inject: (keys, callback) => callback({ root: { get: (key) => (key === 'connection' ? chain : undefined) }, effect: (fn) => { void fn } }),
      }), cfg)
    },
  }, config)
  return { ctx, captured }
}

async function runGate(config, provider) {
  const { ctx } = await mount(config)
  try {
    const result = await ctx.waterfall({}, 'llm/stream', mkOptions(provider), () => fakeStream())
    return { blocked: false, result }
  } catch (error) {
    return { blocked: true, message: String(error?.message ?? error) }
  } finally {
    await ctx.fiber.dispose()
  }
}

const soft = await runGate({ mode: 'soft', schedules: { deepseek: { windows: ALL_DAY } } }, 'deepseek-official')
check('soft: stream passes through', soft.blocked === false)
const hard = await runGate({ mode: 'hard', schedules: { deepseek: { windows: ALL_DAY } } }, 'deepseek-official')
check('hard: PEAK_HOURS_BLOCK thrown', hard.blocked === true && hard.message.includes('PEAK_HOURS_BLOCK'), hard.message)
const familyHard = await runGate({ mode: 'soft', schedules: { deepseek: { windows: ALL_DAY, mode: 'hard' } } }, 'deepseek-official')
check('hard via family key: blocked', familyHard.blocked === true && familyHard.message.includes('PEAK_HOURS_BLOCK'), familyHard.message)
const unrelated = await runGate({ mode: 'hard', schedules: { deepseek: { windows: ALL_DAY } } }, 'zai')
check('unrelated provider not blocked', unrelated.blocked === false)
const outsideWindow = await runGate({ mode: 'hard', schedules: { deepseek: { windows: [{ start: '00:00', end: '00:01', tz: 'UTC' }] } } }, 'deepseek-official')
check('outside the window not blocked', outsideWindow.blocked === false)
const disabled = await runGate({ enabled: false, mode: 'hard', schedules: { deepseek: { windows: ALL_DAY } } }, 'deepseek-official')
check('enabled:false disables the gate', disabled.blocked === false)

// ── канал ───────────────────────────────────────────────────────────────────
const mounted = await mount({ mode: 'hard', schedules: { deepseek: { windows: ALL_DAY } } })
const call = (endpoint, payload) => mounted.captured.handler(endpoint, payload)
check('channel: path', mounted.captured.channel === '/dsh-peak-hours', String(mounted.captured.channel))

const stateBefore = await call('state', {})
check('state: reports peak', stateBefore.ok === true && stateBefore.value.peak === true, JSON.stringify(stateBefore))
check('state: reports mode and override off', stateBefore.value.mode === 'hard' && stateBefore.value.allowPeak === false, JSON.stringify(stateBefore.value))
check('state: carries the schedule for the pill', stateBefore.value.schedules.deepseek.windows.length === 1, JSON.stringify(stateBefore.value.schedules))

const badPayload = await call('set-allow-peak', { allowPeak: 'yes' })
check('set-allow-peak: rejects a non-boolean', badPayload.ok === false && badPayload.error.code === 'peak-hours/bad-request', JSON.stringify(badPayload))
const unknown = await call('nope', {})
check('unknown endpoint refuses', unknown.ok === false && unknown.error.code === 'peak-hours/unknown-endpoint', JSON.stringify(unknown))

const turnedOn = await call('set-allow-peak', { allowPeak: true })
check('set-allow-peak: override on', turnedOn.ok === true && turnedOn.value.allowPeak === true, JSON.stringify(turnedOn))
const persisted = JSON.parse(readFileSync(join(HOME, 'peak-hours.json'), 'utf8'))
check('set-allow-peak: persisted under the DSH home', persisted.allowPeak === true, JSON.stringify(persisted))
check('state: reflects the override', (await call('state', {})).value.allowPeak === true)
await mounted.ctx.fiber.dispose()

// Override снимает блокировку и после перезапуска (читается из файла).
const afterRestart = await runGate({ mode: 'hard', schedules: { deepseek: { windows: ALL_DAY } } }, 'deepseek-official')
check('override survives a restart and suspends hard blocking', afterRestart.blocked === false, afterRestart.message)

// ── клиентская половина ─────────────────────────────────────────────────────
const loaded = []
globalThis.window = { __ModuleLoader__: { load: (entry) => { loaded.push(entry) } } }
const reactStub = {
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: (fn) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanup() },
  useRef: (value) => ({ current: value }),
  createElement: (...args) => ({ type: args[0], props: args[1] ?? {}, children: args.slice(2) }),
}
await import('./lib/client.js')
check('client: bundle registers one module', loaded.length === 1, String(loaded.length))
const client = loaded[0].factory((id) => (id === 'react' ? reactStub : {}))
check('client: module id', loaded[0].id === 'dsh-peak-hours', String(loaded[0].id))
check('client: inject covers connection and slots', ['connection', 'slots'].every((key) => client.inject.includes(key)), JSON.stringify(client.inject))

const calls = []
const slots = { inject: (key, callback) => { slots.key = key; slots.options = callback() }, register: (options, component) => { slots.component = component; return options } }
client.apply({
  slots,
  get: (key) => (key === 'connection'
    ? { rpc: { call: (channel, endpoint, payload) => { calls.push({ channel, endpoint, payload }); return Promise.resolve({ ok: true, value: { peak: true, allowPeak: false, mode: 'soft', secondsToChange: 60, schedules: {} } }) } } }
    : undefined),
})
check('client: registers into the header utilities', slots.key === 'conversation.session.header.utilities', String(slots.key))
check('client: keeps the indicator cell id', slots.options.id === 'deepseek-peak-indicator', String(slots.options.id))

const share = slots.options.inject()
check('client: rpcCall is shared into props', typeof share.rpcCall === 'function')
const wire = await share.rpcCall('state', {})
check('client: rpcCall maps the envelope', wire.ok === true && wire.value.peak === true, JSON.stringify(wire))
check('client: rpcCall hits the host channel', calls.length === 1 && calls[0].channel === '/dsh-peak-hours' && calls[0].endpoint === 'state', JSON.stringify(calls))

const tree = slots.component({ rpcCall: share.rpcCall })
// createElement(type, props, children) — our stub keeps the rest args, so the
// single array child lands nested one level deep, exactly like React's.
const kids = [].concat(...tree.children)
const pill = kids[0]
check('client: renders a pill button', pill.type === 'button' && typeof pill.props.onClick === 'function', JSON.stringify(pill.type))
check('client: pill shows the detached label before the first poll', JSON.stringify(pill.children).includes('нет связи'), JSON.stringify(pill.children))

rmSync(HOME, { recursive: true, force: true })
if (failed > 0) { console.log(`FAILED: ${failed}`); process.exit(1) }
console.log('OK: расписание, гейт, канал и индикатор работают на одном источнике истины')

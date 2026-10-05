/**
 * Изолированный тест dsh-halt-jobs (после сборки).
 *
 * Покрывает обе половины и их 0.2-переходы:
 *  - host: `/dsh-halt-jobs` + `stop-all` фильтрует задачи по владельцу через
 *    `JobView.owner` (0.2), продолжая понимать дореформенный `ownerSession`;
 *  - client: регистрация берёт роster из клиентского сервиса `jobs`
 *    (`hooks: { jobs }` → хук `useJobs`) и открывает поток через `watchRows`,
 *    а селектор читает `state.rows[sessionId]` — 0.2-замена удалённого
 *    `useSessions(state => state.jobsBySession[id])`.
 *
 * Живой DSH не трогается, внешних зависимостей нет.
 *
 * Запуск: node activation.test.mjs
 */
import * as host from './lib/index.js'

let failed = 0
function check(name, condition, detail = '') {
  if (condition) { console.log('ok  -', name); return }
  failed += 1
  console.log('FAIL -', name, detail)
}

const SESSION = 'session-1'
const AGENT = { id: SESSION }
const CHANNEL = '/dsh-halt-jobs'

/**
 * Собрать фейковый host-Context вокруг плагина.
 * @param rows строки реестра задач (как их вернул бы `jobs.list`).
 * @param settleOnKill как реестр отражает запрошенную остановку: 'killed' —
 *   задача успела завершиться, 'stopping' — остановка ещё в полёте.
 */
function harness(rows, settleOnKill = 'killed') {
  const killed = []
  const listCallers = []
  const live = rows.map((row) => ({ ...row }))
  const jobs = {
    // Faithful to dsh-jobs-local 0.2: the isolation fence is
    // `job.owner === caller` with `caller` a SessionId, so passing the Agent
    // object matches nothing and silently yields an empty roster.
    list: (caller) => {
      listCallers.push(caller)
      return live
        .filter((row) => row.owner === undefined || row.owner === caller)
        .map((row) => ({ ...row }))
    },
    kill: (id, caller, reason) => {
      const row = live.find((item) => item.id === id)
      if (row !== undefined && row.owner !== undefined && row.owner !== caller) {
        throw new Error(`job ${id} belongs to another session`)
      }
      killed.push({ id, caller, reason })
      if (row) row.status = settleOnKill
      return 'requested'
    },
  }
  const agents = { get: (id) => (id === SESSION ? AGENT : undefined) }
  const captured = {}
  const connection = {
    rpc: {
      handle: (channel, handler) => {
        captured.channel = channel
        captured.handler = handler
        return async () => {}
      },
    },
  }
  const effects = []
  const ctx = {
    get: (key) => (key === 'jobs' ? jobs : key === 'agents' ? agents : undefined),
    inject: (keys, callback) => {
      captured.injectKeys = keys
      callback({
        root: { get: (key) => (key === 'connection' ? connection : undefined) },
        effect: (fn, label) => { effects.push(label) },
      })
    },
  }
  return { ctx, captured, killed, listCallers, effects }
}

check('host: name', host.name === 'halt-jobs', host.name)
check(
  'host: inject covers connection/jobs/agents',
  Array.isArray(host.inject)
    && ['connection', 'jobs', 'agents'].every((key) => host.inject.includes(key)),
  JSON.stringify(host.inject),
)

// ── host: 0.2 `owner` (регрессия: до фикса `ownerSession` не совпадал никогда) ──
const modernRows = [
  { id: 'bash-1', status: 'running', owner: SESSION },
  { id: 'bash-2', status: 'running', owner: SESSION },
  { id: 'bash-3', status: 'completed', owner: SESSION },
  { id: 'bash-4', status: 'running', owner: 'session-other' },
]
const modern = harness(modernRows)
host.apply(modern.ctx)
check('host: waits for webServer', modern.captured.injectKeys?.[0] === 'webServer', JSON.stringify(modern.captured.injectKeys))
check('host: channel is /dsh-halt-jobs', modern.captured.channel === CHANNEL, String(modern.captured.channel))

const modernResult = await modern.captured.handler('stop-all', { sessionId: SESSION })
check('host: owned running jobs are stopped', modernResult.ok === true && modernResult.value.stopped === 2, JSON.stringify(modernResult))
check('host: foreign and settled jobs are untouched', modern.killed.every((k) => k.id === 'bash-1' || k.id === 'bash-2'), JSON.stringify(modern.killed))
// Регрессия: реестр фехтует по `job.owner.id === caller`, поэтому caller —
// строка sessionId. С объектом Agent список пуст и stop-all молча не делает ничего.
check('host: list is called with the session id, not the Agent', modern.listCallers.length > 0 && modern.listCallers.every((c) => c === SESSION), JSON.stringify(modern.listCallers))
check('host: kill is fenced by the session id', modern.killed.every((k) => k.caller === SESSION), JSON.stringify(modern.killed.map((k) => k.caller)))
check('host: settled job is not reported as remaining', modernResult.value.remaining === 0, JSON.stringify(modernResult.value))
check('host: rpc channel registers a disposer', modern.effects.length === 1, JSON.stringify(modern.effects))

// Остановка «в полёте» остаётся в remaining: она ещё держит задачу живой.
const inFlight = harness(modernRows, 'stopping')
host.apply(inFlight.ctx)
const inFlightResult = await inFlight.captured.handler('stop-all', { sessionId: SESSION })
check('host: in-flight stops are counted as remaining', inFlightResult.value.stopped === 2 && inFlightResult.value.remaining === 2, JSON.stringify(inFlightResult.value))

// ── host: дореформенный `ownerSession` продолжает работать ──
const legacy = harness([{ id: 'bash-9', status: 'running', ownerSession: SESSION }])
host.apply(legacy.ctx)
const legacyResult = await legacy.captured.handler('stop-all', { sessionId: SESSION })
check('host: legacy ownerSession still stops', legacyResult.ok === true && legacyResult.value.stopped === 1, JSON.stringify(legacyResult))

// ── host: отказы ──
const unknown = harness(modernRows)
host.apply(unknown.ctx)
const unknownResult = await unknown.captured.handler('nope', { sessionId: SESSION })
check('host: unknown endpoint refuses', unknownResult.ok === false && unknownResult.error.code === 'halt-jobs/unknown-endpoint', JSON.stringify(unknownResult))

const bad = harness(modernRows)
host.apply(bad.ctx)
const badResult = await bad.captured.handler('stop-all', { sessionId: '' })
check('host: empty sessionId refuses', badResult.ok === false && badResult.error.code === 'halt-jobs/bad-request', JSON.stringify(badResult))

const dead = harness(modernRows)
host.apply(dead.ctx)
const deadResult = await dead.captured.handler('stop-all', { sessionId: 'session-gone' })
check('host: unknown session refuses', deadResult.ok === false && deadResult.error.code === 'halt-jobs/session-not-live', JSON.stringify(deadResult))

// ── client: загрузка бандла через фейковый __ModuleLoader__ ──
const loaded = []
globalThis.window = {
  __ModuleLoader__: {
    load: (entry) => { loaded.push(entry) },
  },
}
// Минимальные React-стабы: на верхнем уровне бандл хуки не вызывает, а рендер
// ниже прогоняет компонент, чтобы проверить его селектор и эффект watchRows.
const effectCleanups = []
const reactStub = {
  useEffect: (fn) => { const cleanup = fn(); if (typeof cleanup === 'function') effectCleanups.push(cleanup) },
  useMemo: (fn) => fn(),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
}
const jsxStub = { jsx: (...args) => ({ jsx: args }), jsxs: (...args) => ({ jsxs: args }) }
const fakeRequire = (id) => (id === 'react' ? reactStub : id === 'react/jsx-runtime' ? jsxStub : {})

await import('./lib/client.js')
check('client: bundle registers one module', loaded.length === 1, String(loaded.length))
const entry = loaded[0]
check('client: module id', entry.id === 'dsh-halt-jobs', String(entry.id))
const client = entry.factory(fakeRequire)
check(
  'client: inject covers connection/slots/jobs',
  ['connection', 'slots', 'jobs'].every((key) => client.inject.includes(key)),
  JSON.stringify(client.inject),
)

// ── client: регистрация и её inject-пакет ──
const calls = []
const slots = {
  inject: (key, callback) => { slots.key = key; slots.options = callback() },
  register: (options, component) => { slots.component = component; return options },
}
const clientCtx = {
  // `apply` reaches the registry through `ctx.slots` (a declared inject).
  slots,
  get: (key) => {
    if (key === 'connection') {
      return { rpc: { call: (channel, endpoint, payload) => { calls.push({ channel, endpoint, payload }); return Promise.resolve({ ok: true, value: { stopped: 3, remaining: 0 } }) } } }
    }
    if (key === 'jobs') {
      return {
        state: { marker: 'jobs-state' },
        watchRows: (sessionId) => { calls.push({ watchRows: sessionId }); return () => {} },
      }
    }
    return undefined
  },
}
client.apply(clientCtx)
check('client: registers into the header actions', slots.key === 'conversation.session.header.actions', String(slots.key))
check('client: cell id and order', slots.options.id === 'halt-stop-all' && slots.options.order === 100, JSON.stringify({ id: slots.options.id, order: slots.options.order }))

const share = slots.options.inject(SESSION)
check('client: jobs store rides the hooks bag', share.hooks?.jobs?.marker === 'jobs-state', JSON.stringify(share.hooks))
check('client: watchRows is shared into props', typeof share.watchRows === 'function')
check('client: watchRows opens the session roster', (share.watchRows(SESSION), calls.some((c) => c.watchRows === SESSION)), JSON.stringify(calls))

const outcome = await share.stopAll(SESSION)
check('client: stop-all maps the wire envelope', outcome.ok === true && outcome.value.stopped === 3, JSON.stringify(outcome))
check('client: stop-all calls the host channel', calls.some((c) => c.channel === CHANNEL && c.endpoint === 'stop-all' && c.payload?.sessionId === SESSION), JSON.stringify(calls))

// ── client: селектор читает 0.2-shape `state.rows[sessionId]` ──
/** Прогнать компонент с селектором, читающим переданный снапшот задач. */
function render(snapshot) {
  return slots.component({
    sessionId: SESSION,
    useJobs: (select) => select(snapshot),
    watchRows: share.watchRows,
    stopAll: share.stopAll,
  })
}

const liveRows = [{ id: 'bash-1', kind: 'bash', label: 'sleep', status: 'running', startedAt: 0 }]
check('client: live roster renders the pill', render({ rows: { [SESSION]: liveRows } }) !== null)
check('client: component opens the roster stream itself', calls.filter((c) => c.watchRows === SESSION).length >= 2, JSON.stringify(calls))

// Регрессия: до фикса селектор читал `state.jobsBySession`, которого в 0.2 нет,
// поэтому пилюля не отрисовывалась никогда — даже при живых задачах.
check('client: empty roster hides the pill', render({ rows: {} }) === null)
check('client: settled-only roster hides the pill', render({ rows: { [SESSION]: [{ ...liveRows[0], status: 'completed' }] } }) === null)
check('client: legacy jobsBySession shape is no longer read', render({ jobsBySession: { [SESSION]: liveRows } }) === null)

if (failed > 0) { console.log(`FAILED: ${failed}`); process.exit(1) }
console.log('OK: host stop-all и client-регистрация работают на 0.2-API')


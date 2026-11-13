/**
 * Изолированный activation-тест dsh-vv-panel (web-client плагин).
 *
 * Загружает client.js через стаб `window.__ModuleLoader__`, исполняет factory
 * со стабом React и проверяет контракт регистрации в Host-композиции:
 * inject-зависимости, локали en/ru с совпадающим набором ключей и ровно одну
 * запись в слот `conversation.input.left` с id `vv-panel`.
 *
 * Живой DSH и настоящий React не нужны. Запуск: node activation.test.mjs
 */
import { readFileSync } from 'node:fs'

let failed = 0
function check(name, condition, detail = '') {
  if (condition) { console.log('ok  -', name); return }
  failed += 1
  console.log('FAIL -', name, detail)
}

// ── стабы окружения ─────────────────────────────────────────────────────────
let loaderConfig
globalThis.window = {
  __ModuleLoader__: {
    load(config) { loaderConfig = config },
  },
}

/** Минимальный React: factory использует только createElement в render. */
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
}

await import('./client.js')

check('loader: client.js registers exactly one module', loaderConfig !== undefined
  && typeof loaderConfig.id === 'string' && loaderConfig.id === 'dsh-vv-panel')
check('loader: factory is a function', typeof loaderConfig.factory === 'function')

const moduleExports = loaderConfig.factory((name) => {
  if (name === 'react') return reactStub
  throw new Error(`unexpected require(${name})`)
})

check('module: inject declares slots + locale', Array.isArray(moduleExports.inject)
  && moduleExports.inject.includes('slots') && moduleExports.inject.includes('locale')
  && typeof moduleExports.apply === 'function')

// ── стаб ctx + прогон apply ─────────────────────────────────────────────────
const locales = new Map()
const registrations = []
const binds = []
let injectedDeps
let remoteDisposer
const remoteChild = { remote: { workspaceFiles: { list: async () => ({ ok: true, value: { entries: [] } }) } } }
const ctx = {
  effect(callback) { callback(); return () => {} },
  // The proxied Client context forbids ctx.get() on undeclared services; the
  // panel must never call it (the crash class that removed the toolbar).
  get() { throw new Error('ctx.get must not be used: declare the service in ctx.inject') },
  inject(deps, callback) {
    injectedDeps = deps
    remoteDisposer = callback(remoteChild)
    return () => {}
  },
  locale: {
    register(namespace, locale, dict) { locales.set(locale, { namespace, dict }) },
    bind(namespace) { binds.push(namespace); return (key) => key },
  },
  slots: {
    inject(name, callback) { callback(); return () => {} },
    register(options, component) { registrations.push({ options, component }); return () => {} },
  },
}

moduleExports.apply(ctx)

check('apply: locale bound once to the panel namespace', binds.length === 1 && binds[0] === 'vvPanel')
check('apply: en + ru dictionaries registered', locales.has('en') && locales.has('ru'))
const enKeys = Object.keys(locales.get('en').dict).sort()
const ruKeys = Object.keys(locales.get('ru').dict).sort()
check('apply: en/ru key sets match', enKeys.length > 0 && enKeys.join('|') === ruKeys.join('|'),
  `${enKeys.length} vs ${ruKeys.length}`)
check('apply: both dictionaries use the panel namespace',
  locales.get('en').namespace === 'vvPanel' && locales.get('ru').namespace === 'vvPanel')

check('apply: exactly one slot registration', registrations.length === 1)
const registration = registrations[0]
check('slot: registered into conversation.input.left', registration.options.name === 'conversation.input.left')
check('slot: stable id + order', registration.options.id === 'vv-panel' && registration.options.order === 10)
check('slot: component is a function', typeof registration.component === 'function')
check('slot: props kit injected (vvT + vvRemote)', typeof registration.options.inject === 'function'
  && typeof registration.options.inject().vvT === 'function'
  && typeof registration.options.inject().vvRemote === 'function')

// ── Host Remote: объявленный inject, а не ctx.get (класс краша панели) ───────
check('remote: dynamic inject declares the dotted Remote services', Array.isArray(injectedDeps)
  && injectedDeps.includes('remote') && injectedDeps.includes('remote.workspaceFiles'))
check('remote: getter exposes the mounted face', registration.options.inject().vvRemote() === remoteChild.remote)
check('remote: unmount disposes the face (fallback path stays honest)',
  typeof remoteDisposer === 'function'
  && (remoteDisposer(), registration.options.inject().vvRemote() === undefined))

// ── §K: клиентская stale-семантика (только approved-окно) ────────────────────
// Клиент выводит stale-approval по approvals.json. Проверяем, что в исходнике
// digest-сверка ограничена статусом approved, а applied считается легальным
// флипом executor'а — иначе каждый исполненный пакет навсегда «устарел».
const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const staleStart = source.indexOf('async function staleArtifact')
const staleFn = source.slice(source.lastIndexOf('/**', staleStart), source.indexOf('async function deriveOperationalState'))
check('stale: client checks only the approved window', staleFn.includes("if (status !== 'approved') continue")
  && !staleFn.includes("status !== 'applied'"))
check('stale: applied flip is documented as legal', staleFn.includes('mark-applied')
  && staleFn.includes('consumed by execution'))

console.log(failed === 0 ? '\nOK: dsh-vv-panel загружается и регистрируется' : `\nFAILED: ${failed}`)
process.exit(failed === 0 ? 0 : 1)

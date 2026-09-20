/**
 * Изолированный тест активации host-половины dsh-task-scheduler.
 *
 * Не трогает живой DSH: DSH_HOME перенаправляется во временную папку ДО
 * импорта плагина, монтируются стабы сервисов (tools/webServer/shell/sessions/
 * subagents/agentPresets/agentDefaultModel/sandboxPolicy/sessionTitle), после
 * чего проверяются: активация apply, регистрация тула task_trigger, HTTP API
 * (/state, /saveTask, /runTask со скриптом через стаб shell), cron-парсер и
 * чистый dispose.
 *
 * Запуск: node activation.test.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const work = mkdtempSync(join(tmpdir(), 'tsched-test-'))
process.env.DSH_HOME = join(work, 'home')
mkdirSync(join(work, 'ws'), { recursive: true })
writeFileSync(join(work, 'ws', 'task.ts'), "console.log('hi')\n")

const { Context, Service } = await import('@deepseek-ai/cordis')
const plugin = await import('./lib/index.js')

let failed = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log('ok  -', name)
    return
  }
  failed += 1
  console.log('FAIL -', name, detail)
}

class StubTools extends Service {
  constructor(ctx) {
    super(ctx, 'tools')
    this.registered = []
  }
  register(definition) {
    this.registered.push(definition)
    return () => {}
  }
}

class StubWebServer extends Service {
  constructor(ctx) {
    super(ctx, 'webServer')
    this.routes = []
  }
  register(route) {
    this.routes.push(route)
    return () => {}
  }
}

class StubShell extends Service {
  constructor(ctx) {
    super(ctx, 'shell')
  }
  resolve(spec) {
    return spec
  }
  async run(spec) {
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: { text: `[shell-stub] ${spec.command}`, truncated: false },
      stderr: { text: '', truncated: false },
    }
  }
}

class StubSessions extends Service {
  constructor(ctx, fixture) {
    super(ctx, 'sessions')
    this.fixture = fixture
  }
  get(id) {
    return { header: { cwd: this.fixture }, id }
  }
  list() {
    return []
  }
}

class StubSubagents extends Service {
  constructor(ctx) {
    super(ctx, 'subagents')
  }
  list() {
    return ['fork']
  }
}

class StubPresets extends Service {
  constructor(ctx) {
    super(ctx, 'agentPresets')
    this.mounted = []
  }
  async resolve() {
    return { id: 'standard' }
  }
  async mount(agentCtx, id) {
    this.mounted.push(id)
  }
}

class StubDefaultModel extends Service {
  constructor(ctx) {
    super(ctx, 'agentDefaultModel')
  }
  currentSelection() {
    return { provider: 'deepseek', model: 'deepseek-chat' }
  }
}

class StubSandboxPolicy extends Service {
  constructor(ctx, fixture) {
    super(ctx, 'sandboxPolicy')
    this.workspaceRoot = fixture
    this.defaultMode = 'workspace-write'
  }
  resolve(request) {
    return { mode: 'workspace-write', workspaceRoot: this.workspaceRoot }
  }
  overrideOf() {
    return undefined
  }
}

class StubSessionTitle extends Service {
  constructor(ctx) {
    super(ctx, 'sessionTitle')
  }
  rename(_session, _title) {}
}

try {
  const root = new Context()
  const fixture = join(work, 'ws')
  await root.plugin(StubTools)
  await root.plugin(StubWebServer)
  await root.plugin(StubShell)
  await root.plugin(StubSessions, fixture)
  await root.plugin(StubSubagents)
  await root.plugin(StubPresets)
  await root.plugin(StubDefaultModel)
  await root.plugin(StubSandboxPolicy, fixture)
  await root.plugin(StubSessionTitle)
  await root.plugin(plugin)

  const tools = root.tools
  const trigger = tools.registered.find((d) => d.name === 'task_trigger')
  check('task_trigger зарегистрирован', trigger !== undefined)

  const routes = root.webServer.routes
  check('HTTP API маршрут зарегистрирован', routes.length === 1 && routes[0].path === '/dsh-tsched/api')
  check('маршрут с kind prefix', routes[0].kind === 'prefix')

  async function call(method, path, body) {
    const status = { code: 0, body: '' }
    const req = {
      method,
      url: path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        if (body !== undefined) yield Buffer.from(JSON.stringify(body))
      },
    }
    const res = {
      writeHead(code) {
        status.code = code
      },
      end(data) {
        status.body = data
      },
    }
    await routes[0].handler(req, res)
    return { code: status.code, json: JSON.parse(status.body || '{}') }
  }

  const state0 = await call('GET', '/dsh-tsched/api/state?sessionId=s-1')
  check('GET /state отвечает ok', state0.code === 200 && state0.json.ok === true)
  check('state: задач 0', state0.json.tasks.length === 0)
  check('state: root = фикстура сессии', state0.json.root === fixture)

  const saveBad = await call('POST', '/dsh-tsched/api/saveTask', { sessionId: 's-1', task: { name: 'x', kind: 'script', source: 'nope.ts' } })
  check('saveTask: отсутствующий файл отклоняется', saveBad.code === 400 && String(saveBad.json.error).includes('not found'))

  const saveOk = await call('POST', '/dsh-tsched/api/saveTask', { sessionId: 's-1', task: { name: 'Тест', kind: 'script', source: 'task.ts', env: { WHO: 't' } } })
  check('saveTask: валидная задача сохраняется', saveOk.code === 200 && saveOk.json.ok === true)

  const cronBad = await call('POST', '/dsh-tsched/api/saveTask', { sessionId: 's-1', task: { name: 'x2', kind: 'script', source: 'task.ts', cron: 'bad cron' } })
  check('saveTask: плохой cron отклоняется', cronBad.code === 400)

  const run1 = await call('POST', '/dsh-tsched/api/runTask', { sessionId: 's-1', id: saveOk.json.task.id })
  check('runTask: скрипт стартует', run1.code === 200 && run1.json.ok === true)

  await new Promise((r) => setTimeout(r, 150))
  const state1 = await call('GET', '/dsh-tsched/api/state?sessionId=s-1')
  const runRow = state1.json.runs[0]
  check('run: статус success', runRow && runRow.status === 'success')
  check('run: exit code 0', runRow && runRow.exitCode === 0)
  check('run: stdout содержит shell-stub', String(runRow.stdoutTail).includes('shell-stub'))
  check('задача: lastRunAt проставлен', state1.json.tasks[0].lastRunAt !== null)

  const triggerRes = await trigger.execute({ task: 'Тест' })
  check('task_trigger: запуск по имени', triggerRes.ok === true && typeof triggerRes.runId === 'string')

  const del = await call('POST', '/dsh-tsched/api/deleteTask', { sessionId: 's-1', id: saveOk.json.task.id })
  check('deleteTask работает', del.code === 200 && del.json.ok === true)

  const stateFile = join(work, 'home', 'task-scheduler', 'tasks.json')
  const { existsSync, readFileSync } = await import('node:fs')
  await new Promise((r) => setTimeout(r, 500))
  check('стейт-файл персистится в DSH home', existsSync(stateFile))
  if (existsSync(stateFile)) {
    const persisted = JSON.parse(readFileSync(stateFile, 'utf8'))
    check('персист: задач 0 после удаления', persisted.tasks.length === 0)
    check('персист: история запусков сохранена', persisted.runs.length >= 1)
  }

  await root.fiber.dispose()
  check('dispose проходит чисто', true)
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failed > 0) {
  console.log(`\n${failed} проверок не прошло`)
  process.exit(1)
}
console.log('\nOK: host-половина активируется, API и тул работают, стейт персистится')

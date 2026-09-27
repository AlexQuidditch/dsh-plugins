/**
 * Изолированный тест активации host-половины dsh-managed-sessions.
 *
 * Не трогает живой DSH: монтируются стабы host-сервисов (tools,
 * sessionController, sessions, agents, workspaceRegistry, sandboxPolicy),
 * после чего проверяются: активация apply, регистрация четырёх тулов,
 * create+prompt при spawn, фенс allowedRoots, разбор tail в session_status,
 * наследование sandbox-режима, cancel и чистый dispose.
 *
 * Запуск: node activation.test.mjs
 * (нужен резолвящийся @deepseek-ai/cordis; node_modules/ в .gitignore)
 */

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

const CALLER_CWD = '/ws/project'
const OUTSIDE_CWD = '/elsewhere/project'

/** Каждое append-событие любой live-сессии — сюда: так видно sandbox-наследование. */
const appends = []

/**
 * Живая сессия в том объёме, который читает плагин: header.cwd и append.
 * Плагин читает из неё только листовые поля — стаб повторяет именно это.
 */
function makeLiveSession(cwd) {
  return {
    header: { cwd },
    events: [],
    append(event, data) {
      appends.push({ event, data, cwd })
    },
  }
}

class StubTools extends Service {
  constructor(ctx) {
    super(ctx, 'tools')
    this.registered = []
    this.disposed = []
  }
  register(definition) {
    this.registered.push(definition)
    return () => {
      this.disposed.push(definition.name)
    }
  }
}

class StubSessionController extends Service {
  constructor(ctx, live) {
    super(ctx, 'sessionController')
    this.live = live
    this.calls = []
    this.failPrompt = false
    this.nextId = 0
  }
  async create(request) {
    this.calls.push({ method: 'create', request })
    this.nextId += 1
    const sessionId = request.sessionId || `session-stub-${this.nextId}`
    this.live.set(sessionId, makeLiveSession(request.cwd || CALLER_CWD))
    return { sessionId }
  }
  async prompt(request, signal) {
    this.calls.push({ method: 'prompt', request })
    if (signal !== undefined && typeof signal.throwIfAborted === 'function') signal.throwIfAborted()
    if (this.failPrompt) throw new Error('agent busy (stub)')
    return { accepted: true }
  }
  async rename(request) {
    this.calls.push({ method: 'rename', request })
    return { title: request.title, seq: 1 }
  }
  async list() {
    const items = []
    for (const [sessionId, session] of this.live) {
      items.push({ sessionId, cwd: session.header.cwd, running: false, blank: session.events.length === 0 })
    }
    return { items }
  }
  async inspect(sessionId) {
    const session = this.live.get(sessionId)
    if (session === undefined) throw new Error(`session "${sessionId}" not found`)
    return { meta: { cwd: session.header.cwd }, inheritedEventCount: 0, events: session.events }
  }
  async cancel(request) {
    this.calls.push({ method: 'cancel', request })
    return { accepted: true }
  }
  async modelCatalog() {
    this.calls.push({ method: 'modelCatalog' })
    return {
      default: { provider: 'deepseek-official', model: 'deepseek-flash' },
      routableProviders: ['deepseek-official', 'zai'],
      groups: [
        { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-flash' }, { id: 'deepseek-pro' }] },
        { id: 'zai', name: 'Z.ai', models: [{ id: 'glm-4.7' }, { id: 'deepseek-flash' }] },
      ],
      failures: [],
    }
  }
}

class StubLlm extends Service {
  constructor(ctx, accepted) {
    super(ctx, 'llm')
    this.accepted = accepted
    this.calls = []
  }
  async resolveCallConfig(config) {
    this.calls.push(config)
    if (this.accepted !== undefined) return this.accepted(config)
    return config
  }
}

class StubSessions extends Service {
  constructor(ctx, live) {
    super(ctx, 'sessions')
    this.live = live
  }
  get(id) {
    return this.live.get(id)
  }
}

class StubAgents extends Service {
  constructor(ctx, liveAgents) {
    super(ctx, 'agents')
    this.live = liveAgents
  }
  get(id) {
    return this.live.get(id)
  }
}

class StubWorkspaceRegistry extends Service {
  constructor(ctx, byPath) {
    super(ctx, 'workspaceRegistry')
    this.byPath = byPath
  }
  async resolveByPath(path) {
    return this.byPath.get(path)
  }
}

class StubSandboxPolicy extends Service {
  constructor(ctx) {
    super(ctx, 'sandboxPolicy')
    this.override = undefined
  }
  overrideOf() {
    return this.override
  }
}

class StubSkills extends Service {
  constructor(ctx) {
    super(ctx, 'skills')
    this.registered = []
    this.disposed = []
  }
  register(skill) {
    this.registered.push(skill)
    return () => {
      this.disposed.push(skill.name)
    }
  }
}

/** Корень с полным набором стабов; live-реестр сессий общий для sessions и контроллера. */
async function makeRoot(live, config, options = {}) {
  const root = new Context()
  const workspaces = new Map([[CALLER_CWD, { id: 'ws-1', path: CALLER_CWD }]])
  await root.plugin(StubTools)
  if (options.withSkills !== false) await root.plugin(StubSkills)
  await root.plugin(StubSessionController, live)
  await root.plugin(StubSessions, live)
  await root.plugin(StubAgents, new Map())
  await root.plugin(StubWorkspaceRegistry, workspaces)
  await root.plugin(StubSandboxPolicy)
  if (options.withLlm !== false) await root.plugin(StubLlm, options.llmAccepted)
  await root.plugin(plugin, config)
  return root
}

const liveSessions = new Map([['caller-1', makeLiveSession(CALLER_CWD)]])
const exec = { agent: { id: 'caller-1' }, signal: new AbortController().signal }
const byName = (tools, name) => tools.registered.find((definition) => definition.name === name)

// ── 1. активация и регистрация ──────────────────────────────────────────────

const root = await makeRoot(liveSessions, {})
const tools = root.tools
check('все четыре тула зарегистрированы', ['session_spawn', 'session_send', 'session_status', 'session_cancel'].every((name) => byName(tools, name) !== undefined), tools.registered.map((d) => d.name).join(','))
check('session_spawn требует prompt', JSON.stringify(byName(tools, 'session_spawn').parameters.required) === '["prompt"]')

// ── 1b. скилл политики делегирования ───────────────────────────────────────

const skills = root.skills
const skill = skills.registered[0]
check('скилл зарегистрирован ровно один', skills.registered.length === 1, String(skills.registered.length))
check('скилл: имя из frontmatter', skill !== undefined && skill.name === 'managed-sessions', String(skill && skill.name))
check('скилл: routing-описание непустое', skill !== undefined && typeof skill.description === 'string' && skill.description.length > 40, String(skill && skill.description))
check('скилл: frontmatter срезан, тело на месте', skill !== undefined && skill.content.trimStart().startsWith('<skill managed-sessions>') && !skill.content.includes('name: managed-sessions'), String(skill && skill.content.slice(0, 40)))
check('скилл: маршрутизация и дисциплина внутри', skill !== undefined && skill.content.includes('session_spawn') && skill.content.includes('subagent') && skill.content.includes('session_status'), 'тело не содержит правил')
check('скилл: invocation не переопределён (модель и человек)', skill !== undefined && skill.invocation === undefined)
check('скилл: source проставлен (без него падает загрузка)', skill !== undefined && skill.source === 'runtime', String(skill && skill.source))

const bare = await makeRoot(liveSessions, {}, { withSkills: false })
check('без реестра скиллов тулы всё равно регистрируются', bare.tools.registered.length === 4, String(bare.tools.registered.length))
await bare.fiber.dispose()

const offSwitch = await makeRoot(liveSessions, { registerSkill: false })
check('registerSkill: false отключает скилл', offSwitch.skills.registered.length === 0, String(offSwitch.skills.registered.length))
check('registerSkill: false не мешает тулам', offSwitch.tools.registered.length === 4)
await offSwitch.fiber.dispose()

// ── 2. spawn: cwd вызывающего, workspace-аттач, prompt, title ───────────────

const spawn = byName(tools, 'session_spawn')
const created = await spawn.execute({ prompt: '  сделай X  ', title: 'worker: X' }, exec)
check('spawn вернул ok + sessionId', created.ok === true && typeof created.sessionId === 'string', JSON.stringify(created))
check('spawn привязался к workspace', created.workspaceId === 'ws-1', JSON.stringify(created))
check('spawn взял cwd вызывающей сессии', created.cwd === CALLER_CWD, String(created.cwd))
check('spawn проставил title', created.title === 'worker: X')

const createCall = root.sessionController.calls.find((c) => c.method === 'create')
check('create вызван с workspaceId, без cwd', createCall && createCall.request.workspaceId === 'ws-1' && createCall.request.cwd === undefined, JSON.stringify(createCall && createCall.request))
const promptCall = root.sessionController.calls.find((c) => c.method === 'prompt')
check('prompt доставлен текстовым блоком с trim', promptCall && promptCall.request.content[0].type === 'text' && promptCall.request.content[0].text === 'сделай X')
check('prompt использует mode=queue и уникальный requestId', promptCall && promptCall.request.mode === 'queue' && typeof promptCall.request.requestId === 'string' && promptCall.request.requestId.length > 0)
check('сессия опубликована в sessions', liveSessions.has(created.sessionId))

const second = await spawn.execute({ prompt: 'вторая задача', cwd: OUTSIDE_CWD }, exec)
check('cwd переопределяется аргументом (без workspace)', second.ok === true && second.cwd === OUTSIDE_CWD && second.workspaceId === undefined, JSON.stringify(second))

// ── 3. spawn: пустой prompt и сбой доставки ─────────────────────────────────

const emptyPrompt = await spawn.execute({ prompt: '   ' }, exec)
check('пустой prompt отклоняется', emptyPrompt.ok === false && String(emptyPrompt.error).includes('prompt'))

root.sessionController.failPrompt = true
const failedPrompt = await spawn.execute({ prompt: 'задача' }, exec)
check('сбой prompt: сессия названа, ошибка внятная', failedPrompt.ok === false && typeof failedPrompt.sessionId === 'string' && String(failedPrompt.error).includes('session_send'), JSON.stringify(failedPrompt))
root.sessionController.failPrompt = false

// ── 3b. модель новой сессии ─────────────────────────────────────────────────

const selections = () => appends.filter((entry) => entry.event === 'model/selection')
const createCalls = () => root.sessionController.calls.filter((call) => call.method === 'create').length

appends.length = 0
const explicit = await spawn.execute({ prompt: 'на glm', provider: 'zai', model: 'glm-4.7', reasoningEffort: 'high' }, exec)
check('модель: provider+model записаны событием model/selection', explicit.ok === true && selections().length === 1 && selections()[0].data.provider === 'zai' && selections()[0].data.model === 'glm-4.7' && selections()[0].data.reasoningEffort === 'high', JSON.stringify(selections()))
check('модель: результат называет effective route', explicit.provider === 'zai' && explicit.model === 'glm-4.7' && explicit.reasoningEffort === 'high', JSON.stringify(explicit))

appends.length = 0
const inferred = await spawn.execute({ prompt: 'на pro', model: 'deepseek-pro' }, exec)
check('модель: провайдер выведен из каталога', inferred.ok === true && inferred.provider === 'deepseek-official' && selections()[0].data.provider === 'deepseek-official', JSON.stringify(inferred))

appends.length = 0
const prefixed = await spawn.execute({ prompt: 'префикс', model: 'zai/glm-4.7' }, exec)
check('модель: форма provider/model разбирается', prefixed.ok === true && prefixed.provider === 'zai' && prefixed.model === 'glm-4.7', JSON.stringify(prefixed))

const createsBefore = createCalls()
const ambiguous = await spawn.execute({ prompt: 'неоднозначно', model: 'deepseek-flash' }, exec)
check('модель: неоднозначный id отклонён', ambiguous.ok === false && String(ambiguous.error).includes('нескольких провайдеров'), JSON.stringify(ambiguous))
const unknown = await spawn.execute({ prompt: 'нет такой', model: 'gpt-9' }, exec)
check('модель: неизвестный id отклонён', unknown.ok === false && String(unknown.error).includes('не найдена'), JSON.stringify(unknown))
const orphanEffort = await spawn.execute({ prompt: 'усилие', reasoningEffort: 'high' }, exec)
check('модель: reasoningEffort без provider/model отклонён', orphanEffort.ok === false, JSON.stringify(orphanEffort))
const orphanProvider = await spawn.execute({ prompt: 'провайдер', provider: 'zai' }, exec)
check('модель: provider без model отклонён', orphanProvider.ok === false && String(orphanProvider.error).includes('без model'), JSON.stringify(orphanProvider))
check('модель: отклонённая модель не создаёт сессию', createCalls() === createsBefore, `${createsBefore} → ${createCalls()}`)

appends.length = 0
const plain = await spawn.execute({ prompt: 'дефолт' }, exec)
check('модель: без параметров выбор не пишется', plain.ok === true && selections().length === 0 && plain.model === undefined, JSON.stringify(plain))

const rejecting = await makeRoot(liveSessions, {}, { llmAccepted: () => { throw new Error('unknown reasoning effort "ultra"') } })
const rejected = await byName(rejecting.tools, 'session_spawn').execute({ prompt: 'плохое усилие', provider: 'zai', model: 'glm-4.7', reasoningEffort: 'ultra' }, exec)
check('модель: отказ адаптера пробрасывается', rejected.ok === false && String(rejected.error).includes('отклонена адаптером'), JSON.stringify(rejected))
await rejecting.fiber.dispose()

const normalizing = await makeRoot(liveSessions, {}, { llmAccepted: (config) => ({ provider: config.provider, model: `${config.model}-latest` }) })
appends.length = 0
const normalized = await byName(normalizing.tools, 'session_spawn').execute({ prompt: 'нормализация', provider: 'zai', model: 'glm-4.7' }, exec)
check('модель: берётся нормализованный адаптером route', normalized.ok === true && normalized.model === 'glm-4.7-latest' && appends.some((entry) => entry.event === 'model/selection' && entry.data.model === 'glm-4.7-latest'), JSON.stringify(normalized))
await normalizing.fiber.dispose()

const noLlm = await makeRoot(liveSessions, {}, { withLlm: false })
appends.length = 0
const unvalidated = await byName(noLlm.tools, 'session_spawn').execute({ prompt: 'без llm', provider: 'zai', model: 'glm-4.7' }, exec)
check('модель: без llm-сервиса выбор всё равно пишется', unvalidated.ok === true && appends.some((entry) => entry.event === 'model/selection'), JSON.stringify(unvalidated))
await noLlm.fiber.dispose()

// ── 4. session_status: список и tail ────────────────────────────────────────

const target = liveSessions.get(created.sessionId)
target.events.push(
  { type: 'user/message', seq: 0, time: 1, data: {} },
  { type: 'assistant/message', seq: 1, time: 2, data: { message: { content: [{ type: 'text', text: 'готово: X' }, { type: 'tool-call' }] } } },
  { type: 'turn/end', seq: 2, time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
)

const status = byName(tools, 'session_status')
const list = await status.execute({}, exec)
check('status без аргументов перечисляет сессии', list.ok === true && list.text.includes(created.sessionId), String(list.text))
const detail = await status.execute({ sessionId: created.sessionId }, exec)
check('status по sessionId: live/turn/events', detail.ok === true && detail.text.includes('last turn end: completed') && detail.text.includes('events: 3'), String(detail.text))
check('status по sessionId: текст ответа ассистента', detail.text.includes('готово: X'), String(detail.text))
const missing = await status.execute({ sessionId: 'session-nope' }, exec)
check('status по несуществующей сессии возвращает ошибку', missing.ok === false && String(missing.error).includes('inspect'), JSON.stringify(missing))

// ── 5. session_send и session_cancel ────────────────────────────────────────

const send = byName(tools, 'session_send')
const sent = await send.execute({ sessionId: created.sessionId, text: 'продолжай', mode: 'steer' }, exec)
check('send доставляет steer-сообщение', sent.ok === true && sent.mode === 'steer', JSON.stringify(sent))
const sendEmpty = await send.execute({ sessionId: created.sessionId, text: '  ' }, exec)
check('send с пустым текстом отклоняется', sendEmpty.ok === false)

const cancel = byName(tools, 'session_cancel')
const cancelled = await cancel.execute({ sessionId: created.sessionId }, exec)
check('cancel подтверждает отмену', cancelled.ok === true && cancelled.accepted === true, JSON.stringify(cancelled))

await root.fiber.dispose()
check('dispose снимает все четыре регистрации', tools.disposed.length === 4, tools.disposed.join(','))
check('dispose снимает и скилл', skills.disposed.length === 1, skills.disposed.join(','))

// ── 6. фенс allowedRoots ────────────────────────────────────────────────────

const fenced = await makeRoot(liveSessions, { allowedRoots: [CALLER_CWD] })
const fencedSpawn = byName(fenced.tools, 'session_spawn')
const allowed = await fencedSpawn.execute({ prompt: 'внутри' }, exec)
check('фенс: cwd вызывающего разрешён', allowed.ok === true, JSON.stringify(allowed))
const denied = await fencedSpawn.execute({ prompt: 'снаружи', cwd: OUTSIDE_CWD }, exec)
check('фенс: чужой каталог отклонён', denied.ok === false && String(denied.error).includes('allowedRoots'), JSON.stringify(denied))
const deniedSibling = await fencedSpawn.execute({ prompt: 'сосед', cwd: `${CALLER_CWD}-sibling` }, exec)
check('фенс: префикс-сосед не проходит', deniedSibling.ok === false, JSON.stringify(deniedSibling))

const fencedSend = byName(fenced.tools, 'session_send')
const insideSend = await fencedSend.execute({ sessionId: created.sessionId, text: 'внутри' }, exec)
check('фенс: send внутри корней проходит', insideSend.ok === true, JSON.stringify(insideSend))
const outsideId = 'session-outside'
liveSessions.set(outsideId, makeLiveSession(OUTSIDE_CWD))
const deniedSend = await fencedSend.execute({ sessionId: outsideId, text: 'снаружи' }, exec)
check('фенс: send в сессию вне корней отклонён', deniedSend.ok === false && String(deniedSend.error).includes('allowedRoots'), JSON.stringify(deniedSend))
await fenced.fiber.dispose()

// ── 7. наследование sandbox-режима ──────────────────────────────────────────

const sandboxAppends = () => appends.filter((entry) => entry.event === 'sandbox/mode')

const inherited = await makeRoot(liveSessions, {})
inherited.sandboxPolicy.override = 'danger-full-access'
appends.length = 0
const inheritedResult = await byName(inherited.tools, 'session_spawn').execute({ prompt: 'наследуй' }, exec)
check('inheritSandbox: событие sandbox/mode записано в новую сессию', inheritedResult.ok === true && sandboxAppends().length === 1 && sandboxAppends()[0].data.mode === 'danger-full-access', JSON.stringify(appends))
await inherited.fiber.dispose()

const inheritedOff = await makeRoot(liveSessions, { inheritSandbox: false })
inheritedOff.sandboxPolicy.override = 'danger-full-access'
appends.length = 0
const offResult = await byName(inheritedOff.tools, 'session_spawn').execute({ prompt: 'не наследуй' }, exec)
check('inheritSandbox: false отключает наследование', offResult.ok === true && sandboxAppends().length === 0, JSON.stringify(appends))
await inheritedOff.fiber.dispose()

// ── 8. настоящий реестр скиллов: регистрация И загрузка ─────────────────────
//
// Регрессия, найденная в бою: runtime-скилл без `source` регистрируется молча
// (validateRuntimeSkill проверяет только имя, описание и invocation), каталог
// его показывает — а любая загрузка (`/имя` или инструмент `skill`) идёт через
// validateDefinition и падает: 'loaded skill "…" source must be a string'.
// Стаб такое не ловит, поэтому здесь монтируется настоящий SkillRegistry.

let SkillRegistry
try {
  SkillRegistry = (await import('@deepseek-ai/dsh-skill')).default
} catch (error) {
  SkillRegistry = undefined
  console.log('skip - настоящий реестр скиллов недоступен:', error instanceof Error ? error.message : String(error))
}

if (SkillRegistry !== undefined) {
  const real = new Context()
  await real.plugin(SkillRegistry)
  await real.plugin(plugin, {})
  const listed = await real.skills.list({})
  check('настоящий реестр: скилл виден в каталоге', listed.some((entry) => entry.name === 'managed-sessions'), listed.map((entry) => entry.name).join(','))
  let loaded
  try {
    loaded = await real.skills.get('managed-sessions', {})
  } catch (error) {
    loaded = undefined
    check('настоящий реестр: скилл загружается без ошибок', false, error instanceof Error ? error.message : String(error))
  }
  if (loaded !== undefined) {
    check('настоящий реестр: скилл загружается без ошибок', true)
    check('настоящий реестр: source/provider проставлены', loaded.source === 'runtime' && loaded.provider === 'runtime', `${loaded.source}/${loaded.provider}`)
    check('настоящий реестр: тело скилла доехало', loaded.content.includes('session_spawn') && loaded.content.includes('<skill managed-sessions>'))
    check('настоящий реестр: user-вызов разрешён', loaded.invocation.userInvocable === true && loaded.invocation.modelInvocable === true, JSON.stringify(loaded.invocation))
  }
  await real.fiber.dispose()
}

if (failed > 0) {
  console.log(`\n${failed} проверок не прошло`)
  process.exit(1)
}
console.log('\nOK: host-половина активируется, четыре тула регистрируются, create/prompt/status/cancel, фенс и наследование работают')

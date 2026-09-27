/**
 * dsh-managed-sessions, host half.
 *
 * Four model-facing tools over the host `sessionController` — the same service
 * the Web GUI calls for its "New session" button:
 *
 *   session_spawn   create an ordinary Session (optionally attached to a
 *                   Workspace) and admit its first prompt
 *   session_send    admit a follow-up prompt (queue | steer); resumes cold
 *   session_status  list sessions, or report one session's live / turn / tail
 *   session_cancel  cancel the active turn without dropping the inbox
 *
 * A spawned Session is an ordinary root Session: no `parentSession`, no
 * `origin: 'subagent'`, no runtime owner. So it appears in the workspace
 * sidebar, survives this session's turns and teardown, resumes from disk, and
 * the session API keeps accepting operations on it. That is the deliberate
 * difference from a subagent child, which is drained with its parent and
 * rejected by `sessionController`.
 *
 * Mechanics (see @deepseek-ai/dsh-api-session-controller):
 *   create({ workspaceId | cwd, agentPreset? }) -> { sessionId }
 *     `agents.ensureSession` creates the Session; with a workspaceId it also
 *     runs `workspace.attachSession`, which is what puts the row in the GUI
 *     workspace group.
 *   prompt({ requestId, sessionId, mode, content }, signal) -> { accepted }
 *     resumes a cold Session and admits the message, so the root agent runs
 *     its own turn. `requestId` is idempotent: the same id never delivers
 *     twice, so every delivery mints a fresh one.
 *
 * A per-Session model choice rides the Session's own durable `model/selection`
 * event — the same event `selectModel` appends, minus that entry point's
 * settings write. The controller's installed selection reads it back as
 * `pending`, and `installModelSelection` applies it through the `agent/request`
 * waterfall, which is also why creation-time `agentOptions` cannot pin a
 * child's model on its own.
 *
 * The row also ships the delegation policy as a skill: `skills/managed-sessions/
 * SKILL.md` is registered into the runtime skill layer, so the routing rules
 * travel with the tools they describe instead of living in a deployment note.
 * A project skill of the same name (`.dsh/skills/managed-sessions/`) outranks
 * this runtime entry, which is the intended override seam.
 *
 * The row publishes no service; it consumes host services only. `tools` is a
 * hard dependency (registration), everything else is read lazily with
 * `ctx.get()` and degrades into a readable tool error.
 */
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-managed-sessions'

/** Row-level defaults; the composition row's `config` overrides them. */
const DEFAULTS = {
  /** Workspace roots a spawn may target. Empty array = no restriction. */
  allowedRoots: [],
  /** Inherit the calling session's explicit sandbox override into the child. */
  inheritSandbox: true,
  /** Register the shipped delegation-policy skill into the runtime layer. */
  registerSkill: true,
}

/** The delegation policy shipped beside this package, as a skill document. */
const SKILL_DOCUMENT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'managed-sessions', 'SKILL.md')

/** Turn one thrown value into a single-line message for the model. */
function describe(error) {
  if (error && typeof error.message === 'string' && error.message.length > 0) return error.message
  return String(error)
}

/** Bound one model-facing text field. */
function clip(value, limit) {
  const text = typeof value === 'string' ? value : ''
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…[обрезано]`
}

/**
 * Membership test for the `allowedRoots` fence. Path-prefix comparison on
 * resolved paths, so `/a/bc` never passes for the root `/a/b`.
 * @param cwd - candidate workspace directory.
 * @param roots - configured roots; empty means unrestricted.
 * @returns whether a spawn/delivery into `cwd` is allowed.
 */
function withinRoots(cwd, roots) {
  if (!Array.isArray(roots) || roots.length === 0) return true
  if (typeof cwd !== 'string' || cwd.length === 0) return false
  const target = resolve(cwd)
  for (const root of roots) {
    if (typeof root !== 'string' || root.trim().length === 0) continue
    const base = resolve(root.trim())
    if (target === base) return true
    const rel = relative(base, target)
    if (rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)) return true
  }
  return false
}

/** Concatenate the text blocks of one assistant message. */
function textOfMessage(message) {
  if (!message || typeof message !== 'object') return ''
  const content = message.content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * Parse one SKILL.md into the registry's registration fields. Deliberately
 * minimal: the shipped document uses only single-line `name`, `description`,
 * and `whenToUse` frontmatter keys, so a full YAML parser would be dead weight
 * (and a dependency this bundle does not have).
 * @param text - raw document text.
 * @param fallbackName - name used when the frontmatter carries none.
 * @returns registration fields; `content` is the Markdown body without frontmatter.
 */
function parseSkillDocument(text, fallbackName) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (match === null) return { name: fallbackName, description: '', content: text }
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (value.length > 1 && (value.startsWith('"') || value.startsWith("'")) && value.endsWith(value[0])) value = value.slice(1, -1)
    if (key.length > 0 && value.length > 0) meta[key] = value
  }
  return {
    name: typeof meta.name === 'string' && meta.name.length > 0 ? meta.name : fallbackName,
    description: typeof meta.description === 'string' ? meta.description : '',
    ...(typeof meta.whenToUse === 'string' && meta.whenToUse.length > 0 ? { whenToUse: meta.whenToUse } : {}),
    content: text.slice(match[0].length),
  }
}

export function apply(ctx, input = {}) {
  const config = { ...DEFAULTS, ...(input !== null && typeof input === 'object' ? input : {}) }
  if (!Array.isArray(config.allowedRoots)) config.allowedRoots = []
  let counter = 0

  /** Fresh idempotency key: the same id never delivers a second time. */
  function newRequestId() {
    counter += 1
    return `managed-session-${Date.now().toString(36)}-${counter}`
  }

  /** The host service that owns Session commands. */
  function controller() {
    return ctx.get('sessionController')
  }

  /** cwd of the session that called this tool, read as one leaf field. */
  function callerSession(exec) {
    try {
      const agent = exec && exec.agent
      if (!agent || typeof agent.id !== 'string') return undefined
      const sessions = ctx.get('sessions')
      if (sessions === undefined) return undefined
      return sessions.get(agent.id)
    } catch (error) {
      console.error('[managed-sessions] caller session lookup failed:', describe(error))
      return undefined
    }
  }

  function callerCwd(exec) {
    try {
      const session = callerSession(exec)
      const header = session ? session.header : undefined
      const cwd = header ? header.cwd : undefined
      return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
    } catch {
      return undefined
    }
  }

  /** The Workspace that owns this directory, when one is registered. */
  async function workspaceIdFor(cwd) {
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined || typeof cwd !== 'string' || cwd.length === 0) return undefined
    try {
      const workspace = await registry.resolveByPath(cwd)
      return workspace && typeof workspace.id === 'string' ? workspace.id : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Copy the caller's explicit sandbox override into the new Session, exactly
   * as dsh-task-scheduler does for its driver agents: only an explicit
   * override travels, so a default-policy caller leaves the child on the
   * deployment default.
   */
  function inheritSandbox(exec, sessionId) {
    if (config.inheritSandbox !== true) return
    try {
      const policies = ctx.get('sandboxPolicy')
      const sessions = ctx.get('sessions')
      if (policies === undefined || sessions === undefined) return
      if (typeof policies.overrideOf !== 'function') return
      const donor = callerSession(exec)
      if (!donor) return
      const override = policies.overrideOf(donor)
      if (override === undefined || override === null) return
      const created = sessions.get(sessionId)
      if (!created || typeof created.append !== 'function') return
      created.append('sandbox/mode', { mode: override, source: 'delegation' })
    } catch (error) {
      console.error('[managed-sessions] sandbox inheritance failed:', describe(error))
    }
  }

  /** cwd of an existing session, or undefined when it cannot be read. */
  async function cwdOf(sc, sessionId, signal) {
    try {
      const info = await sc.inspect(sessionId, signal)
      const meta = info ? info.meta : undefined
      return meta && typeof meta.cwd === 'string' ? meta.cwd : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Record one model choice on the Session itself. This is the durable event
   * `selectModel` appends, minus its settings write: the controller's installed
   * selection reads it back as `pending`, and `installModelSelection` applies
   * it through the `agent/request` waterfall — which is exactly why creation
   * `agentOptions` alone cannot pin a child's model.
   * @param sessionId - the freshly created Session, live by construction.
   * @param selection - validated provider/model/reasoningEffort choice.
   * @returns an error message, or undefined once the event is appended.
   */
  function recordSelection(sessionId, selection) {
    const sessions = ctx.get('sessions')
    const session = sessions === undefined ? undefined : sessions.get(sessionId)
    if (session === undefined || typeof session.append !== 'function') return 'сессия не опубликована в live-сторе'
    try {
      session.append('model/selection', selection)
    } catch (error) {
      return describe(error)
    }
    return undefined
  }

  /**
   * Resolve one explicit per-session model choice against the live catalog.
   * Omitted parameters mean "ride the deployment default". A bare model id is
   * matched across providers, so the caller does not have to know its route.
   * The result is recorded on the Session itself (`model/selection`), never
   * through `selectModel` — that entry point also rewrites the deployment
   * default, which a spawn has no business doing.
   * @param sc - the session controller, for the model catalog.
   * @param args - tool arguments carrying provider / model / reasoningEffort.
   * @param signal - caller cancellation for catalog and adapter lookups.
   * @returns `{ selection }`, `{}` for the deployment default, or `{ error }`.
   */
  async function resolveSelection(sc, args, signal) {
    const providerArg = args && typeof args.provider === 'string' ? args.provider.trim() : ''
    const modelArg = args && typeof args.model === 'string' ? args.model.trim() : ''
    const effortArg = args && typeof args.reasoningEffort === 'string' ? args.reasoningEffort.trim() : ''
    if (providerArg.length === 0 && modelArg.length === 0 && effortArg.length === 0) return {}
    if (providerArg.length === 0 && modelArg.length === 0) return { error: 'reasoningEffort указан без provider/model' }

    let catalog
    try {
      catalog = await sc.modelCatalog()
    } catch (error) {
      return { error: `каталог моделей недоступен: ${describe(error)}` }
    }
    const groups = catalog && Array.isArray(catalog.groups) ? catalog.groups : []

    let provider = providerArg
    let model = modelArg
    if (provider.length === 0 && model.includes('/')) {
      const cut = model.indexOf('/')
      const prefix = model.slice(0, cut)
      for (const group of groups) {
        if (group && group.id === prefix) {
          provider = prefix
          model = model.slice(cut + 1)
          break
        }
      }
    }
    if (provider.length === 0) {
      const owners = []
      for (const group of groups) {
        const models = group && Array.isArray(group.models) ? group.models : []
        for (const candidate of models) {
          if (candidate && candidate.id === model && typeof group.id === 'string') owners.push(group.id)
        }
      }
      if (owners.length === 0) return { error: `модель "${model}" не найдена в каталоге деплоймента` }
      if (owners.length > 1) return { error: `модель "${model}" есть у нескольких провайдеров (${owners.join(', ')}) — укажите provider явно` }
      provider = owners[0]
    }
    if (model.length === 0) return { error: `provider "${provider}" указан без model` }

    const requested = { provider, model, ...(effortArg.length === 0 ? {} : { reasoningEffort: effortArg }) }
    const llm = ctx.get('llm')
    if (llm === undefined || typeof llm.resolveCallConfig !== 'function') return { selection: requested }
    try {
      const resolved = await llm.resolveCallConfig(requested, signal)
      return {
        selection: {
          provider: String(resolved.provider),
          model: String(resolved.model),
          ...(resolved.reasoningEffort === undefined || resolved.reasoningEffort === null ? {} : { reasoningEffort: String(resolved.reasoningEffort) }),
        },
      }
    } catch (error) {
      return { error: `модель отклонена адаптером: ${describe(error)}` }
    }
  }

  const spawnTool = {
    name: 'session_spawn',
    description: 'Создать НОВУЮ управляемую сессию (managed session) в workspace и сразу дать ей задачу. Это самостоятельная сессия верхнего уровня, а не субагент: она видна пользователю в сайдбаре workspace, живёт независимо от текущей сессии, её можно открыть, дополнить и продолжить вручную. Возвращает sessionId. Результат работы НЕ приходит автоматически — следите через session_status. Модель для новой сессии можно задать через provider/model/reasoningEffort; без них сессия едет на деплоймент-дефолте.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Задача для новой сессии: самодостаточный полный текст.' },
        cwd: { type: 'string', description: 'Каталог workspace. По умолчанию — каталог текущей сессии.' },
        title: { type: 'string', description: 'Заголовок сессии в сайдбаре (опционально).' },
        agentPreset: { type: 'string', description: 'ID агент-пресета для новой сессии (опционально). По умолчанию — дефолтный пресет деплоймента.' },
        provider: { type: 'string', description: 'Провайдер модели для новой сессии (опционально). Можно не указывать, если model однозначно находится в каталоге.' },
        model: { type: 'string', description: 'ID модели для новой сессии (опционально). Принимается и форма "provider/model".' },
        reasoningEffort: { type: 'string', description: 'Усилие рассуждения для выбранной модели (опционально; иначе — дефолт самой модели).' },
      },
      required: ['prompt'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          sessionId: { type: 'string' },
          cwd: { type: 'string' },
          workspaceId: { type: 'string' },
          title: { type: 'string' },
          provider: { type: 'string' },
          model: { type: 'string' },
          reasoningEffort: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render(_args, value) {
        const result = value || {}
        if (result.ok === true) {
          const where = result.workspaceId !== undefined ? `workspace ${result.workspaceId}` : `cwd ${result.cwd}`
          const route = result.model === undefined ? 'деплоймент-дефолт' : `${result.provider}/${result.model}${result.reasoningEffort === undefined ? '' : ` (${result.reasoningEffort})`}`
          return [{ type: 'text', text: `Сессия ${result.sessionId} создана (${where}, модель: ${route}) и задача доставлена. Следить: session_status { sessionId: "${result.sessionId}" }.` }]
        }
        return [{ type: 'text', text: `Не удалось создать сессию: ${result.error || 'unknown error'}` }]
      },
    },
    async execute(args, exec) {
      const sc = controller()
      if (sc === undefined) return { ok: false, error: 'сервис sessionController недоступен в этом рантайме' }
      const promptText = args && typeof args.prompt === 'string' ? args.prompt.trim() : ''
      if (promptText.length === 0) return { ok: false, error: 'prompt обязателен и не может быть пустым' }
      const explicitCwd = args && typeof args.cwd === 'string' && args.cwd.trim().length > 0 ? args.cwd.trim() : undefined
      const cwd = explicitCwd !== undefined ? explicitCwd : callerCwd(exec)
      if (cwd === undefined) return { ok: false, error: 'не удалось определить каталог workspace: передайте cwd явно' }
      if (!withinRoots(cwd, config.allowedRoots)) {
        return { ok: false, cwd, error: `каталог ${cwd} вне allowedRoots (${config.allowedRoots.join(', ')})` }
      }
      // Resolve the model before creating anything: a rejected route must not
      // leave a half-created session behind.
      const requested = await resolveSelection(sc, args, exec.signal)
      if (requested.error !== undefined) return { ok: false, cwd, error: requested.error }
      const selection = requested.selection
      const workspaceId = await workspaceIdFor(cwd)
      const preset = args && typeof args.agentPreset === 'string' && args.agentPreset.trim().length > 0 ? args.agentPreset.trim() : undefined
      let created
      try {
        const request = workspaceId !== undefined ? { workspaceId } : { cwd }
        if (preset !== undefined) request.agentPreset = preset
        created = await sc.create(request)
      } catch (error) {
        return { ok: false, cwd, error: `create: ${describe(error)}` }
      }
      const sessionId = created && typeof created.sessionId === 'string' ? created.sessionId : undefined
      if (sessionId === undefined) return { ok: false, cwd, error: 'create не вернул sessionId' }
      inheritSandbox(exec, sessionId)
      if (selection !== undefined) {
        const recorded = recordSelection(sessionId, selection)
        if (recorded !== undefined) {
          return { ok: false, sessionId, cwd, error: `сессия создана, но выбранную модель записать не удалось (${recorded}); продолжите через session_send или удалите сессию` }
        }
      }
      let title
      if (args && typeof args.title === 'string' && args.title.trim().length > 0) {
        const wantedTitle = args.title.trim()
        try {
          await sc.rename({ sessionId, title: wantedTitle })
          title = wantedTitle
        } catch (error) {
          console.error('[managed-sessions] rename failed:', describe(error))
        }
      }
      try {
        await sc.prompt({ requestId: newRequestId(), sessionId, mode: 'queue', content: [{ type: 'text', text: promptText }] }, exec.signal)
      } catch (error) {
        const result = { ok: false, sessionId, cwd, error: `сессия создана, но prompt не доставлен (${describe(error)}); повторите через session_send` }
        if (title !== undefined) result.title = title
        return result
      }
      const result = { ok: true, sessionId, cwd }
      if (workspaceId !== undefined) result.workspaceId = workspaceId
      if (title !== undefined) result.title = title
      if (selection !== undefined) {
        result.provider = selection.provider
        result.model = selection.model
        if (selection.reasoningEffort !== undefined) result.reasoningEffort = selection.reasoningEffort
      }
      return result
    },
  }

  const sendTool = {
    name: 'session_send',
    description: 'Отправить сообщение в существующую сессию (в том числе в сессию, созданную session_spawn). Холодная сессия будет поднята с диска. mode=queue — в очередь следующего хода, mode=steer — в текущий ход, если он идёт.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'ID целевой сессии.' },
        text: { type: 'string', description: 'Текст сообщения.' },
        mode: { type: 'string', enum: ['queue', 'steer'], description: 'queue (по умолчанию) или steer.' },
      },
      required: ['sessionId', 'text'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          sessionId: { type: 'string' },
          mode: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render(_args, value) {
        const result = value || {}
        if (result.ok === true) return [{ type: 'text', text: `Сообщение доставлено в ${result.sessionId} (mode: ${result.mode}).` }]
        return [{ type: 'text', text: `Сообщение не доставлено: ${result.error || 'unknown error'}` }]
      },
    },
    async execute(args, exec) {
      const sc = controller()
      if (sc === undefined) return { ok: false, error: 'сервис sessionController недоступен в этом рантайме' }
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId.trim() : ''
      const text = args && typeof args.text === 'string' ? args.text.trim() : ''
      if (sessionId.length === 0) return { ok: false, error: 'sessionId обязателен' }
      if (text.length === 0) return { ok: false, error: 'text обязателен и не может быть пустым' }
      const mode = args && args.mode === 'steer' ? 'steer' : 'queue'
      if (config.allowedRoots.length > 0) {
        const targetCwd = await cwdOf(sc, sessionId, exec.signal)
        if (targetCwd !== undefined && !withinRoots(targetCwd, config.allowedRoots)) {
          return { ok: false, sessionId, mode, error: `сессия вне allowedRoots (${targetCwd})` }
        }
      }
      try {
        await sc.prompt({ requestId: newRequestId(), sessionId, mode, content: [{ type: 'text', text }] }, exec.signal)
      } catch (error) {
        return { ok: false, sessionId, mode, error: describe(error) }
      }
      return { ok: true, sessionId, mode }
    },
  }

  const statusTool = {
    name: 'session_status',
    description: 'Без аргументов — список всех сессий рантайма с флагами (running / blank / subagent), их cwd и статусом. С sessionId — состояние одной сессии: живой ли агент, идёт ли ход, сколько событий в логе, чем закончился последний ход и текст последних ответов ассистента. Читает только, ничего не запускает.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'ID сессии для детального отчёта (опционально).' },
        messages: { type: 'number', description: 'Сколько последних ответов ассистента показать (1–10, по умолчанию 1).' },
      },
      required: [],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          text: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render(_args, value) {
        const result = value || {}
        if (result.ok === true) return [{ type: 'text', text: typeof result.text === 'string' ? result.text : '(пусто)' }]
        return [{ type: 'text', text: `Не удалось прочитать состояние: ${result.error || 'unknown error'}` }]
      },
    },
    async execute(args, exec) {
      const sc = controller()
      if (sc === undefined) return { ok: false, error: 'сервис sessionController недоступен в этом рантайме' }
      const requested = args && typeof args.sessionId === 'string' && args.sessionId.trim().length > 0 ? args.sessionId.trim() : undefined
      let wanted = 1
      if (args && typeof args.messages === 'number' && Number.isFinite(args.messages) && args.messages >= 1) wanted = Math.min(10, Math.floor(args.messages))

      if (requested === undefined) {
        let listed
        try {
          listed = await sc.list({}, exec.signal)
        } catch (error) {
          return { ok: false, error: `list: ${describe(error)}` }
        }
        const items = listed && Array.isArray(listed.items) ? listed.items : []
        const lines = []
        for (const item of items) {
          if (!item || typeof item !== 'object') continue
          const id = typeof item.sessionId === 'string' ? item.sessionId : '?'
          const flags = []
          if (item.running === true) flags.push('running')
          if (item.blank === true) flags.push('blank')
          if (item.origin === 'subagent') flags.push('subagent')
          if (typeof item.parentSessionId === 'string' && item.origin !== 'subagent') flags.push('child')
          const where = typeof item.cwd === 'string' ? item.cwd : ''
          lines.push(`${id}  [${flags.length > 0 ? flags.join(',') : 'idle'}]  ${where}`)
        }
        return { ok: true, text: lines.length > 0 ? lines.join('\n') : '(сессий нет)' }
      }

      let info
      try {
        info = await sc.inspect(requested, exec.signal)
      } catch (error) {
        return { ok: false, error: `inspect: ${describe(error)}` }
      }
      const events = info && Array.isArray(info.events) ? info.events : []
      let summary
      try {
        const listed = await sc.list({}, exec.signal)
        const items = listed && Array.isArray(listed.items) ? listed.items : []
        for (const item of items) {
          if (item && item.sessionId === requested) {
            summary = item
            break
          }
        }
      } catch {
        summary = undefined
      }
      let live = false
      try {
        const agents = ctx.get('agents')
        live = agents !== undefined && agents.get(requested) !== undefined
      } catch {
        live = false
      }

      const collected = []
      let turnEnd
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (!event || typeof event.type !== 'string') continue
        if (event.type === 'assistant/message' && collected.length < wanted) {
          const text = textOfMessage(event.data ? event.data.message : undefined)
          if (text.length > 0) collected.push(text)
        }
        if (turnEnd === undefined && event.type === 'turn/end') {
          const reason = event.data ? event.data.reason : undefined
          turnEnd = reason && typeof reason.kind === 'string' ? reason.kind : 'unknown'
        }
        if (collected.length >= wanted && turnEnd !== undefined) break
      }
      const meta = info && info.meta ? info.meta : undefined
      const head = [
        `session: ${requested}`,
        `live agent: ${live ? 'yes' : 'no'}`,
        `running: ${summary && summary.running === true ? 'yes' : 'no'}`,
        `events: ${String(events.length)}`,
        `last turn end: ${turnEnd === undefined ? '?' : turnEnd}`,
        `cwd: ${meta && typeof meta.cwd === 'string' ? meta.cwd : '?'}`,
      ]
      const body = []
      for (let index = collected.length - 1; index >= 0; index -= 1) {
        body.push(`--- ответ ассистента ---\n${clip(collected[index], 4000)}`)
      }
      return { ok: true, text: head.join('\n') + (body.length > 0 ? `\n\n${body.join('\n\n')}` : '') }
    },
  }

  const cancelTool = {
    name: 'session_cancel',
    description: 'Отменить активный ход агента в указанной сессии, не выбрасывая её очередь сообщений. Для сессий, созданных session_spawn, и любых других управляемых сессий.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'ID сессии, чей активный ход нужно отменить.' },
      },
      required: ['sessionId'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          sessionId: { type: 'string' },
          accepted: { type: 'boolean' },
          error: { type: 'string' },
        },
      },
      render(_args, value) {
        const result = value || {}
        if (result.ok === true) return [{ type: 'text', text: `Отмена запрошена для ${result.sessionId} (accepted: ${String(result.accepted)}).` }]
        return [{ type: 'text', text: `Отменить не удалось: ${result.error || 'unknown error'}` }]
      },
    },
    async execute(args) {
      const sc = controller()
      if (sc === undefined) return { ok: false, error: 'сервис sessionController недоступен в этом рантайме' }
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId.trim() : ''
      if (sessionId.length === 0) return { ok: false, error: 'sessionId обязателен' }
      let cancelled
      try {
        cancelled = await sc.cancel({ sessionId })
      } catch (error) {
        return { ok: false, sessionId, error: describe(error) }
      }
      return { ok: true, sessionId, accepted: !!(cancelled && cancelled.accepted === true) }
    },
  }

  /** Register all four tools as one fiber effect, so stop/unload removes them. */
  function registerTools(tools) {
    if (tools === undefined) return
    ctx.effect(() => {
      const disposers = []
      for (const definition of [spawnTool, sendTool, statusTool, cancelTool]) {
        try {
          disposers.push(tools.register(definition))
        } catch (error) {
          console.error(`[managed-sessions] tool ${definition.name} registration failed:`, describe(error))
        }
      }
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            /* one stubborn disposer never blocks the rest */
          }
        }
      }
    }, 'dsh-managed-sessions: tools')
  }

  /**
   * Ship the delegation policy as a runtime skill. Registration is a fiber
   * effect, so stop/unload withdraws the skill together with the tools it
   * describes. Called with the registry the caller resolved: a deployment
   * without a skills registry leaves the tools untouched.
   * @param skills - the `skills` registry service, when available.
   */
  function registerSkill(skills) {
    if (config.registerSkill !== true) {
      console.log('[managed-sessions] skill registration disabled by config')
      return
    }
    if (skills === undefined || typeof skills.register !== 'function') {
      console.error('[managed-sessions] skill not registered: this deployment mounts no skills registry')
      return
    }
    let document
    try {
      document = parseSkillDocument(readFileSync(SKILL_DOCUMENT_PATH, 'utf8'), 'managed-sessions')
    } catch (error) {
      console.error('[managed-sessions] skill document unreadable:', describe(error))
      return
    }
    if (typeof document.description !== 'string' || document.description.length === 0) {
      console.error('[managed-sessions] skill document carries no description; skill not registered')
      return
    }
    try {
      ctx.effect(() => skills.register({
        name: document.name,
        description: document.description,
        ...(document.whenToUse === undefined ? {} : { whenToUse: document.whenToUse }),
        content: document.content,
        // `source` is NOT defaulted the way `invocation` and `provider` are.
        // Registration accepts its absence, but loading the skill (`/name` or
        // the `skill` tool) runs validateDefinition, which demands a string —
        // so the catalog lists the skill while every invocation fails with
        // 'loaded skill "…" source must be a string'.
        source: 'runtime',
      }), 'dsh-managed-sessions: skill')
    } catch (error) {
      console.error('[managed-sessions] skill registration failed:', describe(error))
      return
    }
    console.log(`[managed-sessions] skill "${document.name}" registered (${document.content.length} chars)`)
  }

  const toolsNow = ctx.get('tools')
  if (toolsNow !== undefined) {
    registerTools(toolsNow)
  } else {
    ctx.inject(['tools'], (toolCtx) => registerTools(toolCtx.get('tools')))
  }

  // Rows are applied concurrently, so the skills registry may not exist yet at
  // this point. `ctx.inject` parks this callback until it does — the same
  // reason dsh-task-scheduler resolves `tools` this way instead of trusting a
  // one-shot `ctx.get`.
  const skillsNow = ctx.get('skills')
  if (skillsNow !== undefined) {
    registerSkill(skillsNow)
  } else {
    ctx.inject(['skills'], (skillCtx) => registerSkill(skillCtx.get('skills')))
  }

  const fence = config.allowedRoots.length > 0 ? `fence: ${config.allowedRoots.join(', ')}` : 'fence: off (any cwd)'
  console.log(`[managed-sessions] host row ready — session_spawn/send/status/cancel, ${fence}, sandbox inheritance: ${config.inheritSandbox === true ? 'on' : 'off'}`)
}

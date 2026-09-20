/**
 * dsh-task-scheduler, host half.
 *
 * One scheduler per DSH process: a durable task store under the DSH home
 * (<home>/task-scheduler/tasks.json), a CRON ticker, per-workspace driver
 * driver agents for AI tasks, `bun run` script tasks, a same-origin HTTP API for the
 * browser panel, and the model-facing `task_trigger` tool.
 *
 * Tasks:
 *  - kind "agent": the .md file content runs as a fork-subagent prompt under a
 *    driver agent created for the task's workspace root (preset + default model
 *    mounted, sandbox mode inherited from the workspace session).
 *  - kind "script": `bun run <source> <args>` through the `shell` service,
 *    fenced by the requesting session's sandbox policy.
 *
 * Browser API (same origin, sec-fetch-site guarded):
 *  GET  /dsh-tsched/api/state?sessionId=…
 *  POST /dsh-tsched/api/saveTask | deleteTask | runTask | stopRun | clearRuns
 */
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

export const name = 'dsh-task-scheduler'

const API_PREFIX = '/dsh-tsched/api'
const MAX_CONCURRENT = 4
const MAX_RUNS = 300
const DRIVER_CAP = 3
const SAVE_DEBOUNCE_MS = 350
const CRON_TICK_MS = 15000
const CRON_MIN_GAP_MS = 55000
const MAX_BODY_BYTES = 256 * 1024

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

const STATE_DIR = join(dshHome(), 'task-scheduler')
const STATE_FILE = join(STATE_DIR, 'tasks.json')

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function nowMs() {
  return Date.now()
}

function tailText(text, max) {
  if (typeof text !== 'string' || text.length === 0) return ''
  if (text.length <= max) return text
  return `[snip]\n${text.slice(-max)}`
}

function escapeSh(value) {
  const s = String(value)
  return `'${s.split("'").join(`'\\''`)}'`
}

// ── cron: five numeric fields ──────────────────────────────────────────────

function parseCronField(field, min, max) {
  const out = new Set()
  const parts = String(field || '').trim().split(',')
  if (parts.length === 0) return null
  for (const part of parts) {
    if (part === '') return null
    const m = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/)
    if (!m) return null
    let start
    let end
    if (m[1] === '*') {
      start = min
      end = max
    } else {
      start = Number.parseInt(m[1], 10)
      end = start
    }
    if (m[2] !== undefined) end = Number.parseInt(m[2], 10)
    const step = m[3] !== undefined ? Number.parseInt(m[3], 10) : 1
    if (!(step >= 1) || start < min || end > max || start > end) return null
    for (let v = start; v <= end; v += step) out.add(v)
  }
  return out
}

function parseCron(expr) {
  const parts = String(expr || '').trim().split(/\s+/)
  if (parts.length !== 5) return null
  const fields = [
    parseCronField(parts[0], 0, 59),
    parseCronField(parts[1], 0, 23),
    parseCronField(parts[2], 1, 31),
    parseCronField(parts[3], 1, 12),
    parseCronField(parts[4], 0, 7),
  ]
  if (fields.some((f) => f === null)) return null
  return { expr: parts.join(' '), fields }
}

function cronMatches(parsed, d) {
  const dow = d.getDay() // 0 = Sunday
  const okDow = parsed.fields[4].has(dow) || (dow === 0 && parsed.fields[4].has(7))
  return (
    parsed.fields[0].has(d.getMinutes())
    && parsed.fields[1].has(d.getHours())
    && parsed.fields[2].has(d.getDate())
    && parsed.fields[3].has(d.getMonth() + 1)
    && okDow
  )
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(data),
  })
  res.end(data)
}

async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('invalid JSON body')
  }
}

function assertNotCrossSite(req) {
  const site = String(req.headers['sec-fetch-site'] ?? '').toLowerCase()
  if (site === 'cross-site') throw new Error('cross-site request rejected')
}

/** @param ctx - host plugin context. */
export function apply(ctx) {
  // Services resolve lazily: cordis activation is availability-driven, so a
  // service present later in the boot must not be captured at apply time.
  const shell = () => ctx.get('shell')
  const sandboxPolicy = () => ctx.get('sandboxPolicy')
  const sessions = () => ctx.get('sessions')
  const sessionTitle = () => ctx.get('sessionTitle')
  const subagents = () => ctx.get('subagents')
  const agents = () => ctx.get('agents')
  const presets = () => ctx.get('agentPresets')
  const agentDefaultModel = () => ctx.get('agentDefaultModel')

  const state = {
    root: null, // sticky default workspace root, refreshed by each panel RPC
    tasks: [],
    runs: [],
    loadError: '',
    migrated: false,
    driverCount: 0,
  }
  const active = new Map() // runId -> { ctrl, stop }
  const cronCache = new Map()
  const drivers = new Map() // workspace root -> { agent, handle, lastUsed }

  // ── task normalization / validation ──────────────────────────────────────

  function normalizeTask(t) {
    if (!t || typeof t !== 'object') return null
    const kind = t.kind === 'script' ? 'script' : 'agent'
    return {
      id: typeof t.id === 'string' && t.id ? t.id : uid('task'),
      name: typeof t.name === 'string' ? t.name : 'untitled',
      kind,
      source: typeof t.source === 'string' ? t.source : '',
      cron: typeof t.cron === 'string' ? t.cron.trim() : '',
      enabled: t.enabled !== false,
      timeoutMin: Number(t.timeoutMin) > 0 ? Math.min(1440, Math.round(Number(t.timeoutMin))) : (kind === 'script' ? 30 : 60),
      args: typeof t.args === 'string' ? t.args : '',
      env: t.env && typeof t.env === 'object' && !Array.isArray(t.env) ? t.env : {},
      cwd: typeof t.cwd === 'string' && t.cwd ? t.cwd : '',
      createdAt: Number(t.createdAt) || nowMs(),
      updatedAt: Number(t.updatedAt) || nowMs(),
      lastRunAt: Number(t.lastRunAt) || null,
      lastRunId: typeof t.lastRunId === 'string' ? t.lastRunId : null,
      lastCronFiredAt: Number(t.lastCronFiredAt) || null,
    }
  }

  function validateTaskInput(input) {
    if (!input || typeof input !== 'object') return 'invalid input'
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) return 'name is required (max 120 chars)'
    const kind = input.kind === 'script' ? 'script' : 'agent'
    if (typeof input.source !== 'string' || !input.source.trim() || input.source.length > 500) return 'source is a required path'
    if (input.cron != null && input.cron !== '') {
      if (typeof input.cron !== 'string' || !parseCron(input.cron)) return 'cron: expected 5 fields "min hour dom mon dow"'
    }
    if (input.timeoutMin != null) {
      const n = Number(input.timeoutMin)
      if (!Number.isFinite(n) || n < 1 || n > 1440) return 'timeoutMin: 1..1440 minutes'
    }
    if (input.args != null && (typeof input.args !== 'string' || input.args.length > 8000)) return 'args: string up to 8000 chars'
    if (input.env != null) {
      if (typeof input.env !== 'object' || Array.isArray(input.env)) return 'env: object'
      const keys = Object.keys(input.env)
      if (keys.length > 30) return 'env: up to 30 entries'
      for (const k of keys) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return `env: bad key ${k}`
        if (typeof input.env[k] !== 'string') return 'env: values must be strings'
      }
    }
    if (input.cwd != null && (typeof input.cwd !== 'string' || input.cwd.length > 500)) return 'cwd: string'
    if (kind === 'script' && !/\.(ts|js|mjs|cjs|tsx|jsx)$/i.test(input.source.trim())) return 'script source must be a .ts/.js/.mjs/.cjs/.tsx/.jsx file'
    return null
  }

  // ── durable state ────────────────────────────────────────────────────────

  function loadState() {
    try {
      if (!existsSync(STATE_FILE)) return
      const data = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
      if (data && Array.isArray(data.tasks)) state.tasks = data.tasks.map(normalizeTask).filter(Boolean)
      if (data && Array.isArray(data.runs)) state.runs = data.runs.filter((r) => r && r.id).slice(0, MAX_RUNS)
      for (const r of state.runs) if (r.status === 'running') r.status = 'interrupted'
      state.loadError = ''
    } catch (e) {
      state.loadError = e instanceof Error ? e.message : String(e)
      console.error('[tsched] state load failed:', state.loadError)
    }
  }

  let saveTimer = null
  function scheduleSave() {
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      saveState()
    }, SAVE_DEBOUNCE_MS)
  }

  function saveState() {
    try {
      mkdirSync(STATE_DIR, { recursive: true })
      writeFileSync(STATE_FILE, JSON.stringify({ version: 1, savedAt: nowMs(), tasks: state.tasks, runs: state.runs }, null, 2))
    } catch (e) {
      console.error('[tsched] state save failed:', e instanceof Error ? e.message : e)
    }
  }

  /** Best-effort import of the pre-persistent workspace state (<root>/.dsh-tasks/tasks.json). */
  function migrateFromWorkspace() {
    if (state.migrated) return
    state.migrated = true
    if (existsSync(STATE_FILE)) return
    if (!sandboxPolicy()) return
    const legacy = join(sandboxPolicy().workspaceRoot, '.dsh-tasks', 'tasks.json')
    if (!existsSync(legacy)) return
    try {
      const data = JSON.parse(readFileSync(legacy, 'utf8'))
      if (data && Array.isArray(data.tasks)) state.tasks = data.tasks.map(normalizeTask).filter(Boolean)
      if (data && Array.isArray(data.runs)) state.runs = data.runs.filter((r) => r && r.id).slice(0, MAX_RUNS)
      saveState()
      console.log('[tsched] imported legacy workspace state from', legacy)
    } catch (e) {
      console.error('[tsched] legacy migration failed:', e instanceof Error ? e.message : e)
    }
  }

  function sourceExists(task, root) {
    const path = isAbsolute(task.source) ? task.source : resolve(root || process.cwd(), task.source)
    try {
      return existsSync(path)
    } catch {
      return false
    }
  }

  function lastRunOf(taskId) {
    for (const r of state.runs) if (r.taskId === taskId) return r
    return null
  }

  // ── workspace / policy resolution ────────────────────────────────────────

  function sessionInfo(sessionId) {
    if (sessions() && typeof sessionId === 'string' && sessionId) {
      const s = sessions().get(sessionId)
      if (s && s.header && typeof s.header.cwd === 'string' && s.header.cwd) return { session: s, cwd: s.header.cwd }
    }
    return null
  }

  function policyFor(session) {
    if (!sandboxPolicy()) return undefined
    return session ? sandboxPolicy().resolve({ session }) : sandboxPolicy().resolve({})
  }

  function fallbackRoot() {
    if (sandboxPolicy()) return sandboxPolicy().workspaceRoot
    return process.cwd()
  }

  function resolveRootFor(task, sessionId) {
    if (task && typeof task.cwd === 'string' && task.cwd) return task.cwd
    const info = sessionInfo(sessionId)
    if (info) return info.cwd
    if (state.root) return state.root
    return fallbackRoot()
  }

  function noteRoot(sessionId) {
    const info = sessionInfo(sessionId)
    if (info) state.root = info.cwd
  }

  // ── driver agents (one per workspace root, LRU-capped) ───────────────────

  async function defaultModelOptions() {
    const options = {}
    if (!agentDefaultModel()) return options
    try {
      const sel = agentDefaultModel().currentSelection()
      if (sel && typeof sel.provider === 'string' && sel.provider) options.provider = sel.provider
      if (sel && typeof sel.model === 'string' && sel.model) options.model = sel.model
      if (sel && typeof sel.reasoningEffort === 'string' && sel.reasoningEffort) options.reasoningEffort = sel.reasoningEffort
    } catch (e) {
      console.error('[tsched] default model read failed:', e instanceof Error ? e.message : e)
    }
    return options
  }

  async function getDriver(root, donorSessionId) {
    const cached = drivers.get(root)
    if (cached) {
      cached.lastUsed = Date.now()
      return cached.agent
    }
    if (!agents() || !presets()) throw new Error('agent services unavailable')
    const preset = await presets().resolve()
    const presetId = preset && preset.id ? preset.id : undefined
    const driverId = `task-scheduler-driver-${Date.now().toString(36)}`
    const options = await defaultModelOptions()
    const handle = await agents().create({
      sessionId: driverId,
      meta: { cwd: root, ...(presetId !== undefined ? { agentPreset: presetId } : {}) },
      agentOptions: options,
      setup: async (agentCtx) => {
        await presets().mount(agentCtx, presetId)
      },
    })
    try {
      if (sessions() && sandboxPolicy()) {
        const s = sessions().get(driverId)
        if (s) {
          const donor = typeof donorSessionId === 'string' && donorSessionId ? sessions().get(donorSessionId) : undefined
          const override = donor ? sandboxPolicy().overrideOf(donor) : undefined
          if (override) s.append('sandbox/mode', { mode: override, source: 'delegation' })
        }
      }
    } catch (e) {
      console.error('[tsched] sandbox mode inheritance failed:', e instanceof Error ? e.message : e)
    }
    try {
      if (sessions() && sessionTitle()) {
        const s2 = sessions().get(driverId)
        if (s2) sessionTitle().rename(s2, `Task Scheduler (driver) — ${basename(root) || root}`)
      }
    } catch (e) {
      /* non-fatal */
    }
    drivers.set(root, { agent: handle.agent, handle, lastUsed: Date.now() })
    state.driverCount = drivers.size
    trimDrivers()
    console.log('[tsched] driver agent ready:', driverId, 'preset:', presetId || '(default)', 'root:', root)
    return handle.agent
  }

  function trimDrivers() {
    if (drivers.size <= DRIVER_CAP) return
    const entries = [...drivers.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    while (entries.length > DRIVER_CAP) {
      const [root, entry] = entries.shift()
      drivers.delete(root)
      state.driverCount = drivers.size
      void entry.handle.dispose().catch(() => {})
    }
  }

  // ── runners ──────────────────────────────────────────────────────────────

  async function startRun(task, trigger, sessionId) {
    if (!task) return { ok: false, error: 'task not found' }
    for (const r of state.runs) {
      if (r.taskId === task.id && r.status === 'running') return { ok: false, error: 'task is already running' }
    }
    let running = 0
    for (const r of state.runs) if (r.status === 'running') running += 1
    if (running >= MAX_CONCURRENT) return { ok: false, error: `max concurrent runs reached (${MAX_CONCURRENT})` }
    const run = {
      id: uid('run'),
      taskId: task.id,
      taskName: task.name,
      kind: task.kind,
      trigger: trigger || 'manual',
      status: 'running',
      startedAt: nowMs(),
      finishedAt: null,
      exitCode: null,
      stopReason: null,
      stdoutTail: '',
      stderrTail: '',
      error: '',
    }
    state.runs.unshift(run)
    if (state.runs.length > MAX_RUNS) state.runs.length = MAX_RUNS
    task.lastRunAt = run.startedAt
    task.lastRunId = run.id
    const ctrl = new AbortController()
    active.set(run.id, { ctrl, stop: null })
    scheduleSave()
    void executeRun(task, run, ctrl, sessionId)
    return { ok: true, run }
  }

  async function executeRun(task, run, ctrl, sessionId) {
    try {
      if (task.kind === 'script') await executeScriptTask(task, run, ctrl, sessionId)
      else await executeAgentTask(task, run, ctrl, sessionId)
      if (run.status === 'running') run.status = 'success'
    } catch (e) {
      if (ctrl.signal.aborted) {
        const isTimeout = ctrl.signal.reason && ctrl.signal.reason.message === 'timeout'
        run.status = isTimeout ? 'error' : 'stopped'
        run.error = isTimeout ? 'timeout' : (e instanceof Error ? e.message : String(e || 'stopped'))
      } else {
        run.status = 'error'
        run.error = e instanceof Error ? e.message : String(e)
      }
    } finally {
      run.finishedAt = nowMs()
      active.delete(run.id)
      scheduleSave()
    }
  }

  async function executeAgentTask(task, run, ctrl, sessionId) {
    if (!subagents()) throw new Error('subagents service unavailable')
    const root = resolveRootFor(task, sessionId)
    const sourcePath = isAbsolute(task.source) ? task.source : resolve(root, task.source)
    const md = readFileSync(sourcePath, 'utf8')
    const extra = task.args && String(task.args).trim() ? `\n\n---\nAdditional run instructions:\n${task.args}` : ''
    const prompt = String(md || '') + extra
    const providers = subagents().list()
    const provider = providers.includes('fork') ? 'fork' : providers[0]
    if (!provider) throw new Error('no subagent provider registered')
    const timeoutMin = Number(task.timeoutMin) || 60
    const timeoutMs = timeoutMin * 60000
    const timeout = setTimeout(() => {
      ctrl.abort(new Error('timeout'))
    }, timeoutMs)
    timeout.unref?.()
    let handle = null
    try {
      const driver = await getDriver(root, sessionId)
      handle = await subagents().start(provider, {
        label: task.name,
        prompt: [{ type: 'text', text: prompt }],
        parent: driver,
        signal: ctrl.signal,
      })
      const result = await handle.result
      if (ctrl.signal.aborted) return // executeRun maps aborted -> stopped/timeout
      const output = Array.isArray(result.output) ? result.output : []
      run.stdoutTail = tailText(output.map((b) => {
        if (b && b.type === 'text') return b.text || ''
        return `[${b && b.type ? b.type : '?'}]`
      }).join('\n'), 8000)
      run.stopReason = result.stopReason || null
      if (result.stopReason !== 'completed') {
        let detail = typeof result.diagnostic === 'string' ? result.diagnostic : ''
        try {
          const agent = handle.localAgent
          if (agent && agent.session) {
            const events = agent.session.snapshotEvents()
            for (let i = events.length - 1; i >= 0; i--) {
              const ev = events[i]
              if (ev && ev.type === 'turn/end' && ev.data && ev.data.reason && ev.data.reason.kind === 'error') {
                const err = ev.data.reason.error
                const msg = err ? err.message || err.code : null
                if (msg) {
                  detail = msg
                  break
                }
              }
            }
          }
        } catch (e2) {
          /* ignore */
        }
        run.status = 'error'
        run.error = `stop reason: ${result.stopReason}${detail ? ` — ${detail}` : ''}`
      }
    } finally {
      clearTimeout(timeout)
      if (handle) {
        try {
          await handle.dispose()
        } catch (e) {
          /* ignore */
        }
      }
    }
  }

  async function executeScriptTask(task, run, ctrl, sessionId) {
    if (!shell()) throw new Error('shell service unavailable')
    const info = sessionInfo(sessionId)
    const root = resolveRootFor(task, sessionId)
    const sourcePath = isAbsolute(task.source) ? task.source : resolve(root, task.source)
    const argsText = task.args && String(task.args).trim() ? ` ${String(task.args).trim()}` : ''
    const command = `bun run ${escapeSh(sourcePath)}${argsText}`
    const timeoutMs = (Number(task.timeoutMin) || 30) * 60000
    const env = {}
    if (task.env && typeof task.env === 'object') {
      for (const k of Object.keys(task.env)) env[k] = String(task.env[k])
    }
    const spec = shell().resolve({
      command,
      workdir: root,
      timeoutMs,
      env,
      signal: ctrl.signal,
      sandboxPolicy: policyFor(info ? info.session : undefined),
    })
    const res = await shell().run(spec)
    run.exitCode = res.exitCode
    run.stdoutTail = tailText(res.stdout && res.stdout.text, 8000)
    run.stderrTail = tailText(res.stderr && res.stderr.text, 8000)
    if (res.timedOut) {
      run.status = 'error'
      run.error = 'timeout'
      return
    }
    if (res.aborted || ctrl.signal.aborted) {
      run.status = 'stopped'
      run.error = 'stopped'
      return
    }
    if (res.sandbox && res.sandbox.denied) {
      run.status = 'error'
      run.error = 'sandbox denied the command'
      return
    }
    if (res.exitCode !== 0) {
      run.status = 'error'
      run.error = `exit code ${res.exitCode}${res.signal ? ` (signal ${res.signal})` : ''}`
    }
  }

  // ── CRON ticker ──────────────────────────────────────────────────────────

  const tick = setInterval(() => {
    if (state.tasks.length === 0) return
    const now = new Date()
    for (const task of state.tasks) {
      if (!task.enabled || !task.cron) continue
      let entry = cronCache.get(task.id)
      if (!entry || entry.src !== task.cron) {
        entry = { src: task.cron, parsed: parseCron(task.cron) }
        cronCache.set(task.id, entry)
      }
      const parsed = entry.parsed
      if (!parsed || !cronMatches(parsed, now)) continue
      if (nowMs() - (Number(task.lastCronFiredAt) || 0) < CRON_MIN_GAP_MS) continue
      task.lastCronFiredAt = nowMs()
      scheduleSave()
      void startRun(task, 'cron', undefined)
    }
  }, CRON_TICK_MS)
  ctx.effect(() => () => clearInterval(tick))

  // ── model tool ───────────────────────────────────────────────────────────

  const toolDefinition = {
    name: 'task_trigger',
    description: 'Немедленно запустить задачу планировщика задач по id или имени. Возвращает id запуска или ошибку.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'ID или имя задачи из панели «Планировщик задач»' },
      },
      required: ['task'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          runId: { type: 'string' },
          task: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render(_args, value) {
        const v = value || {}
        if (v.ok) return [{ type: 'text', text: `Запуск ${v.runId} задачи «${v.task}» стартовал.` }]
        return [{ type: 'text', text: `Не удалось запустить задачу: ${v.error || 'unknown error'}` }]
      },
    },
    async execute(args) {
      const q = String((args && args.task) || '').trim()
      if (!q) return { ok: false, error: 'task id or name required' }
      const task = state.tasks.find((t) => t.id === q || t.name === q)
      if (!task) return { ok: false, error: `task not found: ${q}` }
      const res = await startRun(task, 'tool', undefined)
      if (!res.ok) return { ok: false, error: res.error }
      return { ok: true, runId: res.run.id, task: task.name }
    },
  }

  const registerTool = (tools) => ctx.effect(() => {
    try {
      return tools.register(toolDefinition)
    } catch (e) {
      console.error('[tsched] tool registration failed:', e instanceof Error ? e.message : e)
      return () => {}
    }
  }, 'dsh-task-scheduler: tool')
  const toolsNow = ctx.get('tools')
  if (toolsNow) {
    registerTool(toolsNow)
  } else {
    ctx.inject(['tools'], (tCtx) => {
      const tools = tCtx.get('tools')
      registerTool(tools)
    })
  }

  // ── browser API ──────────────────────────────────────────────────────────

  function snapshot(sessionId) {
    noteRoot(sessionId)
    const tasks = state.tasks.map((t) => {
      const lr = lastRunOf(t.id)
      return {
        id: t.id,
        name: t.name,
        kind: t.kind,
        source: t.source,
        cron: t.cron || '',
        enabled: !!t.enabled,
        timeoutMin: t.timeoutMin,
        args: t.args || '',
        env: t.env || {},
        cwd: t.cwd || '',
        createdAt: t.createdAt || null,
        updatedAt: t.updatedAt || null,
        lastRunAt: t.lastRunAt || null,
        lastRun: lr ? { id: lr.id, status: lr.status, startedAt: lr.startedAt, finishedAt: lr.finishedAt } : null,
      }
    })
    return {
      ok: true,
      stateDir: STATE_DIR,
      root: state.root || fallbackRoot(),
      driverReady: drivers.size > 0,
      loadError: state.loadError || '',
      tasks,
      runs: state.runs.slice(0, 50),
    }
  }

  function stopActiveEntry(entry, reason) {
    if (!entry) return
    entry.ctrl.abort(new Error(reason))
    if (entry.stop) {
      try {
        entry.stop()
      } catch (e) {
        /* ignore */
      }
    }
  }

  async function handleApi(req, res) {
    try {
      assertNotCrossSite(req)
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname
      if (req.method === 'GET' && path === `${API_PREFIX}/state`) {
        const sessionId = url.searchParams.get('sessionId') ?? ''
        sendJson(res, 200, snapshot(sessionId))
        return
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req)
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        if (path === `${API_PREFIX}/saveTask`) {
          const input = body.task
          const err = validateTaskInput(input)
          if (err) {
            sendJson(res, 400, { ok: false, error: err })
            return
          }
          const existing = input.id ? state.tasks.find((t) => t.id === input.id) : null
          const task = normalizeTask({
            id: existing ? existing.id : uid('task'),
            name: input.name,
            kind: input.kind,
            source: input.source,
            cron: input.cron || '',
            enabled: input.enabled !== false,
            timeoutMin: input.timeoutMin,
            args: input.args || '',
            env: input.env || {},
            cwd: input.cwd || '',
            createdAt: existing ? existing.createdAt : nowMs(),
            updatedAt: nowMs(),
            lastRunAt: existing ? existing.lastRunAt : null,
            lastRunId: existing ? existing.lastRunId : null,
            lastCronFiredAt: existing ? existing.lastCronFiredAt : null,
          })
          if (!task) {
            sendJson(res, 400, { ok: false, error: 'invalid task' })
            return
          }
          if (!sourceExists(task, resolveRootFor(task, sessionId))) {
            sendJson(res, 400, { ok: false, error: `source file not found: ${task.source}` })
            return
          }
          if (existing) {
            state.tasks[state.tasks.indexOf(existing)] = task
          } else {
            state.tasks.unshift(task)
          }
          cronCache.delete(task.id)
          scheduleSave()
          sendJson(res, 200, { ok: true, task })
          return
        }
        if (path === `${API_PREFIX}/deleteTask`) {
          const id = body.id
          const i = state.tasks.findIndex((t) => t.id === id)
          if (i < 0) {
            sendJson(res, 404, { ok: false, error: 'task not found' })
            return
          }
          state.tasks.splice(i, 1)
          for (const r of state.runs) {
            if (r.taskId === id && r.status === 'running') stopActiveEntry(active.get(r.id), 'task deleted')
          }
          cronCache.delete(id)
          scheduleSave()
          sendJson(res, 200, { ok: true })
          return
        }
        if (path === `${API_PREFIX}/runTask`) {
          const task = state.tasks.find((t) => t.id === body.id)
          if (!task) {
            sendJson(res, 404, { ok: false, error: 'task not found' })
            return
          }
          const result = await startRun(task, 'manual', sessionId)
          sendJson(res, result.ok ? 200 : 409, result)
          return
        }
        if (path === `${API_PREFIX}/stopRun`) {
          const entry = active.get(body.runId)
          if (!entry) {
            sendJson(res, 404, { ok: false, error: 'run not active' })
            return
          }
          stopActiveEntry(entry, 'stopped by user')
          sendJson(res, 200, { ok: true })
          return
        }
        if (path === `${API_PREFIX}/clearRuns`) {
          for (const r of state.runs) {
            if (r.status === 'running') stopActiveEntry(active.get(r.id), 'cleared')
          }
          state.runs = []
          scheduleSave()
          sendJson(res, 200, { ok: true })
          return
        }
      }
      sendJson(res, 404, { ok: false, error: 'unknown api path' })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const status = message.includes('cross-site') ? 403 : 400
      sendJson(res, status, { ok: false, error: message })
    }
  }

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: handleApi,
    }), 'dsh-task-scheduler: api')
  })

  // ── boot ─────────────────────────────────────────────────────────────────

  loadState()
  migrateFromWorkspace()
  console.log('[tsched] scheduler ready, state dir:', STATE_DIR)
}

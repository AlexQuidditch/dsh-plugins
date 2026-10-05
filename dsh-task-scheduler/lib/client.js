window.__ModuleLoader__.load({
  id: 'dsh-task-scheduler',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    // ── constants ───────────────────────────────────────────────────────────
    const API = '/dsh-tsched/api'
    const POLL_MS = 2500

    const CSS = [
      '.tsp-wrap { display:flex; flex-direction:column; gap:10px; font-size:13px; line-height:1.45; }',
      '.tsp-title { font-size:15px; font-weight:600; display:flex; align-items:center; gap:8px; justify-content:space-between; }',
      '.tsp-sub { opacity:.65; font-size:12px; word-break:break-all; }',
      '.tsp-warn { color:#c98b2d; font-size:12px; margin-top:4px; }',
      '.tsp-error { color:#e05b5b; background:rgba(224,91,91,.08); border:1px solid rgba(224,91,91,.35); border-radius:8px; padding:8px 10px; }',
      '.tsp-card { border:1px solid rgba(128,128,128,.25); border-radius:10px; padding:10px; display:flex; flex-direction:column; gap:6px; }',
      '.tsp-task-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }',
      '.tsp-task-name { font-weight:600; }',
      '.tsp-task-src { opacity:.7; font-family:ui-monospace,monospace; font-size:12px; word-break:break-all; }',
      '.tsp-task-actions { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }',
      '.tsp-badge { font-size:10px; text-transform:uppercase; letter-spacing:.04em; padding:2px 6px; border-radius:6px; border:1px solid rgba(128,128,128,.4); }',
      '.bd-agent { color:#8f7cf0; border-color:rgba(143,124,240,.5); }',
      '.bd-script { color:#4fb3e8; border-color:rgba(79,179,232,.5); }',
      '.tsp-cron { font-family:ui-monospace,monospace; font-size:12px; opacity:.8; }',
      '.tsp-cron-off { opacity:.45; }',
      '.tsp-cron-next { font-size:11px; opacity:.7; color:#42be65; }',
      '.tsp-chip { font-size:11px; padding:2px 8px; border-radius:999px; }',
      '.st-success { background:rgba(66,190,101,.15); color:#42be65; }',
      '.st-error { background:rgba(224,91,91,.15); color:#e05b5b; }',
      '.st-running { background:rgba(79,179,232,.15); color:#4fb3e8; }',
      '.st-stopped { background:rgba(128,128,128,.15); }',
      '.st-none { background:rgba(128,128,128,.1); opacity:.6; }',
      '.tsp-btn { font-size:12px; padding:4px 10px; border-radius:7px; border:1px solid rgba(128,128,128,.4); background:transparent; color:inherit; cursor:pointer; }',
      '.tsp-btn:hover:not(:disabled) { border-color:rgba(128,128,128,.8); }',
      '.tsp-btn:disabled { opacity:.5; cursor:default; }',
      '.tsp-primary { border-color:rgba(74,125,255,.7); color:#7ea4ff; }',
      '.tsp-danger { border-color:rgba(224,91,91,.5); color:#e08a8a; }',
      '.tsp-link { border:none; opacity:.7; text-decoration:underline; padding:0; }',
      '.tsp-row { display:flex; gap:8px; }',
      '.tsp-field { flex:1; display:flex; flex-direction:column; gap:3px; font-size:11px; opacity:.85; }',
      '.tsp-kind { flex:0 0 170px; }',
      '.tsp-num { flex:0 0 110px; }',
      '.tsp-field input, .tsp-field select, .tsp-field textarea { background:transparent; border:1px solid rgba(128,128,128,.35); border-radius:6px; padding:5px 8px; color:inherit; font-size:12px; font-family:inherit; }',
      '.tsp-check { display:flex; align-items:center; gap:4px; font-size:12px; }',
      '.tsp-runs-title { margin-top:6px; }',
      '.tsp-run-head { display:flex; align-items:center; gap:8px; cursor:pointer; flex-wrap:wrap; }',
      '.tsp-run-time { opacity:.65; font-size:12px; }',
      '.tsp-run-name { font-weight:600; }',
      '.tsp-run-trigger { font-size:11px; opacity:.7; }',
      '.tsp-run-dur { margin-left:auto; opacity:.65; font-size:12px; }',
      '.tsp-run-exit { font-family:ui-monospace,monospace; font-size:11px; opacity:.7; }',
      '.tsp-log { background:rgba(0,0,0,.25); border-radius:8px; padding:8px; font-size:11px; font-family:ui-monospace,monospace; white-space:pre-wrap; word-break:break-word; max-height:260px; overflow:auto; margin:0; }',
    ].join('\n')

    const h = React.createElement

    const STATUS = {
      running: { label: 'выполняется', cls: 'st-running' },
      success: { label: 'успех', cls: 'st-success' },
      error: { label: 'ошибка', cls: 'st-error' },
      stopped: { label: 'остановлена', cls: 'st-stopped' },
      interrupted: { label: 'прервана', cls: 'st-stopped' },
    }

    function fmtTime(ms) {
      if (!ms) return '—'
      try {
        return new Date(ms).toLocaleString()
      } catch (e) {
        return String(ms)
      }
    }

    function fmtDur(a, b) {
      if (!a) return '—'
      const end = b || Date.now()
      const s = Math.max(0, Math.round((end - a) / 1000))
      const m = Math.floor(s / 60)
      const sec = s % 60
      return m > 0 ? `${m}м ${sec}с` : `${sec}с`
    }

    // ── cron preview helpers ────────────────────────────────────────────────
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
      return { parts, fields }
    }

    function cronMatches(parsed, d) {
      const dow = d.getDay()
      return parsed.fields[0].has(d.getMinutes())
        && parsed.fields[1].has(d.getHours())
        && parsed.fields[2].has(d.getDate())
        && parsed.fields[3].has(d.getMonth() + 1)
        && (parsed.fields[4].has(dow) || (dow === 0 && parsed.fields[4].has(7)))
    }

    function nextCronRun(parsed, from) {
      const d = new Date(from.getTime())
      d.setSeconds(0, 0)
      d.setMinutes(d.getMinutes() + 1)
      const limit = new Date(d.getTime())
      limit.setFullYear(limit.getFullYear() + 2)
      while (d.getTime() <= limit.getTime()) {
        if (cronMatches(parsed, d)) return d
        d.setMinutes(d.getMinutes() + 1)
      }
      return null
    }

    function fmtCountdown(ms) {
      if (ms == null) return '—'
      const s = Math.max(0, Math.round(ms / 1000))
      const d = Math.floor(s / 86400)
      const hr = Math.floor((s % 86400) / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = s % 60
      if (d > 0) return `${d}д ${hr}ч`
      if (hr > 0) return `${hr}ч ${m}м`
      if (m > 0) return `${m}м ${sec}с`
      return `${sec}с`
    }

    /** Short human description of common cron shapes; null → show the raw expression. */
    function describeCron(parts) {
      const [min, hour, dom, mon, dow] = parts
      const star = (s) => s === '*'
      const single = (s) => /^\d+$/.test(s)
      const stepOf = (s) => {
        const m = s.match(/^\*\/(\d+)$/)
        return m ? Number.parseInt(m[1], 10) : null
      }
      const pad = (s) => String(s).padStart(2, '0')
      if (star(min) && star(hour) && star(dom) && star(mon) && star(dow)) return 'каждую минуту'
      const minStep = stepOf(min)
      if (minStep !== null && star(hour) && star(dom) && star(mon) && star(dow)) {
        return minStep === 1 ? 'каждую минуту' : `каждые ${minStep} мин`
      }
      if (single(min) && star(hour) && star(dom) && star(mon) && star(dow)) return `каждый час в :${pad(min)}`
      if (single(min) && single(hour) && star(dom) && star(mon) && star(dow)) return `ежедневно в ${pad(hour)}:${pad(min)}`
      if (single(min) && single(hour) && star(dom) && star(mon) && single(dow)) {
        const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
        const idx = dow === '7' ? 0 : Number.parseInt(dow, 10)
        return `по ${days[idx]} в ${pad(hour)}:${pad(min)}`
      }
      if (single(min) && single(hour) && single(dom) && star(mon) && star(dow)) return `${dom}-го числа в ${pad(hour)}:${pad(min)}`
      return null
    }

    function cronPreview(task) {
      if (!task.cron) return null
      const parsed = parseCron(task.cron)
      if (!parsed) return { desc: task.cron, next: null }
      return { desc: describeCron(parsed.parts) || task.cron, next: nextCronRun(parsed, new Date()) }
    }

    function Chip(props) {
      const s = STATUS[props.status] || { label: props.status || '—', cls: 'st-stopped' }
      return h('span', { className: `tsp-chip ${s.cls}` }, s.label)
    }

    function Btn(props) {
      return h('button', {
        className: `tsp-btn ${props.kind || ''}`,
        onClick: props.onClick,
        disabled: !!props.disabled,
        title: props.title || '',
      }, props.children)
    }

    async function api(method, path, body) {
      const res = await fetch(API + path, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      return res.json().catch(() => null)
    }

    function emptyDraft() {
      return { id: null, name: '', kind: 'agent', source: '', cron: '', enabled: true, timeoutMin: 60, args: '', envText: '', cwd: '' }
    }

    function parseEnv(text) {
      const env = {}
      const lines = String(text || '').split('\n')
      for (const line of lines) {
        const s = line.trim()
        if (!s || s.charAt(0) === '#') continue
        const i = s.indexOf('=')
        if (i > 0) env[s.slice(0, i).trim()] = s.slice(i + 1).trim()
      }
      return env
    }

    function envToText(env) {
      const e = env || {}
      return Object.keys(e).map((k) => `${k}=${e[k]}`).join('\n')
    }

    function Editor(props) {
      const draft = props.draft
      const set = (key) => (ev) => {
        const next = { ...draft }
        next[key] = ev.target.value
        props.setDraft(next)
      }
      const check = (ev) => props.setDraft({ ...draft, enabled: ev.target.checked })
      const scriptOnly = draft.kind === 'script'
        ? [
            h('div', { className: 'tsp-row' },
              h('label', { className: 'tsp-field' }, 'ENV (K=V по строке)',
                h('textarea', { rows: 3, value: draft.envText || '', onChange: set('envText'), placeholder: 'API_KEY=...' })),
              h('label', { className: 'tsp-field' }, 'Рабочая папка',
                h('input', { value: draft.cwd || '', onChange: set('cwd'), placeholder: 'пусто = воркспейс сессии' }))),
          ]
        : []
      return h('div', { className: 'tsp-card tsp-editor' },
        h('div', { className: 'tsp-row' },
          h('label', { className: 'tsp-field' }, 'Название',
            h('input', { value: draft.name || '', onChange: set('name'), placeholder: 'Например: nightly report' })),
          h('label', { className: 'tsp-field tsp-kind' }, 'Тип',
            h('select', { value: draft.kind, onChange: set('kind') },
              h('option', { value: 'agent' }, 'AI-агент (.md)'),
              h('option', { value: 'script' }, 'Скрипт (bun run)'))),
        ),
        h('div', { className: 'tsp-row' },
          h('label', { className: 'tsp-field' }, draft.kind === 'agent' ? 'Файл инструкции (.md)' : 'Скрипт (.ts/.js)',
            h('input', { value: draft.source || '', onChange: set('source'), placeholder: draft.kind === 'agent' ? 'tasks/daily-report.md' : 'scripts/fetch.ts' })),
          h('label', { className: 'tsp-field' }, 'CRON (мин час день месяц дн.нед)',
            h('input', { value: draft.cron || '', onChange: set('cron'), placeholder: '*/30 * * * *' })),
        ),
        h('div', { className: 'tsp-row' },
          h('label', { className: 'tsp-field' }, draft.kind === 'agent' ? 'Доп. инструкции (в конец промпта)' : 'Аргументы скрипта',
            h('input', { value: draft.args || '', onChange: set('args'), placeholder: '' })),
          h('label', { className: 'tsp-field tsp-num' }, 'Таймаут, мин',
            h('input', { type: 'number', min: 1, max: 1440, value: String(draft.timeoutMin || 60), onChange: set('timeoutMin') })),
        ),
        scriptOnly,
        h('div', { className: 'tsp-row tsp-actions' },
          h('label', { className: 'tsp-check' }, h('input', { type: 'checkbox', checked: !!draft.enabled, onChange: check }), ' включена'),
          h('button', { className: 'tsp-btn tsp-primary', onClick: props.onSave, disabled: props.busy }, props.busy ? '…' : 'Сохранить'),
          h('button', { className: 'tsp-btn', onClick: props.onCancel }, 'Отмена')),
      )
    }

    function Panel(props) {
      const useSessions = props.useSessions
      // 0.2 dropped the sessions store's `current` field: the snapshot is now
      // { ids, byId, phase, projectionsBySession }. The live equivalent of
      // "the session on screen" is the one the main view retains — the same
      // idiom the shipped @deepseek-ai/dsh-client-ui-layout uses in DocumentTitle.
      const currentSessionId = useSessions ? useSessions((s) => {
        const byId = (s && s.byId) || {}
        const hit = Object.values(byId).find((x) => x && x.retainedBy && (x.retainedBy.mainView || 0) > 0)
        return hit ? hit.id : undefined
      }) : undefined
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [draft, setDraft] = React.useState(null)
      const [openRunId, setOpenRunId] = React.useState(null)
      const [deleting, setDeleting] = React.useState(null)

      React.useEffect(() => {
        let alive = true
        const wrap = () => {
          api('GET', `/state?sessionId=${encodeURIComponent(currentSessionId || '')}`).then((d) => {
            if (!alive) return
            if (d && d.ok) {
              setData(d)
              setError('')
            } else {
              setError((d && d.error) || 'host error')
            }
          }).catch((e) => {
            if (alive) setError(e instanceof Error ? e.message : String(e))
          })
        }
        wrap()
        const t = setInterval(wrap, POLL_MS)
        return () => {
          alive = false
          clearInterval(t)
        }
      }, [currentSessionId])

      const call = async (path, body) => {
        const r = await api('POST', path, { ...(body || {}), sessionId: currentSessionId || '' })
        if (!(r && r.ok)) setError((r && r.error) || `${path} failed`)
        return r && r.ok ? r : null
      }

      const runNow = (task) => {
        setBusy(true)
        call('/runTask', { id: task.id }).then(() => setBusy(false))
      }
      const stopRun = (runId) => {
        call('/stopRun', { runId }).catch(() => {})
      }
      const del = (task) => {
        setDeleting(task.id)
        call('/deleteTask', { id: task.id }).then(() => setDeleting(null))
      }
      const clearRuns = () => {
        call('/clearRuns').catch(() => {})
      }
      const toggle = (task) => {
        call('/saveTask', {
          task: {
            id: task.id,
            name: task.name,
            kind: task.kind,
            source: task.source,
            cron: task.cron || '',
            enabled: !task.enabled,
            timeoutMin: task.timeoutMin,
            args: task.args || '',
            env: task.env || {},
            cwd: task.cwd || '',
          },
        })
      }
      const save = async () => {
        if (!draft) return
        setBusy(true)
        const task = {
          name: draft.name || '',
          kind: draft.kind === 'script' ? 'script' : 'agent',
          source: draft.source || '',
          cron: draft.cron || '',
          enabled: !!draft.enabled,
          timeoutMin: Number(draft.timeoutMin) > 0 ? Number(draft.timeoutMin) : 60,
          args: draft.args || '',
          env: parseEnv(draft.envText),
          cwd: draft.cwd || '',
        }
        if (draft.id) task.id = draft.id
        const r = await call('/saveTask', { task })
        setBusy(false)
        if (r) setDraft(null)
      }

      const tasks = data ? data.tasks : []
      const runs = data ? data.runs : []

      return h('div', { className: 'tsp-wrap' },
        h('div', { className: 'tsp-head' },
          h('div', null,
            h('div', { className: 'tsp-title' }, 'Планировщик задач'),
            h('div', { className: 'tsp-sub' }, data && data.stateDir ? `Состояние: ${data.stateDir}/tasks.json` : 'загрузка…'),
            data && !data.driverReady ? h('div', { className: 'tsp-warn' }, 'Драйвер AI-агентов пока не создан — он появится при первом запуске .md-задачи.') : null,
            data && data.loadError ? h('div', { className: 'tsp-warn' }, `Загрузка состояния: ${data.loadError}`) : null),
          h('button', { className: 'tsp-btn tsp-primary', onClick: () => setDraft(emptyDraft()) }, '+ Новая задача'),
        ),
        error ? h('div', { className: 'tsp-error' }, error) : null,
        draft ? h(Editor, { draft, setDraft, onSave: save, onCancel: () => setDraft(null), busy }) : null,
        h('div', { className: 'tsp-sub' }, tasks.length === 0 ? 'Задач пока нет — создайте первую.' : `Задач: ${tasks.length}`),
        tasks.map((task) => {
          const last = task.lastRun
          const running = !!last && last.status === 'running'
          return h('div', { key: task.id, className: 'tsp-card' },
            h('div', { className: 'tsp-task-head' },
              h('span', { className: 'tsp-task-name' }, task.name),
              h('span', { className: `tsp-badge ${task.kind === 'agent' ? 'bd-agent' : 'bd-script'}` }, task.kind === 'agent' ? 'AI .md' : 'bun run'),
              (() => {
                const pv = cronPreview(task)
                if (!pv) return h('span', { className: 'tsp-cron tsp-cron-off' }, 'по кнопке')
                return [
                  h('span', { className: 'tsp-cron', title: task.cron }, `⏱ ${pv.desc}`),
                  pv.next ? h('span', { className: 'tsp-cron-next', title: 'до следующего запуска' }, `через ${fmtCountdown(pv.next.getTime() - Date.now())}`) : null,
                ]
              })(),
              last ? h(Chip, { status: last.status }) : h('span', { className: 'tsp-chip st-none' }, 'нет запусков'),
            ),
            h('div', { className: 'tsp-task-src' }, task.source),
            h('div', { className: 'tsp-task-actions' },
              h('label', { className: 'tsp-check' }, h('input', { type: 'checkbox', checked: !!task.enabled, onChange: () => toggle(task) }), ' cron'),
              h(Btn, { onClick: () => runNow(task), disabled: busy || running, title: 'Запустить сейчас' }, '▶ Запустить'),
              running ? h(Btn, { onClick: () => stopRun(last.id), kind: 'tsp-danger' }, '⏹ Стоп') : null,
              h(Btn, { onClick: () => setDraft({ id: task.id, name: task.name, kind: task.kind, source: task.source, cron: task.cron || '', enabled: task.enabled, timeoutMin: task.timeoutMin, args: task.args || '', envText: envToText(task.env), cwd: task.cwd || '' }) }, 'Изменить'),
              h(Btn, { onClick: () => del(task), kind: 'tsp-danger', disabled: deleting === task.id }, deleting === task.id ? '…' : 'Удалить'),
            ),
          )
        }),
        h('div', { className: 'tsp-title tsp-runs-title' }, 'История запусков',
          runs.length > 0 ? h('button', { className: 'tsp-btn tsp-link', onClick: clearRuns }, 'очистить') : null),
        runs.length === 0
          ? h('div', { className: 'tsp-sub' }, 'Запусков пока не было.')
          : runs.slice(0, 30).map((run) => {
              const open = openRunId === run.id
              return h('div', { key: run.id, className: 'tsp-card tsp-run' },
                h('div', { className: 'tsp-run-head', onClick: () => setOpenRunId(open ? null : run.id) },
                  h('span', { className: 'tsp-run-time' }, fmtTime(run.startedAt)),
                  h('span', { className: 'tsp-run-name' }, run.taskName),
                  h('span', { className: 'tsp-run-trigger' }, run.trigger === 'cron' ? '⏰ cron' : run.trigger === 'tool' ? '🛠 tool' : '👆 вручную'),
                  h(Chip, { status: run.status }),
                  h('span', { className: 'tsp-run-dur' }, fmtDur(run.startedAt, run.finishedAt)),
                  run.exitCode !== null && run.exitCode !== undefined ? h('span', { className: 'tsp-run-exit' }, `exit ${run.exitCode}`) : null,
                  run.status === 'running' ? h(Btn, { onClick: (ev) => { ev.stopPropagation(); stopRun(run.id) }, kind: 'tsp-danger' }, '⏹') : null,
                ),
                open ? h('pre', { className: 'tsp-log' }, [
                  run.error ? `ERROR: ${run.error}\n` : '',
                  run.stopReason ? `stop: ${run.stopReason}\n` : '',
                  run.stdoutTail || '',
                  run.stderrTail ? `\n--- stderr ---\n${run.stderrTail}` : '',
                ].join('')) : null,
              )
            }),
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      const style = document.createElement('style')
      style.setAttribute('data-dsh-task-scheduler', '1')
      style.textContent = CSS
      document.head.appendChild(style)
      ctx.effect(() => () => {
        style.remove()
      })

      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'task-scheduler', order: 60, label: () => 'Планировщик задач' },
        (slotProps) => h(Panel, { useSessions: slotProps.useSessions }),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})

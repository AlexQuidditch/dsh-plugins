/**
 * Text stop button in `conversation.session.header.actions`, immediately right
 * of the shipped background-jobs selector (`job-list`, order 20).
 *
 * Live/disabled state tracks `jobsBySession` via `useSessions` with no wire
 * traffic of its own. The only host call is `stop-all` on `/dsh-halt-jobs`,
 * injected as a prop by the registering module (./index.tsx).
 */
import { useEffect, useMemo, useState } from 'react'

import styles from './HaltJobsPill.module.css'

/** Structural slice of one projected background job (the shipped job-list view model). */
export interface HaltJobView {
  id: string
  kind: string
  label: string
  status: string
  startedAt: number
  finishedAt?: number
}

/** Successful `stop-all` payload. */
export interface StopAllValue {
  stopped: number
  remaining: number
}

/** Outcome of one stop click, already flattened for the UI. */
export type StopAllOutcome =
  | { ok: true; value: StopAllValue }
  | { ok: false; message: string }

/** Minimal selector-hook shape over the sessions store. */
export type UseSessions = <T>(
  select: (state: { jobsBySession?: Record<string, readonly HaltJobView[] | undefined> }) => T,
) => T

/** Stable empty list so a jobless session keeps one array identity. */
const NO_JOBS: readonly HaltJobView[] = []

/** A job the registry still holds open; the button enables stop while any exist. */
function isLive(job: HaltJobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

interface HaltJobsPillProps {
  /** Session whose jobs this pill stops; standard prop of the actions slot. */
  sessionId?: string
  /** Sessions-store selector hook; standard prop of the actions slot. */
  useSessions?: UseSessions
  /** Wire call into the host half's `/dsh-halt-jobs` channel (inject share). */
  stopAll: (sessionId: string) => Promise<StopAllOutcome>
}

export function HaltJobsPill({ sessionId = '', useSessions, stopAll }: HaltJobsPillProps) {
  const jobs = useSessions?.((state) => state.jobsBySession?.[sessionId]) ?? NO_JOBS
  const live = useMemo(() => jobs.filter(isLive).length, [jobs])
  const settled = jobs.length - live
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (note === '') return
    const timer = setTimeout(() => setNote(''), 3200)
    return () => clearTimeout(timer)
  }, [note])

  const pending = live > 0
  const canStop = pending && !busy

  let title: string
  if (sessionId === '') title = 'Фоновые задачи недоступны: сессия не выбрана'
  else if (pending) title = 'Остановить все фоновые задачи сессии'
  else if (settled > 0) title = `Активных фоновых задач нет · завершённых: ${settled}`
  else title = 'Фоновых задач нет'

  const onClick = () => {
    if (!canStop) return
    setBusy(true)
    setNote('')
    stopAll(sessionId)
      .then((outcome) => {
        setBusy(false)
        if (outcome.ok) {
          setNote(outcome.value.stopped > 0
            ? `Остановлено задач: ${outcome.value.stopped}`
            : 'Активных задач нет')
        } else {
          setNote(`Не удалось остановить: ${outcome.message}`)
        }
      })
      .catch(() => {
        setBusy(false)
        setNote('Не удалось остановить')
      })
  }

  const className = [
    styles.button,
    pending ? styles.active : styles.idle,
    busy ? styles.busy : '',
    sessionId === '' ? styles.unknown : '',
  ].filter(Boolean).join(' ')

  return (
    canStop ? (
      <span className={styles.wrap}>
        <button
          type="button"
          className={className}
          title={title}
          aria-label={title}
          aria-disabled={canStop ? 'false' : 'true'}
          onClick={onClick}
        >
          Остановить
        </button>
        {note !== '' ? <span className={styles.note} role="status">{note}</span> : null}
      </span>
    ) : null
  )
}

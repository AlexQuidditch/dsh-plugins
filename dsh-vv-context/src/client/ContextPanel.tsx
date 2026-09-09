/**
 * The /context inspector panel.
 *
 * One header button plus a fixed overlay with three sections, all derived from
 * the host token-meter projections read through the framework `useProjection`
 * hook (bound to the projection store, so the panel re-renders on every host
 * commit without manual subscriptions):
 *
 * - Использование — cumulative disjoint buckets of the session;
 * - Давление — last provider-reported prompt size, projected next-request
 *   size, and route capacity; percentage uses the projected figure and the
 *   route's contextWindow, and shows an em dash when either is absent;
 * - Состав — heuristic composition of the next request (system/tools/messages).
 *
 * Estimates are presented as estimates: percentages may exceed 100 and bars
 * only clamp their fill, mirroring the vv contract.
 */
import { useEffect, useRef, useState, type JSX } from 'react'

import { formatPercent, formatTokens, shareOf } from '../format.ts'

import styles from './ContextPanel.module.css'

/** Framework standard kit for a session-scoped slot (runtime-supplied). */
interface PanelProps {
  sessionId?: string
  useProjection?: (key: string) => unknown
}

interface TokenUsageProjection {
  uncachedInputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

interface ContextPressureProjection {
  pressureTokens?: number
  projectedTokens?: number
  contextWindow?: number
}

interface ContextBreakdownProjection {
  systemTokens?: number
  toolsTokens?: number
  messageTokens?: number
}

function Row({ label, value, share, bar }: { label: string; value: string; share: number | undefined; bar?: boolean }): JSX.Element {
  const width = share === undefined ? 0 : Math.min(100, share * 100)
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
      {bar === true && <span className={styles.barTrack}><span className={styles.barFill} style={{ width: `${width}%` }} /></span>}
    </div>
  )
}

export function ContextPanel(props: PanelProps): JSX.Element | null {
  void props.sessionId
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    const onClick = (event: MouseEvent): void => {
      if (panelRef.current !== null && !panelRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  const usage = (props.useProjection === undefined ? undefined : props.useProjection('tokenUsage')) as TokenUsageProjection | undefined
  const pressure = (props.useProjection === undefined ? undefined : props.useProjection('contextPressure')) as ContextPressureProjection | undefined
  const breakdown = (props.useProjection === undefined ? undefined : props.useProjection('contextBreakdown')) as ContextBreakdownProjection | undefined

  const input = usage?.uncachedInputTokens ?? 0
  const output = usage?.outputTokens ?? 0
  const cacheRead = usage?.cacheReadTokens ?? 0
  const cacheWrite = usage?.cacheWriteTokens ?? 0
  const usageTotal = input + output + cacheRead + cacheWrite
  const requestTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  const occupancyShare = shareOf(requestTokens ?? 0, pressure?.contextWindow)
  const breakdownShare = shareOf(
    (breakdown?.systemTokens ?? 0) + (breakdown?.toolsTokens ?? 0) + (breakdown?.messageTokens ?? 0),
    requestTokens,
  )

  return (
    <>
      <button type="button" className={styles.pill} title="Инспектор контекстного окна сессии" onClick={() => setOpen(!open)}>
        ⓘ контекст
      </button>
      {open && (
        <div className={styles.overlay}>
          <div className={styles.panel} ref={panelRef}>
            <div className={styles.header}>
              <span className={styles.title}>Контекст сессии</span>
              <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Закрыть">×</button>
            </div>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Использование</h3>
              <Row label="Вход (без кэша)" value={formatTokens(input)} share={shareOf(input, usageTotal)} />
              <Row label="Кэш-чтение" value={formatTokens(cacheRead)} share={shareOf(cacheRead, usageTotal)} />
              <Row label="Кэш-запись" value={formatTokens(cacheWrite)} share={shareOf(cacheWrite, usageTotal)} />
              <Row label="Вывод" value={formatTokens(output)} share={shareOf(output, usageTotal)} />
              <Row label="Всего" value={formatTokens(usageTotal)} share={undefined} />
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Давление на окно</h3>
              <Row label="Последний запрос" value={pressure === undefined || pressure.pressureTokens === undefined ? '—' : formatTokens(pressure.pressureTokens)} share={undefined} />
              <Row label="Следующий запрос (оценка)" value={pressure === undefined || pressure.projectedTokens === undefined ? '—' : formatTokens(pressure.projectedTokens)} share={undefined} />
              <Row label="Окно модели" value={pressure === undefined || pressure.contextWindow === undefined ? '—' : formatTokens(pressure.contextWindow)} share={undefined} />
              <Row label="Занятость" value={formatPercent(occupancyShare)} share={occupancyShare} bar />
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Состав (оценка)</h3>
              <Row label="System" value={formatTokens(breakdown?.systemTokens ?? 0)} share={shareOf(breakdown?.systemTokens ?? 0, pressure?.projectedTokens ?? pressure?.pressureTokens)} />
              <Row label="Tools" value={formatTokens(breakdown?.toolsTokens ?? 0)} share={shareOf(breakdown?.toolsTokens ?? 0, pressure?.projectedTokens ?? pressure?.pressureTokens)} />
              <Row label="Messages" value={formatTokens(breakdown?.messageTokens ?? 0)} share={shareOf(breakdown?.messageTokens ?? 0, pressure?.projectedTokens ?? pressure?.pressureTokens)} />
              <Row label="Доля от запроса" value={formatPercent(breakdownShare)} share={breakdownShare} bar />
            </section>

            <div className={styles.footer}>Оценки не претендуют на точную токенизацию провайдера; прочерк — честное «нет данных».</div>
          </div>
        </div>
      )}
    </>
  )
}

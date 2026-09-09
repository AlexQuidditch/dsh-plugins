/**
 * The cache pill component.
 *
 * Reads the session's tokenUsage projection through the framework hook
 * (`useProjection`) and renders one compact pill. The hook is bound to the
 * projection store, so the pill re-renders whenever the host commits a new
 * value — no manual subscription, no polling.
 */
import type { JSX } from 'react'

import { cacheHitRate, formatHitRate, hitRateTier, type TokenUsageProjection } from '../format.ts'

import styles from './CachePill.module.css'

/** Framework standard kit for a session-scoped slot (runtime-supplied). */
interface PillProps {
  sessionId?: string
  useProjection?: (key: string) => unknown
}

export function CachePill(props: PillProps): JSX.Element | null {
  void props.sessionId
  const raw = props.useProjection === undefined ? undefined : props.useProjection('tokenUsage')
  const usage = raw as TokenUsageProjection | undefined
  const rate = usage === undefined
    ? undefined
    : cacheHitRate({
        inputTokens: usage.uncachedInputTokens ?? 0,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      })

  return <span className={`${styles.pill} ${styles[hitRateTier(rate)]}`} title="Кэш-попадание сессии: cacheRead / (cacheRead + cacheWrite + input)">{formatHitRate(rate)}</span>
}

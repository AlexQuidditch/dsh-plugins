/**
 * dsh-vv-peak-hours, host half.
 *
 * vv PeakHoursPlugin port: a `llm/stream` waterfall listener (prepended and
 * global) that gates model calls by provider peak-price schedules.
 *
 * - soft (default): the call proceeds and a warning lands in the plugin log.
 * - hard: the call is rejected with a PEAK_HOURS_BLOCK error before any
 *   adapter work — the message stays in history and the failure renders as a
 *   regular error entry, mirroring the vv contract.
 *
 * Schedules match providers, not models; unknown providers and malformed
 * windows fail open (see ./schedule.ts). The decision runs once per stream
 * call on the options the loop already assembled, so it adds no per-chunk cost.
 */
import type { Context } from '@deepseek-ai/cordis'
import { decidePeak, type PeakSchedules } from './schedule.js'

export const name = 'vv-peak-hours'

/** Bundle config (see cordis.patch.yml). */
export interface VvPeakHoursConfig {
  /** Whether the gate is active. Default: true. */
  enabled?: boolean
  /** Global mode; a provider schedule may override it. Default: 'soft'. */
  mode?: 'soft' | 'hard'
  /** Provider schedules, keyed by provider id. */
  schedules?: PeakSchedules
}

/** Minimal structural shape of one llm/stream payload. */
interface GenerateOptionsLike {
  provider?: unknown
}

// The runtime declares this event in dsh-llm; declare it locally so the bundle
// stays installable without registry-absent runtime versions.
declare module '@deepseek-ai/cordis' {
  interface Events {
    'llm/stream'(options: GenerateOptionsLike, next: () => unknown): unknown
  }
}

export function apply(ctx: Context, config: VvPeakHoursConfig = {}): void {
  if (config.enabled === false) return
  const globalMode = config.mode ?? 'soft'
  const schedules = config.schedules ?? {}

  ctx.on('llm/stream', function peakGate(options: GenerateOptionsLike, next: () => unknown) {
    const provider = typeof options.provider === 'string' ? options.provider : ''
    if (provider === '') return next()
    const decision = decidePeak(provider, new Date(), schedules)
    for (const broken of decision.broken) {
      ctx.logger.warn('[vv-peak-hours] schedule disabled (fail-open): %s', broken)
    }
    if (!decision.inPeak) return next()

    const mode = schedules[provider]?.mode ?? globalMode
    if (mode === 'hard') {
      throw new Error(`PEAK_HOURS_BLOCK: provider "${provider}" is in peak hours until ${decision.until} (elevated pricing); retry outside the window or switch the provider`)
    }
    ctx.logger.warn('[vv-peak-hours] soft: provider "%s" is in peak hours until %s · elevated pricing', provider, decision.until)
    return next()
  }, { global: true, prepend: true })
}

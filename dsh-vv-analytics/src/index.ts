/**
 * dsh-vv-analytics, host half.
 *
 * vv AnalyticsPlugin port, local-only: every completed model step that reports
 * provider usage is appended as one JSONL line to
 * `<dir>/usage-YYYY-MM.jsonl` (default dir: `$DSH_HOME/vv-analytics`). Nothing
 * ever leaves the machine.
 *
 * The seam is the `llm/stream` waterfall: the listener wraps the stream, lets
 * every chunk flow through untouched, captures the terminal usage chunk, and
 * writes the record after the stream settles. The record schema is a stable
 * contract consumed by the `vvoc analytics cache-hit-rate` CLI.
 *
 * The browser half (./client) renders the live cache pill from the host's
 * tokenUsage projection; the recorder and the pill share ./format.ts.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { UsageBuckets } from './format.js'

// Re-exported for the vvoc CLI and the activation test (the client preset
// bundles ./format.ts into lib/index.js, so these must ride the host entry).
export { cacheHitRate, formatHitRate, hitRateTier } from './format.js'
export type { UsageBuckets, TokenUsageProjection } from './format.js'

export const name = 'vv-analytics'

/** Bundle config (see cordis.patch.yml). */
export interface VvAnalyticsConfig {
  /** Whether recording is active. Default: true. */
  enabled?: boolean
  /** JSONL directory; default: $DSH_HOME/vv-analytics (fallback ~/.dsh/vv-analytics). */
  dir?: string
}

/** One durable JSONL record — the contract `vvoc analytics` reads. */
export interface UsageRecord extends UsageBuckets {
  ts: string
  sessionId: string | null
  provider: string
  model: string
  purpose: null | 'compaction' | 'session-title'
}

/** Minimal structural llm/stream payload. */
interface GenerateOptionsLike {
  provider?: unknown
  model?: unknown
  sessionId?: unknown
  purpose?: unknown
}

/** Minimal structural stream chunk carrying usage. */
interface StreamChunkLike {
  type?: unknown
  usage?: {
    inputTokens?: unknown
    outputTokens?: unknown
    cacheReadTokens?: unknown
    cacheWriteTokens?: unknown
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function monthOf(now: Date): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function apply(ctx: Context, config: VvAnalyticsConfig = {}): void {
  if (config.enabled === false) return
  const dir = config.dir ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'vv-analytics')

  // The listener is cast to never: the real 'llm/stream' typing comes from
  // dsh-llm (transitively present in the client devDeps), and a local
  // augmentation would merge overloads whose chunk types we cannot satisfy
  // without importing the runtime packages. The listener only reads options
  // and streams chunks through untouched.
  ctx.on('llm/stream', function usageRecorder(options: GenerateOptionsLike, next: () => AsyncIterable<StreamChunkLike>) {
    const upstream = next()

    return (async function* wrapped(): AsyncIterable<StreamChunkLike> {
      let captured: UsageBuckets | undefined
      try {
        for await (const chunk of upstream) {
          if (chunk !== null && typeof chunk === 'object' && chunk.type === 'usage' && chunk.usage !== undefined) {
            captured = {
              inputTokens: numberOr(chunk.usage.inputTokens, 0),
              outputTokens: numberOr(chunk.usage.outputTokens, 0),
              cacheReadTokens: numberOr(chunk.usage.cacheReadTokens, 0),
              cacheWriteTokens: numberOr(chunk.usage.cacheWriteTokens, 0),
            }
          }
          yield chunk
        }
      } finally {
        if (captured !== undefined) {
          const now = new Date()
          const record: UsageRecord = {
            ts: now.toISOString(),
            sessionId: typeof options.sessionId === 'string' ? options.sessionId : null,
            provider: typeof options.provider === 'string' ? options.provider : '',
            model: typeof options.model === 'string' ? options.model : '',
            purpose: options.purpose === 'compaction' || options.purpose === 'session-title' ? options.purpose : null,
            ...captured,
          }
          try {
            mkdirSync(dir, { recursive: true })
            appendFileSync(join(dir, `usage-${monthOf(now)}.jsonl`), `${JSON.stringify(record)}\n`)
          } catch (error) {
            ctx.logger.warn('[vv-analytics] failed to write record: %s', error instanceof Error ? error.message : String(error))
          }
        }
      }
    })() as never
  }, { global: true })
}

/**
 * vvoc analytics: aggregate the dsh-vv-analytics JSONL into cache-hit-rate
 * tables. The record contract is fixed by that bundle (see its README):
 * one object per completed model step with input/cacheRead/cacheWrite/output
 * token counts and attribution fields.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyticsDir } from './paths.js'

/** One JSONL record as written by dsh-vv-analytics. */
export interface UsageRecord {
  ts: string
  sessionId: string | null
  provider: string
  model: string
  purpose: null | 'compaction' | 'session-title'
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

/** One aggregation bucket. */
export interface Bucket {
  key: string
  steps: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Token-weighted hit rate, undefined when no cache-eligible prompt traffic. */
  hitRate: number | undefined
  /** Share of steps whose provider reported any cache token at all. */
  coverage: number
}

export type GroupBy = 'day' | 'week' | 'month' | 'session' | 'model' | 'provider'

function readRecords(dir: string, since: string | undefined): UsageRecord[] {
  const records: UsageRecord[] = []
  const sinceMs = since === undefined ? 0 : parseSince(since)
  let names: string[] = []
  try {
    names = readdirSync(dir).filter((name) => /^usage-\d{4}-\d{2}\.jsonl$/.test(name))
  } catch {
    return records
  }
  for (const name of names) {
    let raw = ''
    try {
      raw = readFileSync(join(dir, name), 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      try {
        const record = JSON.parse(line) as UsageRecord
        if (typeof record.ts === 'string' && (sinceMs === 0 || Date.parse(record.ts) >= sinceMs)) records.push(record)
      } catch {
        // skip corrupt lines; analytics stays best-effort
      }
    }
  }
  return records
}

/** Parse --since: Nd/Nw/Nm or YYYY-MM-DD; anything else = epoch 0. */
export function parseSince(value: string | undefined): number {
  if (value === undefined) return 0
  const rel = /^(\d+)([dwm])$/.exec(value)
  if (rel !== null) {
    const amount = Number(rel[1])
    const unitMs = rel[2] === 'd' ? 86_400_000 : rel[2] === 'w' ? 604_800_000 : 2_592_000_000
    return Date.now() - amount * unitMs
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function bucketKey(record: UsageRecord, groupBy: GroupBy): string {
  const date = new Date(record.ts)
  if (groupBy === 'day') return record.ts.slice(0, 10)
  if (groupBy === 'week') {
    const start = new Date(date)
    start.setUTCHours(0, 0, 0, 0)
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
    return start.toISOString().slice(0, 10)
  }
  if (groupBy === 'month') return record.ts.slice(0, 7)
  if (groupBy === 'session') return record.sessionId ?? '(нет сессии)'
  if (groupBy === 'model') return record.model || '(нет модели)'
  return record.provider || '(нет провайдера)'
}

/** Aggregate records into one bucket per group key, insertion-ordered. */
export function aggregate(records: UsageRecord[], groupBy: GroupBy): Bucket[] {
  const byKey = new Map<string, Bucket>()
  for (const record of records) {
    const key = bucketKey(record, groupBy)
    let bucket = byKey.get(key)
    if (bucket === undefined) {
      bucket = { key, steps: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, hitRate: undefined, coverage: 0 }
      byKey.set(key, bucket)
    }
    bucket.steps += 1
    bucket.inputTokens += record.inputTokens
    bucket.cacheReadTokens += record.cacheReadTokens
    bucket.cacheWriteTokens += record.cacheWriteTokens
    if (record.cacheReadTokens > 0 || record.cacheWriteTokens > 0) bucket.coverage += 1
  }
  for (const bucket of byKey.values()) {
    const prompt = bucket.cacheReadTokens + bucket.cacheWriteTokens + bucket.inputTokens
    bucket.hitRate = prompt <= 0 ? undefined : bucket.cacheReadTokens / prompt
    bucket.coverage = bucket.steps === 0 ? 0 : bucket.coverage / bucket.steps
  }
  return [...byKey.values()]
}

/** Table the CLI prints; also the shape of --json output. */
export function analyticsTable(dir: string, groupBy: GroupBy, since: string | undefined): { rows: Bucket[]; totals: Bucket } {
  const rows = aggregate(readRecords(dir, since), groupBy)
  const totals: Bucket = { key: 'итого', steps: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, hitRate: undefined, coverage: 0 }
  for (const row of rows) {
    totals.steps += row.steps
    totals.inputTokens += row.inputTokens
    totals.cacheReadTokens += row.cacheReadTokens
    totals.cacheWriteTokens += row.cacheWriteTokens
    totals.coverage += row.coverage * row.steps
  }
  const prompt = totals.cacheReadTokens + totals.cacheWriteTokens + totals.inputTokens
  totals.hitRate = prompt <= 0 ? undefined : totals.cacheReadTokens / prompt
  totals.coverage = totals.steps === 0 ? 0 : totals.coverage / totals.steps
  return { rows, totals }
}

export { analyticsDir }

/**
 * vvoc analytics tests: fixed fixtures over the dsh-vv-analytics JSONL
 * contract; aggregation, grouping, --since parsing, and the CLI table path.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const work = mkdtempSync(join(tmpdir(), 'vvoc-analytics-'))
process.env.VVOC_TEST_DSH_HOME = work
const vvAnalytics = join(work, 'vv-analytics')
mkdirSync(vvAnalytics, { recursive: true })

const { aggregate, analyticsTable, parseSince } = await import('../lib/analytics.js')

const RECORDS = [
  { ts: '2026-09-09T10:00:00.000Z', sessionId: 's1', provider: 'deepseek', model: 'deepseek-v4-pro', purpose: null, inputTokens: 100, cacheReadTokens: 800, cacheWriteTokens: 100, outputTokens: 40 },
  { ts: '2026-09-09T11:00:00.000Z', sessionId: 's2', provider: 'deepseek', model: 'deepseek-v4-flash', purpose: null, inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60 },
  { ts: '2026-09-10T09:00:00.000Z', sessionId: 's1', provider: 'other', model: 'm', purpose: null, inputTokens: 300, cacheReadTokens: 700, cacheWriteTokens: 0, outputTokens: 20 },
]

test('aggregate по day: hit rate и coverage', () => {
  const rows = aggregate(RECORDS, 'day')
  assert.equal(rows.length, 2)
  const day1 = rows.find((row) => row.key === '2026-09-09')
  assert.ok(day1 !== undefined)
  // (800)/(800+100+100+1000) = 800/2000 = 0.4
  assert.ok(Math.abs((day1.hitRate ?? 0) - 0.4) < 1e-9)
  // coverage: 1 шаг из 2 с кэш-токенами
  assert.ok(Math.abs(day1.coverage - 0.5) < 1e-9)
})

test('aggregate по model: три группы', () => {
  const rows = aggregate(RECORDS, 'model')
  assert.equal(rows.length, 3)
})

test('JSONL из каталога читается; totals токенно-взвешенные', () => {
  const dir = vvAnalytics
  writeFileSync(join(dir, 'usage-2026-09.jsonl'), RECORDS.map((record) => JSON.stringify(record)).join('\n') + '\n', { flag: 'a' })
  const { rows, totals } = analyticsTable(dir, 'provider', undefined)
  assert.equal(rows.length, 2)
  assert.equal(totals.steps, 3)
  // (800+700)/(800+100+100+1000+300+700) = 1500/3000 = 0.5
  assert.ok(Math.abs((totals.hitRate ?? 0) - 0.5) < 1e-9)
  rmSync(join(dir, 'usage-2026-09.jsonl'), { force: true })
})

test('parseSince: Nd/Nw/Nm/дата/мусор', () => {
  const day = 86_400_000
  const now = Date.now()
  assert.ok(Math.abs(parseSince('30d') - (now - 30 * day)) < 60_000)
  assert.ok(Math.abs(parseSince('2w') - (now - 14 * day)) < 60_000)
  assert.equal(parseSince('2026-09-01'), Date.parse('2026-09-01'))
  assert.equal(parseSince('мусор'), 0)
  assert.equal(parseSince(undefined), 0)
})

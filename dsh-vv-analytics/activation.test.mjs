/**
 * Изолированный тест dsh-vv-analytics (после сборки).
 *
 * 1. Юнит-кейсы format-модуля.
 * 2. Рекордер: монтируем плагин с tmp-каталогом, гоняем llm/stream водопад с
 *    фейковым потоком (с usage и без), проверяем JSONL. Живой DSH не трогается.
 *
 * Запуск: node activation.test.mjs   (после pnpm run build)
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from './lib/index.js'
import { cacheHitRate, formatHitRate, hitRateTier } from './lib/index.js'

let failed = 0
function check(name, condition, detail = '') {
  if (condition) { console.log('ok  -', name); return }
  failed += 1
  console.log('FAIL -', name, detail)
}

// ── format ──────────────────────────────────────────────────────────────────
check('rate: no prompt traffic → n/a', cacheHitRate({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }) === undefined)
check('rate: 800/1000 → 0.8', Math.abs((cacheHitRate({ inputTokens: 100, cacheReadTokens: 800, cacheWriteTokens: 100 }) ?? 0) - 0.8) < 1e-9)
check('rate: full cache → 1', cacheHitRate({ inputTokens: 0, cacheReadTokens: 500, cacheWriteTokens: 0 }) === 1)
check('format: n/a', formatHitRate(undefined) === 'кэш n/a')
check('format: 84%', formatHitRate(0.84) === 'кэш 84%')
check('tier: neutral/red/yellow/green',
  hitRateTier(undefined) === 'neutral' && hitRateTier(0.1) === 'red' && hitRateTier(0.6) === 'yellow' && hitRateTier(0.9) === 'green')

// ── recorder ────────────────────────────────────────────────────────────────
const work = mkdtempSync(join(tmpdir(), 'vv-analytics-test-'))
try {
  const root = new Context()
  await root.plugin(plugin, { dir: work, enabled: true })

  async function* withUsage() {
    yield { type: 'text', text: 'hello' }
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 40, cacheReadTokens: 800, cacheWriteTokens: 100 } }
  }
  async function* withoutUsage() {
    yield { type: 'text', text: 'no usage' }
  }

  const opts = { provider: 'deepseek', model: 'deepseek-v4-pro', sessionId: 'sess-1', purpose: null }

  const streamA = await root.waterfall({}, 'llm/stream', opts, () => withUsage())
  for await (const _chunk of streamA ?? []) { void _chunk }
  const streamB = await root.waterfall({}, 'llm/stream', opts, () => withoutUsage())
  for await (const _chunk of streamB ?? []) { void _chunk }

  const files = readdirSync(work)
  check('one monthly file created', files.length === 1, files.join(','))
  const raw = readFileSync(join(work, files[0]), 'utf8').trim()
  const lines = raw.split('\n')
  check('one record line (usage-less step not recorded)', lines.length === 1, raw)
  const record = JSON.parse(lines[0])
  check('record fields', record.sessionId === 'sess-1' && record.provider === 'deepseek' && record.model === 'deepseek-v4-pro' && record.purpose === null)
  check('record buckets', record.inputTokens === 100 && record.outputTokens === 40 && record.cacheReadTokens === 800 && record.cacheWriteTokens === 100)
  check('record ts is ISO', !Number.isNaN(Date.parse(record.ts)))

  await root.fiber.dispose()

  // Выключенный рекордер ничего не пишет.
  const offWork = mkdtempSync(join(tmpdir(), 'vv-analytics-off-'))
  const offRoot = new Context()
  await offRoot.plugin(plugin, { dir: offWork, enabled: false })
  const streamC = await offRoot.waterfall({}, 'llm/stream', opts, () => withUsage())
  for await (const _chunk of streamC ?? []) { void _chunk }
  await offRoot.fiber.dispose()
  check('disabled recorder writes nothing', readdirSync(offWork).length === 0)
  rmSync(offWork, { recursive: true, force: true })
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failed > 0) { console.log(`FAILED: ${failed}`); process.exit(1) }
console.log('OK: format-модуль и JSONL-рекордер работают')

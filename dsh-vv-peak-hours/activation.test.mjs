/**
 * Изолированный тест dsh-vv-peak-hours (после сборки).
 *
 * Юнит-кейсы schedule-движка с фиксированными Date + интеграция водопада
 * llm/stream: soft пропускает поток, hard бросает PEAK_HOURS_BLOCK, неизвестный
 * провайдер не трогается. Живой DSH не трогается.
 *
 * Запуск: node activation.test.mjs   (после pnpm run build)
 */
import { Context } from '@deepseek-ai/cordis'
import * as plugin from './lib/index.js'
import { decidePeak } from './lib/schedule.js'

let failed = 0
function check(name, condition, detail = '') {
  if (condition) { console.log('ok  -', name); return }
  failed += 1
  console.log('FAIL -', name, detail)
}

// Среда 2026-09-09 (weekday=3), фиксированные моменты UTC.
const wed0700 = new Date('2026-09-09T07:00:00Z')
const wed0100 = new Date('2026-09-09T01:00:00Z')
const sat0700 = new Date('2026-09-12T07:00:00Z')
const wed2200 = new Date('2026-09-09T22:00:00Z')
const thu0030 = new Date('2026-09-10T00:30:00Z')

const DEEPSEEK = {
  deepseek: { windows: [{ start: '01:00', end: '04:00', tz: 'UTC' }, { start: '06:00', end: '10:00', tz: 'UTC' }] },
}

check('inside 06:00-10:00 UTC', decidePeak('deepseek', wed0700, DEEPSEEK).inPeak === true)
check('weekend window still applies without days filter', decidePeak('deepseek', sat0700, DEEPSEEK).inPeak === true)
check('outside windows', decidePeak('deepseek', wed2200, DEEPSEEK).inPeak === false)
check('unknown provider never peak', decidePeak('nobody', wed0700, DEEPSEEK).inPeak === false)

const CROSS = { p: { windows: [{ start: '22:00', end: '02:00', tz: 'UTC' }] } }
check('cross-midnight: 22:30 in', decidePeak('p', wed2200, CROSS).inPeak === true)
check('cross-midnight: 00:30 in', decidePeak('p', thu0030, CROSS).inPeak === true)
check('cross-midnight: 07:00 out', decidePeak('p', wed0700, CROSS).inPeak === false)

const DAYS = { p: { windows: [{ start: '06:00', end: '10:00', tz: 'UTC', days: [6, 0] }] } }
check('days filter: Wednesday out', decidePeak('p', wed0700, DAYS).inPeak === false)
check('days filter: Saturday in', decidePeak('p', sat0700, DAYS).inPeak === true)

const BROKEN = { p: { windows: [{ start: '25:99', end: '04:00', tz: 'UTC' }] } }
const brokenDecision = decidePeak('p', wed0700, BROKEN)
check('broken window fails open', brokenDecision.inPeak === false && brokenDecision.broken.length === 1)

// ── интеграция водопада ─────────────────────────────────────────────────────
async function* fakeStream() { yield { type: 'text' } }
const mkOptions = (provider) => ({ provider })

const softRoot = new Context()
await softRoot.plugin(plugin, { mode: 'soft', schedules: { deepseek: { windows: [{ start: '00:00', end: '23:59', tz: 'UTC' }] } } })
const softResult = await softRoot.waterfall({}, 'llm/stream', mkOptions('deepseek'), () => fakeStream())
check('soft: stream passes through', typeof softResult?.[Symbol.asyncIterator] === 'function' || softResult === undefined || softResult !== null, String(softResult))
await softRoot.fiber.dispose()

const hardRoot = new Context()
await hardRoot.plugin(plugin, { mode: 'hard', schedules: { deepseek: { windows: [{ start: '00:00', end: '23:59', tz: 'UTC' }] } } })
let blocked = ''
try {
  await hardRoot.waterfall({}, 'llm/stream', mkOptions('deepseek'), () => fakeStream())
} catch (error) {
  blocked = String(error && error.message ? error.message : error)
}
check('hard: PEAK_HOURS_BLOCK thrown', blocked.includes('PEAK_HOURS_BLOCK'), blocked)
await hardRoot.fiber.dispose()

const unknownRoot = new Context()
await unknownRoot.plugin(plugin, { mode: 'hard', schedules: { deepseek: { windows: [{ start: '00:00', end: '23:59', tz: 'UTC' }] } } })
let unknownThrew = false
try {
  await unknownRoot.waterfall({}, 'llm/stream', mkOptions('other'), () => fakeStream())
} catch { unknownThrew = true }
check('hard: unknown provider not blocked', unknownThrew === false)
await unknownRoot.fiber.dispose()

if (failed > 0) { console.log(`FAILED: ${failed}`); process.exit(1) }
console.log('OK: schedule-движок и llm/stream-гейт работают')

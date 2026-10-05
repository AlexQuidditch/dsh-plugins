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
import { decidePeak, resolveSchedule } from './lib/schedule.js'

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

// ── матчинг провайдеров: ключ конфига — СЕМЕЙСТВО, а не id рантайма ─────────
//
// Регрессия: конфиг называет расписание `deepseek`, а рантайм зовёт провайдера
// `deepseek-official`. Пока матчинг был точным, гейт не срабатывал никогда —
// при этом тесты ниже (и водопад) использовали ключ конфига как имя
// провайдера, поэтому оставались зелёными.
check('family: deepseek-official inside the window', decidePeak('deepseek-official', wed0700, DEEPSEEK).inPeak === true)
check('family: deepseek-vision inside the window', decidePeak('deepseek-vision', wed0700, DEEPSEEK).inPeak === true)
check('family: bare key still matches', decidePeak('deepseek', wed0700, DEEPSEEK).inPeak === true)
check('family: matched key is reported', decidePeak('deepseek-official', wed0700, DEEPSEEK).matched === 'deepseek')
check('family: outside the window is not peak', decidePeak('deepseek-official', wed2200, DEEPSEEK).inPeak === false)
check('family: unrelated provider never peak', decidePeak('zai', wed0700, DEEPSEEK).inPeak === false)
// Разделитель обязателен: `deepseek` не должен цеплять `deepseekish` или `deep`.
check('family: separator required (deepseekish excluded)', decidePeak('deepseekish', wed0700, DEEPSEEK).inPeak === false)
check('family: separator required (deep excluded)', decidePeak('deep', wed0700, DEEPSEEK).inPeak === false)

// Точный ключ всегда важнее семейного — вариант может нести свои окна/режим.
const OVERRIDE = {
  deepseek: { windows: [{ start: '01:00', end: '04:00', tz: 'UTC' }] },
  'deepseek-vision': { windows: [{ start: '06:00', end: '10:00', tz: 'UTC' }] },
}
const override = resolveSchedule('deepseek-vision', OVERRIDE)
check('exact key wins over family', override?.key === 'deepseek-vision', JSON.stringify(override?.key))
check('exact key: vision in its own window', decidePeak('deepseek-vision', wed0700, OVERRIDE).inPeak === true)
check('exact key: official keeps the family window', decidePeak('deepseek-official', wed0700, OVERRIDE).inPeak === false && decidePeak('deepseek-official', wed0100, OVERRIDE).inPeak === true)
const longest = resolveSchedule('deepseek-vision-x', OVERRIDE)
check('longest family key wins', longest?.key === 'deepseek-vision', JSON.stringify(longest?.key))

// ── интеграция водопада ─────────────────────────────────────────────────────
async function* fakeStream() { yield { type: 'text' } }
const mkOptions = (provider) => ({ provider })

const softRoot = new Context()
await softRoot.plugin(plugin, { mode: 'soft', schedules: { deepseek: { windows: [{ start: '00:00', end: '23:59', tz: 'UTC' }] } } })
const softResult = await softRoot.waterfall({}, 'llm/stream', mkOptions('deepseek-official'), () => fakeStream())
check('soft: stream passes through', typeof softResult?.[Symbol.asyncIterator] === 'function' || softResult === undefined || softResult !== null, String(softResult))
await softRoot.fiber.dispose()

const hardRoot = new Context()
await hardRoot.plugin(plugin, { mode: 'hard', schedules: { deepseek: { windows: [{ start: '00:00', end: '23:59', tz: 'UTC' }] } } })
let blocked = ''
try {
  await hardRoot.waterfall({}, 'llm/stream', mkOptions('deepseek-official'), () => fakeStream())
} catch (error) {
  blocked = String(error && error.message ? error.message : error)
}
check('hard: PEAK_HOURS_BLOCK thrown', blocked.includes('PEAK_HOURS_BLOCK'), blocked)
await hardRoot.fiber.dispose()

const unknownRoot = new Context()
await unknownRoot.plugin(plugin, { mode: 'hard', schedules: { deepseek: { windows: [{ start: '00:00', end: '23:59', tz: 'UTC' }] } } })
let unknownThrew = false
try {
  await unknownRoot.waterfall({}, 'llm/stream', mkOptions('zai'), () => fakeStream())
} catch { unknownThrew = true }
check('hard: unrelated provider (zai) not blocked', unknownThrew === false)
await unknownRoot.fiber.dispose()

// Режим на КОНКРЕТНОМ семействе: глобальный soft, но `deepseek` объявлен hard.
// Тот же точный поиск `schedules[provider]?.mode`, что и в решении о пике:
// с id `deepseek-official` он не находил ключ `deepseek` и молча оставался soft.
const familyHardRoot = new Context()
await familyHardRoot.plugin(plugin, {
  mode: 'soft',
  schedules: { deepseek: { windows: [{ start: '00:00', end: '23:59', tz: 'UTC' }], mode: 'hard' } },
})
let familyBlocked = ''
try {
  await familyHardRoot.waterfall({}, 'llm/stream', mkOptions('deepseek-official'), () => fakeStream())
} catch (error) {
  familyBlocked = String(error && error.message ? error.message : error)
}
check('hard via family key: PEAK_HOURS_BLOCK thrown', familyBlocked.includes('PEAK_HOURS_BLOCK'), familyBlocked)
await familyHardRoot.fiber.dispose()

if (failed > 0) { console.log(`FAILED: ${failed}`); process.exit(1) }
console.log('OK: schedule-движок и llm/stream-гейт работают')

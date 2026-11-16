/**
 * Isolated tests for the pure schedule engine (`lib/schedule.js`).
 *
 * No cordis, no IO: fixed instants + hand-written schedules. Run with
 * `node tests/schedule.test.mjs`.
 */
import {
  allWindows,
  decidePeak,
  normalizeSchedules,
  overviewFor,
  peakEndsAt,
  peakOverview,
  nextPeakStartAt,
  resolveEffective,
  resolveSchedule,
  secondsToNextBoundary,
  windowContains,
} from '../lib/schedule.js'

let failed = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log('ok  -', name)
    return
  }
  failed += 1
  console.log('FAIL -', name, detail)
}

const ALL_DAY = [{ start: '00:00', end: '23:59', tz: 'UTC' }]
const DEEPSEEK = {
  deepseek: {
    windows: [
      { start: '01:00', end: '04:00', tz: 'UTC' },
      { start: '06:00', end: '10:00', tz: 'UTC' },
    ],
  },
}
const wed0700 = new Date('2026-09-09T07:00:00Z')
const sun0700 = new Date('2026-09-13T07:00:00Z')

// ── family matching ─────────────────────────────────────────────────────────
check('family: deepseek-official matches key deepseek', decidePeak('deepseek-official', wed0700, DEEPSEEK).inPeak === true)
check('family: deepseek-vision matches key deepseek', decidePeak('deepseek-vision', wed0700, DEEPSEEK).inPeak === true)
check('family: unrelated provider never peak', decidePeak('zai', wed0700, DEEPSEEK).inPeak === false)
check('family: separator required', decidePeak('deepseekish', wed0700, DEEPSEEK).inPeak === false)
check('family: exact id beats family', resolveSchedule('deepseek-vision', { deepseek: { windows: ALL_DAY }, 'deepseek-vision': { windows: ALL_DAY } })?.key === 'deepseek-vision')

// ── model-aware windows ─────────────────────────────────────────────────────
const MODELS = {
  deepseek: {
    windows: [{ start: '06:00', end: '10:00', tz: 'UTC' }],
    models: {
      'deepseek-reasoner': { windows: [{ start: '00:00', end: '23:59', tz: 'UTC' }] },
      '*': { windows: [{ start: '09:00', end: '12:00', tz: 'UTC' }] },
    },
  },
}
check('models: exact model rule wins', decidePeak('deepseek-account', 'deepseek-reasoner', wed0700, MODELS).inPeak === true)
check('models: exact model rule replaces family windows', decidePeak('deepseek-account', 'deepseek-reasoner', new Date('2026-09-09T11:00:00Z'), MODELS).inPeak === true)
check('models: wildcard rule covers other models', decidePeak('deepseek-account', 'deepseek-flash', new Date('2026-09-09T10:00:00Z'), MODELS).inPeak === true)
check('models: family windows for unmatched model', decidePeak('deepseek-account', 'deepseek-flash', wed0700, MODELS).inPeak === false)
check('models: effective carries modelKey', resolveEffective('deepseek-account', 'deepseek-reasoner', MODELS)?.modelKey === 'deepseek-reasoner')
check('models: effective discount defaults to 0.5', resolveEffective('deepseek-account', 'deepseek-flash', MODELS)?.offPeakDiscount === 0.5)

// ── weekday restrictions ────────────────────────────────────────────────────
const WEEKDAYS = { deepseek: { windows: [{ start: '06:00', end: '10:00', tz: 'UTC', days: [1, 2, 3, 4, 5] }] } }
check('days: Wednesday in', decidePeak('deepseek-official', wed0700, WEEKDAYS).inPeak === true)
check('days: Sunday out', decidePeak('deepseek-official', sun0700, WEEKDAYS).inPeak === false)

// ── boundaries: peak end / next start ──────────────────────────────────────
const end = peakEndsAt('deepseek-official', undefined, wed0700, DEEPSEEK)
check('peakEndsAt: 10:00 UTC', end instanceof Date && end.toISOString() === '2026-09-09T10:00:00.000Z', end?.toISOString())
check('peakEndsAt: null outside peak', peakEndsAt('deepseek-official', undefined, new Date('2026-09-09T00:30:00Z'), DEEPSEEK) === null)
const start = nextPeakStartAt('deepseek-official', undefined, new Date('2026-09-09T00:30:00Z'), DEEPSEEK)
check('nextPeakStartAt: 01:00 UTC', start instanceof Date && start.toISOString() === '2026-09-09T01:00:00.000Z', start?.toISOString())
const weekendStart = nextPeakStartAt('deepseek-official', undefined, new Date('2026-09-11T11:00:00Z'), WEEKDAYS)
check('nextPeakStartAt: crosses the weekend to Monday 06:00', weekendStart?.toISOString() === '2026-09-14T06:00:00.000Z', weekendStart?.toISOString())

const overview = overviewFor('deepseek-official', 'deepseek-vision', wed0700, DEEPSEEK)
check('overviewFor: peak + until + countdown', overview.known === true && overview.inPeak === true && overview.untilAt?.toISOString() === '2026-09-09T10:00:00.000Z' && overview.secondsToChange === 3 * 3600, JSON.stringify(overview))
const before = overviewFor('deepseek-official', undefined, new Date('2026-09-09T00:30:00Z'), DEEPSEEK)
check('overviewFor: before peak points at the start', before.inPeak === false && before.nextStartAt?.toISOString() === '2026-09-09T01:00:00.000Z' && before.secondsToChange === 1800, JSON.stringify(before))
check('overviewFor: unknown provider is not an error', overviewFor('nope', undefined, wed0700, DEEPSEEK).known === false)

// ── midnight-crossing windows ──────────────────────────────────────────────
const NIGHT = { local: { windows: [{ start: '23:00', end: '02:00', tz: 'UTC' }] } }
check('crossing: 23:30 inside', windowContains(NIGHT.local.windows[0], new Date('2026-09-09T23:30:00Z')) === true)
check('crossing: 01:30 inside', windowContains(NIGHT.local.windows[0], new Date('2026-09-09T01:30:00Z')) === true)
check('crossing: 02:00 outside', windowContains(NIGHT.local.windows[0], new Date('2026-09-09T02:00:00Z')) === false)
const nightEnd = peakEndsAt('local', undefined, new Date('2026-09-09T23:30:00Z'), NIGHT)
check('crossing: peak end is 02:00 next day', nightEnd?.toISOString() === '2026-09-10T02:00:00.000Z', nightEnd?.toISOString())

// ── DST honesty (America/New_York spring forward 2026-03-08) ───────────────
const DST = { us: { windows: [{ start: '01:30', end: '03:30', tz: 'America/New_York' }] } }
// 2026-03-08 02:00 EST does not exist locally; the window still ends at 03:30 EDT.
const dstEnd = peakEndsAt('us', undefined, new Date('2026-03-08T06:30:00Z'), DST)
check('DST: spring-forward end is 03:30 EDT (07:30 UTC)', dstEnd?.toISOString() === '2026-03-08T07:30:00.000Z', dstEnd?.toISOString())

// ── normalizeSchedules ──────────────────────────────────────────────────────
const normalized = normalizeSchedules({
  good: { windows: [{ start: '23:00', end: '02:00', tz: 'UTC', days: [5, 1, 1] }] },
  bad: { windows: [{ start: '25:00', end: '99:99' }] },
  noWindows: {},
  modelsOnly: { windows: [], models: { 'm-1': { windows: [{ start: '10:00', end: '11:00', tz: 'UTC' }] } } },
})
check('normalize: valid entry kept', normalized.schedules.good?.windows.length === 1)
check('normalize: days sorted and deduped', JSON.stringify(normalized.schedules.good?.windows[0].days) === '[1,5]', JSON.stringify(normalized.schedules.good?.windows[0].days))
check('normalize: broken window dropped with warning', normalized.schedules.bad === undefined && normalized.warnings.length > 0, JSON.stringify(normalized.warnings))
check('normalize: models-only entry kept', normalized.schedules.modelsOnly?.models?.['m-1']?.windows.length === 1)
check('normalize: unknown timezone rejected', normalizeSchedules({ x: { windows: [{ start: '01:00', end: '02:00', tz: 'Mars/Olympus' }] } }).schedules.x === undefined)

// ── display helpers ─────────────────────────────────────────────────────────
const windows = allWindows(DEEPSEEK)
check('allWindows: flat list', windows.length === 2 && windows[0].key === 'deepseek')
check('secondsToNextBoundary: 30 min for the 01:00 window', secondsToNextBoundary(DEEPSEEK.deepseek.windows, new Date('2026-09-09T00:30:00Z')) === 1800)
const aggregate = peakOverview(wed0700, DEEPSEEK)
check('peakOverview: aggregate peek', aggregate.peak === true && aggregate.until === '10:00 UTC', JSON.stringify(aggregate))
check('decidePeak legacy overload still works', decidePeak('deepseek-official', wed0700, DEEPSEEK).inPeak === true)

// ── mode/discount propagation ──────────────────────────────────────────────
const withMode = resolveEffective('deepseek-account', 'deepseek-flash', {
  deepseek: { windows: ALL_DAY, mode: 'hard', offPeakDiscount: 0.4, models: { 'deepseek-flash': { mode: 'warn' } } },
})
check('effective: model mode override', withMode?.mode === 'warn')
check('effective: family discount inherited', withMode?.offPeakDiscount === 0.4)
check('effective: family mode inherited by another model', resolveEffective('deepseek-account', 'deepseek-other', {
  deepseek: { windows: ALL_DAY, mode: 'hard' },
})?.mode === 'hard')

// ── Chinese public holidays (excluded from DeepSeek peak windows) ─────────
const HOLIDAYS = {
  deepseek: {
    windows: [
      { start: '01:00', end: '04:00', tz: 'UTC', days: [1, 2, 3, 4, 5] },
      { start: '06:00', end: '10:00', tz: 'UTC', days: [1, 2, 3, 4, 5] },
    ],
    holidays: { tz: 'Asia/Shanghai', ranges: [['2026-10-01', '2026-10-07'], ['2026-09-25', '2026-09-27']] },
  },
}
const normalizedHolidays = normalizeSchedules(HOLIDAYS)
check('holidays: normalized without warnings', normalizedHolidays.warnings.length === 0 && normalizedHolidays.schedules.deepseek.windows[0].holidays.ranges.length === 2, JSON.stringify(normalizedHolidays.warnings))
check('holidays: national day counts as off-peak (Thursday)', decidePeak('deepseek-account', 'deepseek-flash', new Date('2026-10-01T07:00:00Z'), normalizedHolidays.schedules).inPeak === false)
check('holidays: mid-autumn counts as off-peak (Friday)', decidePeak('deepseek-account', 'deepseek-flash', new Date('2026-09-25T07:00:00Z'), normalizedHolidays.schedules).inPeak === false)
check('holidays: the day before is a normal peak day', decidePeak('deepseek-account', 'deepseek-flash', new Date('2026-09-30T07:00:00Z'), normalizedHolidays.schedules).inPeak === true)
check('holidays: the day after the range is a normal peak day', decidePeak('deepseek-account', 'deepseek-flash', new Date('2026-10-08T07:00:00Z'), normalizedHolidays.schedules).inPeak === true)
const holidayNext = overviewFor('deepseek-account', 'deepseek-flash', new Date('2026-09-30T11:00:00Z'), normalizedHolidays.schedules)
check('holidays: next peak skips the whole holiday range', holidayNext.nextStartAt?.toISOString() === '2026-10-08T01:00:00.000Z', holidayNext.nextStartAt?.toISOString())
check('holidays: peakEndsAt ignores a holiday-only provider', peakEndsAt('deepseek-account', 'deepseek-flash', new Date('2026-10-05T07:00:00Z'), normalizedHolidays.schedules) === null)
const legacyHolidayShape = normalizeSchedules({ x: { windows: ALL_DAY, holidays: ['2026-01-01'] } })
check('holidays: a plain date array is accepted', legacyHolidayShape.schedules.x.windows[0].holidays.ranges[0][0] === '2026-01-01')
const badHoliday = normalizeSchedules({ x: { windows: ALL_DAY, holidays: { tz: 'Mars/Olympus', dates: ['2026-13-99'] } } })
check('holidays: bad dates/zones warn but fail open', badHoliday.warnings.length > 0 && badHoliday.schedules.x.windows[0].holidays === undefined, JSON.stringify(badHoliday.warnings))

if (failed > 0) {
  console.log(`\nFAILED: ${failed}`)
  process.exit(1)
}
console.log('\nOK: schedule engine works')

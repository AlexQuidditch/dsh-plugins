/**
 * Isolated tests for the durable state store, config resolution and stats
 * counters. Real files in a temp directory, injected clock, no cordis.
 * Run with `node tests/state.test.mjs`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { allowFor, resolveConfig } from '../lib/config.js'
import { createStateStore } from '../lib/state.js'
import { createStats } from '../lib/stats.js'

let failed = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log('ok  -', name)
    return
  }
  failed += 1
  console.log('FAIL -', name, detail)
}

const dir = mkdtempSync(join(tmpdir(), 'peak-hours-state-'))
const logger = { warn: () => {}, info: () => {} }
let clock = new Date('2026-11-11T08:00:00Z')
const now = () => clock

function freshStore(name) {
  return createStateStore({ file: join(dir, `${name}.json`), logger, now })
}

// ── migration from the first generation ────────────────────────────────────
const legacyFile = join(dir, 'legacy.json')
writeFileSync(legacyFile, JSON.stringify({ allowPeak: true, updatedAt: '2026-10-01T00:00:00Z' }))
const legacy = createStateStore({ file: legacyFile, logger, now })
check('legacy: boolean allowPeak preserved as default', legacy.defaultAllowPeak() === true)
check('legacy: sessions start empty', Object.keys(legacy.get().sessions).length === 0)
legacy.dispose()

// ── settings, session overrides and expiry ─────────────────────────────────
const store = freshStore('state')
check('default: peak work not allowed', store.defaultAllowPeak() === false)
store.setSessionAllow('s1', true, '2026-11-11T09:00:00.000Z')
check('session: override stored', store.sessionAllow('s1')?.allowPeak === true)
clock = new Date('2026-11-11T09:00:01Z')
check('session: expired override cleared', store.sessionAllow('s1') === undefined)
clock = new Date('2026-11-11T08:00:00Z')
store.setSessionAllow('s2', false, null)
check('session: permanent override', store.sessionAllow('s2')?.allowPeak === false)
store.clearSessionAllow('s2')
check('session: clear works', store.sessionAllow('s2') === undefined)

store.updateSettings({ mode: 'hard', dailyLimitMinutes: 5 })
check('settings: persisted', store.settings().mode === 'hard' && store.settings().dailyLimitMinutes === 5)
store.updateSettings({ mode: null })
check('settings: null is ignored by resolution (bundle wins)', resolveConfig({ mode: 'hard' }, store).mode === 'hard')

// ── schedules override ──────────────────────────────────────────────────────
store.setSchedulesOverride({ deepseek: { windows: [{ start: '00:00', end: '23:59', tz: 'UTC' }] } })
check('schedules: override stored', store.schedulesOverride()?.deepseek?.windows?.length === 1)
check('schedules: override replaces the whole map', store.schedulesOverride()?.zai === undefined, JSON.stringify(store.schedulesOverride()))
store.setSchedulesOverride(null)
check('schedules: reset to bundle', store.schedulesOverride() === null)

// ── stats, daily limit and rollover ────────────────────────────────────────
store.bumpStats({ heldSteps: 2 })
store.bumpStats({ movedTokensEstimate: 100 })
check('stats: additive counters', store.stats().heldSteps === 2 && store.stats().movedTokensEstimate === 100)
store.addAllowedSeconds(120)
check('limit: seconds added', store.limitSecondsToday() === 120)
check('limit: exhausted below the limit', store.limitExhausted(5) === false)
store.addAllowedSeconds(200)
check('limit: exhausted above the limit', store.limitExhausted(5) === true)
clock = new Date('2026-11-12T00:00:01Z')
check('limit: resets on the next local day', store.limitSecondsToday() === 0 && store.limitExhausted(5) === false)
clock = new Date('2026-11-11T08:00:00Z')

// ── deferred queue ──────────────────────────────────────────────────────────
const message = { id: 'm-1', role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }
store.addDeferred('s1', message, '2026-11-11T10:00:00.000Z')
store.addDeferred('s1', { ...message, id: 'm-2' }, '2026-11-11T10:00:00.000Z')
check('deferred: queued in order', store.deferredFor('s1').length === 2 && store.deferredFor('s1')[0].message.id === 'm-1')
check('deferred: summary counts', store.deferredSummary().s1 === 2)
const taken = store.takeDeferred('s1')
check('deferred: take returns oldest first and clears', taken.length === 2 && taken[1].message.id === 'm-2' && store.deferredFor('s1').length === 0)
store.addDeferred('s2', message, '2026-11-11T10:00:00.000Z')
store.clearDeferred('s2')
check('deferred: clear', store.deferredFor('s2').length === 0)

// ── turn marks ──────────────────────────────────────────────────────────────
store.markTurn('s1', 3, { peak: true })
store.markTurn('s1', 3, { peak: true, paused: true })
store.markTurn('s1', 4, { peak: true })
check('marks: peak turns deduped', JSON.stringify(store.marksFor('s1').peakTurns) === '[3,4]', JSON.stringify(store.marksFor('s1')))
check('marks: paused turns', JSON.stringify(store.marksFor('s1').pausedTurns) === '[3]')
store.resetMarks('s1')
check('marks: reset', store.marksFor('s1').peakTurns.length === 0)

// ── persistence + corrupt file ──────────────────────────────────────────────
store.setSessionAllow('s3', true, null)
store.flush()
const persisted = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
check('persistence: versioned file', persisted.version === 1 && persisted.sessions.s3.allowPeak === true)
const reloaded = createStateStore({ file: join(dir, 'state.json'), logger, now })
check('persistence: reload keeps the override', reloaded.sessionAllow('s3')?.allowPeak === true)
reloaded.dispose()

const corruptFile = join(dir, 'corrupt.json')
writeFileSync(corruptFile, '{not json')
const corrupt = createStateStore({ file: corruptFile, logger, now })
check('corrupt file: fresh state instead of a throw', corrupt.defaultAllowPeak() === false)
corrupt.dispose()

// ── config resolution ──────────────────────────────────────────────────────
const bundleConfig = {
  mode: 'soft',
  allowPeak: true,
  dailyLimitMinutes: 15,
  pause: { strategy: 'requeue', maxHoldMinutes: 45 },
  schedules: {
    deepseek: { windows: [{ start: '06:00', end: '10:00', tz: 'UTC' }] },
  },
}
const configStore = freshStore('config')
const resolved = resolveConfig(bundleConfig, configStore)
check('config: legacy soft normalizes to warn', resolved.mode === 'warn')
check('config: allowPeak boolean becomes the default', resolved.allowPeakDefault === true)
check('config: pause settings merged', resolved.pause.strategy === 'requeue' && resolved.pause.maxHoldMinutes === 45)
check('config: schedules normalized', resolved.schedules.deepseek.windows.length === 1)
check('config: defaults for unset keys', resolved.backgroundPolicy === 'allow' && resolved.prePeakWarningMinutes === 10)

configStore.updateSettings({ mode: 'pause', allowPeakDefault: false, dailyLimitMinutes: null })
const overridden = resolveConfig(bundleConfig, configStore)
check('config: user settings beat bundle', overridden.mode === 'pause' && overridden.allowPeakDefault === false)
check('config: null limit means unlimited', overridden.dailyLimitMinutes === null)

configStore.setSchedulesOverride({ zai: { windows: [{ start: '14:00', end: '18:00', tz: 'Asia/Shanghai' }] } })
const withOverride = resolveConfig(bundleConfig, configStore)
check('config: user schedules replace bundle', withOverride.schedules.deepseek === undefined && withOverride.schedules.zai.windows.length === 1)
check('config: source reported', withOverride.schedulesSource === 'user')

// ── allowFor ────────────────────────────────────────────────────────────────
const allowStore = freshStore('allow')
const resolvedAllow = resolveConfig({ allowPeak: false }, allowStore)
check('allowFor: default false', allowFor(resolvedAllow, allowStore, 'a').allow === false)
allowStore.setSessionAllow('a', true, null)
check('allowFor: session override wins', allowFor(resolvedAllow, allowStore, 'a').allow === true && allowFor(resolvedAllow, allowStore, 'a').source === 'session')
allowStore.setSessionAllow('parent', true, null)
const inherited = allowFor(resolveConfig({ allowPeak: false }, allowStore), allowStore, 'child', ['parent'])
check('allowFor: a subagent inherits the nearest ancestor override', inherited.allow === true && inherited.source === 'inherited', JSON.stringify(inherited))
allowStore.setSessionAllow('child', false, null)
const ownBeatsInherited = allowFor(resolveConfig({ allowPeak: false }, allowStore), allowStore, 'child', ['parent'])
check('allowFor: the session own override beats the inherited one', ownBeatsInherited.allow === false && ownBeatsInherited.source === 'session')
allowStore.clearSessionAllow('child')
allowStore.setSessionAllow('grandparent', true, null)
allowStore.clearSessionAllow('parent')
const viaGrandparent = allowFor(resolveConfig({ allowPeak: false }, allowStore), allowStore, 'child', ['parent', 'grandparent'])
check('allowFor: inheritance walks the whole ancestor chain', viaGrandparent.allow === true && viaGrandparent.source === 'inherited')
allowStore.setSessionAllow('expired-parent', false, '2026-11-11T07:59:59.000Z')
const expiredInherited = allowFor(resolveConfig({ allowPeak: true }, allowStore), allowStore, 'child-2', ['expired-parent'])
check('allowFor: an expired ancestor override is ignored', expiredInherited.source === 'default' && expiredInherited.allow === true, JSON.stringify(expiredInherited))
const noAncestors = allowFor(resolveConfig({ allowPeak: false }, allowStore), allowStore, 'root', [])
check('allowFor: a root session falls back to the default', noAncestors.source === 'default' && noAncestors.allow === false)
const resolvedLimit = resolveConfig({ allowPeak: true, dailyLimitMinutes: 1 }, allowStore)
allowStore.addAllowedSeconds(61)
check('allowFor: exhausted daily limit overrides everything', allowFor(resolvedLimit, allowStore, 'a').allow === false && allowFor(resolvedLimit, allowStore, 'a').source === 'limit')

// ── stats service estimates ─────────────────────────────────────────────────
clock = new Date('2026-11-11T08:00:00Z')
const statsStore = freshStore('stats')
const statsConfig = resolveConfig({ allowPeak: true, dailyLimitMinutes: 1, schedules: { deepseek: { windows: [{ start: '00:00', end: '23:59', tz: 'UTC' }], offPeakDiscount: 0.5 } } }, statsStore)
const stats = createStats({ store: statsStore, resolveConfig: () => statsConfig })
stats.observeCall(1000)
stats.noteHeldStep()
stats.noteDeferred()
stats.notePeakCall({ tokens: 40, durationMs: 30_000, conversation: true })
const summary = stats.summary()
check('stats: held step moves the rolling average', summary.movedTokensEstimate === 1000, JSON.stringify(summary))
check('stats: saved estimate applies the discount', summary.savedTokensEstimate === 500, JSON.stringify(summary))
check('stats: peak call and seconds counted', summary.peakCalls === 1 && summary.peakTokens === 40 && summary.allowedPeakSeconds === 30)
check('stats: deferred counted', summary.deferredMessages === 1)
check('stats: remaining allowance', stats.remainingAllowance() === 30, String(stats.remainingAllowance()))
stats.reset()
check('stats: reset clears counters', stats.summary().heldSteps === 0 && stats.summary().peakCalls === 0)

store.dispose()
rmSync(dir, { recursive: true, force: true })
if (failed > 0) {
  console.log(`\nFAILED: ${failed}`)
  process.exit(1)
}
console.log('\nOK: state, config and stats work')

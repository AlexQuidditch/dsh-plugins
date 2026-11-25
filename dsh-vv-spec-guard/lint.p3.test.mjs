// P3 lint rules: consumer-coverage, cascade-concentration (plan), program-dag (program).
// Run after `pnpm run build`: node lint.p3.test.mjs
import { lintPlan, lintProgram } from './lib/lint.js'

let pass = 0, fail = 0
const check = (name, cond) => { if (cond) { pass++; console.log('OK  ', name) } else { fail++; console.log('FAIL', name) } }

const specImpact = '<spec><status>approved</status><impact><S-EXAMINATIONS><disposition>cover-in-plan</disposition></S-EXAMINATIONS><S-STUDENTS><disposition>defer-to-program</disposition></S-STUDENTS></impact></spec>'

// consumer-coverage: task <scope> covers the consumer.
const planCovered = '<plan><status>draft</status><tasks><wave-1><T-001><title>x</title><file>f</file><scope>examinations</scope></T-001><T-002><title>y</title><file>g</file><scope>students</scope></T-002></wave-1></tasks></plan>'
check('consumer-coverage: task scopes cover both', !lintPlan(planCovered, { specText: specImpact }).errors.some((e) => e.rule === 'consumer-coverage'))

// consumer-coverage: missing scope → error.
const planMissing = '<plan><status>draft</status><tasks><wave-1><T-001><title>x</title><file>f</file><scope>examinations</scope></T-001></wave-1></tasks></plan>'
check('consumer-coverage: students missing → error', lintPlan(planMissing, { specText: specImpact }).errors.some((e) => e.rule === 'consumer-coverage' && e.message.includes('students')))

// consumer-coverage: consumer-coverage deferral covers the deferred scope.
const planDeferral = '<plan><status>draft</status><tasks><wave-1><T-001><title>x</title><file>f</file><scope>examinations</scope></T-001></wave-1></tasks><consumer-coverage><CC-001><scope>students</scope><deferral-target><dep-P-R4/></deferral-target></CC-001></consumer-coverage></plan>'
check('consumer-coverage: deferral covers students', !lintPlan(planDeferral, { specText: specImpact }).errors.some((e) => e.rule === 'consumer-coverage'))

// consumer-coverage: no spec impact → nothing to cover.
check('consumer-coverage: no impact → skip', !lintPlan(planMissing, { specText: '<spec><status>approved</status></spec>' }).errors.some((e) => e.rule === 'consumer-coverage'))

// cascade-concentration: 5 shared-surface deletes in one task → error.
const deletes5 = Array.from({ length: 5 }, (_, i) => `<D-00${i + 1}><path>src/db/schemas/t${i}.ts</path></D-00${i + 1}>`).join('')
const planConc = `<plan><status>draft</status><tasks><wave-1><T-001><title>teardown</title><file>f</file><deletes>${deletes5}</deletes></T-001></wave-1></tasks></plan>`
check('cascade-concentration: 5 shared deletes → error', lintPlan(planConc).errors.some((e) => e.rule === 'cascade-concentration'))
const deletes4 = Array.from({ length: 4 }, (_, i) => `<D-00${i + 1}><path>src/db/schemas/t${i}.ts</path></D-00${i + 1}>`).join('')
const planConc4 = `<plan><status>draft</status><tasks><wave-1><T-001><title>teardown</title><file>f</file><deletes>${deletes4}</deletes></T-001></wave-1></tasks></plan>`
check('cascade-concentration: 4 shared deletes → pass', !lintPlan(planConc4).errors.some((e) => e.rule === 'cascade-concentration'))
// non-shared deletes don't count.
const deletesLocal = Array.from({ length: 6 }, (_, i) => `<D-00${i + 1}><path>src/backend/foo/local${i}.ts</path></D-00${i + 1}>`).join('')
const planLocal = `<plan><status>draft</status><tasks><wave-1><T-001><title>x</title><file>f</file><deletes>${deletesLocal}</deletes></T-001></wave-1></tasks></plan>`
check('cascade-concentration: local deletes not counted', !lintPlan(planLocal).errors.some((e) => e.rule === 'cascade-concentration'))

// program-dag: valid program.
const progOK = '<program><status>draft</status><packages><P-A><title>a</title><owns-components>C-X</owns-components><depends_on></depends_on></P-A><P-B><title>b</title><owns-components>C-Y</owns-components><depends_on><dep-P-A/></depends_on></P-B></packages></program>'
check('program-dag: valid → no errors', lintProgram(progOK).errors.length === 0)
// cycle.
const progCycle = '<program><status>draft</status><packages><P-A><depends_on><dep-P-B/></depends_on></P-A><P-B><depends_on><dep-P-A/></depends_on></P-B></packages></program>'
check('program-dag: cycle → error', lintProgram(progCycle).errors.some((e) => e.rule === 'program-dag' && e.message.includes('cycle')))
// duplicate component ownership.
const progDup = '<program><status>draft</status><packages><P-A><owns-components>C-X</owns-components></P-A><P-B><owns-components>C-X</owns-components></P-B></packages></program>'
check('program-dag: duplicate owner → error', lintProgram(progDup).errors.some((e) => e.rule === 'program-dag' && e.message.includes('C-X')))
// unresolved dep ref.
const progUnres = '<program><status>draft</status><packages><P-A><depends_on><dep-P-Z/></depends_on></P-A></packages></program>'
check('program-dag: unresolved dep → reference error', lintProgram(progUnres).errors.some((e) => e.rule === 'reference' && e.message.includes('P-Z')))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
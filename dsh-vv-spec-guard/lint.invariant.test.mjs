// invariant→property-test tests. Run: node lint.invariant.test.mjs
import { invariantObligations, propertyTestScaffold, parseInvariantVerification, atRiskInvariants } from './lib/grace.js'
import { lintInvariantVerification } from './lib/lint.js'
let pass = 0, fail = 0
const check = (n, c) => { if (c) { pass++; console.log('OK  ', n) } else { fail++; console.log('FAIL', n) } }

const risky = [
  { path: 'm.ts', invariant: 'Nodes come only from ACTIVE enrollment merged views.', class: 'behavioral' },
  { path: 'm.ts', invariant: 'This module NEVER imports from domains/*', class: 'import-ban' },
  { path: 'm.ts', invariant: 'The catalog never queries examination taxonomy tables.', class: 'reference-ban' },
]
const obl = invariantObligations(risky)
check('obligation per invariant', obl.length === 3)
check('import-ban auto-checked (no scaffold)', obl[1].checkType === 'import-ban-auto' && obl[1].scaffold === null)
check('behavioral gets scaffold', obl[0].checkType === 'behavioral-test' && obl[0].scaffold.includes('it.todo'))
check('reference-ban gets scaffold', obl[2].checkType === 'behavioral-test' && obl[2].scaffold !== null)
check('ids sequential', obl[0].id === 'IV-001' && obl[2].id === 'IV-003')

const scaffold = propertyTestScaffold('Some guarantee holds.', 'm.ts', 'IV-001')
check('scaffold names obligation + property', scaffold.includes('IV-001') && scaffold.includes('Some guarantee holds.'))
check('scaffold is TODO (not a fake pass)', scaffold.includes('it.todo'))

const ledger = '<invariant-verification><IV-001><invariant>x</invariant><module>m.ts</module><test-path></test-path><status>pending</status><evidence></evidence></IV-001><IV-002><invariant>y</invariant><status>verified</status></IV-002><IV-003><invariant>z</invariant><status>waived</status></IV-003></invariant-verification>'
const entries = parseInvariantVerification(ledger)
check('parse ledger entries', entries.length === 3 && entries[0].status === 'pending')
const v = lintInvariantVerification(ledger)
check('pending flagged', v.errors.some(e => e.rule === 'unverified-invariant' && e.message.includes('IV-001')))
check('verified not flagged', !v.errors.some(e => e.message.includes('IV-002')))
check('waived not flagged', !v.errors.some(e => e.message.includes('IV-003')))
check('only one error', v.errors.length === 1)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
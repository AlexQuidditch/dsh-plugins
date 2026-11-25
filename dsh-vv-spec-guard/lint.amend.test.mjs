// Follow-up #2 — AMEND-GRANT delta auto-verification tests. Run: node lint.amend.test.mjs
import { amendDeltaDigest, verifyAmendGrant } from './lib/amend.js'
import { createHash } from 'node:crypto'
const sha = (s) => createHash('sha256').update(s).digest('hex')
let pass = 0, fail = 0
const check = (n, c) => { if (c) { pass++; console.log('OK  ', n) } else { fail++; console.log('FAIL', n) } }

const before = '<plan><status>approved</status><tasks><T-001><title>a</title></T-001></tasks></plan>'
const after = '<plan><status>approved</status><tasks><T-001><title>a</title></T-001><T-002><title>b</title></T-002></tasks></plan>'
const delta = amendDeltaDigest(before, after)
const grant = { delta, planBefore: sha(before), planAfter: sha(after) }

check('matching grant verifies', verifyAmendGrant(before, after, grant).ok === true)
check('tampered after detected', verifyAmendGrant(before, after + '<!-- sneaky -->', grant).ok === false)
check('wrong delta detected', verifyAmendGrant(before, after, { ...grant, delta: 'deadbeef' }).mismatches.includes('delta'))
check('wrong plan-before detected', verifyAmendGrant(before, after, { ...grant, planBefore: 'deadbeef' }).mismatches.includes('plan-before'))
check('delta deterministic', amendDeltaDigest(before, after) === delta)
check('no-change delta stable', amendDeltaDigest(before, before) === amendDeltaDigest(before, before))
check('different change different delta', amendDeltaDigest(before, after) !== amendDeltaDigest(before, before))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
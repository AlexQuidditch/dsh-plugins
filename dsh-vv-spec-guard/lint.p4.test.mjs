// P4 execution-feedback host checks: undeclared-deletion (commit gate) + stale-impact (pre-flight).
// Run after `pnpm run build`: node lint.p4.test.mjs
import { checkUndeclaredDeletions, computeStaleImpact } from './lib/execute.js'
import { lintAddendum } from './lib/lint.js'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const F = '/Users/alex_quidditch/projects/foundation'
let pass = 0, fail = 0
const check = (name, cond) => { if (cond) { pass++; console.log('OK  ', name) } else { fail++; console.log('FAIL', name) } }

// undeclared-deletion against the real teardown diff (3843cb35 deleted schools files).
const none = checkUndeclaredDeletions({ repoRoot: F, baselineRef: '3843cb35^', headRef: '3843cb35', declaredPaths: [] })
check('undeclared: ok', none.ok === true)
check('undeclared: teardown has deletions', none.ok && none.diffCount > 0)
check('undeclared: none declared → all undeclared', none.ok && none.undeclared.length === none.diffCount)
const firstDel = none.ok ? none.undeclared.find(e => e.kind === 'delete') : undefined
if (firstDel) {
  const some = checkUndeclaredDeletions({ repoRoot: F, baselineRef: '3843cb35^', headRef: '3843cb35', declaredPaths: [firstDel.path] })
  check('undeclared: declaring a path removes it', some.ok && some.undeclared.length === none.undeclared.length - 1 && !some.undeclared.some(e => e.path === firstDel.path))
}
// unreachable baseline → typed error.
const bad = checkUndeclaredDeletions({ repoRoot: F, baselineRef: 'deadbeefdeadbeef', declaredPaths: [] })
check('undeclared: unreachable baseline → census-ref-unreachable', bad.ok === false && bad.rule === 'census-ref-unreachable')

// stale-impact: same ref for baseline and current → no drift (determinism).
console.log('… running stale-impact (two census runs, ~10-15s)')
const stale = await computeStaleImpact({
  repoRoot: F, baselineRef: 'af92a878^', currentRef: 'af92a878^',
  scopeDir: 'packages/domains/education-platform', ownerScope: 'schools',
  deletedSymbols: ['SchoolAuthorizationService'], deletedPaths: [],
})
check('stale-impact: ok', stale.ok === true)
check('stale-impact: same ref → no drift', stale.ok && stale.drift === false && stale.newScopes.length === 0)
check('stale-impact: digests identical for same ref', stale.ok && stale.baselineDigest === stale.currentDigest)

// Feedback regressions: unresolved-addendum read-side.
check('unresolved-addendum: recorded blocks', lintAddendum('<impact-addendum><ADD-001><status>recorded</status></ADD-001></impact-addendum>').errors.some(e => e.rule === 'unresolved-addendum'))
check('unresolved-addendum: resolved passes', lintAddendum('<impact-addendum><ADD-001><status>resolved</status></ADD-001></impact-addendum>').errors.length === 0)

// Feedback regressions: WORKTREE default, kind-separated rename, type-change, vacuous surface.
const d = mkdtempSync(join(tmpdir(), 'p4reg-'))
const g = (...a) => execFileSync('git', ['-C', d, ...a], { encoding: 'utf8' })
g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't')
mkdirSync(join(d, 'src')); writeFileSync(join(d, 'src/a.ts'), 'x'); writeFileSync(join(d, 'src/b.ts'), 'y')
g('add', '-A'); g('commit', '-qm', 'init'); const base = g('rev-parse', 'HEAD').trim()
unlinkSync(join(d, 'src/b.ts')); g('mv', 'src/a.ts', 'src/moved.ts')
const wt = checkUndeclaredDeletions({ repoRoot: d, baselineRef: base, declaredPaths: [] })
check('regression F1: WORKTREE default sees uncommitted delete+rename', wt.ok && wt.undeclared.length === 2)
const f3 = checkUndeclaredDeletions({ repoRoot: d, baselineRef: base, declaredPaths: ['src/a.ts'] })
check('regression F3: declared delete NOT satisfied by rename', f3.ok && f3.undeclared.some(e => e.kind === 'rename'))
const vac = await computeStaleImpact({ repoRoot: d, baselineRef: base, currentRef: base, scopeDir: '.', deletedSymbols: [], deletedPaths: [] })
check('regression: vacuous surface refused', !vac.ok && vac.rule === 'stale-impact-vacuous-surface')
rmSync(d, { recursive: true, force: true })

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
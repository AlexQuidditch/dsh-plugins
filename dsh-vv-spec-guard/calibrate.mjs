// Follow-up #1 — archive calibration: validate the cross-scope-fanout threshold on real
// foundation deletion surfaces. The threshold is a scope-count discriminator: a change
// consumed by >= THRESHOLD distinct production scopes is multi-scope (decomposition
// candidate); a single-scope change is quiet. This pass confirms the known CURRICULUM
// cross-scope case fires and single-scope changes stay quiet, and reports the boundary.
// Run: node calibrate.mjs
import { runCensus } from './lib/census.js'

const F = '/Users/alex_quidditch/projects/foundation'
const SCOPE = 'packages/domains/education-platform'
const THRESHOLD = 3

// Real surfaces at af92a878^ (spec-time). ownerScope excludes the declaring scope.
const surfaces = [
  ['SchoolAuthorizationService (CURRICULUM)', 'schools', ['SchoolAuthorizationService']],
  ['MeetsService (single-scope)', 'meets', ['MeetsService']],
  ['WhiteboardService (boundary)', 'whiteboard', ['WhiteboardService']],
]

console.log(`calibration: fan-out threshold = ${THRESHOLD} distinct production consumer scopes\n`)
console.log('surface'.padEnd(44), 'scopes', 'fires(≥3)')
const rows = []
for (const [label, ownerScope, deletedSymbols] of surfaces) {
  const r = await runCensus({ repoRoot: F, baselineRef: 'af92a878^', scopeDir: SCOPE, ownerScope, deletedSymbols, deletedPaths: [] })
  if (!r.ok) { console.log(label.padEnd(44), 'ERR', r.rule); continue }
  const scopes = r.output.perScope.length
  console.log(label.padEnd(44), String(scopes).padEnd(6), String(scopes >= THRESHOLD))
  rows.push({ label, scopes })
}

const schools = rows.find(r => r.label.startsWith('SchoolAuthorization'))
const meets = rows.find(r => r.label.startsWith('Meets'))
console.log('\nvalidation:')
console.log(`  known cross-scope case (schools) fires:  ${schools ? schools.scopes >= THRESHOLD : 'n/a'}  (scopes=${schools?.scopes})`)
console.log(`  single-scope change (meets) quiet:       ${meets ? meets.scopes < THRESHOLD : 'n/a'}  (scopes=${meets?.scopes})`)
console.log(`  threshold is a scope-count discriminator: >=${THRESHOLD} scopes = multi-scope gate.`)
console.log('\nHonest limit: scope-count >= 3 correlates with multi-scope fan-out, but "needs a')
console.log('program" also depends on contract knowability (§11.1). Full cascade-label calibration')
console.log('(which archived changes actually cascaded) is the deeper research pass; the gate is')
console.log('configurable (crossScopeFanoutMode/Threshold) so it can be tuned or set to warn.')
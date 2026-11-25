// End-to-end demonstration of the vv cross-scope pipeline (P0-P3).
// Replays the CURRICULUM failure mode through the new gates using REAL foundation
// census data (host/engine split: runCensus computes, lint compares).
// Run: node demo-cross-scope.mjs
import { runCensus } from './lib/census.js'
import { lintSpec, lintPlan, lintProgram } from './lib/lint.js'
import { checkUndeclaredDeletions, computeStaleImpact } from './lib/execute.js'

const FOUNDATION = '/Users/alex_quidditch/projects/foundation'
const line = (s = '') => console.log(s)
const verdict = (v) => ({ errors: v.errors.map(e => e.rule), warnings: v.warnings.map(w => w.rule) })
const has = (v, rule) => v.errors.some(e => e.rule === rule)

line('════════════════════════════════════════════════════════════════')
line(' STEP 1 — HOST CENSUS (the fan-out the original CURRICULUM spec missed)')
line('════════════════════════════════════════════════════════════════')
const census = await runCensus({
  repoRoot: FOUNDATION, baselineRef: 'af92a878^',
  scopeDir: 'packages/domains/education-platform', ownerScope: 'schools',
  deletedSymbols: ['SchoolAuthorizationService'], deletedPaths: [],
})
if (!census.ok) { console.error('census failed', census); process.exit(1) }
const out = census.output
line(`resolvedOid=${out.resolvedOid.slice(0, 12)}  analyzer=${out.analyzer.name}@${out.analyzer.version}`)
line(`outputDigest=${out.outputDigest.slice(0, 16)}…`)
line(`production consumer scopes: ${out.perScope.length}  (examinations present: ${out.perScope.some(s => s.scope === 'examinations')})`)
line(`→ fan-out ${out.perScope.length} ≥ threshold 3  ⇒  cross-scope-fanout fires, decomposition gate requires a PROGRAM`)

// Build a spec <impact> from the REAL census output (host-computed, not hand-written).
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
let eCounter = 0
const scopeNodes = out.perScope.map(s => {
  const edges = s.edges.map(e => {
    eCounter++
    const id = `E-${String(eCounter).padStart(3, '0')}`
    return `<${id}><kind>${e.kind}</kind><source>${esc(e.source)}</source><target>${esc(e.target)}</target></${id}>`
  }).join('')
  return `<S-${s.scope.toUpperCase()}><role>consumer</role><change-kind>policy</change-kind><edges>${edges}</edges><disposition>cover-in-plan</disposition></S-${s.scope.toUpperCase()}>`
}).join('')
const totalFiles = out.perScope.reduce((n, s) => n + s.files.length, 0)
const impactBlock = `<impact><census><tool>spec_guard_census</tool><ref>${out.resolvedOid}</ref><scope-dir>packages/domains/education-platform</scope-dir><owner-scope>schools</owner-scope><deleted-symbols>SchoolAuthorizationService</deleted-symbols><output-digest>${out.outputDigest}</output-digest></census><fanout><consumer-scopes>${out.perScope.length}</consumer-scopes><consumer-files>${totalFiles}</consumer-files><hard-edges>${totalFiles}</hard-edges></fanout><S-SCHOOLS><role>owner</role><change-kind>data</change-kind></S-SCHOOLS>${scopeNodes}<decomposition>program</decomposition><program>.vvoc/programs/2026-11-25-demo-cross-scope/program.xml</program></impact>`
const pathsBlock = '<paths><P-001><path>packages/domains/education-platform/src/db/schemas/schools.ts</path><role>delete</role></P-001></paths>'
const specXml = (impact) => `<spec><status>approved</status><goal>Demo schools teardown</goal>${pathsBlock}${impact}</spec>`
const hostCensus = {
  perScope: out.perScope.map(s => ({ scope: s.scope, hardCount: s.hardCount, edges: s.edges.map(e => ({ kind: e.kind, source: e.source, target: e.target })) })),
  outputDigest: out.outputDigest, refReachable: true,
  specCensusSet: { symbols: ['SchoolAuthorizationService'], paths: ['packages/domains/education-platform/src/db/schemas/schools.ts'] },
  fanoutMode: 'warn', fanoutThreshold: 3,
}

line()
line('════════════════════════════════════════════════════════════════')
line(' STEP 2 — HAPPY PATH: correct spec/plan/program lint clean')
line('════════════════════════════════════════════════════════════════')
const goodSpec = specXml(impactBlock)
const vGoodSpec = lintSpec(goodSpec, { census: hostCensus })
line(`spec  : errors=${JSON.stringify(verdict(vGoodSpec).errors)}  warnings=${JSON.stringify(verdict(vGoodSpec).warnings)}`)
line(`        impact-present satisfied (paths+impact), census-stale ok (digest matches), cross-scope-fanout WARN (10≥3)`)

// Plan: one task per consumer scope + deletes subset of spec census set + consumer-coverage.
const tasks = out.perScope.map((s, i) => {
  const id = `T-${String(i + 1).padStart(3, '0')}`
  return `<${id}><title>rewire ${s.scope}</title><file>src/backend/${s.scope}/x.ts</file><scope>${s.scope}</scope></${id}>`
}).join('')
const cc = out.perScope.map((s, i) => `<CC-${String(i + 1).padStart(3, '0')}><scope>${s.scope}</scope><covered-by><dep-T-${String(i + 1).padStart(3, '0')}/></covered-by></CC-${String(i + 1).padStart(3, '0')}>`).join('')
const planDeletes = '<deletes><D-001><path>packages/domains/education-platform/src/db/schemas/schools.ts</path></D-001></deletes>'
const goodPlan = `<plan><status>draft</status><spec>spec.xml</spec><tasks><wave-1><T-000><title>delete schools schema</title><file>entry.ts</file><scope>schools</scope>${planDeletes}</T-000>${tasks}</wave-1></tasks><consumer-coverage>${cc}</consumer-coverage></plan>`
const vGoodPlan = lintPlan(goodPlan, { specText: goodSpec, census: hostCensus })
line(`plan  : errors=${JSON.stringify(verdict(vGoodPlan).errors)}  (consumer-coverage + census-incomplete + cascade-concentration pass)`)

const goodProgram = '<program><status>draft</status><packages><P-R0><title>contracts</title><owns-components>C-CATALOG</owns-components><depends_on></depends_on></P-R0><P-R1><title>UI</title><owns-components>C-SHELL</owns-components><depends_on><dep-P-R0/></depends_on></P-R1></packages></program>'
const vGoodProgram = lintProgram(goodProgram)
line(`program: errors=${JSON.stringify(verdict(vGoodProgram).errors)}  (program-dag: acyclic, owners unique, refs resolve)`)

line()
line('════════════════════════════════════════════════════════════════')
line(' STEP 3 — THE TEETH: each CURRICULUM failure mode now fires a rule')
line('════════════════════════════════════════════════════════════════')

// 3a. "examinations internally untouched" — the original spec's false claim.
const untouchedSpec = goodSpec.replace('<S-EXAMINATIONS><role>consumer</role><change-kind>policy</change-kind>', '<S-EXAMINATIONS><role>consumer</role><change-kind>policy</change-kind>').replace(/<S-EXAMINATIONS>([\s\S]*?)<disposition>cover-in-plan<\/disposition>/, '<S-EXAMINATIONS>$1<disposition>verified-untouched</disposition>')
const vA = lintSpec(untouchedSpec, { census: hostCensus })
line(`3a "examinations untouched" vs real DI edge → untouched-contradicted: ${has(vA, 'untouched-contradicted')}`)

// 3b. Omit a consumer scope from impact (the omission bypass).
const omitSpec = goodSpec.replace(/<S-STUDENTS>[\s\S]*?<\/S-STUDENTS>/, '')
const vB = lintSpec(omitSpec, { census: hostCensus })
line(`3b omit S-STUDENTS from impact        → census-impact-coverage:   ${has(vB, 'census-impact-coverage')}`)

// 3c. Hand-edit the fan-out digest (author-gamed counts).
const staleSpec = goodSpec.replace(out.outputDigest, 'deadbeef'.repeat(8))
const vC = lintSpec(staleSpec, { census: hostCensus })
line(`3c tamper census output-digest        → census-stale:             ${has(vC, 'census-stale')}`)

// 3d. T-023 anti-pattern: concentrate 7 shared-surface deletes in one task.
const concDeletes = '<deletes>' + Array.from({ length: 7 }, (_, i) => `<D-00${i + 1}><path>packages/domains/education-platform/src/db/schemas/s${i}.ts</path></D-00${i + 1}>`).join('') + '</deletes>'
const concPlan = `<plan><status>draft</status><tasks><wave-1><T-001><title>MB1 clean break</title><file>entry.ts</file><scope>schools</scope>${concDeletes}</T-001></wave-1></tasks></plan>`
const vD = lintPlan(concPlan, { specText: goodSpec })
line(`3d 7 schema deletes in ONE task (T-023)→ cascade-concentration:    ${has(vD, 'cascade-concentration')}`)

// 3e. Plan misses a consumer scope.
const missPlan = goodPlan.replace(/<T-010>[\s\S]*?<\/T-010>/, '').replace(/<CC-010>[\s\S]*?<\/CC-010>/, '')
const vE = lintPlan(missPlan, { specText: goodSpec, census: hostCensus })
line(`3e plan drops a consumer scope        → consumer-coverage:        ${has(vE, 'consumer-coverage')}`)

// 3f. Plan deletes a surface the spec never censused.
const extraDeletePlan = goodPlan.replace('<D-001><path>packages/domains/education-platform/src/db/schemas/schools.ts</path></D-001>', '<D-001><path>packages/domains/education-platform/src/db/schemas/schools.ts</path></D-001><D-002><path>packages/domains/education-platform/src/db/schemas/uncensused.ts</path></D-002>')
const vF = lintPlan(extraDeletePlan, { specText: goodSpec, census: hostCensus })
line(`3f plan deletes uncensused surface    → census-incomplete:        ${has(vF, 'census-incomplete')}`)

// 3g. Program with a dependency cycle.
const cycProgram = '<program><status>draft</status><packages><P-A><depends_on><dep-P-B/></depends_on></P-A><P-B><depends_on><dep-P-A/></depends_on></P-B></packages></program>'
const vG = lintProgram(cycProgram)
line(`3g program dependency cycle           → program-dag:              ${has(vG, 'program-dag')}`)

line()
line('════════════════════════════════════════════════════════════════')
line(' STEP 4 — P4 EXECUTION FEEDBACK (closing the loop)')
line('════════════════════════════════════════════════════════════════')
const teardown = checkUndeclaredDeletions({ repoRoot: FOUNDATION, baselineRef: '3843cb35^', headRef: '3843cb35', declaredPaths: [] })
line(`undeclared-deletion: teardown diff ${teardown.diffCount} deletions/renames, declared=[] → undeclared=${teardown.undeclared.length}`)
const declaredOne = checkUndeclaredDeletions({ repoRoot: FOUNDATION, baselineRef: '3843cb35^', headRef: '3843cb35', declaredPaths: [teardown.undeclared[0].path] })
line(`  declare 1 path → undeclared=${declaredOne.undeclared.length}  (commit gate catches undeclared deletions — the T-023 backstop)`)
const stale = await computeStaleImpact({ repoRoot: FOUNDATION, baselineRef: 'af92a878^', currentRef: 'af92a878^', scopeDir: 'packages/domains/education-platform', ownerScope: 'schools', deletedSymbols: ['SchoolAuthorizationService'], deletedPaths: [] })
line(`stale-impact: same-ref drift=${stale.drift} (newScopes=${stale.newScopes.length}); pre-flight re-census catches repo drift approve→execute`)
const p4ok = teardown.ok && teardown.undeclared.length > 0 && declaredOne.undeclared.length === teardown.undeclared.length - 1 && stale.ok && !stale.drift

line()
line('════════════════════════════════════════════════════════════════')
const allFire = has(vA, 'untouched-contradicted') && has(vB, 'census-impact-coverage') && has(vC, 'census-stale') && has(vD, 'cascade-concentration') && has(vE, 'consumer-coverage') && has(vF, 'census-incomplete') && has(vG, 'program-dag')
const happyClean = vGoodSpec.errors.length === 0 && vGoodPlan.errors.length === 0 && vGoodProgram.errors.length === 0
line(` RESULT: happy path clean=${happyClean}; all 7 spec/plan gates fire=${allFire}; P4 execution feedback ok=${p4ok}`)
line('════════════════════════════════════════════════════════════════')
process.exit(happyClean && allFire && p4ok ? 0 : 1)
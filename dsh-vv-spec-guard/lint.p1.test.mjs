// P1 lint-engine unit tests: CDATA parsing, generation-gap gating, cross-scope rules.
// Run after `pnpm run build`: node lint.p1.test.mjs
import { parseXmlLite, lintSpec, lintPlan } from './lib/lint.js'

let pass = 0, fail = 0
const check = (name, cond) => { if (cond) { pass++; console.log('OK  ', name) } else { fail++; console.log('FAIL', name) } }

// CDATA-aware parsing: TS generics / JSX inside a snippet must not break the parser.
const cdata = parseXmlLite('<plan><T-001><snippet><![CDATA[const x: Array<T> = foo(<Component/>);]]></snippet></T-001></plan>')
check('CDATA parses generics/JSX', cdata.children[0].children[0].text.includes('Array<T>'))

// Generation gap: unique-tag spec (child <status>, no attributes) must NOT hit the
// legacy package-attribute rule.
const uniqueSpec = '<spec><status>approved</status><goal>g</goal></spec>'
check('unique-tag spec: no package error', !lintSpec(uniqueSpec).errors.some((e) => e.rule === 'package'))

// Legacy spec (root status attribute) still requires the package attribute.
const legacySpec = '<spec status="approved" package=""><goals><goal>g</goal></goals></spec>'
check('legacy spec: package error fires', lintSpec(legacySpec).errors.some((e) => e.rule === 'package'))

// impact-present: spec <paths> touching a shared surface require <impact>.
const specPaths = '<spec><status>draft</status><paths><P-001><path>src/db/schemas/schools.ts</path><role>delete</role></P-001></paths></spec>'
check('impact-present fires without <impact>', lintSpec(specPaths).errors.some((e) => e.rule === 'impact-present'))
const specPathsImpact = specPaths.replace('</spec>', '<impact><census><ref>x</ref><scope-dir>y</scope-dir></census></impact></spec>')
check('impact-present satisfied with <impact>', !lintSpec(specPathsImpact).errors.some((e) => e.rule === 'impact-present'))

// Census-dependent rules with host-supplied data (host/engine split).
const specImpact = '<spec><status>approved</status><impact><census><ref>oid</ref><scope-dir>pkg</scope-dir><output-digest>AAA</output-digest></census><S-EXAMINATIONS><disposition>verified-untouched</disposition></S-EXAMINATIONS></impact></spec>'
const census = {
  perScope: [{ scope: 'examinations', hardCount: 1, edges: [{ kind: 'runtime-import', source: 'examinations/exam.controller.ts', target: 'SchoolAuthorizationService' }] }],
  outputDigest: 'BBB', refReachable: true, fanoutMode: 'warn', fanoutThreshold: 1,
}
const vc = lintSpec(specImpact, { census })
check('untouched-contradicted (hard edge into verified-untouched)', vc.errors.some((e) => e.rule === 'untouched-contradicted'))
check('census-stale (claimed AAA != host BBB)', vc.errors.some((e) => e.rule === 'census-stale'))
check('cross-scope-fanout WARN mode', vc.warnings.some((e) => e.rule === 'cross-scope-fanout'))
const vcErr = lintSpec(specImpact, { census: { ...census, fanoutMode: 'error' } })
check('cross-scope-fanout ERROR mode', vcErr.errors.some((e) => e.rule === 'cross-scope-fanout'))

// census-impact-coverage: a host-census consumer scope missing from <impact>.
const specNoScope = '<spec><status>approved</status><impact><census><ref>oid</ref><scope-dir>pkg</scope-dir></census></impact></spec>'
const vcc = lintSpec(specNoScope, { census: { perScope: [{ scope: 'examinations', hardCount: 1, edges: [] }], refReachable: true } })
check('census-impact-coverage (missing scope)', vcc.errors.some((e) => e.rule === 'census-impact-coverage'))

// census-ref-unreachable / census-path-unresolvable.
check('census-ref-unreachable', lintSpec(specImpact, { census: { refReachable: false } }).errors.some((e) => e.rule === 'census-ref-unreachable'))
check('census-path-unresolvable', lintSpec(specImpact, { census: { pathUnresolvable: ['src/db/schemas/typo.ts'] } }).errors.some((e) => e.rule === 'census-path-unresolvable'))

// census-incomplete (PLAN lint): plan <deletes> must be ⊆ spec-pinned census set.
const plan = '<plan><status>draft</status><deletes><D-001><path>src/db/schemas/schools.ts</path></D-001><D-002><path>src/db/schemas/extra.ts</path></D-002></deletes></plan>'
const vp = lintPlan(plan, { census: { specCensusSet: { symbols: [], paths: ['src/db/schemas/schools.ts'] } } })
check('census-incomplete (extra.ts absent from spec set)', vp.errors.some((e) => e.rule === 'census-incomplete' && e.message.includes('extra.ts')))
check('census-incomplete (schools.ts present passes)', !vp.errors.some((e) => e.rule === 'census-incomplete' && e.message.includes('schools.ts')))

// census-unavailable degradation: impact present but no host census → warning, not silent pass.
check('census-unavailable warning', lintSpec(specImpact).warnings.some((e) => e.rule === 'census-unavailable'))

// #4 design-reasoning nudge: cross-scope spec should carry <design>.
const impactNoDesign = '<spec><status>draft</status><impact><census><ref>x</ref><scope-dir>y</scope-dir></census></impact></spec>'
const impactWithDesign = '<spec><status>draft</status><impact><census><ref>x</ref><scope-dir>y</scope-dir></census></impact><design><decomposition><strategy>strangler</strategy></decomposition></design></spec>'
check('design-reasoning-missing warning (impact w/o design)', lintSpec(impactNoDesign).warnings.some((e) => e.rule === 'design-reasoning-missing'))
check('no design warning when design present', !lintSpec(impactWithDesign).warnings.some((e) => e.rule === 'design-reasoning-missing'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
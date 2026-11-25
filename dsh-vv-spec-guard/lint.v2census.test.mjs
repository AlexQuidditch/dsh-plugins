// Follow-up #4 — v2 census capabilities (weighted / transitive / submodule). Run: node lint.v2census.test.mjs
import { runCensus } from './lib/census.js'
const F = '/Users/alex_quidditch/projects/foundation'
const base = { repoRoot: F, baselineRef: 'af92a878^', scopeDir: 'packages/domains/education-platform', ownerScope: 'schools', deletedSymbols: ['SchoolAuthorizationService'], deletedPaths: [] }
let pass = 0, fail = 0
const check = (n, c) => { if (c) { pass++; console.log('OK  ', n) } else { fail++; console.log('FAIL', n) } }

const direct = await runCensus(base)
check('weightedFanout >= direct scope count', direct.ok && direct.output.weightedFanout >= direct.output.perScope.length)
check('default transitive empty (opt-in)', direct.ok && direct.output.transitive.length === 0)
check('default submodules empty (opt-in)', direct.ok && direct.output.submodules.length === 0)
const trans = await runCensus({ ...base, transitiveDepth: 1 })
check('transitiveDepth=1 finds importers of consumers', trans.ok && trans.output.transitive.length > 0)
const sub = await runCensus({ ...base, includeSubmodules: true })
check('submodule detection finds projects/* gitlinks', sub.ok && sub.output.submodules.some(p => p.startsWith('projects/')))
check('opt-in supplements do not change core digest', direct.ok && trans.ok && direct.output.outputDigest === trans.output.outputDigest)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
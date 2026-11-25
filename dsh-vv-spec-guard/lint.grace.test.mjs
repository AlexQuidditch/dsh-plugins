// Follow-up #2 — GRACE→invariants tests. Run: node lint.grace.test.mjs
import { parseGrace, checkGrace, classifyInvariant, detectExports, detectImports, atRiskInvariants } from './lib/grace.js'
let pass = 0, fail = 0
const check = (n, c) => { if (c) { pass++; console.log('OK  ', n) } else { fail++; console.log('FAIL', n) } }

const src = [
  '// START_MODULE_CONTRACT',
  '//   PURPOSE: demo module',
  '//   DEPENDS: ./other',
  '// END_MODULE_CONTRACT',
  '// START_INVARIANTS',
  '//   - This module NEVER imports from domains/*',
  '//   - The catalog never queries examination taxonomy tables.',
  '//   - Nodes come only from ACTIVE enrollment merged views.',
  '// END_INVARIANTS',
  '// START_MODULE_MAP',
  '//   CLASS [5] [demo] => Foo',
  '//   FUNC [3] [demo] => bar',
  '// END_MODULE_MAP',
  'export class Foo {}',
  'export function bar() {}',
  "import { x } from './other';",
].join('\n')

const g = parseGrace(src)
check('parseGrace invariants', g.invariants.length === 3)
check('parseGrace moduleMap', g.moduleMap.length === 2 && g.moduleMap.includes('Foo') && g.moduleMap.includes('bar'))
check('parseGrace purpose', g.purpose === 'demo module')

check('classify import-ban', classifyInvariant('This module NEVER imports from domains/*') === 'import-ban')
check('classify reference-ban', classifyInvariant('The catalog never queries examination taxonomy tables.') === 'reference-ban')
check('classify behavioral', classifyInvariant('Nodes come only from ACTIVE enrollment merged views.') === 'behavioral')

const ok = checkGrace(src)
check('moduleMap matches exports', ok.moduleMap && ok.moduleMap.missing.length === 0 && ok.moduleMap.extra.length === 0)
check('no import-ban violation (clean)', ok.importBanViolations.length === 0)
check('behavioral surfaced', ok.behavioralInvariants.length === 1)

// import-ban violation: add a domains import matching the "domains/*" pattern
const violating = src + "\nimport { y } from 'domains/education';"
const v = checkGrace(violating)
check('import-ban violation detected', v.importBanViolations.length === 1 && v.importBanViolations[0].matchingImports.includes('domains/education'))

// moduleMap mismatch: map lists Baz not exported
const mismatch = src.replace('=> bar', '=> Baz')
const mm = checkGrace(mismatch)
check('moduleMap missing detected', mm.moduleMap && mm.moduleMap.missing.includes('Baz'))
check('moduleMap extra detected', mm.moduleMap && mm.moduleMap.extra.includes('bar'))

check('detectExports', detectExports('export class A {}\nexport const b = 1;\nexport type C = {}').join(',') === 'A,C,b')
check('detectImports', detectImports("import {x} from './a';\nimport type {Y} from '../b';").includes('./a'))

// at-risk invariants
const files = [{ path: 'm.ts', text: '// START_INVARIANTS\n//   - SchoolAuthorizationService scope must hold.\n// END_INVARIANTS' }]
const risky = atRiskInvariants(files, ['SchoolAuthorizationService'])
check('atRiskInvariants surfaces mention', risky.length === 1 && risky[0].class === 'behavioral')

// TS-API factual public surface (follow-up #2 MODULE_MAP closure)
import { createScopeProgram } from './lib/census.js'
import { tsPublicSurface } from './lib/grace.js'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const scope = mkdtempSync(join(tmpdir(), 'grace-ts-'))
mkdirSync(join(scope, 'src'))
writeFileSync(join(scope, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'es2024', module: 'esnext', moduleResolution: 'bundler', strict: true }, include: ['src/**/*.ts'] }))
writeFileSync(join(scope, 'src', 'svc.ts'), [
  'export class Svc {',
  '  publicMethod() {}',
  '  private hidden() {}',
  '  protected prot() {}',
  '  static staticMethod() {}',
  '}',
  'export function topLevel() {}',
].join('\n'))
const { program, checker } = createScopeProgram(scope, '')
const surface = tsPublicSurface(program, checker, join(scope, 'src', 'svc.ts'))
check('TS surface includes class + public methods + topLevel', surface.includes('Svc') && surface.includes('publicMethod') && surface.includes('staticMethod') && surface.includes('topLevel'))
check('TS surface excludes private/protected', !surface.includes('hidden') && !surface.includes('prot'))
rmSync(scope, { recursive: true, force: true })

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
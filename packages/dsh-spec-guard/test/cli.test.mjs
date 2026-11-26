// CLI contract tests: exit codes, baseline ratchet, JSON output. Run: pnpm test
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const cli = join(import.meta.dirname, '..', 'lib', 'cli.js')
const root = mkdtempSync(join(tmpdir(), 'dsh-spec-guard-'))
const packages = join(root, 'packages')
mkdirSync(packages, { recursive: true })

const moduleContract = [
  '// START_MODULE_CONTRACT:',
  '//   PURPOSE: demo',
  '// END_MODULE_CONTRACT',
].join('\n')
const good = `${moduleContract}\n// START_BLOCK_A\n// END_BLOCK_A\n`
const bad = `${moduleContract}\n// START_BLOCK_A\n`

function run(args) {
  const result = spawnSync(process.execPath, [cli, 'grace', 'audit', '--repo-root', root, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

let failures = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log('OK  ', name)
  } else {
    failures += 1
    console.log('FAIL', name, detail)
  }
}

try {
  writeFileSync(join(packages, 'good.ts'), good)
  writeFileSync(join(packages, 'bad.ts'), bad)

  const first = run(['--scope', 'packages'])
  check('exits 1 on an unpaired marker', first.status === 1, `${first.status} ${first.stderr}`)
  check('names the failing rule', first.stdout.includes('unpaired-marker'), first.stdout)
  check('names the failing file', first.stdout.includes('bad.ts'), first.stdout)

  writeFileSync(join(packages, 'bad.ts'), good)
  const clean = run(['--scope', 'packages'])
  check('exits 0 when structural findings are gone', clean.status === 0, `${clean.status} ${clean.stderr}`)

  writeFileSync(join(packages, 'bad.ts'), bad)
  const accepted = run(['--scope', 'packages', '--baseline', '.vvoc/grace-baseline.json', '--accept'])
  check('--accept writes a v2 baseline', accepted.status === 0 && JSON.parse(readFileSync(join(root, '.vvoc', 'grace-baseline.json'), 'utf8')).version === 2, accepted.stderr)
  const baselined = run(['--scope', 'packages', '--baseline', '.vvoc/grace-baseline.json'])
  check('baselined debt exits 0', baselined.status === 0, `${baselined.status} ${baselined.stderr}`)

  writeFileSync(join(packages, 'worse.ts'), `${moduleContract}\n// START_BLOCK_NEW\n`)
  const regression = run(['--scope', 'packages', '--baseline', '.vvoc/grace-baseline.json'])
  check('a new finding against the baseline exits 1', regression.status === 1, `${regression.status}`)
  check('reports the regression', regression.stdout.includes('worse.ts'), regression.stdout)

  const json = run(['--scope', 'packages', '--json'])
  const parsed = JSON.parse(json.stdout)
  check('--json carries the engine version', parsed.engine.name === '@alexquidditch/dsh-spec-guard' && typeof parsed.engine.version === 'string')
  check('--json carries findings', Array.isArray(parsed.findings))
} finally {
  rmSync(root, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`${failures} CLI test(s) failed`)
  process.exit(1)
}
console.log('cli tests passed')

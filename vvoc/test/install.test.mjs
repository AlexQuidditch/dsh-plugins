/**
 * vvoc install/sync/status tests.
 *
 * Since 0.2 the preset travels as the `agent-presets` BUNDLE, so these cases
 * check the bundle contract, the shipped skill frontmatter, and the profile
 * membership probe — against a FAKE DSH home. The real ~/.dsh is never touched
 * and `dsh` is never spawned: `main` takes an injectable runner.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const work = mkdtempSync(join(tmpdir(), 'vvoc-install-'))
process.env.VVOC_TEST_DSH_HOME = work
process.env.VVOC_TEST_CWD = join(work, 'project')

const { assertBundle, checkBundleSkills, installCommand, presetInstalled, reportBundle, BUNDLE_NAME } =
  await import('../lib/install.js')
const { bundleDir, profileDir } = await import('../lib/paths.js')
const { main } = await import('../lib/bin.js')

/** Record every spawn instead of running it. */
function recorder(code = 0) {
  const calls = []
  const run = (command, args) => { calls.push([command, ...args]); return code }
  return { calls, run }
}

test('bundle: манифест и патч на месте', () => {
  assertBundle()
  assert.ok(bundleDir().endsWith('agent-presets'), bundleDir())
})

test('bundle: шесть скиллов с валидным frontmatter', () => {
  const skills = checkBundleSkills()
  assert.equal(skills.length, 6)
  assert.ok(skills.every((skill) => skill.ok), skills.filter((s) => !s.ok).map((s) => s.name).join(','))
  for (const name of ['vv-spec', 'vv-plan', 'vv-execute', 'vv-review', 'vv-reflect', 'vv-handoff']) {
    assert.ok(skills.some((skill) => skill.name === name), name)
  }
})

test('presetInstalled: пустой профиль → false, бандл в списке → true', () => {
  assert.equal(presetInstalled('web'), false)
  mkdirSync(profileDir('web'), { recursive: true })
  writeFileSync(join(profileDir('web'), 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
  assert.equal(presetInstalled('web'), false)
  writeFileSync(join(profileDir('web'), 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', BUNDLE_NAME] } } }))
  assert.equal(presetInstalled('web'), true)
})

test('installCommand: dsh plugin --profile <p> add <bundle>', () => {
  assert.deepEqual(installCommand('web'), ['plugin', '--profile', 'web', 'add', bundleDir()])
})

test('install через main: спавнит dsh с профилем из --profile=', async () => {
  const { calls, run } = recorder(0)
  assert.equal(await main(['install', '--profile=demo'], run), 0)
  assert.deepEqual(calls, [['dsh', 'plugin', '--profile', 'demo', 'add', bundleDir()]])
})

test('install через main: ненулевой код dsh пробрасывается', async () => {
  const { run } = recorder(3)
  assert.equal(await main(['install'], run), 3)
})

test('sync через main: exit 0 при валидных скиллах', async () => {
  const { run } = recorder(0)
  assert.equal(await main(['sync'], run), 0)
})

test('status через main → exit 0 и отчёт о бандле', async () => {
  assert.equal(await main(['status']), 0)
  const report = reportBundle('web')
  assert.equal(report.installed, true)
  assert.equal(report.skills.length, 6)
})

/**
 * vvoc install/sync/status tests: copy the repo preset into a FAKE DSH home,
 * validate the installed skills, and exercise sync/status exit codes. The real
 * ~/.dsh is never touched.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const work = mkdtempSync(join(tmpdir(), 'vvoc-install-'))
process.env.VVOC_TEST_DSH_HOME = work
process.env.VVOC_TEST_CWD = join(work, 'project')

const { checkInstalledPreset, installPreset } = await import('../lib/install.js')
const { installedPresetDir } = await import('../lib/paths.js')
const { main } = await import('../lib/bin.js')

test('install: копирует пресет и не перезаписывает без --force', async () => {
  const first = installPreset(false)
  assert.equal(first.copied, true)
  assert.throws(() => installPreset(false), /--force/)
  const forced = installPreset(true)
  assert.equal(forced.copied, true)
  assert.ok(forced.backup !== undefined)
})

test('sync: скиллы установленного пресета валидны', () => {
  const report = checkInstalledPreset()
  assert.equal(report.installed, true)
  assert.ok(report.skills.length >= 6)
  assert.ok(report.skills.every((skill) => skill.ok), report.skills.filter((skill) => !skill.ok).map((skill) => skill.name).join(','))
  assert.ok(report.skills.some((skill) => skill.name === 'vv-spec'))
  assert.ok(report.skills.some((skill) => skill.name === 'vv-execute'))
})

test('status и sync через main → exit 0', async () => {
  assert.equal(await main(['status']), 0)
  assert.equal(await main(['sync']), 0)
})

test('install через main: повтор без --force → exit 1', async () => {
  assert.equal(await main(['install']), 1)
  assert.equal(await main(['install', '--force']), 0)
})

test('установленный пресет содержит композицию и preset.yml', () => {
  const dir = installedPresetDir()
  assert.ok(existsSync(join(dir, 'agent.cordis.yml')))
  assert.ok(existsSync(join(dir, 'preset.yml')))
  assert.ok(readFileSync(join(dir, 'preset.yml'), 'utf8').includes('vv-controller'))
})


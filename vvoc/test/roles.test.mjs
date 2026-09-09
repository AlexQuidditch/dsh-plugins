/**
 * vvoc roles/preset tests: JSON round-trips against a fake DSH home and a fake
 * project cwd — the real ~/.dsh and the real workspace are never touched.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const work = mkdtempSync(join(tmpdir(), 'vvoc-roles-'))
const home = join(work, 'home')
const project = join(work, 'project')
process.env.VVOC_TEST_DSH_HOME = home
process.env.VVOC_TEST_CWD = project

const { configPath, listRoles, setRole, unsetRole, validateModel, validateRoleId, applyPreset, listPresets, readConfig } = await import('../lib/roles.js')
const { main } = await import('../lib/bin.js')

test('validateRoleId и validateModel', () => {
  assert.equal(validateRoleId('reviewer'), undefined)
  assert.ok(validateRoleId('Bad Role') !== undefined)
  assert.equal(validateModel('deepseek/deepseek-v4-pro'), undefined)
  assert.ok(validateModel('no-slash') !== undefined)
  assert.ok(validateModel('a/b/c') !== undefined)
})

test('role set/list/unset: project scope', async () => {
  assert.equal(await main(['role', 'set', 'reviewer', 'deepseek/deepseek-v4-pro']), 0)
  const rows = listRoles()
  assert.ok(rows.some((row) => row.role === 'reviewer' && row.model === 'deepseek/deepseek-v4-pro' && row.scope === 'project'))
  assert.equal(await main(['role', 'unset', 'reviewer']), 0)
  assert.ok(!listRoles().some((row) => row.role === 'reviewer'))
})

test('role set: global scope пишет в home', async () => {
  assert.equal(await main(['role', 'set', 'smart', 'openai/gpt-5', '--global']), 0)
  const global = readConfig(configPath(true))
  assert.equal(global.roles?.smart, 'openai/gpt-5')
})

test('role set: невалидные аргументы → exit 1', async () => {
  assert.equal(await main(['role', 'set', 'Bad Role', 'x/y']), 1)
  assert.equal(await main(['role', 'set', 'ok', 'not-a-model']), 1)
  assert.equal(await main(['role', 'unset', 'missing-role']), 1)
})

test('preset: создать через конфиг, применить, показать', async () => {
  const projectConfig = configPath(false)
  const { writeConfig, readConfig: read } = await import('../lib/roles.js')
  writeConfig(projectConfig, { presets: { 'vv-deepseek': { default: 'deepseek/deepseek-v4-flash', reviewer: 'deepseek/deepseek-v4-pro' } } })
  assert.equal(await main(['preset', 'list']), 0)
  assert.equal(await main(['preset', 'show', 'vv-deepseek']), 0)
  assert.equal(await main(['preset', 'vv-deepseek']), 0)
  assert.equal(read(projectConfig).roles?.reviewer, 'deepseek/deepseek-v4-pro')
  assert.equal(await main(['preset', 'no-such-preset']), 1)
})


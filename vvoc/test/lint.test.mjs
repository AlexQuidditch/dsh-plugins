/**
 * vvoc lint tests: the internal engine drives fixtures covering the vv
 * format contract; exit codes are exercised through the `main` entry with a
 * fake cwd so the real ~/.dsh is never touched.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const work = mkdtempSync(join(tmpdir(), 'vvoc-lint-'))
process.env.VVOC_TEST_CWD = work

const { lintXml, parseXmlLite } = await import('../lib/lint.js')

const VALID_DRAFT = '<spec package="p" status="draft"><goals/><requirements/><acceptance/></spec>'
const VALID_APPROVED = '<spec package="p" status="approved"><goals><goal>g</goal></goals>'
  + '<requirements><requirement/></requirements><acceptance><criterion>c</criterion></acceptance>'
  + '<COMPONENT-CACHE-STORE>x</COMPONENT-CACHE-STORE></spec>'

test('parseXmlLite: дерево и текст', () => {
  const tree = parseXmlLite('<spec package="p"><goals><goal>g</goal></goals></spec>')
  assert.equal(tree.name, 'spec')
  assert.equal(tree.attrs.package, 'p')
  assert.equal(tree.children[0].children[0].text, 'g')
})

test('parseXmlLite: битый XML бросает', () => {
  assert.throws(() => parseXmlLite('<spec>'), /unclosed/)
  assert.throws(() => parseXmlLite('<a><b></a>'), /closes/)
})

test('lintXml spec: валидный draft без ошибок', () => {
  assert.equal(lintXml(VALID_DRAFT, 'spec').errors.length, 0)
})

test('lintXml spec: approved с пустыми секциями → completeness', () => {
  const verdict = lintXml(VALID_DRAFT, 'spec', { status: 'approved' })
  assert.ok(verdict.errors.some((e) => e.rule === 'completeness'))
})

test('lintXml spec: валидный approved', () => {
  assert.equal(lintXml(VALID_APPROVED, 'spec').errors.length, 0)
})

test('lintXml spec: неизвестный статус', () => {
  assert.ok(lintXml(VALID_DRAFT.replace('draft', 'bogus'), 'spec').errors.some((e) => e.rule === 'status'))
})

test('lintXml spec: дубль компонента', () => {
  const spec = '<spec package="p" status="draft"><COMPONENT-A/><COMPONENT-A/></spec>'
  assert.ok(lintXml(spec, 'spec').errors.some((e) => e.rule === 'identity'))
})

test('lintXml plan: ссылки и циклы', () => {
  const badRef = '<plan package="p" status="draft"><WAVE-1><task_id>TASK-T-999</task_id></WAVE-1></plan>'
  assert.ok(lintXml(badRef, 'plan').errors.some((e) => e.rule === 'reference'))
  const cycle = '<plan package="p" status="draft">'
    + '<TASK-T-001><depends_on><task_id>TASK-T-002</task_id></depends_on></TASK-T-001>'
    + '<TASK-T-002><depends_on><task_id>TASK-T-001</task_id></depends_on></TASK-T-002></plan>'
  assert.ok(lintXml(cycle, 'plan').errors.some((e) => e.rule === 'dependency'))
})

test('lintXml plan: подмножество компонентов спеки', () => {
  const plan = '<plan package="p" status="draft"><COMPONENT-NEW/></plan>'
  assert.ok(lintXml(plan, 'plan', { specText: VALID_APPROVED }).errors.some((e) => e.rule === 'spec-subset'))
  assert.ok(lintXml(plan, 'plan').warnings.some((w) => w.rule === 'spec-subset'))
})

test('lint команда: exit code через main', async () => {
  const specs = join(work, '.vvoc', 'specs', '2026-09-09-cache')
  mkdirSync(specs, { recursive: true })
  writeFileSync(join(specs, 'spec.xml'), VALID_APPROVED)
  writeFileSync(join(specs, 'plan.xml'), '<plan package="p" status="approved"><COMPONENT-CACHE-STORE/>'
    + '<TASK-T-001><title>t</title><acceptance><criterion>c</criterion></acceptance><verify><command>pnpm test</command></verify></TASK-T-001></plan>')
  const { main } = await import('../lib/bin.js')
  assert.equal(await main(['lint']), 0)
  writeFileSync(join(specs, 'spec.xml'), '<spec package="p">')
  assert.equal(await main(['lint']), 1)
  rmSync(join(work, '.vvoc'), { recursive: true, force: true })
})


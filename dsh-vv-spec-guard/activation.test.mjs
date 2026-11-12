/**
 * Изолированный тест dsh-vv-spec-guard (после сборки).
 *
 * Юнит-кейсы линтера (ядро пакета) + активация плагина с stub fs/tools и
 * вызовом пробного тула. Живой DSH не трогается.
 *
 * Запуск: node activation.test.mjs   (после pnpm run build)
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import * as plugin from './lib/index.js'
import { evidenceVerdict, lintFile, parseReceiptsJsonl, verdictLine } from './lib/index.js'
import { classifyPlanRisk, lintSpec, lintPlan, parseXmlLite } from './lib/lint.js'

let failed = 0
function check(name, condition, detail = '') {
  if (condition) { console.log('ok  -', name); return }
  failed += 1
  console.log('FAIL -', name, detail)
}

// ── parseXmlLite ────────────────────────────────────────────────────────────
const tree = parseXmlLite('<spec package="p"><goals><goal>g</goal></goals></spec>')
check('parse: root spec', tree.name === 'spec' && tree.attrs.package === 'p')
check('parse: text captured', tree.children[0].children[0].text === 'g')
let threw = false
try { parseXmlLite('<spec><goals></spec>') } catch { threw = true }
check('parse: mismatched close throws', threw)
threw = false
try { parseXmlLite('<spec>') } catch { threw = true }
check('parse: unclosed throws', threw)
threw = false
try { parseXmlLite('<a></a><b></b>') } catch { threw = true }
check('parse: multiple roots throws', threw)

// ── lintSpec ────────────────────────────────────────────────────────────────
const VALID_DRAFT = '<spec package="2026-09-09-cache" status="draft"><goals/><requirements/><acceptance/></spec>'
const VALID_APPROVED = '<spec package="2026-09-09-cache" status="approved">'
  + '<goals><goal>Сделать кэш</goal></goals>'
  + '<requirements><requirement><id>REQ-001</id></requirement></requirements>'
  + '<acceptance><criterion>Кэш работает</criterion></acceptance>'
  + '<COMPONENT-CACHE-STORE>store</COMPONENT-CACHE-STORE></spec>'

check('spec: valid draft', lintSpec(VALID_DRAFT).errors.length === 0)
check('spec: approved with empty sections → errors', lintSpec(VALID_DRAFT, { status: 'approved' }).errors.length >= 3)
check('spec: valid approved', lintSpec(VALID_APPROVED).errors.length === 0)
check('spec: unknown status', lintSpec(VALID_DRAFT.replace('draft', 'bogus')).errors.some((e) => e.rule === 'status'))
check('spec: duplicate component', lintSpec('<spec package="p" status="draft"><COMPONENT-A/><COMPONENT-A/></spec>').errors.some((e) => e.rule === 'identity'))
check('spec: bad component shape', lintSpec('<spec package="p" status="draft"><COMPONENT-lower/></spec>').errors.some((e) => e.rule === 'identity'))
check('spec: malformed xml', lintSpec('<spec package="p">').errors.some((e) => e.rule === 'well-formed'))
check('spec: malformed message has one prefix', lintSpec('<spec package="p">').errors
  .filter((e) => e.rule === 'well-formed')
  .every((e) => !e.message.startsWith('malformed XML: malformed XML:')))

// ── lintPlan ────────────────────────────────────────────────────────────────
const PLAN_BASE = '<plan package="2026-09-09-cache" status="draft">'
const TASK_OK = '<TASK-T-001><title>t</title><depends_on><task_id>TASK-T-000</task_id></depends_on>'
  + '<acceptance><criterion>c</criterion></acceptance><verify><command>pnpm test</command></verify></TASK-T-001>'
const TASK_000 = '<TASK-T-000><title>base</title><acceptance><criterion>c</criterion></acceptance>'
  + '<verify><command>pnpm test</command></verify></TASK-T-000>'
const WAVE = '<WAVE-1><task_id>TASK-T-000</task_id><task_id>TASK-T-001</task_id></WAVE-1>'

check('plan: valid draft', lintPlan(`${PLAN_BASE}${TASK_000}${TASK_OK}${WAVE}</plan>`).errors.length === 0)
check('plan: duplicate task', lintPlan(`${PLAN_BASE}${TASK_000}${TASK_000}</plan>`).errors.some((e) => e.rule === 'identity'))
check('plan: wave references unknown task', lintPlan(`${PLAN_BASE}<WAVE-1><task_id>TASK-T-999</task_id></WAVE-1></plan>`).errors.some((e) => e.rule === 'reference'))
check('plan: depends_on unknown task', lintPlan(`${PLAN_BASE}<TASK-T-001><depends_on><task_id>TASK-T-999</task_id></depends_on></TASK-T-001></plan>`).errors.some((e) => e.rule === 'reference'))
const BARE_TASK = '<TASK-T-001><title>t</title></TASK-T-001>'
check('plan: approved task without verify', lintPlan(`${PLAN_BASE}${BARE_TASK}</plan>`.replace('draft', 'approved')).errors.some((e) => e.rule === 'completeness'))
const CYCLE = '<TASK-T-001><depends_on><task_id>TASK-T-002</task_id></depends_on></TASK-T-001>'
  + '<TASK-T-002><depends_on><task_id>TASK-T-001</task_id></depends_on></TASK-T-002>'
check('plan: dependency cycle', lintPlan(`${PLAN_BASE}${CYCLE}</plan>`).errors.some((e) => e.rule === 'dependency'))
check('plan: component not in spec', lintPlan(`${PLAN_BASE}<COMPONENT-NEW/></plan>`, { specText: VALID_APPROVED }).errors.some((e) => e.rule === 'spec-subset'))
check('plan: no spec → warning only', lintPlan(`${PLAN_BASE}<COMPONENT-NEW/></plan>`).errors.length === 0
  && lintPlan(`${PLAN_BASE}<COMPONENT-NEW/></plan>`).warnings.some((w) => w.rule === 'spec-subset'))
check('plan: component in spec passes', lintPlan(`${PLAN_BASE}<COMPONENT-CACHE-STORE/></plan>`, { specText: VALID_APPROVED }).errors.length === 0)

// ── verdictLine ─────────────────────────────────────────────────────────────
check('verdictLine bounded', verdictLine({ errors: [{ rule: 'x', message: 'очень длинное сообщение' }], warnings: [] }, 40).length <= 40)
check('verdictLine: stale-approval kept in bounded line', verdictLine({
  errors: [
    { rule: 'a', message: 'one' },
    { rule: 'b', message: 'two' },
    { rule: 'c', message: 'three' },
    { rule: 'stale-approval', message: 'STALE APPROVAL: plan.xml changed' },
  ],
  warnings: [],
}, 200).includes('stale-approval'))
check('lintFile: legacy string specText arg still works', lintFile(
  'plan.xml',
  '<plan package="p" status="draft"><COMPONENT-CACHE-STORE/></plan>',
  VALID_APPROVED,
).errors.length === 0)

// ── §N classifyPlanRisk ─────────────────────────────────────────────────────
const RISK_PLAN = (body) => `<plan package="2026-09-09-risk" status="draft">${body}</plan>`
const authRisk = classifyPlanRisk(RISK_PLAN('<TASK-T-001><file>src/auth/guard.ts</file></TASK-T-001>'))
check('risk: auth path → mandatory', authRisk.level === 'mandatory'
  && authRisk.reasons.some((reason) => reason.category === 'auth_secrets_permissions'
    && reason.evidence.includes('src/auth/guard.ts')))
const negatedRisk = classifyPlanRisk(RISK_PLAN('<TASK-T-001><file>src/cache/store.ts</file></TASK-T-001>'
  + '<description>no auth changes; do not modify permissions</description>'))
check('risk: negation "no auth changes" → standard', negatedRisk.level === 'standard' && negatedRisk.reasons.length === 0)
const secretRisk = classifyPlanRisk(RISK_PLAN('<description>old key AKIAIOSFODNN7EXAMPLE</description>'))
check('risk: secret literal → mandatory', secretRisk.level === 'mandatory'
  && secretRisk.reasons.some((reason) => reason.category === 'auth_secrets_permissions'
    && reason.evidence.includes('AKIA')))
const plainRisk = classifyPlanRisk(RISK_PLAN('<TASK-T-001><title>Add cache store</title><file>src/cache/store.ts</file>'
  + '<verification><command>pnpm test</command></verification></TASK-T-001>'))
check('risk: plain cache plan → standard', plainRisk.level === 'standard' && plainRisk.reasons.length === 0)
const unparsableRisk = classifyPlanRisk('<plan><file>src/auth/x.ts</file>')
check('risk: unparsable text → standard with note', unparsableRisk.level === 'standard'
  && typeof unparsableRisk.note === 'string' && unparsableRisk.reasons.length === 0)
check('risk: migrations path → destructive_data_schema', classifyPlanRisk(RISK_PLAN('<file>db/migrations/001_init.sql</file>'))
  .reasons.some((reason) => reason.category === 'destructive_data_schema'))
check('risk: CI workflow path → deployment_release_supply_chain', classifyPlanRisk(RISK_PLAN('<file>.github/workflows/ci.yml</file>'))
  .reasons.some((reason) => reason.category === 'deployment_release_supply_chain'))
check('risk: breaking change keyword → public_compatibility', classifyPlanRisk(RISK_PLAN('<requirement>breaking change in the public API</requirement>'))
  .reasons.some((reason) => reason.category === 'public_compatibility'))
check('risk: keyword report is short', classifyPlanRisk(RISK_PLAN('<description>retry the upload</description>'))
  .reasons.every((reason) => reason.evidence.length <= 100))

// ── §K stale-approval / approval-unverified ─────────────────────────────────
const APPROVED_PLAN_EMPTY = '<plan package="2026-09-09-cache" status="approved"></plan>'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const staleFinding = lintPlan(APPROVED_PLAN_EMPTY, { approval: { sha256: SHA_A }, currentSha256: SHA_B })
  .errors.find((error) => error.rule === 'stale-approval')
check('stale-approval: digest mismatch → error', staleFinding !== undefined
  && staleFinding.message.includes('STALE APPROVAL: plan.xml changed after approval')
  && staleFinding.message.includes('recorded aaaaaaaaaaaa, current bbbbbbbbbbbb')
  && staleFinding.message.includes('— re-approval required'))
check('stale-approval: digest match → no stale error', !lintPlan(APPROVED_PLAN_EMPTY, {
  approval: { sha256: SHA_A.toUpperCase() },
  currentSha256: SHA_A,
}).errors.some((error) => error.rule === 'stale-approval'))
check('approval-unverified: approved + no record → warning', lintPlan(APPROVED_PLAN_EMPTY).warnings
  .some((warning) => warning.rule === 'approval-unverified'))
check('stale-approval: draft never checked', lintPlan(APPROVED_PLAN_EMPTY.replace('approved', 'draft'), {
  approval: { sha256: SHA_A },
  currentSha256: SHA_B,
}).errors.length === 0)
check('stale-approval: spec covered too', lintSpec('<spec package="p" status="approved"></spec>', {
  approval: { sha256: SHA_A },
  currentSha256: SHA_B,
}).errors.some((error) => error.rule === 'stale-approval'))
// Reaching `applied` is the executor's own lifecycle flip: the clearance was
// consumed by execution, so an applied artifact is never "stale" against the
// digest recorded while it was approved.
check('stale-approval: applied consumes the clearance (no false stale)', !lintPlan(
  APPROVED_PLAN_EMPTY.replace('approved', 'applied'),
  { approval: { sha256: SHA_A }, currentSha256: SHA_B },
).errors.some((error) => error.rule === 'stale-approval'))
// vv templates (unique-tag format) carry status as a direct child element.
// Their element vocabulary differs, so legacy structural rules stay quiet and
// only the format-agnostic §K/§L checks apply.
const childStatusSpec = lintSpec('<spec package="p"><status>approved</status></spec>')
check('status: child <status> drives §K, not legacy completeness', childStatusSpec.warnings
  .some((warning) => warning.rule === 'approval-unverified')
  && !childStatusSpec.errors.some((error) => error.rule === 'completeness'))
const CHILD_STATUS_APPLIED_PLAN = '<plan package="p"><status>applied</status><TASK-T-001><title>t</title>'
  + '<acceptance><criterion>c</criterion></acceptance>'
  + '<verification><command>pnpm test</command></verification></TASK-T-001></plan>'
check('status: child <status> drives §L receipt rules', lintPlan(CHILD_STATUS_APPLIED_PLAN).errors
  .some((error) => error.rule === 'receipt-missing'))
check('status: child <status> drives §K approval warning', lintPlan(CHILD_STATUS_APPLIED_PLAN).warnings
  .some((warning) => warning.rule === 'approval-unverified'))

// ── §L receipts ─────────────────────────────────────────────────────────────
const APPLIED_PLAN = '<plan package="2026-09-09-cache" status="applied"><TASK-T-001><title>t</title>'
  + '<acceptance><criterion>c</criterion></acceptance>'
  + '<verification><command>pnpm test</command></verification></TASK-T-001></plan>'
check('receipts: applied + no receipts → receipt-missing', lintPlan(APPLIED_PLAN).errors
  .some((error) => error.rule === 'receipt-missing'))
check('receipts: exit 1 only → receipt-failed', lintPlan(APPLIED_PLAN, {
  receipts: [{ command: 'pnpm test', exit_code: 1 }],
}).errors.some((error) => error.rule === 'receipt-failed'))
check('receipts: exit 0 (trimmed command) → clean', lintPlan(APPLIED_PLAN, {
  receipts: [{ command: '  pnpm test  ', exit_code: 0 }],
}).errors.every((error) => !error.rule.startsWith('receipt-')))
check('receipts: draft plan → no receipt requirement', lintPlan(APPLIED_PLAN.replace('applied', 'draft')).errors
  .every((error) => !error.rule.startsWith('receipt-')))
check('receipts: approved + checkReceipts → receipt-missing', lintPlan(APPLIED_PLAN.replace('applied', 'approved'), {
  checkReceipts: true,
}).errors.some((error) => error.rule === 'receipt-missing'))
const LEGACY_APPLIED_PLAN = APPLIED_PLAN
  .replace(/<verification>/g, '<verify>')
  .replace(/<\/verification>/g, '</verify>')
check('receipts: legacy <verify>/<command> covered', lintPlan(LEGACY_APPLIED_PLAN).errors
  .some((error) => error.rule === 'receipt-missing'))
check('receipts: parse tolerates malformed lines', (() => {
  const parsed = parseReceiptsJsonl('not json\n{"command":"pnpm test","exit_code":0,"provenance":"executor"}\n')
  return parsed.receipts.length === 1 && parsed.malformed.length === 1 && parsed.malformed[0].line === 1
})())

// ── §M evidenceVerdict ─────────────────────────────────────────────────────
const EVIDENCE_TEXT = 'line one\nline two\nline three\n'
const expectedDigest = createHash('sha256').update('line two\nline three', 'utf8').digest('hex')
const evidenceMatch = evidenceVerdict(EVIDENCE_TEXT, 2, 3, 'line two\nline three')
check('evidence: MATCH + anchor_digest', evidenceMatch.startsWith('MATCH')
  && evidenceMatch.includes(`anchor_digest=${expectedDigest}`))
const evidenceMismatch = evidenceVerdict(EVIDENCE_TEXT, 2, 3, 'line two\nline X')
check('evidence: MISMATCH shows actual lines', evidenceMismatch.startsWith('MISMATCH')
  && evidenceMismatch.includes('2: line two') && evidenceMismatch.includes('3: line three'))
check('evidence: OUT_OF_RANGE outside file', evidenceVerdict(EVIDENCE_TEXT, 1, 9, 'x').startsWith('OUT_OF_RANGE'))
check('evidence: start > end → OUT_OF_RANGE', evidenceVerdict(EVIDENCE_TEXT, 3, 2, 'x').startsWith('OUT_OF_RANGE'))
check('evidence: UNREADABLE', evidenceVerdict(null, 1, 1, 'x') === 'UNREADABLE')
check('evidence: CRLF file vs LF excerpt → MATCH', evidenceVerdict('a\r\nb\r\n', 1, 2, 'a\nb').startsWith('MATCH'))
check('evidence: trailing newline does not create a line', evidenceVerdict('only\n', 1, 1, 'only').startsWith('MATCH')
  && evidenceVerdict('only\n', 1, 2, 'x').startsWith('OUT_OF_RANGE'))

// ── активация плагина + пробный тул ─────────────────────────────────────────
// 0.2.2: `resolve(path, { cwd })` → FsTarget, все чтения принимают target.
class StubFs extends Service {
  constructor(ctx) { super(ctx, 'fs') }
  async resolve(path, opts = {}) {
    const cwd = typeof opts.cwd === 'string' ? opts.cwd : '/'
    const absolute = path.startsWith('/') ? path : `${cwd}/${path}`
    return { targetKey: absolute, displayPath: absolute }
  }
  async readText(target) {
    const path = String(target.targetKey)
    if (path.endsWith('spec.xml')) return VALID_APPROVED
    if (path.endsWith('plan.xml')) return `${PLAN_BASE}<COMPONENT-CACHE-STORE/></plan>`
    throw new Error('no such file: ' + path)
  }
}
// 0.1-era host: no resolve(); the bundle must keep the legacy raw-key shape.
class StubLegacyFs extends Service {
  constructor(ctx) { super(ctx, 'fs') }
  async readText(target) {
    const path = String(target.targetKey)
    if (path.endsWith('spec.xml')) return VALID_APPROVED
    if (path.endsWith('plan.xml')) return `${PLAN_BASE}<COMPONENT-CACHE-STORE/></plan>`
    throw new Error('no such file: ' + path)
  }
}
class StubTools extends Service {
  constructor(ctx) { super(ctx, 'tools'); this.registered = [] }
  register(definition) { this.registered.push(definition); return () => {} }
}

const root = new Context()
await root.plugin(StubFs)
await root.plugin(StubTools)
await root.plugin(plugin, { probeTool: true })

const tools = root.tools
const probe = tools.registered.find((d) => d.name === 'spec_guard_lint')
if (!probe) throw new Error('spec_guard_lint не зарегистрирован')

const result = await probe.execute({ path: '/proj/.vvoc/specs/2026-09-09-cache' })
if (typeof result !== 'string' || !result.includes('spec.xml') || !result.includes('plan.xml')) {
  throw new Error('неожиданный ответ тула: ' + result)
}
console.log('--- probe tool output ---')
console.log(result)
console.log('-------------------------')

// Регрессия 0.2.2: относительный путь разрешается от cwd сессии, а не
// принимается за targetKey (иначе — cannot read "undefined": not found).
const relativeResult = await probe.execute(
  { path: '.vvoc/specs/2026-09-09-cache' },
  { agent: { session: { header: { cwd: '/proj' } } } },
)
if (typeof relativeResult !== 'string' || relativeResult.includes('unreadable') || !relativeResult.includes('0 errors')) {
  throw new Error('относительный путь не разрешился от cwd сессии: ' + relativeResult)
}
check('probe: относительный путь от cwd сессии', relativeResult.includes('0 errors'))

const malformedResult = await probe.execute({ path: '/proj/.vvoc/specs/2026-09-09-cache/plan.xml' })
if (typeof malformedResult !== 'string' || !malformedResult.includes('0 errors')) {
  throw new Error('план с компонентом спеки должен линтоваться чисто: ' + malformedResult)
}

await root.fiber.dispose()

// Legacy host (no fs.resolve): the raw { targetKey: path } shape still works.
const legacyRoot = new Context()
await legacyRoot.plugin(StubLegacyFs)
await legacyRoot.plugin(StubTools)
await legacyRoot.plugin(plugin, { probeTool: true })
const legacyProbe = legacyRoot.tools.registered.find((d) => d.name === 'spec_guard_lint')
const legacyResult = await legacyProbe.execute({ path: '/proj/.vvoc/specs/2026-09-09-cache' })
check('probe: legacy host без fs.resolve', typeof legacyResult === 'string' && legacyResult.includes('0 errors'))
await legacyRoot.fiber.dispose()

// ── новые тулы: approve (§K), evidence (§M), §K/§L-обвязка линта ────────────
// Реальный fs-стаб поверх node:fs — тулы работают с настоящими файлами во
// временном пакете, как в живом хосте (в отличие от канонических /proj выше).
class RealFileFs extends Service {
  constructor(ctx) { super(ctx, 'fs') }
  async resolve(path, opts = {}) {
    const cwd = typeof opts.cwd === 'string' ? opts.cwd : process.cwd()
    const absolute = path.startsWith('/') ? path : join(cwd, path)
    return { targetKey: absolute, displayPath: absolute }
  }
  async readText(target) {
    return readFileSync(String(target.targetKey), 'utf8')
  }
}

const workDir = mkdtempSync(join(process.cwd(), '.test-tmp-'))
try {
  const toolRoot = new Context()
  await toolRoot.plugin(RealFileFs)
  await toolRoot.plugin(StubTools)
  await toolRoot.plugin(plugin, {})

  const toolDefs = toolRoot.tools.registered
  const approveTool = toolDefs.find((definition) => definition.name === 'spec_guard_approve')
  const evidenceTool = toolDefs.find((definition) => definition.name === 'spec_guard_evidence')
  const lintTool = toolDefs.find((definition) => definition.name === 'spec_guard_lint')
  check('tools: lint/approve/evidence registered', approveTool !== undefined
    && evidenceTool !== undefined && lintTool !== undefined)

  const approvedPlan = '<plan package="2026-09-09-tools" status="approved"><TASK-T-001><title>t</title>'
    + '<acceptance><criterion>c</criterion></acceptance>'
    + '<verification><command>pnpm test</command></verification></TASK-T-001></plan>'
  const digestOf = (name) => createHash('sha256').update(readFileSync(join(workDir, name))).digest('hex')

  // §K: не-approved артефакт — типизированный отказ и никакой записи.
  writeFileSync(join(workDir, 'plan.xml'), '<plan package="2026-09-09-tools" status="draft"></plan>')
  const refusal = await approveTool.execute({ path: workDir })
  check('approve: draft refusal, no write', refusal.includes('status must be approved, found draft')
    && !existsSync(join(workDir, 'approvals.json')))

  // §K: запись digest + замена последней записью на артефакт.
  writeFileSync(join(workDir, 'plan.xml'), approvedPlan)
  const approveOne = await approveTool.execute({ path: join(workDir, 'plan.xml') })
  const sidecarOne = JSON.parse(readFileSync(join(workDir, 'approvals.json'), 'utf8'))
  check('approve: records artifact + full sha256 + sidecar path', approveOne.includes('plan.xml: digest recorded')
    && approveOne.includes(`sha256: ${digestOf('plan.xml')}`)
    && approveOne.includes('approvals.json')
    && sidecarOne.approvals.length === 1
    && sidecarOne.approvals[0].artifact === 'plan.xml'
    && sidecarOne.approvals[0].sha256 === digestOf('plan.xml')
    && sidecarOne.approvals[0].status_at_approval === 'approved'
    && typeof sidecarOne.approvals[0].approved_at === 'string')

  writeFileSync(join(workDir, 'plan.xml'), `${approvedPlan}\n<!-- reapproved -->`)
  await approveTool.execute({ path: workDir })
  const sidecarReplaced = JSON.parse(readFileSync(join(workDir, 'approvals.json'), 'utf8'))
  check('approve: last entry per artifact wins', sidecarReplaced.approvals
    .filter((entry) => entry.artifact === 'plan.xml').length === 1
    && sidecarReplaced.approvals[0].sha256 === digestOf('plan.xml'))

  // §K: директория пакета одобряет оба существующих артефакта.
  writeFileSync(join(workDir, 'spec.xml'), '<spec package="2026-09-09-tools" status="approved"></spec>')
  const approveBoth = await approveTool.execute({ path: workDir })
  const sidecarBoth = JSON.parse(readFileSync(join(workDir, 'approvals.json'), 'utf8'))
  const specDigest = digestOf('spec.xml')
  check('approve: package dir approves both artifacts', approveBoth.includes('spec.xml: digest recorded')
    && approveBoth.includes('plan.xml: digest recorded') && sidecarBoth.approvals.length === 2)

  writeFileSync(join(workDir, 'plan.xml'), `${approvedPlan}\n<!-- reapproved twice -->`)
  await approveTool.execute({ path: workDir })
  const sidecarHistory = JSON.parse(readFileSync(join(workDir, 'approvals.json'), 'utf8'))
  check('approve: other artifact history kept', sidecarHistory.approvals.length === 2
    && sidecarHistory.approvals.some((entry) => entry.artifact === 'spec.xml' && entry.sha256 === specDigest)
    && sidecarHistory.approvals.some((entry) => entry.artifact === 'plan.xml' && entry.sha256 === digestOf('plan.xml')))

  // §K: битый sidecar не фатален — warning + свежий файл.
  writeFileSync(join(workDir, 'approvals.json'), 'not json at all')
  const corruptResult = await approveTool.execute({ path: workDir })
  const sidecarRecovered = JSON.parse(readFileSync(join(workDir, 'approvals.json'), 'utf8'))
  check('approve: corrupt sidecar → warning + fresh file', corruptResult.includes('corrupt')
    && sidecarRecovered.approvals.length === 2)

  // §K-обвязка линта: совпадающие digest'ы — чисто.
  const freshLint = await lintTool.execute({ path: workDir })
  check('lint wiring: matching approvals → no stale/unverified', !freshLint.includes('stale-approval')
    && !freshLint.includes('approval-unverified'))

  // Правка approved-плана без повторного approve → stale-approval.
  writeFileSync(join(workDir, 'plan.xml'), `${approvedPlan}\n<!-- edited after approval -->`)
  const staleLint = await lintTool.execute({ path: workDir })
  check('lint wiring: edited approved plan → stale-approval', staleLint.includes('[stale-approval]')
    && staleLint.includes('STALE APPROVAL'))
  await approveTool.execute({ path: workDir })

  // §K: sidecar отсутствует → warning, не error.
  rmSync(join(workDir, 'approvals.json'))
  const unverifiedLint = await lintTool.execute({ path: workDir })
  check('lint wiring: no sidecar → approval-unverified warning', unverifiedLint.includes('[approval-unverified]'))

  // §L-обвязка линта: applied-план требует receipts. Digest записывается на
  // approved-байтах (как в реальном flow), затем executor сам флипает статус
  // в applied — это легальная смена байтов, stale-approval быть не должно.
  writeFileSync(join(workDir, 'spec.xml'), '<spec package="2026-09-09-tools" status="approved"></spec>')
  writeFileSync(join(workDir, 'plan.xml'), approvedPlan)
  await approveTool.execute({ path: workDir })
  const appliedPlan = approvedPlan.replace('status="approved"', 'status="applied"')
  writeFileSync(join(workDir, 'plan.xml'), appliedPlan)
  const missingReceiptLint = await lintTool.execute({ path: workDir })
  check('lint wiring: applied plan without receipts → receipt-missing', missingReceiptLint.includes('[receipt-missing]'))
  check('lint wiring: approved→applied flip is not stale-approval', !missingReceiptLint.includes('[stale-approval]'))
  writeFileSync(join(workDir, 'receipts.jsonl'), '{"task_id":"T-001","command":"pnpm test","exit_code":1,"provenance":"executor"}\n')
  const failedReceiptLint = await lintTool.execute({ path: workDir })
  check('lint wiring: exit 1 receipt → receipt-failed', failedReceiptLint.includes('[receipt-failed]'))
  writeFileSync(join(workDir, 'receipts.jsonl'), '{"task_id":"T-001","command":"pnpm test","exit_code":0,"provenance":"executor"}\n')
  const cleanReceiptLint = await lintTool.execute({ path: workDir })
  check('lint wiring: exit 0 receipt → clean', !cleanReceiptLint.includes('[receipt-missing]')
    && !cleanReceiptLint.includes('[receipt-failed]'))
  writeFileSync(join(workDir, 'receipts.jsonl'), 'this line is not json\n{"task_id":"T-001","command":"pnpm test","exit_code":0}\n')
  const malformedReceiptLint = await lintTool.execute({ path: workDir })
  check('lint wiring: malformed receipt line → receipt-malformed', malformedReceiptLint.includes('[receipt-malformed]')
    && !malformedReceiptLint.includes('[receipt-missing]'))

  // §N: risk-строка в выводе линта для plan.xml.
  writeFileSync(join(workDir, 'plan.xml'), '<plan package="2026-09-09-tools" status="draft"><TASK-T-001><file>src/auth/guard.ts</file></TASK-T-001></plan>')
  const mandatoryRiskLint = await lintTool.execute({ path: join(workDir, 'plan.xml') })
  check('lint output: risk line mandatory', mandatoryRiskLint
    .includes('risk: mandatory (auth_secrets_permissions: src/auth/guard.ts'))
  writeFileSync(join(workDir, 'plan.xml'), '<plan package="2026-09-09-tools" status="draft"><TASK-T-001><file>src/cache/store.ts</file></TASK-T-001></plan>')
  const standardRiskLint = await lintTool.execute({ path: join(workDir, 'plan.xml') })
  check('lint output: risk line standard', standardRiskLint.includes('risk: standard'))

  // §M: тул evidence на реальных файлах.
  writeFileSync(join(workDir, 'evidence.txt'), 'alpha\nbeta\ngamma\n')
  const evidenceMatchTool = await evidenceTool.execute({
    path: join(workDir, 'evidence.txt'),
    start_line: 2,
    end_line: 3,
    excerpt: 'beta\ngamma',
  })
  check('evidence tool: MATCH + anchor_digest', evidenceMatchTool.startsWith('MATCH')
    && evidenceMatchTool.includes('anchor_digest='))
  const evidenceMismatchTool = await evidenceTool.execute({
    path: join(workDir, 'evidence.txt'),
    start_line: 2,
    end_line: 2,
    excerpt: 'wrong',
  })
  check('evidence tool: MISMATCH + actual line', evidenceMismatchTool.startsWith('MISMATCH')
    && evidenceMismatchTool.includes('2: beta'))
  const missingEvidence = await evidenceTool.execute({ path: join(workDir, 'missing.txt'), start_line: 1, end_line: 1, excerpt: 'x' })
  check('evidence tool: UNREADABLE', missingEvidence.startsWith('UNREADABLE'))
  const outOfRangeEvidence = await evidenceTool.execute({ path: join(workDir, 'evidence.txt'), start_line: 9, end_line: 10, excerpt: 'x' })
  check('evidence tool: OUT_OF_RANGE', outOfRangeEvidence.startsWith('OUT_OF_RANGE'))
  const relativeEvidence = await evidenceTool.execute(
    { path: 'evidence.txt', start_line: 1, end_line: 1, excerpt: 'alpha' },
    { agent: { session: { header: { cwd: workDir } } } },
  )
  check('evidence tool: relative path from session cwd', relativeEvidence.startsWith('MATCH'))

  await toolRoot.fiber.dispose()
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

if (failed > 0) { console.log(`FAILED: ${failed}`); process.exit(1) }
console.log('OK: линтер и плагин dsh-vv-spec-guard работают')

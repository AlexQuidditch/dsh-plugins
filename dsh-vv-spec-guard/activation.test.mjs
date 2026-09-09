/**
 * Изолированный тест dsh-vv-spec-guard (после сборки).
 *
 * Юнит-кейсы линтера (ядро пакета) + активация плагина с stub fs/tools и
 * вызовом пробного тула. Живой DSH не трогается.
 *
 * Запуск: node activation.test.mjs   (после pnpm run build)
 */
import { Context, Service } from '@deepseek-ai/cordis'
import * as plugin from './lib/index.js'
import { verdictLine } from './lib/index.js'
import { lintSpec, lintPlan, parseXmlLite } from './lib/lint.js'

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

// ── активация плагина + пробный тул ─────────────────────────────────────────
class StubFs extends Service {
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

const malformedResult = await probe.execute({ path: '/proj/.vvoc/specs/2026-09-09-cache/plan.xml' })
if (typeof malformedResult !== 'string' || !malformedResult.includes('0 errors')) {
  throw new Error('план с компонентом спеки должен линтоваться чисто: ' + malformedResult)
}

await root.fiber.dispose()

if (failed > 0) { console.log(`FAILED: ${failed}`); process.exit(1) }
console.log('OK: линтер и плагин dsh-vv-spec-guard работают')

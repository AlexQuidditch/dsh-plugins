/**
 * Deterministic lint engine for .vvoc spec packages — a zero-dependency port of
 * the SpecGuardPlugin contract from vv-opencode.
 *
 * The format contract lives in the vv-controller preset skills (vv-spec,
 * vv-plan): specs and plans are XML with snake_case fields, unique element
 * identities (`COMPONENT-UPPER-KEBAB`, `TASK-T-NNN`, `WAVE-N`), lifecycle
 * statuses draft/approved/applied, and plan architecture components must reuse
 * spec component identities exactly. This module checks those invariants in
 * code so models keep grep/sed as their query layer while drift is caught by
 * the host, not by discipline.
 *
 * No external XML library: a small tag-tokenizer with a stack check is enough
 * for the bounded artifact vocabulary.
 */

/** One lint finding. */
export interface LintFinding {
  /** Stable rule identifier. */
  rule: string
  /** Human-readable message, Russian. */
  message: string
}

/** A complete lint verdict. */
export interface LintVerdict {
  errors: LintFinding[]
  warnings: LintFinding[]
}

/** Minimal parsed XML element tree. */
export interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  /** Trimmed text directly inside this element (concatenated segments). */
  text?: string
}

const COMPONENT_RE = /^COMPONENT-[A-Z][A-Z0-9-]*$/
const TASK_RE = /^TASK-T-\d{3}$/
const WAVE_RE = /^WAVE-\d+$/
const STATUSES = new Set(['draft', 'approved', 'applied'])

/**
 * Parse a bounded XML document into an element tree.
 *
 * The tokenizer walks the document with a single regex over open/close/self-closing
 * tags, skips comments, declarations, and doctypes, and maintains a stack to
 * detect mismatched or unclosed tags. Text between tags is trimmed and attached
 * to the innermost open element, because several vv-plan references
 * (`<task_id>TASK-T-000</task_id>`) carry their value as text. A malformed
 * document throws instead of returning a partial tree.
 */
export function parseXmlLite(text: string): XmlNode {
  const TAG_RE = /<(\/?)([A-Za-z0-9_.-]+)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
  const stack: XmlNode[] = []
  let root: XmlNode | undefined
  // CDATA-aware (P1): protect <![CDATA[...]]> payloads from tag tokenization.
  // Snippets carry TS generics/JSX ('<T>', '<Component>') that the tokenizer would
  // otherwise read as markup (33/36 throwing archived plans). Replace each CDATA
  // block with a null-char sentinel, then restore verbatim content into element
  // text after parsing.
  const cdataContents: string[] = []
  const protectedText = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_match, content: string) => {
    const index = cdataContents.length
    cdataContents.push(content)
    return `\u0000CDATA${index}\u0000`
  })
  const clean = protectedText
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')

  let lastEnd = 0
  for (const match of clean.matchAll(TAG_RE)) {
    const index = match.index
    const plainText = clean.slice(lastEnd, index).trim()
    if (plainText !== '' && stack.length > 0) {
      const top = stack[stack.length - 1]
      top.text = top.text === undefined ? plainText : `${top.text} ${plainText}`
    }
    lastEnd = index + match[0].length

    const closing = match[1] === '/'
    const name = match[2]
    const rawAttrs = match[3]
    const selfClosing = match[4] === '/'

    if (!closing) {
      const attrs: Record<string, string> = {}
      for (const attrMatch of rawAttrs.matchAll(/([A-Za-z0-9_.-]+)\s*=\s*"([^"]*)"/g)) {
        attrs[attrMatch[1]] = attrMatch[2]
      }
      const node: XmlNode = { name, attrs, children: [] }
      if (stack.length === 0) {
        if (root !== undefined) throw new Error('malformed XML: multiple root elements')
        root = node
      } else {
        stack[stack.length - 1].children.push(node)
      }
      if (!selfClosing) stack.push(node)
      continue
    }

    // Closing tag
    if (stack.length === 0) throw new Error(`malformed XML: closing </${name}> without an open tag`)
    const top = stack[stack.length - 1]
    if (top.name !== name) throw new Error(`malformed XML: </${name}> closes <${top.name}>`)
    stack.pop()
  }

  const tail = clean.slice(lastEnd).trim()
  if (tail !== '' && stack.length > 0) {
    const top = stack[stack.length - 1]
    top.text = top.text === undefined ? tail : `${top.text} ${tail}`
  }

  if (stack.length > 0) throw new Error(`malformed XML: unclosed <${stack[stack.length - 1].name}>`)
  if (root === undefined) throw new Error('malformed XML: no root element')
  if (cdataContents.length > 0) {
    const restore = (node: XmlNode): void => {
      if (node.text !== undefined) {
        node.text = node.text.replace(/\u0000CDATA(\d+)\u0000/g, (_m, i: string) => cdataContents[Number(i)] ?? '')
      }
      for (const child of node.children) restore(child)
    }
    restore(root)
  }
  return root
}

/** All descendant elements of a node whose name matches a regex. */
function collect(node: XmlNode, re: RegExp): XmlNode[] {
  const found: XmlNode[] = []
  for (const child of node.children) {
    if (re.test(child.name)) found.push(child)
    found.push(...collect(child, re))
  }
  return found
}

/** Direct child elements with the given name. */
function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name)
}

/**
 * Top-level lifecycle status sources.
 *
 * Two vv artifact generations exist in the wild: the legacy attribute-based
 * format keeps `status` on the root element (`COMPONENT-*`, `TASK-T-NNN`,
 * `WAVE-N` vocabulary), while the current unique-tag templates carry a direct
 * child `<status>` and a different element vocabulary. Both are accepted, the
 * attribute first so the original contract keeps its meaning.
 */
function rootStatusAttribute(root: XmlNode): string | undefined {
  const attribute = root.attrs.status
  return typeof attribute === 'string' && attribute.trim() !== '' ? attribute.trim() : undefined
}

function rootStatusElement(root: XmlNode): string | undefined {
  const child = root.children.find((node) => node.name === 'status')
  const value = (child?.text ?? '').trim()
  return value === '' ? undefined : value
}

/** Effective lifecycle status used by the §K approval and §L receipt rules. */
function lifecycleStatus(root: XmlNode, override: string | undefined): string {
  return override ?? rootStatusAttribute(root) ?? rootStatusElement(root) ?? 'draft'
}

/**
 * Status used by the legacy structural/completeness rules.
 *
 * Those rules encode the legacy attribute-based format's element vocabulary;
 * current unique-tag artifacts (child `<status>`, `C-*`/`T-NNN`/`wave-N`
 * names) are structurally validated by the preset, not here, so they keep
 * "draft" and would otherwise only produce false positives. They still receive
 * the format-agnostic §K/§L checks through `lifecycleStatus()`.
 */
function structuralStatus(root: XmlNode, override: string | undefined): string {
  return override ?? rootStatusAttribute(root) ?? 'draft'
}

/**
 * P1 generation-gap: legacy artifacts carry root attributes (status/package) and
 * the COMPONENT-, TASK-T-, WAVE- vocabulary; unique-tag artifacts carry a child
 * status element and C-, T-NNN, wave-N tags with NO attributes. The legacy
 * package-id and completeness rules apply only to the legacy generation so
 * unique-tag artifacts are not falsely errored. The new cross-scope rules are
 * generation-neutral.
 */
function isLegacyGeneration(root: XmlNode): boolean {
  return rootStatusAttribute(root) !== undefined
}

function malformed(verdict: LintVerdict, error: unknown): LintVerdict {
  // Parse errors already carry the "malformed XML: " prefix; only non-Error
  // throws need it added, so the verdict never reads "malformed XML: malformed XML: …".
  const message = error instanceof Error ? error.message : `malformed XML: ${String(error)}`
  verdict.errors.push({ rule: 'well-formed', message })
  return verdict
}

/** Recorded approval digest for one artifact (last approvals.json entry wins). */
export interface ApprovalRecord {
  /** Lowercase or uppercase SHA-256 hex recorded at approval time (§K). */
  sha256: string
}

/**
 * Approval-digest options shared by the spec and plan entry points (§K).
 *
 * The host supplies everything: which digest was recorded and what the
 * artifact's current digest is. This engine never touches the filesystem.
 */
export interface LintApprovalOptions {
  /** Sidecar record for this artifact, when approvals.json has one. */
  approval?: ApprovalRecord
  /** SHA-256 of the artifact's current bytes, computed by the host. */
  currentSha256?: string
  /** True when a package approvals.json sidecar exists at all. */
  approvalSidecarPresent?: boolean
}

/**
 * Host-supplied census data for the P1 cross-scope rules (host/engine split): the
 * HOST recomputes the census and passes values in; the pure lint engine only
 * compares. Mirrors the §K host-supplies-digest pattern. When absent, the
 * census-dependent rules degrade to a `census-unavailable` warning (never silent pass).
 */
export interface CensusLintData {
  /** Per-scope hard-edge consumers from the host census (production scopes). */
  perScope?: Array<{ scope: string; hardCount: number; edges: Array<{ kind: string; source: string; target: string }> }>
  /** Host re-computed canonical census digest at the pinned ref. */
  outputDigest?: string
  /** False when the pinned ref is unreachable (shallow clone / GC). */
  refReachable?: boolean
  /** Declared delete/rename paths that failed resolution at baselineRef. */
  pathUnresolvable?: string[]
  /** The spec-pinned census set for census-incomplete (plan ⊆ spec set). */
  specCensusSet?: { symbols: string[]; paths: string[] }
  /** Distinct-production-scope fan-out threshold (overlay-configurable; default 3). */
  fanoutThreshold?: number
  /** cross-scope-fanout mode: warn (pre-calibration) | error (post-calibration). */
  fanoutMode?: 'warn' | 'error'
  /** cascade-concentration threshold (shared-surface deletes/renames in one task). */
  cascadeThreshold?: number
}

/** Options for lintSpec. */
export interface SpecLintOptions extends LintApprovalOptions {
  /** Override the lifecycle status (defaults to the root `status` attribute). */
  status?: string
  /** P1: host-supplied census data for the cross-scope rules. */
  census?: CensusLintData
}

/** One receipts.jsonl line as far as the lint engine needs it (§L). */
export interface ReceiptLike {
  task_id?: string
  command?: string
  exit_code?: number
}

/** Options for lintPlan. */
export interface PlanLintOptions extends LintApprovalOptions {
  /** Override the lifecycle status (defaults to the root `status` attribute). */
  status?: string
  /** Sibling spec.xml text, for the architecture component-subset check. */
  specText?: string
  /** Parsed receipts.jsonl lines (host-provided, malformed lines already dropped). */
  receipts?: ReceiptLike[]
  /** Require receipt coverage even when the plan status is not `applied`. */
  checkReceipts?: boolean
  /** P1: host-supplied census data (spec-pinned set) for census-incomplete. */
  census?: CensusLintData
}

/**
 * §K: compare an artifact against its sidecar-recorded approval digest.
 *
 * The digest pins the bytes the operator approved, so the mismatch check runs
 * while the artifact is still `approved` — that is the window execution reads
 * it in, and a content edit there must hard-stop vv-execute. Reaching
 * `applied` is the executor's own mark-applied flip of the lifecycle status:
 * execution consumed the clearance, the only legal byte change after approval
 * is that flip, and the package is archived right after. Applying the byte
 * check to `applied` would therefore flag every successfully executed package
 * as stale, so it is skipped there; post-application content edits are outside
 * the approval guard (the package is terminal and archived).
 *
 * An approved/applied artifact with no recorded digest is a warning for
 * backward compatibility with packages created before approvals.json existed.
 */
function checkApproval(verdict: LintVerdict, artifact: string, status: string, options: LintApprovalOptions): void {
  if (status !== 'approved' && status !== 'applied') return
  const recorded = options.approval?.sha256.trim().toLowerCase()
  if (recorded !== undefined && recorded !== '') {
    // The clearance is consumed by execution: only the `approved` window is
    // byte-checked (see the rationale above).
    if (status !== 'approved') return
    const current = options.currentSha256?.trim().toLowerCase()
    if (current === undefined || current === '') return
    if (recorded !== current) {
      verdict.errors.push({
        rule: 'stale-approval',
        message: `STALE APPROVAL: ${artifact} changed after approval (recorded ${recorded.slice(0, 12)}, current ${current.slice(0, 12)}) — re-approval required`,
      })
    }
    return
  }
  const where = options.approvalSidecarPresent === true
    ? 'approvals.json has no entry for it'
    : 'no approval digest sidecar is present'
  verdict.warnings.push({
    rule: 'approval-unverified',
    message: `APPROVAL UNVERIFIED: ${artifact} is ${status} but ${where} — call spec_guard_approve`,
  })
}

/**
 * Every verification command declared by a plan, in both supported spellings:
 * the unique-tag `<verification><command>` form and the legacy
 * `<verify><command>` form. Duplicates collapse so one receipt satisfies every
 * task that declares the same command.
 */
function verificationCommands(root: XmlNode): string[] {
  const commands: string[] = []
  for (const wrapper of collect(root, /^(?:verification|verify)$/)) {
    for (const command of collect(wrapper, /^command$/)) {
      const value = normalizeCommand(command.text ?? '')
      if (value !== '') commands.push(value)
    }
  }
  return [...new Set(commands)]
}


/**
 * Decode the five predefined XML entities plus numeric character references.
 * `parseXmlLite` keeps an element's raw text, so a plan whose command carries
 * `&amp;&amp;` must be decoded before it is compared with a receipts line that
 * stores the literal `&&` (and the same normalisation keeps a receipts file
 * that happens to store the escaped form matching too).
 */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match: string, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match: string, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

/** Commands compare on decoded, trimmed text so escaped and literal forms match. */
function normalizeCommand(value: string): string {
  return decodeXmlEntities(value).trim()
}

/** §L: every declared verification command must have an exit_code 0 receipt. */
function checkVerificationReceipts(verdict: LintVerdict, root: XmlNode, receipts: ReceiptLike[]): void {
  for (const command of verificationCommands(root)) {
    const matching = receipts.filter((receipt) => typeof receipt.command === 'string' && normalizeCommand(receipt.command) === command)
    if (matching.length === 0) {
      verdict.errors.push({
        rule: 'receipt-missing',
        message: `RECEIPT MISSING: no receipts.jsonl line for verification command "${command}"`,
      })
    } else if (!matching.some((receipt) => receipt.exit_code === 0)) {
      verdict.errors.push({
        rule: 'receipt-failed',
        message: `RECEIPT FAILED: verification command "${command}" has no exit_code 0 receipt`,
      })
    }
  }
}

/**
 * Lint one spec.xml against the vv-spec contract.
 *
 * Structural checks (well-formedness, root element, package id) apply to every
 * lifecycle state; content-completeness checks (goals, requirements,
 * acceptance) apply only once the spec is approved or applied, because a draft
 * may legitimately have empty sections mid-interview. When the host supplies
 * approval digests, approved/applied specs are also checked for a stale or
 * missing approval (§K).
 */
export function lintSpec(text: string, options: SpecLintOptions = {}): LintVerdict {
  const verdict: LintVerdict = { errors: [], warnings: [] }
  let root: XmlNode
  try {
    root = parseXmlLite(text)
  } catch (error) {
    return malformed(verdict, error)
  }

  if (root.name !== 'spec') verdict.errors.push({ rule: 'root', message: `root element must be <spec>, found <${root.name}>` })
  // P1 generation-gap fix: the package-attribute requirement is a LEGACY convention
  // (root attributes). Unique-tag artifacts (child <status>, no root attributes)
  // forbid attributes, so the rule must not fire on them. Gate on legacy generation.
  if (isLegacyGeneration(root) && (typeof root.attrs.package !== 'string' || root.attrs.package.trim() === '')) {
    verdict.errors.push({ rule: 'package', message: '<spec> requires a non-empty package attribute' })
  }

  const status = lifecycleStatus(root, options.status)
  if (!STATUSES.has(status)) {
    verdict.errors.push({ rule: 'status', message: `status must be draft|approved|applied, found "${status}"` })
  }
  checkApproval(verdict, 'spec.xml', status, options)
  const structural = structuralStatus(root, options.status)

  const components = collect(root, COMPONENT_RE)
  const seen = new Set<string>()
  for (const component of components) {
    if (seen.has(component.name)) verdict.errors.push({ rule: 'identity', message: `duplicate component identity <${component.name}>` })
    seen.add(component.name)
  }
  for (const child of root.children) {
    if (child.name.startsWith('COMPONENT-') && !COMPONENT_RE.test(child.name)) {
      verdict.errors.push({ rule: 'identity', message: `component <${child.name}> does not match COMPONENT-UPPER-KEBAB` })
    }
  }

  if (structural !== 'draft') {
    if (childrenNamed(root, 'goals').flatMap((goals) => childrenNamed(goals, 'goal')).length === 0) {
      verdict.errors.push({ rule: 'completeness', message: 'approved/applied spec must have at least one <goal>' })
    }
    if (childrenNamed(root, 'requirements').flatMap((reqs) => childrenNamed(reqs, 'requirement')).length === 0) {
      verdict.errors.push({ rule: 'completeness', message: 'approved/applied spec must have at least one <requirement>' })
    }
    if (childrenNamed(root, 'acceptance').flatMap((acc) => childrenNamed(acc, 'criterion')).length === 0) {
      verdict.errors.push({ rule: 'completeness', message: 'approved/applied spec must have at least one <criterion>' })
    }
  }

  // Generation-neutrality (follow-up minor): unique-tag specs carry a bare <goal>, not
  // the legacy <goals>/<requirements>/<acceptance> wrappers. Validate an approved/applied
  // unique-tag spec has a goal so "delivered" rests on a criterion, not prose.
  if (!isLegacyGeneration(root) && (status === 'approved' || status === 'applied')) {
    const hasGoal = childrenNamed(root, 'goal').length > 0
      || childrenNamed(root, 'goals').flatMap((goals) => childrenNamed(goals, 'goal')).length > 0
    if (!hasGoal) {
      verdict.errors.push({ rule: 'completeness', message: 'approved/applied spec must have a <goal>' })
    }
  }

  // P1 cross-scope rules (generation-neutral). impact-present is paths-based and
  // always runs; the census-dependent rules need host-supplied values.
  lintImpactPresent(root, verdict)
  if (options.census !== undefined) {
    lintCensusSpec(root, verdict, options.census)
  } else if (childrenNamed(root, 'impact').length > 0) {
    verdict.warnings.push({ rule: 'census-unavailable', message: 'host census not supplied; census-dependent cross-scope rules skipped (degraded, not passed)' })
  }
  return verdict
}

/** The set of task ids one plan element references through <task_id> children. */
function taskRefs(node: XmlNode): string[] {
  return childrenNamed(node, 'task_id')
    .map((ref) => (ref.text ?? '').trim())
    .filter((id) => id !== '')
}

/**
 * Lint one plan.xml against the vv-plan contract.
 *
 * Besides the shared structural/status checks, plans must keep task and wave
 * identities unique, reference only existing tasks from <wave> and
 * <depends_on>, stay free of dependency cycles, and — when approved/applied —
 * carry a title, acceptance criterion, and verification command per task.
 * Architecture components must be a subset of the spec's components when the
 * spec text is available; without it the check degrades to a warning.
 *
 * On host-supplied options this also enforces the §K approval digest and the
 * §L receipt-coverage rules: when the plan is `applied` (or `checkReceipts` is
 * true) every declared verification command needs a receipts.jsonl line with
 * `exit_code: 0`.
 */
export function lintPlan(text: string, options: PlanLintOptions = {}): LintVerdict {
  const verdict: LintVerdict = { errors: [], warnings: [] }
  let root: XmlNode
  try {
    root = parseXmlLite(text)
  } catch (error) {
    return malformed(verdict, error)
  }

  if (root.name !== 'plan') verdict.errors.push({ rule: 'root', message: `root element must be <plan>, found <${root.name}>` })
  // P1 generation-gap fix: gate the legacy package-attribute rule (see lintSpec).
  if (isLegacyGeneration(root) && (typeof root.attrs.package !== 'string' || root.attrs.package.trim() === '')) {
    verdict.errors.push({ rule: 'package', message: '<plan> requires a non-empty package attribute' })
  }

  const status = lifecycleStatus(root, options.status)
  if (!STATUSES.has(status)) {
    verdict.errors.push({ rule: 'status', message: `status must be draft|approved|applied, found "${status}"` })
  }
  checkApproval(verdict, 'plan.xml', status, options)
  const requireReceipts = status === 'applied' || options.checkReceipts === true
  const structural = structuralStatus(root, options.status)

  const tasks = collect(root, TASK_RE)
  const taskIds = new Set<string>()
  if (structural !== 'draft' && tasks.length === 0) {
    verdict.errors.push({ rule: 'completeness', message: 'approved/applied plan must have at least one task' })
  }
  for (const task of tasks) {
    if (taskIds.has(task.name)) verdict.errors.push({ rule: 'identity', message: `duplicate task identity <${task.name}>` })
    taskIds.add(task.name)
    if (structural !== 'draft') {
      if (childrenNamed(task, 'title').length === 0) verdict.errors.push({ rule: 'completeness', message: `<${task.name}> has no <title>` })
      if (childrenNamed(task, 'acceptance').flatMap((acc) => childrenNamed(acc, 'criterion')).length === 0) {
        verdict.errors.push({ rule: 'completeness', message: `<${task.name}> has no acceptance <criterion>` })
      }
      // Both spellings count: unique-tag plans declare <verification><command>
      // and legacy plans declare <verify><command> (§L); a plan must have at
      // least one verification command per task either way.
      if (verificationCommands(task).length === 0) {
        verdict.errors.push({ rule: 'completeness', message: `<${task.name}> has no <verify>/<command>` })
      }
    }
  }

  // P1 generation-gap: the wave/depends_on reference checks use the LEGACY
  // vocabulary (WAVE-N, <task_id>, TASK-T-NNN). Run them only for legacy-generation
  // plans; unique-tag plans use dep-T-NNN refs validated separately (P3), and hybrid
  // formats must not get false "unknown task" errors from the legacy task-id set.
  if (isLegacyGeneration(root)) {
    for (const wave of collect(root, WAVE_RE)) {
      for (const ref of taskRefs(wave)) {
        if (!taskIds.has(ref)) verdict.errors.push({ rule: 'reference', message: `<${wave.name}> references unknown task "${ref}"` })
      }
    }
    for (const depends of collect(root, /^depends_on$/)) {
      for (const ref of taskRefs(depends)) {
        if (!taskIds.has(ref)) verdict.errors.push({ rule: 'reference', message: `depends_on references unknown task "${ref}"` })
      }
    }
  }

  // Dependency cycle detection: DFS over task -> depends_on edges.
  const edges = new Map<string, string[]>()
  for (const task of tasks) {
    const deps: string[] = []
    for (const depends of childrenNamed(task, 'depends_on')) deps.push(...taskRefs(depends))
    edges.set(task.name, deps)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): string[] | undefined => {
    if (visiting.has(id)) return [id]
    if (visited.has(id)) return undefined
    visiting.add(id)
    for (const dep of edges.get(id) ?? []) {
      if (!taskIds.has(dep)) continue
      const cycle = visit(dep)
      if (cycle !== undefined) return [id, ...cycle]
    }
    visiting.delete(id)
    visited.add(id)
    return undefined
  }
  for (const id of edges.keys()) {
    const cycle = visit(id)
    if (cycle !== undefined) {
      verdict.errors.push({ rule: 'dependency', message: `dependency cycle: ${cycle.join(' -> ')}` })
      break
    }
  }

  if (requireReceipts) checkVerificationReceipts(verdict, root, options.receipts ?? [])

  // Plan components must be a subset of spec components.
  const planComponents = collect(root, COMPONENT_RE).map((node) => node.name)
  const planSet = new Set(planComponents)
  if (planSet.size > 0) {
    if (options.specText !== undefined) {
      try {
        const spec = parseXmlLite(options.specText)
        const specSet = new Set(collect(spec, COMPONENT_RE).map((node) => node.name))
        for (const component of planSet) {
          if (!specSet.has(component)) {
            verdict.errors.push({ rule: 'spec-subset', message: `plan component <${component}> has no matching spec component` })
          }
        }
      } catch {
        verdict.warnings.push({ rule: 'spec-subset', message: 'spec text provided but unparsable; component-subset check skipped' })
      }
    } else {
      verdict.warnings.push({ rule: 'spec-subset', message: 'spec text not provided; component-subset check skipped' })
    }
  }

  // P1 census-incomplete (PLAN lint): plan <deletes>/<renames> ⊆ spec-pinned set.
  if (options.census !== undefined) lintCensusIncomplete(root, verdict, options.census)
  // P3 plan cross-scope rules (generation-neutral).
  lintConsumerCoverage(root, verdict, options.specText)
  lintCascadeConcentration(root, verdict, options.census?.cascadeThreshold)
  return verdict
}

// ── P1 cross-scope rules (generation-neutral; host-supplied census) ──────────

/** Shared surfaces that trigger impact-present (db/schemas, contracts, migrations). */
const SHARED_SURFACE_RE = /(?:^|\/)(?:db\/schemas|contracts|migrations)(?:\/|$)|\.sql$|(?:^|\/)drizzle(?:\/|$)/i

/** Normalize a scope name for matching: strip a leading S- and lowercase. */
function normScope(name: string): string {
  return name.replace(/^S-/i, '').toLowerCase()
}

/** The spec's declared <paths> entries (P-NNN <path> text). */
function specDeclaredPaths(root: XmlNode): string[] {
  const pathsEl = childrenNamed(root, 'paths')[0]
  if (pathsEl === undefined) return []
  const out: string[] = []
  for (const entry of pathsEl.children) {
    const value = (childrenNamed(entry, 'path')[0]?.text ?? '').trim()
    if (value !== '') out.push(value)
  }
  return out
}

/** impact-present: spec <paths> touching a shared surface require <impact>. */
function lintImpactPresent(root: XmlNode, verdict: LintVerdict): void {
  const touchesShared = specDeclaredPaths(root).some((path) => SHARED_SURFACE_RE.test(path))
  const hasImpact = childrenNamed(root, 'impact').length > 0
  if (touchesShared && !hasImpact) {
    verdict.errors.push({ rule: 'impact-present', message: 'spec <paths> touch a shared surface (db/schemas/, contracts/, migrations) but <impact> is missing' })
  }
  // #4 nudge: a cross-scope spec should carry the design-reasoning artifact (consequence
  // inventory / consumer contracts / decomposition / pre-mortem). Advisory, not a hard gate.
  if (hasImpact && childrenNamed(root, 'design').length === 0) {
    verdict.warnings.push({ rule: 'design-reasoning-missing', message: 'cross-scope spec has <impact> but no <design> section (consequence-first / consumer-driven / strangler / pre-mortem); see design-template.xml' })
  }
}

/** Census-dependent spec rules. The host supplies census values; lint compares only. */
function lintCensusSpec(root: XmlNode, verdict: LintVerdict, census: CensusLintData): void {
  if (census.refReachable === false) {
    verdict.errors.push({ rule: 'census-ref-unreachable', message: 'pinned census ref is unreachable (shallow clone / GC)' })
  }
  for (const path of census.pathUnresolvable ?? []) {
    verdict.errors.push({ rule: 'census-path-unresolvable', message: `declared delete/rename path fails resolution at baselineRef: ${path}` })
  }

  const impact = childrenNamed(root, 'impact')[0]
  const censusEl = impact === undefined ? undefined : childrenNamed(impact, 'census')[0]
  const claimedDigest = censusEl === undefined ? undefined : (childrenNamed(censusEl, 'output-digest')[0]?.text ?? '').trim()
  if (claimedDigest !== undefined && claimedDigest !== '' && census.outputDigest !== undefined && claimedDigest !== census.outputDigest) {
    verdict.errors.push({ rule: 'census-stale', message: `claimed census digest ${claimedDigest.slice(0, 12)} ≠ host re-computation ${census.outputDigest.slice(0, 12)} at the pinned ref — re-census + re-approval required` })
  }

  const dispositionByScope = new Map<string, string>()
  if (impact !== undefined) {
    for (const scopeNode of impact.children.filter((child) => /^S-/.test(child.name))) {
      const disposition = (childrenNamed(scopeNode, 'disposition')[0]?.text ?? '').trim()
      dispositionByScope.set(normScope(scopeNode.name), disposition)
    }
  }

  const perScope = census.perScope ?? []
  for (const consumer of perScope) {
    if (consumer.hardCount <= 0) continue
    const disposition = dispositionByScope.get(normScope(consumer.scope))
    if (disposition === 'verified-untouched') {
      verdict.errors.push({ rule: 'untouched-contradicted', message: `scope ${consumer.scope} declared verified-untouched but the host census found ${consumer.hardCount} hard edge(s)` })
    }
    if (disposition !== 'cover-in-plan' && disposition !== 'defer-to-program') {
      verdict.errors.push({ rule: 'census-impact-coverage', message: `host-census consumer scope ${consumer.scope} (${consumer.hardCount} hard edges) is not in <impact> as cover-in-plan/defer-to-program` })
    }
  }

  const threshold = census.fanoutThreshold ?? 3
  const fanout = perScope.filter((consumer) => consumer.hardCount > 0).length
  if (fanout >= threshold) {
    // The gate forces a decomposition choice. A declared program satisfies it — do not
    // fire when the spec already declares decomposition=program + a program path (found
    // in the live dry-run: the gate fired even with a valid program).
    const decomposition = (impact?.children.find((child) => child.name === 'decomposition')?.text ?? '').trim()
    const programPath = (impact?.children.find((child) => child.name === 'program')?.text ?? '').trim()
    const hasProgram = decomposition === 'program' && programPath !== ''
    if (!hasProgram) {
      const finding: LintFinding = { rule: 'cross-scope-fanout', message: `fan-out ${fanout} production consumer scopes ≥ threshold ${threshold} (cross_scope_cascade); program decomposition required in ERROR mode` }
      if ((census.fanoutMode ?? 'warn') === 'error') verdict.errors.push(finding)
      else verdict.warnings.push(finding)
    }
  }
}

/** census-incomplete (PLAN lint): plan <deletes>/<renames> ⊆ spec-pinned census set. */
function lintCensusIncomplete(planRoot: XmlNode, verdict: LintVerdict, census: CensusLintData): void {
  const specSet = census.specCensusSet
  if (specSet === undefined) return
  const specSymbols = new Set(specSet.symbols.map((symbol) => symbol.toLowerCase()))
  const specPaths = new Set(specSet.paths)
  for (const entry of collect(planRoot, /^D-\d+$/)) {
    const path = (childrenNamed(entry, 'path')[0]?.text ?? '').trim()
    const symbol = (childrenNamed(entry, 'symbol')[0]?.text ?? '').trim()
    if (path !== '' && !specPaths.has(path)) {
      verdict.errors.push({ rule: 'census-incomplete', message: `plan deletes path ${path} is absent from the spec-pinned census set` })
    }
    if (symbol !== '' && !specSymbols.has(symbol.toLowerCase())) {
      verdict.errors.push({ rule: 'census-incomplete', message: `plan deletes symbol ${symbol} is absent from the spec-pinned census set` })
    }
  }
  for (const entry of collect(planRoot, /^R-\d+$/)) {
    const from = (childrenNamed(entry, 'from')[0]?.text ?? '').trim()
    if (from !== '' && !specPaths.has(from) && !specSymbols.has(from.toLowerCase())) {
      verdict.errors.push({ rule: 'census-incomplete', message: `plan renames from ${from} is absent from the spec-pinned census set` })
    }
  }
}

// ── P3 plan/program cross-scope rules (generation-neutral) ───────────────────

/**
 * consumer-coverage (PLAN lint): every spec <impact> consumer scope (disposition
 * cover-in-plan / defer-to-program) maps to ≥1 plan task <scope> or a consumer-coverage
 * entry (covered-by / deferral-target). Reads the sibling spec via host-supplied specText.
 */
function lintConsumerCoverage(planRoot: XmlNode, verdict: LintVerdict, specText: string | undefined): void {
  if (specText === undefined) return
  let spec: XmlNode
  try {
    spec = parseXmlLite(specText)
  } catch {
    return
  }
  const impact = childrenNamed(spec, 'impact')[0]
  if (impact === undefined) return
  const consumerScopes: string[] = []
  for (const scopeNode of impact.children.filter((child) => /^S-/.test(child.name))) {
    const disposition = (childrenNamed(scopeNode, 'disposition')[0]?.text ?? '').trim()
    if (disposition === 'cover-in-plan' || disposition === 'defer-to-program') consumerScopes.push(normScope(scopeNode.name))
  }
  if (consumerScopes.length === 0) return

  const taskScopes = new Set<string>()
  for (const task of collect(planRoot, /^T-\d{3}$/)) {
    const scope = (childrenNamed(task, 'scope')[0]?.text ?? '').trim()
    if (scope !== '') taskScopes.add(normScope(scope))
  }
  const coveredScopes = new Set<string>()
  const coverage = childrenNamed(planRoot, 'consumer-coverage')[0]
  if (coverage !== undefined) {
    for (const entry of coverage.children.filter((child) => /^CC-/.test(child.name))) {
      const scope = (childrenNamed(entry, 'scope')[0]?.text ?? '').trim()
      const hasDisposition = childrenNamed(entry, 'covered-by').length > 0 || childrenNamed(entry, 'deferral-target').length > 0
      if (scope !== '' && hasDisposition) coveredScopes.add(normScope(scope))
    }
  }
  for (const scope of consumerScopes) {
    if (!taskScopes.has(scope) && !coveredScopes.has(scope)) {
      verdict.errors.push({ rule: 'consumer-coverage', message: `spec impact consumer scope ${scope} is not covered by any plan task <scope> or consumer-coverage deferral` })
    }
  }
}

/**
 * cascade-concentration (PLAN lint): a single task must not concentrate a large
 * shared-surface deletion/rename (the CURRICULUM T-023 anti-pattern). Counts D-NNN
 * paths + R-NNN from-paths matching a shared surface per task. Threshold provisional
 * (pending archive calibration).
 */
const CASCADE_CONCENTRATION_THRESHOLD = 5
function lintCascadeConcentration(planRoot: XmlNode, verdict: LintVerdict, threshold: number = CASCADE_CONCENTRATION_THRESHOLD): void {
  for (const task of collect(planRoot, /^T-\d{3}$/)) {
    let count = 0
    for (const entry of collect(task, /^D-\d+$/)) {
      const path = (childrenNamed(entry, 'path')[0]?.text ?? '').trim()
      if (path !== '' && SHARED_SURFACE_RE.test(path)) count += 1
    }
    for (const entry of collect(task, /^R-\d+$/)) {
      const from = (childrenNamed(entry, 'from')[0]?.text ?? '').trim()
      if (from !== '' && SHARED_SURFACE_RE.test(from)) count += 1
    }
    if (count >= threshold) {
      verdict.errors.push({ rule: 'cascade-concentration', message: `task ${task.name} concentrates ${count} shared-surface deletions/renames (≥${threshold}); split across tasks/waves or declare a program` })
    }
  }
}

/**
 * program-dag (PROGRAM lint): the package DAG is acyclic, every dep-P ref resolves to
 * a declared P node, and every charter component is owned by exactly one package.
 */
export function lintProgram(text: string, options: SpecLintOptions = {}): LintVerdict {
  const verdict: LintVerdict = { errors: [], warnings: [] }
  let root: XmlNode
  try {
    root = parseXmlLite(text)
  } catch (error) {
    return malformed(verdict, error)
  }
  if (root.name !== 'program') verdict.errors.push({ rule: 'root', message: `root element must be <program>, found <${root.name}>` })
  const status = lifecycleStatus(root, options.status)
  if (!STATUSES.has(status)) verdict.errors.push({ rule: 'status', message: `status must be draft|approved|applied, found "${status}"` })
  checkApproval(verdict, 'program.xml', status, options)

  const packagesEl = childrenNamed(root, 'packages')[0]
  const packages = packagesEl === undefined ? [] : packagesEl.children.filter((child) => /^P-/.test(child.name))
  const packageIds = new Set(packages.map((pkg) => pkg.name))

  const edges = new Map<string, string[]>()
  for (const pkg of packages) {
    const deps: string[] = []
    for (const dep of collect(pkg, /^dep-P-/)) {
      const ref = dep.name.replace(/^dep-/, '')
      if (!packageIds.has(ref)) verdict.errors.push({ rule: 'reference', message: `package ${pkg.name} depends on unknown package ${ref}` })
      deps.push(ref)
    }
    edges.set(pkg.name, deps)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): string[] | undefined => {
    if (visiting.has(id)) return [id]
    if (visited.has(id)) return undefined
    visiting.add(id)
    for (const dep of edges.get(id) ?? []) {
      if (!packageIds.has(dep)) continue
      const cycle = visit(dep)
      if (cycle !== undefined) return [id, ...cycle]
    }
    visiting.delete(id)
    visited.add(id)
    return undefined
  }
  for (const id of edges.keys()) {
    const cycle = visit(id)
    if (cycle !== undefined) {
      verdict.errors.push({ rule: 'program-dag', message: `package dependency cycle: ${cycle.join(' -> ')}` })
      break
    }
  }

  const ownedBy = new Map<string, string>()
  for (const pkg of packages) {
    const owns = (childrenNamed(pkg, 'owns-components')[0]?.text ?? '').trim()
    for (const component of owns.split(',').map((item) => item.trim()).filter((item) => item !== '')) {
      const prior = ownedBy.get(component)
      if (prior !== undefined) verdict.errors.push({ rule: 'program-dag', message: `component ${component} owned by both ${prior} and ${pkg.name}` })
      else ownedBy.set(component, pkg.name)
    }
  }
  return verdict
}

// ── P4 addendum read-side (unresolved-addendum) ───────────────────────────────

/** Terminal addendum statuses (§12.2); anything else blocks execution. */
const ADDENDUM_TERMINAL = new Set(['resolved', 'resolved-deferred', 'resolved-spawned'])

/**
 * unresolved-addendum (P4 read-side): any ADD-NNN whose status is not terminal blocks
 * validate-plan. An addendum recorded by a dead executor must not rot silently — the
 * next invocation sees it here. Host reads impact-addendum.xml and passes the text in.
 */
export function lintAddendum(text: string, _options: SpecLintOptions = {}): LintVerdict {
  const verdict: LintVerdict = { errors: [], warnings: [] }
  let root: XmlNode
  try {
    root = parseXmlLite(text)
  } catch (error) {
    return malformed(verdict, error)
  }
  if (root.name !== 'impact-addendum') verdict.errors.push({ rule: 'root', message: `root element must be <impact-addendum>, found <${root.name}>` })
  for (const entry of root.children.filter((child) => /^ADD-/.test(child.name))) {
    const status = (childrenNamed(entry, 'status')[0]?.text ?? '').trim()
    if (!ADDENDUM_TERMINAL.has(status)) {
      verdict.errors.push({ rule: 'unresolved-addendum', message: `${entry.name} status "${status || 'missing'}" is not terminal (resolved/resolved-deferred/resolved-spawned); resolve before executing` })
    }
  }
  return verdict
}

// ── invariant-verification read-side (unverified-invariant) ──────────────────

/** Discharged invariant-verification statuses; anything else is a pending obligation. */
const INVARIANT_DISCHARGED = new Set(['verified', 'waived'])

/**
 * unverified-invariant: any IV-NNN in invariant-verification.xml whose status is not
 * discharged (verified/waived) blocks plan-close. A behavioral GRACE invariant surfaced as
 * at-risk becomes a tracked obligation; it cannot be silently ignored. Pure text check.
 */
export function lintInvariantVerification(text: string, _options: SpecLintOptions = {}): LintVerdict {
  const verdict: LintVerdict = { errors: [], warnings: [] }
  let root: XmlNode
  try {
    root = parseXmlLite(text)
  } catch (error) {
    return malformed(verdict, error)
  }
  if (root.name !== 'invariant-verification') verdict.errors.push({ rule: 'root', message: `root element must be <invariant-verification>, found <${root.name}>` })
  for (const entry of root.children.filter((child) => /^IV-/.test(child.name))) {
    const status = (childrenNamed(entry, 'status')[0]?.text ?? '').trim()
    if (!INVARIANT_DISCHARGED.has(status)) {
      verdict.errors.push({ rule: 'unverified-invariant', message: `${entry.name} status "${status || 'missing'}" is not discharged (verified/waived); the behavioral invariant needs an executable test or an explicit waiver` })
    }
  }
  return verdict
}

// ── §N Plan risk classifier ──────────────────────────────────────────────────

/** Fixed risk-category order (hive's five categories, vv-adapted). */
export const PLAN_RISK_CATEGORIES = [
  'auth_secrets_permissions',
  'destructive_data_schema',
  'public_compatibility',
  'concurrency_recovery_ownership',
  'deployment_release_supply_chain',
] as const

/** One of the five §N risk categories. */
export type PlanRiskCategory = (typeof PLAN_RISK_CATEGORIES)[number]

/** One confirmed risk signal. */
export interface PlanRiskReason {
  category: PlanRiskCategory
  /** Short evidence: matched path, matched keyword + line, or a secret literal. */
  evidence: string
}

/** §N risk classification, surfaced by spec_guard_lint as an extra output line. */
export interface PlanRiskResult {
  level: 'standard' | 'mandatory'
  reasons: PlanRiskReason[]
  /** Set when classification had to degrade because the plan XML is unparsable. */
  note?: string
}

interface PathRiskRule {
  category: PlanRiskCategory
  re: RegExp
}

interface KeywordRiskRule {
  category: PlanRiskCategory
  re: RegExp
}

interface LiteralRiskRule {
  label: string
  re: RegExp
}

/** Protected path globs (signal a), matched against declared/plain path tokens. */
const PATH_RISK_RULES: PathRiskRule[] = [
  // Destructive data / schema work.
  { category: 'destructive_data_schema', re: /migration/i },
  { category: 'destructive_data_schema', re: /\.sql$/i },
  { category: 'destructive_data_schema', re: /(?:^|\/)drizzle(?:\/|$)/i },
  // Auth, secrets, permissions.
  { category: 'auth_secrets_permissions', re: /(?:^|\/)auth/i },
  { category: 'auth_secrets_permissions', re: /(?:^|\/)secret/i },
  { category: 'auth_secrets_permissions', re: /permission/i },
  { category: 'auth_secrets_permissions', re: /(?:^|\/)\.env/i },
  // CI, deployment/release, supply chain.
  { category: 'deployment_release_supply_chain', re: /\.github\/workflows\//i },
  { category: 'deployment_release_supply_chain', re: /(?:^|\/)gitlab-ci\.ya?ml$/i },
  { category: 'deployment_release_supply_chain', re: /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|gemfile\.lock)$/i },
  { category: 'deployment_release_supply_chain', re: /(?:^|\/)dockerfile/i },
  { category: 'deployment_release_supply_chain', re: /deploy/i },
  { category: 'deployment_release_supply_chain', re: /release/i },
]

/**
 * Category keywords (signal b), scanned over the whole plan text.
 *
 * A keyword hit is suppressed when the same line contains a preceding negation
 * token (`no`, `not`, `without`, `zero`, `never`) — see hasNegationBefore.
 * v1 limitation: there is no sentence parsing and no cross-line negation, so a
 * negation in an earlier clause of the same line can suppress a genuine
 * signal, and a negation on the previous line does not suppress anything.
 */
const KEYWORD_RISK_RULES: KeywordRiskRule[] = [
  {
    category: 'auth_secrets_permissions',
    re: /\b(?:auth|authenticate[sd]?|authentication|authorize[sd]?|authorization|permissions?|roles?|tokens?|passwords?|credentials?|secrets?|oauth|jwt|rbac|access control|login|sign-?in|api keys?|private keys?)\b/gi,
  },
  {
    category: 'destructive_data_schema',
    re: /\b(?:drops?|dropped|dropping|deletes?|deleted|deleting|truncates?|truncated|truncating|migrate[sd]?|migrating|migrations?|schema changes?|schema migrations?|alter table|data loss|destructive|wipes?|wiped|purg(?:e|es|ed|ing))\b/gi,
  },
  {
    category: 'public_compatibility',
    re: /\b(?:breaking changes?|public api|public interface|deprecat(?:e|es|ed|ing|ion|ions)|export changes?|backwards?[- ]compatib\w*|backwards?[- ]incompatible|semver|version bumps?)\b/gi,
  },
  {
    category: 'concurrency_recovery_ownership',
    re: /\b(?:race conditions?|races?|deadlocks?|mutex(?:es)?|(?<![-.\w])lock(?:s|ed|ing)?|queues?|retr(?:y|ies|ied)|ownership|leases?|concurren\w+|idempoten\w+|transactions?|recovery|failover|heartbeats?|workers?)\b/gi,
  },
  {
    category: 'deployment_release_supply_chain',
    re: /\b(?:dependenc(?:y|ies)|deploy(?:s|ed|ing|ment|ments)?|publish(?:es|ed|ing)?|releases?|supply chain|lockfiles?|upgrade packages?|package upgrades?|ci pipelines?)\b/gi,
  },
]

/** Literal secret material anywhere in the plan (signal c). */
const LITERAL_RISK_RULES: LiteralRiskRule[] = [
  { label: 'AKIA access key', re: /AKIA[0-9A-Z]{16}/g },
  { label: 'ghp_ token', re: /ghp_[A-Za-z0-9]{20,}/g },
  { label: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
]

/**
 * Path-like token shapes: slash paths, file names with source/data extensions,
 * Dockerfile, and dotenv files. Used both to collect protected-path signals and
 * to mask path tokens out of the keyword scan (so `src/auth/x.ts` reports one
 * path signal instead of also echoing the keyword `auth`).
 */
const PATH_TOKEN_RES: RegExp[] = [
  /[A-Za-z0-9_.@~-]+(?:\/[A-Za-z0-9_.@~-]+)+/g,
  /[A-Za-z0-9_-]+\.(?:sql|ya?ml|json|tsx?|jsx?|rb|py|go|rs|toml|env)\b/g,
  /\bDockerfile\b/g,
  /\.env(?:\.[A-Za-z0-9_-]+)?/g,
]

interface PathTokenMatch {
  token: string
  start: number
  end: number
}

function pathTokenMatches(text: string): PathTokenMatch[] {
  const found: PathTokenMatch[] = []
  for (const re of PATH_TOKEN_RES) {
    for (const match of text.matchAll(re)) {
      const start = match.index ?? 0
      found.push({ token: match[0], start, end: start + match[0].length })
    }
  }
  return found
}

/** Distinct path-like tokens in the plan text. */
function extractPathTokens(text: string): string[] {
  return [...new Set(pathTokenMatches(text).map((match) => match.token))]
}

/** Replace path-like tokens with spaces, preserving line numbers for the scan. */
function maskPathTokens(text: string): string {
  const ranges = pathTokenMatches(text)
    .map(({ start, end }) => ({ start, end }))
    .sort((left, right) => left.start - right.start)
  if (ranges.length === 0) return text
  let masked = ''
  let cursor = 0
  for (const range of ranges) {
    const start = Math.max(range.start, cursor)
    if (start >= range.end) continue
    masked += text.slice(cursor, start) + ' '.repeat(range.end - start)
    cursor = range.end
  }
  return masked + text.slice(cursor)
}

/** Keep evidence short in the one-line verdict. */
function shortenEvidence(value: string, max = 80): string {
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  return `…${trimmed.slice(trimmed.length - (max - 1))}`
}

const NEGATION_PREFIX_RE = /(?:^|[^A-Za-z0-9_])(?:no|not|without|zero|never)\s+/i

/**
 * §N v1 negation guard: a signal is suppressed when a negation token appears
 * earlier on the SAME line. Deliberately simple — no sentence splitting, no
 * cross-line negation, and a negation from an earlier clause on the line can
 * suppress a genuine signal (documented limitation, see KEYWORD_RISK_RULES).
 */
function hasNegationBefore(line: string, index: number): boolean {
  return NEGATION_PREFIX_RE.test(line.slice(0, index))
}

/** 1-based line number of a character offset. */
function lineNumberAt(text: string, index: number): number {
  let line = 1
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1
  }
  return line
}

/**
 * §N: classify a plan's review risk from its raw text.
 *
 * Pure and deterministic: the host passes the plan.xml text it already read,
 * and declared `<file>`/`<path>` values plus path-like tokens are matched
 * against the protected globs. A single confirmed signal in any category makes
 * the plan `mandatory` (adversarial lens required, safetyist triage default);
 * zero signals make it `standard`. Unparsable plan text degrades to `standard`
 * with a note because the declared-path extraction cannot be trusted.
 */
export function classifyPlanRisk(text: string): PlanRiskResult {
  let root: XmlNode
  try {
    root = parseXmlLite(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { level: 'standard', reasons: [], note: `unparsable plan XML (${message}); risk classification skipped` }
  }

  const reasons: PlanRiskReason[] = []
  const seen = new Set<string>()
  const addReason = (category: PlanRiskCategory, evidence: string): void => {
    const key = `${category}\u0000${evidence}`
    if (seen.has(key)) return
    seen.add(key)
    reasons.push({ category, evidence })
  }

  // Signal (a): declared <file>/<path> values and plain path-like tokens.
  const tokens = new Set<string>()
  for (const node of collect(root, /^(?:file|path)$/)) {
    const value = (node.text ?? '').trim()
    if (value !== '') tokens.add(value)
  }
  for (const token of extractPathTokens(text)) tokens.add(token)
  for (const token of tokens) {
    for (const rule of PATH_RISK_RULES) {
      if (rule.re.test(token)) addReason(rule.category, shortenEvidence(token))
    }
  }

  // Signal (b): category keywords, with the same-line negation guard. Path
  // tokens are masked so a path signal does not also echo inside as a keyword.
  const maskedLines = maskPathTokens(text).split('\n')
  for (const rule of KEYWORD_RISK_RULES) {
    for (let index = 0; index < maskedLines.length; index += 1) {
      const line = maskedLines[index]
      for (const match of line.matchAll(rule.re)) {
        if (hasNegationBefore(line, match.index ?? 0)) continue
        addReason(rule.category, `keyword "${match[0]}" line ${index + 1}`)
      }
    }
  }

  // Signal (c): literal secret material anywhere in the plan.
  for (const rule of LITERAL_RISK_RULES) {
    for (const match of text.matchAll(rule.re)) {
      addReason('auth_secrets_permissions', `literal ${rule.label} line ${lineNumberAt(text, match.index ?? 0)}`)
    }
  }

  reasons.sort((left, right) => PLAN_RISK_CATEGORIES.indexOf(left.category) - PLAN_RISK_CATEGORIES.indexOf(right.category))
  return { level: reasons.length === 0 ? 'standard' : 'mandatory', reasons }
}

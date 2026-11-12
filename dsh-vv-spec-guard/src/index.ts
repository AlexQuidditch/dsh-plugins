/**
 * dsh-vv-spec-guard, host half.
 *
 * vv SpecGuard port: deterministic host-side verification of .vvoc spec-package
 * artifacts. Surfaces:
 *
 * 1. A `fs/observed` listener that logs a bounded verdict whenever the agent
 *    touches an active spec/plan/design-context XML (archived files excluded).
 *    The observation event is notification-only — it cannot decorate a tool
 *    result — so the verdict goes to the plugin logger, and the model reaches
 *    the same engine explicitly through the tools below.
 * 2. `spec_guard_lint` — the deterministic probe: pass a spec-package path or a
 *    single XML file path and get the verdict, with the sibling spec joined for
 *    plan cross-file rules, the §K approval-digest check wired from
 *    approvals.json, the §L receipt cross-check wired from receipts.jsonl, and
 *    the §N `risk:` line for plan.xml.
 * 3. `spec_guard_approve` — §K: the HOST hashes an approved artifact and
 *    records it in `<package>/approvals.json`, so "nothing changed after
 *    approval" becomes a byte-level fact instead of a claim.
 * 4. `spec_guard_evidence` — §M: byte-exact verification of a finding's
 *    evidence anchor (path + inclusive 1-based line range + verbatim excerpt).
 *
 * The pure engine is ./lint.ts and never does I/O: the host reads sidecars and
 * artifacts, then passes parsed options in. The plugin runs host-side
 * unsandboxed, so node:fs/node:crypto are available here (the boot marker below
 * already uses node:fs).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  classifyPlanRisk,
  lintPlan,
  lintSpec,
  parseXmlLite,
  type LintVerdict,
  type PlanLintOptions,
  type PlanRiskResult,
  type ReceiptLike,
  type XmlNode,
} from './lint.js'

export const name = 'vv-spec-guard'

/** Bundle config (see cordis.patch.yml). */
export interface VvSpecGuardConfig {
  /** Whether the guard is active. Default: true. */
  enabled?: boolean
  /** Whether to register the spec_guard_lint probe tool. Default: true. */
  probeTool?: boolean
  /** Whether to register the spec_guard_approve tool (§K). Default: true. */
  approveTool?: boolean
  /** Whether to register the spec_guard_evidence tool (§M). Default: true. */
  evidenceTool?: boolean
  /** Character cap of one logged verdict line. Default: 200. */
  verdictMaxChars?: number
}

/** Stable target returned by `fs.resolve` (0.2.2 two-phase contract). */
interface FsTargetFace {
  targetKey: unknown
  displayPath?: string
}

/**
 * Structural fs service face this bundle needs; the host provides the real one.
 *
 * 0.2.2 made the filesystem two-phase: `resolve(path, { cwd })` turns a
 * model/plugin-supplied path into a stable target, and every read operation
 * takes that target. Older runtimes accepted a raw `{ targetKey: path }`
 * wrapper instead, which only ever keyed absolute paths on the local backend —
 * a workspace-relative path silently missed and surfaced as
 * `cannot read "undefined": not found`. `resolve` stays optional so the bundle
 * keeps working on 0.1-era hosts.
 */
interface FsFace {
  resolve?(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTargetFace>
  readText(target: FsTargetFace, signal?: AbortSignal): Promise<string>
}

/** Structural view of the tool execution context (`execute(args, exec)`). */
interface ToolExecFace {
  agent?: {
    session?: {
      header?: { cwd?: unknown }
    }
  }
  signal?: AbortSignal
}

/** Structural working-directory service: the session's effective directory. */
interface WorkingDirectoryFace {
  get(session: unknown): string
}

/**
 * Read one artifact through the fs service.
 *
 * Resolves the path first when the service offers the 0.2.2 two-phase
 * contract, so a workspace-relative path lands on the session's effective
 * directory instead of being mistaken for a target key. Falls back to the
 * legacy raw-key shape on hosts that predate `resolve`.
 */
async function readArtifact(
  fs: FsFace,
  path: string,
  cwd: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (typeof fs.resolve === 'function') {
    const target = await fs.resolve(path, {
      ...(cwd === undefined ? {} : { cwd }),
      ...(signal === undefined ? {} : { signal }),
    })
    return fs.readText(target, signal)
  }
  return fs.readText({ targetKey: path })
}

/** Base directory for a tool call: effective session cwd, else the header cwd. */
function baseCwdFor(ctx: Context, exec: ToolExecFace | undefined): string | undefined {
  const session = exec?.agent?.session
  try {
    const workingDirectory = ctx.get('workingDirectory') as WorkingDirectoryFace | undefined
    if (workingDirectory !== undefined && session !== undefined) {
      const value = workingDirectory.get(session)
      if (typeof value === 'string' && value.length > 0) return value
    }
  } catch {
    /* fall through to the header cwd */
  }
  const headerCwd = session?.header?.cwd
  return typeof headerCwd === 'string' && headerCwd.length > 0 ? headerCwd : undefined
}

/** Lowercase SHA-256 hex of a string's UTF-8 bytes or of raw file bytes. */
function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Absolute path for a model-supplied path, resolved against the session cwd. */
function resolveToolPath(path: string, cwd: string | undefined): string {
  return isAbsolute(path) ? resolvePath(path) : resolvePath(cwd ?? process.cwd(), path)
}

/** Sidecar file path inside a package directory (or next to a bare file name). */
function packageSidecarPath(packagePath: string, name: string): string {
  const cleaned = packagePath.replace(/\/+$/, '')
  return cleaned === '' ? name : join(cleaned, name)
}

/** Structural tools registry face; the host provides the real one. */
interface ToolsFace {
  register(definition: unknown): () => void
}

/** Structural model-facing tool definition this bundle registers. */
interface ToolOutputFace {
  schema: { type: string }
  render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>
}

interface ToolDefinitionFace {
  name: string
  description: string
  parameters: unknown
  output: ToolOutputFace
  execute(args: unknown, exec?: ToolExecFace): Promise<string>
}

/** The shared string output renderer for every tool this bundle registers. */
function textOutput(): ToolOutputFace {
  return {
    schema: { type: 'string' },
    render(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
      return [{ type: 'text', text: String(value) }]
    },
  }
}

/** Structural fs/observed payload: target carries a display path. */
interface ObservedTarget {
  displayPath?: unknown
}

// The runtime declares this event in dsh-fs; declare it locally so the bundle
// stays installable without registry-absent runtime versions.
declare module '@deepseek-ai/cordis' {
  interface Events {
    'fs/observed'(target: ObservedTarget, observation: unknown, actor: unknown): void
  }
}

/** True when a path is an active spec-package XML artifact (archive excluded). */
function isSpecPath(path: string): boolean {
  if (!path.endsWith('.xml')) return false
  if (!path.includes('.vvoc/specs/')) return false
  if (path.includes('.vvoc/specs/archive/')) return false
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name === 'spec.xml' || name === 'plan.xml' || name === 'design-context.xml'
}

/** One-line bounded summary of a verdict. */
export function verdictLine(verdict: LintVerdict, maxChars: number): string {
  // A stale approval is the hard stop for vv-execute (§K), so keep it in the
  // bounded line even when the verdict carries more than three errors.
  const rank = (rule: string): number => (rule === 'stale-approval' ? 0 : 1)
  const errors = [...verdict.errors].sort((left, right) => rank(left.rule) - rank(right.rule))
  const parts = [
    `${verdict.errors.length} errors`,
    ...errors.slice(0, 3).map((finding) => `${finding.rule}: ${finding.message}`),
    verdict.warnings.length > 0 ? `${verdict.warnings.length} warnings` : '',
  ].filter((part) => part !== '')
  const line = `[spec-guard] ${parts.join('; ')}`
  return line.length <= maxChars ? line : `${line.slice(0, maxChars - 1)}…`
}

/**
 * Lint one XML text by file name.
 *
 * The third argument is the host-provided options bag (§K approvals, §L
 * receipts, sibling spec text); the original `lintFile(name, text, specText)`
 * call shape is still accepted for backward compatibility.
 */
export function lintFile(name: string, text: string, options: PlanLintOptions | string = {}): LintVerdict {
  const resolved: PlanLintOptions = typeof options === 'string' ? { specText: options } : options
  if (name === 'spec.xml') return lintSpec(text, resolved)
  if (name === 'plan.xml') return lintPlan(text, resolved)
  if (name === 'design-context.xml') {
    return { errors: [], warnings: [{ rule: 'unsupported', message: 'design-context.xml is not linted yet' }] }
  }
  return { errors: [{ rule: 'unknown', message: `unknown artifact ${name}` }], warnings: [] }
}

// ── §K approvals sidecar (host I/O) ──────────────────────────────────────────

/** One approvals.json entry (§K shape). */
interface ApprovalEntry {
  artifact: string
  sha256: string
  status_at_approval?: string
  approved_at?: string
}

/** Parse approvals.json tolerantly; throws when the file is corrupt. */
function parseApprovals(text: string): ApprovalEntry[] {
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object')
  const approvals = (parsed as { approvals?: unknown }).approvals
  if (!Array.isArray(approvals)) throw new Error('expected an "approvals" array')
  const entries: ApprovalEntry[] = []
  for (const item of approvals) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (typeof record.artifact !== 'string' || typeof record.sha256 !== 'string') continue
    entries.push({
      artifact: record.artifact,
      sha256: record.sha256,
      ...(typeof record.status_at_approval === 'string' ? { status_at_approval: record.status_at_approval } : {}),
      ...(typeof record.approved_at === 'string' ? { approved_at: record.approved_at } : {}),
    })
  }
  return entries
}

/** Last entry per artifact wins: replace same-artifact entries, keep the rest. */
function upsertApproval(entries: ApprovalEntry[], entry: ApprovalEntry): ApprovalEntry[] {
  return [...entries.filter((existing) => existing.artifact !== entry.artifact), entry]
}

/**
 * Top-level lifecycle status.
 *
 * vv artifacts keep `status` on the root element; a direct `<status>` child is
 * accepted too so a hand-written artifact is never refused for spelling alone.
 */
function topLevelStatus(root: XmlNode): string | undefined {
  const attribute = root.attrs.status
  if (typeof attribute === 'string' && attribute.trim() !== '') return attribute.trim()
  const child = root.children.find((node) => node.name === 'status')
  const value = (child?.text ?? '').trim()
  return value === '' ? undefined : value
}

// ── §L receipts sidecar (host I/O) ──────────────────────────────────────────

/**
 * Parse receipts.jsonl tolerantly (§L).
 *
 * Every non-empty line must be a JSON object; only `task_id`, `command`, and
 * `exit_code` are used by the lint, and other documented fields (`ts`, `ac_id`,
 * `output_digest`, `output_tail`, `head_oid`, `provenance`) are preserved by
 * the writer, not needed here. Malformed lines are reported so the host can
 * surface a `receipt-malformed` warning instead of failing the whole verdict.
 */
export function parseReceiptsJsonl(text: string): {
  receipts: ReceiptLike[]
  malformed: Array<{ line: number; error: string }>
} {
  const receipts: ReceiptLike[] = []
  const malformed: Array<{ line: number; error: string }> = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line === '') continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object')
      const record = parsed as Record<string, unknown>
      receipts.push({
        ...(typeof record.task_id === 'string' ? { task_id: record.task_id } : {}),
        ...(typeof record.command === 'string' ? { command: record.command } : {}),
        ...(typeof record.exit_code === 'number' ? { exit_code: record.exit_code } : {}),
      })
    } catch (error) {
      malformed.push({ line: index + 1, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { receipts, malformed }
}

// ── §M byte-evidence checker (pure part) ────────────────────────────────────

/** Split file text into lines with line terminators stripped (CRLF safe). */
function normalizeFileLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
  // A trailing newline terminates the last line; it does not create an extra one.
  if (text.endsWith('\n') && lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Normalize an excerpt's line breaks the same way as file lines (§M). */
function normalizeExcerpt(excerpt: string): string {
  return excerpt
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .join('\n')
}

/**
 * §M byte-evidence verdict for one anchor.
 *
 * `fileText === null` models a file the host could not read. The selected
 * inclusive 1-based line range has its terminators stripped and is joined with
 * `\n` (hive `anchor_digest` formula); the digest is the lowercase SHA-256 hex
 * of those UTF-8 bytes, and the excerpt is compared byte-for-byte after the
 * same line-break normalization. Verdicts: MATCH | MISMATCH | OUT_OF_RANGE |
 * UNREADABLE.
 */
export function evidenceVerdict(fileText: string | null, startLine: number, endLine: number, excerpt: string): string {
  if (fileText === null) return 'UNREADABLE'
  const lines = normalizeFileLines(fileText)
  const lineCount = lines.length
  const inRange = Number.isInteger(startLine) && Number.isInteger(endLine)
    && startLine >= 1 && endLine >= 1 && startLine <= endLine
    && startLine <= lineCount && endLine <= lineCount
  if (!inRange) {
    return `OUT_OF_RANGE (file has ${lineCount} lines; requested ${startLine}-${endLine})`
  }
  const selected = lines.slice(startLine - 1, endLine)
  const actual = selected.join('\n')
  const digest = sha256Hex(actual)
  if (Buffer.from(actual, 'utf8').equals(Buffer.from(normalizeExcerpt(excerpt), 'utf8'))) {
    return `MATCH anchor_digest=${digest}`
  }
  const shown = selected
    .slice(0, 10)
    .map((line, offset) => `${startLine + offset}: ${line}`)
    .join('\n')
  return `MISMATCH anchor_digest=${digest}\nactual lines (first ${Math.min(selected.length, 10)}):\n${shown}`
}

// ── §N risk output line ─────────────────────────────────────────────────────

/** §N: one extra tool-output line printed after the plan.xml verdict line. */
function riskOutputLine(risk: PlanRiskResult): string {
  if (risk.level === 'standard') {
    return risk.note === undefined ? 'risk: standard' : `risk: standard (note: ${risk.note})`
  }
  const first = risk.reasons[0]
  if (first === undefined) return 'risk: mandatory'
  const extra = risk.reasons.length > 1 ? `; +${risk.reasons.length - 1} more` : ''
  return `risk: mandatory (${first.category}: ${first.evidence}${extra})`
}

// ── Tool registration ───────────────────────────────────────────────────────

/** `spec_guard_lint`: the deterministic probe over one package or XML file. */
function createLintTool(ctx: Context, verdictMaxChars: number): ToolDefinitionFace {
  return {
    name: 'spec_guard_lint',
    description: 'Детерминированная проверка .vvoc spec/plan XML-артефактов: линт одного файла (spec.xml/plan.xml) или пакета .vvoc/specs/YYYY-MM-DD-<slug>/. Для plan.xml подхватывает sibling spec.xml. Путь может быть абсолютным или относительным — относительный разрешается от текущего рабочего каталога сессии (например .vvoc/specs/2026-11-07-<slug>/). Проверяет статус/идентичности/ссылки/циклы/полноту, §K stale-approval по approvals.json, §L receipt-missing/receipt-failed по receipts.jsonl и печатает risk: standard|mandatory (§N) для plan.xml.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Путь к XML-файлу или к директории пакета .vvoc/specs/YYYY-MM-DD-<slug>/.' },
      },
      required: ['path'],
    },
    output: textOutput(),
    async execute(args: unknown, exec?: ToolExecFace): Promise<string> {
      const raw = args as { path?: unknown }
      const requestPath = typeof raw?.path === 'string' ? raw.path.trim() : ''
      if (requestPath === '') return '[spec-guard] path is required'
      const fs = ctx.get('fs') as FsFace | undefined
      if (fs === undefined) return '[spec-guard] fs service unavailable'
      const cwd = baseCwdFor(ctx, exec)

      const lines: string[] = ['spec-guard lint']
      const files: Array<{ name: string; path: string }> = []
      const isFile = requestPath.endsWith('.xml')
      if (isFile) {
        files.push({ name: requestPath.slice(requestPath.lastIndexOf('/') + 1), path: requestPath })
      } else {
        for (const artifactName of ['spec.xml', 'plan.xml']) {
          files.push({ name: artifactName, path: `${requestPath.replace(/\/+$/, '')}/${artifactName}` })
        }
      }
      const packagePath = isFile ? dirname(requestPath) : requestPath

      // §K: the sidecar is a host-side read; the engine only sees parsed entries.
      let approvalEntries: ApprovalEntry[] = []
      let approvalSidecarPresent = false
      try {
        const sidecarText = await readArtifact(fs, packageSidecarPath(packagePath, 'approvals.json'), cwd, exec?.signal)
        approvalSidecarPresent = true
        try {
          approvalEntries = parseApprovals(sidecarText)
        } catch {
          // Corrupt sidecar: behave like a pre-§K package (approval-unverified
          // warning) instead of failing the whole lint.
          approvalEntries = []
        }
      } catch {
        // No approvals.json: pre-§K packages stay valid, just unverified.
      }

      // §L: receipts are only needed for plan.xml, but reading once per call is cheap.
      let receipts: ReceiptLike[] = []
      const receiptWarnings: Array<{ rule: string; message: string }> = []
      try {
        const parsed = parseReceiptsJsonl(await readArtifact(fs, packageSidecarPath(packagePath, 'receipts.jsonl'), cwd, exec?.signal))
        receipts = parsed.receipts
        for (const malformed of parsed.malformed) {
          receiptWarnings.push({ rule: 'receipt-malformed', message: `receipts.jsonl line ${malformed.line}: ${malformed.error}` })
        }
      } catch {
        // No receipts.jsonl: only applied plans (or explicit checkReceipts) require receipts.
      }

      let specText: string | undefined
      const spec = files.find((file) => file.name === 'spec.xml')
      if (spec !== undefined) {
        try {
          specText = await readArtifact(fs, spec.path, cwd, exec?.signal)
        } catch {
          lines.push(`[spec-guard] cannot read ${spec.path}`)
        }
      }

      for (const file of files) {
        let text: string
        try {
          text = await readArtifact(fs, file.path, cwd, exec?.signal)
        } catch (error) {
          lines.push(`${file.path}: unreadable (${error instanceof Error ? error.message : String(error)})`)
          continue
        }
        const approvalEntry = approvalEntries.filter((entry) => entry.artifact === file.name).pop()
        const lintOptions: PlanLintOptions = {
          ...(specText === undefined ? {} : { specText }),
          ...(approvalEntry === undefined ? {} : { approval: { sha256: approvalEntry.sha256 } }),
          currentSha256: sha256Hex(text),
          approvalSidecarPresent,
          receipts,
        }
        const verdict = lintFile(file.name, text, lintOptions)
        if (file.name === 'plan.xml' && receiptWarnings.length > 0) verdict.warnings.push(...receiptWarnings)
        lines.push(`${file.path}: ${verdictLine(verdict, verdictMaxChars)}`)
        if (file.name === 'plan.xml') lines.push(riskOutputLine(classifyPlanRisk(text)))
        // Bounded detail lines: errors first (stale-approval is re-ordered to
        // the front by verdictLine's caller order) so §K/§L findings surface in
        // package mode; warnings such as approval-unverified/receipt-malformed
        // follow while the budget lasts.
        for (const finding of [...verdict.errors, ...verdict.warnings].slice(0, 8)) {
          lines.push(`  [${finding.rule}] ${finding.message}`)
        }
      }
      return lines.join('\n')
    },
  }
}

/**
 * `spec_guard_approve`: §K host-issued approval digest.
 *
 * Reads an approved artifact (or both artifacts of a package directory), checks
 * the top-level status is `approved`, hashes the RAW file bytes, and upserts the
 * sidecar entry. A non-approved artifact is a typed refusal and never written.
 */
function createApproveTool(ctx: Context): ToolDefinitionFace {
  return {
    name: 'spec_guard_approve',
    description: '§K digest-одобрение: хост сам считает SHA-256 сырых байтов approved-артефакта и пишет/обновляет запись в <package>/approvals.json ({approvals:[{artifact,sha256,status_at_approval,approved_at}]}, последняя запись на артефакт побеждает). Принимает spec.xml/plan.xml или директорию пакета (тогда одобряются оба существующих артефакта). Если top-level status не approved — типизированный отказ "status must be approved, found X" и НИЧЕГО не пишется. Возвращает артефакт, полный sha256 и путь sidecar.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Путь к spec.xml/plan.xml или к директории пакета .vvoc/specs/YYYY-MM-DD-<slug>/.' },
      },
      required: ['path'],
    },
    output: textOutput(),
    async execute(args: unknown, exec?: ToolExecFace): Promise<string> {
      const raw = args as { path?: unknown }
      const requestPath = typeof raw?.path === 'string' ? raw.path.trim() : ''
      if (requestPath === '') return '[spec-guard] approve: path is required'
      try {
        const cwd = baseCwdFor(ctx, exec)
        const absolute = resolveToolPath(requestPath, cwd)

        let stats
        try {
          stats = statSync(absolute)
        } catch {
          return `[spec-guard] approve: cannot stat ${absolute}`
        }

        const artifacts: Array<{ name: string; path: string }> = []
        if (stats.isDirectory()) {
          for (const artifactName of ['spec.xml', 'plan.xml']) {
            const candidate = join(absolute, artifactName)
            if (existsSync(candidate)) artifacts.push({ name: artifactName, path: candidate })
          }
          if (artifacts.length === 0) return `[spec-guard] approve: no spec.xml/plan.xml found in ${absolute}`
        } else {
          const artifactName = basename(absolute)
          if (artifactName !== 'spec.xml' && artifactName !== 'plan.xml') {
            return `[spec-guard] approve: unsupported artifact "${artifactName}" (expected spec.xml or plan.xml)`
          }
          artifacts.push({ name: artifactName, path: absolute })
        }

        const packageDir = stats.isDirectory() ? absolute : dirname(absolute)
        const sidecarPath = join(packageDir, 'approvals.json')

        const notices: string[] = []
        let approvals: ApprovalEntry[] = []
        if (existsSync(sidecarPath)) {
          try {
            approvals = parseApprovals(readFileSync(sidecarPath, 'utf8'))
          } catch (error) {
            // Tolerate a corrupt sidecar: start fresh, but say so in the result.
            notices.push(`warning: corrupt ${sidecarPath} (${error instanceof Error ? error.message : String(error)}); starting fresh`)
            approvals = []
          }
        }

        const lines: string[] = ['spec-guard approve']
        let approvedCount = 0
        for (const artifact of artifacts) {
          let buffer: Buffer
          try {
            buffer = readFileSync(artifact.path)
          } catch (error) {
            lines.push(`${artifact.name}: unreadable (${error instanceof Error ? error.message : String(error)})`)
            continue
          }
          let root: XmlNode
          try {
            root = parseXmlLite(buffer.toString('utf8'))
          } catch (error) {
            lines.push(`${artifact.name}: REFUSED (malformed XML: ${error instanceof Error ? error.message : String(error)})`)
            continue
          }
          const status = topLevelStatus(root)
          if (status !== 'approved') {
            lines.push(`${artifact.name}: REFUSED (status must be approved, found ${status ?? 'missing'})`)
            continue
          }
          const sha256 = sha256Hex(buffer)
          approvals = upsertApproval(approvals, {
            artifact: artifact.name,
            sha256,
            status_at_approval: 'approved',
            approved_at: new Date().toISOString(),
          })
          approvedCount += 1
          lines.push(`${artifact.name}: digest recorded`)
          lines.push(`  sha256: ${sha256}`)
          lines.push(`  sidecar: ${sidecarPath}`)
        }

        if (approvedCount === 0) {
          lines.push('approvals.json not modified')
          return [...notices, ...lines].join('\n')
        }
        writeFileSync(sidecarPath, `${JSON.stringify({ approvals }, null, 2)}\n`)
        return [...notices, ...lines].join('\n')
      } catch (error) {
        return `[spec-guard] approve failed: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  }
}

/**
 * `spec_guard_evidence`: §M byte-evidence checker.
 *
 * The host reads the file (session-cwd-relative paths supported) and hands the
 * text to the pure verdict helper; an unreadable file yields UNREADABLE.
 */
function createEvidenceTool(ctx: Context): ToolDefinitionFace {
  return {
    name: 'spec_guard_evidence',
    description: '§M byte-exact проверка evidence anchor: хост читает файл, берёт инклюзивный диапазон строк 1-based, склеивает их через \\n, считает lowercase sha256 (anchor_digest) и побайтно сравнивает с excerpt (с той же нормализацией переводов строк). Вердикты: MATCH | MISMATCH | OUT_OF_RANGE | UNREADABLE; на MATCH/MISMATCH печатается anchor_digest=<hex64>, на MISMATCH — первые ≤10 фактических строк с номерами.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Путь к проверяемому файлу (абсолютный или относительный от cwd сессии).' },
        start_line: { type: 'integer', minimum: 1, description: 'Первая строка диапазона, 1-based, включительно.' },
        end_line: { type: 'integer', minimum: 1, description: 'Последняя строка диапазона, 1-based, включительно.' },
        excerpt: { type: 'string', description: 'Дословный текст ровно этих строк (без многоточий и комментариев внутри).' },
      },
      required: ['path', 'start_line', 'end_line', 'excerpt'],
    },
    output: textOutput(),
    async execute(args: unknown, exec?: ToolExecFace): Promise<string> {
      const raw = args as { path?: unknown; start_line?: unknown; end_line?: unknown; excerpt?: unknown }
      const requestPath = typeof raw?.path === 'string' ? raw.path.trim() : ''
      if (requestPath === '') return '[spec-guard] evidence: path is required'
      const excerpt = raw?.excerpt
      if (typeof excerpt !== 'string') return '[spec-guard] evidence: excerpt is required'
      const startLine = raw?.start_line
      const endLine = raw?.end_line
      if (typeof startLine !== 'number' || typeof endLine !== 'number'
        || !Number.isInteger(startLine) || !Number.isInteger(endLine)) {
        return 'OUT_OF_RANGE (start_line and end_line must be integers)'
      }
      const fs = ctx.get('fs') as FsFace | undefined
      if (fs === undefined) return 'UNREADABLE (fs service unavailable)'
      const cwd = baseCwdFor(ctx, exec)
      let text: string
      try {
        text = await readArtifact(fs, requestPath, cwd, exec?.signal)
      } catch (error) {
        return `UNREADABLE (${error instanceof Error ? error.message : String(error)})`
      }
      return evidenceVerdict(text, startLine, endLine, excerpt)
    },
  }
}

export function apply(ctx: Context, config: VvSpecGuardConfig = {}): void {
  // Boot self-diagnostic: one JSON marker per process shows whether apply ran,
  // whether the tools registry was visible immediately, and any thrown error.
  // The plugin runs host-side (unsandboxed), so the marker lands next to the
  // vv-analytics directory and costs one small write per boot.
  const markerPath = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'vv-spec-guard-boot.json')
  const marker = { ts: new Date().toISOString(), applied: false, toolsImmediate: false, registeredImmediately: false, deferred: false, registeredDeferred: false, error: undefined as string | undefined }
  const writeMarker = (): void => {
    try {
      mkdirSync(dirname(markerPath), { recursive: true })
      writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`)
    } catch {
      // diagnostics must never break the boot
    }
  }
  try {
    applyBody(ctx, config, marker, writeMarker)
    marker.applied = true
  } catch (error) {
    marker.error = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
    try { ctx.logger.error('[vv-spec-guard] apply failed: %s', marker.error) } catch { /* logger unavailable */ }
  }
  writeMarker()
}

function applyBody(
  ctx: Context,
  config: VvSpecGuardConfig,
  marker: { toolsImmediate: boolean; registeredImmediately: boolean; deferred: boolean; registeredDeferred: boolean },
  writeMarker: () => void,
): void {
  if (config.enabled === false) return
  const verdictMaxChars = config.verdictMaxChars ?? 200

  // Surface 1: verdicts into the plugin log on every observed spec-file touch.
  ctx.on('fs/observed', (target: ObservedTarget, _observation: unknown, actor: unknown) => {
    void actor
    const path = typeof target?.displayPath === 'string' ? target.displayPath : ''
    if (!isSpecPath(path)) return
    ctx.logger.warn('[vv-spec-guard] observed spec artifact %s (verdicts via spec_guard_lint tool)', path)
  })

  // Surface 2: the model-facing tools. Registration is immediate when the
  // registry is already mounted, and deferred through ctx.inject otherwise —
  // covering boot orders where a bundle row applies before the host tools
  // registry exists.
  const definitions: ToolDefinitionFace[] = []
  if (config.probeTool !== false) definitions.push(createLintTool(ctx, verdictMaxChars))
  if (config.approveTool !== false) definitions.push(createApproveTool(ctx))
  if (config.evidenceTool !== false) definitions.push(createEvidenceTool(ctx))
  if (definitions.length === 0) return

  const registerDefinitions = (tools: ToolsFace): (() => void) => {
    const disposers = definitions.map((definition) => tools.register(definition))
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // the registry is shutting down; nothing left to release
        }
      }
    }
  }

  const immediate = ctx.get('tools') as ToolsFace | undefined
  marker.toolsImmediate = immediate !== undefined
  if (immediate !== undefined) {
    ctx.effect(() => registerDefinitions(immediate))
    marker.registeredImmediately = true
  } else {
    // Deferred: the preset/bundle boot order may apply this row before the
    // host tools registry mounts; inject waits and registers on arrival.
    ctx.inject(['tools'], (injected) => {
      const tools = injected.get('tools') as ToolsFace
      ctx.effect(() => registerDefinitions(tools))
      marker.deferred = true
      marker.registeredDeferred = true
      writeMarker()
    })
  }
}

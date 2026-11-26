#!/usr/bin/env node
/**
 * `dsh-spec-guard grace audit` — repo-wide GRACE gate.
 *
 * The CLI is the repo-scope sibling of the ESLint rules and the DSH `spec_guard_grace`
 * tool: same engine, plus a scope walk, an explicit `--fail-on` policy, and the v2 baseline
 * ratchet. It never reimplements a rule.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

import {
  applyGraceBaseline,
  auditGraceFile,
  graceBaselineFromAudits,
  GRACE_BASELINE_VERSION,
  parseGraceBaseline,
  serializeGraceBaseline,
  type GraceAuditResult,
  type GraceBaseline,
} from './grace.js'

const PACKAGE_JSON = new URL('../package.json', import.meta.url)
const DEFAULT_FAIL_ON = ['unpaired-marker', 'complexity-blocks', 'complexity-missing']
const DEFAULT_EXCLUDES = new Set(['node_modules', 'dist', '.git', '.turbo', '.tmp-e2e', 'prototypes'])

interface CliFinding {
  file: string
  key: string
  rule: string
  symbol: string
  line?: number
  message: string
  severity: string
}

function usage(): string {
  return `Usage: dsh-spec-guard grace audit [options]

Repo-wide audit of GRACE markup. Exit 0 when no failing finding remains.

Options:
  --repo-root <dir>     Repository root (default: cwd)
  --scope <path>        Directory or file to audit; repeatable (default: packages)
  --exclude <name>      Directory name to skip; repeatable
  --fail-on <rules>     Comma-separated rules that fail the run
                        (default: ${DEFAULT_FAIL_ON.join(',')})
  --baseline <file>     Read a v2 baseline; regressions fail, accepted debt is reported
  --accept              Write current findings to --baseline (explicit debt acceptance)
  --json                Machine-readable output
  --version             Print the engine version
  --help                Print this help

Exit codes: 0 pass, 1 findings/regressions, 2 usage or I/O error.`
}

function packageVersion(): string {
  const parsed = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { version?: string }
  return parsed.version ?? '0.0.0'
}

function collectFiles(target: string, excludes: Set<string>, files: string[]): void {
  const stats = statSync(target)
  if (stats.isFile()) {
    if (/\.(?:ts|tsx|vue)$/.test(target)) files.push(target)
    return
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (excludes.has(entry.name) || entry.name.startsWith('.git')) continue
      collectFiles(join(target, entry.name), excludes, files)
    } else if (entry.isFile() && /\.(?:ts|tsx|vue)$/.test(entry.name)) {
      files.push(join(target, entry.name))
    }
  }
}

function resolveScopes(repoRoot: string, scopes: string[]): string[] {
  const resolved = scopes.map(scope => resolve(repoRoot, scope))
  for (const scope of resolved) {
    try {
      statSync(scope)
    } catch {
      throw new Error(`scope not found: ${scope}`)
    }
  }
  return resolved
}

function main(): number {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      'repo-root': { type: 'string' },
      'scope': { type: 'string', multiple: true },
      'exclude': { type: 'string', multiple: true },
      'fail-on': { type: 'string' },
      'baseline': { type: 'string' },
      'accept': { type: 'boolean', default: false },
      'json': { type: 'boolean', default: false },
      'version': { type: 'boolean', default: false },
      'help': { type: 'boolean', default: false },
    },
  })

  if (values.version === true) {
    process.stdout.write(`${packageVersion()}\n`)
    return 0
  }
  const command = positionals[0] === 'grace' ? positionals[1] : positionals[0]
  if (values.help === true || command === 'help') {
    process.stdout.write(`${usage()}\n`)
    return 0
  }
  if (command !== undefined && command !== 'audit') {
    process.stderr.write(`[grace] unknown command: ${command}\n${usage()}\n`)
    return 2
  }
  if (values.accept === true && values.baseline === undefined) {
    process.stderr.write('[grace] --accept requires --baseline <file>\n')
    return 2
  }

  const repoRoot = resolve(values['repo-root'] ?? process.cwd())
  const scopes = values.scope !== undefined && values.scope.length > 0 ? values.scope : ['packages']
  const excludes = new Set([...DEFAULT_EXCLUDES, ...(values.exclude ?? [])])
  const failOn = new Set((values['fail-on'] ?? DEFAULT_FAIL_ON.join(',')).split(',').map(rule => rule.trim()).filter(Boolean))

  let targets: string[]
  try {
    targets = resolveScopes(repoRoot, scopes)
  } catch (error) {
    process.stderr.write(`[grace] ${(error as Error).message}\n`)
    return 2
  }

  const files: string[] = []
  try {
    for (const target of targets) collectFiles(target, excludes, files)
  } catch (error) {
    process.stderr.write(`[grace] cannot walk scope: ${(error as Error).message}\n`)
    return 2
  }
  files.sort()

  const results: GraceAuditResult[] = []
  for (const file of files) {
    const relativePath = relative(repoRoot, file).split(sep).join('/')
    try {
      results.push(auditGraceFile(relativePath, readFileSync(file, 'utf8')))
    } catch (error) {
      process.stderr.write(`[grace] cannot read ${relativePath}: ${(error as Error).message}\n`)
      return 2
    }
  }

  const counts: Record<string, number> = {}
  const allFindings: CliFinding[] = []
  for (const result of results) {
    for (const finding of result.findings) {
      counts[finding.rule] = (counts[finding.rule] ?? 0) + 1
      allFindings.push({
        file: result.path,
        key: finding.key,
        rule: finding.rule,
        symbol: finding.symbol,
        line: finding.displayLine,
        message: finding.message,
        severity: finding.severity,
      })
    }
  }

  let failing: CliFinding[]
  let regressions: CliFinding[] = []
  let accepted = 0
  let baseline: GraceBaseline | null = null
  if (values.baseline !== undefined) {
    const baselinePath = resolve(repoRoot, values.baseline)
    try {
      baseline = parseGraceBaseline(readFileSync(baselinePath, 'utf8'))
    } catch (error) {
      if (values.accept !== true) {
        process.stderr.write(`[grace] cannot read baseline ${baselinePath}: ${(error as Error).message}\n`)
        return 2
      }
      baseline = { version: GRACE_BASELINE_VERSION, files: {} }
    }
    if (values.accept === true) {
      const fresh = graceBaselineFromAudits(results.filter(result => result.hasGrace))
      mkdirSync(dirname(baselinePath), { recursive: true })
      writeFileSync(baselinePath, serializeGraceBaseline(fresh), 'utf8')
      process.stdout.write(`[grace] baseline written: ${baselinePath} (${Object.values(counts).reduce((sum, value) => sum + value, 0)} findings, version ${GRACE_BASELINE_VERSION})\n`)
      return 0
    }
    if (baseline.version !== GRACE_BASELINE_VERSION) {
      process.stderr.write(`[grace] baseline version ${baseline.version} is not supported (expected ${GRACE_BASELINE_VERSION})\n`)
      return 2
    }
    const pruned: GraceBaseline = { version: GRACE_BASELINE_VERSION, files: { ...baseline.files } }
    for (const result of results) {
      const split = applyGraceBaseline(result, pruned, result.path)
      accepted += split.accepted.length
      for (const finding of split.regressions) {
        regressions.push({
          file: result.path,
          key: finding.key,
          rule: finding.rule,
          symbol: finding.symbol,
          line: finding.displayLine,
          message: finding.message,
          severity: finding.severity,
        })
      }
    }
    failing = regressions
  } else {
    failing = allFindings.filter(finding => failOn.has(finding.rule))
  }

  if (values.json === true) {
    process.stdout.write(`${JSON.stringify({
      engine: { name: '@alexquidditch/dsh-spec-guard', version: packageVersion() },
      repoRoot,
      scopes,
      counts,
      baseline: baseline === null ? null : { version: baseline.version, files: Object.keys(baseline.files).length, accepted },
      failing: failing.length,
      regressions: regressions.length,
      findings: allFindings,
      failingFindings: failing,
    }, null, 2)}\n`)
  } else {
    const lines = [
      `GRACE audit: ${scopes.join(', ')} (engine @alexquidditch/dsh-spec-guard v${packageVersion()})`,
      `files scanned: ${files.length}; graced files: ${results.filter(result => result.hasGrace).length}`,
    ]
    for (const rule of Object.keys(counts).sort()) lines.push(`  ${rule}: ${counts[rule]}`)
    if (baseline !== null) lines.push(`baseline: ${values.baseline} (v${baseline.version}, accepted findings: ${accepted})`)
    for (const finding of failing.slice(0, 40)) {
      lines.push(`  FAIL [${finding.rule}] ${finding.file}${finding.line === undefined ? '' : `:${finding.line}`} — ${finding.message}`)
    }
    if (failing.length > 40) lines.push(`  ... and ${failing.length - 40} more`)
    lines.push(failing.length === 0
      ? `VERDICT: pass (${failOn.size === 0 ? 'no fail-on rules' : `${allFindings.filter(finding => failOn.has(finding.rule)).length} failing findings are baselined or absent`})`
      : `VERDICT: fail (${failing.length} finding${failing.length === 1 ? '' : 's'})`)
    process.stdout.write(`${lines.join('\n')}\n`)
  }
  return failing.length === 0 ? 0 : 1
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write(`[grace] ${(error as Error).message}\n`)
  process.exitCode = 2
}

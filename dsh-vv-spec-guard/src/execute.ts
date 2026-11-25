/**
 * P4 execution-feedback host checks (dsh-vv-spec-guard).
 *
 * Two deterministic gates that close the execution loop of the cross-scope contract:
 *
 * 1. checkUndeclaredDeletions — the COMMIT gate. Compares the actual git diff
 *    (deletions/renames/type-changes) against the plan's structured <deletes>/<renames>
 *    surface. A destructive diff entry the plan never declared is an
 *    `undeclared-deletion`. Kind-separated matching (feedback F3): a diff DELETE must
 *    match a declared delete; a diff RENAME must match a declared rename PAIR (from
 *    AND to) — a declared delete is NOT satisfied by a rename that keeps the file.
 *    Defaults to WORKTREE (feedback F1) so the about-to-be-committed staged/unstaged
 *    deletions are visible, not just already-committed history.
 *
 * 2. computeStaleImpact — the PRE-FLIGHT drift gate. Re-runs the census at the pinned
 *    baseline and at the current ref; compares consumer EDGE tuples and file sets
 *    (feedback F4), not just scope names, so a new consumer inside an existing scope
 *    is detected as drift.
 *
 * Host-side (I/O allowed): git + the census engine. The pure lint.ts verdict engine
 * stays zero-dependency and only compares host-supplied values.
 */
import { execFileSync } from 'node:child_process'
import { runCensusCached, type CensusInput, type CensusResult } from './census.js'

// ── undeclared-deletion (commit gate) ─────────────────────────────────────────

export interface UndeclaredDeletionInput {
  repoRoot: string
  /** OID (or resolvable rev) to diff FROM — the pinned plan baseline. */
  baselineRef: string
  /** Diff target; defaults to WORKTREE (staged+unstaged vs baseline). 'HEAD' or an
   *  OID compares committed history only. */
  headRef?: string
  /** Plan <deletes> paths (repo-relative). */
  declaredPaths: string[]
  /** Plan <renames> from/to pairs. */
  declaredRenames?: Array<{ from: string; to: string }>
}

export interface UndeclaredEntry {
  path: string
  kind: 'delete' | 'rename' | 'type-change'
  to?: string
}

export type UndeclaredDeletionResult =
  | { ok: true; undeclared: UndeclaredEntry[]; diffCount: number; declaredCount: number }
  | { ok: false; rule: string; message: string }

function git(repoRoot: string, args: string[]): string {
  // core.quotepath=false so non-ASCII paths are not C-quoted (feedback M3).
  return execFileSync('git', ['-C', repoRoot, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function resolveOid(repoRoot: string, ref: string): string | undefined {
  try {
    return git(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]).trim()
  } catch {
    return undefined
  }
}

/** Normalize a repo-relative path the same way the census does (strip ./ and trailing /). */
function normalizePath(path: string): string {
  let p = path.trim()
  while (p.startsWith('./')) p = p.slice(2)
  while (p.endsWith('/')) p = p.slice(0, -1)
  return p
}

/**
 * Compare git diff destructive entries against the declared plan surface, kind-separated.
 * D / T must match a declared delete; R must match a declared rename pair (from AND to).
 */
export function checkUndeclaredDeletions(input: UndeclaredDeletionInput): UndeclaredDeletionResult {
  const baselineOid = resolveOid(input.repoRoot, input.baselineRef)
  if (baselineOid === undefined) return { ok: false, rule: 'census-ref-unreachable', message: `baseline ref ${input.baselineRef} is unreachable` }
  // Default WORKTREE: the commit gate must see the staged/unstaged deletions about to
  // be committed, not only already-committed history (feedback F1).
  const head = input.headRef ?? 'WORKTREE'
  const declaredDeletes = new Set<string>(input.declaredPaths.map(normalizePath))
  const declaredRenamePairs = new Map<string, string>()
  for (const rename of input.declaredRenames ?? []) {
    declaredRenamePairs.set(normalizePath(rename.from), normalizePath(rename.to))
  }

  let diffText: string
  try {
    diffText = head === 'WORKTREE'
      ? git(input.repoRoot, ['diff', '--name-status', '-M', baselineOid])
      : git(input.repoRoot, ['diff', '--name-status', '-M', baselineOid, head])
  } catch (error) {
    return { ok: false, rule: 'diff-failed', message: error instanceof Error ? error.message : String(error) }
  }

  const undeclared: UndeclaredEntry[] = []
  let diffCount = 0
  for (const rawLine of diffText.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const parts = line.split('\t')
    const status = parts[0] ?? ''
    if (status.startsWith('D')) {
      diffCount += 1
      const path = normalizePath(parts[1] ?? '')
      if (path !== '' && !declaredDeletes.has(path)) undeclared.push({ path, kind: 'delete' })
    } else if (status.startsWith('R')) {
      diffCount += 1
      const from = normalizePath(parts[1] ?? '')
      const to = normalizePath(parts[2] ?? '')
      // A rename must match a declared rename PAIR; a declared delete does not cover it.
      const declaredTo = declaredRenamePairs.get(from)
      if (from !== '' && (declaredTo === undefined || declaredTo !== to)) {
        undeclared.push({ path: from, kind: 'rename', to })
      }
    } else if (status.startsWith('T')) {
      // Type-change (file → symlink/gitlink) is destructive (feedback M4).
      diffCount += 1
      const path = normalizePath(parts[1] ?? '')
      if (path !== '' && !declaredDeletes.has(path)) undeclared.push({ path, kind: 'type-change' })
    }
  }
  return { ok: true, undeclared, diffCount, declaredCount: declaredDeletes.size + declaredRenamePairs.size }
}

// ── stale-impact (pre-flight drift gate) ──────────────────────────────────────

export interface StaleImpactInput extends CensusInput {
  /** The current ref to compare against the pinned baseline. */
  currentRef: string
}

export type StaleImpactResult =
  | {
      ok: true
      drift: boolean
      newScopes: string[]
      newEdgeCount: number
      newEdges: Array<{ scope: string; kind: string; source: string; target: string }>
      removedScopes: string[]
      removedDeclaredPaths: string[]
      baselineDigest: string
      currentDigest: string
    }
  | { ok: false; rule: string; message: string }

/** True when a repo-relative path exists at a committed ref (git cat-file probe). */
function pathExistsAtRef(repoRoot: string, oid: string, path: string): boolean {
  try {
    execFileSync('git', ['-C', repoRoot, 'cat-file', '-e', `${oid}:${path}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Re-run the census at the pinned baseline and at currentRef; compare consumer EDGE
 * tuples (scope,kind,source,target) and scope sets, so a new consumer edge inside an
 * already-present scope is drift (feedback F4). The current-side run tolerates declared
 * paths that have already moved/vanished (feedback: current-side abort) — they are
 * dropped from that run and reported as removedDeclaredPaths drift. An empty destructive
 * surface is refused (stale-impact-vacuous-surface) rather than returning a green.
 */
export async function computeStaleImpact(input: StaleImpactInput): Promise<StaleImpactResult> {
  const surfaceCount = input.deletedSymbols.length + input.deletedPaths.length
    + (input.renamedSymbols?.length ?? 0) + (input.renamedPaths?.length ?? 0)
  if (surfaceCount === 0) {
    return { ok: false, rule: 'stale-impact-vacuous-surface', message: 'deletion+rename surface is empty; nothing to census (derive it from the spec impact pin + plan deletes/renames)' }
  }
  const baselineInput: CensusInput = { ...input, currentRef: undefined }
  const baseline: CensusResult = await runCensusCached(baselineInput)
  if (!baseline.ok) return { ok: false, rule: baseline.rule, message: `baseline census: ${baseline.message}` }

  // Current-side: tolerate declared paths already absent at currentRef (a prior session
  // may have committed part of the destructive surface). Drop them and report as drift.
  const currentOid = resolveOid(input.repoRoot, input.currentRef)
  if (currentOid === undefined) return { ok: false, rule: 'census-ref-unreachable', message: `current ref ${input.currentRef} is unreachable` }
  const removedDeclaredPaths: string[] = []
  const currentDeletedPaths = input.deletedPaths.filter((path) => {
    const exists = pathExistsAtRef(input.repoRoot, currentOid, normalizePath(path))
    if (!exists) removedDeclaredPaths.push(path)
    return exists
  })
  const currentRenamedPaths = (input.renamedPaths ?? []).filter((rename) => pathExistsAtRef(input.repoRoot, currentOid, normalizePath(rename.from)))
  const currentInput: CensusInput = {
    ...input,
    baselineRef: input.currentRef,
    currentRef: undefined,
    deletedPaths: currentDeletedPaths,
    ...(input.renamedPaths === undefined ? {} : { renamedPaths: currentRenamedPaths }),
  }
  const current: CensusResult = await runCensusCached(currentInput)
  if (!current.ok) return { ok: false, rule: current.rule, message: `current census (ref ${input.currentRef}): ${current.message}` }

  const edgeKey = (scope: string, edge: { kind: string; source: string; target: string }): string =>
    `${scope}|${edge.kind}|${edge.source}|${edge.target}`
  const baselineEdges = new Set<string>()
  for (const scope of baseline.output.perScope) {
    for (const edge of scope.edges) baselineEdges.add(edgeKey(scope.scope, edge))
  }
  const baselineScopes = new Set(baseline.output.perScope.map((scope) => scope.scope))
  const currentScopes = new Set(current.output.perScope.map((scope) => scope.scope))

  const newEdges: Array<{ scope: string; kind: string; source: string; target: string }> = []
  for (const scope of current.output.perScope) {
    for (const edge of scope.edges) {
      if (!baselineEdges.has(edgeKey(scope.scope, edge))) {
        newEdges.push({ scope: scope.scope, kind: edge.kind, source: edge.source, target: edge.target })
      }
    }
  }
  const newScopes = [...currentScopes].filter((scope) => !baselineScopes.has(scope)).sort()
  const removedScopes = [...baselineScopes].filter((scope) => !currentScopes.has(scope)).sort()
  return {
    ok: true,
    drift: newEdges.length > 0 || removedDeclaredPaths.length > 0,
    newScopes,
    newEdgeCount: newEdges.length,
    newEdges: newEdges.slice(0, 50),
    removedScopes,
    removedDeclaredPaths,
    baselineDigest: baseline.output.outputDigest,
    currentDigest: current.output.outputDigest,
  }
}
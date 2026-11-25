#!/usr/bin/env node
/**
 * Acceptance test for spec_guard_census (P1, contract §14.5 / round-6 §20).
 *
 * Run: node census.test.mjs   (after `pnpm run build`, or the standalone tsc
 * command that emits lib/census.js — this test imports the BUILT module).
 *
 * Assertions:
 *   1. Witness: `examinations` is a runtime-import consumer of
 *      SchoolAuthorizationService at `af92a878^` via the DI constructor-param
 *      edge in examinations/exam.controller.ts (NOT type-import).
 *   2. Determinism: two consecutive runs produce the same outputDigest.
 *   3. Lifecycle: `git -C foundation worktree list` is unchanged; no temp
 *      materialization dirs are left behind.
 *   4. Real worktree lifecycle (writable repo): a `git` PATH shim proves the
 *      tool ran `worktree add`, `worktree remove --force` and `worktree prune`
 *      against a shared clone, and the clone's worktree list is unchanged.
 *
 * The foundation checkout's .git dir is outside this session's writable
 * workspace, so the tool's preferred `git worktree add` is denied there and it
 * falls back to the equivalent ref-pinned `git archive` materialization. The
 * clone run exercises the real worktree path end-to-end.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FOUNDATION = '/Users/alex_quidditch/projects/foundation'
const CENSUS_LIB = path.join(HERE, 'lib', 'census.js')
const SCOPE_DIR = 'packages/domains/education-platform'
const BASELINE_REF = 'af92a878^'
const SYMBOL = 'SchoolAuthorizationService'
const WITNESS_SCOPE = 'examinations'

const CENSUS_INPUT = {
  repoRoot: FOUNDATION,
  baselineRef: BASELINE_REF,
  scopeDir: SCOPE_DIR,
  ownerScope: 'schools',
  deletedSymbols: [SYMBOL],
  deletedPaths: [],
}

// Isolate all materialization under one temp root so leftovers are observable.
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-census-acceptance-'))
process.env.TMPDIR = TEMP_ROOT

if (!fs.existsSync(CENSUS_LIB)) {
  console.error(`Missing ${CENSUS_LIB}. Build census.ts first, e.g.:\n` +
    '  ./node_modules/.bin/tsc src/census.ts --ignoreConfig --outDir lib --target es2024 ' +
    '--module esnext --moduleResolution bundler --strict --skipLibCheck --esModuleInterop ' +
    '--declaration --types node')
  process.exit(1)
}

const { runCensus } = await import(pathToFileURL(CENSUS_LIB).href)

function gitWorktrees(repoRoot) {
  return execFileSync('git', ['-C', repoRoot, 'worktree', 'list'], { encoding: 'utf8' }).trim()
}

function leftoverCensusDirs() {
  return fs.readdirSync(TEMP_ROOT).filter((name) => name.startsWith('dsh-spec-census-'))
}

function kindCounts(edges) {
  const counts = {}
  for (const edge of edges) counts[edge.kind] = (counts[edge.kind] ?? 0) + 1
  return counts
}

function summaryRows(output) {
  return output.perScope.map((scope) => ({
    scope: scope.scope,
    hardCount: scope.hardCount,
    files: scope.files.length,
    kinds: kindCounts(scope.edges),
  }))
}

function assertWitness(output, label) {
  const witnessScope = output.perScope.find((scope) => scope.scope === WITNESS_SCOPE)
  assert.ok(witnessScope, `${label}: missing perScope entry for '${WITNESS_SCOPE}'`)
  const witnessEdges = witnessScope.edges.filter(
    (edge) => edge.kind === 'runtime-import' && edge.target === SYMBOL,
  )
  assert.ok(
    witnessEdges.length >= 1,
    `${label}: '${WITNESS_SCOPE}' has no runtime-import edge for ${SYMBOL}; got ${JSON.stringify(
      witnessScope.edges.map((edge) => ({ kind: edge.kind, target: edge.target })),
    )}`,
  )
  assert.ok(
    witnessEdges.some((edge) => edge.source.endsWith('examinations/exam.controller.ts')),
    `${label}: DI witness edge must come from examinations/exam.controller.ts; got ${witnessEdges
      .map((edge) => edge.source)
      .join(', ')}`,
  )
  assert.ok(
    !witnessScope.edges.some(
      (edge) => edge.kind === 'type-import' && edge.target === SYMBOL,
    ),
    `${label}: the exam.controller.ts DI edge must NOT be classified type-import`,
  )
}

function assertShape(output) {
  assert.match(output.outputDigest, /^[0-9a-f]{64}$/)
  assert.match(output.resolvedOid, /^[0-9a-f]{40}$/)
  assert.equal(output.analyzer.name, 'typescript')
  assert.match(output.analyzer.version, /^\d+\.\d+\.\d+/, 'analyzer.version must be an exact ts.version (no caret)')
  assert.equal(output.resolutionStrategy, 'injected-resolver')
  assert.equal(output.resolvedOid, 'a2c3ad5d8bd12ca32910c6db5537096803c8cdd9')
  for (const scope of output.perScope) {
    assert.equal(scope.hardCount, scope.edges.length)
    assert.deepEqual(scope.files, [...new Set(scope.files)].sort())
    assert.ok(scope.edges.every((edge) => edge.id.startsWith('E-')))
    assert.ok(scope.edges.every((edge) => !edge.source.includes('#')))
    assert.ok(scope.files.every((file) => !file.startsWith('refs/') && !file.includes(':line')))
    // Advisory tier must be excluded from fan-out.
    assert.ok(scope.files.every((file) => !/\.(?:test|spec)\.tsx?$|__tests__\//.test(file)))
  }
}

async function main() {
  console.log('=== spec_guard_census acceptance ===')
  console.log(`repoRoot=${FOUNDATION}`)
  console.log(`baselineRef=${BASELINE_REF} scopeDir=${SCOPE_DIR} ownerScope=schools deletedSymbols=[${SYMBOL}]\n`)

  const foundationWorktreesBefore = gitWorktrees(FOUNDATION)
  assert.deepEqual(leftoverCensusDirs(), [], 'temp root must be clean before the first run')

  // ---- run 1 (foundation, ref-pinned materialization) ----------------------
  const first = await runCensus(CENSUS_INPUT)
  assert.equal(first.ok, true, first.ok ? '' : `census failed: ${first.rule}: ${first.message}`)
  assert.deepEqual(leftoverCensusDirs(), [], 'run 1 left a temp materialization dir behind')
  assertWitness(first.output, 'run 1')
  assertShape(first.output)

  // ---- run 2 (determinism: full recompute, no cache) -----------------------
  const second = await runCensus(CENSUS_INPUT)
  assert.equal(second.ok, true, second.ok ? '' : `census run 2 failed: ${second.rule}: ${second.message}`)
  assert.deepEqual(leftoverCensusDirs(), [], 'run 2 left a temp materialization dir behind')
  assertWitness(second.output, 'run 2')
  assert.equal(
    second.output.outputDigest,
    first.output.outputDigest,
    'outputDigest must be identical across two consecutive runs',
  )
  assert.deepEqual(
    second.output.perScope,
    first.output.perScope,
    'perScope (ids, files, edges, displayLine) must be identical across identical runs',
  )
  assert.deepEqual(
    second.output.advisory,
    first.output.advisory,
    'advisory edges must be identical across identical runs',
  )

  const output = first.output
  const rows = summaryRows(output)
  console.log(`resolvedOid      = ${output.resolvedOid}`)
  console.log(`analyzer         = ${output.analyzer.name}@${output.analyzer.version}`)
  console.log(`resolutionStrategy = ${output.resolutionStrategy}`)
  console.log(`outputDigest     = ${output.outputDigest}`)
  console.log(`run-2 digest     = ${second.output.outputDigest}  (identical: true)`)
  console.log('\nperScope fan-out (ownerScope=schools excluded; tests advisory):')
  console.log('  scope'.padEnd(44) + 'hardCount  files  kinds')
  for (const row of rows) {
    console.log(
      `  ${row.scope.padEnd(40)}  ${String(row.hardCount).padEnd(9)}  ${String(row.files).padEnd(5)}  ${JSON.stringify(row.kinds)}`,
    )
  }
  const advisoryKinds = kindCounts(output.advisory)
  console.log(`\nadvisory (test/generated, NOT threshold-driving): ${output.advisory.length} edges ${JSON.stringify(advisoryKinds)}`)
  console.log(`\nWITNESS: '${WITNESS_SCOPE}' runtime-import -> ${SYMBOL} via ` +
    `${output.perScope.find((scope) => scope.scope === WITNESS_SCOPE).edges.find((edge) => edge.kind === 'runtime-import').source} ` +
    '(DI constructor-param, exam.controller.ts)')
  console.log('DETERMINISM: identical outputDigest across two full recomputes [PASS]')

  // ---- lifecycle on foundation: no worktree / temp-dir leak ----------------
  assert.equal(gitWorktrees(FOUNDATION), foundationWorktreesBefore, 'foundation worktree list changed after the runs')
  assert.deepEqual(leftoverCensusDirs(), [], 'temp materialization dirs leaked')
  console.log('LIFECYCLE (foundation): worktree list unchanged, no temp dirs left [PASS]')

  // ---- lifecycle on a WRITABLE repo: real git worktree add/remove/prune ----
  const clonePath = path.join(TEMP_ROOT, 'foundation-shared-clone')
  execFileSync('git', ['clone', '--shared', '--no-checkout', '-q', FOUNDATION, clonePath], { stdio: 'pipe' })
  const cloneWorktreesBefore = gitWorktrees(clonePath)

  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  const shimDir = path.join(TEMP_ROOT, 'git-shim')
  const gitLog = path.join(TEMP_ROOT, 'git-calls.log')
  fs.mkdirSync(shimDir, { recursive: true })
  fs.writeFileSync(
    path.join(shimDir, 'git'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(gitLog)}\nexec ${JSON.stringify(realGit)} "$@"\n`,
    { mode: 0o755 },
  )

  const childScript = [
    `import { runCensus } from ${JSON.stringify(pathToFileURL(CENSUS_LIB).href)}`,
    `const result = await runCensus(${JSON.stringify({ ...CENSUS_INPUT, repoRoot: clonePath })})`,
    'process.stdout.write(JSON.stringify(result))',
  ].join('\n')
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    cwd: HERE,
    encoding: 'utf8',
    env: {
      ...process.env,
      TMPDIR: TEMP_ROOT,
      PATH: `${shimDir}:${process.env.PATH ?? ''}`,
      DSH_CENSUS_GIT_LOG: gitLog,
    },
  })
  assert.equal(child.status, 0, `writable-repo census child failed: ${child.stderr}`)
  const cloneResult = JSON.parse(child.stdout)
  assert.equal(cloneResult.ok, true, cloneResult.ok ? '' : `clone census failed: ${cloneResult.rule}: ${cloneResult.message}`)
  assertWitness(cloneResult.output, 'writable-clone run')
  assert.equal(cloneResult.output.outputDigest, first.output.outputDigest, 'digest must not depend on repoRoot path')

  const gitCalls = fs.readFileSync(gitLog, 'utf8')
  for (const expected of ['worktree add --detach', 'worktree remove --force', 'worktree prune']) {
    assert.ok(gitCalls.includes(expected), `expected a '${expected}' git call, log was:\n${gitCalls}`)
  }
  assert.equal(gitWorktrees(clonePath), cloneWorktreesBefore, 'clone worktree list changed after the run')
  assert.equal(gitWorktrees(FOUNDATION), foundationWorktreesBefore, 'foundation worktree list changed during clone run')
  assert.deepEqual(leftoverCensusDirs(), [], 'temp materialization dirs leaked from the writable-clone run')
  console.log('LIFECYCLE (writable shared clone): `git worktree add --detach` / `remove --force` / `prune` observed;')
  console.log('  clone worktree list unchanged, no temp dirs left [PASS]')

  console.log('\nACCEPTANCE: PASS')
}

try {
  await main()
} finally {
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
}

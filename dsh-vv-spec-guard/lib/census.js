/**
 * spec_guard_census — host-side consumer census for vv SpecGuard (P1).
 *
 * Contract: schemas/census-contract.json + hive-research/vv-cross-scope-impact-rd.md
 * §14.1/§14.3/§14.5/§20. This file is a HOST tool (git + filesystem + typescript
 * compiler API); the zero-dependency lint.ts verdict engine never calls it. The
 * host computes the census/digest and lint only compares host-supplied values.
 *
 * Pipeline:
 *   1. `git rev-parse --verify <baselineRef>^{commit}` → immutable OID.
 *   2. Materialize a temp git worktree at that OID (`git worktree add --detach`).
 *      The worktree has tracked files only (no node_modules). If the repository's
 *      git dir is not writable (sandboxed/read-only checkout), fall back to an
 *      equivalent ref-pinned materialization via `git archive | tar -x`. Both are
 *      read from the pinned commit; the live working tree is NEVER the source.
 *      `@foundation/*` (and any other pnpm workspace package) resolves through an
 *      INJECTED ts.CompilerHost.resolveModuleNames resolver derived from
 *      pnpm-workspace.yaml globs + each package's package.json exports map. The
 *      live node_modules is never symlinked (it would break ref-pinning).
 *   3. `ts.createProgram` over the worktree package (tsconfig honored,
 *      moduleResolution: bundler). Test/generated files are appended to the root
 *      list so their edges can be reported as advisory (contract round-6 F8).
 *   4. Named import bindings of the deleted/renamed symbols are classified with
 *      the type checker + AST: `import type`/elided type-only refs are
 *      type-import; non-elided value refs are runtime; a parameter/property type
 *      of a DECORATED class with emitDecoratorMetadata is RUNTIME (Nest DI
 *      injects constructor-param type tokens — round-6 F2). Barrel kinds take
 *      precedence over runtime-import by the deleted symbol's declaring-module
 *      path origin (db/schemas → schema-barrel, contracts → contract-barrel).
 *   5. Partition consumers: first segment under src/backend, src/db → S-DB,
 *      src/contracts → S-CONTRACTS, other src/<seg> → S-PKG-<SEG>; the owner
 *      scope is excluded from fan-out; test/generated edges go to `advisory`.
 *   6. Canonical digest = sha256 over canonical JSON (§14.3): code-point sorts,
 *      lexicographic keys, no insignificant whitespace. Ids/display lines are
 *      NOT digested.
 *
 * v1 simplifications (documented, deliberately conservative):
 *   - Namespace imports (`import * as ns`) and `export * from` re-exports are not
 *     census edges; named import/export bindings are. `export *` does not break
 *     when a symbol is removed, and namespace-usage analysis is deferred.
 *   - Target matching is by imported symbol NAME plus (for deletedPaths) the
 *     host-extracted export names. Barrel `export *`/named re-exports are covered
 *     by name matching; a barrel that RENAMES the symbol (`export { X as Y }`) is
 *     not followed, and same-named symbols from unrelated modules are not
 *     disambiguated in v1.
 *   - No cross-process output cache or per-repo lock: each run is hermetic, uses
 *     a unique temp dir, and materializes/compiles from the pinned OID. This
 *     keeps determinism testable (two runs genuinely recompute) and avoids
 *     second-program work (currentRef/stale-impact) that belongs to P4.
 *   - currentRef is accepted but ignored (stale-impact needs a baseline+current
 *     program pair, owned by the execute pre-flight).
 *   - `files`/edges are restricted to the requested scopeDir; cross-package
 *     consumers outside it are not scanned (scopeDir is the package root per
 *     contract so schema/contract barrel consumers ARE visible). scopeDir must
 *     be a package/project directory, not the repo root: the per-scope partition
 *     is defined relative to the package (`src/backend`, `src/db`, ...).
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import ts from 'typescript';
/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */
const SCHEMA_VERSION = 1;
const RESOLUTION_STRATEGY = 'injected-resolver';
const TEMP_PREFIX = 'dsh-spec-census-';
const HARD_EDGE_KINDS = new Set([
    'runtime-import',
    'type-import',
    'schema-barrel',
    'contract-barrel',
]);
/** Follow-up #4 (v2): shared-surface barrels weigh more than local imports for fan-out. */
const EDGE_WEIGHTS = {
    'runtime-import': 1,
    'type-import': 1,
    'schema-barrel': 2,
    'contract-barrel': 2,
};
/** Typed failure carrying a lint-facing rule name (census-ref-unreachable, ...). */
class CensusFailure extends Error {
    rule;
    constructor(rule, message) {
        super(message);
        this.rule = rule;
        this.name = 'CensusFailure';
    }
}
/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */
export async function runCensus(input) {
    let cleanup;
    try {
        if (!input || typeof input.repoRoot !== 'string' || input.repoRoot.trim() === '') {
            throw new CensusFailure('census-invalid-input', 'repoRoot is required and must be a non-empty string');
        }
        if (typeof input.baselineRef !== 'string' || input.baselineRef.trim() === '') {
            throw new CensusFailure('census-invalid-input', 'baselineRef is required and must be a non-empty string');
        }
        const repoRoot = path.resolve(input.repoRoot);
        if (!isDirectory(repoRoot)) {
            throw new CensusFailure('census-repo-not-found', `repoRoot does not exist or is not a directory: ${repoRoot}`);
        }
        const normalizedInput = normalizeInput(input);
        const scopeDir = normalizeRepoRelative(repoRoot, normalizedInput.scopeDir, 'scopeDir');
        const materialized = await materializeBaseline(repoRoot, normalizedInput.baselineRef);
        cleanup = materialized.cleanup;
        const output = runCensusAnalysis(materialized.root, scopeDir, materialized.oid, normalizedInput);
        return { ok: true, output };
    }
    catch (error) {
        if (error instanceof CensusFailure)
            return { ok: false, rule: error.rule, message: error.message };
        return {
            ok: false,
            rule: 'census-internal-error',
            message: error instanceof Error ? (error.stack ?? error.message) : String(error),
        };
    }
    finally {
        if (cleanup) {
            try {
                await cleanup();
            }
            catch (error) {
                // Cleanup is best-effort by definition; never mask the census result.
                process.stderr.write(`[spec_guard_census] worktree cleanup failed: ${errorText(error)}\n`);
            }
        }
    }
}
/* -------------------------------------------------------------------------- */
/* Input normalization                                                        */
/* -------------------------------------------------------------------------- */
function normalizeInput(input) {
    return {
        ...input,
        repoRoot: path.resolve(input.repoRoot),
        baselineRef: input.baselineRef.trim(),
        scopeDir: input.scopeDir.trim(),
        ownerScope: typeof input.ownerScope === 'string' ? input.ownerScope.trim() : undefined,
        deletedSymbols: uniqueSorted((input.deletedSymbols ?? []).map((symbol) => symbol.trim()).filter(Boolean)),
        deletedPaths: uniqueSorted((input.deletedPaths ?? []).map((entry) => entry.trim()).filter(Boolean)),
        renamedSymbols: (input.renamedSymbols ?? [])
            .map((pair) => ({ from: pair.from?.trim() ?? '', to: pair.to?.trim() ?? '' }))
            .filter((pair) => pair.from !== ''),
        renamedPaths: (input.renamedPaths ?? []).map((pair) => ({ from: pair.from?.trim() ?? '', to: pair.to?.trim() ?? '' })).filter((pair) => pair.from !== ''),
    };
}
async function materializeBaseline(repoRoot, baselineRef) {
    // Resolve relative revs (af92a878^) to an immutable commit OID FIRST.
    const revParse = execGit(repoRoot, ['rev-parse', '--verify', `${baselineRef.trim()}^{commit}`]);
    const oid = revParse.status === 0 ? revParse.stdout.trim() : '';
    if (!/^[0-9a-f]{40}$/i.test(oid)) {
        throw new CensusFailure('census-ref-unreachable', `git rev-parse ${baselineRef} did not yield a commit OID: ${revParse.stderr.trim() || 'unknown revision'}`);
    }
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
    const root = path.join(parent, 'tree');
    let worktreeRegistered = false;
    const cleanup = async () => {
        const warnings = [];
        if (worktreeRegistered) {
            const removed = execGit(repoRoot, ['worktree', 'remove', '--force', root]);
            if (removed.status !== 0)
                warnings.push(`worktree remove: ${removed.stderr.trim() || removed.status}`);
        }
        // Always prune: a partially-registered worktree must never be left behind.
        const pruned = execGit(repoRoot, ['worktree', 'prune']);
        if (worktreeRegistered && pruned.status !== 0)
            warnings.push(`worktree prune: ${pruned.stderr.trim() || pruned.status}`);
        try {
            fs.rmSync(parent, { recursive: true, force: true });
        }
        catch (error) {
            warnings.push(`temp dir remove: ${errorText(error)}`);
        }
        if (warnings.length > 0)
            process.stderr.write(`[spec_guard_census] worktree cleanup warnings: ${warnings.join(' | ')}\n`);
    };
    // Preferred path: a real detached worktree at the pinned OID.
    const added = execGit(repoRoot, ['worktree', 'add', '--detach', root, oid]);
    if (added.status === 0) {
        worktreeRegistered = true;
        return { oid, root, cleanup };
    }
    // Fallback for read-only/sandboxed checkouts whose .git dir cannot be written.
    // `git archive` reads the SAME pinned commit and materializes tracked files
    // only — still ref-pinned, never the live working tree.
    try {
        await archiveInto(repoRoot, oid, root);
    }
    catch (archiveError) {
        await cleanup();
        throw new CensusFailure('census-materialization-failed', `git worktree add failed (${added.stderr.trim() || `exit ${added.status}`}); git archive fallback failed: ${errorText(archiveError)}`);
    }
    return { oid, root, cleanup };
}
function execGit(cwd, args) {
    const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (result.error)
        return { status: 1, stdout: '', stderr: result.error.message };
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
function archiveInto(repoRoot, oid, destination) {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(destination, { recursive: true });
        const gitProcess = spawn('git', ['-C', repoRoot, 'archive', '--format=tar', oid], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const tarProcess = spawn('tar', ['-x', '-C', destination], { stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '';
        gitProcess.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        tarProcess.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        const gitExit = new Promise((res, rej) => {
            gitProcess.on('error', rej);
            gitProcess.on('close', (code) => res(code ?? 1));
        });
        const tarExit = new Promise((res, rej) => {
            tarProcess.on('error', rej);
            tarProcess.on('close', (code) => res(code ?? 1));
        });
        const stream = pipeline(gitProcess.stdout, tarProcess.stdin).catch(() => {
            // Exit codes below carry the actionable error; the stream error is expected
            // when git archive fails before writing.
        });
        void stream.then(async () => {
            try {
                const [gitCode, tarCode] = await Promise.all([gitExit, tarExit]);
                if (gitCode !== 0 || tarCode !== 0) {
                    reject(new Error(`git archive/tar exited ${gitCode}/${tarCode}: ${stderr.trim().slice(0, 1000)}`));
                    return;
                }
                resolve();
            }
            catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    });
}
function runCensusAnalysis(worktreeRoot, scopeDir, oid, input) {
    const scopeDirAbs = path.join(worktreeRoot, scopeDir);
    if (!isDirectory(scopeDirAbs)) {
        throw new CensusFailure('census-scope-unresolvable', `scopeDir does not resolve at ${oid}: ${scopeDir}`);
    }
    const deletedPaths = resolveDeclaredPaths(worktreeRoot, input.deletedPaths, 'deletedPaths');
    const renamedFromPaths = resolveDeclaredPaths(worktreeRoot, (input.renamedPaths ?? []).map((pair) => pair.from), 'renamedPaths.from');
    const context = loadProgramContext(worktreeRoot, scopeDir);
    // Deleted/renamed-from paths must be part of the program even when the local
    // tsconfig excludes them (contract: host extracts path exports via TS API).
    const rootNames = new Set(context.rootNames);
    for (const relPath of [...deletedPaths, ...renamedFromPaths]) {
        const absolute = path.join(worktreeRoot, relPath);
        if (/\.(?:ts|tsx)$/.test(absolute))
            rootNames.add(absolute);
    }
    const packages = collectWorkspacePackages(worktreeRoot);
    const resolver = createInjectedResolver(worktreeRoot, packages);
    const host = createInjectedHost(context.options, resolver);
    const program = ts.createProgram({ rootNames: [...rootNames].sort(codePointCompare), options: context.options, host });
    const checker = program.getTypeChecker();
    const targets = collectTargets(program, checker, worktreeRoot, scopeDir, input, deletedPaths, renamedFromPaths);
    const emitDecoratorMetadata = context.options.emitDecoratorMetadata === true;
    const rawEdges = collectConsumerEdges(program, checker, worktreeRoot, scopeDir, targets, emitDecoratorMetadata);
    const ownerScopes = resolveOwnerScopes(input, targets, scopeDir);
    const ownerKeys = new Set(ownerScopes.map(normalizeScopeKey));
    const effectiveOwnerScope = input.ownerScope ?? ownerScopes.join(',');
    const perScopeGroups = new Map();
    const advisory = new Map();
    for (const edge of rawEdges) {
        if (isTestOrGeneratedFile(edge.source)) {
            recordEdge(advisory, edge);
            continue;
        }
        const scope = scopeForFile(edge.source, scopeDir);
        if (!scope)
            continue;
        if (ownerKeys.has(normalizeScopeKey(scope)))
            continue; // owner scope excluded from fan-out
        let group = perScopeGroups.get(scope);
        if (!group) {
            group = new Map();
            perScopeGroups.set(scope, group);
        }
        recordEdge(group, edge);
    }
    let counter = 0;
    const nextId = () => `E-${String(++counter).padStart(3, '0')}`;
    const perScope = [...perScopeGroups.keys()].sort(codePointCompare).map((scope) => {
        const group = perScopeGroups.get(scope);
        const sorted = [...group.values()].sort(compareRawEdges);
        const edges = sorted.map((edge) => ({
            id: nextId(),
            kind: edge.kind,
            source: edge.source,
            target: edge.target,
            displayLine: edge.displayLine,
        }));
        const files = uniqueSorted(edges.map((edge) => edge.source));
        return { scope, files, edges, hardCount: edges.filter((edge) => HARD_EDGE_KINDS.has(edge.kind)).length };
    });
    const advisoryEdges = [...advisory.values()].sort(compareRawEdges).map((edge) => ({
        id: nextId(),
        kind: edge.kind,
        source: edge.source,
        target: edge.target,
        displayLine: edge.displayLine,
    }));
    const digestPayload = {
        schemaVersion: SCHEMA_VERSION,
        analyzer: { name: 'typescript', version: ts.version },
        resolutionStrategy: RESOLUTION_STRATEGY,
        resolvedOid: oid,
        scopeDir,
        ownerScope: effectiveOwnerScope,
        sortedDeletedSymbols: uniqueSorted(input.deletedSymbols),
        sortedDeletedPaths: uniqueSorted(input.deletedPaths),
        sortedRenamedPairs: sortRenamedPairs([...(input.renamedSymbols ?? []), ...(input.renamedPaths ?? [])]),
        perScope: perScope.map((scope) => ({
            scope: scope.scope,
            files: scope.files,
            // id/displayLine are display-only and NEVER digested (line shifts are not drift).
            edges: scope.edges
                .map((edge) => ({ kind: edge.kind, source: edge.source, target: edge.target }))
                .sort(compareDigestEdges),
        })),
    };
    // Follow-up #4 (v2): supplementary analyses (not digested; core direct-edge digest unchanged).
    const weightedFanout = perScope.reduce((sum, scope) => sum + scope.edges.reduce((s, edge) => s + (EDGE_WEIGHTS[edge.kind] ?? 1), 0), 0);
    const consumerFiles = uniqueSorted(perScope.flatMap((scope) => scope.files));
    const transitive = (input.transitiveDepth ?? 0) > 0
        ? collectTransitiveEdges(program, worktreeRoot, scopeDir, consumerFiles, input.transitiveDepth ?? 1)
        : [];
    const submodules = input.includeSubmodules === true ? detectSubmodules(input.repoRoot, oid) : [];
    return {
        resolvedOid: oid,
        analyzer: { name: 'typescript', version: ts.version },
        resolutionStrategy: RESOLUTION_STRATEGY,
        perScope,
        advisory: advisoryEdges,
        outputDigest: sha256Hex(canonicalJson(digestPayload)),
        weightedFanout,
        transitive,
        submodules,
    };
}
/** Follow-up #4: bounded transitive pass — files that import a direct consumer file. */
function collectTransitiveEdges(program, worktreeRoot, scopeDir, consumerFiles, depth) {
    const seen = new Set(consumerFiles);
    let frontier = new Set(consumerFiles);
    const edges = [];
    let counter = 0;
    const toRel = (absolute) => path.relative(worktreeRoot, absolute).replace(/\\/g, '/');
    for (let level = 0; level < depth; level += 1) {
        const nextFrontier = new Set();
        for (const sourceFile of program.getSourceFiles()) {
            const sourceRel = toRel(sourceFile.fileName);
            if (!sourceRel.startsWith(scopeDir) || isTestOrGeneratedFile(sourceRel))
                continue;
            if (seen.has(sourceRel))
                continue;
            let importsConsumer = false;
            const visit = (node) => {
                if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
                    const resolved = resolveModuleFile(worktreeRoot, scopeDir, sourceFile.fileName, node.moduleSpecifier.text);
                    if (resolved !== undefined && frontier.has(toRel(resolved)))
                        importsConsumer = true;
                }
                ts.forEachChild(node, visit);
            };
            visit(sourceFile);
            if (importsConsumer) {
                counter += 1;
                edges.push({ id: `TR-${String(counter).padStart(3, '0')}`, kind: 'runtime-import', source: sourceRel, target: 'transitive-consumer' });
                nextFrontier.add(sourceRel);
                seen.add(sourceRel);
            }
        }
        if (nextFrontier.size === 0)
            break;
        frontier = nextFrontier;
    }
    return edges;
}
/** Resolve a relative import specifier to a file under the worktree (best-effort). */
function resolveModuleFile(worktreeRoot, scopeDir, fromFile, specifier) {
    if (!specifier.startsWith('.'))
        return undefined;
    const base = path.resolve(path.dirname(fromFile), specifier);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
    for (const candidate of candidates) {
        if (candidate.startsWith(path.join(worktreeRoot, scopeDir)) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return undefined;
}
/** Follow-up #4: detect gitlink (submodule) paths at the ref via git ls-tree. */
function detectSubmodules(repoRoot, oid) {
    const result = spawnSync('git', ['-C', repoRoot, 'ls-tree', '-r', oid], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0 || typeof result.stdout !== 'string')
        return [];
    const paths = [];
    for (const line of result.stdout.split('\n')) {
        // format: <mode> <type> <sha>\t<path>
        if (!line.startsWith('160000 '))
            continue;
        const tab = line.indexOf('\t');
        if (tab >= 0)
            paths.push(line.slice(tab + 1).trim());
    }
    return paths.sort(codePointCompare);
}
function resolveDeclaredPaths(worktreeRoot, declared, label) {
    const resolved = [];
    for (const entry of declared) {
        const normalized = entry.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
        if (normalized === '' || normalized.split('/').includes('..') || path.isAbsolute(normalized)) {
            throw new CensusFailure('census-path-unresolvable', `${label} entry does not resolve under the repo root: ${entry}`);
        }
        const absolute = path.join(worktreeRoot, normalized);
        if (!fs.existsSync(absolute)) {
            throw new CensusFailure('census-path-unresolvable', `${label} entry does not exist at the pinned baseline: ${normalized}`);
        }
        resolved.push(normalized);
    }
    return uniqueSorted(resolved);
}
function loadProgramContext(worktreeRoot, scopeDir) {
    const scopeAbs = path.join(worktreeRoot, scopeDir);
    const configPath = path.join(scopeAbs, 'tsconfig.json');
    let rootNames = [];
    let options = {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        noEmit: true,
    };
    if (isFile(configPath)) {
        const read = ts.readConfigFile(configPath, ts.sys.readFile);
        if (!read.error) {
            const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath), undefined, configPath);
            if (parsed.fileNames.length > 0) {
                rootNames = parsed.fileNames.map((file) => path.resolve(file));
                options = { ...parsed.options, noEmit: true };
            }
        }
    }
    if (rootNames.length === 0)
        rootNames = discoverSourceFiles(scopeAbs);
    options.noEmit = true;
    if (options.moduleResolution === undefined)
        options.moduleResolution = ts.ModuleResolutionKind.Bundler;
    // Contract round-6 F8: tests are excluded from the domain tsconfig, so append
    // them to the root list explicitly to report advisory edges.
    const roots = new Set(rootNames);
    for (const file of discoverAdvisoryFiles(scopeAbs))
        roots.add(file);
    return { rootNames: [...roots].sort(codePointCompare), options };
}
function discoverSourceFiles(root) {
    const files = [];
    const walk = (directory) => {
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git')
                continue;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory())
                walk(absolute);
            else if (/\.(?:ts|tsx)$/.test(entry.name))
                files.push(absolute);
        }
    };
    walk(root);
    return files.sort(codePointCompare);
}
function discoverAdvisoryFiles(root) {
    const files = [];
    const walk = (directory) => {
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git')
                continue;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory())
                walk(absolute);
            else if (/\.(?:ts|tsx)$/.test(entry.name)) {
                const relative = toPosixPath(path.relative(root, absolute));
                if (isTestOrGeneratedFile(relative))
                    files.push(absolute);
            }
        }
    };
    walk(root);
    return files.sort(codePointCompare);
}
/** pnpm-workspace.yaml globs + package.json exports do the @foundation/* mapping. */
function collectWorkspacePackages(worktreeRoot) {
    const packages = new Map();
    let globs = [];
    const workspaceFile = path.join(worktreeRoot, 'pnpm-workspace.yaml');
    if (isFile(workspaceFile)) {
        try {
            globs = parseWorkspaceGlobs(fs.readFileSync(workspaceFile, 'utf8'));
        }
        catch {
            globs = [];
        }
    }
    if (globs.length === 0)
        globs = ['packages/platform/*'];
    const directories = new Set();
    for (const glob of globs) {
        for (const directory of expandWorkspaceGlob(worktreeRoot, glob))
            directories.add(directory);
    }
    for (const directory of [...directories].sort(codePointCompare)) {
        const manifestPath = path.join(worktreeRoot, directory, 'package.json');
        if (!isFile(manifestPath))
            continue;
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (typeof manifest.name !== 'string' || manifest.name === '' || packages.has(manifest.name))
                continue;
            packages.set(manifest.name, {
                name: manifest.name,
                dir: directory,
                exportsField: manifest.exports,
                types: typeof manifest.types === 'string' ? manifest.types : undefined,
                main: typeof manifest.main === 'string' ? manifest.main : undefined,
            });
        }
        catch {
            // Malformed manifest: resolution simply falls back for that package.
        }
    }
    return packages;
}
function parseWorkspaceGlobs(yamlText) {
    const globs = [];
    let inPackages = false;
    for (const line of yamlText.split(/\r?\n/)) {
        if (/^packages\s*:\s*$/.test(line)) {
            inPackages = true;
            continue;
        }
        if (!inPackages)
            continue;
        if (line.trim() === '' || /^\s*#/.test(line))
            continue;
        const entry = /^\s*-\s*(?:"([^"]+)"|'([^']+)'|([^#'"]+?))\s*(?:#.*)?$/.exec(line);
        if (entry) {
            const value = (entry[1] ?? entry[2] ?? entry[3] ?? '').trim();
            if (value !== '')
                globs.push(value);
            continue;
        }
        if (/^\S/.test(line))
            inPackages = false;
    }
    return globs;
}
function expandWorkspaceGlob(worktreeRoot, glob) {
    const segments = glob.replace(/\\/g, '/').split('/').filter((segment) => segment !== '' && segment !== '.');
    if (segments.some((segment) => segment.includes('**')))
        return []; // v1: no recursive workspace globs
    const out = [];
    const walk = (index, relative) => {
        if (index >= segments.length) {
            if (relative !== '')
                out.push(relative);
            return;
        }
        const segment = segments[index];
        if (segment === '*') {
            let entries;
            try {
                entries = fs.readdirSync(path.join(worktreeRoot, relative), { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const entry of entries.sort((left, right) => codePointCompare(left.name, right.name))) {
                if (!entry.isDirectory())
                    continue;
                walk(index + 1, relative === '' ? entry.name : `${relative}/${entry.name}`);
            }
            return;
        }
        walk(index + 1, relative === '' ? segment : `${relative}/${segment}`);
    };
    walk(0, '');
    return out;
}
function pickExportTarget(value) {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value)) {
        for (const entry of value) {
            const target = pickExportTarget(entry);
            if (target)
                return target;
        }
        return undefined;
    }
    if (value !== null && typeof value === 'object') {
        const record = value;
        for (const key of ['types', 'import', 'default', 'require', 'node']) {
            if (key in record) {
                const target = pickExportTarget(record[key]);
                if (target)
                    return target;
            }
        }
    }
    return undefined;
}
function lookupWorkspaceExport(pkg, subpath) {
    const field = pkg.exportsField;
    if (field === undefined || field === null)
        return undefined;
    if (typeof field === 'string')
        return subpath === '.' ? field : undefined;
    if (Array.isArray(field))
        return subpath === '.' ? pickExportTarget(field) : undefined;
    if (typeof field !== 'object')
        return undefined;
    const map = field;
    if (subpath in map)
        return pickExportTarget(map[subpath]);
    for (const [key, value] of Object.entries(map)) {
        if (!key.endsWith('/*'))
            continue;
        const prefix = key.slice(0, -1);
        if (!subpath.startsWith(prefix))
            continue;
        const patternTarget = pickExportTarget(value);
        if (typeof patternTarget === 'string' && patternTarget.includes('*')) {
            return patternTarget.replace(/\*/g, subpath.slice(prefix.length));
        }
    }
    if (subpath === '.')
        return pickExportTarget(field);
    return undefined;
}
function createInjectedResolver(worktreeRoot, packages) {
    return (specifier, containingFile) => {
        if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
            const base = path.isAbsolute(specifier) ? specifier : path.resolve(path.dirname(containingFile), specifier);
            return resolveTsModulePath(base);
        }
        let matchName = '';
        for (const name of packages.keys()) {
            if ((specifier === name || specifier.startsWith(`${name}/`)) && name.length > matchName.length)
                matchName = name;
        }
        if (matchName === '')
            return null;
        const pkg = packages.get(matchName);
        const subpath = specifier === matchName ? '.' : `.${specifier.slice(matchName.length)}`;
        const packageRoot = path.resolve(worktreeRoot, pkg.dir);
        const exportTarget = lookupWorkspaceExport(pkg, subpath);
        if (exportTarget) {
            const resolved = resolveTsModulePath(path.resolve(packageRoot, exportTarget));
            if (resolved && isInside(worktreeRoot, resolved))
                return resolved;
        }
        if (subpath === '.') {
            for (const candidate of [pkg.types, pkg.main, './src/index.ts', './index.ts']) {
                if (!candidate)
                    continue;
                const resolved = resolveTsModulePath(path.resolve(packageRoot, candidate));
                if (resolved && isInside(worktreeRoot, resolved))
                    return resolved;
            }
            return null;
        }
        const direct = resolveTsModulePath(path.resolve(packageRoot, subpath.slice(2)));
        return direct && isInside(worktreeRoot, direct) ? direct : null;
    };
}
function resolveTsModulePath(base) {
    const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.d.ts`,
        path.join(base, 'index.ts'),
        path.join(base, 'index.tsx'),
        path.join(base, 'index.d.ts'),
    ];
    for (const candidate of candidates) {
        if (!/\.(?:ts|tsx|d\.ts)$/.test(candidate))
            continue;
        if (isFile(candidate))
            return candidate;
    }
    if (/\.[cm]?js$/.test(base))
        return resolveTsModulePath(base.replace(/\.[cm]?js$/, ''));
    return null;
}
function createInjectedHost(options, resolver) {
    const host = ts.createCompilerHost(options, true);
    host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((specifier) => {
        const resolved = resolver(specifier, containingFile);
        if (!resolved)
            return undefined;
        return { resolvedFileName: resolved, extension: extensionFor(resolved), isExternalLibraryImport: false };
    });
    return host;
}
/* -------------------------------------------------------------------------- */
/* Target symbols                                                             */
/* -------------------------------------------------------------------------- */
function collectTargets(program, checker, worktreeRoot, scopeDir, input, deletedPaths, renamedFromPaths) {
    const targets = new Map();
    const add = (name, originFile) => {
        if (name === '' || name === 'default')
            return;
        const existing = targets.get(name);
        if (!existing) {
            targets.set(name, { name, originFile });
            return;
        }
        if (!existing.originFile && originFile)
            existing.originFile = originFile;
    };
    for (const name of input.deletedSymbols)
        add(name);
    for (const pair of input.renamedSymbols ?? [])
        add(pair.from);
    for (const relPath of deletedPaths) {
        for (const name of extractPathExports(program, checker, path.join(worktreeRoot, relPath)))
            add(name, relPath);
    }
    for (const relPath of renamedFromPaths) {
        for (const name of extractPathExports(program, checker, path.join(worktreeRoot, relPath)))
            add(name, relPath);
    }
    const unresolved = [...targets.values()].filter((target) => !target.originFile).map((target) => target.name);
    if (unresolved.length > 0) {
        const origins = resolveDeclarationOrigins(program, checker, worktreeRoot, scopeDir, unresolved);
        for (const [name, originFile] of origins) {
            const target = targets.get(name);
            if (target && !target.originFile)
                target.originFile = originFile;
        }
    }
    return targets;
}
function extractPathExports(program, checker, absolutePath) {
    const sourceFile = program.getSourceFile(absolutePath) ??
        program.getSourceFiles().find((candidate) => path.resolve(candidate.fileName) === path.resolve(absolutePath));
    if (!sourceFile)
        return [];
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol)
        return [];
    try {
        return checker
            .getExportsOfModule(moduleSymbol)
            .map((symbol) => symbol.getName())
            .filter((name) => name !== 'default');
    }
    catch {
        return [];
    }
}
/** Resolve a symbol name to the worktree file that actually declares it (alias-aware). */
function resolveDeclarationOrigins(program, checker, worktreeRoot, scopeDir, names) {
    const wanted = new Set(names);
    const candidates = new Map();
    for (const sourceFile of program.getSourceFiles()) {
        if (!isInside(worktreeRoot, sourceFile.fileName))
            continue;
        const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
        if (!moduleSymbol)
            continue;
        let exportsList;
        try {
            exportsList = checker.getExportsOfModule(moduleSymbol);
        }
        catch {
            continue;
        }
        for (const exported of exportsList) {
            const name = exported.getName();
            if (!wanted.has(name))
                continue;
            let resolved = exported;
            if ((resolved.flags & ts.SymbolFlags.Alias) !== 0) {
                try {
                    resolved = checker.getAliasedSymbol(resolved);
                }
                catch {
                    // Keep the alias symbol; its declarations still point at the barrel.
                }
            }
            for (const declaration of resolved.declarations ?? []) {
                const declarationFile = declaration.getSourceFile().fileName;
                if (!isInside(worktreeRoot, declarationFile))
                    continue;
                const relative = relativePosix(worktreeRoot, declarationFile);
                const bucket = candidates.get(name) ?? [];
                if (!bucket.includes(relative))
                    bucket.push(relative);
                candidates.set(name, bucket);
            }
        }
    }
    const origins = new Map();
    for (const [name, files] of candidates) {
        const sorted = files.sort(codePointCompare);
        const insideScope = sorted.find((file) => file === scopeDir || file.startsWith(`${scopeDir}/`));
        origins.set(name, insideScope ?? sorted[0]);
    }
    return origins;
}
/* -------------------------------------------------------------------------- */
/* Consumer edges + DI-aware usage classification (round-6 F2)                 */
/* -------------------------------------------------------------------------- */
function collectConsumerEdges(program, checker, worktreeRoot, scopeDir, targets, emitDecoratorMetadata) {
    const scopeDirAbs = path.join(worktreeRoot, scopeDir);
    const edges = [];
    for (const sourceFile of program.getSourceFiles()) {
        if (!isInside(worktreeRoot, sourceFile.fileName))
            continue;
        if (!isInside(scopeDirAbs, sourceFile.fileName))
            continue;
        const relative = relativePosix(worktreeRoot, sourceFile.fileName);
        // One edge per (file, target); a stronger kind wins when both a type and a
        // value import of the same symbol exist in one file.
        const fileEdges = new Map();
        const record = (target, kind, displayLine) => {
            const previous = fileEdges.get(target);
            if (previous && edgePriority(previous.kind) >= edgePriority(kind)) {
                previous.displayLine = Math.min(previous.displayLine, displayLine);
                return;
            }
            fileEdges.set(target, { source: relative, target, kind, displayLine });
        };
        for (const statement of sourceFile.statements) {
            if (ts.isImportDeclaration(statement)) {
                const clause = statement.importClause;
                if (!clause || !clause.namedBindings)
                    continue;
                // v1: namespace imports (`import * as ns`) are deferred (documented).
                if (!ts.isNamedImports(clause.namedBindings))
                    continue;
                for (const element of clause.namedBindings.elements) {
                    const importedName = (element.propertyName ?? element.name).text;
                    if (!targets.has(importedName))
                        continue;
                    const explicitTypeOnly = clause.isTypeOnly || element.isTypeOnly;
                    const usage = explicitTypeOnly
                        ? 'type-import'
                        : classifyImportUsage(sourceFile, checker, element.name, emitDecoratorMetadata);
                    const kind = kindForTarget(targets.get(importedName), usage, explicitTypeOnly);
                    record(importedName, kind, statementLine(sourceFile, statement));
                }
                continue;
            }
            if (ts.isExportDeclaration(statement) &&
                statement.moduleSpecifier &&
                statement.exportClause &&
                ts.isNamedExports(statement.exportClause)) {
                // Named re-export (`export { X } from './schools'`) is a consumer edge:
                // removing X breaks this barrel/file at compile time (value re-export
                // unless explicitly `export type`).
                for (const element of statement.exportClause.elements) {
                    const importedName = (element.propertyName ?? element.name).text;
                    if (!targets.has(importedName))
                        continue;
                    const explicitTypeOnly = statement.isTypeOnly || element.isTypeOnly;
                    const kind = kindForTarget(targets.get(importedName), explicitTypeOnly ? 'type-import' : 'runtime-import', explicitTypeOnly);
                    record(importedName, kind, statementLine(sourceFile, statement));
                }
            }
        }
        edges.push(...fileEdges.values());
    }
    return edges;
}
function classifyImportUsage(sourceFile, checker, bindingName, emitDecoratorMetadata) {
    const bindingSymbol = checker.getSymbolAtLocation(bindingName);
    if (!bindingSymbol)
        return 'type-import';
    let sawValue = false;
    let sawDi = false;
    const visit = (node) => {
        if (ts.isIdentifier(node) && node.text === bindingName.text) {
            const symbol = checker.getSymbolAtLocation(node);
            if (symbol === bindingSymbol) {
                const context = declarationContextOf(node);
                if (context === 'export-value') {
                    sawValue = true;
                }
                else if (context === null) {
                    const position = classifyReferencePosition(node, emitDecoratorMetadata);
                    if (position === 'value')
                        sawValue = true;
                    else if (position === 'di')
                        sawDi = true;
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    // No reference at all: a value import is elided from emit, so removing the
    // export is a compile-time break only → type-import.
    return sawValue || sawDi ? 'runtime-import' : 'type-import';
}
function declarationContextOf(node) {
    let current = node.parent;
    while (current && !ts.isSourceFile(current)) {
        if (ts.isImportDeclaration(current) || ts.isImportEqualsDeclaration(current))
            return 'import';
        if (ts.isExportDeclaration(current)) {
            if (current.isTypeOnly)
                return 'export-type';
            let specifier = node.parent;
            while (specifier && !ts.isExportSpecifier(specifier) && specifier !== current)
                specifier = specifier.parent;
            if (specifier && ts.isExportSpecifier(specifier) && specifier.isTypeOnly)
                return 'export-type';
            return 'export-value';
        }
        current = current.parent;
    }
    return null;
}
/**
 * Value vs. type vs. DI-metadata position. `di` means a type reference that
 * Nest/emitDecoratorMetadata turns into a runtime token: a parameter or property
 * type inside a decorated class.
 */
function classifyReferencePosition(node, emitDecoratorMetadata) {
    let current = node.parent;
    let inTypePosition = false;
    let extendsHead = false;
    while (current && !ts.isSourceFile(current)) {
        if (ts.isHeritageClause(current) && current.token === ts.SyntaxKind.ExtendsKeyword) {
            extendsHead = isHeritageHeadReference(node, current);
            break;
        }
        if (ts.isTypeNode(current))
            inTypePosition = true;
        current = current.parent;
    }
    // Outside a type node: real value use (call, new, decorator argument, ...).
    if (!inTypePosition)
        return 'value';
    // `class X extends Y` references Y at runtime; `implements` does not.
    if (extendsHead)
        return 'value';
    if (emitDecoratorMetadata && isDecoratedClassMemberType(node))
        return 'di';
    return 'type';
}
function isHeritageHeadReference(node, clause) {
    let child = node;
    while (child.parent && child.parent !== clause)
        child = child.parent;
    if (!ts.isExpressionWithTypeArguments(child))
        return false;
    let probe = node;
    while (probe !== child) {
        // A type argument (`extends Base<T>`) is erased; only the head is runtime.
        if (ts.isTypeNode(probe) && !ts.isExpressionWithTypeArguments(probe))
            return false;
        const parent = probe.parent;
        if (!parent)
            return false;
        probe = parent;
    }
    return true;
}
function isDecoratedClassMemberType(node) {
    let member = node;
    while (member && !ts.isParameter(member) && !ts.isPropertyDeclaration(member)) {
        if (ts.isClassDeclaration(member) || ts.isClassExpression(member) || ts.isSourceFile(member))
            return false;
        member = member.parent;
    }
    if (!member)
        return false;
    const memberType = member.type;
    if (!memberType)
        return false;
    // Reject identifiers that merely appear in an initializer/type assertion.
    if (node.pos < memberType.pos || node.end > memberType.end)
        return false;
    let enclosing = member.parent;
    while (enclosing && !ts.isClassDeclaration(enclosing) && !ts.isClassExpression(enclosing))
        enclosing = enclosing.parent;
    if (!enclosing)
        return false;
    if (!ts.canHaveDecorators(enclosing))
        return false;
    const decorators = ts.getDecorators(enclosing);
    return decorators !== undefined && decorators.length > 0;
}
function kindForTarget(target, usage, explicitTypeOnly) {
    // An explicit `import type` stays compile-only; otherwise the declaring-module
    // path origin decides the barrel kind (barrel > runtime, round-6 F7).
    if (explicitTypeOnly)
        return 'type-import';
    const barrel = barrelKindForOrigin(target?.originFile);
    return barrel ?? usage;
}
function barrelKindForOrigin(originFile) {
    if (!originFile)
        return null;
    const normalized = `/${originFile.replace(/\\/g, '/')}`;
    if (normalized.includes('/db/schemas/'))
        return 'schema-barrel';
    if (normalized.includes('/contracts/'))
        return 'contract-barrel';
    return null;
}
/* -------------------------------------------------------------------------- */
/* Scope partition + owner-scope exclusion                                    */
/* -------------------------------------------------------------------------- */
/** src/backend/<seg> → <seg>; src/db → S-DB; src/contracts → S-CONTRACTS; else S-PKG-<SEG>. */
function scopeForFile(repoRelativeFile, scopeDir) {
    const prefix = scopeDir === '' ? '' : `${scopeDir}/`;
    if (prefix !== '' && !repoRelativeFile.startsWith(prefix))
        return null;
    const relative = prefix === '' ? repoRelativeFile : repoRelativeFile.slice(prefix.length);
    const segments = relative.split('/').filter(Boolean);
    if (segments.length === 0)
        return null;
    if (segments[0] === 'src') {
        if (segments[1] === 'backend') {
            return segments.length >= 4 ? segments[2] : 'S-PKG-BACKEND';
        }
        if (segments[1] === 'db')
            return 'S-DB';
        if (segments[1] === 'contracts')
            return 'S-CONTRACTS';
        // src/<seg>/... → S-PKG-<SEG>; a file directly under src → S-PKG-ROOT.
        return segments.length >= 3 ? `S-PKG-${segments[1].toUpperCase()}` : 'S-PKG-ROOT';
    }
    // Non-src package content (seeds, scripts, ...) still needs a deterministic scope.
    return segments.length >= 2 ? `S-PKG-${segments[0].toUpperCase()}` : 'S-PKG-ROOT';
}
function resolveOwnerScopes(input, targets, scopeDir) {
    if (typeof input.ownerScope === 'string' && input.ownerScope !== '')
        return [input.ownerScope];
    const scopes = new Set();
    for (const target of targets.values()) {
        if (!target.originFile)
            continue;
        const scope = scopeForFile(target.originFile, scopeDir);
        if (scope)
            scopes.add(scope);
    }
    return [...scopes].sort(codePointCompare);
}
function normalizeScopeKey(value) {
    let normalized = value.trim().toLowerCase();
    if (normalized.startsWith('s-pkg-'))
        normalized = normalized.slice('s-pkg-'.length);
    return normalized;
}
/* -------------------------------------------------------------------------- */
/* Assembly + canonical digest (contract §14.3)                              */
/* -------------------------------------------------------------------------- */
function recordEdge(bucket, edge) {
    const key = `${edge.source}\u0000${edge.target}`;
    const previous = bucket.get(key);
    if (!previous) {
        bucket.set(key, { ...edge });
        return;
    }
    if (edgePriority(edge.kind) > edgePriority(previous.kind)) {
        bucket.set(key, { ...edge, displayLine: Math.min(previous.displayLine, edge.displayLine) });
        return;
    }
    previous.displayLine = Math.min(previous.displayLine, edge.displayLine);
}
/** Higher wins: barrel > runtime > type. */
function edgePriority(kind) {
    if (kind === 'schema-barrel' || kind === 'contract-barrel')
        return 3;
    if (kind === 'runtime-import')
        return 2;
    return 1;
}
function compareRawEdges(left, right) {
    return (codePointCompare(left.source, right.source) ||
        codePointCompare(left.target, right.target) ||
        codePointCompare(left.kind, right.kind) ||
        left.displayLine - right.displayLine);
}
function compareDigestEdges(left, right) {
    return (codePointCompare(left.source, right.source) ||
        codePointCompare(left.target, right.target) ||
        codePointCompare(left.kind, right.kind));
}
function sortRenamedPairs(pairs) {
    return pairs
        .map((pair) => ({ from: pair.from, to: pair.to }))
        .sort((left, right) => codePointCompare(left.from, right.from) || codePointCompare(left.to, right.to));
}
function sha256Hex(value) {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
/**
 * Canonical JSON: lexicographically (code-point) sorted keys, no insignificant
 * whitespace, JSON.stringify string escaping. Arrays keep caller-sorted order.
 */
function canonicalJson(value) {
    if (value === null || value === undefined)
        return 'null';
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value))
        return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
    const record = value;
    const entries = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort(codePointCompare)
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
}
/* -------------------------------------------------------------------------- */
/* Small utilities                                                            */
/* -------------------------------------------------------------------------- */
function statementLine(sourceFile, statement) {
    return sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
}
function extensionFor(file) {
    if (file.endsWith('.d.ts'))
        return '.d.ts';
    if (file.endsWith('.tsx'))
        return '.tsx';
    return '.ts';
}
function isTestOrGeneratedFile(repoRelativeFile) {
    const normalized = repoRelativeFile.replace(/\\/g, '/');
    return (/\.(?:test|spec)\.(?:ts|tsx)$/.test(normalized) ||
        /(?:^|\/)__tests__\//.test(normalized) ||
        /\.generated\.(?:ts|tsx)$/.test(normalized) ||
        /(?:^|\/)generated\//.test(normalized));
}
function normalizeRepoRelative(repoRoot, value, label) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed === '')
        throw new CensusFailure('census-invalid-input', `${label} is required and must be non-empty`);
    const absolute = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(repoRoot, trimmed);
    const relative = path.relative(repoRoot, absolute);
    if (relative === '') {
        throw new CensusFailure('census-invalid-input', `${label} must be a package/project directory inside repoRoot (the per-scope partition is package-relative), got the repo root: ${value}`);
    }
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new CensusFailure('census-invalid-input', `${label} must be a path inside repoRoot: ${value}`);
    }
    return toPosixPath(relative);
}
function relativePosix(from, to) {
    return toPosixPath(path.relative(path.resolve(from), path.resolve(to)));
}
function toPosixPath(value) {
    return value.split(path.sep).join('/');
}
function isInside(root, candidate) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
function isFile(candidate) {
    try {
        return fs.statSync(candidate).isFile();
    }
    catch {
        return false;
    }
}
function isDirectory(candidate) {
    try {
        return fs.statSync(candidate).isDirectory();
    }
    catch {
        return false;
    }
}
function uniqueSorted(values) {
    return [...new Set(values)].sort(codePointCompare);
}
/** Unicode code-point order (not locale-dependent); matches §14.3 canonical sort. */
function codePointCompare(left, right) {
    const leftPoints = Array.from(left);
    const rightPoints = Array.from(right);
    const length = Math.min(leftPoints.length, rightPoints.length);
    for (let index = 0; index < length; index += 1) {
        const leftCode = leftPoints[index].codePointAt(0) ?? 0;
        const rightCode = rightPoints[index].codePointAt(0) ?? 0;
        if (leftCode !== rightCode)
            return leftCode < rightCode ? -1 : 1;
    }
    return leftPoints.length - rightPoints.length;
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
/* -------------------------------------------------------------------------- */
/* Follow-up #3 — census cache + per-repo lock                                 */
/* -------------------------------------------------------------------------- */
/** Result cache keyed by the determinism inputs (contract §14.5 perfCache). */
const censusResultCache = new Map();
/** Per-repo promise-chain lock serializing worktree materialization/cleanup. */
const repoLocks = new Map();
function censusCacheKey(input) {
    return JSON.stringify([
        input.repoRoot,
        input.baselineRef,
        input.scopeDir,
        input.ownerScope ?? '',
        [...input.deletedSymbols].sort(),
        [...input.deletedPaths].sort(),
        (input.renamedSymbols ?? []).map((r) => `${r.from}>${r.to}`).sort(),
        (input.renamedPaths ?? []).map((r) => `${r.from}>${r.to}`).sort(),
        ts.version,
        RESOLUTION_STRATEGY,
    ]);
}
/**
 * Cached + per-repo-locked census. Identical inputs reuse the result (repeat lint /
 * pre-flight is cheap); concurrent runs on the same repo+scope are serialized so
 * worktree create/cleanup cannot race or leave leftovers. Errors are not cached.
 */
/** Build a TS program + checker for a scope on a given root (live repo or worktree).
 * Reuses the injected workspace resolver so @foundation/* and barrels resolve. Exported
 * for follow-up #2 GRACE MODULE_MAP factual surface extraction. */
export function createScopeProgram(root, scopeDir) {
    const context = loadProgramContext(root, scopeDir);
    const packages = collectWorkspacePackages(root);
    const resolver = createInjectedResolver(root, packages);
    const host = createInjectedHost(context.options, resolver);
    const program = ts.createProgram({ rootNames: [...context.rootNames].sort(codePointCompare), options: context.options, host });
    return { program, checker: program.getTypeChecker() };
}
/** Resolve a baseline ref to an immutable commit OID (so a moved HEAD invalidates the cache). */
function resolveBaselineOid(repoRoot, ref) {
    const resolvedRoot = path.resolve(repoRoot);
    if (!isDirectory(resolvedRoot)) {
        return { ok: false, result: { ok: false, rule: 'census-repo-not-found', message: `repoRoot does not exist or is not a directory: ${resolvedRoot}` } };
    }
    const revParse = execGit(resolvedRoot, ['rev-parse', '--verify', `${ref.trim()}^{commit}`]);
    const oid = revParse.status === 0 ? revParse.stdout.trim() : '';
    if (!/^[0-9a-f]{40}$/i.test(oid)) {
        return { ok: false, result: { ok: false, rule: 'census-ref-unreachable', message: `git rev-parse ${ref} did not yield a commit OID: ${revParse.stderr.trim() || 'unknown revision'}` } };
    }
    return { ok: true, oid };
}
export async function runCensusCached(input) {
    // Resolve the ref to an immutable OID FIRST. Cache keying by the literal ref (e.g.
    // 'HEAD') would return stale results after the branch moves — found in the live
    // dry-run. Pin to the OID and key on it.
    const resolved = resolveBaselineOid(input.repoRoot, input.baselineRef);
    if (!resolved.ok)
        return resolved.result;
    const pinnedInput = { ...input, baselineRef: resolved.oid };
    const key = censusCacheKey(pinnedInput);
    const cached = censusResultCache.get(key);
    if (cached !== undefined)
        return cached;
    const lockKey = `${input.repoRoot}|${input.scopeDir}`;
    const previous = repoLocks.get(lockKey) ?? Promise.resolve();
    const run = previous.then(() => runCensus(pinnedInput)).then((result) => {
        if (result.ok)
            censusResultCache.set(key, result);
        return result;
    });
    // Keep the chain alive even if this run rejects; do not poison the lock.
    repoLocks.set(lockKey, run.then(() => undefined, () => undefined));
    return run;
}

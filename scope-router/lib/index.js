/**
 * dsh-scope-router, host half.
 *
 * Determines the working scope of an agent — which configured project root,
 * which domain package (`packages/domains/<name>`) and which layer
 * (backend/frontend) — from three signals: message text, filesystem
 * observations (`fs/observed`), and shell-tool activity (`tools/result` for
 * `bash`/`pwsh` command and workdir arguments). When the scope changes, the
 * matching project instruction files (core + domain + layer) are injected
 * into the next model step as a baseline instructions message; the new bundle
 * textually supersedes the previous one.
 *
 * Workspace gating (postmortem 0002 — instructions leaked into foreign repos):
 * a project root is ELIGIBLE for an agent only when that agent's session cwd
 * lies inside the root (`agent.session.header.cwd`). Agents working outside
 * every configured root never receive any bundle, no matter how strongly the
 * message text mentions the root's domains. All activity signals are also
 * attributed per-agent (`ToolExecution.agent`, and the `actor` of
 * `fs/observed` carries the same agent), so in a multi-session host process
 * one agent's file/shell activity can never raise another agent's root score.
 * Relative path fragments extracted from shell commands resolve only against
 * roots containing the acting agent's own cwd.
 *
 * Worktree pinning (v0.3.0): a session created inside the configured worktrees
 * directory (`worktrees.dir`, e.g. …/platform.worktrees/<name>) is PINNED to
 * the scope named after the worktree directory. The worktree itself becomes
 * the reading root (its own branch checkout), the domain comes from the
 * directory name (`worktrees.domainByWorktree` may override the mapping), and
 * neither message text nor activity can switch the domain or pull another
 * domain's files. Core files stay on by default (`worktrees.includeCore`) so a
 * worktree without a domain instruction file still receives the repo-wide
 * rules; layer maps are off by default (`worktrees.includeLayers`).
 *
 * App-scope bundles (v0.4.0) include EVERY found scope file — the domain
 * package's AGENTS.md and the app's AGENTS.md are complementary, not a
 * priority chain — and fall back to the configured project roots for files
 * the worktree branch does not carry yet (authored on the base branch, not
 * yet synced into the worktree).
 *
 * Namespace plugin shape: named exports name / inject / apply, no default
 * export (postmortem 0001: default export drops inject).
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
export const name = 'scope-router';
/** The filesystem service must exist before this plugin starts. */
export const inject = ['fs'];
const DEFAULT_MAX_BUNDLE_CHARS = 80000;
const OBSERVED_CAP = 800;
const RECENT_ACTIVITY_CAP = 12;
/** Root-relative path fragments extracted from shell commands. */
const SHELL_PATH_SEGMENT = /(packages\/(?:platform|domains)\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*|apps\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)/g;
/** Normalize a configured root so prefix checks are reliable (no trailing `/`). */
function normalizeRoot(root) {
    const trimmed = root.replace(/\/+$/, '');
    return trimmed.length > 0 ? trimmed : root;
}
/** True when `path` is `root` itself or lies inside `root`. */
function isWithin(path, root) {
    return path === root || path.startsWith(root + '/');
}
/** The agent's session working directory, normalized; empty when unknown. */
function sessionCwdOf(agent) {
    const cwd = agent?.session?.header?.cwd;
    if (typeof cwd !== 'string' || cwd.length === 0)
        return '';
    const trimmed = cwd.replace(/\/+$/, '');
    return trimmed.length > 0 ? trimmed : '/';
}
/** Read the acting agent off an opaque `fs/observed` actor (a tool-execution context). */
function actorAsAgent(actor) {
    if (actor === null || typeof actor !== 'object')
        return undefined;
    const candidate = actor.agent;
    return candidate !== null && typeof candidate === 'object' ? candidate : undefined;
}
/** Resolve the worktrees block; a missing or empty `dir` deactivates pinning. */
function resolveWorktrees(input) {
    const dir = typeof input?.dir === 'string' ? normalizeRoot(input.dir) : '';
    if (dir.length === 0)
        return null;
    const domainByWorktree = new Map();
    for (const [name, domain] of Object.entries(input?.domainByWorktree ?? {})) {
        if (typeof domain === 'string' && domain.length > 0)
            domainByWorktree.set(name, domain);
    }
    return {
        dir,
        domainByWorktree,
        includeCore: input?.includeCore ?? true,
        includeLayers: input?.includeLayers ?? false,
    };
}
export function apply(ctx, input = {}) {
    const config = {
        roots: [...(input.projectRoots ?? [])]
            .map((root) => normalizeRoot(root))
            .filter((root) => root.length > 0),
        coreFiles: [...(input.coreFiles ?? [])],
        layerFiles: {
            backend: [...(input.layerFiles?.backend ?? [])],
            frontend: [...(input.layerFiles?.frontend ?? [])],
        },
        domainsDir: input.domainsDir ?? 'packages/domains',
        domainCandidates: [...(input.domainCandidates ?? [
                'packages/domains/{domain}/AGENTS.md',
                'packages/domains/{domain}/src/agents/AGENTS.md',
                'packages/domains/{domain}/README.md',
                'apps/{domain}/AGENTS.md',
            ])],
        maxBundleChars: input.maxBundleChars ?? DEFAULT_MAX_BUNDLE_CHARS,
        probeTool: input.probeTool ?? false,
        log: input.log ?? true,
        worktrees: resolveWorktrees(input.worktrees),
    };
    if (config.roots.length === 0) {
        ctx.logger.warn('[scope-router] no projectRoots configured; plugin inactive');
        return;
    }
    const stats = {
        domainsByRoot: new Map(),
        worktreeNames: [],
        fileCache: new Map(),
        trackedAgents: 0,
        recentActivity: [],
        injections: 0,
        lastDetection: null,
        lastError: null,
    };
    const agentScopes = new WeakMap();
    const activityByAgent = new WeakMap();
    // ── helpers ────────────────────────────────────────────────────────────────
    function withinAnyRoot(path) {
        for (const root of config.roots)
            if (isWithin(path, root))
                return true;
        // Paths inside the worktrees directory belong to pinned scopes' own
        // checkouts; they carry routing information for worktree agents too.
        return config.worktrees !== null && isWithin(path, config.worktrees.dir);
    }
    /**
     * Resolve the pinned worktree scope for a cwd: the first path segment under
     * the worktrees directory names the worktree, and the worktree names the
     * domain (identity unless `domainByWorktree` overrides it). Returns `null`
     * when pinning is inactive or the cwd lies outside the directory.
     */
    function worktreeScopeFor(cwd) {
        const worktrees = config.worktrees;
        if (worktrees === null || !isWithin(cwd, worktrees.dir))
            return null;
        const rest = cwd.slice(worktrees.dir.length + 1);
        const name = rest.split('/')[0] ?? '';
        if (name.length === 0)
            return null;
        return {
            name,
            root: worktrees.dir + '/' + name,
            domain: worktrees.domainByWorktree.get(name) ?? name,
        };
    }
    function agentLabel(agent) {
        const id = agent?.id;
        if (typeof id === 'string')
            return id;
        if (typeof id === 'number')
            return String(id);
        return 'unknown';
    }
    function agentActivity(agent) {
        if (agent === null || typeof agent !== 'object')
            return undefined;
        let entry = activityByAgent.get(agent);
        if (entry === undefined) {
            entry = { observed: new Map() };
            activityByAgent.set(agent, entry);
            stats.trackedAgents += 1;
        }
        return entry;
    }
    function bump(activity, agent, path) {
        if (typeof path !== 'string' || path.length === 0)
            return;
        const previous = activity.observed.get(path);
        activity.observed.set(path, previous === undefined ? 1 : Math.min(previous + 1, 4));
        if (activity.observed.size > OBSERVED_CAP) {
            const first = activity.observed.keys().next();
            if (!first.done)
                activity.observed.delete(first.value);
        }
        stats.recentActivity.push({ agent: agentLabel(agent), path });
        if (stats.recentActivity.length > RECENT_ACTIVITY_CAP) {
            stats.recentActivity.splice(0, stats.recentActivity.length - RECENT_ACTIVITY_CAP);
        }
    }
    async function readRel(root, rel, signal) {
        const key = root + '\n' + rel;
        const cached = stats.fileCache.get(key);
        if (cached !== undefined)
            return cached;
        try {
            const opts = signal === undefined ? undefined : { signal };
            const target = await ctx.fs.resolve(root + '/' + rel, opts);
            const text = await ctx.fs.readText(target, signal);
            stats.fileCache.set(key, text);
            return text;
        }
        catch {
            stats.fileCache.set(key, null);
            return null;
        }
    }
    async function listSubdirectories(dir) {
        try {
            const dirTarget = await ctx.fs.resolve(dir);
            const entries = await ctx.fs.listDir(dirTarget);
            return entries
                .filter((entry) => entry.type === 'directory' && entry.name !== 'node_modules')
                .map((entry) => entry.name);
        }
        catch {
            return [];
        }
    }
    async function listDomainNames(root) {
        return listSubdirectories(root + '/' + config.domainsDir);
    }
    function extractText(messages) {
        let out = '';
        for (const message of messages) {
            if (message === null || typeof message !== 'object')
                continue;
            const content = message.content;
            if (!Array.isArray(content))
                continue;
            for (const block of content) {
                if (block === null || typeof block !== 'object')
                    continue;
                const candidate = block;
                if (candidate.type === 'text' && typeof candidate.text === 'string')
                    out += '\n' + candidate.text;
            }
        }
        return out;
    }
    function domainNamesMentionedIn(text) {
        const lower = text.toLowerCase();
        const names = new Set();
        for (const domainNames of stats.domainsByRoot.values()) {
            for (const domainName of domainNames)
                if (lower.includes(domainName))
                    names.add(domainName);
        }
        // Fallback: path-shaped mentions work even before the directory listing lands.
        for (const match of lower.matchAll(/packages\/domains\/([a-z0-9._-]+)/g))
            names.add(match[1]);
        for (const match of lower.matchAll(/apps\/([a-z0-9._-]+)/g))
            names.add(match[1]);
        return [...names];
    }
    /**
     * Score one eligible root for THIS agent. The caller guarantees the agent's
     * cwd lies inside every candidate root, so the baseline is 1 plus the
     * agent's OWN activity and domain mentions.
     */
    function rootScore(root, mentionedDomains, activity) {
        let score = 1;
        let activityWeight = 0;
        for (const [path, weight] of activity.observed) {
            if (isWithin(path, root))
                activityWeight += Math.min(weight, 3);
        }
        score += Math.min(activityWeight, 6);
        const known = stats.domainsByRoot.get(root) ?? [];
        for (const domain of mentionedDomains)
            if (known.includes(domain))
                score += 3;
        return score;
    }
    function domainScore(domainName, mentionedDomains, activity) {
        let score = 0;
        if (mentionedDomains.has(domainName))
            score += 3;
        const domainSegment = '/packages/domains/' + domainName + '/';
        const appSegment = '/apps/' + domainName + '/';
        for (const [path, weight] of activity.observed) {
            if (path.includes(domainSegment) || path.includes(appSegment))
                score += Math.min(weight, 3);
        }
        return score;
    }
    function layerScore(text, activity) {
        let backend = 0;
        let frontend = 0;
        for (const [path, weight] of activity.observed) {
            const w = Math.min(weight, 3);
            if (path.includes('/backend/') || path.includes('/contracts/') || path.includes('/db/') || path.includes('/schemas/') || path.includes('drizzle'))
                backend += w;
            if (path.includes('/frontend/') || path.includes('.vue') || path.includes('/widgets/') || path.includes('/contributions/'))
                frontend += w;
        }
        const lower = text.toLowerCase();
        if (/backend|nest|contract|drizzle|migrat|бэк|миграц/.test(lower))
            backend += 2;
        if (/frontend|vue|компонент|страниц|клиент/.test(lower))
            frontend += 2;
        return { backend, frontend };
    }
    function pickLayer(scores) {
        if (scores.frontend > scores.backend)
            return 'frontend';
        if (scores.backend > scores.frontend)
            return 'backend';
        return 'mixed';
    }
    /**
     * Read one root-relative file from `root`, falling back to `fallbackRoots`
     * when the primary root does not carry it (a worktree branch predating the
     * file's arrival from the base repo). Returns the content plus the root it
     * came from, or `null` when nowhere found.
     */
    async function readRelWithFallback(root, rel, fallbackRoots, signal) {
        const primary = await readRel(root, rel, signal);
        if (primary !== null)
            return { content: primary, fromRoot: root };
        if (fallbackRoots !== undefined) {
            for (const fallbackRoot of fallbackRoots) {
                if (fallbackRoot === root)
                    continue;
                const content = await readRel(fallbackRoot, rel, signal);
                if (content !== null)
                    return { content, fromRoot: fallbackRoot };
            }
        }
        return null;
    }
    async function assembleBundle(root, domainName, layer, cwd, signal, options = { core: true, layers: true }) {
        const domainSections = [];
        if (domainName !== null) {
            for (const candidate of config.domainCandidates) {
                const rel = candidate.replaceAll('{domain}', domainName);
                const found = await readRelWithFallback(root, rel, options.fallbackRoots, signal);
                if (found === null)
                    continue;
                domainSections.push({ rel, content: found.content, fromRoot: found.fromRoot });
                // Guessed-scope bundles keep the priority-chain semantics: the first
                // candidate that exists anywhere is THE domain file. Pinned app-scope
                // bundles take every found candidate — the domain package's AGENTS.md
                // and the app's AGENTS.md are complementary, not alternatives.
                if (options.allDomainCandidates !== true)
                    break;
            }
        }
        const coreRels = options.core ? [...config.coreFiles] : [];
        const layerRels = options.layers
            ? layer === 'backend'
                ? [...config.layerFiles.backend]
                : layer === 'frontend'
                    ? [...config.layerFiles.frontend]
                    : []
            : [];
        // Emission order: core rules → scope (domain/app) files → layer maps.
        const orderedSections = [];
        for (const rel of coreRels) {
            const content = await readRel(root, rel, signal);
            if (content !== null)
                orderedSections.push({ rel, content });
        }
        orderedSections.push(...domainSections);
        for (const rel of layerRels) {
            const content = await readRel(root, rel, signal);
            if (content !== null)
                orderedSections.push({ rel, content });
        }
        const sections = [];
        const used = [];
        let total = 0;
        for (const section of orderedSections) {
            if (total + section.content.length > config.maxBundleChars) {
                sections.push('## ' + section.rel + '\n\n[omitted: bundle over budget]');
                continue;
            }
            sections.push('## ' + section.rel + '\n\n' + section.content);
            total += section.content.length;
            used.push(section.rel);
        }
        if (sections.length === 0)
            return null;
        const scopeLabel = domainName === null ? 'platform core' : 'domain ' + domainName;
        const layerLabel = layer === 'mixed' ? 'unspecified (layer maps not included)' : layer;
        const scopeLine = options.pinnedBy === undefined
            ? 'scope-router: working scope auto-detected — ' + scopeLabel + ' (layer: ' + layerLabel + ').'
            : 'scope-router: working scope pinned by workspace (worktree ' + options.pinnedBy + ') — ' + scopeLabel + ' (layer: ' + layerLabel + ').';
        const fallbackRels = domainSections
            .filter((section) => section.fromRoot !== root)
            .map((section) => section.rel);
        const header = [
            '<system-reminder>',
            scopeLine,
            options.pinnedBy === undefined
                ? ''
                : 'Instructions are read from this worktree checkout; files from other domains are not attached, regardless of which domains the conversation mentions.',
            fallbackRels.length === 0
                ? ''
                : 'This worktree branch does not yet contain: ' + fallbackRels.join(', ') + ' — those files were taken from the main project root (after a sync/merge they will be read from the worktree).',
            'Below are the project instructions that apply to this scope. This bundle supersedes any previous scope-router bundle: follow only the current one. Explicit user instructions in the chat always take priority.',
            'Working workspace: ' + (cwd === undefined ? root : cwd) + ' (project root: ' + root + ').',
            'Instruction files: ' + used.join(', '),
            '</system-reminder>',
        ].filter((line) => line.length > 0).join('\n');
        return {
            text: header + '\n\n' + sections.join('\n\n'),
            used,
            fallbackRels,
        };
    }
    function describeArgs(args) {
        if (args === null || typeof args !== 'object')
            return {};
        const record = args;
        return {
            command: typeof record.command === 'string' ? record.command : undefined,
            workdir: typeof record.workdir === 'string' ? record.workdir : undefined,
        };
    }
    // ── preload domain catalogs ───────────────────────────────────────────────
    ctx.effect(() => {
        let disposed = false;
        void (async () => {
            for (const root of config.roots) {
                try {
                    const names = await listDomainNames(root);
                    if (!disposed)
                        stats.domainsByRoot.set(root, names);
                }
                catch (error) {
                    ctx.logger.warn('[scope-router] domain listing failed for %s: %o', root, error);
                }
            }
            if (config.worktrees !== null) {
                const names = await listSubdirectories(config.worktrees.dir);
                if (!disposed)
                    stats.worktreeNames = names;
            }
        })();
        return () => {
            disposed = true;
        };
    });
    // ── activity signals (attributed per-agent) ────────────────────────────────
    ctx.on('fs/observed', (target, _observation, actor) => {
        const agent = actorAsAgent(actor);
        if (agent === undefined)
            return;
        const path = target.displayPath;
        // Only paths inside configured roots carry routing information; everything
        // else would just pollute the per-agent map.
        if (!withinAnyRoot(path))
            return;
        const activity = agentActivity(agent);
        if (activity !== undefined)
            bump(activity, agent, path);
    });
    ctx.on('tools/result', (exec, _result) => {
        if (exec.name !== 'bash' && exec.name !== 'pwsh')
            return;
        const agent = exec.agent;
        const activity = agentActivity(agent);
        if (activity === undefined)
            return;
        const args = describeArgs(exec.arguments);
        const fragments = [];
        if (args.workdir !== undefined && args.workdir.length > 0)
            fragments.push(args.workdir);
        if (args.command !== undefined) {
            const slice = args.command.slice(0, 4000);
            let match;
            SHELL_PATH_SEGMENT.lastIndex = 0;
            while ((match = SHELL_PATH_SEGMENT.exec(slice)) !== null)
                fragments.push(match[1]);
        }
        if (fragments.length === 0)
            return;
        const cwd = sessionCwdOf(agent);
        for (const fragment of fragments) {
            if (fragment.startsWith('/')) {
                // Absolute paths are trusted, but only recorded when they fall inside
                // a configured root (scoring would ignore the rest anyway).
                if (withinAnyRoot(fragment))
                    bump(activity, agent, fragment);
                continue;
            }
            // A relative fragment is honest only against the root containing the
            // acting agent's own workspace: the pinned worktree checkout for
            // worktree agents, a configured root otherwise. Fabricating
            // root-relative paths for foreign sessions is what leaked instructions
            // across repos before.
            if (!fragment.includes('packages/') && !fragment.includes('apps/'))
                continue;
            if (cwd.length === 0)
                continue;
            const worktree = worktreeScopeFor(cwd);
            if (worktree !== null) {
                bump(activity, agent, worktree.root + '/' + fragment);
                continue;
            }
            for (const root of config.roots) {
                if (isWithin(cwd, root)) {
                    bump(activity, agent, root + '/' + fragment);
                    break;
                }
            }
        }
    });
    ctx.on('agent/disposed', (payload) => {
        agentScopes.delete(payload.agent);
    });
    // ── main hook: detect scope and inject instructions ───────────────────────
    ctx.on('agent/pre-step', async (payload, next) => {
        const decision = await next();
        if (decision.kind !== 'enter')
            return decision;
        try {
            if (payload.signal.aborted)
                return decision;
            const { agent, messages, turn } = payload;
            // Workspace gate: only agents whose session cwd lies inside a
            // configured root may receive that root's instructions. An agent
            // working in a foreign repository stays untouched even when the
            // conversation mentions this project's domains.
            const cwd = sessionCwdOf(agent);
            if (cwd.length === 0)
                return decision;
            const activity = agentActivity(agent);
            if (activity === undefined)
                return decision;
            const text = extractText(messages);
            const mentionedDomains = new Set(domainNamesMentionedIn(text));
            let root;
            let domainName;
            let layer;
            let bundleOptions;
            const previous = agentScopes.get(agent);
            const worktree = worktreeScopeFor(cwd);
            const worktrees = config.worktrees;
            if (worktree !== null && worktrees !== null) {
                // Worktree pinning: a session created inside <worktrees.dir>/<name>
                // works the scope named after the worktree. The worktree's own
                // checkout is the reading root, the domain is fixed by directory
                // name, and neither text nor activity can switch scopes or pull in
                // another domain's files.
                root = worktree.root;
                domainName = worktree.domain;
                layer = worktrees.includeLayers ? pickLayer(layerScore(text, activity)) : 'mixed';
                bundleOptions = {
                    core: worktrees.includeCore,
                    layers: worktrees.includeLayers,
                    pinnedBy: worktree.name,
                    // App-scope chats take every scope file that exists (domain package
                    // AGENTS.md AND app AGENTS.md), and fall back to the base project
                    // roots for files the worktree branch does not carry yet.
                    allDomainCandidates: true,
                    fallbackRoots: config.roots,
                };
            }
            else {
                const eligibleRoots = config.roots.filter((root) => isWithin(cwd, root));
                if (eligibleRoots.length === 0)
                    return decision;
                let chosenRoot = eligibleRoots[0];
                let chosenScore = -1;
                for (const candidate of eligibleRoots) {
                    const score = rootScore(candidate, mentionedDomains, activity);
                    if (score > chosenScore) {
                        chosenScore = score;
                        chosenRoot = candidate;
                    }
                }
                root = chosenRoot;
                const knownDomains = stats.domainsByRoot.get(root) ?? [];
                let bestDomain = null;
                for (const domainName of knownDomains) {
                    const score = domainScore(domainName, mentionedDomains, activity);
                    if (bestDomain === null || score > bestDomain.score)
                        bestDomain = { name: domainName, score };
                }
                if (bestDomain !== null && bestDomain.score > 0) {
                    domainName = bestDomain.name;
                    layer = pickLayer(layerScore(text, activity));
                }
                else if (previous !== undefined && previous.root === root && previous.domain !== null) {
                    domainName = previous.domain;
                    layer = previous.layer;
                }
                else {
                    domainName = null;
                    layer = pickLayer(layerScore(text, activity));
                }
                bundleOptions = { core: true, layers: true };
            }
            const fingerprint = root + '|' + (domainName === null ? 'core' : domainName) + '|' + layer;
            if (previous !== undefined && previous.fingerprint === fingerprint)
                return decision;
            const built = await assembleBundle(root, domainName, layer, cwd, payload.signal, bundleOptions);
            if (built === null)
                return decision;
            agentScopes.set(agent, { root, domain: domainName, layer, fingerprint });
            const message = createUserMessage({
                content: [{ type: 'text', text: built.text }],
                // v4 refuses the released `{ kind: 'plugin', … }` wrapper; the
                // canonical kind for a producer outside the shipped registry is
                // `plugin:<name>` — what the v3→v4 migration rewrites it into.
                source: { kind: 'plugin:scope-router', form: 'instructions' },
            });
            stats.injections += 1;
            stats.lastDetection = {
                turn,
                root,
                cwd,
                domain: domainName,
                layer,
                pinned: worktree !== null,
                messageChars: built.text.length,
                files: built.used,
            };
            if (config.log) {
                ctx.logger.info('[scope-router] injected #%d agent=%s turn=%d root=%s scope=%s layer=%s%s%s', stats.injections, agent.id, turn, root, domainName === null ? 'core' : domainName, layer, worktree === null ? '' : ' [pinned:' + worktree.name + ']', built.fallbackRels.length === 0 ? '' : ' [fallback:' + built.fallbackRels.join(',') + ']');
            }
            return { kind: 'enter', messages: [message, ...decision.messages] };
        }
        catch (error) {
            stats.lastError = String(error instanceof Error ? error.message : error);
            ctx.logger.warn('[scope-router] pre-step failed: %s', stats.lastError);
            return decision;
        }
    });
    // ── probe tool ─────────────────────────────────────────────────────────────
    const tools = ctx.get('tools');
    if (tools !== undefined && config.probeTool) {
        const probeDefinition = {
            name: 'scope_router_status',
            description: 'scope-router status: known domains, workspace gating, worktree pinning, recent agent activity, last detection and injections. With a domain argument — preview the instruction bundle for that domain (e.g. toprep).',
            parameters: {
                type: 'object',
                properties: {
                    domain: { type: 'string', description: 'Optional: domain name to preview the instruction bundle for.' },
                },
                required: [],
            },
            output: {
                schema: { type: 'string' },
                render(_args, value) {
                    return [{ type: 'text', text: String(value) }];
                },
            },
            async execute(args) {
                try {
                    const lines = [];
                    lines.push('scope-router status');
                    for (const [root, domainNames] of stats.domainsByRoot) {
                        lines.push('root: ' + root);
                        lines.push('domains: ' + (domainNames.length > 0 ? domainNames.join(', ') : '(listing pending)'));
                    }
                    lines.push('workspace gate: on — only agents whose cwd is inside a root receive bundles');
                    if (config.worktrees !== null) {
                        lines.push('worktree pinning: ' + config.worktrees.dir +
                            ' → ' + (stats.worktreeNames.length > 0 ? stats.worktreeNames.join(', ') : '(scan pending)') +
                            ' (core=' + (config.worktrees.includeCore ? 'on' : 'off') +
                            ', layers=' + (config.worktrees.includeLayers ? 'on' : 'off') + ')');
                    }
                    lines.push('tracked agents: ' + stats.trackedAgents);
                    lines.push(stats.recentActivity.length > 0
                        ? 'recent activity:\n  ' + stats.recentActivity.map((entry) => '[' + entry.agent + '] ' + entry.path).join('\n  ')
                        : 'recent activity: (none)');
                    lines.push('injections: ' + stats.injections);
                    if (stats.lastDetection !== null) {
                        lines.push('last detection: root=' + stats.lastDetection.root +
                            ' cwd=' + stats.lastDetection.cwd +
                            ' domain=' + stats.lastDetection.domain +
                            ' layer=' + stats.lastDetection.layer +
                            ' pinned=' + (stats.lastDetection.pinned ? 'yes' : 'no') +
                            ' turn=' + stats.lastDetection.turn +
                            ' chars=' + stats.lastDetection.messageChars);
                        lines.push('last files: ' + stats.lastDetection.files.join(', '));
                    }
                    if (stats.lastError !== null)
                        lines.push('last error: ' + stats.lastError);
                    const requested = args !== null && typeof args === 'object' ? args.domain : undefined;
                    if (typeof requested === 'string' && requested.length > 0) {
                        const root = config.roots[0];
                        const built = await assembleBundle(root, requested, 'mixed');
                        lines.push('');
                        lines.push('=== preview bundle for ' + requested + ' (root ' + root + ') ===');
                        if (built === null)
                            lines.push('(no files found)');
                        else {
                            lines.push('total ' + built.text.length + ' chars; files: ' + built.used.join(', '));
                            lines.push('--- text head ---');
                            lines.push(built.text.slice(0, 1500));
                            if (built.text.length > 1500)
                                lines.push('...[preview truncated]');
                        }
                    }
                    return lines.join('\n');
                }
                catch (error) {
                    return 'scope_router_status error: ' + String(error instanceof Error ? error.message : error);
                }
            },
        };
        ctx.effect(() => tools.register(probeDefinition));
    }
}

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
 * Namespace plugin shape: named exports name / inject / apply, no default
 * export (postmortem 0001: default export drops inject).
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
export const name = 'scope-router';
/** The filesystem service must exist before this plugin starts. */
export const inject = ['fs'];
const DEFAULT_MAX_BUNDLE_CHARS = 80000;
const OBSERVED_CAP = 800;
/** Root-relative path fragments extracted from shell commands. */
const SHELL_PATH_SEGMENT = /(packages\/(?:platform|domains)\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*|apps\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)/g;
export function apply(ctx, input = {}) {
    const config = {
        roots: [...(input.projectRoots ?? [])].filter((root) => root.length > 0),
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
    };
    if (config.roots.length === 0) {
        ctx.logger.warn('[scope-router] no projectRoots configured; plugin inactive');
        return;
    }
    const stats = {
        domainsByRoot: new Map(),
        observed: new Map(),
        fileCache: new Map(),
        injections: 0,
        lastDetection: null,
        lastError: null,
    };
    const agentScopes = new WeakMap();
    // ── helpers ────────────────────────────────────────────────────────────────
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
    async function listDomainNames(root) {
        try {
            const dirTarget = await ctx.fs.resolve(root + '/' + config.domainsDir);
            const entries = await ctx.fs.listDir(dirTarget);
            return entries
                .filter((entry) => entry.type === 'directory' && entry.name !== 'node_modules')
                .map((entry) => entry.name);
        }
        catch {
            return [];
        }
    }
    function bumpActivity(path) {
        if (typeof path !== 'string' || path.length === 0)
            return;
        const previous = stats.observed.get(path);
        stats.observed.set(path, previous === undefined ? 1 : Math.min(previous + 1, 4));
        if (stats.observed.size > OBSERVED_CAP) {
            const first = stats.observed.keys().next();
            if (!first.done)
                stats.observed.delete(first.value);
        }
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
    /** Score one root against message text and recorded activity. */
    function rootScore(root, mentionedDomains, cwd) {
        let score = 0;
        if (cwd.length > 0 && (cwd === root || cwd.startsWith(root + '/')))
            score += 1;
        let activityWeight = 0;
        for (const [path, weight] of stats.observed) {
            if (path === root || path.startsWith(root + '/'))
                activityWeight += Math.min(weight, 3);
        }
        score += Math.min(activityWeight, 6);
        const known = stats.domainsByRoot.get(root) ?? [];
        for (const domain of mentionedDomains)
            if (known.includes(domain))
                score += 3;
        return score;
    }
    function domainScore(domainName, mentionedDomains) {
        let score = 0;
        if (mentionedDomains.has(domainName))
            score += 3;
        const domainSegment = '/packages/domains/' + domainName + '/';
        const appSegment = '/apps/' + domainName + '/';
        for (const [path, weight] of stats.observed) {
            if (path.includes(domainSegment) || path.includes(appSegment))
                score += Math.min(weight, 3);
        }
        return score;
    }
    function layerScore(text) {
        let backend = 0;
        let frontend = 0;
        for (const [path, weight] of stats.observed) {
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
    async function assembleBundle(root, domainName, layer, signal) {
        const files = [...config.coreFiles];
        if (domainName !== null) {
            for (const candidate of config.domainCandidates) {
                const rel = candidate.replaceAll('{domain}', domainName);
                const content = await readRel(root, rel, signal);
                if (content !== null) {
                    files.push(rel);
                    break;
                }
            }
        }
        if (layer === 'backend')
            files.push(...config.layerFiles.backend);
        else if (layer === 'frontend')
            files.push(...config.layerFiles.frontend);
        const sections = [];
        const used = [];
        let total = 0;
        for (const rel of files) {
            const content = await readRel(root, rel, signal);
            if (content === null)
                continue;
            if (total + content.length > config.maxBundleChars) {
                sections.push('## ' + rel + '\n\n[omitted: bundle over budget]');
                continue;
            }
            sections.push('## ' + rel + '\n\n' + content);
            total += content.length;
            used.push(rel);
        }
        if (sections.length === 0)
            return null;
        const scopeLabel = domainName === null ? 'ядро платформы (core)' : 'домен ' + domainName;
        const layerLabel = layer === 'mixed' ? 'не определён (послойные карты не включены)' : layer;
        const header = [
            '<system-reminder>',
            'scope-router: автоматически определена область работы — ' + scopeLabel + ' (слой: ' + layerLabel + ').',
            'Ниже — инструкции проекта, применимые к этой области. Эта подборка заменяет предыдущую подборку scope-router, если она была: следуй только актуальной. Явные указания пользователя в чате всегда приоритетнее.',
            'Файлы инструкций: ' + used.join(', '),
            '</system-reminder>',
        ].join('\n');
        return { text: header + '\n\n' + sections.join('\n\n'), used };
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
        })();
        return () => {
            disposed = true;
        };
    });
    // ── activity signals ───────────────────────────────────────────────────────
    ctx.on('fs/observed', (target, _observation, _actor) => {
        bumpActivity(target.displayPath);
    });
    ctx.on('tools/result', (exec, _result) => {
        if (exec.name !== 'bash' && exec.name !== 'pwsh')
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
        for (const fragment of fragments) {
            const absolute = fragment.startsWith('/') ? fragment : undefined;
            for (const root of config.roots) {
                if (absolute !== undefined && (absolute === root || absolute.startsWith(root + '/')))
                    bumpActivity(absolute + '/');
                else if (fragment.includes('packages/') || fragment.includes('apps/'))
                    bumpActivity(root + '/' + fragment + '/');
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
            const cwd = agent.session.header.cwd ?? '';
            const text = extractText(messages);
            const mentionedDomains = new Set(domainNamesMentionedIn(text));
            let chosenRoot = null;
            let chosenScore = 0;
            for (const root of config.roots) {
                const score = rootScore(root, mentionedDomains, cwd);
                if (score > chosenScore) {
                    chosenScore = score;
                    chosenRoot = root;
                }
            }
            if (chosenRoot === null || chosenScore === 0)
                return decision;
            const root = chosenRoot;
            const knownDomains = stats.domainsByRoot.get(root) ?? [];
            let bestDomain = null;
            for (const domainName of knownDomains) {
                const score = domainScore(domainName, mentionedDomains);
                if (bestDomain === null || score > bestDomain.score)
                    bestDomain = { name: domainName, score };
            }
            const previous = agentScopes.get(agent);
            let domainName;
            let layer;
            if (bestDomain !== null && bestDomain.score > 0) {
                domainName = bestDomain.name;
                layer = pickLayer(layerScore(text));
            }
            else if (previous !== undefined && previous.domain !== null) {
                domainName = previous.domain;
                layer = previous.layer;
            }
            else {
                domainName = null;
                layer = pickLayer(layerScore(text));
            }
            const fingerprint = (domainName === null ? 'core' : domainName) + '|' + layer;
            if (previous !== undefined && previous.fingerprint === fingerprint)
                return decision;
            const built = await assembleBundle(root, domainName, layer, payload.signal);
            if (built === null)
                return decision;
            agentScopes.set(agent, { domain: domainName, layer, fingerprint });
            const message = createUserMessage({
                content: [{ type: 'text', text: built.text }],
                source: { kind: 'plugin', plugin: 'scope-router', form: 'instructions' },
            });
            stats.injections += 1;
            stats.lastDetection = {
                turn,
                domain: domainName,
                layer,
                messageChars: built.text.length,
                files: built.used,
            };
            if (config.log) {
                ctx.logger.info('[scope-router] injected #%d agent=%s turn=%d scope=%s layer=%s', stats.injections, agent.id, turn, domainName === null ? 'core' : domainName, layer);
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
            description: 'Статус scope-router: известные домены, наблюдаемые файлы, последняя детекция и инъекции. С аргументом domain — предпросмотр бандла инструкций для домена (например toprep).',
            parameters: {
                type: 'object',
                properties: {
                    domain: { type: 'string', description: 'Опционально: имя домена для предпросмотра бандла.' },
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
                    lines.push('observed files: ' + stats.observed.size);
                    const recent = [];
                    for (const path of stats.observed.keys()) {
                        recent.push(path);
                        if (recent.length >= 12)
                            break;
                    }
                    lines.push(recent.length > 0 ? 'recent observed:\n  ' + recent.join('\n  ') : 'recent observed: (none)');
                    lines.push('injections: ' + stats.injections);
                    if (stats.lastDetection !== null) {
                        lines.push('last detection: domain=' + stats.lastDetection.domain + ' layer=' + stats.lastDetection.layer + ' turn=' + stats.lastDetection.turn + ' chars=' + stats.lastDetection.messageChars);
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

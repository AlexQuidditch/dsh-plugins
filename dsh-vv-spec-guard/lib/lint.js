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
const COMPONENT_RE = /^COMPONENT-[A-Z][A-Z0-9-]*$/;
const TASK_RE = /^TASK-T-\d{3}$/;
const WAVE_RE = /^WAVE-\d+$/;
const STATUSES = new Set(['draft', 'approved', 'applied']);
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
export function parseXmlLite(text) {
    const TAG_RE = /<(\/?)([A-Za-z0-9_.-]+)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
    const stack = [];
    let root;
    const clean = text
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<\?[\s\S]*?\?>/g, '')
        .replace(/<!DOCTYPE[\s\S]*?>/gi, '');
    let lastEnd = 0;
    for (const match of clean.matchAll(TAG_RE)) {
        const index = match.index;
        const plainText = clean.slice(lastEnd, index).trim();
        if (plainText !== '' && stack.length > 0) {
            const top = stack[stack.length - 1];
            top.text = top.text === undefined ? plainText : `${top.text} ${plainText}`;
        }
        lastEnd = index + match[0].length;
        const closing = match[1] === '/';
        const name = match[2];
        const rawAttrs = match[3];
        const selfClosing = match[4] === '/';
        if (!closing) {
            const attrs = {};
            for (const attrMatch of rawAttrs.matchAll(/([A-Za-z0-9_.-]+)\s*=\s*"([^"]*)"/g)) {
                attrs[attrMatch[1]] = attrMatch[2];
            }
            const node = { name, attrs, children: [] };
            if (stack.length === 0) {
                if (root !== undefined)
                    throw new Error('malformed XML: multiple root elements');
                root = node;
            }
            else {
                stack[stack.length - 1].children.push(node);
            }
            if (!selfClosing)
                stack.push(node);
            continue;
        }
        // Closing tag
        if (stack.length === 0)
            throw new Error(`malformed XML: closing </${name}> without an open tag`);
        const top = stack[stack.length - 1];
        if (top.name !== name)
            throw new Error(`malformed XML: </${name}> closes <${top.name}>`);
        stack.pop();
    }
    const tail = clean.slice(lastEnd).trim();
    if (tail !== '' && stack.length > 0) {
        const top = stack[stack.length - 1];
        top.text = top.text === undefined ? tail : `${top.text} ${tail}`;
    }
    if (stack.length > 0)
        throw new Error(`malformed XML: unclosed <${stack[stack.length - 1].name}>`);
    if (root === undefined)
        throw new Error('malformed XML: no root element');
    return root;
}
/** All descendant elements of a node whose name matches a regex. */
function collect(node, re) {
    const found = [];
    for (const child of node.children) {
        if (re.test(child.name))
            found.push(child);
        found.push(...collect(child, re));
    }
    return found;
}
/** Direct child elements with the given name. */
function childrenNamed(node, name) {
    return node.children.filter((child) => child.name === name);
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
function rootStatusAttribute(root) {
    const attribute = root.attrs.status;
    return typeof attribute === 'string' && attribute.trim() !== '' ? attribute.trim() : undefined;
}
function rootStatusElement(root) {
    const child = root.children.find((node) => node.name === 'status');
    const value = (child?.text ?? '').trim();
    return value === '' ? undefined : value;
}
/** Effective lifecycle status used by the §K approval and §L receipt rules. */
function lifecycleStatus(root, override) {
    return override ?? rootStatusAttribute(root) ?? rootStatusElement(root) ?? 'draft';
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
function structuralStatus(root, override) {
    return override ?? rootStatusAttribute(root) ?? 'draft';
}
function malformed(verdict, error) {
    // Parse errors already carry the "malformed XML: " prefix; only non-Error
    // throws need it added, so the verdict never reads "malformed XML: malformed XML: …".
    const message = error instanceof Error ? error.message : `malformed XML: ${String(error)}`;
    verdict.errors.push({ rule: 'well-formed', message });
    return verdict;
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
function checkApproval(verdict, artifact, status, options) {
    if (status !== 'approved' && status !== 'applied')
        return;
    const recorded = options.approval?.sha256.trim().toLowerCase();
    if (recorded !== undefined && recorded !== '') {
        // The clearance is consumed by execution: only the `approved` window is
        // byte-checked (see the rationale above).
        if (status !== 'approved')
            return;
        const current = options.currentSha256?.trim().toLowerCase();
        if (current === undefined || current === '')
            return;
        if (recorded !== current) {
            verdict.errors.push({
                rule: 'stale-approval',
                message: `STALE APPROVAL: ${artifact} changed after approval (recorded ${recorded.slice(0, 12)}, current ${current.slice(0, 12)}) — re-approval required`,
            });
        }
        return;
    }
    const where = options.approvalSidecarPresent === true
        ? 'approvals.json has no entry for it'
        : 'no approval digest sidecar is present';
    verdict.warnings.push({
        rule: 'approval-unverified',
        message: `APPROVAL UNVERIFIED: ${artifact} is ${status} but ${where} — call spec_guard_approve`,
    });
}
/**
 * Every verification command declared by a plan, in both supported spellings:
 * the unique-tag `<verification><command>` form and the legacy
 * `<verify><command>` form. Duplicates collapse so one receipt satisfies every
 * task that declares the same command.
 */
function verificationCommands(root) {
    const commands = [];
    for (const wrapper of collect(root, /^(?:verification|verify)$/)) {
        for (const command of collect(wrapper, /^command$/)) {
            const value = normalizeCommand(command.text ?? '');
            if (value !== '')
                commands.push(value);
        }
    }
    return [...new Set(commands)];
}

/**
 * Decode the five predefined XML entities plus numeric character references.
 * `parseXmlLite` keeps an element's raw text, so a plan whose command carries
 * `&amp;&amp;` must be decoded before it is compared with a receipts line that
 * stores the literal `&&`.
 */
function decodeXmlEntities(value) {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&amp;/g, '&');
}
/** Commands compare on decoded, trimmed text so escaped and literal forms match. */
function normalizeCommand(value) {
    return decodeXmlEntities(value).trim();
}
/** §L: every declared verification command must have an exit_code 0 receipt. */
function checkVerificationReceipts(verdict, root, receipts) {
    for (const command of verificationCommands(root)) {
        const matching = receipts.filter((receipt) => typeof receipt.command === 'string' && normalizeCommand(receipt.command) === command);
        if (matching.length === 0) {
            verdict.errors.push({
                rule: 'receipt-missing',
                message: `RECEIPT MISSING: no receipts.jsonl line for verification command "${command}"`,
            });
        }
        else if (!matching.some((receipt) => receipt.exit_code === 0)) {
            verdict.errors.push({
                rule: 'receipt-failed',
                message: `RECEIPT FAILED: verification command "${command}" has no exit_code 0 receipt`,
            });
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
export function lintSpec(text, options = {}) {
    const verdict = { errors: [], warnings: [] };
    let root;
    try {
        root = parseXmlLite(text);
    }
    catch (error) {
        return malformed(verdict, error);
    }
    if (root.name !== 'spec')
        verdict.errors.push({ rule: 'root', message: `root element must be <spec>, found <${root.name}>` });
    if (typeof root.attrs.package !== 'string' || root.attrs.package.trim() === '') {
        verdict.errors.push({ rule: 'package', message: '<spec> requires a non-empty package attribute' });
    }
    const status = lifecycleStatus(root, options.status);
    if (!STATUSES.has(status)) {
        verdict.errors.push({ rule: 'status', message: `status must be draft|approved|applied, found "${status}"` });
    }
    checkApproval(verdict, 'spec.xml', status, options);
    const structural = structuralStatus(root, options.status);
    const components = collect(root, COMPONENT_RE);
    const seen = new Set();
    for (const component of components) {
        if (seen.has(component.name))
            verdict.errors.push({ rule: 'identity', message: `duplicate component identity <${component.name}>` });
        seen.add(component.name);
    }
    for (const child of root.children) {
        if (child.name.startsWith('COMPONENT-') && !COMPONENT_RE.test(child.name)) {
            verdict.errors.push({ rule: 'identity', message: `component <${child.name}> does not match COMPONENT-UPPER-KEBAB` });
        }
    }
    if (structural !== 'draft') {
        if (childrenNamed(root, 'goals').flatMap((goals) => childrenNamed(goals, 'goal')).length === 0) {
            verdict.errors.push({ rule: 'completeness', message: 'approved/applied spec must have at least one <goal>' });
        }
        if (childrenNamed(root, 'requirements').flatMap((reqs) => childrenNamed(reqs, 'requirement')).length === 0) {
            verdict.errors.push({ rule: 'completeness', message: 'approved/applied spec must have at least one <requirement>' });
        }
        if (childrenNamed(root, 'acceptance').flatMap((acc) => childrenNamed(acc, 'criterion')).length === 0) {
            verdict.errors.push({ rule: 'completeness', message: 'approved/applied spec must have at least one <criterion>' });
        }
    }
    return verdict;
}
/** The set of task ids one plan element references through <task_id> children. */
function taskRefs(node) {
    return childrenNamed(node, 'task_id')
        .map((ref) => (ref.text ?? '').trim())
        .filter((id) => id !== '');
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
export function lintPlan(text, options = {}) {
    const verdict = { errors: [], warnings: [] };
    let root;
    try {
        root = parseXmlLite(text);
    }
    catch (error) {
        return malformed(verdict, error);
    }
    if (root.name !== 'plan')
        verdict.errors.push({ rule: 'root', message: `root element must be <plan>, found <${root.name}>` });
    if (typeof root.attrs.package !== 'string' || root.attrs.package.trim() === '') {
        verdict.errors.push({ rule: 'package', message: '<plan> requires a non-empty package attribute' });
    }
    const status = lifecycleStatus(root, options.status);
    if (!STATUSES.has(status)) {
        verdict.errors.push({ rule: 'status', message: `status must be draft|approved|applied, found "${status}"` });
    }
    checkApproval(verdict, 'plan.xml', status, options);
    const requireReceipts = status === 'applied' || options.checkReceipts === true;
    const structural = structuralStatus(root, options.status);
    const tasks = collect(root, TASK_RE);
    const taskIds = new Set();
    if (structural !== 'draft' && tasks.length === 0) {
        verdict.errors.push({ rule: 'completeness', message: 'approved/applied plan must have at least one task' });
    }
    for (const task of tasks) {
        if (taskIds.has(task.name))
            verdict.errors.push({ rule: 'identity', message: `duplicate task identity <${task.name}>` });
        taskIds.add(task.name);
        if (structural !== 'draft') {
            if (childrenNamed(task, 'title').length === 0)
                verdict.errors.push({ rule: 'completeness', message: `<${task.name}> has no <title>` });
            if (childrenNamed(task, 'acceptance').flatMap((acc) => childrenNamed(acc, 'criterion')).length === 0) {
                verdict.errors.push({ rule: 'completeness', message: `<${task.name}> has no acceptance <criterion>` });
            }
            // Both spellings count: unique-tag plans declare <verification><command>
            // and legacy plans declare <verify><command> (§L); a plan must have at
            // least one verification command per task either way.
            if (verificationCommands(task).length === 0) {
                verdict.errors.push({ rule: 'completeness', message: `<${task.name}> has no <verify>/<command>` });
            }
        }
    }
    for (const wave of collect(root, WAVE_RE)) {
        for (const ref of taskRefs(wave)) {
            if (!taskIds.has(ref))
                verdict.errors.push({ rule: 'reference', message: `<${wave.name}> references unknown task "${ref}"` });
        }
    }
    for (const depends of collect(root, /^depends_on$/)) {
        for (const ref of taskRefs(depends)) {
            if (!taskIds.has(ref))
                verdict.errors.push({ rule: 'reference', message: `depends_on references unknown task "${ref}"` });
        }
    }
    // Dependency cycle detection: DFS over task -> depends_on edges.
    const edges = new Map();
    for (const task of tasks) {
        const deps = [];
        for (const depends of childrenNamed(task, 'depends_on'))
            deps.push(...taskRefs(depends));
        edges.set(task.name, deps);
    }
    const visiting = new Set();
    const visited = new Set();
    const visit = (id) => {
        if (visiting.has(id))
            return [id];
        if (visited.has(id))
            return undefined;
        visiting.add(id);
        for (const dep of edges.get(id) ?? []) {
            if (!taskIds.has(dep))
                continue;
            const cycle = visit(dep);
            if (cycle !== undefined)
                return [id, ...cycle];
        }
        visiting.delete(id);
        visited.add(id);
        return undefined;
    };
    for (const id of edges.keys()) {
        const cycle = visit(id);
        if (cycle !== undefined) {
            verdict.errors.push({ rule: 'dependency', message: `dependency cycle: ${cycle.join(' -> ')}` });
            break;
        }
    }
    if (requireReceipts)
        checkVerificationReceipts(verdict, root, options.receipts ?? []);
    // Plan components must be a subset of spec components.
    const planComponents = collect(root, COMPONENT_RE).map((node) => node.name);
    const planSet = new Set(planComponents);
    if (planSet.size > 0) {
        if (options.specText !== undefined) {
            try {
                const spec = parseXmlLite(options.specText);
                const specSet = new Set(collect(spec, COMPONENT_RE).map((node) => node.name));
                for (const component of planSet) {
                    if (!specSet.has(component)) {
                        verdict.errors.push({ rule: 'spec-subset', message: `plan component <${component}> has no matching spec component` });
                    }
                }
            }
            catch {
                verdict.warnings.push({ rule: 'spec-subset', message: 'spec text provided but unparsable; component-subset check skipped' });
            }
        }
        else {
            verdict.warnings.push({ rule: 'spec-subset', message: 'spec text not provided; component-subset check skipped' });
        }
    }
    return verdict;
}
// ── §N Plan risk classifier ──────────────────────────────────────────────────
/** Fixed risk-category order (hive's five categories, vv-adapted). */
export const PLAN_RISK_CATEGORIES = [
    'auth_secrets_permissions',
    'destructive_data_schema',
    'public_compatibility',
    'concurrency_recovery_ownership',
    'deployment_release_supply_chain',
];
/** Protected path globs (signal a), matched against declared/plain path tokens. */
const PATH_RISK_RULES = [
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
];
/**
 * Category keywords (signal b), scanned over the whole plan text.
 *
 * A keyword hit is suppressed when the same line contains a preceding negation
 * token (`no`, `not`, `without`, `zero`, `never`) — see hasNegationBefore.
 * v1 limitation: there is no sentence parsing and no cross-line negation, so a
 * negation in an earlier clause of the same line can suppress a genuine
 * signal, and a negation on the previous line does not suppress anything.
 */
const KEYWORD_RISK_RULES = [
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
];
/** Literal secret material anywhere in the plan (signal c). */
const LITERAL_RISK_RULES = [
    { label: 'AKIA access key', re: /AKIA[0-9A-Z]{16}/g },
    { label: 'ghp_ token', re: /ghp_[A-Za-z0-9]{20,}/g },
    { label: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];
/**
 * Path-like token shapes: slash paths, file names with source/data extensions,
 * Dockerfile, and dotenv files. Used both to collect protected-path signals and
 * to mask path tokens out of the keyword scan (so `src/auth/x.ts` reports one
 * path signal instead of also echoing the keyword `auth`).
 */
const PATH_TOKEN_RES = [
    /[A-Za-z0-9_.@~-]+(?:\/[A-Za-z0-9_.@~-]+)+/g,
    /[A-Za-z0-9_-]+\.(?:sql|ya?ml|json|tsx?|jsx?|rb|py|go|rs|toml|env)\b/g,
    /\bDockerfile\b/g,
    /\.env(?:\.[A-Za-z0-9_-]+)?/g,
];
function pathTokenMatches(text) {
    const found = [];
    for (const re of PATH_TOKEN_RES) {
        for (const match of text.matchAll(re)) {
            const start = match.index ?? 0;
            found.push({ token: match[0], start, end: start + match[0].length });
        }
    }
    return found;
}
/** Distinct path-like tokens in the plan text. */
function extractPathTokens(text) {
    return [...new Set(pathTokenMatches(text).map((match) => match.token))];
}
/** Replace path-like tokens with spaces, preserving line numbers for the scan. */
function maskPathTokens(text) {
    const ranges = pathTokenMatches(text)
        .map(({ start, end }) => ({ start, end }))
        .sort((left, right) => left.start - right.start);
    if (ranges.length === 0)
        return text;
    let masked = '';
    let cursor = 0;
    for (const range of ranges) {
        const start = Math.max(range.start, cursor);
        if (start >= range.end)
            continue;
        masked += text.slice(cursor, start) + ' '.repeat(range.end - start);
        cursor = range.end;
    }
    return masked + text.slice(cursor);
}
/** Keep evidence short in the one-line verdict. */
function shortenEvidence(value, max = 80) {
    const trimmed = value.trim();
    if (trimmed.length <= max)
        return trimmed;
    return `…${trimmed.slice(trimmed.length - (max - 1))}`;
}
const NEGATION_PREFIX_RE = /(?:^|[^A-Za-z0-9_])(?:no|not|without|zero|never)\s+/i;
/**
 * §N v1 negation guard: a signal is suppressed when a negation token appears
 * earlier on the SAME line. Deliberately simple — no sentence splitting, no
 * cross-line negation, and a negation from an earlier clause on the line can
 * suppress a genuine signal (documented limitation, see KEYWORD_RISK_RULES).
 */
function hasNegationBefore(line, index) {
    return NEGATION_PREFIX_RE.test(line.slice(0, index));
}
/** 1-based line number of a character offset. */
function lineNumberAt(text, index) {
    let line = 1;
    for (let cursor = 0; cursor < index; cursor += 1) {
        if (text.charCodeAt(cursor) === 10)
            line += 1;
    }
    return line;
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
export function classifyPlanRisk(text) {
    let root;
    try {
        root = parseXmlLite(text);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { level: 'standard', reasons: [], note: `unparsable plan XML (${message}); risk classification skipped` };
    }
    const reasons = [];
    const seen = new Set();
    const addReason = (category, evidence) => {
        const key = `${category}\u0000${evidence}`;
        if (seen.has(key))
            return;
        seen.add(key);
        reasons.push({ category, evidence });
    };
    // Signal (a): declared <file>/<path> values and plain path-like tokens.
    const tokens = new Set();
    for (const node of collect(root, /^(?:file|path)$/)) {
        const value = (node.text ?? '').trim();
        if (value !== '')
            tokens.add(value);
    }
    for (const token of extractPathTokens(text))
        tokens.add(token);
    for (const token of tokens) {
        for (const rule of PATH_RISK_RULES) {
            if (rule.re.test(token))
                addReason(rule.category, shortenEvidence(token));
        }
    }
    // Signal (b): category keywords, with the same-line negation guard. Path
    // tokens are masked so a path signal does not also echo inside as a keyword.
    const maskedLines = maskPathTokens(text).split('\n');
    for (const rule of KEYWORD_RISK_RULES) {
        for (let index = 0; index < maskedLines.length; index += 1) {
            const line = maskedLines[index];
            for (const match of line.matchAll(rule.re)) {
                if (hasNegationBefore(line, match.index ?? 0))
                    continue;
                addReason(rule.category, `keyword "${match[0]}" line ${index + 1}`);
            }
        }
    }
    // Signal (c): literal secret material anywhere in the plan.
    for (const rule of LITERAL_RISK_RULES) {
        for (const match of text.matchAll(rule.re)) {
            addReason('auth_secrets_permissions', `literal ${rule.label} line ${lineNumberAt(text, match.index ?? 0)}`);
        }
    }
    reasons.sort((left, right) => PLAN_RISK_CATEGORIES.indexOf(left.category) - PLAN_RISK_CATEGORIES.indexOf(right.category));
    return { level: reasons.length === 0 ? 'standard' : 'mandatory', reasons };
}

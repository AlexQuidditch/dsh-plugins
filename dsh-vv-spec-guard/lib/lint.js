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
function malformed(verdict, error) {
    verdict.errors.push({ rule: 'well-formed', message: `malformed XML: ${error instanceof Error ? error.message : String(error)}` });
    return verdict;
}
/**
 * Lint one spec.xml against the vv-spec contract.
 *
 * Structural checks (well-formedness, root element, package id) apply to every
 * lifecycle state; content-completeness checks (goals, requirements,
 * acceptance) apply only once the spec is approved or applied, because a draft
 * may legitimately have empty sections mid-interview.
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
    const status = options.status ?? root.attrs.status ?? 'draft';
    if (!STATUSES.has(status)) {
        verdict.errors.push({ rule: 'status', message: `status must be draft|approved|applied, found "${status}"` });
    }
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
    if (status !== 'draft') {
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
    const status = options.status ?? root.attrs.status ?? 'draft';
    if (!STATUSES.has(status)) {
        verdict.errors.push({ rule: 'status', message: `status must be draft|approved|applied, found "${status}"` });
    }
    const tasks = collect(root, TASK_RE);
    const taskIds = new Set();
    if (status !== 'draft' && tasks.length === 0) {
        verdict.errors.push({ rule: 'completeness', message: 'approved/applied plan must have at least one task' });
    }
    for (const task of tasks) {
        if (taskIds.has(task.name))
            verdict.errors.push({ rule: 'identity', message: `duplicate task identity <${task.name}>` });
        taskIds.add(task.name);
        if (status !== 'draft') {
            if (childrenNamed(task, 'title').length === 0)
                verdict.errors.push({ rule: 'completeness', message: `<${task.name}> has no <title>` });
            if (childrenNamed(task, 'acceptance').flatMap((acc) => childrenNamed(acc, 'criterion')).length === 0) {
                verdict.errors.push({ rule: 'completeness', message: `<${task.name}> has no acceptance <criterion>` });
            }
            if (childrenNamed(task, 'verify').flatMap((verify) => childrenNamed(verify, 'command')).length === 0) {
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

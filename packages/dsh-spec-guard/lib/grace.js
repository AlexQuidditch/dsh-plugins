/**
 * Follow-up #2 — GRACE → invariants: turn GRACE from documentation into a VERIFIED
 * system element. GRACE headers (foundation .agents/shared/grace-markup-spec.md) carry
 * machine-checkable contracts:
 *   - START_MODULE_MAP "MUST match the current exports of the file" → checkable.
 *   - START_INVARIANTS import-bans ("NEVER imports from domains/*") → checkable.
 *   -其余 invariants are behavioral guarantees → surfaced as required verification.
 *
 * This module parses GRACE, verifies the structural contracts against the actual code,
 * and classifies the rest so the pipeline can demand executable verification instead of
 * trusting prose. Host-side helper; pure text analysis (no I/O), so the caller supplies
 * the file text (and may supply TS-derived exports/imports for higher fidelity).
 *
 * KEYWORDS: CONCEPT(10): semantic-contract; PATTERN(9): rule-registry-with-baseline-ratchet
 * LINKS: USES_API(10): auditGraceFile → spec_guard_grace; USES_API(9): applyGraceBaseline
 *
 * The GRACE spec (foundation .agents/shared/grace-markup-spec.md) makes specific promises
 * that are machine-checkable, and a real-corpus audit found each of them violated somewhere:
 * START/END pairing (52 unmatched START_CONTRACT, 25 unmatched END_FUNCTION, 113 unmatched
 * START_BLOCK), MODULE_MAP vs the file's surface, COMPLEXITY_SCORE > 7 requiring block
 * markers, and USE_CASES AAG shape. `auditGraceFile` reports all of them as typed findings
 * so the pipeline can gate a NEW violation without demanding a 3000-file cleanup: the
 * baseline file records today's debt and only regressions fail (see applyGraceBaseline).
 */
import ts from 'typescript';
/**
 * Follow-up #2 (factual MODULE_MAP): extract the file's real public surface via the TS
 * checker — file-level exports PLUS public methods of exported classes (GRACE MODULE_MAP
 * lists the class public surface, not only file-level exports). This is the rock-solid
 * replacement for regex export detection. Requires a program built with module resolution
 * (census.createScopeProgram).
 */
export function tsPublicSurface(program, checker, filePath) {
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile)
        return [];
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol)
        return [];
    const names = new Set();
    const isPrivate = (decl) => (ts.getCombinedModifierFlags(decl) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0;
    for (const exp of checker.getExportsOfModule(moduleSymbol)) {
        names.add(exp.name);
        const resolved = (exp.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exp) : exp;
        const decl = resolved.valueDeclaration ?? resolved.declarations?.[0];
        if (!decl || !ts.isClassDeclaration(decl))
            continue;
        const collectMethods = (type) => {
            for (const prop of type.getProperties()) {
                if (prop.name === 'constructor')
                    continue;
                const pd = prop.valueDeclaration ?? prop.declarations?.[0];
                if (!pd || isPrivate(pd))
                    continue;
                if (ts.isMethodDeclaration(pd) || ts.isGetAccessorDeclaration(pd) || ts.isSetAccessorDeclaration(pd)) {
                    names.add(prop.name);
                }
            }
        };
        collectMethods(checker.getDeclaredTypeOfSymbol(resolved));
        collectMethods(checker.getTypeOfSymbolAtLocation(resolved, decl));
    }
    return [...names].sort();
}
/** GRACE section names that may appear as a header. */
const GRACE_SECTIONS = ['MODULE_CONTRACT', 'INVARIANTS', 'RATIONALE', 'CHANGE_SUMMARY', 'MODULE_MAP', 'USE_CASES'];
/** A section header begins a line and is comment-prefixed or bare (legacy `MODULE_MAP:` form). */
const SECTION_HEADER_RE = new RegExp(`^[ \\t]*(?://|/\\*+|\\*|<!--)?[ \\t]*(START_|END_)?(${GRACE_SECTIONS.join('|')})\\b[ \\t]*:?`, 'gm');
/**
 * A legacy section (no END marker) also ends where the header comment ends or where markup
 * resumes — otherwise the block would swallow `<script setup>` code as if it were guarantees.
 */
const SECTION_TERMINATOR_RE = /^[ \t]*(?:-->|\*\/|<\/?script\b|<template\b|<style\b)/m;
/**
 * Locate every GRACE section body, supporting BOTH dialects found in the repo.
 *
 * Canonical: `START_INVARIANTS:` … `END_INVARIANTS` (1896 files).
 * Legacy:    `MODULE_CONTRACT:` / `MODULE_MAP:` with NO end marker (168 .vue files), where a
 *            section simply runs until the next section header. Requiring an end marker made
 *            those files report zero invariants — the same blindness that hid their imports
 *            from the census, and it would silently produce no verification obligations for a
 *            legacy component that a change puts at risk.
 */
function collectGraceSections(text) {
    const headers = [];
    SECTION_HEADER_RE.lastIndex = 0;
    let match;
    while ((match = SECTION_HEADER_RE.exec(text)) !== null) {
        headers.push({
            name: match[2],
            start: match.index,
            end: match.index + match[0].length,
            kind: match[1] === 'END_' ? 'end' : 'begin',
        });
        // A zero-width guard keeps the scan linear on pathological headers.
        if (match[0].length === 0)
            SECTION_HEADER_RE.lastIndex += 1;
    }
    const sections = new Map();
    for (let index = 0; index < headers.length; index += 1) {
        const header = headers[index];
        if (header.kind !== 'begin')
            continue;
        let stop = text.length;
        for (let probe = index + 1; probe < headers.length; probe += 1) {
            const candidate = headers[probe];
            // Either the matching END marker or the next section header terminates the body.
            if (candidate.kind === 'end' || candidate.name !== header.name || candidate.kind === 'begin') {
                stop = candidate.start;
                break;
            }
        }
        // Where the body starts, and where the terminator scan may begin.
        //
        // Three header shapes exist in the repo:
        //   `<!-- START_MODULE_MAP -->`            body starts on the NEXT line
        //   `<!-- START_MODULE_CONTRACT: -->`       same
        //   `<!-- START_MODULE_CONTRACT: PURPOSE: x -->`  body is INLINE on the header line
        // For the inline shape the scan must begin after the line's own closer, otherwise that
        // closer reads as a section terminator and empties the body. Slicing from a mid-line
        // position is what made 11 compact files parse to nothing.
        const lineEndRaw = text.indexOf('\n', header.end);
        const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
        const inline = text.slice(header.end, lineEnd).replace(/(?:-->|\*\/)\s*$/, '').trim();
        const bodyStart = inline === '' ? (lineEndRaw === -1 ? text.length : lineEnd + 1) : header.end;
        let scanFrom = inline === '' ? bodyStart : lineEnd;
        if (scanFrom < stop) {
            const terminator = SECTION_TERMINATOR_RE.exec(text.slice(scanFrom, stop));
            if (terminator !== null)
                stop = scanFrom + terminator.index;
        }
        const body = text.slice(bodyStart, stop);
        if (sections.has(header.name))
            sections.set(header.name, `${sections.get(header.name)}\n${body}`);
        else
            sections.set(header.name, body);
    }
    return sections;
}
/** Strip leading comment markers / list dashes from a GRACE line. */
function cleanLine(line) {
    return line.replace(/^\s*\/\/\s?/, '').replace(/^\s*\/\*\*?\s?/, '').replace(/^\s*\*\s?/, '').trim();
}
const BULLET_RE = /^\s*(?:\/\/\s*)?(?:\/\*\s*)?[-*]\s+/;
/**
 * Split a GRACE section body into ONE entry per invariant.
 *
 * A hard guarantee is routinely written as a bullet that wraps over several lines (533 of
 * 718 blocks in foundation do). Splitting on newlines alone turns one wrapped sentence into
 * several fragments, which then became separate verification obligations — the live
 * spec_guard_invariant_tests run produced IV-001 ending mid-sentence with "...keeps", a
 * property no test could ever discharge. So a line that does not open a new bullet
 * continues the current entry, and a new bullet starts the next one.
 */
function splitEntries(body) {
    const entries = [];
    let current = [];
    let startedWithBullet = false;
    const flush = () => {
        const joined = current.join(' ').replace(/\s+/g, ' ').trim();
        if (joined !== '')
            entries.push(joined);
        current = [];
    };
    for (const raw of body.split('\n')) {
        if (raw.trim() === '')
            continue;
        const isBullet = BULLET_RE.test(raw);
        if (isBullet) {
            flush();
            startedWithBullet = true;
            current.push(cleanLine(raw));
            continue;
        }
        // A non-bullet line: continuation of a wrapped bullet, or (in a section written without
        // bullets) one whole invariant per line.
        if (startedWithBullet)
            current.push(cleanLine(raw));
        else {
            flush();
            current.push(cleanLine(raw));
            flush();
        }
    }
    flush();
    return entries.filter((entry) => entry !== '');
}
/** Extract the GRACE contract sections from a source file's text. */
export function parseGrace(text) {
    const sections = collectGraceSections(text);
    const contractText = sections.get('MODULE_CONTRACT') ?? '';
    const field = (name) => {
        const m = new RegExp(`^[ \\t]*(?://|/\\*+|\\*|<!--)?[ \\t]*${name}:\\s*([^\\n]*)`, 'im').exec(contractText);
        if (!m)
            return '';
        // An inline field keeps the comment closer (`-->`, `*/`) on its line; it is markup, not value.
        return cleanLine(m[1].replace(/\s*(?:-->|\*\/)\s*$/, ''));
    };
    const moduleMap = splitEntries(sections.get('MODULE_MAP') ?? '')
        .map((line) => {
        // Canonical: `TYPE [weight] [desc] => name`. Legacy (24 files): `name - description`.
        const arrow = /=>\s*([A-Za-z0-9_$]+)\s*$/.exec(line);
        if (arrow)
            return arrow[1];
        const dash = /^\s*([A-Za-z0-9_$]+)\s+-\s+\S/.exec(line);
        return dash ? dash[1] : '';
    })
        .filter((name) => name !== '');
    return {
        purpose: field('PURPOSE'),
        depends: field('DEPENDS'),
        invariants: splitEntries(sections.get('INVARIANTS') ?? ''),
        moduleMap,
    };
}
/** Best-effort file-level export detection from source text (caller may override with
 * TS API for higher fidelity). NOTE: GRACE MODULE_MAP in practice also lists class public
 * methods, which are not file-level exports; moduleMap comparison is therefore informational
 * (file-level only) — full class-surface fidelity requires the TS API. The reliably verified
 * GRACE elements are the import-ban invariants and the at-risk behavioral invariant surface. */
export function detectExports(text) {
    const names = new Set();
    const decl = /export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|function|const|let|var|type|interface|enum)\s+([A-Za-z0-9_$]+)/g;
    let m;
    while ((m = decl.exec(text)) !== null)
        names.add(m[1]);
    const list = /export\s*\{([^}]+)\}/g;
    while ((m = list.exec(text)) !== null) {
        for (const part of m[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/).pop()?.trim();
            if (name && /^[A-Za-z0-9_$]+$/.test(name))
                names.add(name);
        }
    }
    return [...names].sort();
}
/** Import specifiers from source text. */
export function detectImports(text) {
    const specs = new Set();
    const re = /import\s+(?:type\s+)?(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(text)) !== null)
        specs.add(m[1]);
    return [...specs].sort();
}
/** Classify an invariant line: import-ban / reference-ban (structural) vs behavioral. */
export function classifyInvariant(invariant) {
    if (/\b(never|must not|does not|no)\b[^.]*\bimport/i.test(invariant))
        return 'import-ban';
    if (/\b(never|must not|does not|no)\b[^.]*\b(quer\w+|referenc\w+|touch\w*|read\w*|writ\w+)\b/i.test(invariant))
        return 'reference-ban';
    return 'behavioral';
}
/** Glob → RegExp for import-ban patterns like "domains/*" or "@foundation/platform". */
function globToRegex(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
}
/**
 * Verify the structural GRACE contracts against the actual code and classify the rest.
 * actualExports/actualImports may be supplied from the TS API for higher fidelity;
 * otherwise they are detected from the text.
 */
export function checkGrace(text, actualExports, actualImports) {
    const grace = parseGrace(text);
    const hasGrace = grace.invariants.length > 0 || grace.moduleMap.length > 0 || grace.purpose !== '';
    const exports = actualExports ?? detectExports(text);
    const imports = actualImports ?? detectImports(text);
    let moduleMap = null;
    if (grace.moduleMap.length > 0) {
        const declared = [...new Set(grace.moduleMap)].sort();
        const actual = [...new Set(exports)].sort();
        const declaredSet = new Set(declared);
        const actualSet = new Set(actual);
        moduleMap = {
            declared,
            actual,
            missing: declared.filter((name) => !actualSet.has(name)),
            extra: actual.filter((name) => !declaredSet.has(name)),
        };
    }
    const importBanViolations = [];
    const structuralInvariants = [];
    const behavioralInvariants = [];
    for (const invariant of grace.invariants) {
        const cls = classifyInvariant(invariant);
        if (cls === 'behavioral') {
            behavioralInvariants.push(invariant);
            continue;
        }
        structuralInvariants.push(invariant);
        if (cls === 'import-ban') {
            const fromMatch = /\bfrom\s+([^\s;.,)]+)/i.exec(invariant);
            if (fromMatch) {
                const pattern = fromMatch[1].replace(/['"`]/g, '');
                const re = globToRegex(pattern);
                const matchingImports = imports.filter((spec) => re.test(spec));
                if (matchingImports.length > 0) {
                    importBanViolations.push({ invariant, pattern, matchingImports });
                }
            }
        }
    }
    return { hasGrace, moduleMap, importBanViolations, structuralInvariants, behavioralInvariants };
}
/** Invariants that mention any of the changed symbols — the at-risk set for a change. */
export function atRiskInvariants(files, changedSymbols) {
    const lowered = changedSymbols.map((symbol) => symbol.toLowerCase());
    const out = [];
    for (const file of files) {
        const grace = parseGrace(file.text);
        for (const invariant of grace.invariants) {
            const lower = invariant.toLowerCase();
            if (lowered.some((symbol) => symbol.length > 2 && lower.includes(symbol))) {
                out.push({ path: file.path, invariant, class: classifyInvariant(invariant) });
            }
        }
    }
    return out;
}
/**
 * A property-test scaffold for a behavioral invariant. This is an OBLIGATION + starting
 * point, NOT an auto-generated correct test: the natural-language guarantee must be turned
 * into an actual assertion by the agent/human. The scaffold is marked TODO and tracked in
 * the invariant-verification ledger; plan-close blocks on pending obligations, so a
 * behavioral invariant cannot be silently ignored.
 */
export function propertyTestScaffold(invariant, modulePath, id) {
    const oneLine = invariant.replace(/\s+/g, ' ').trim();
    return [
        `import { describe, it } from 'vitest'`,
        `// GRACE invariant obligation ${id} — module: ${modulePath}`,
        `// Property: ${oneLine}`,
        `describe('GRACE invariant ${id}', () => {`,
        `  it.todo(${JSON.stringify(oneLine)})`,
        `  // TODO: discharge this obligation — Arrange (module/state), Act (exercise the`,
        `  // behavior), Assert (the guarantee holds). Then mark ${id} verified in`,
        `  // invariant-verification.xml with the test path + evidence.`,
        `})`,
        ``,
    ].join('\n');
}
/** Turn at-risk invariants into verification obligations (scaffolds for behavioral ones). */
export function invariantObligations(risky) {
    return risky.map((item, index) => {
        const id = `IV-${String(index + 1).padStart(3, '0')}`;
        const auto = item.class === 'import-ban';
        return {
            id,
            invariant: item.invariant,
            module: item.path,
            class: item.class,
            checkType: auto ? 'import-ban-auto' : 'behavioral-test',
            scaffold: auto ? null : propertyTestScaffold(item.invariant, item.path, id),
        };
    });
}
/** Parse the invariant-verification ledger. */
export function parseInvariantVerification(text) {
    const entries = [];
    const re = /<(IV-\d+)>([\s\S]*?)<\/\1>/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const body = m[2];
        const field = (name) => {
            const fm = new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`).exec(body);
            return fm ? fm[1].trim() : '';
        };
        entries.push({
            id: m[1],
            invariant: field('invariant'),
            module: field('module'),
            testPath: field('test-path'),
            status: field('status'),
            evidence: field('evidence'),
        });
    }
    return entries;
}
/** Discharged statuses; anything else is a pending obligation. */
export const INVARIANT_DISCHARGED = new Set(['verified', 'waived']);
/** A bullet that bundles several guarantees, measured by sentence terminators. */
function countSentences(text) {
    const matches = text.match(/[.!?](?:\s|$)/g);
    return matches === null ? 0 : matches.length;
}
/**
 * Everything that may legally precede a marker on its line: indentation plus line/block
 * comment decoration. A marker line in the corpus looks like `// START_BLOCK_X: [desc]`,
 * ` * START_BLOCK_X`, `<!-- START_X -->`, `/* START_BLOCK_MOTION: ...` or, inside an HTML
 * comment, a bare `START_CONTRACT: name`.
 *
 * A token that has prose before it on the same line is a MENTION, not a declaration:
 * `//   PREV_CHANGE_SUMMARY: ... archiveNode's START_BLOCK_ARCHIVE_NODE_ENROLLMENT_GUARD
 * third arm was ...` used to count as an unpaired START_BLOCK and turned a correctly paired
 * file into a false violation.
 */
const MARKER_DECORATION_RE = /^[ \t]*(?:(?:\/\/+|\/\*+|\*+|<!--)[ \t]?)*$/;
/** Marker token; the trailing `_<name>` is the canonical form. */
const MARKER_TOKEN_RE = /\b(START|END)_(CONTRACT|FUNCTION|BLOCK)(_[A-Za-z0-9_$]+)?/g;
const MARKER_IDENTIFIER_RE = /^[A-Za-z0-9_$]+$/;
/** A trailing comment closer is markup, not part of a description. */
function stripMarkerCloser(text) {
    return text.replace(/[ \t]*(?:-->|\*\/)[ \t]*$/, '');
}
/**
 * Parse one line as a marker DECLARATION.
 *
 * Supported shapes (all present in foundation):
 *  - canonical: `START_BLOCK_X: [desc]`, `START_FUNCTION_X`, `END_FUNCTION_X`
 *  - contract: `START_CONTRACT: name`, and the name-less `END_CONTRACT` dialect
 *  - colon form: `START_BLOCK: NAME`, `END_BLOCK: NAME`, `END_FUNCTION: NAME`; when the text
 *    after the colon is a sentence (`START_BLOCK: Inactive student blocked state`) it is a
 *    description and therefore an anonymous marker
 *  - closer form: `<!-- START_X -->`, and a block-comment line that only wraps a marker
 *
 * Anything else — a token glued to more identifier text (`START_CONTRACTs`), a token followed
 * by prose on the same line, or a token whose line starts with prose — is a mention.
 */
function markerDeclarationOnLine(line) {
    MARKER_TOKEN_RE.lastIndex = 0;
    let match;
    while ((match = MARKER_TOKEN_RE.exec(line)) !== null) {
        if (!MARKER_DECORATION_RE.test(line.slice(0, match.index)))
            continue;
        const kind = match[2];
        const direction = match[1] === 'START' ? 'start' : 'end';
        let name = '';
        let rest;
        if (match[3] !== undefined) {
            name = match[3].slice(1);
            rest = line.slice(match.index + match[0].length);
        }
        else {
            rest = line.slice(match.index + match[0].length);
            const colon = /^[ \t]*:[ \t]*/.exec(rest);
            if (colon !== null) {
                const body = stripMarkerCloser(rest.slice(colon[0].length)).trim();
                rest = '';
                if (kind === 'CONTRACT' || (kind === 'FUNCTION' && MARKER_IDENTIFIER_RE.test(body))) {
                    // For a contract the colon is the canonical namer; for a function the colon form
                    // (`END_FUNCTION: name`) is a dialect that names the same wrapper.
                    const named = /^([A-Za-z0-9_$]+)([ \t].*)?$/.exec(body);
                    if (named !== null) {
                        name = named[1];
                        rest = named[2] ?? '';
                    }
                    else {
                        rest = body === '' ? '' : `: ${body}`;
                    }
                }
                else if (kind === 'BLOCK' && MARKER_IDENTIFIER_RE.test(body)) {
                    // `START_BLOCK: FAB_RENDER` names the block; a sentence after the colon does not.
                    name = body;
                }
                else {
                    // A description-only marker: it declares a markup region with no symbolic name.
                    rest = body === '' ? '' : `: ${body}`;
                }
            }
        }
        // After the marker (and optional name) only end-of-line, a `: description`, or a comment
        // closer may remain. A wrapped sentence continues past it and is therefore a mention.
        const leftover = stripMarkerCloser(rest).trim();
        if (leftover !== '' && !leftover.startsWith(':'))
            continue;
        return { kind, direction, name, line: 0 };
    }
    return null;
}
/**
 * Pair START/END markers by declaration order.
 *
 * Pairing rules, in priority order:
 *  1. a named END closes the nearest open marker of the same kind and name;
 *  2. a NAMED end with no same-named open closes the nearest name-less open of its kind —
 *     this is the `START_CONTRACT:` … `END_CONTRACT: name` dialect used in actor-owner.ts and
 *     the mastra tool files;
 *  3. a NAME-LESS end (`END_CONTRACT` with no `: name`) closes the nearest open marker of its
 *     kind — the task's "END_CONTRACT must pair with the nearest still-unclosed START" case.
 *
 * Pairing by stack (not by multiset) is what makes a repeated name in one file resolvable:
 * two `START_BLOCK_A`/`END_BLOCK_A` pairs close in order instead of all opens being compared
 * against all closes.
 */
function scanMarkers(text) {
    const lines = text.split('\n');
    const stack = [];
    const orphanCloses = [];
    const closedContracts = [];
    let offset = 0;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const declaration = markerDeclarationOnLine(line);
        const lineStart = offset;
        offset += line.length + 1;
        if (declaration === null)
            continue;
        const entry = { ...declaration, line: index + 1, lineStart, lineEnd: offset };
        if (entry.direction === 'start') {
            stack.push(entry);
            continue;
        }
        let hit = -1;
        if (entry.name !== '') {
            for (let probe = stack.length - 1; probe >= 0; probe -= 1) {
                if (stack[probe].kind === entry.kind && stack[probe].name === entry.name) {
                    hit = probe;
                    break;
                }
            }
            if (hit === -1) {
                for (let probe = stack.length - 1; probe >= 0; probe -= 1) {
                    if (stack[probe].kind === entry.kind && stack[probe].name === '') {
                        hit = probe;
                        break;
                    }
                }
            }
        }
        else {
            for (let probe = stack.length - 1; probe >= 0; probe -= 1) {
                if (stack[probe].kind === entry.kind) {
                    hit = probe;
                    break;
                }
            }
        }
        if (hit === -1) {
            orphanCloses.push(entry);
            continue;
        }
        const [open] = stack.splice(hit, 1);
        if (open.kind === 'CONTRACT')
            closedContracts.push({ open, close: entry });
    }
    return { unclosed: stack, orphanCloses, closedContracts };
}
/** Group unpaired markers by kind + name so one symbol yields one finding. */
function groupUnpaired(markers) {
    const grouped = new Map();
    for (const marker of markers) {
        const key = `${marker.kind}|${marker.name}`;
        const existing = grouped.get(key);
        if (existing === undefined)
            grouped.set(key, { kind: marker.kind, name: marker.name, count: 1, line: marker.line });
        else
            existing.count += 1;
    }
    return [...grouped.values()];
}
/**
 * Function/method declarations with their owning class, from the TS AST.
 *
 * `complexity-missing|<name>` collapsed two same-named methods in different classes of one
 * file (abilities/education-permission-resolvers.ts, rbac/platform-owned-permission-resolvers.ts:
 * onModuleInit, supports, registerSelf). A newly added third `onModuleInit` then inherited the
 * baselined key and was silently accepted, so the key must carry the declaring context.
 */
function declarationSites(path, text) {
    if (!/\.(?:[cm]?[jt]sx?)$/.test(path))
        return [];
    const scriptKind = /\.tsx$/.test(path)
        ? ts.ScriptKind.TSX
        : /\.jsx$/.test(path)
            ? ts.ScriptKind.JSX
            : /\.(?:mjs|cjs|js)$/.test(path)
                ? ts.ScriptKind.JS
                : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind);
    const sites = [];
    const visit = (node, context) => {
        let childContext = context;
        if (ts.isClassLike(node) && node.name !== undefined)
            childContext = node.name.text;
        if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
            sites.push({
                name: node.name.text,
                pos: node.getStart(sourceFile),
                context,
                bodyStart: node.body.getStart(sourceFile),
                bodyEnd: node.body.getEnd(),
            });
        }
        else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body !== undefined) {
            sites.push({
                name: node.name.text,
                pos: node.getStart(sourceFile),
                context,
                bodyStart: node.body.getStart(sourceFile),
                bodyEnd: node.body.getEnd(),
            });
        }
        else if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined
            && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
            const body = node.initializer.body;
            sites.push({
                name: node.name.text,
                pos: node.getStart(sourceFile),
                context,
                bodyStart: body.getStart(sourceFile),
                bodyEnd: body.getEnd(),
            });
        }
        else if (ts.isVariableStatement(node)) {
            for (const declaration of node.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined
                    && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
                    const body = declaration.initializer.body;
                    sites.push({
                        name: declaration.name.text,
                        pos: declaration.getStart(sourceFile),
                        context,
                        bodyStart: body.getStart(sourceFile),
                        bodyEnd: body.getEnd(),
                    });
                }
            }
        }
        ts.forEachChild(node, (child) => visit(child, childContext));
    };
    visit(sourceFile, '');
    return sites;
}
/** Owning class of the declaration that follows a contract; '' for a top-level function. */
function findDeclaringSite(sites, contractStart, name) {
    let best;
    for (const site of sites) {
        if (site.name !== name || site.pos <= contractStart)
            continue;
        if (best === undefined || site.pos < best.pos)
            best = site;
    }
    return best;
}
/**
 * Audit one file against every machine-checkable GRACE promise and return typed findings.
 *
 * This is the single entry point the host tool, the baseline ratchet and the tests share.
 * It is deliberately pure text analysis plus an optional TS-derived `actualSurface`, so the
 * lint engine keeps its zero-dependency posture while the host can pass factual exports.
 */
export function auditGraceFile(path, text, actualSurface) {
    const findings = [];
    const grace = parseGrace(text);
    const hasGrace = grace.invariants.length > 0 || grace.moduleMap.length > 0 || grace.purpose !== '';
    if (!hasGrace)
        return { path, hasGrace: false, findings: [], counts: {} };
    // Pair only DECLARATIONS (a marker alone on a comment line), never prose mentions.
    const markers = scanMarkers(text);
    for (const group of groupUnpaired(markers.unclosed)) {
        const display = group.name === '' ? '(anonymous)' : group.name;
        findings.push({
            rule: 'unpaired-marker',
            key: `unpaired-marker|${group.kind}|${display}|open`,
            symbol: display,
            displayLine: group.line,
            severity: 'error',
            message: `START_${group.kind}${group.name === '' ? '' : `_${group.name}`} has no matching END (${group.count} unterminated declaration${group.count === 1 ? '' : 's'})`,
        });
    }
    for (const group of groupUnpaired(markers.orphanCloses)) {
        const display = group.name === '' ? '(anonymous)' : group.name;
        findings.push({
            rule: 'unpaired-marker',
            key: `unpaired-marker|${group.kind}|${display}|close`,
            symbol: display,
            displayLine: group.line,
            severity: 'error',
            message: `END_${group.kind}${group.name === '' ? '' : `_${group.name}`} has no matching START (${group.count} orphan close${group.count === 1 ? '' : 's'})`,
        });
    }
    if (actualSurface !== undefined) {
        // MODULE_MAP documents the file's surface. It legitimately includes non-exported internal
        // symbols, so drift is measured against the surface when supplied and only reported for
        // names absent from BOTH the surface and the CODE. The code region must exclude the GRACE
        // header itself: searching the raw text let a name satisfy its own check through the map
        // entry that declares it (a self-fulfilling match), which silently disabled the rule.
        const surface = new Set(actualSurface);
        const codeOnly = text.replace(/^(?:[ \t]*(?:\/\/|\*|<!--|\/\*)[ \t]?.*)$/gm, '');
        const missing = grace.moduleMap.filter((name) => !surface.has(name) && !new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(codeOnly));
        for (const name of missing) {
            findings.push({
                rule: 'module-map-drift',
                key: `module-map-drift|${name}`,
                symbol: name,
                severity: 'warn',
                message: `MODULE_MAP lists ${name}, but no exported declaration and no mention of it remain in the file`,
            });
        }
    }
    if (grace.moduleMap.length === 0 && actualSurface !== undefined && actualSurface.length > 0) {
        findings.push({
            rule: 'module-map-missing',
            key: 'module-map-missing',
            symbol: path,
            severity: 'warn',
            message: `file exports ${actualSurface.length} symbol(s) but has no MODULE_MAP, so its surface cannot be verified`,
        });
    }
    // COMPLEXITY_SCORE lives in a function contract; a function contract without it makes the
    // "score above 7 ⇒ blocks are mandatory" rule silently unenforceable.
    //
    // Scope decision (grace-markup-spec.md): "COMPLEXITY_SCORE applies only to functions. A
    // score above 7 makes block segmentation mandatory." (line 131) and "The fields and their
    // order are in <template>." (line 132) make the score a required field of a function
    // contract. The requirement to WRITE a contract is stated for exported functions (line
    // 127), but the spec never exempts a function contract that already exists, and it does
    // not define an exported-only scope for the score. The rule is therefore kept as written:
    // every START_FUNCTION-wrapped contract is checked, including non-exported helpers and
    // lifecycle methods. Narrowing it to exports would invent a rule the spec does not state.
    //
    // The contract span comes from the same declaration pairing as `unpaired-marker`, so a
    // contract closed by the name-less `END_CONTRACT` dialect is checked too. The finding key
    // carries the declaring class because two same-named methods in one file are two distinct
    // functions; the bare name let a new method inherit a baselined key.
    const sites = declarationSites(path, text);
    let contractsWithScore = 0;
    let contractsHighScore = 0;
    let contractsHighWithoutBlocks = 0;
    for (const { open, close } of markers.closedContracts) {
        const name = open.name;
        if (name === '')
            continue;
        const escaped = name.replace(/\$/g, '\\$');
        const isFunction = new RegExp(`START_FUNCTION_${escaped}\\b`).test(text);
        if (!isFunction)
            continue;
        const body = text.slice(open.lineEnd, close.lineStart);
        // Both spellings occur in the corpus: the template writes `COMPLEXITY_SCORE: 6`, the
        // legacy headers write `COMPLEXITY_SCORE: [3]`. Reading only the bare number made every
        // bracketed score invisible and reported the contract as missing its score.
        const score = /COMPLEXITY_SCORE:\s*\[?\s*(\d+)/.exec(body);
        const declaringSite = findDeclaringSite(sites, open.lineStart, name);
        const context = declaringSite === undefined || declaringSite.context === ''
            ? name
            : `${declaringSite.context}#${name}`;
        if (!score) {
            findings.push({
                rule: 'complexity-missing',
                key: `complexity-missing|${context}`,
                symbol: name,
                displayLine: open.line,
                severity: 'warn',
                message: `function contract ${context} has no COMPLEXITY_SCORE, so the mandatory-block rule cannot be evaluated`,
            });
            continue;
        }
        contractsWithScore += 1;
        if (Number(score[1]) > 7) {
            contractsHighScore += 1;
            // The spec ties blocks to THE FUNCTION: "If COMPLEXITY_SCORE is above 7, put the
            // function body into blocks." A file that segments some other function says nothing
            // about this body, so the check is scoped to the declaration's body. Both marker
            // spellings count: `START_BLOCK_<NAME>` and the colon dialect `START_BLOCK: <desc>`.
            // No AST site means a non-TS file (.vue): fall back to the file scope there.
            const blocksInBody = declaringSite === undefined
                ? /START_BLOCK(?:_[A-Za-z0-9_$]+|\s*:)/.test(text)
                : /START_BLOCK(?:_[A-Za-z0-9_$]+|\s*:)/.test(text.slice(declaringSite.bodyStart, declaringSite.bodyEnd));
            if (!blocksInBody) {
                contractsHighWithoutBlocks += 1;
                findings.push({
                    rule: 'complexity-blocks',
                    key: `complexity-blocks|${context}`,
                    symbol: name,
                    displayLine: open.line,
                    severity: 'error',
                    message: `function ${context} declares COMPLEXITY_SCORE ${score[1]} (>7) but ${declaringSite === undefined ? 'its file' : 'its body'} has no START_BLOCK markers, which the spec makes mandatory`,
                });
            }
        }
    }
    // USE_CASES must be AAG: at least two `->` steps. Test files legitimately write prose
    // there, so the rule is applied to production files only.
    const isTestFile = /(?:^|\/)__tests__\//.test(path) || /\.(?:test|spec)\.[jt]sx?$/.test(path);
    const useCases = collectGraceSections(text).get('USE_CASES') ?? '';
    if (!isTestFile && useCases !== '') {
        for (const entry of splitEntries(useCases)) {
            const arrows = (entry.match(/->/g) ?? []).length;
            if (arrows >= 2)
                continue;
            findings.push({
                rule: 'use-case-shape',
                key: `use-case-shape|${entry.slice(0, 60)}`,
                symbol: entry.slice(0, 60),
                severity: 'warn',
                message: `USE_CASES entry is not AAG (needs Actor -> Action -> Goal): ${entry.slice(0, 100)}`,
            });
        }
    }
    // One bundled bullet = several guarantees behind one obligation; no single test can
    // discharge it, so it is surfaced rather than silently counted as one fulfilled item.
    // The measure is SENTENCE COUNT, not length: a 457-character bullet holding 18 sentences
    // is clearly several rules, while a long single sentence is one rule told carefully.
    for (const invariant of grace.invariants) {
        const sentences = countSentences(invariant);
        if (sentences >= 3) {
            findings.push({
                rule: 'invariant-multi-rule',
                key: `invariant-multi-rule|${invariant.slice(0, 60)}`,
                symbol: invariant.slice(0, 60),
                severity: 'warn',
                message: `invariant bundles ${sentences} sentences in one obligation; split it so a single test can discharge it`,
            });
        }
    }
    const counts = {};
    for (const finding of findings)
        counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;
    return { path, hasGrace: true, findings, counts };
}
/* -------------------------------------------------------------------------- */
/* Baseline ratchet: gate NEW violations without freezing the repo            */
/* -------------------------------------------------------------------------- */
/**
 * Baseline format version.
 *
 * v2 carries the declaring context in `complexity-missing` keys (`Class#method`) and pairs
 * markers as declarations. A v1 key set cannot be trusted against v2 findings: the old keys
 * either never reproduce (prose false positives) or collapse same-named methods. The tool
 * therefore refuses a v1 baseline and demands one explicit re-accept.
 */
export const GRACE_BASELINE_VERSION = 2;
/**
 * Split audit findings into regressions and accepted debt.
 *
 * A corpus this large cannot be fixed in one change, and a gate that fails on all 3000
 * existing violations gets switched off within a day. The baseline records today's keys;
 * anything NOT in it is a regression and fails.
 *
 * Two deliberate asymmetries:
 *  - A regression is NEVER auto-accepted. The returned baseline only PRUNES keys that no
 *    longer reproduce (the ratchet tightens); adding a new key is an explicit act
 *    (`graceBaselineFromAudits`, behind the tool's accept mode), otherwise a gate would
 *    silently bless every new violation on its first run.
 *  - Pruning is automatic, so debt cannot be re-introduced later without failing again.
 */
export function applyGraceBaseline(result, baseline, repoRelativePath) {
    const known = new Set(baseline.files[repoRelativePath] ?? []);
    const regressions = result.findings.filter((finding) => !known.has(finding.key));
    const accepted = result.findings.filter((finding) => known.has(finding.key));
    const stillPresent = [...new Set(accepted.map((finding) => finding.key))].sort();
    const files = { ...baseline.files };
    if (stillPresent.length > 0)
        files[repoRelativePath] = stillPresent;
    else
        delete files[repoRelativePath];
    return { regressions, accepted, baseline: { version: GRACE_BASELINE_VERSION, files } };
}
/**
 * Build the baseline entry for a file from its current audit — the EXPLICIT accept step.
 * Used by the tool's accept mode so a whole-corpus run can record today's debt in one go;
 * never called on the gating path.
 */
export function graceBaselineFromAudits(results) {
    const files = {};
    for (const result of results) {
        const keys = [...new Set(result.findings.map((finding) => finding.key))].sort();
        if (keys.length > 0)
            files[result.path] = keys;
    }
    return { version: GRACE_BASELINE_VERSION, files };
}
/** Serialize a baseline deterministically (sorted files, sorted keys, trailing newline). */
export function serializeGraceBaseline(baseline) {
    const files = {};
    for (const path of Object.keys(baseline.files).sort()) {
        const keys = [...new Set(baseline.files[path])].sort();
        if (keys.length > 0)
            files[path] = keys;
    }
    return `${JSON.stringify({ version: GRACE_BASELINE_VERSION, files }, null, 2)}\n`;
}
/** Parse a baseline file, tolerating absence (empty baseline = everything is a regression). */
export function parseGraceBaseline(text) {
    try {
        const parsed = JSON.parse(text);
        const version = parsed.version === GRACE_BASELINE_VERSION ? GRACE_BASELINE_VERSION : 1;
        const files = {};
        for (const [path, keys] of Object.entries(parsed.files ?? {})) {
            if (Array.isArray(keys))
                files[path] = keys.filter((key) => typeof key === 'string');
        }
        return { version, files };
    }
    catch {
        return { version: GRACE_BASELINE_VERSION, files: {} };
    }
}
/* -------------------------------------------------------------------------- */
/* Legacy dialect: detect and normalize on touch                               */
/* -------------------------------------------------------------------------- */
/** Whether a file uses the legacy (no START_/END_) GRACE header dialect. */
export function isLegacyGraceDialect(text) {
    const hasLegacy = /^[ \t]*(?:\/\/|\*|<!--)?[ \t]*MODULE_CONTRACT[ \t]*:/m.test(text);
    const hasCanonical = /START_MODULE_CONTRACT\b/.test(text);
    return hasLegacy && !hasCanonical;
}
/**
 * Rewrite a legacy header into the canonical dialect, WITHOUT touching any other line.
 *
 * The legacy dialect is not dead: 306 files still use it and 120 of them were edited in the
 * last 30 days, so it is being WRITTEN today. A mass migration of 306 files is a large risky
 * edit for zero algorithmic gain (the parser reads both), so the policy is "normalize on
 * touch": whenever a task already modifies such a file, it leaves with canonical markers.
 * This function does exactly that and is idempotent for files already canonical.
 *
 * It only inserts/replaces MARKER lines; every content line keeps its text and position, so a
 * diff review sees markers appear and nothing else move.
 */
export function normalizeLegacyGraceHeader(text) {
    if (!isLegacyGraceDialect(text))
        return { text, changed: false };
    const lines = text.split('\n');
    // Discover the comment prefix and section order from the file itself.
    const sections = new Set();
    let prefix = '//';
    for (const line of lines) {
        const header = /^([ \t]*(?:\/\/|\*|<!--)?[ \t]*)(MODULE_CONTRACT|MODULE_MAP|INVARIANTS|RATIONALE|CHANGE_SUMMARY|USE_CASES)[ \t]*:/.exec(line);
        if (!header)
            continue;
        sections.add(header[2]);
        const lead = header[1].trimStart();
        if (lead.startsWith('*'))
            prefix = '*';
        else if (lead.startsWith('<!--'))
            prefix = '<!--';
        else if (lead.startsWith('//'))
            prefix = '//';
    }
    if (sections.size === 0)
        return { text, changed: false };
    const out = [];
    const emitted = new Set();
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const header = /^([ \t]*(?:\/\/|\*|<!--)?[ \t]*)(MODULE_CONTRACT|MODULE_MAP|INVARIANTS|RATIONALE|CHANGE_SUMMARY|USE_CASES)[ \t]*:(.*)$/.exec(line);
        if (!header) {
            out.push(line);
            continue;
        }
        const [, lead, name, inline] = header;
        // Keep the file's own comment style and the header's own indentation: a legacy header
        // written as ` MODULE_MAP:` (no marker) must become `* START_MODULE_MAP`, not a bare
        // marker, otherwise the rewrite silently drops out of the comment block.
        const indent = /^[ \t]*/.exec(lead)?.[0] ?? '';
        const markerLead = prefix === '<!--' ? indent : `${indent}${prefix} `;
        const inlineBody = inline.replace(/\s*(?:-->|\*\/)\s*$/, '').trim();
        out.push(`${markerLead}START_${name}${inlineBody === '' ? '' : `: ${inlineBody}`}`);
        // Find where this legacy section ends: the next GRACE header, a genuinely foreign section
        // header, the end of the comment, or the markup. 
        //
        // Two traps, both hit on the real corpus:
        //  - A generic `[A-Z_]+:` match ends the section after its FIRST line, because plain
        //    contract FIELDS (PURPOSE, SCOPE, INPUT, OUTPUT) are upper-case too.
        //  - KEYWORDS_MODULE / LINKS_TO_MODULE / LINKS_TO_SPECIFICATION look like headers but are
        //    contract FIELDS (the GRACE spec calls them KEYWORDS and LINKS); treating them as
        //    terminators split a contract in half and left them outside their own section.
        let end = lines.length;
        for (let probe = index + 1; probe < lines.length; probe += 1) {
            if (/^[ \t]*(?:\/\/|\*|<!--)?[ \t]*(?:MODULE_CONTRACT|MODULE_MAP|INVARIANTS|RATIONALE|CHANGE_SUMMARY|USE_CASES)[ \t]*:/.test(lines[probe])) {
                end = probe;
                break;
            }
            if (/^[ \t]*(?:\/\/|\*|<!--)?[ \t]*(?:KEY_USE_CASES|NOTES|TODO|REVIEW_NOTES)[ \t]*:/.test(lines[probe])) {
                end = probe;
                break;
            }
            if (/^[ \t]*(?:-->|\*\/|<\/?script\b|<template\b|<style\b)/.test(lines[probe])) {
                end = probe;
                break;
            }
        }
        for (let probe = index + 1; probe < end; probe += 1)
            out.push(lines[probe]);
        out.push(prefix === '<!--' ? `${indent}<!-- END_${name} -->` : `${indent}${prefix} END_${name}`);
        emitted.add(name);
        index = end - 1;
    }
    return { text: out.join('\n'), changed: emitted.size > 0 };
}

/**
 * ESLint adapter for the GRACE engine.
 *
 * The plugin is deliberately thin: every rule calls `auditGraceFile` for the current
 * `SourceCode` and reports the findings of its own rule. The audit result is cached per
 * SourceCode object so N rules on one file cost one parse, not N. Rules never reimplement
 * pairing or scoring logic, so editor diagnostics and the CLI cannot drift.
 */
import { relative } from 'node:path';
import { auditGraceFile } from './grace.js';
const auditCache = new WeakMap();
function sourceCodeOf(context) {
    if (context.sourceCode !== undefined)
        return context.sourceCode;
    if (context.getSourceCode !== undefined)
        return context.getSourceCode();
    throw new Error('[grace] ESLint context has no SourceCode');
}
function filenameOf(context) {
    const name = context.filename ?? context.getFilename?.() ?? 'file.ts';
    return name.startsWith('<') ? name : relative(process.cwd(), name);
}
function auditFor(context) {
    const sourceCode = sourceCodeOf(context);
    const cached = auditCache.get(sourceCode);
    if (cached !== undefined)
        return cached;
    const result = auditGraceFile(filenameOf(context), sourceCode.text);
    auditCache.set(sourceCode, result);
    return result;
}
function ruleFor(rule, description) {
    return {
        meta: {
            type: 'problem',
            docs: { description },
            schema: [],
        },
        create(context) {
            const result = auditFor(context);
            for (const finding of result.findings) {
                if (finding.rule !== rule)
                    continue;
                const line = finding.displayLine ?? 1;
                context.report({
                    loc: { start: { line, column: 0 }, end: { line, column: 1 } },
                    message: finding.message,
                });
            }
            return {};
        },
    };
}
const rules = {
    'unpaired-marker': ruleFor('unpaired-marker', 'GRACE START/END markers must pair by name'),
    'complexity-blocks': ruleFor('complexity-blocks', 'A function with COMPLEXITY_SCORE above 7 must put its body in blocks'),
    'complexity-missing': ruleFor('complexity-missing', 'A function contract must declare COMPLEXITY_SCORE'),
};
const plugin = {
    meta: {
        name: '@alexquidditch/dsh-spec-guard',
        version: '0.2.1',
    },
    rules,
};
export default plugin;
export { rules };

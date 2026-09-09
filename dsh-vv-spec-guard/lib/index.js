import { lintPlan, lintSpec } from './lint.js';
export const name = 'vv-spec-guard';
/** True when a path is an active spec-package XML artifact (archive excluded). */
function isSpecPath(path) {
    if (!path.endsWith('.xml'))
        return false;
    if (!path.includes('.vvoc/specs/'))
        return false;
    if (path.includes('.vvoc/specs/archive/'))
        return false;
    const name = path.slice(path.lastIndexOf('/') + 1);
    return name === 'spec.xml' || name === 'plan.xml' || name === 'design-context.xml';
}
/** One-line bounded summary of a verdict. */
export function verdictLine(verdict, maxChars) {
    const parts = [
        `${verdict.errors.length} errors`,
        ...verdict.errors.slice(0, 3).map((finding) => `${finding.rule}: ${finding.message}`),
        verdict.warnings.length > 0 ? `${verdict.warnings.length} warnings` : '',
    ].filter((part) => part !== '');
    const line = `[spec-guard] ${parts.join('; ')}`;
    return line.length <= maxChars ? line : `${line.slice(0, maxChars - 1)}…`;
}
/** Lint one XML text by file name, optionally joining the sibling spec. */
export function lintFile(name, text, specText) {
    if (name === 'spec.xml')
        return lintSpec(text);
    if (name === 'plan.xml')
        return lintPlan(text, specText === undefined ? {} : { specText });
    if (name === 'design-context.xml')
        return { errors: [], warnings: [{ rule: 'unsupported', message: 'design-context.xml is not linted yet' }] };
    return { errors: [{ rule: 'unknown', message: `unknown artifact ${name}` }], warnings: [] };
}
export function apply(ctx, config = {}) {
    if (config.enabled === false)
        return;
    const verdictMaxChars = config.verdictMaxChars ?? 200;
    // Surface 1: verdicts into the plugin log on every observed spec-file touch.
    ctx.on('fs/observed', (target, _observation, actor) => {
        void actor;
        const path = typeof target?.displayPath === 'string' ? target.displayPath : '';
        if (!isSpecPath(path))
            return;
        ctx.logger.warn('[vv-spec-guard] observed spec artifact %s (verdicts via spec_guard_lint tool)', path);
    });
    // Surface 2: the deterministic probe tool the model can call.
    if (config.probeTool !== false) {
        const tools = ctx.get('tools');
        if (tools !== undefined) {
            const probeDefinition = {
                name: 'spec_guard_lint',
                description: 'Детерминированная проверка .vvoc spec/plan XML-артефактов: линт одного файла (spec.xml/plan.xml) или пакета .vvoc/specs/YYYY-MM-DD-<slug>/. Для plan.xml подхватывает sibling spec.xml.',
                parameters: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'Путь к XML-файлу или к директории пакета .vvoc/specs/YYYY-MM-DD-<slug>/.' },
                    },
                    required: ['path'],
                },
                output: {
                    schema: { type: 'string' },
                    render(_args, value) {
                        return [{ type: 'text', text: String(value) }];
                    },
                },
                async execute(args) {
                    const raw = args;
                    const requestPath = typeof raw?.path === 'string' ? raw.path : '';
                    if (requestPath === '')
                        return '[spec-guard] path is required';
                    const fs = ctx.get('fs');
                    if (fs === undefined)
                        return '[spec-guard] fs service unavailable';
                    const lines = ['spec-guard lint'];
                    const files = [];
                    if (requestPath.endsWith('.xml')) {
                        files.push({ name: requestPath.slice(requestPath.lastIndexOf('/') + 1), path: requestPath });
                    }
                    else {
                        for (const name of ['spec.xml', 'plan.xml']) {
                            files.push({ name, path: `${requestPath.replace(/\/+$/, '')}/${name}` });
                        }
                    }
                    let specText;
                    const spec = files.find((file) => file.name === 'spec.xml');
                    if (spec !== undefined) {
                        try {
                            specText = await fs.readText({ targetKey: spec.path });
                        }
                        catch {
                            lines.push(`[spec-guard] cannot read ${spec.path}`);
                        }
                    }
                    for (const file of files) {
                        let text;
                        try {
                            text = await fs.readText({ targetKey: file.path });
                        }
                        catch (error) {
                            lines.push(`${file.path}: unreadable (${error instanceof Error ? error.message : String(error)})`);
                            continue;
                        }
                        const verdict = lintFile(file.name, text, specText);
                        lines.push(`${file.path}: ${verdictLine(verdict, verdictMaxChars)}`);
                        for (const finding of [...verdict.errors, ...verdict.warnings].slice(0, 5)) {
                            lines.push(`  [${finding.rule}] ${finding.message}`);
                        }
                    }
                    return lines.join('\n');
                },
            };
            ctx.effect(() => tools.register(probeDefinition));
        }
    }
}

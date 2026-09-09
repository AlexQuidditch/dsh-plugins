/**
 * vvoc CLI entry: argument dispatch over install/sync/status/lint/analytics/
 * role/preset. Zero runtime dependencies; every command is a thin shell over
 * the pure modules so tests can drive the same code directly.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { analyticsTable } from './analytics.js';
import { checkInstalledPreset, installPreset } from './install.js';
import { resolveEngine } from './lint.js';
import { analyticsDir, projectDir } from './paths.js';
import { applyPreset, listPresets, listRoles, setRole, unsetRole, validateModel, validateRoleId } from './roles.js';
const USAGE = `vvoc — порт CLI vv-opencode для DeepSeek Harness

Команды:
  vvoc install [--force]                     установить пресет vv-controller в ~/.dsh/.agent-presets
  vvoc sync [--force]                        install --force + проверка frontmatter скиллов
  vvoc status                                состояние пресета, скиллов и файлов аналитики
  vvoc lint [paths...] [--archive] [--strict]
                                             линт .vvoc spec/plan XML (по умолчанию .vvoc/specs)
  vvoc analytics cache-hit-rate [--group-by day|week|month|session|model|provider] [--since Nd|Nw|Nm|YYYY-MM-DD] [--json]
  vvoc role list                             список модельных ролей
  vvoc role set <role> <provider/model> [--global]
  vvoc role unset <role> [--global]
  vvoc preset list                           именованные пресеты ролей
  vvoc preset show <name>
  vvoc preset <name> [--global]              применить пресет (записать roles атомарно)
`;
function parseArgs(argv) {
    const flags = new Set();
    const rest = [];
    for (const arg of argv) {
        if (arg.startsWith('--'))
            flags.add(arg);
        else
            rest.push(arg);
    }
    return { command: rest[0] ?? '', rest: rest.slice(1), flags };
}
function hasFlag(flags, name) {
    return flags.has(name);
}
async function commandLint(rest, flags) {
    const includeArchive = hasFlag(flags, '--archive');
    const strict = hasFlag(flags, '--strict');
    const explicit = rest.filter((path) => existsSync(path));
    let targets = explicit;
    if (explicit.length === 0) {
        const root = join(projectDir(), '.vvoc', 'specs');
        if (!existsSync(root)) {
            console.error('нет .vvoc/specs — нечего линтовать');
            return 1;
        }
        targets = [];
        for (const packageName of readdirSync(root)) {
            const packageDir = join(root, packageName);
            if (!statSync(packageDir).isDirectory())
                continue;
            if (!includeArchive && packageName.startsWith('archive'))
                continue;
            for (const name of ['spec.xml', 'plan.xml']) {
                const file = join(packageDir, name);
                if (existsSync(file))
                    targets.push(file);
            }
        }
    }
    if (targets.length === 0) {
        console.error('не найдено ни одного spec.xml/plan.xml');
        return 1;
    }
    const engine = await resolveEngine();
    let errors = 0;
    let warnings = 0;
    for (const file of targets.sort()) {
        const kind = file.endsWith('plan.xml') ? 'plan' : 'spec';
        let text = '';
        try {
            text = readFileSync(file, 'utf8');
        }
        catch (error) {
            console.log(`${file}: unreadable (${error instanceof Error ? error.message : String(error)})`);
            errors += 1;
            continue;
        }
        const specPath = join(file.slice(0, file.lastIndexOf('/')), 'spec.xml');
        const specText = kind === 'plan' && specPath !== file && existsSync(specPath) ? readFileSync(specPath, 'utf8') : undefined;
        const verdict = await engine(text, kind, kind === 'plan' ? { specText } : {});
        console.log(`${file}: ${verdict.errors.length} errors, ${verdict.warnings.length} warnings`);
        for (const finding of [...verdict.errors, ...verdict.warnings].slice(0, 5)) {
            console.log(`  [${finding.rule}] ${finding.message}`);
        }
        errors += verdict.errors.length;
        warnings += verdict.warnings.length;
    }
    console.log(`итого: ${errors} errors, ${warnings} warnings`);
    return errors > 0 || (strict && warnings > 0) ? 1 : 0;
}
function commandAnalytics(rest, flags) {
    const groupByFlag = rest.indexOf('--group-by');
    const groupBy = (groupByFlag >= 0 ? rest[groupByFlag + 1] : 'day');
    const sinceFlag = rest.indexOf('--since');
    const since = sinceFlag >= 0 ? rest[sinceFlag + 1] : undefined;
    const json = hasFlag(flags, '--json');
    const dir = analyticsDir();
    if (!existsSync(dir)) {
        console.log('нет данных: каталог аналитики не найден (' + dir + ')');
        return 0;
    }
    const { rows, totals } = analyticsTable(dir, groupBy, since);
    if (rows.length === 0) {
        console.log('нет данных за выбранный период');
        return 0;
    }
    const fmt = (rate) => rate === undefined ? 'n/a' : `${(rate * 100).toFixed(1)}%`;
    if (json) {
        console.log(JSON.stringify({ groupBy, rows, totals }, null, 2));
        return 0;
    }
    console.log(`кэш hit-rate по ${groupBy} (${dir}):`);
    for (const row of rows) {
        console.log(`  ${row.key.padEnd(24)} hit ${fmt(row.hitRate).padStart(7)}  coverage ${(row.coverage * 100).toFixed(0).padStart(3)}%  steps ${String(row.steps).padStart(6)}  input ${row.inputTokens}`);
    }
    console.log(`  итого: hit ${fmt(totals.hitRate)}  coverage ${(totals.coverage * 100).toFixed(0)}%  steps ${totals.steps}`);
    return 0;
}
function commandRole(rest, flags) {
    const sub = rest[0];
    const globalScope = hasFlag(flags, '--global');
    if (sub === 'list') {
        const rows = listRoles();
        if (rows.length === 0) {
            console.log('роли не заданы (vvoc role set <role> <provider/model>)');
            return 0;
        }
        for (const row of rows)
            console.log(`${row.role.padEnd(16)} ${row.model ?? ''}${row.scope === null ? '' : `  [${row.scope}]`}`);
        return 0;
    }
    if (sub === 'set') {
        const role = rest[1];
        const model = rest[2];
        if (role === undefined || model === undefined) {
            console.error('использование: vvoc role set <role> <provider/model> [--global]');
            return 1;
        }
        const roleError = validateRoleId(role);
        if (roleError !== undefined) {
            console.error(roleError);
            return 1;
        }
        const modelError = validateModel(model);
        if (modelError !== undefined) {
            console.error(modelError);
            return 1;
        }
        setRole(role, model, globalScope);
        console.log(`роль ${role} → ${model} (${globalScope ? 'global' : 'project'})`);
        return 0;
    }
    if (sub === 'unset') {
        const role = rest[1];
        if (role === undefined) {
            console.error('использование: vvoc role unset <role> [--global]');
            return 1;
        }
        if (!unsetRole(role, globalScope)) {
            console.error(`роль ${role} не задана в выбранной области`);
            return 1;
        }
        console.log(`роль ${role} удалена (${globalScope ? 'global' : 'project'})`);
        return 0;
    }
    console.error('использование: vvoc role list|set|unset');
    return 1;
}
function commandPreset(rest, flags) {
    const globalScope = hasFlag(flags, '--global');
    if (rest.length === 0 || rest[0] === 'list') {
        const rows = listPresets();
        if (rows.length === 0) {
            console.log('пресеты не заданы (в vvoc.json: {"presets": {"<name>": {"reviewer": "provider/model", ...}}}');
            return 0;
        }
        for (const row of rows) {
            const roles = Object.entries(row.roles).map(([role, model]) => `${role}=${model}`).join(', ');
            console.log(`${row.name.padEnd(20)} ${roles}`);
        }
        return 0;
    }
    if (rest[0] === 'show') {
        const name = rest[1];
        if (name === undefined) {
            console.error('использование: vvoc preset show <name>');
            return 1;
        }
        const row = listPresets().find((item) => item.name === name);
        if (row === undefined) {
            console.error(`пресет ${name} не найден`);
            return 1;
        }
        for (const [role, model] of Object.entries(row.roles))
            console.log(`${role.padEnd(16)} ${model}`);
        return 0;
    }
    const error = applyPreset(rest[0], globalScope);
    if (error !== undefined) {
        console.error(error);
        return 1;
    }
    console.log(`пресет ${rest[0]} применён (${globalScope ? 'global' : 'project'})`);
    return 0;
}
export async function main(argv) {
    const { command, rest, flags } = parseArgs(argv);
    switch (command) {
        case 'install':
        case 'sync': {
            try {
                const result = installPreset(command === 'sync' || hasFlag(flags, '--force'));
                if (result.backup !== undefined)
                    console.log(`старая копия: ${result.backup}`);
                console.log(`установлено: ${result.path}`);
                if (command === 'sync') {
                    const report = checkInstalledPreset();
                    const bad = report.skills.filter((skill) => !skill.ok);
                    console.log(`скиллы: ${report.skills.length} (${report.skills.filter((skill) => skill.ok).length} ok, ${bad.length} с проблемами)`);
                    for (const skill of bad)
                        console.log(`  ${skill.name}: ${skill.reason ?? 'проблема'}`);
                    return bad.length > 0 ? 1 : 0;
                }
                return 0;
            }
            catch (error) {
                console.error(error instanceof Error ? error.message : String(error));
                return 1;
            }
        }
        case 'status': {
            const report = checkInstalledPreset();
            if (!report.installed) {
                console.log('пресет vv-controller не установлен (vvoc install)');
                console.log(`целевой путь: ${report.path}`);
                return 0;
            }
            console.log(`пресет установлен: ${report.path}`);
            console.log(`скиллы: ${report.skills.map((skill) => `${skill.name}${skill.ok ? '' : '(!)'}`).join(', ')}`);
            const dir = analyticsDir();
            console.log(`аналитика: ${dir} (${existsSync(dir) ? 'есть данные' : 'пока пусто'})`);
            return 0;
        }
        case 'lint': return commandLint(rest, flags);
        case 'analytics': {
            if (rest[0] === 'cache-hit-rate' || rest[0] === undefined)
                return commandAnalytics(rest, flags);
            console.error(`неизвестная подкоманда analytics: ${rest[0]}`);
            return 1;
        }
        case 'role': return commandRole(rest, flags);
        case 'preset': return commandPreset(rest, flags);
        case '--help':
        case 'help':
        case '':
            console.log(USAGE);
            return 0;
        default:
            console.error(`неизвестная команда: ${command}`);
            console.error(USAGE);
            return 1;
    }
}
// Direct execution guard: lib/bin.js run as the CLI entry.
if (process.argv[1] !== undefined && process.argv[1].endsWith('bin.js')) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}

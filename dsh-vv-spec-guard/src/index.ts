/**
 * dsh-vv-spec-guard, host half.
 *
 * vv SpecGuard port: deterministic host-side verification of .vvoc spec-package
 * artifacts. Two surfaces:
 *
 * 1. A `fs/observed` listener that logs a bounded verdict whenever the agent
 *    touches an active spec/plan/design-context XML (archived files excluded).
 *    The observation event is notification-only — it cannot decorate a tool
 *    result — so the verdict goes to the plugin logger, and the model reaches
 *    the same engine explicitly through the probe tool below.
 * 2. A model-facing probe tool `spec_guard_lint` (the same pattern as
 *    dsh-scope-router's probe): pass a spec-package path or a single XML file
 *    path and get the deterministic verdict back, with the sibling spec joined
 *    for plan cross-file rules.
 *
 * Both surfaces share the pure engine in ./lint.ts, which the vvoc CLI reuses.
 */
import type { Context } from '@deepseek-ai/cordis'
import { lintPlan, lintSpec, type LintVerdict } from './lint.js'

export const name = 'vv-spec-guard'

/** Bundle config (see cordis.patch.yml). */
export interface VvSpecGuardConfig {
  /** Whether the guard is active. Default: true. */
  enabled?: boolean
  /** Whether to register the model-facing probe tool. Default: true. */
  probeTool?: boolean
  /** Character cap of one logged verdict line. Default: 200. */
  verdictMaxChars?: number
}

/** Structural fs service face this bundle needs; the host provides the real one. */
interface FsFace {
  readText(target: { targetKey: unknown }): Promise<string>
}

/** Structural tools registry face; the host provides the real one. */
interface ToolsFace {
  register(definition: unknown): () => void
}

/** Structural fs/observed payload: target carries a display path. */
interface ObservedTarget {
  displayPath?: unknown
}

// The runtime declares this event in dsh-fs; declare it locally so the bundle
// stays installable without registry-absent runtime versions.
declare module '@deepseek-ai/cordis' {
  interface Events {
    'fs/observed'(target: ObservedTarget, observation: unknown, actor: unknown): void
  }
}

/** True when a path is an active spec-package XML artifact (archive excluded). */
function isSpecPath(path: string): boolean {
  if (!path.endsWith('.xml')) return false
  if (!path.includes('.vvoc/specs/')) return false
  if (path.includes('.vvoc/specs/archive/')) return false
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name === 'spec.xml' || name === 'plan.xml' || name === 'design-context.xml'
}

/** One-line bounded summary of a verdict. */
export function verdictLine(verdict: LintVerdict, maxChars: number): string {
  const parts = [
    `${verdict.errors.length} errors`,
    ...verdict.errors.slice(0, 3).map((finding) => `${finding.rule}: ${finding.message}`),
    verdict.warnings.length > 0 ? `${verdict.warnings.length} warnings` : '',
  ].filter((part) => part !== '')
  const line = `[spec-guard] ${parts.join('; ')}`
  return line.length <= maxChars ? line : `${line.slice(0, maxChars - 1)}…`
}

/** Lint one XML text by file name, optionally joining the sibling spec. */
export function lintFile(name: string, text: string, specText?: string): LintVerdict {
  if (name === 'spec.xml') return lintSpec(text)
  if (name === 'plan.xml') return lintPlan(text, specText === undefined ? {} : { specText })
  if (name === 'design-context.xml') return { errors: [], warnings: [{ rule: 'unsupported', message: 'design-context.xml is not linted yet' }] }
  return { errors: [{ rule: 'unknown', message: `unknown artifact ${name}` }], warnings: [] }
}

export function apply(ctx: Context, config: VvSpecGuardConfig = {}): void {
  // Boot self-diagnostic: one JSON marker per process shows whether apply ran,
  // whether the tools registry was visible immediately, and any thrown error.
  // The plugin runs host-side (unsandboxed), so the marker lands next to the
  // vv-analytics directory and costs one small write per boot.
  const markerPath = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'vv-spec-guard-boot.json')
  const marker = { ts: new Date().toISOString(), applied: false, toolsImmediate: false, registeredImmediately: false, deferred: false, error: undefined as string | undefined }
  try {
    applyBody(ctx, config, marker)
    marker.applied = true
  } catch (error) {
    marker.error = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
    try { ctx.logger.error('[vv-spec-guard] apply failed: %s', marker.error) } catch { /* logger unavailable */ }
  }
  try {
    mkdirSync(dirname(markerPath), { recursive: true })
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`)
  } catch {
    // diagnostics must never break the boot
  }
}

function applyBody(ctx: Context, config: VvSpecGuardConfig, marker: { toolsImmediate: boolean; registeredImmediately: boolean; deferred: boolean }): void {
  if (config.enabled === false) return
  const verdictMaxChars = config.verdictMaxChars ?? 200

  // Surface 1: verdicts into the plugin log on every observed spec-file touch.
  ctx.on('fs/observed', (target: ObservedTarget, _observation: unknown, actor: unknown) => {
    void actor
    const path = typeof target?.displayPath === 'string' ? target.displayPath : ''
    if (!isSpecPath(path)) return
    ctx.logger.warn('[vv-spec-guard] observed spec artifact %s (verdicts via spec_guard_lint tool)', path)
  })

  // Surface 2: the deterministic probe tool the model can call. Registration is
  // immediate when the registry is already mounted, and deferred through
  // ctx.inject otherwise — covering boot orders where a bundle row applies
  // before the host tools registry exists.
  if (config.probeTool !== false) {
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
        render(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
          return [{ type: 'text', text: String(value) }]
        },
      },
      async execute(args: unknown): Promise<string> {
        const raw = args as { path?: unknown }
        const requestPath = typeof raw?.path === 'string' ? raw.path : ''
        if (requestPath === '') return '[spec-guard] path is required'
        const fs = ctx.get('fs') as FsFace | undefined
        if (fs === undefined) return '[spec-guard] fs service unavailable'

        const lines: string[] = ['spec-guard lint']
        const files: Array<{ name: string; path: string }> = []
        if (requestPath.endsWith('.xml')) {
          files.push({ name: requestPath.slice(requestPath.lastIndexOf('/') + 1), path: requestPath })
        } else {
          for (const name of ['spec.xml', 'plan.xml']) {
            files.push({ name, path: `${requestPath.replace(/\/+$/, '')}/${name}` })
          }
        }

        let specText: string | undefined
        const spec = files.find((file) => file.name === 'spec.xml')
        if (spec !== undefined) {
          try {
            specText = await fs.readText({ targetKey: spec.path })
          } catch {
            lines.push(`[spec-guard] cannot read ${spec.path}`)
          }
        }

        for (const file of files) {
          let text: string
          try {
            text = await fs.readText({ targetKey: file.path })
          } catch (error) {
            lines.push(`${file.path}: unreadable (${error instanceof Error ? error.message : String(error)})`)
            continue
          }
          const verdict = lintFile(file.name, text, specText)
          lines.push(`${file.path}: ${verdictLine(verdict, verdictMaxChars)}`)
          for (const finding of [...verdict.errors, ...verdict.warnings].slice(0, 5)) {
            lines.push(`  [${finding.rule}] ${finding.message}`)
          }
        }
        return lines.join('\n')
      },
    }

    const registerProbe = (tools: ToolsFace): (() => void) => tools.register(probeDefinition)
    const immediate = ctx.get('tools') as ToolsFace | undefined
    marker.toolsImmediate = immediate !== undefined
    if (immediate !== undefined) {
      ctx.effect(() => registerProbe(immediate))
      marker.registeredImmediately = true
    } else {
      // Deferred: the preset/bundle boot order may apply this row before the
      // host tools registry mounts; inject waits and registers on arrival.
      ctx.inject(['tools'], (injected) => {
        const tools = injected.tools as ToolsFace
        ctx.effect(() => registerProbe(tools))
        marker.deferred = true
      })
    }
  }
}

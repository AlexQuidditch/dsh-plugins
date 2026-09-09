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
import type { Context } from '@deepseek-ai/cordis';
import { type LintVerdict } from './lint.js';
export declare const name = "vv-spec-guard";
/** Bundle config (see cordis.patch.yml). */
export interface VvSpecGuardConfig {
    /** Whether the guard is active. Default: true. */
    enabled?: boolean;
    /** Whether to register the model-facing probe tool. Default: true. */
    probeTool?: boolean;
    /** Character cap of one logged verdict line. Default: 200. */
    verdictMaxChars?: number;
}
/** Structural fs/observed payload: target carries a display path. */
interface ObservedTarget {
    displayPath?: unknown;
}
declare module '@deepseek-ai/cordis' {
    interface Events {
        'fs/observed'(target: ObservedTarget, observation: unknown, actor: unknown): void;
    }
}
/** One-line bounded summary of a verdict. */
export declare function verdictLine(verdict: LintVerdict, maxChars: number): string;
/** Lint one XML text by file name, optionally joining the sibling spec. */
export declare function lintFile(name: string, text: string, specText?: string): LintVerdict;
export declare function apply(ctx: Context, config?: VvSpecGuardConfig): void;
export {};

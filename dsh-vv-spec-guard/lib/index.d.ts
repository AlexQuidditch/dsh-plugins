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

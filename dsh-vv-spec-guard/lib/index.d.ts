import type { Context } from '@deepseek-ai/cordis';
import { type LintVerdict, type PlanLintOptions, type ReceiptLike } from './lint.js';
export declare const name = "vv-spec-guard";
/** Bundle config (see cordis.patch.yml). */
export interface VvSpecGuardConfig {
    /** Whether the guard is active. Default: true. */
    enabled?: boolean;
    /** Whether to register the spec_guard_lint probe tool. Default: true. */
    probeTool?: boolean;
    /** Whether to register the spec_guard_approve tool (§K). Default: true. */
    approveTool?: boolean;
    /** Whether to register the spec_guard_evidence tool (§M). Default: true. */
    evidenceTool?: boolean;
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
/**
 * Lint one XML text by file name.
 *
 * The third argument is the host-provided options bag (§K approvals, §L
 * receipts, sibling spec text); the original `lintFile(name, text, specText)`
 * call shape is still accepted for backward compatibility.
 */
export declare function lintFile(name: string, text: string, options?: PlanLintOptions | string): LintVerdict;
/**
 * Parse receipts.jsonl tolerantly (§L).
 *
 * Every non-empty line must be a JSON object; only `task_id`, `command`, and
 * `exit_code` are used by the lint, and other documented fields (`ts`, `ac_id`,
 * `output_digest`, `output_tail`, `head_oid`, `provenance`) are preserved by
 * the writer, not needed here. Malformed lines are reported so the host can
 * surface a `receipt-malformed` warning instead of failing the whole verdict.
 */
export declare function parseReceiptsJsonl(text: string): {
    receipts: ReceiptLike[];
    malformed: Array<{
        line: number;
        error: string;
    }>;
};
/**
 * §M byte-evidence verdict for one anchor.
 *
 * `fileText === null` models a file the host could not read. The selected
 * inclusive 1-based line range has its terminators stripped and is joined with
 * `\n` (hive `anchor_digest` formula); the digest is the lowercase SHA-256 hex
 * of those UTF-8 bytes, and the excerpt is compared byte-for-byte after the
 * same line-break normalization. Verdicts: MATCH | MISMATCH | OUT_OF_RANGE |
 * UNREADABLE.
 */
export declare function evidenceVerdict(fileText: string | null, startLine: number, endLine: number, excerpt: string): string;
export declare function apply(ctx: Context, config?: VvSpecGuardConfig): void;
export {};

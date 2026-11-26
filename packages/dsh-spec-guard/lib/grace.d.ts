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
export declare function tsPublicSurface(program: ts.Program, checker: ts.TypeChecker, filePath: string): string[];
export interface GraceParse {
    purpose: string;
    depends: string;
    invariants: string[];
    moduleMap: string[];
}
export type InvariantClass = 'import-ban' | 'reference-ban' | 'behavioral';
export interface GraceCheckResult {
    hasGrace: boolean;
    moduleMap: {
        declared: string[];
        actual: string[];
        missing: string[];
        extra: string[];
    } | null;
    importBanViolations: Array<{
        invariant: string;
        pattern: string;
        matchingImports: string[];
    }>;
    structuralInvariants: string[];
    behavioralInvariants: string[];
}
/** Extract the GRACE contract sections from a source file's text. */
export declare function parseGrace(text: string): GraceParse;
/** Best-effort file-level export detection from source text (caller may override with
 * TS API for higher fidelity). NOTE: GRACE MODULE_MAP in practice also lists class public
 * methods, which are not file-level exports; moduleMap comparison is therefore informational
 * (file-level only) — full class-surface fidelity requires the TS API. The reliably verified
 * GRACE elements are the import-ban invariants and the at-risk behavioral invariant surface. */
export declare function detectExports(text: string): string[];
/** Import specifiers from source text. */
export declare function detectImports(text: string): string[];
/** Classify an invariant line: import-ban / reference-ban (structural) vs behavioral. */
export declare function classifyInvariant(invariant: string): InvariantClass;
/**
 * Verify the structural GRACE contracts against the actual code and classify the rest.
 * actualExports/actualImports may be supplied from the TS API for higher fidelity;
 * otherwise they are detected from the text.
 */
export declare function checkGrace(text: string, actualExports?: string[], actualImports?: string[]): GraceCheckResult;
/** Invariants that mention any of the changed symbols — the at-risk set for a change. */
export declare function atRiskInvariants(files: Array<{
    path: string;
    text: string;
}>, changedSymbols: string[]): Array<{
    path: string;
    invariant: string;
    class: InvariantClass;
}>;
export interface InvariantObligation {
    id: string;
    invariant: string;
    module: string;
    class: InvariantClass;
    /** import-ban is auto-checked; reference-ban/behavioral need an executable test. */
    checkType: 'import-ban-auto' | 'behavioral-test';
    scaffold: string | null;
}
/**
 * A property-test scaffold for a behavioral invariant. This is an OBLIGATION + starting
 * point, NOT an auto-generated correct test: the natural-language guarantee must be turned
 * into an actual assertion by the agent/human. The scaffold is marked TODO and tracked in
 * the invariant-verification ledger; plan-close blocks on pending obligations, so a
 * behavioral invariant cannot be silently ignored.
 */
export declare function propertyTestScaffold(invariant: string, modulePath: string, id: string): string;
/** Turn at-risk invariants into verification obligations (scaffolds for behavioral ones). */
export declare function invariantObligations(risky: Array<{
    path: string;
    invariant: string;
    class: InvariantClass;
}>): InvariantObligation[];
/** One invariant-verification ledger entry (invariant-verification.xml, unique-tag IV-NNN). */
export interface InvariantVerificationEntry {
    id: string;
    invariant: string;
    module: string;
    testPath: string;
    status: string;
    evidence: string;
}
/** Parse the invariant-verification ledger. */
export declare function parseInvariantVerification(text: string): InvariantVerificationEntry[];
/** Discharged statuses; anything else is a pending obligation. */
export declare const INVARIANT_DISCHARGED: Set<string>;
/**
 * Rule ids, each tied to one promise in .agents/shared/grace-markup-spec.md.
 *
 * `unpaired-marker`  — the spec pairs START_X/END_X; an unmatched pair means the markup no
 *                      longer delimits anything, so any tool reading the span reads garbage.
 * `module-map-drift` — "The map MUST match the current exports of the file".
 * `module-map-missing` — a file with exports but no map cannot be verified at all.
 * `complexity-blocks` — "A score above 7 makes block segmentation mandatory".
 * `complexity-missing`— every exported function needs a contract, and a function contract
 *                      carries COMPLEXITY_SCORE; without it the block rule is unenforceable.
 * `use-case-shape`   — USE_CASES are AAG: `name: Actor -> Action -> Goal`.
 * `invariant-multi-rule` — one bullet bundling 2+ guarantees cannot be discharged by one test.
 */
export type GraceRule = 'unpaired-marker' | 'module-map-drift' | 'module-map-missing' | 'complexity-blocks' | 'complexity-missing' | 'use-case-shape' | 'invariant-multi-rule';
export interface GraceFinding {
    rule: GraceRule;
    /** Stable identity for baselining: rule + file + symbol. Never includes a line number. */
    key: string;
    symbol: string;
    message: string;
    displayLine?: number;
    severity: 'error' | 'warn';
}
export interface GraceAuditResult {
    path: string;
    hasGrace: boolean;
    findings: GraceFinding[];
    /** Counts by rule, for a one-line verdict. */
    counts: Record<string, number>;
}
/**
 * Audit one file against every machine-checkable GRACE promise and return typed findings.
 *
 * This is the single entry point the host tool, the baseline ratchet and the tests share.
 * It is deliberately pure text analysis plus an optional TS-derived `actualSurface`, so the
 * lint engine keeps its zero-dependency posture while the host can pass factual exports.
 */
export declare function auditGraceFile(path: string, text: string, actualSurface?: string[]): GraceAuditResult;
/**
 * Baseline format version.
 *
 * v2 carries the declaring context in `complexity-missing` keys (`Class#method`) and pairs
 * markers as declarations. A v1 key set cannot be trusted against v2 findings: the old keys
 * either never reproduce (prose false positives) or collapse same-named methods. The tool
 * therefore refuses a v1 baseline and demands one explicit re-accept.
 */
export declare const GRACE_BASELINE_VERSION = 2;
export interface GraceBaseline {
    /** Format version; parse returns 1 for a legacy file, apply/serialize always write v2. */
    version: number;
    /** Repo-relative file → sorted finding keys accepted as existing debt. */
    files: Record<string, string[]>;
}
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
export declare function applyGraceBaseline(result: GraceAuditResult, baseline: GraceBaseline, repoRelativePath: string): {
    regressions: GraceFinding[];
    accepted: GraceFinding[];
    baseline: GraceBaseline;
};
/**
 * Build the baseline entry for a file from its current audit — the EXPLICIT accept step.
 * Used by the tool's accept mode so a whole-corpus run can record today's debt in one go;
 * never called on the gating path.
 */
export declare function graceBaselineFromAudits(results: GraceAuditResult[]): GraceBaseline;
/** Serialize a baseline deterministically (sorted files, sorted keys, trailing newline). */
export declare function serializeGraceBaseline(baseline: GraceBaseline): string;
/** Parse a baseline file, tolerating absence (empty baseline = everything is a regression). */
export declare function parseGraceBaseline(text: string): GraceBaseline;
/** Whether a file uses the legacy (no START_/END_) GRACE header dialect. */
export declare function isLegacyGraceDialect(text: string): boolean;
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
export declare function normalizeLegacyGraceHeader(text: string): {
    text: string;
    changed: boolean;
};

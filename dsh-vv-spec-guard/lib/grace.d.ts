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

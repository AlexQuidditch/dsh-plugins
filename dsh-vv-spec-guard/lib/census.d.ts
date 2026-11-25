import ts from 'typescript';
export interface CensusInput {
    repoRoot: string;
    baselineRef: string;
    currentRef?: string;
    scopeDir: string;
    ownerScope?: string;
    deletedSymbols: string[];
    deletedPaths: string[];
    renamedSymbols?: {
        from: string;
        to: string;
    }[];
    renamedPaths?: {
        from: string;
        to: string;
    }[];
    /** Follow-up #4 (v2): opt-in transitive consumer depth (0 = direct-only, default). */
    transitiveDepth?: number;
    /** Follow-up #4 (v2): opt-in gitlink/submodule detection under the repo. */
    includeSubmodules?: boolean;
}
export type EdgeKind = 'runtime-import' | 'type-import' | 'schema-barrel' | 'contract-barrel';
export interface CensusEdge {
    id: string;
    kind: EdgeKind;
    source: string;
    target: string;
    displayLine?: number;
}
export interface CensusScope {
    scope: string;
    files: string[];
    edges: CensusEdge[];
    hardCount: number;
}
export interface CensusOutput {
    resolvedOid: string;
    analyzer: {
        name: 'typescript';
        version: string;
    };
    resolutionStrategy: string;
    perScope: CensusScope[];
    advisory: CensusEdge[];
    outputDigest: string;
    /** Follow-up #4: edge-weighted fan-out (shared barrels weigh more). Supplementary, not digested. */
    weightedFanout: number;
    /** Follow-up #4: opt-in transitive consumer edges (importers of direct consumers). */
    transitive: CensusEdge[];
    /** Follow-up #4: opt-in detected gitlink/submodule paths under the repo. */
    submodules: string[];
}
export type CensusResult = {
    ok: true;
    output: CensusOutput;
} | {
    ok: false;
    rule: string;
    message: string;
};
export declare function runCensus(input: CensusInput): Promise<CensusResult>;
/**
 * Cached + per-repo-locked census. Identical inputs reuse the result (repeat lint /
 * pre-flight is cheap); concurrent runs on the same repo+scope are serialized so
 * worktree create/cleanup cannot race or leave leftovers. Errors are not cached.
 */
/** Build a TS program + checker for a scope on a given root (live repo or worktree).
 * Reuses the injected workspace resolver so @foundation/* and barrels resolve. Exported
 * for follow-up #2 GRACE MODULE_MAP factual surface extraction. */
export declare function createScopeProgram(root: string, scopeDir: string): {
    program: ts.Program;
    checker: ts.TypeChecker;
};
export declare function runCensusCached(input: CensusInput): Promise<CensusResult>;

import { type CensusInput } from './census.js';
export interface UndeclaredDeletionInput {
    repoRoot: string;
    /** OID (or resolvable rev) to diff FROM — the pinned plan baseline. */
    baselineRef: string;
    /** Diff target; defaults to WORKTREE (staged+unstaged vs baseline). 'HEAD' or an
     *  OID compares committed history only. */
    headRef?: string;
    /** Plan <deletes> paths (repo-relative). */
    declaredPaths: string[];
    /** Plan <renames> from/to pairs. */
    declaredRenames?: Array<{
        from: string;
        to: string;
    }>;
}
export interface UndeclaredEntry {
    path: string;
    kind: 'delete' | 'rename' | 'type-change';
    to?: string;
}
export type UndeclaredDeletionResult = {
    ok: true;
    undeclared: UndeclaredEntry[];
    diffCount: number;
    declaredCount: number;
} | {
    ok: false;
    rule: string;
    message: string;
};
/**
 * Compare git diff destructive entries against the declared plan surface, kind-separated.
 * D / T must match a declared delete; R must match a declared rename pair (from AND to).
 */
export declare function checkUndeclaredDeletions(input: UndeclaredDeletionInput): UndeclaredDeletionResult;
export interface StaleImpactInput extends CensusInput {
    /** The current ref to compare against the pinned baseline. */
    currentRef: string;
}
export type StaleImpactResult = {
    ok: true;
    drift: boolean;
    newScopes: string[];
    newEdgeCount: number;
    newEdges: Array<{
        scope: string;
        kind: string;
        source: string;
        target: string;
    }>;
    removedScopes: string[];
    removedDeclaredPaths: string[];
    baselineDigest: string;
    currentDigest: string;
} | {
    ok: false;
    rule: string;
    message: string;
};
/**
 * Re-run the census at the pinned baseline and at currentRef; compare consumer EDGE
 * tuples (scope,kind,source,target) and scope sets, so a new consumer edge inside an
 * already-present scope is drift (feedback F4). The current-side run tolerates declared
 * paths that have already moved/vanished (feedback: current-side abort) — they are
 * dropped from that run and reported as removedDeclaredPaths drift. An empty destructive
 * surface is refused (stale-impact-vacuous-surface) rather than returning a green.
 */
export declare function computeStaleImpact(input: StaleImpactInput): Promise<StaleImpactResult>;

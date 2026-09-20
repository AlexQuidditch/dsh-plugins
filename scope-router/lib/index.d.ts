/**
 * dsh-scope-router, host half.
 *
 * Determines the working scope of an agent — which configured project root,
 * which domain package (`packages/domains/<name>`) and which layer
 * (backend/frontend) — from three signals: message text, filesystem
 * observations (`fs/observed`), and shell-tool activity (`tools/result` for
 * `bash`/`pwsh` command and workdir arguments). When the scope changes, the
 * matching project instruction files (core + domain + layer) are injected
 * into the next model step as a baseline instructions message; the new bundle
 * textually supersedes the previous one.
 *
 * Workspace gating (postmortem 0002 — instructions leaked into foreign repos):
 * a project root is ELIGIBLE for an agent only when that agent's session cwd
 * lies inside the root (`agent.session.header.cwd`). Agents working outside
 * every configured root never receive any bundle, no matter how strongly the
 * message text mentions the root's domains. All activity signals are also
 * attributed per-agent (`ToolExecution.agent`, and the `actor` of
 * `fs/observed` carries the same agent), so in a multi-session host process
 * one agent's file/shell activity can never raise another agent's root score.
 * Relative path fragments extracted from shell commands resolve only against
 * roots containing the acting agent's own cwd.
 *
 * Worktree pinning (v0.3.0): a session created inside the configured worktrees
 * directory (`worktrees.dir`, e.g. …/platform.worktrees/<name>) is PINNED to
 * the scope named after the worktree directory. The worktree itself becomes
 * the reading root (its own branch checkout), the domain comes from the
 * directory name (`worktrees.domainByWorktree` may override the mapping), and
 * neither message text nor activity can switch the domain or pull another
 * domain's files. Core files stay on by default (`worktrees.includeCore`) so a
 * worktree without a domain instruction file still receives the repo-wide
 * rules; layer maps are off by default (`worktrees.includeLayers`).
 *
 * App-scope bundles (v0.4.0) include EVERY found scope file — the domain
 * package's AGENTS.md and the app's AGENTS.md are complementary, not a
 * priority chain — and fall back to the configured project roots for files
 * the worktree branch does not carry yet (authored on the base branch, not
 * yet synced into the worktree).
 *
 * Namespace plugin shape: named exports name / inject / apply, no default
 * export (postmortem 0001: default export drops inject).
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "scope-router";
/** The filesystem service must exist before this plugin starts. */
export declare const inject: string[];
export interface ScopeRouterConfig {
    /** Absolute project roots this router watches. Inactive without them. */
    projectRoots?: string[];
    /** Root-relative core instruction files, always injected when a root is active. */
    coreFiles?: string[];
    /** Root-relative per-layer instruction files. */
    layerFiles?: {
        backend?: string[];
        frontend?: string[];
    };
    /** Root-relative directory whose subdirectories name the domains. */
    domainsDir?: string;
    /** Domain instruction file candidates; `{domain}` is replaced with the domain name. */
    domainCandidates?: string[];
    /** Hard character cap of one injected bundle. */
    maxBundleChars?: number;
    /** Register the `scope_router_status` probe tool. */
    probeTool?: boolean;
    /** Log injections to the plugin logger. */
    log?: boolean;
    /**
     * Per-scope git worktrees: a session created inside `<dir>/<name>` is pinned
     * to scope `name`. Inactive without `dir`.
     */
    worktrees?: {
        /** Absolute directory holding one worktree per scope (e.g. …/platform.worktrees). */
        dir?: string;
        /** Worktree directory name → domain name overrides; default is the name itself. */
        domainByWorktree?: Record<string, string>;
        /** Include root-relative coreFiles in worktree bundles (default true). */
        includeCore?: boolean;
        /** Include layer maps in worktree bundles (default false). */
        includeLayers?: boolean;
    };
}
export declare function apply(ctx: Context, input?: ScopeRouterConfig): void;

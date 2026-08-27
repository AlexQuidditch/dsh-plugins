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
}
export declare function apply(ctx: Context, input?: ScopeRouterConfig): void;

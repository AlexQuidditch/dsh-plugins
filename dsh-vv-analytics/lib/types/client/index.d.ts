/**
 * dsh-vv-analytics, browser half.
 *
 * Registers the cache pill into `conversation.session.header.utilities`: a live
 * token-weighted cache hit rate of the active session, derived from the host's
 * `tokenUsage` projection through the framework-supplied `useProjection` hook.
 * The pill shows "кэш n/a" until the first usage-bearing step, then green
 * (≥80%), yellow (≥50%), or red, matching the vv TUI indicator.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Required services: the slot registry. */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;

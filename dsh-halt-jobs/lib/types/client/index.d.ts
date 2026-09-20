/**
 * dsh-halt-jobs, browser half.
 *
 * Registers the stop pill into `conversation.session.header.actions` — the
 * title-adjacent strip that also hosts the shipped background-jobs selector
 * (`job-list`, order 20) — at order 100, immediately to its right.
 *
 * The pill's count reads the framework's own `jobsBySession` projection
 * (standard `useSessions` slot prop), so there is no polling channel. The only
 * wire call is the `stop-all` endpoint on the host half's `/dsh-halt-jobs`
 * Connection channel, made through the client's `connection` service.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Required services: the wire client and the slot registry. */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;

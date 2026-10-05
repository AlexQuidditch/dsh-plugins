/**
 * dsh-halt-jobs, browser half.
 *
 * Registers the stop pill into `conversation.session.header.actions` — the
 * title-adjacent strip that also hosts the shipped background-jobs selector
 * (`job-list`, order 20) — at order 100, immediately to its right.
 *
 * The pill's live count reads the client `jobs` service (`ctx.jobs.state`) and
 * opens the session's roster stream through the same service — the 0.2 pair
 * that replaces the removed `useSessions(state => state.jobsBySession)`
 * projection. The only wire call is the `stop-all` endpoint on the host half's
 * `/dsh-halt-jobs` Connection channel, made through the client's `connection`
 * service.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Required services: the wire client, the slot registry, and the jobs rosters. */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;

/**
 * dsh-vv-context, browser half.
 *
 * Registers the context-inspector button into
 * `conversation.session.header.utilities`; clicking it toggles the panel for
 * the active session. All figures come from the framework's `useProjection`
 * hook — the host token-meter projections, live-updated by the runtime, with
 * honest "no data" states instead of fabricated zeros.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Required services: the slot registry. */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;

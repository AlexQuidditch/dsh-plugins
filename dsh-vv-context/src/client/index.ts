/**
 * dsh-vv-context, browser half.
 *
 * Registers the context-inspector button into
 * `conversation.session.header.utilities`; clicking it toggles the panel for
 * the active session. All figures come from the framework's `useProjection`
 * hook — the host token-meter projections, live-updated by the runtime, with
 * honest "no data" states instead of fabricated zeros.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge so the utilities key resolves.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

import { ContextPanel } from './ContextPanel.tsx'

/** Required services: the slot registry. */
export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'vv-context-inspector',
    order: 30,
  }, ContextPanel as never))
}

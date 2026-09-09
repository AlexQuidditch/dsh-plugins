/**
 * dsh-vv-analytics, browser half.
 *
 * Registers the cache pill into `conversation.session.header.utilities`: a live
 * token-weighted cache hit rate of the active session, derived from the host's
 * `tokenUsage` projection through the framework-supplied `useProjection` hook.
 * The pill shows "кэш n/a" until the first usage-bearing step, then green
 * (≥80%), yellow (≥50%), or red, matching the vv TUI indicator.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge so the utilities key resolves.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

import { CachePill } from './CachePill.tsx'

/** Required services: the slot registry. */
export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'vv-cache-indicator',
    order: 20,
  }, CachePill as never))
}

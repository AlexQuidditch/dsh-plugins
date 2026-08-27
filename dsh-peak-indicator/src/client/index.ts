/**
 * dsh-peak-indicator, browser half.
 *
 * Registers one entry into the `conversation.session.header.utilities` slot —
 * the right-aligned session utility strip in the conversation header — so it is
 * visible whenever a session is open. The component derives DeepSeek peak/off-peak
 * state from the current UTC time and re-derives it every 15 seconds.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge so ctx.slots.register accepts the
// 'conversation.session.header.utilities' key.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

import { PeakIndicator } from './PeakIndicator.tsx'

/** Required services: the slot registry. */
export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'deepseek-peak-indicator',
  }, PeakIndicator))
}

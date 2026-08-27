/**
 * The injected face of one 👋 assistant-message action, plus the composed
 * component props. The target 'conversation.chat.assistant-actions' slot is
 * declared and typed by ui-conversation; this package only contributes the
 * entry, so no SlotMap merge lives here.
 */

import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the SlotMap merge so PropsRuntime<'...assistant-actions'> resolves.
import type { } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Injected business face: submit the action line to the session's agent. */
export interface HelloInjected {
  runHello: () => Promise<void>
}

/** Full props of one 👋 action entry (owner props + injected face). */
export type HelloActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<HelloInjected>

/**
 * The line the action submits as a user message. A leading `/name` token is
 * a skill invocation: session.prompt, then dsh-tool-skill at pre-step.
 */
export const HELLO_LINE = '/goal поесть'

export type { SessionId }

/**
 * dsh-peak-indicator, browser half.
 *
 * Registers one entry into the `conversation.session.header.utilities` slot —
 * the right-aligned session utility strip in the conversation header — so it is
 * visible whenever a session is open. The component derives DeepSeek peak/off-peak
 * state from the current UTC time and re-derives it every 15 seconds.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Required services: the slot registry. */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;

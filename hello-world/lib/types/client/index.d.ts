/**
 * dsh-hello-world, browser half.
 *
 * Registers one entry into the `conversation.chat.assistant-actions` slot:
 * a 👋 action on every finalized assistant message. Clicking it submits
 * HELLO_LINE as a user message (session.prompt). A leading `/name` token is
 * still a prompt, not command.execute: dsh-tool-skill recognizes it at the
 * pre-step boundary and injects `<skill_content>` for the model round-trip.
 *
 * The session face comes from the client sessions service
 * (`ctx.sessions` on the browser). The client outward face is `ISessions`
 * and has no `get()` — resolve the per-session face with `binding(...)`,
 * exactly like ui-conversation's service does. The HOST-side `SessionStore`
 * type must not leak into this bundle (its Context merge would shadow the
 * client `ISessions` typing), so the service is read dynamically and cast
 * to the client face.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Required services: slot registry and the client sessions face. */
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;

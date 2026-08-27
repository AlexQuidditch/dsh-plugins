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
import { HelloAction } from "./HelloAction.js";
import { HELLO_LINE } from "./slots.js";
/** Required services: slot registry and the client sessions face. */
export const inject = ['slots', 'sessions'];
export function apply(ctx) {
    ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: 'hello',
        order: 10,
        inject: (sessionId) => ({
            runHello: async () => {
                const line = HELLO_LINE;
                // Strict get + explicit client face: the merged Context type may name
                // the host SessionStore (see module doc) — the browser runtime always
                // provides the client ISessions, whose binding() yields SessionFace.
                const sessions = ctx.get('sessions');
                if (sessions === undefined)
                    throw new Error('sessions service unavailable');
                const session = sessions.binding(sessionId)?.session;
                if (session === undefined)
                    throw new Error(`no session for ${sessionId}`);
                if (line.startsWith('/')) {
                    // Command-plane transaction: executes the slash command against the
                    // session's agent without a model round-trip. `matched === false`
                    // is an admission miss (unknown/malformed command) — surfaced here
                    // instead of failing silently.
                    const result = await session.command(line);
                    if (!result.ok)
                        throw new Error(`session.command failed: ${result.error.code}: ${result.error.message}`);
                    if (!result.value.matched)
                        throw new Error(`unknown or malformed command: ${line}`);
                    return;
                }
                // Plain text: send it to the agent as a user message (the same
                // transaction the composer's submit path uses).
                const content = [{ type: 'text', text: line }];
                const result = await session.prompt(content, 'queue');
                if (!result.ok)
                    throw new Error(`session.prompt failed: ${result.error.code}: ${result.error.message}`);
            },
        }),
    }, HelloAction));
}

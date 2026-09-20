import { HaltJobsPill } from "./HaltJobsPill.js";
/** Logical channel owned by the host half (src/index.ts). */
const CHANNEL = '/dsh-halt-jobs';
/** Coerce a wire number with a safe default. */
function numberOf(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
/** Required services: the wire client and the slot registry. */
export const inject = ['connection', 'slots'];
export function apply(ctx) {
    const connection = ctx.get('connection');
    const stopAll = (sessionId) => {
        if (connection === undefined) {
            return Promise.resolve({ ok: false, message: 'connection service unavailable' });
        }
        return connection.rpc.call(CHANNEL, 'stop-all', { sessionId })
            .then((result) => result.ok
            ? {
                ok: true,
                value: {
                    stopped: numberOf(result.value?.stopped),
                    remaining: numberOf(result.value?.remaining),
                },
            }
            : { ok: false, message: result.error.message })
            .catch((error) => ({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
        }));
    };
    ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'halt-stop-all',
        order: 100,
        // Inject share: the wire call joins the slot's standard props (sessionId,
        // useSessions) without the component reaching for any context.
        inject: () => ({ stopAll }),
    }, HaltJobsPill));
}

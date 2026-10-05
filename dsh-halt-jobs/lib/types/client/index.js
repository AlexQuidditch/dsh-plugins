import { HaltJobsPill } from "./HaltJobsPill.js";
/** Logical channel owned by the host half (src/index.ts). */
const CHANNEL = '/dsh-halt-jobs';
/** Coerce a wire number with a safe default. */
function numberOf(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
/** Required services: the wire client, the slot registry, and the jobs rosters. */
export const inject = ['connection', 'slots', 'jobs'];
export function apply(ctx) {
    const connection = ctx.get('connection');
    const jobs = ctx.get('jobs');
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
        // Inject share: the jobs store rides the renderer's `hooks` bag (every
        // `hooks.<name>` becomes a `use<Name>` selector prop), and the roster
        // opener + wire call join the spread props.
        inject: () => ({
            hooks: { jobs: jobs?.state },
            watchRows: (sessionId) => jobs?.watchRows(sessionId),
            stopAll,
        }),
    }, HaltJobsPill));
}

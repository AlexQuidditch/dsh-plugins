export const name = 'halt-jobs';
/** Services required before activation: the RPC registry, the job registry, and the agent registry. */
export const inject = ['connection', 'jobs', 'agents'];
/** Logical channel: absolute, one segment, never the reserved `/api`. */
const CHANNEL = '/dsh-halt-jobs';
/** Wire endpoint name. */
const ENDPOINT = 'stop-all';
function failure(code, message) {
    return { ok: false, error: { code, message, details: {} } };
}
/** Read `payload.sessionId` as a non-empty string, or `undefined`. */
function sessionIdOf(payload) {
    if (payload === null || typeof payload !== 'object' || !('sessionId' in payload))
        return undefined;
    const value = payload.sessionId;
    return typeof value === 'string' && value !== '' ? value : undefined;
}
/**
 * Owning session of one job projection. 0.2 `JobView` calls it `owner`;
 * pre-0.2 builds spelled it `ownerSession`, so both are read.
 */
function ownerOf(job) {
    return job.owner ?? job.ownerSession;
}
export function apply(ctx) {
    const jobs = ctx.get('jobs');
    const agents = ctx.get('agents');
    if (jobs === undefined || agents === undefined)
        return;
    ctx.inject(['webServer'], (webCtx) => {
        const connection = webCtx.root.get('connection');
        if (connection === undefined)
            return;
        const dispose = connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
            if (endpoint !== ENDPOINT) {
                return failure('halt-jobs/unknown-endpoint', `unknown endpoint ${JSON.stringify(endpoint)}`);
            }
            const sessionId = sessionIdOf(payload);
            if (sessionId === undefined) {
                return failure('halt-jobs/bad-request', 'payload.sessionId must be a non-empty string');
            }
            // Liveness gate: the session must own a live agent in this process.
            if (agents.get(sessionId) === undefined) {
                return failure('halt-jobs/session-not-live', `no live agent for session ${JSON.stringify(sessionId)}`);
            }
            // The registry's isolation fence compares `job.owner.id === caller`,
            // so the caller argument is the SESSION ID string.
            let owned;
            try {
                owned = jobs.list(sessionId).filter((job) => ownerOf(job) === sessionId);
            }
            catch (error) {
                return failure('halt-jobs/read-failed', error instanceof Error ? error.message : String(error));
            }
            let stopped = 0;
            for (const job of owned) {
                if (job.status !== 'running')
                    continue;
                try {
                    jobs.kill(job.id, sessionId, 'stopped from the session-header stop pill');
                    stopped += 1;
                }
                catch {
                    // One stubborn job never blocks the rest: the pill's count re-reads live state anyway.
                }
            }
            let remaining = 0;
            try {
                for (const job of jobs.list(sessionId)) {
                    if (ownerOf(job) !== sessionId)
                        continue;
                    if (job.status === 'running' || job.status === 'stopping')
                        remaining += 1;
                }
            }
            catch {
                remaining = 0;
            }
            return { ok: true, value: { stopped, remaining } };
        });
        webCtx.effect(() => dispose, 'halt-jobs: rpc channel');
    });
}

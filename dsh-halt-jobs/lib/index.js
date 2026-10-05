//#region lib/types/index.js
const name = "halt-jobs";
/** Services required before activation: the RPC registry, the job registry, and the agent registry. */
const inject = [
	"connection",
	"jobs",
	"agents"
];
/** Logical channel: absolute, one segment, never the reserved `/api`. */
const CHANNEL = "/dsh-halt-jobs";
/** Wire endpoint name. */
const ENDPOINT = "stop-all";
function failure(code, message) {
	return {
		ok: false,
		error: {
			code,
			message,
			details: {}
		}
	};
}
/** Read `payload.sessionId` as a non-empty string, or `undefined`. */
function sessionIdOf(payload) {
	if (payload === null || typeof payload !== "object" || !("sessionId" in payload)) return void 0;
	const value = payload.sessionId;
	return typeof value === "string" && value !== "" ? value : void 0;
}
/**
 * Owning session of one job projection. 0.2 `JobView` calls it `owner`;
 * pre-0.2 builds spelled it `ownerSession`, so both are read.
 */
function ownerOf(job) {
	return job.owner ?? job.ownerSession;
}
function apply(ctx) {
	const jobs = ctx.get("jobs");
	const agents = ctx.get("agents");
	if (jobs === void 0 || agents === void 0) return;
	ctx.inject(["webServer"], (webCtx) => {
		const connection = webCtx.root.get("connection");
		if (connection === void 0) return;
		const dispose = connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
			if (endpoint !== ENDPOINT) return failure("halt-jobs/unknown-endpoint", `unknown endpoint ${JSON.stringify(endpoint)}`);
			const sessionId = sessionIdOf(payload);
			if (sessionId === void 0) return failure("halt-jobs/bad-request", "payload.sessionId must be a non-empty string");
			// Liveness gate: the session must own a live agent in this process.
			if (agents.get(sessionId) === void 0) return failure("halt-jobs/session-not-live", `no live agent for session ${JSON.stringify(sessionId)}`);
			// The registry's isolation fence compares `job.owner.id === caller`,
			// so the caller argument is the SESSION ID string. Passing the Agent
			// object (as 0.1 accepted) matches nothing and silently yields an
			// empty roster.
			let owned;
			try {
				owned = jobs.list(sessionId).filter((job) => ownerOf(job) === sessionId);
			} catch (error) {
				return failure("halt-jobs/read-failed", error instanceof Error ? error.message : String(error));
			}
			let stopped = 0;
			for (const job of owned) {
				if (job.status !== "running") continue;
				try {
					jobs.kill(job.id, sessionId, "stopped from the session-header stop pill");
					stopped += 1;
				} catch {}
			}
			let remaining = 0;
			try {
				for (const job of jobs.list(sessionId)) {
					if (ownerOf(job) !== sessionId) continue;
					if (job.status === "running" || job.status === "stopping") remaining += 1;
				}
			} catch {
				remaining = 0;
			}
			return {
				ok: true,
				value: {
					stopped,
					remaining
				}
			};
		});
		webCtx.effect(() => dispose, "halt-jobs: rpc channel");
	});
}
//#endregion
export { apply, inject, name };

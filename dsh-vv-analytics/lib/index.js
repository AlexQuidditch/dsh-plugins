import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
//#region lib/types/format.js
/**
* Pure cache-hit-rate helpers shared by the host recorder and the browser pill.
* No DOM, no React, no cordis — only numbers and labels.
*/
/**
* Token-weighted cache hit rate of one step or session total.
*
* The denominator is the prompt's traffic — uncached input plus cache reads
* and writes — and the numerator is the cache-read share. A step without any
* prompt traffic yields `undefined` (the "n/a" state), because a misleading 0%
* is worse than no number.
*/
function cacheHitRate(buckets) {
	const prompt = buckets.inputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens;
	if (prompt <= 0) return void 0;
	return buckets.cacheReadTokens / prompt;
}
/** Human label for the pill: "кэш 84%" or "кэш n/a". */
function formatHitRate(rate) {
	if (rate === void 0) return "кэш n/a";
	return `кэш ${Math.round(rate * 100)}%`;
}
/** CSS class tier for a hit rate; undefined rate is the neutral tier. */
function hitRateTier(rate) {
	if (rate === void 0) return "neutral";
	if (rate >= .8) return "green";
	if (rate >= .5) return "yellow";
	return "red";
}
//#endregion
//#region lib/types/index.js
/**
* dsh-vv-analytics, host half.
*
* vv AnalyticsPlugin port, local-only: every completed model step that reports
* provider usage is appended as one JSONL line to
* `<dir>/usage-YYYY-MM.jsonl` (default dir: `$DSH_HOME/vv-analytics`). Nothing
* ever leaves the machine.
*
* The seam is the `llm/stream` waterfall: the listener wraps the stream, lets
* every chunk flow through untouched, captures the terminal usage chunk, and
* writes the record after the stream settles. The record schema is a stable
* contract consumed by the `vvoc analytics cache-hit-rate` CLI.
*
* The browser half (./client) renders the live cache pill from the host's
* tokenUsage projection; the recorder and the pill share ./format.ts.
*/
const name = "vv-analytics";
function numberOr(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function monthOf(now) {
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
function apply(ctx, config = {}) {
	if (config.enabled === false) return;
	const dir = config.dir ?? join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "vv-analytics");
	ctx.on("llm/stream", function usageRecorder(options, next) {
		const upstream = next();
		return (async function* wrapped() {
			let captured;
			try {
				for await (const chunk of upstream) {
					if (chunk !== null && typeof chunk === "object" && chunk.type === "usage" && chunk.usage !== void 0) captured = {
						inputTokens: numberOr(chunk.usage.inputTokens, 0),
						outputTokens: numberOr(chunk.usage.outputTokens, 0),
						cacheReadTokens: numberOr(chunk.usage.cacheReadTokens, 0),
						cacheWriteTokens: numberOr(chunk.usage.cacheWriteTokens, 0)
					};
					yield chunk;
				}
			} finally {
				if (captured !== void 0) {
					const now = /* @__PURE__ */ new Date();
					const record = {
						ts: now.toISOString(),
						sessionId: typeof options.sessionId === "string" ? options.sessionId : null,
						provider: typeof options.provider === "string" ? options.provider : "",
						model: typeof options.model === "string" ? options.model : "",
						purpose: options.purpose === "compaction" || options.purpose === "session-title" ? options.purpose : null,
						...captured
					};
					try {
						mkdirSync(dir, { recursive: true });
						appendFileSync(join(dir, `usage-${monthOf(now)}.jsonl`), `${JSON.stringify(record)}\n`);
					} catch (error) {
						ctx.logger.warn("[vv-analytics] failed to write record: %s", error instanceof Error ? error.message : String(error));
					}
				}
			}
		})();
	}, { global: true });
}
//#endregion
export { apply, cacheHitRate, formatHitRate, hitRateTier, name };

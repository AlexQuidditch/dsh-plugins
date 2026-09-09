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
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
// Re-exported for the vvoc CLI and the activation test (the client preset
// bundles ./format.ts into lib/index.js, so these must ride the host entry).
export { cacheHitRate, formatHitRate, hitRateTier } from './format.js';
export const name = 'vv-analytics';
function numberOr(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function monthOf(now) {
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}
export function apply(ctx, config = {}) {
    if (config.enabled === false)
        return;
    const dir = config.dir ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'vv-analytics');
    // The listener is cast to never: the real 'llm/stream' typing comes from
    // dsh-llm (transitively present in the client devDeps), and a local
    // augmentation would merge overloads whose chunk types we cannot satisfy
    // without importing the runtime packages. The listener only reads options
    // and streams chunks through untouched.
    ctx.on('llm/stream', function usageRecorder(options, next) {
        const upstream = next();
        return (async function* wrapped() {
            let captured;
            try {
                for await (const chunk of upstream) {
                    if (chunk !== null && typeof chunk === 'object' && chunk.type === 'usage' && chunk.usage !== undefined) {
                        captured = {
                            inputTokens: numberOr(chunk.usage.inputTokens, 0),
                            outputTokens: numberOr(chunk.usage.outputTokens, 0),
                            cacheReadTokens: numberOr(chunk.usage.cacheReadTokens, 0),
                            cacheWriteTokens: numberOr(chunk.usage.cacheWriteTokens, 0),
                        };
                    }
                    yield chunk;
                }
            }
            finally {
                if (captured !== undefined) {
                    const now = new Date();
                    const record = {
                        ts: now.toISOString(),
                        sessionId: typeof options.sessionId === 'string' ? options.sessionId : null,
                        provider: typeof options.provider === 'string' ? options.provider : '',
                        model: typeof options.model === 'string' ? options.model : '',
                        purpose: options.purpose === 'compaction' || options.purpose === 'session-title' ? options.purpose : null,
                        ...captured,
                    };
                    try {
                        mkdirSync(dir, { recursive: true });
                        appendFileSync(join(dir, `usage-${monthOf(now)}.jsonl`), `${JSON.stringify(record)}\n`);
                    }
                    catch (error) {
                        ctx.logger.warn('[vv-analytics] failed to write record: %s', error instanceof Error ? error.message : String(error));
                    }
                }
            }
        })();
    }, { global: true });
}

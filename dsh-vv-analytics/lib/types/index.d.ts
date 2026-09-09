import type { Context } from '@deepseek-ai/cordis';
import type { UsageBuckets } from './format.js';
export { cacheHitRate, formatHitRate, hitRateTier } from './format.js';
export type { UsageBuckets, TokenUsageProjection } from './format.js';
export declare const name = "vv-analytics";
/** Bundle config (see cordis.patch.yml). */
export interface VvAnalyticsConfig {
    /** Whether recording is active. Default: true. */
    enabled?: boolean;
    /** JSONL directory; default: $DSH_HOME/vv-analytics (fallback ~/.dsh/vv-analytics). */
    dir?: string;
}
/** One durable JSONL record — the contract `vvoc analytics` reads. */
export interface UsageRecord extends UsageBuckets {
    ts: string;
    sessionId: string | null;
    provider: string;
    model: string;
    purpose: null | 'compaction' | 'session-title';
}
export declare function apply(ctx: Context, config?: VvAnalyticsConfig): void;

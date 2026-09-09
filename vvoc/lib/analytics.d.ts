import { analyticsDir } from './paths.js';
/** One JSONL record as written by dsh-vv-analytics. */
export interface UsageRecord {
    ts: string;
    sessionId: string | null;
    provider: string;
    model: string;
    purpose: null | 'compaction' | 'session-title';
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
}
/** One aggregation bucket. */
export interface Bucket {
    key: string;
    steps: number;
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    /** Token-weighted hit rate, undefined when no cache-eligible prompt traffic. */
    hitRate: number | undefined;
    /** Share of steps whose provider reported any cache token at all. */
    coverage: number;
}
export type GroupBy = 'day' | 'week' | 'month' | 'session' | 'model' | 'provider';
/** Parse --since: Nd/Nw/Nm or YYYY-MM-DD; anything else = epoch 0. */
export declare function parseSince(value: string | undefined): number;
/** Aggregate records into one bucket per group key, insertion-ordered. */
export declare function aggregate(records: UsageRecord[], groupBy: GroupBy): Bucket[];
/** Table the CLI prints; also the shape of --json output. */
export declare function analyticsTable(dir: string, groupBy: GroupBy, since: string | undefined): {
    rows: Bucket[];
    totals: Bucket;
};
export { analyticsDir };

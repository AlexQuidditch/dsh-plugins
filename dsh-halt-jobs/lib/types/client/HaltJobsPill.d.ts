/** Structural slice of one projected background job (the shipped job-list view model). */
export interface HaltJobView {
    id: string;
    kind: string;
    label: string;
    status: string;
    startedAt: number;
    finishedAt?: number;
}
/** Successful `stop-all` payload. */
export interface StopAllValue {
    stopped: number;
    remaining: number;
}
/** Outcome of one stop click, already flattened for the UI. */
export type StopAllOutcome = {
    ok: true;
    value: StopAllValue;
} | {
    ok: false;
    message: string;
};
/**
 * Minimal selector-hook shape over the client jobs store.
 *
 * The snapshot is `{ rows, observed }`, keyed by session id — the 0.2 shape
 * (`ctx.jobs.state`). A session with no live job has no `rows` key at all.
 */
export type UseJobs = <T>(select: (state: {
    rows?: Record<string, readonly HaltJobView[] | undefined>;
}) => T) => T;
/** Open one session's roster stream; the returned release closes it. */
export type WatchRows = (sessionId: string) => (() => void) | undefined;
interface HaltJobsPillProps {
    /** Session whose jobs this pill stops; standard prop of the actions slot. */
    sessionId?: string;
    /** Client-jobs selector hook, provided through `hooks: { jobs }`. */
    useJobs?: UseJobs;
    /** Roster-stream opener from the client `jobs` service (inject share). */
    watchRows?: WatchRows;
    /** Wire call into the host half's `/dsh-halt-jobs` channel (inject share). */
    stopAll: (sessionId: string) => Promise<StopAllOutcome>;
}
export declare function HaltJobsPill({ sessionId, useJobs, watchRows, stopAll }: HaltJobsPillProps): import("react").JSX.Element | null;
export {};

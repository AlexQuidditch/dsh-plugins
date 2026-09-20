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
/** Minimal selector-hook shape over the sessions store. */
export type UseSessions = <T>(select: (state: {
    jobsBySession?: Record<string, readonly HaltJobView[] | undefined>;
}) => T) => T;
interface HaltJobsPillProps {
    /** Session whose jobs this pill stops; standard prop of the actions slot. */
    sessionId?: string;
    /** Sessions-store selector hook; standard prop of the actions slot. */
    useSessions?: UseSessions;
    /** Wire call into the host half's `/dsh-halt-jobs` channel (inject share). */
    stopAll: (sessionId: string) => Promise<StopAllOutcome>;
}
export declare function HaltJobsPill({ sessionId, useSessions, stopAll }: HaltJobsPillProps): import("react").JSX.Element | null;
export {};

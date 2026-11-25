/** Canonical delta digest: sha256 of the ordered -/+ line diff of plan bytes. */
export declare function amendDeltaDigest(beforeText: string, afterText: string): string;
export interface AmendGrant {
    delta: string;
    planBefore: string;
    planAfter: string;
}
export interface AmendVerifyResult {
    ok: boolean;
    mismatches: string[];
    computed: {
        before: string;
        after: string;
        delta: string;
    };
}
/** Verify the applied plan change matches the granted delta + before/after digests. */
export declare function verifyAmendGrant(beforeText: string, afterText: string, grant: AmendGrant): AmendVerifyResult;

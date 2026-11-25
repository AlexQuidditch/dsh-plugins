/**
 * Follow-up #2 — AMEND-GRANT delta auto-verification (P4 Path A enforcement).
 *
 * The AMEND-GRANT records delta=sha256:<hex> plan-before=<digest> plan-after=<digest>.
 * This module makes the binding machine-checked: it computes a canonical line diff of
 * the plan bytes (before→after), hashes it, and verifies the applied change matches the
 * granted delta AND the before/after whole-artifact digests. A grant for a small
 * mechanical delta cannot be used to sneak a larger change (closes "blanket amend
 * authority"). Host-side; the pure lint engine stays zero-dependency.
 */
import { createHash } from 'node:crypto';
function sha256(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
/** Deterministic LCS-based line diff: ordered -/+ operations (canonical for given inputs). */
function lineDiff(beforeLines, afterLines) {
    const m = beforeLines.length;
    const n = afterLines.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i -= 1) {
        for (let j = n - 1; j >= 0; j -= 1) {
            dp[i][j] = beforeLines[i] === afterLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const ops = [];
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
        if (beforeLines[i] === afterLines[j]) {
            i += 1;
            j += 1;
        }
        else if (dp[i + 1][j] >= dp[i][j + 1]) {
            ops.push({ op: '-', line: beforeLines[i] });
            i += 1;
        }
        else {
            ops.push({ op: '+', line: afterLines[j] });
            j += 1;
        }
    }
    while (i < m) {
        ops.push({ op: '-', line: beforeLines[i] });
        i += 1;
    }
    while (j < n) {
        ops.push({ op: '+', line: afterLines[j] });
        j += 1;
    }
    return ops;
}
/** Canonical delta digest: sha256 of the ordered -/+ line diff of plan bytes. */
export function amendDeltaDigest(beforeText, afterText) {
    const ops = lineDiff(beforeText.split('\n'), afterText.split('\n'));
    return sha256(ops.map((op) => `${op.op}${op.line}`).join('\n'));
}
/** Verify the applied plan change matches the granted delta + before/after digests. */
export function verifyAmendGrant(beforeText, afterText, grant) {
    const before = sha256(beforeText);
    const after = sha256(afterText);
    const delta = amendDeltaDigest(beforeText, afterText);
    const mismatches = [];
    if (grant.planBefore !== before)
        mismatches.push('plan-before');
    if (grant.planAfter !== after)
        mismatches.push('plan-after');
    if (grant.delta !== delta)
        mismatches.push('delta');
    return { ok: mismatches.length === 0, mismatches, computed: { before, after, delta } };
}

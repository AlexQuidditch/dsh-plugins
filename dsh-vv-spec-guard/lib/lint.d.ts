/**
 * Deterministic lint engine for .vvoc spec packages — a zero-dependency port of
 * the SpecGuardPlugin contract from vv-opencode.
 *
 * The format contract lives in the vv-controller preset skills (vv-spec,
 * vv-plan): specs and plans are XML with snake_case fields, unique element
 * identities (`COMPONENT-UPPER-KEBAB`, `TASK-T-NNN`, `WAVE-N`), lifecycle
 * statuses draft/approved/applied, and plan architecture components must reuse
 * spec component identities exactly. This module checks those invariants in
 * code so models keep grep/sed as their query layer while drift is caught by
 * the host, not by discipline.
 *
 * No external XML library: a small tag-tokenizer with a stack check is enough
 * for the bounded artifact vocabulary.
 */
/** One lint finding. */
export interface LintFinding {
    /** Stable rule identifier. */
    rule: string;
    /** Human-readable message, Russian. */
    message: string;
}
/** A complete lint verdict. */
export interface LintVerdict {
    errors: LintFinding[];
    warnings: LintFinding[];
}
/** Minimal parsed XML element tree. */
export interface XmlNode {
    name: string;
    attrs: Record<string, string>;
    children: XmlNode[];
    /** Trimmed text directly inside this element (concatenated segments). */
    text?: string;
}
/**
 * Parse a bounded XML document into an element tree.
 *
 * The tokenizer walks the document with a single regex over open/close/self-closing
 * tags, skips comments, declarations, and doctypes, and maintains a stack to
 * detect mismatched or unclosed tags. Text between tags is trimmed and attached
 * to the innermost open element, because several vv-plan references
 * (`<task_id>TASK-T-000</task_id>`) carry their value as text. A malformed
 * document throws instead of returning a partial tree.
 */
export declare function parseXmlLite(text: string): XmlNode;
/** Recorded approval digest for one artifact (last approvals.json entry wins). */
export interface ApprovalRecord {
    /** Lowercase or uppercase SHA-256 hex recorded at approval time (§K). */
    sha256: string;
}
/**
 * Approval-digest options shared by the spec and plan entry points (§K).
 *
 * The host supplies everything: which digest was recorded and what the
 * artifact's current digest is. This engine never touches the filesystem.
 */
export interface LintApprovalOptions {
    /** Sidecar record for this artifact, when approvals.json has one. */
    approval?: ApprovalRecord;
    /** SHA-256 of the artifact's current bytes, computed by the host. */
    currentSha256?: string;
    /** True when a package approvals.json sidecar exists at all. */
    approvalSidecarPresent?: boolean;
}
/**
 * Host-supplied census data for the P1 cross-scope rules (host/engine split): the
 * HOST recomputes the census and passes values in; the pure lint engine only
 * compares. Mirrors the §K host-supplies-digest pattern. When absent, the
 * census-dependent rules degrade to a `census-unavailable` warning (never silent pass).
 */
export interface CensusLintData {
    /** Per-scope hard-edge consumers from the host census (production scopes). */
    perScope?: Array<{
        scope: string;
        hardCount: number;
        edges: Array<{
            kind: string;
            source: string;
            target: string;
        }>;
    }>;
    /** Host re-computed canonical census digest at the pinned ref. */
    outputDigest?: string;
    /** False when the pinned ref is unreachable (shallow clone / GC). */
    refReachable?: boolean;
    /** Declared delete/rename paths that failed resolution at baselineRef. */
    pathUnresolvable?: string[];
    /** The spec-pinned census set for census-incomplete (plan ⊆ spec set). */
    specCensusSet?: {
        symbols: string[];
        paths: string[];
    };
    /** Distinct-production-scope fan-out threshold (overlay-configurable; default 3). */
    fanoutThreshold?: number;
    /** cross-scope-fanout mode: warn (pre-calibration) | error (post-calibration). */
    fanoutMode?: 'warn' | 'error';
    /** cascade-concentration threshold (shared-surface deletes/renames in one task). */
    cascadeThreshold?: number;
}
/** Options for lintSpec. */
export interface SpecLintOptions extends LintApprovalOptions {
    /** Override the lifecycle status (defaults to the root `status` attribute). */
    status?: string;
    /** P1: host-supplied census data for the cross-scope rules. */
    census?: CensusLintData;
}
/** One receipts.jsonl line as far as the lint engine needs it (§L). */
export interface ReceiptLike {
    task_id?: string;
    command?: string;
    exit_code?: number;
}
/** Options for lintPlan. */
export interface PlanLintOptions extends LintApprovalOptions {
    /** Override the lifecycle status (defaults to the root `status` attribute). */
    status?: string;
    /** Sibling spec.xml text, for the architecture component-subset check. */
    specText?: string;
    /** Parsed receipts.jsonl lines (host-provided, malformed lines already dropped). */
    receipts?: ReceiptLike[];
    /** Require receipt coverage even when the plan status is not `applied`. */
    checkReceipts?: boolean;
    /** P1: host-supplied census data (spec-pinned set) for census-incomplete. */
    census?: CensusLintData;
}
/**
 * Lint one spec.xml against the vv-spec contract.
 *
 * Structural checks (well-formedness, root element, package id) apply to every
 * lifecycle state; content-completeness checks (goals, requirements,
 * acceptance) apply only once the spec is approved or applied, because a draft
 * may legitimately have empty sections mid-interview. When the host supplies
 * approval digests, approved/applied specs are also checked for a stale or
 * missing approval (§K).
 */
export declare function lintSpec(text: string, options?: SpecLintOptions): LintVerdict;
/**
 * Lint one plan.xml against the vv-plan contract.
 *
 * Besides the shared structural/status checks, plans must keep task and wave
 * identities unique, reference only existing tasks from <wave> and
 * <depends_on>, stay free of dependency cycles, and — when approved/applied —
 * carry a title, acceptance criterion, and verification command per task.
 * Architecture components must be a subset of the spec's components when the
 * spec text is available; without it the check degrades to a warning.
 *
 * On host-supplied options this also enforces the §K approval digest and the
 * §L receipt-coverage rules: when the plan is `applied` (or `checkReceipts` is
 * true) every declared verification command needs a receipts.jsonl line with
 * `exit_code: 0`.
 */
export declare function lintPlan(text: string, options?: PlanLintOptions): LintVerdict;
/**
 * program-dag (PROGRAM lint): the package DAG is acyclic, every dep-P ref resolves to
 * a declared P node, and every charter component is owned by exactly one package.
 */
export declare function lintProgram(text: string, options?: SpecLintOptions): LintVerdict;
/**
 * unresolved-addendum (P4 read-side): any ADD-NNN whose status is not terminal blocks
 * validate-plan. An addendum recorded by a dead executor must not rot silently — the
 * next invocation sees it here. Host reads impact-addendum.xml and passes the text in.
 */
export declare function lintAddendum(text: string, _options?: SpecLintOptions): LintVerdict;
/**
 * unverified-invariant: any IV-NNN in invariant-verification.xml whose status is not
 * discharged (verified/waived) blocks plan-close. A behavioral GRACE invariant surfaced as
 * at-risk becomes a tracked obligation; it cannot be silently ignored. Pure text check.
 */
export declare function lintInvariantVerification(text: string, _options?: SpecLintOptions): LintVerdict;
/** Fixed risk-category order (hive's five categories, vv-adapted). */
export declare const PLAN_RISK_CATEGORIES: readonly ["auth_secrets_permissions", "destructive_data_schema", "public_compatibility", "concurrency_recovery_ownership", "deployment_release_supply_chain"];
/** One of the five §N risk categories. */
export type PlanRiskCategory = (typeof PLAN_RISK_CATEGORIES)[number];
/** One confirmed risk signal. */
export interface PlanRiskReason {
    category: PlanRiskCategory;
    /** Short evidence: matched path, matched keyword + line, or a secret literal. */
    evidence: string;
}
/** §N risk classification, surfaced by spec_guard_lint as an extra output line. */
export interface PlanRiskResult {
    level: 'standard' | 'mandatory';
    reasons: PlanRiskReason[];
    /** Set when classification had to degrade because the plan XML is unparsable. */
    note?: string;
}
/**
 * §N: classify a plan's review risk from its raw text.
 *
 * Pure and deterministic: the host passes the plan.xml text it already read,
 * and declared `<file>`/`<path>` values plus path-like tokens are matched
 * against the protected globs. A single confirmed signal in any category makes
 * the plan `mandatory` (adversarial lens required, safetyist triage default);
 * zero signals make it `standard`. Unparsable plan text degrades to `standard`
 * with a note because the declared-path extraction cannot be trusted.
 */
export declare function classifyPlanRisk(text: string): PlanRiskResult;

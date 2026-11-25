# P0 seam — cross-scope impact schema contracts

Status: **P0 frozen** (2026-11-25). This directory + the four artifact templates are
the contract seam that P1–P4 consume. P0 defines schemas and rule NAMES; it does
**not** implement enforcement (P1), skill wiring (P2/P3), or execution feedback (P4).

Source of truth: [`hive-research/vv-cross-scope-impact-rd.md`](../../hive-research/vv-cross-scope-impact-rd.md)
§4.1/§4.4/§4.5/§4.6 (proposal body), §14.1/§14.3/§14.5 (agreed design), §19/§20
(round-5/6 revisions). Six adversarial rounds converged the contract to
implementation depth; the TS-compiler-API census decision (operator) is validated
sound with bounded fixes (§20).

## Files and consumers

| File | Kind | Consumed by | Purpose |
|---|---|---|---|
| `census-contract.json` | host tool JSON schema + semantics | **P1** (spec-guard) | `spec_guard_census` input/output + worktree/DI/digest/partition/lifecycle semantics |
| `lint-rules.json` | rule registry | **P1/P3/P4** | rule names + when + owner + mode + inputs; prerequisites (generation gap, CDATA) |
| `../../agent-presets/skills/vv-spec/references/impact-template.xml` | artifact template | **P2** (vv-spec) | the `<impact>` spec section |
| `../../agent-presets/skills/vv-spec/references/paths-template.xml` | artifact template | **P2** (vv-spec) | the `<paths>` spec section (impact-present trigger source) |
| `../../agent-presets/skills/vv-spec/references/program-template.xml` | artifact template | **P2** (vv-spec) | `program.xml` (formalized charter, `.vvoc/programs/<id>/`) |
| `../../agent-presets/skills/vv-plan/references/deletes-template.xml` | artifact template | **P3** (vv-plan) | plan `<deletes>` (D-NNN) structured deletion surface |
| `../../agent-presets/skills/vv-plan/references/renames-template.xml` | artifact template | **P3** (vv-plan) | plan `<renames>` (R-NNN) structured rename surface |

## Schema → enforcement map

- `<paths>` (P-NNN) → `impact-present` trigger.
- `<impact>` census/fanout/S-*/E-NNN → `untouched-contradicted`, `census-impact-coverage`,
  `census-stale`, `census-ref-unreachable`, `cross-scope-fanout`.
- plan `<deletes>/<renames>` (D/R-NNN) → `census-incomplete` (plan ⊆ spec set),
  `census-path-unresolvable`, `cascade-concentration`, `undeclared-deletion` (execution).
- `<consumer-coverage>` + task `<scope>` → `consumer-coverage`.
- `program.xml` P-<Id>/dep-P-*/owns-components → `program-dag`.

## Key invariants frozen in P0 (do not drift in P1–P4)

1. **Host computes, author declares, lint compares.** Census counts/edges/digest are
   host output, never author prose. `census-stale` re-checks against a host re-computation.
2. **Pure-engine boundary.** `lint.ts` stays zero-dependency and never touches the
   filesystem; the census is a separate HOST tool (typescript runtime dep + worktree).
   The host passes `censusDigest`/`censusStale` into `SpecLintOptions` (like §K).
3. **Unique-tag, no attributes.** Repeating entities carry identity in the tag name
   (S-<SCOPE>, E-NNN, D-NNN, R-NNN, P-NNN, IP-NNN, INV-N, dep-P-*). Generic repeating
   children are pairing-lossy and forbidden.
4. **Non-circular precedence.** Spec pins the census set; `census-incomplete` compares
   plan `<deletes>` ⊆ spec set (two artifacts) at PLAN lint.
5. **DI-aware usage.** Nest constructor-param type annotations (emitDecoratorMetadata)
   are runtime edges, not type-only.
6. **Digest pins analyzer state.** Exact typescript version + resolutionStrategy +
   deletedPaths/renamedPairs are in the digest; code-point sort; canonical JSON;
   schemaVersion bump invalidates prior digests.
7. **Worktree ref-pinning.** Mirror pnpm per-entry relative links; FORBID wholesale
   live-node_modules symlink (resolves to live tree). Resolve baselineRef → OID first.
8. **Gate policy.** WARN → recorded choice; ERROR → program forced (no override grant).
   `cross-scope-fanout` ships WARN, flips to ERROR only after archive calibration.

## NOT in P0

- Enforcement code (P1), skill SKILL.md wiring (P2/P3), execution reason codes /
  ADD-NNN addendum / AMEND-GRANT / panel states (P4), CDATA parser (P1 prerequisite).
- v2 items: weighted threshold, transitive census, submodule census, TS-usage precision
  beyond DI, panel impact chip.

## P0 acceptance

- All four XML templates are well-formed and follow the unique-tag/no-attribute convention.
- `census-contract.json` and `lint-rules.json` are valid JSON and faithful to §14.5/§20.
- The dogfood program (`.vvoc/programs/2026-11-25-vv-cross-scope-impact/program.xml`)
  and P0 package spec (`.vvoc/specs/2026-11-25-p0-schema-contracts/spec.xml`) instantiate
  the new schemas (program P-<Id>/dep-P-*, spec `<paths>` P-NNN).
- No existing skill SKILL.md, plugin code, or profile is modified by P0 (additive only).

## P0 verification result (2026-11-25)

- All 5 XML templates + dogfood program.xml + dogfood spec.xml parse with the shipped
  `parseXmlLite` (single root, well-formed). census-contract.json + lint-rules.json
  are valid JSON.
- Dogfood `spec_guard_approve` recorded the spec digest
  (`3072c61f…`, approvals.json sidecar); `spec_guard_lint` approval-unverified resolved.
- **Confirmed P1 prerequisite (generation gap, empirically reproduced):** the dogfood
  spec follows the unique-tag/no-attribute convention, yet `spec_guard_lint` reports
  `[package] <spec> requires a non-empty package attribute`. That rule (lint.ts:341)
  is UNCONDITIONAL — it is not gated by `structuralStatus`, so it fires on unique-tag
  artifacts even though the convention forbids attributes. P1's generation-gap fix
  must gate/remove this legacy rule (and the legacy goals/requirements/acceptance
  completeness vocabulary) for unique-tag artifacts, or read package identity from a
  child element. The current skill spec-template.xml (no attributes) hits the same
  rule. This is expected: P0 freezes the NEW schema; the CURRENT engine predates it.
- The plan.xml-not-found note is expected (P0 is a schema package, no plan yet).
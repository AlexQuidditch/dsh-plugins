# R&D: Cross-scope impact assessment for the vv pipeline

Status: PROPOSAL (not adopted). Date: 2026-11-25.
Provenance: foundation-case driven, NOT hive-derived. Evidence base:
`~/projects/foundation` `.vvoc` artifacts for the `student-learning-subjects` →
CURRICULUM rework (origin package `2026-11-12-education-platform-model`,
schools-restoration charter `2026-11-13-schools-restoration`, work-items
wi-11/13/15/16, handoffs, lessons, `docs/plugin-architecture-graph.xml`).
Pipeline side: `agent-presets/skills/vv-{spec,plan,execute,review}`,
`dsh-vv-spec-guard/src/lint.ts`, `dsh-vv-panel/client.js`,
`.dsh/overlays/repo-runtime.md` (foundation).

This document is the implementation-ready companion to the chat analysis.
It proposes extensions; it changes no skill, plugin, or profile.

---

## 1. Hypothesis under test

> vv-spec needs impact assessment not only by boundary level
> (domain-only / platform / …) but also by affected scopes with change-volume
> estimates; when a change spans multiple scopes, the pipeline must fix the
> work plan sequentially / in parallel.

Verdict: **directionally confirmed, structurally incomplete as stated.**
The missing axis is real and is the primary cause of the CURRICULUM cascade.
But impact assessment alone — without (a) verification of non-impact claims,
(b) a decomposition gate with a program tier, (c) a consumer-coverage contract
in the plan, (d) an execution feedback path, and (e) deterministic enforcement
that actually covers the current artifact generation — reproduces the existing
"Scope check" self-review hint: prose that gets skipped under pressure.

---

## 2. Root-cause analysis (grounded)

### 2.1 The taxonomy escape (primary)

CLASSIFY_BOUNDARY (foundation `.dsh/overlays/repo-runtime.md:90-122`) is a
**vertical** axis: domain-only | app-assembly | platform-extension |
cross-cutting. `cross-cutting` — the only class imposing a per-consumer
migration plan — triggers on *platform interface signatures*, not on
*in-domain consumer scopes*.

The origin spec (archive `2026-11-12-education-platform-model-…/spec.xml:18-23`):

> "CLASSIFY_BOUNDARY: domain-only. All changes land in
> packages/domains/education-platform … No packages/platform/* modifications."

Everything stayed inside one domain package → `domain-only` → **no migration
duty**, while the change fanned out horizontally across curriculum,
examinations, schools, students, enrollments, assessments, organizations,
policies, ledger, sessions, resources, groups. The taxonomy cannot express
"intra-domain cross-scope"; the escape was structural, not negligent.

### 2.2 Assertion instead of verification

The spec's only cross-scope statements are **non-impact assertions**:

- spec.xml:181-183 (C-EXAM-BRIDGE): "examinations v3.18 stays relational and
  internally untouched".
- plan.xml:1870-1872 (T-023): "Survivors untouched: examinations v3.18,
  schedules/schedule_records/meets, whiteboard, students/student_relations …".

Neither is checked against coupling evidence. **CORRECTED 2026-11-25 (see §13):
the census object is the DELETED/RENAMED surface, not the new module.** Verified
against the repo at spec-time (`af92a878^`, before `backend/curriculum` existed)
and at teardown parent (`3843cb35^`):

- `SchoolAuthorizationService` imported by **14 scopes** at spec-time
  (`af92a878^`, symbol-alone census — §15 output): abilities, agent-tools,
  agents-read-models, agents-registry, conversations, **examinations**,
  homework-submissions, owner-access, student-learning-groups,
  student-learning-subject-lessons, student-learning-subject-lessons-homeworks,
  student-learning-subjects, student-subject-journal, students. THIS is the
  deletion fan-out. (A union grep `backend/schools OR SchoolAuthorizationService`
  returns 15 — it adds credential-entities, which imports the schools PATH but
  not the symbol. The reproducible symbol census is 14; examinations is in it,
  so the gate fires either way.)
- The decisive contradiction witness: `backend/examinations/exam.controller.ts`
  line 189 at `3843cb35^`: `import { SchoolAuthorizationService, … } from
  '../schools/school-authorization.service'` — a live runtime-import (GRACE
  contract lines 21, 88 name resolvePlatformOrSchoolStaffScope). examinations ∈
  SchoolAuthorizationService consumers.
- `backend/curriculum` at teardown parent (`3843cb35^`, `../curriculum/` importers
  excl. curriculum) = **4 scopes / 9 files**: assessments (1), enrollments (6, four
  tests), policies (1 test), sessions (1 test) — NOT 8 scopes. The "8 scopes" census
  is a present-day (HEAD) fact accumulated Nov 13–25, NOT available on Nov 12.
- `examinations/services/curriculum-tree.service.ts` first appears in commit
  `0fa596c6` (Nov 25, "remove the examination taxonomy"), contract links spec
  `2026-11-24-curriculum-question-binding`. It did NOT exist on Nov 12. The
  earlier draft cited it anachronistically; that citation is withdrawn.
- Shared Drizzle schema barrel `src/db/schemas/index.ts`: a table drop is a
  compile event in every consumer scope. Contract barrel `src/contracts`: at
  `af92a878^` = 28 files / 23 `*.contracts.ts` (the earlier "49" was HEAD's
  directory count — wrong ref + suffix); 8 slices deleted together by T-023.

"examinations internally untouched" is **contradicted by the schools deletion
census** (examinations → SchoolAuthorizationService), available before the first
task. The pipeline had no rule turning that contradiction into a stop.

### 2.3 Cascade concentration in one task

T-023 (plan.xml:1848-1895), `<file>` = `src/backend/education-platform.entry.ts`
(single file), simultaneously:

- deletes 7 db schemas (incl. `schools.ts`, `student-learning-subjects.ts`),
- deletes 7 Nest modules + 8 contract slices,
- rewires 4 consumer read models (DashboardModule, school-exam-dashboard,
  school-staff-portal, student-context, owner-access scoping),
- drops tables + old materials columns.

4 acceptance criteria (AC-095…098), all compile/grep-level. The entire
cross-scope consequence of an 11-wave / 27-task / 108-AC plan is one task with
one file target and four mechanical ACs. Declared FE file targets in the whole
plan: **two** new widget directories — while the schools scope held **154 FE
files** (wi-13 §0.1).

Teardown commit `3843cb35`: 333 deleted files, 525 affected, **−91,131 lines**.

### 2.4 Green gates could not see product behavior

`2026-11-14-curriculum-e2e-fixes/spec.xml`:

> "The archived packages stay applied and are NOT reopened; this package
> repairs behavior that their green gates could not see."

Verification was typecheck + unit + `domain-feature` overlay. The post-archive
browser role matrix then produced wi-15's 10-item drift backlog. Enumeration
of consumers is necessary but not sufficient: consumer surfaces need
**behavioral** ACs, not compile ACs.

### 2.5 The plan's own code introduced cross-scope regressions

handoff `2026-11-12-education-review-fixes-follow-ups.md`:

- B1: tutors resolve no organizationId → FORBIDDEN on **all nine** tenant-scoped
  surfaces. "Pre-plan tutors read everything unscoped; post-plan they get nothing."
- M1: `resolveOwnerPolicyFromCredentials` ORs legacy `platformStudentsReadAny`
  (the plan's own T-003 snippet) → read-only roster operator can enroll/withdraw/
  author/publish/delete across nine surfaces.

Cascade is not only "missing surfaces" but **active breakage introduced by the
plan** in scopes it declared untouched.

### 2.6 Late-formalized implicit premise

wi-16 (dated 11-15, **three days after** the origin spec):

> "Access to each subject implicitly grants access to the corresponding
> subject in the Exam Constructor … FORMALIZE the implicit premise … BEFORE
> the Curriculum rework."

The coupling existed in code; the spec never formalized the behavioral rule
riding it. Impact census would have surfaced the edge; an "implicit premises"
interview step would have surfaced the rule.

### 2.7 Deleted scope was documented-incomplete

wi-11 (open since 10-26): 60+ unimplemented schools-scope findings. The scope
being deleted was already known incomplete — which is why restoration cost 13
packages. A "which work-items reference the surfaces I am deleting" check would
have flagged it.

### 2.8 The operator invented the missing tier

wi-13 §0.1: **"Восстановление — это программа, а не одна правка."**
§0.5: **"Ни одна действующая спека не покрывает это восстановление."**

Charter `2026-11-13-schools-restoration` (the day AFTER teardown): 19 components,
13 packages R0a–R8, dependency-ordered ("R0a..R0e precede their consuming UI
packages; R1 precedes R2..R7; R8 is last"), invariants INV-1..10, decisions
D1..D21. Each round's spec re-derives its scope; sequencing is prose; the
charter sits OUTSIDE spec→plan→execute. This is the pipeline's missing
**program tier**, retrofitted by hand.

### 2.9 Graph blind spots (why graph-only traversal fails)

`docs/plugin-architecture-graph.xml` header: "the other deleted slices never
had graph nodes, which makes that half of the removal a recorded no-op."
12 dead FILE attributes recorded, not fixed (INV-R8-4 forbids wholesale repair).
The decisive Nov-12 edge `examinations → SchoolAuthorizationService (schools)`
is a runtime import the module-granular graph does not record as a consumer
edge. (The later `examinations.curriculum-tree → curriculum` edge also has no
graph node, but it postdates the teardown — §13.1.) The graph is module-granular,
not consumer-granular, and lagged the cascade. Import census catches what the
graph misses.

### 2.10 Pipeline-side structural gaps (independent of the case)

1. **Lint generation gap.** `dsh-vv-spec-guard/src/lint.ts:153-164`:
   structural rules (identity, cycles, completeness, dependency refs) apply
   ONLY to legacy attribute-based artifacts (`COMPONENT-*`, `TASK-T-NNN`,
   `WAVE-N`, root `package` attr). Current unique-tag artifacts (`C-*`,
   `T-NNN`, `wave-N`, child `<status>`) are "structurally validated by the
   preset, not here" — they receive only §K (digest), §L (receipts), §N (risk).
   Confirmed in shipped `lib/lint.js`. Any new structural gate must close this
   gap or be generation-neutral.
2. **Bounded-work review blindness.** vv-review `bounded_work`: ~32 KB, no
   repository-wide searches, read only paths named in dispatch. Reviewers
   structurally cannot discover missing consumer scopes. Impact assessment
   must shift left to spec/plan, where exploration is allowed.
3. **Hints without teeth.** vv-spec self_review "Scope check: … focused enough
   for a single implementation plan, or … decomposition into sub-projects?"
   and depth-estimate ≥12-15 → "propose decomposition" are prose hints. The
   case proves they don't fire under delivery pressure.
4. **No structured execution feedback for discovered cascade.** Status envelope
   has NEEDS_CONTEXT/BLOCKED + PLAN_CONTRADICTION, but no "scope cascade
   discovered" path that feeds a controlled amendment. It degenerates into
   operator chat (472 commits/12 days; 26/60 newest are vv bookkeeping).

---

## 3. Critique

### 3.1 Of the hypothesis as stated

- **Right**: the horizontal fan-out axis is missing and is the primary cause.
  Volume matters. Sequencing must be fixed, not improvised.
- **Insufficient**: a prose impact section without verification of non-impact
  claims, a decomposition gate, a plan consumer-coverage contract, execution
  feedback, and generation-aware enforcement will be skipped exactly like the
  existing scope-check hint. The teeth are the contribution, not the section.
- **Under-specified**: "fix sequentially/parallel" must distinguish *within one
  plan* (scope-barrier waves) from *across packages* (program charter). The case
  shows the latter was needed: 11 waves / 27 tasks still missed, because later
  contracts depend on earlier waves' emergent outcomes. More waves in one giant
  plan is not the fix; package boundaries with re-spec gates are.

### 3.2 Of naive fixes (alternatives rejected)

| Alternative | Why rejected |
|---|---|
| A. Prose impact section only | No teeth; existing scope-check hint already proves skip-under-pressure. |
| B. Add a 5th CLASSIFY_BOUNDARY class "cross-scope" | Conflates vertical and horizontal. A change is domain-only AND cross-scope; need an orthogonal axis, not a fifth class. |
| C. Rely on adversarial review to catch cascade | Bounded-work blindness (§2.10.2); review cannot search the repo. Shift left. |
| D. One giant plan with more waves | Emergent design; contract knowability; case disproves (11 waves missed). |
| E. Graph-only impact traversal | Proven blind spots (§2.9): absent nodes, missing decisive edge, module granularity. Census primary, graph supplementary. |
| F. LLM-estimated volume as a hard gate | Unreliable; ground thresholds in deterministic counts, estimates advisory only. |
| G. Universal mandatory impact step | DX regression for small tasks (the majority). Tier/trigger-gate it. |
| H. Full program-management engine (SQLite/daemon) | hive deliberately did not adopt; keep XML + lint + panel. |

### 3.3 Of the proposal itself (pre-empted failure modes)

- Import census precision (SUPERSEDED by §14.1, round-4 F10): type-import counts
  as a hard compile dependency; imports are a primary fan-out signal. Transitive
  not computed v1; incidental is advisory. Over-report is bounded by direct-only
  census + test/generated exclusion (F8), not by demoting imports.
- Thresholds arbitrary → calibrate per-repo via overlay; the case is one data
  point, not a universal constant.
- Charter heavyweight → lightweight program declaration (package list + DAG +
  seams) for medium fan-out; full charter (invariants/decisions) only for
  formal/large.
- Execution feedback stalls everything → bound it: record addendum, continue
  unaffected waves, gate only the affected seam; operator decision via existing
  dossier/grant machinery.
- "Implicit premises" step balloons interview → bound to detected cross-scope
  edges, one question per edge cluster, recommendation-first.

---

## 4. Proposal

Design principle: **add an orthogonal horizontal axis, ground it in
deterministic repo signals, give it teeth via lint + contradiction rules, and
formalize the program tier the operator already invented.** Reuse existing
machinery: unique-tag XML, §K digests, receipts, grants, decision dossiers,
panel state, graph-protocol closeout.

### 4.1 New spec section `<impact>` (vv-spec)

Unique-tag, no attributes. `S-<SCOPE>` repeating entities; generic wrappers.

CORRECTED inline 2026-11-25 (second grok review): census object = the DELETED
surface; counts are HOST-computed (`spec_guard_census`), not author prose;
deferral targets are explicit node refs, not ranges. Example uses the verified
Nov-12 witness (§13.1, §15 output).

```xml
<impact>
  <census>
    <tool>spec_guard_census</tool>
    <ref>af92a878^</ref>
    <scope-dir>packages/domains/education-platform</scope-dir>
    <deleted-symbols>SchoolAuthorizationService</deleted-symbols>
    <output-digest>&lt;sha256 of canonical host census output, §14.3&gt;</output-digest>
  </census>
  <!-- Example censuses the verified witness symbol alone (§15.1 → 14 scopes).
       The full deletion surface (schools, student-learning-subjects, modules,
       schema/contract slices) is declared in plan <deletes>/<renames> (§4.5) and
       censused per symbol; fan-out aggregates hard-edge consumer scopes. -->
  <fanout>
    <consumer-scopes>14</consumer-scopes>
    <consumer-files>49</consumer-files>
    <non-test-files>24</non-test-files>
  </fanout>
  <S-SCHOOLS>
    <role>owner</role>
    <change-kind>data</change-kind>
    <evidence>src/backend/schools/**, src/db/schemas/schools.ts (deletion surface; per-scope file counts come from census output, not prose)</evidence>
  </S-SCHOOLS>
  <S-EXAMINATIONS>
    <role>consumer</role>
    <change-kind>policy</change-kind>
    <edges>
      <E-001><kind>runtime-import</kind><source>examinations/exam.controller.ts</source><target>SchoolAuthorizationService</target><display-line>189</display-line></E-001>
    </edges>
    <disposition>cover-in-plan</disposition>
  </S-EXAMINATIONS>
  <S-STUDENTS>
    <role>consumer</role>
    <change-kind>surface</change-kind>
    <edges>
      <E-002><kind>runtime-import</kind><source>students/…</source><target>SchoolAuthorizationService</target></E-002>
    </edges>
    <disposition>defer-to-program</disposition>
    <deferral-target><dep-P-R4/></deferral-target>
  </S-STUDENTS>
  <S-BILLING>
    <role>bystander</role>
    <change-kind>none</change-kind>
    <disposition>verified-untouched</disposition>
    <untouched-verification>
      <hard-edges>0</hard-edges>
      <census-ref>af92a878^</census-ref>
      <behavioral-justification>billing reads organization payer coordinate, not schools authorization; no policy/access rule rides the deleted surface (interview-confirmed)</behavioral-justification>
    </untouched-verification>
  </S-BILLING>
  <implicit-premises>
    <IP-001>course assignment ⇒ per-subject exam access (rides examinations↔subjects wiring; wi-16)</IP-001>
  </implicit-premises>
  <decomposition>program</decomposition>
  <program>.vvoc/programs/2026-11-12-education-model/program.xml</program>
</impact>
```

Rules (agreed §14):
- `disposition` ∈ cover-in-plan | defer-to-program | verified-untouched.
- `fanout` and per-scope `files`/`edges` are NUMERIC/host-computed from
  `spec_guard_census` output; lint thresholds read numbers, never author prose.
- `verified-untouched` REQUIRES host census `hard-edges=0` at the pinned ref
  PLUS a `behavioral-justification` (zero hard edges is a signal, not proof —
  §14.1). A detected hard edge into a declared-untouched scope is error
  `untouched-contradicted` (extends the domain-only→platform-edit contradiction
  pattern, vv-spec SKILL.md:109).
- `deferral-target` uses explicit node refs (`<dep-P-R4/>`), never a range
  string; `program-dag` validates each ref against a P node.
- **Census input is plan-derived, not free-supplied (§14.1 teeth hole):** the
  `deleted-symbols` list MUST cover every file/symbol the plan deletes or
  renames. lint cross-checks the plan's deletion set against the census request;
  a deleted file present in the plan but absent from the census request → error
  `census-incomplete`. An empty/truncated list cannot honestly yield zero edges.
- `implicit-premises` enumerates behavioral rules riding detected couplings.

### 4.2 New interview step: SCOPE_IMPACT pass (vv-spec)

After CLASSIFY_BOUNDARY (vertical stays), before the decision-tree roadmap.
Trigger-gated, not universal:

- Tier 1 (sketch): skip (local/single-file by definition).
- Tier 2/3: run when the change touches a shared entity/schema/contract barrel,
  OR the census fan-out crosses a threshold.
- Method: import census + schema/contract barrel analysis + work-item reference
  check + graph traversal (supplementary). One confirmation question to the
  user, recommendation-first, per the existing interview card format.
- Output: the `<impact>` section. Non-impact claims are verified, not asserted.

### 4.3 Decomposition gate (vv-spec)

Deterministic thresholds (per-repo configurable via overlay; initial proposal):

- ≥3 consumer scopes with contract/data change-kind, OR
- ≥N forced consumer files (calibrate; case: 154 FE + 24 import files), OR
- a task would delete/rename ≥N shared contracts or rewire ≥M consumer read
  models (cascade-concentration signal).

When fired, the required outcome depends on the rule mode (§14.2; round-3 F13
policy = **force program above ERROR threshold**):
- **WARN mode** (pre-calibration): the spec MUST either (a) declare a program, or
  (b) record an explicit operator acknowledgment choosing single-package. The
  choice is visible and recorded — the silent escape is gone, but single-package
  is still permitted while the threshold is advisory.
- **ERROR mode** (post-calibration): the spec MUST declare a program. The
  single-package grant is UNAVAILABLE above the threshold — program or nothing.
  This closes the escape §9 names as the case's failure.

This formalizes the existing "Scope check" hint into a gate with teeth. The
counterfactual (§5): at Nov-12 the gate is WARN (no calibration yet); the operator
SEES the 14-scope fan-out and either decomposes or records an override — the
"domain-only imposed nothing" silent escape cannot recur.

### 4.4 Program tier (formalize the charter)

New artifact `.vvoc/programs/<id>/program.xml` — **layout DECIDED (round-3 F17):
dedicated `.vvoc/programs/` home**, because programs span packages (a sibling-of-
specs home would tie a multi-package program to one package). The §4.1 example and
P0 freeze assume this path. Unique-tag:

```xml
<program>
  <status>draft</status>
  <goal>Restore/replace … across scopes …</goal>
  <origin-spec>.vvoc/specs/<id>/spec.xml</origin-spec>
  <components>
    <C-LIFECYCLE>…</C-LIFECYCLE>
  </components>
  <packages>
    <P-R0A>
      <title>contracts: lifecycle + organization summary</title>
      <spec></spec>
      <owns-components>C-LIFECYCLE, C-ORG-SUMMARY</owns-components>
      <depends_on></depends_on>
      <seam-contract>…</seam-contract>
      <status>pending</status>
    </P-R0A>
    <P-R1>
      <title>operator shell</title>
      <depends_on><dep-P-R0A/><dep-P-R0B/><dep-P-R0C/><dep-P-R0D/><dep-P-R0E/></depends_on>
      …
    </P-R1>
  </packages>
  <invariants>
    <INV-1>…</INV-1>
  </invariants>
  <sequencing>R0 contracts precede consuming UI; R1 precedes R2..R7; R8 last.</sequencing>
</program>
```

- Each package spec links `<program>` path + `<package-id>`; each plan inherits.
- Lightweight variant: just packages + DAG + seams (medium fan-out). Full
  charter adds invariants/decisions (formal/large).
- The charter's prose sequencing becomes a grep-able DAG (`dep-P-*`).
- vv-spec produces the program + first package spec; subsequent packages are
  separate vv-spec invocations bound to the program.

### 4.5 Plan consumer-coverage contract (vv-plan)

- Task-level `<scope>` tag (which scope the task belongs to).
- Wave-level `<scope-barrier>`: a wave changing a shared contract must include
  ALL its consumer updates in the same wave OR explicitly defer to a named
  later wave/package with a tracking item.
- New `<consumer-coverage>` section mapping each spec `<impact>` consumer scope
  → task ids or deferral target.
- **Structured deletion surface (P0, F1/F3 — unique-tag, the deterministic census
  input):** every destructive task MUST declare what it removes/renames with unique
  identities (not generic repeating children, which are pairing-lossy):
  `<deletes><D-001><path>src/db/schemas/schools.ts</path></D-001><D-002>…</D-002></deletes>`
  and `<renames><R-001><from>student-learning-subjects</from><to>curriculum_nodes</to></R-001>…</renames>`.
  The HOST extracts each deleted path's exported symbols via the TS compiler API at
  baselineRef (§14.5) — `<path>` need not hand-list symbols. A destructive task
  without `<deletes>/<renames>` is a plan failure (like an empty `<acceptance>`).
  **Precedence (non-circular):** the SPEC pins the census set; `census-incomplete`
  runs at PLAN lint and checks plan `<deletes>/<renames>` ⊆ the spec-pinned set (two
  distinct artifacts, not a set compared to a request derived from itself).
  Deterministic, not NLP-over-`<description>` prose (0/103 existing plans have these).
- Parallel-safe waves = scopes with no shared edges; sequential barriers =
  contract producer before consumers. This is the "fix sequentially/parallel"
  part, grounded in the impact matrix.
- Behavioral ACs (browser/e2e) are required ONLY for consumer edges whose
  `change-kind` ∈ {surface, policy} (UI/behavior/access). contract/data renames
  verified by typecheck + migration receipt do NOT require a browser matrix
  (second grok review: universal e2e on every cross-scope surface over-reaches
  and falls into the grant-economy of assertion-weakening). The case broke
  access rules and tutor scope (policy/surface) — those get behavioral closeout;
  a schema rename gets compile + receipt. Addresses §2.4 without over-reach.

### 4.6 Deterministic enforcement (dsh-vv-spec-guard)

Prerequisites (round-3):
- Close the lint generation gap (§2.10.1) — extend structural rules to unique-tag
  artifacts, or make new rules generation-neutral.
- **CDATA-aware tokenization in `parseXmlLite` (F4):** the shipped tokenizer has
  no CDATA handling; `<` inside a snippet payload (TS generics/JSX) is tokenized
  as markup and real archived plans throw (verified: `</snippet> closes
  <TeacherUiPolicy>`). Plan-derived rules (`census-incomplete`,
  `consumer-coverage`) MUST be SKIPPED with a reported warning on parse failure,
  never silently passed. CDATA handling is a P1 prerequisite, not optional.

New rules (names consistent with existing `rule:` vocabulary; agreed §14):
- `impact-present`: spec whose structured `<paths>` (unique P-NNN, §14.5) touch a
  shared surface (`db/schemas/`, `contracts/`, migrations) must have `<impact>`.
  Path-triggered from a DECLARED schema field, NOT tier (0/107 specs persist tier)
  and NOT raw prose (round-4 F5: the spec had no path field and PATH_RISK_RULES lacks
  db/schemas/contracts; the trigger source is now the explicit `<paths>` schema).
- `untouched-contradicted`: a host-census HARD edge (runtime-import / schema-barrel
  / contract-barrel; type-import is hard for contradiction, compile-only for
  closeout) into a scope declared `verified-untouched` → error. Replaces the
  withdrawn author-supplied "zero-edge grep" check: the HOST computes edges via
  `spec_guard_census`, lint compares the disposition against host output.
- `census-incomplete` (PLAN lint, F1/F7): a path/symbol in the plan's structured
  `<deletes>/<renames>` (§4.5) is absent from the SPEC-pinned census set → ERROR.
  Compares two distinct artifacts (plan set vs spec set), not a set against a request
  derived from itself. Declared-set consistency at plan time; undeclared deletions
  are caught at execution by `undeclared-deletion` (below), NOT "at the source".
- `census-impact-coverage` (F2): every consumer scope the HOST census returns with
  ≥1 hard edge MUST appear as an `S-<SCOPE>` in `<impact>` with disposition
  cover-in-plan or defer-to-program. NO exclusion bypass in v1 (the undefined
  "recorded exclusion with a grant" hatch is removed — round-4 F2). Closes the
  omission bypass; the impact matrix is checked against host output.
- `census-stale`: claimed fan-out / output-digest ≠ host re-computation at the
  pinned ref → error (teeth against author-gamed counts; analogous to §K).
- `stale-impact`: execution pre-flight finds new consumer edges at current HEAD
  vs the pinned baseline → warning/drift gate (repo moved approve→execute).
- `census-ref-unreachable`: pinned ref absent (shallow clone / GC) → error.
- `census-path-unresolvable` (round-6 F11): a declared delete/rename `from` path fails
  module resolution at baselineRef → error (not silent zero edges / false "no consumers").
- `undeclared-deletion` (EXECUTE commit, P4, F7): `git diff` at the task commit shows
  a deleted/renamed path or symbol absent from the plan's `<deletes>/<renames>` →
  ERROR. Diff base = pinned baseline OID; scope = the task's declared file set;
  comparison = deleted paths/exports vs the structured deletion set. The execution-
  time backstop for under-declaration that spec/plan lint cannot see.
- `consumer-coverage`: every consumer scope in spec `<impact>` maps to ≥1 plan
  task `<scope>` or an explicit deferral with a valid target node ref.
- `cascade-concentration`: a single task deleting/renaming ≥N shared contracts
  or rewiring ≥M consumer read models → error requiring split or program.
- `program-dag`: program package DAG acyclic; every component owned exactly once;
  every package spec links back; every deferral node ref resolves to a P node.
- `cross-scope-fanout` (§N risk category `cross_scope_cascade`): fan-out ≥
  threshold. **Mode is warn|error per rule (§14.2):** WARN until archive
  calibration (recorded operator acknowledgment), then ERROR. High-precision
  `untouched-contradicted` goes error early; lower-precision fan-out threshold
  stays warn until calibrated. Surfaced as `risk: warn|mandatory
  (cross_scope_cascade: <N> scopes)`.

### 4.7 Execution feedback (vv-execute)

- New reason code `SCOPE_CASCADE_DISCOVERED` in the status envelope (or a
  structured PLAN_CONTRADICTION payload naming the discovered consumer edge).
- Executor: on discovery, stop the affected wave, write `impact-addendum.xml`
  in the package, route to a controlled amendment (the §K re-approval digest
  flow already exists), continue unaffected waves. NOT operator chat.
- assess-plan: flag cascade-concentrated tasks; require behavioral ACs for
  consumer edges of change-kind surface/policy (§4.5); mid-execution re-lint of
  impact when a task changes a shared contract.

### 4.8 Review integration (vv-review)

- Dispatcher MUST name consumer-scope entry files in reviewer dispatch
  (overcomes bounded-work blindness without violating the bound).
- Coverage ledger row `scope_impact_coverage`.
- Adversarial brief extended: "which consumer scopes does this plan assert
  untouched, and what coupling evidence contradicts that?"

### 4.9 Panel (optional, v2)

- Impact summary on the state chip tooltip (scopes / surfaces / fan-out).
- Program state rollup when a program.xml exists. No new core state needed;
  impact rides existing lint output / chip.

### 4.10 Tier gating summary (DX preservation)

| Tier | Impact pass | Decomposition gate | Program tier |
|---|---|---|---|
| 1 sketch | skip | skip | n/a |
| 2 standard | light census when shared contract touched | fires on threshold | lightweight declaration |
| 3 formal | full matrix + implicit premises | mandatory when fired | full charter |

Trigger-based, prefill-and-confirm compatible. Small tasks unaffected.

---

## 5. Counterfactual validation

Replay the CURRICULUM origin against the proposed gates:

CORRECTED 2026-11-25 (§13). Census object = deleted/renamed surface; witness
verified at spec-time `af92a878^`, not at HEAD.

| Gate | Fires? | Evidence (temporally verified) |
|---|---|---|
| Deletion census (host-executed) | YES | `schools`/`SchoolAuthorizationService` ← 14 scopes at spec-time; 7 deleted schemas; 8 contract slices |
| untouched-verified contradiction | YES | "examinations internally untouched" vs examinations→SchoolAuthorizationService (exam.controller.ts) |
| fan-out threshold | YES | 14 consumer scopes on the deletion surface + 154 schools FE files + 7 forced migrations |
| cascade-concentration | YES | T-023: 7 tables + 7 modules + 8 slices + 4 read-model rewires, one `<file>`, 4 compile ACs |
| work-item reference check (vv-spec interview step, P2 — NOT a lint rule) | YES | wi-11: 60+ open schools findings on the deleted scope |
| decomposition gate | YES → recorded choice | WARN mode (Nov-12, pre-calibration): operator sees 14-scope fan-out, records program OR single-package override; ERROR mode would force program |

What the gate does NOT do: author the charter CONTENT. The R0a–R8 sequencing,
INV-1..10, D1..D21 are emergent design work, not census output. §11.1's
knowability discriminator and wi-16 (3 days late) are exactly the unknowable
contracts that surface DURING execution → Path C (stop seam, spawn package).
Corrected claim (round-3 F13): the gate fires Nov 12 and forces an EXPLICIT
RECORDED CHOICE before the false teardown — in WARN mode (pre-calibration) the
operator sees the 14-scope fan-out and records program or single-package override;
in ERROR mode (post-calibration) program is forced (grant unavailable). The silent
"domain-only imposed nothing" escape cannot recur. The program's detailed
invariants/decisions emerge through the sequenced packages, some via Path C. The
earlier "charter produced Nov 12" / "forces a program" overclaims are withdrawn.

Falsifiable prediction (corrected): the host-executed DELETION census on
`schools`/`student-learning-subjects` at spec-time returns ≥14 consumer scopes
including examinations, contradicting the untouched assertion. Verified TRUE
against `af92a878^`. The earlier curriculum-tree witness was anachronistic and
failed this criterion; the corrected witness passes it.

---

## 6. Risks and open questions

- **Threshold calibration**: one case is not a distribution. Calibrate on more
  foundation history (the archive has 30+ packages); make thresholds overlay-
  configurable, not skill-hardcoded.
- **Census precision** (SUPERSEDED by §14.1, round-4 F10): type-import is HARD for
  contradiction and counts in fan-out (compile dependency); imports are a PRIMARY
  fan-out signal, not secondary. Transitive not computed v1; incidental (policy/
  access naming) is the advisory residue. The earlier "type-only over-report /
  imports secondary" wording is withdrawn.
- **Program layout**: DECIDED (F17) = `.vvoc/programs/<id>/program.xml` (programs
  span packages; dedicated home). The panel/lint learn this directory in P0/P1.
- **Lint generation gap**: closing it is a prerequisite and a behavior change
  for existing unique-tag packages (they may start failing structural checks
  they previously skipped). Needs a migration/compat decision.
- **Charter weight**: lightweight vs full must be clearly trigger-separated, or
  medium tasks get over-formalized.
- **Execution amendment loop**: could stall delivery if every discovered edge
  gates the whole plan. Bound to the affected seam; continue unaffected waves.
- **Adoption surface**: changes span vv-spec, vv-plan, vv-execute, vv-review,
  spec-guard lint, panel, vocabulary doc, and the foundation overlay. This is a
  multi-workstream wave like the hive adoption ([S]/[G]/[P]); sequence it.

---

## 7. Incremental rollout (CORRECTED — see §9 reframe)

The original v1→v2→v3 feature-increment split is WITHDRAWN (§9): v1 without the
program tier does not fix the case (its gate can only produce the single-package
escape that failed). The accepted rollout is one coherent program, internally
sequenced contract-first (P0–P4, §9 table), with panel/v2-items as the optional
tail (P5):

- **Minimal coherent unit (P0–P4):** orthogonal impact axis + host-executed
  deletion census (`spec_guard_census`) + `untouched-contradicted` /
  `census-incomplete` / `census-stale` teeth + program tier on a fired threshold
  (lightweight form for medium fan-out) + plan consumer-coverage + lint
  generation-gap fix + behavioral closeout for change-kind surface/policy.
- **Calibration before error-mode (§14.2):** `cross-scope-fanout` ships in WARN;
  flips to ERROR only after the archive calibration pass (in P1) confirms it
  fires on the schools deletion surface, not on local-feature noise.
  `untouched-contradicted` (high precision) goes error early.
- **Optional tail (P5):** panel impact chip, program rollup, v2 items (weighted
  threshold, transitive census, submodule census).

The unit is testable against the corrected counterfactual (§5, §15): census at
ref `af92a878^` on the schools deletion surface returns 14 consumer scopes
including examinations.

---

## 8. Evidence index (verbatim sources)

All paths relative to `~/projects/foundation` unless noted.

- Origin spec/plan: `.vvoc/specs/archive/2026-11-12-education-platform-model-20261112T164651Z/{spec.xml,plan.xml}`
  - boundary: spec.xml:18-23; examinations untouched: spec.xml:181-183;
    T-023: plan.xml:1848-1895; survivors: plan.xml:1870-1872; waves: plan.xml:18.
- Charter: `.vvoc/specs/archive/2026-11-13-schools-restoration-20261116T135456Z/spec.xml`
  - self-definition: 3-12; sequencing: 77-94; invariants: 102-120.
- wi-13: `.vvoc/work-items/wi-13-schools-restoration.md` §0.1, §0.5, §1.1.
- wi-16: `.vvoc/work-items/wi-16-course-subject-exam-access.md` (11-15).
- wi-11: `.vvoc/work-items/wi-11-schools-implementation-gaps.md` (10-26, 60+ findings).
- wi-15: `.vvoc/work-items/wi-15-e2e-follow-ups.md` (11-14).
- handoff B1/M1: `.vvoc/handoff/2026-11-12-education-review-fixes-follow-ups.md`.
- e2e-fixes goal: `.vvoc/specs/archive/2026-11-14-curriculum-e2e-fixes-…/spec.xml`.
- deferred-findings: `.vvoc/specs/archive/2026-11-24-curriculum-question-binding-…/reviews/deferred-findings.md`.
- migration lesson: `.vvoc/lessons/2026-11-24-migration-slot-burned-outside-the-journal.md`.
- graph: `docs/plugin-architecture-graph.xml` header L27-52; Layer 7g L4280-4282.
- overlay: `.dsh/overlays/repo-runtime.md:90-122`.
- Pipeline (this repo): `agent-presets/skills/vv-spec/SKILL.md:107-111,184`;
  `vv-plan/SKILL.md:157-170`; `vv-review/SKILL.md:74-78`;
  `dsh-vv-spec-guard/src/lint.ts:153-164,512-755`; `dsh-vv-panel/client.js:70-95`.

Missing/unverifiable (recorded, not invented): wi-13 `parts/A..E` directory
exists but is empty; charter claims 19 components vs 21 C-* tags present;
no explicit retrospective "the plan failed because…" verdict file exists —
coverage-failure statements are in wi-13 §0.5, e2e-fixes goal, deferred-findings.

---

## 9. Rollout reframe (supersedes §7)

§7 proposed v1 (minimal teeth) → v2 (program) → v3 (panel). Operator objection
(2026-11-25): "мы закопаемся в реализации, и до отработки v2-3 работа вообще не
дойдёт." The objection is correct, and the weakness is specific:

**v1 as defined does not fix the case.** Its decomposition gate, without the
program tier, can only produce "cover everything in one plan" (the giant-plan
anti-pattern) or "operator justifies single-package" (the exact escape that
failed). The CURRICULUM case's correct answer was a 13-package PROGRAM. v1 adds
an impact section that says "this is big" and then lets the operator wave it
through — weak teeth. The program tier is not optional polish; it is the core
fix. Deferring it to v2 ships something that does not solve the problem.

Reframe:
- The **minimal coherent unit** = impact axis + program tier + consumer-coverage
  + enforcement + execution feedback (old v1+v2 merged). This is the smallest
  change that actually fixes the counterfactual.
- **v3 (panel + calibration) is the only genuinely deferrable polish.** The
  pipeline works without it; it improves observability and tuning.
- The merged unit is itself a **cross-scope change** (skills + spec-guard +
  panel + vocabulary + overlay). It must eat its own dog food: implement it as
  a PROGRAM (charter-style sequenced packages with contract-first seams), not a
  waterfall of three feature-versions. The tar-pit risk the operator fears is
  mitigated by defining the seams FIRST so work is contract-bound and
  parallelizable, not emergent.

Implementation program (internal sequencing, contract-first):

| Pkg | Content | Seam it consumes |
|---|---|---|
| P0 | Schema contracts: `<impact>` XML, `program.xml` XML, lint rule NAMES, `spec_guard_census` tool contract | — (the seam) |
| P1 | spec-guard: generation-gap fix + CDATA parser + `spec_guard_census` (TS compiler API + worktree) + impact-present/untouched-contradicted/census-impact-coverage/census-stale/census-ref-unreachable + cross-scope-fanout WARN + archive calibration | P0 schemas |
| P2 | vv-spec: impact section + SCOPE_IMPACT step + decomposition gate → program | P0/P1 |
| P3 | vv-plan: consumer-coverage + scope-barrier waves + behavioral ACs (surface/policy) + program binding | P0/P2 |
| P4 | vv-execute + vv-review: execution feedback (reason codes, ADD-NNN, AMEND-GRANT) + pre-flight re-census + review dispatch + goal-attainment closeout + panel states | P0/P3 |
| P5 (optional) | panel impact chip + program rollup + v2 items (weighted threshold, transitive census, submodule census) | P1/P4 |

Each package independently approved/executed/archived. P0 is the contract seam
that makes P1–P4 parallelizable and integration deterministic.

---

## 10. Goals and DoD — anti-drift / anti-incomplete

Case evidence of the failure: T-023 compile-level ACs green while product broke
(§2.4); deferred-findings "spec requires it; no task created it" (§4.9); wi-15
"green gates could not see"; T-013 PARKED, grant economy for weakening assertions.

Design:

1. **Goal binding in every packet.** Each implementer packet carries the spec
   `<goal>` verbatim + the specific impact-matrix consumer it serves, not just
   the snippet. The plan is a means; the spec is the end. When plan and spec
   conflict, spec wins (extend the existing design-context-non-normative rule).
2. **DoD as a contract, not a checklist.** Per task DoD = (a) behavioral ACs
   verified with receipts, (b) consumer-coverage satisfied (every impact consumer
   mapped to this task is actually touched AND verified), (c) no assertion
   weakened without a recorded grant. Behavioral ACs (browser/e2e) are required
   for consumer edges whose change-kind ∈ {surface, policy}; contract/data
   renames verified by typecheck + migration receipt do not require a browser
   matrix (§4.5, second grok review).
3. **mark-applied gate extension.** Currently: every verification command has an
   exit-0 receipt. Extend to ALSO require: consumer-coverage closed; goal-attainment
   review cleared; no ungranted assertion weakening (lint-checkable against
   reviews/grants.md). A plan is not "applied" when tasks are done; it is applied
   when the spec goal is demonstrably satisfied across ALL impact consumers.
4. **Planned behavioral closeout.** A mandatory closeout wave in cross-scope
   plans: browser role matrix / e2e per consumer surface. In the case this was
   REACTIVE (post-archive wi-15); make it a planned gate, not a follow-up.
5. **Drift detection mid-execution.** stale-artifact rule already checks physical
   change; extend to scope-divergence: if a task touches files outside its declared
   `<scope>`/`<file>`, that is a cascade signal → SCOPE_CASCADE_DISCOVERED (§11),
   not a silent extra edit.
6. **Tier-bound DoD.** Tier 1: pseudocode behavior verified. Tier 2: behavioral
   ACs + consumer coverage. Tier 3: + invariants + rollback + formal verification.
   DoD depth follows the tier, never below it.

---

## 11. Explosion complexity — anticipate before, handle during

### 11.1 Pre-execution anticipation (shift-left)

Fan-out count alone is not explosion risk. Add a **complexity topography** to the
impact pass, grounded in deterministic signals:

- **Coupling depth**: hops from changed contract to farthest consumer
  (curriculum → examinations → dashboard → student-context = depth 3). Deep
  transitive chains = explosion risk. Census + graph traversal.
- **Contract knowability**: can the consumer's required change be specified NOW,
  or does it depend on the producer's emergent outcome? If emergent → it is a
  PROGRAM SEAM, not a wave. This is the discriminator the case proved (11 waves
  failed because later contracts were not knowable upfront). The decomposition
  gate places program seams exactly at unknowable contracts.
- **Shared-state contention**: multiple consumers writing the same table/registry
  → concurrency/ownership risk (existing §N category).
- **Historical volatility**: scopes with open work-items (wi-11: 60+ findings) or
  recent fixup chains (curriculum editor: layout → 11 pins → drag → open question)
  → higher explosion risk. Git fixup cadence is a volatility indicator.
- **Cascade-concentration**: one task doing N deletions + M rewires (T-023) → flag.

Output: a topography map in spec/plan marking explosion-prone seams and
knowable-now vs emergent contracts. The gate uses it to decide program vs
single-plan AND where to cut packages.

- **Targeted pre-mortem**: adversarial plan review brief extended with the census
  + graph and a specific task: "find the consumer edge the plan did NOT enumerate"
  (the examinations→SchoolAuthorizationService edge the graph missed). Not generic adversarial.
- **Executor pre-flight re-census**: vv-execute assess-plan runs a FRESH census
  against CURRENT repo state, not the spec-time snapshot. New consumer edges since
  spec approval → `stale-impact` flag (analogous to stale-approval). Catches
  planner-blindness caused by repo drift between spec and execution.

### 11.2 Mid-execution discovery handling (bounded)

- Implementer discovers a forced consumer change not in plan → returns
  `SCOPE_CASCADE_DISCOVERED` with the concrete edge (file, coupling, why forced).
- Executor does NOT silently fix or skip. Records `impact-addendum.xml` in the
  package (edge, affected scope, proposed disposition).
- Triage by authority (reuse vv-review axes):
  - mechanical/local → safe_auto amend within current wave (recorded addendum, re-lint);
  - contract-level/cross-scope → gated_auto/manual → stop affected seam, route to
    controlled plan amendment (§K re-approval digest) or spawn a program package;
  - emergent/unknowable → new program package.
- Continue unaffected waves (bound the stall to the affected seam).
- Addendum is digest-bound: amending the plan re-runs spec_guard_approve; the
  stale-approval machinery prevents silent drift.
- **Discovery budget**: like review convergence, bound the loop. > K addenda per
  wave → signal the plan was under-specified → escalate to re-spec/program, not
  infinite amendment. Prevents "waterfall with operator involvement" re-emerging
  as "infinite addenda".
- **Learning loop**: discovered edges feed the census/graph (graph-update closeout
  exists) and threshold calibration (v3/P5). The next spec's impact pass sees the
  previously-missed edge. The system gets smarter instead of repeating the cascade.

Case binding: wi-16 arrived 3 days late (§2.6); deferred-findings addenda "spec
requires it; no task created it"; T-014 "plan-vs-reality mismatch" — all are
mid-execution discoveries that had no structured path and degenerated into
operator chat. §11.2 gives them one.

---

## 12. Addendum protocol — who picks it up, when, how

Operator question (2026-11-25): "он записал impact-addendum.xml — что дальше?
кто и когда подхватывает? каков протокол?"

### 12.0 Governing principle

**Event-driven through sessions, not a daemon/poll.** The running executor is
the active driver: writing the addendum is step 1 of its OWN handle-status loop,
not a fire-and-forget into a queue someone polls. Files (addendum, approvals,
receipts) are evidence + state-display; the SESSIONS are the control plane.
This is consistent with hive's "folder-as-state deliberately NOT adopted": the
panel/lint READ file-state for display/gating, but no daemon watches folders.
When the executor is gone, the next relevant skill invocation gates on the file.

### 12.1 Actors

| Actor | Role in the protocol |
|---|---|
| Implementer subagent (vv-worker, headless) | Detects the forced edge; returns SCOPE_CASCADE_DISCOVERED envelope; does NOT edit outside task scope |
| Executor session (managed, running) | Intake → record → triage → route → drive resolution; asks user; amends; continues unaffected waves |
| Controller session (vv-controller) | Awareness via session_send; coordinates cross-package edges / program DAG; spawns new package specs when routed |
| Operator/user | Grants bounded amendments; decides dossiers (authorize/defer/redesign); approves re-approval digests |
| spec_guard_lint (host, deterministic) | Verifies protected-path signals; flags unresolved-addendum; re-checks consumer-coverage after resolution |
| Panel (client) | Surfaces addendum-pending / deferred-consumers state when executor is not live |

### 12.2 Addendum lifecycle (state machine)

```
discovered        implementer envelope: Reason code SCOPE_CASCADE_DISCOVERED
  → recorded      executor appends ADD-<NNN> to impact-addendum.xml
  → triaged       executor classifies authority: safe_auto | gated_auto | manual | emergent
  → resolving
      safe_auto   → amend-grant requested (one bounded ask_user_question)
                      [granted]  → amended (plan delta + spec_guard_approve + receipts) → resolved
                      [denied]   → escalated
      gated_auto  → escalated (decision dossier; affected seam STOPPED)
                      [authorize] → amended (full re-approval; re-review if risk mandatory) → resolved
                      [defer]     → deferred (named target package / work-item) → resolved-deferred
                      [redesign]  → spawned
      manual      → escalated (dossier) → user decision → amended | deferred | spawned
      emergent    → spawned (new program package; controller/vv-spec creates) → resolved-spawned
  → parked        discovery budget exhausted OR user unavailable + seam critical
                  → escalated to re-spec/program (reason ADDENDUM_BUDGET_EXHAUSTED)
```

ADD-<NNN> fields: edge (source file/symbol → target contract), affected scope,
evidence anchor (spec_guard_evidence-verifiable), why-forced, proposed disposition,
authority classification, status, discovered_at, task_id, head_oid, resolution
(grant ref / digest / new task ids / deferral target / spawned package), receipts.
Append-only; one entry per discovery; batched per seam for user presentation.

### 12.3 Protocol steps

1. **Discovery (implementer, headless).** Hits a forced consumer change not in
   plan. Returns `Status: BLOCKED`, `Reason code: SCOPE_CASCADE_DISCOVERED`,
   payload: edge, scope, why-forced (compile error / runtime dep / contract
   violation), proposed minimal change, confidence. Does NOT edit outside its
   `<scope>`/`<file>` (drift rule §10.5). Stops.
2. **Intake (executor, automatic, immediate).** handle-status receives the code.
   This is NOT a deterministic failure → no blind retry (retry_safety). Appends
   ADD-NNN (status=recorded). Marks the affected seam `blocked-on-addendum` in
   todo. Runs spec_guard_lint → `unresolved-addendum` flag; panel state gains
   `addendum-pending`. Notifies controller via session_send (awareness, not gate).
3. **Triage (executor + deterministic lint, bounded).** Classify by vv-review
   authority axes, grounded in evidence. Lint deterministically forces gated when
   the addendum touches a protected path (schema/migration/auth/deps/config).
   safe_auto requires: one concrete mechanical correction, same seam, no contract
   change, no authorization boundary. emergent = required change not knowable
   without new design (depends on unsettled producer outcome).
4. **Resolution paths:**
   - **A — safe_auto bounded amendment.** Executor proposes minimal plan delta
     (add/modify tasks within current wave). Asks ONE bounded question:
     "discovered edge X, mechanical fix Y, authorize amend-and-continue?" This is
     an `AMEND-GRANT` recorded in reviews/grants.md, bound to the EXACT delta
     digest (like Guardrail-Waiver binds exact bytes). On grant: apply delta to
     plan.xml, the grant answer IS the explicit approval → spec_guard_approve
     records new digest, re-lint, continue wave. Addendum → resolved (amended).
     On deny → Path B. No blanket amend authority; no full re-review for a
     mechanical delta.
   - **B — gated_auto / manual escalation.** Executor STOPS the affected seam
     (not the whole plan). Writes decision dossier (vv-review format). Escalates
     to user via ask_user_question. User: authorize → full re-approval (status
     draft → re-review if risk mandatory → re-approve → digest); defer →
     addendum deferred with named target, downstream tasks marked deferred,
     consumer-coverage shows deferral not gap; redesign → Path C. Executor does
     NOT proceed past the seam until resolved/deferred.
   - **C — emergent → program package.** Discovery reveals a contract unknowable
     at spec time → new package, not amendment. Executor escalates; CONTROLLER
     (or new vv-spec invocation) creates package spec bound to program.xml; new
     P node + depends_on. Current plan records deferral target = new package and
     may close its own scope. New package runs its own spec→plan→execute. This is
     the charter pattern (R0c need → R5 package). Addendum → resolved-spawned.
5. **Closure.** Resolved addendum records resolution + evidence. Lint re-checks
   consumer-coverage closes the edge (task or deferral). Discovery budget
   accounting (§12.5). Resolved edges feed graph-update closeout + census
   calibration. Addendum archived with package (like receipts/reviews).

### 12.4 Pickup — who and when

| Situation | Who picks up | When | Trigger |
|---|---|---|---|
| Executor running | executor session | immediately, in handle-status | SCOPE_CASCADE_DISCOVERED envelope |
| User answer pending | executor (seam parked; unaffected waves continue) | on user answer | ask_user_question response |
| Executor ended, addendum unresolved | panel chip + lint | next view / run | unresolved-addendum rule; addendum-pending state |
| Next vv-execute on package | controller/executor validate-plan | at start | lint gate: resolve addenda before executing |
| Next vv-spec/vv-plan on deferral target | spec/plan skill | at start | addendum as intake evidence / prerequisites |
| Cross-package edge | controller + program.xml | program coordination | program DAG update |

No polling, no daemon. Live executor drives immediately; persisted file gates
the next invocation. The panel makes orphaned addenda visible so they cannot
silently rot (the wi-13 `parts/` empty-dir failure mode).

### 12.5 Isolation, concurrency, budget

- **Seam isolation**: affected seam = the task whose contract changed + its
  downstream dependents (dep-T graph). Only those block. Unaffected waves (no
  dependency path to the seam) continue. Stall is bounded to the seam.
- **Batching**: multiple addenda on the same seam → one amendment/dossier, not N
  user questions.
- **Parallel program packages**: addenda are package-local; cross-package edges
  go to program.xml DAG (controller coordinates). program.xml is the shared seam.
- **Discovery budget**: > K addenda per wave → plan under-specified → escalate to
  re-spec/program, reason `ADDENDUM_BUDGET_EXHAUSTED`. Prevents "waterfall with
  operator" re-emerging as "infinite addenda". K is overlay-configurable.
- **User unavailable**: seam parks; unaffected waves continue; addendum stays
  `escalated`; panel shows it; executor does not fabricate a decision.

### 12.6 Reused vs new machinery

Reused: status envelope + reason codes, decision dossier, reviews/grants.md,
§K digest/re-approval, receipts, session_send / ask_user_question, todo_write,
lint rule vocabulary, panel §P state, graph-update closeout, retry_safety,
vv-review authority axes.

New: impact-addendum.xml schema + ADD-NNN lifecycle; SCOPE_CASCADE_DISCOVERED
reason code; AMEND-GRANT grant type (delta-digest-bound); unresolved-addendum
lint rule; addendum-pending / deferred-consumers panel states;
ADDENDUM_BUDGET_EXHAUSTED reason code; seam-isolation logic in executor
handle-status; stale-impact pre-flight flag (§11.1).

### 12.7 Case binding

wi-16 (course→subject→exam access) arriving 3 days post-spec is a Path C
emergent discovery: under this protocol the implementer hitting the exam-access
coupling returns SCOPE_CASCADE_DISCOVERED, executor triages emergent, controller
spawns a program package, wi-16 becomes its intake evidence — instead of an
operator product-note floating outside the pipeline. deferred-findings "spec
requires it; no task created it" is a Path A/B amendment with a recorded grant,
not a silent addendum commit. T-014 "plan-vs-reality mismatch" is a gated
escalation with a dossier, not a BLOCKED dead-end.

---

## 13. Review response — grok-4.7, 2026-11-25 (authoritative corrections)

An adversarial review (grok-4.7) was run against this document. Its central
empirical charge was VERIFIED against foundation git history and is CORRECT.
This section records the verification, the concessions, and the corrected
acceptance unit. It supersedes the named parts of §2.2, §4.1, §4.6, §5, §9,
§10.2. §10–§12 are re-classified as P4 design, NOT the acceptance unit.

### 13.1 Verified anachronism (conceded)

Charge: §2.2/§5 cited `examinations/services/curriculum-tree.service.ts` and
"curriculum imported by 8 scopes" as facts available before the first task on
Nov 12. They are present-day facts retrojected onto Nov 12.

Git verification (read-only):
- `curriculum-tree.service.ts` first appears in `0fa596c6` (Nov 25, "remove the
  examination taxonomy from the kernel"); its contract links spec
  `2026-11-24-curriculum-question-binding`. It did not exist on Nov 12.
- `backend/curriculum` consumers at teardown parent `3843cb35^`: 4 scopes / 9 files
  (assessments/enrollments/policies/sessions; §15.6). The "8 scopes" census is
  HEAD-state, accumulated Nov 13–25.
- At spec-time proxy `af92a878^` (before curriculum existed), `schools` /
  `SchoolAuthorizationService` imported by **14 scopes** including examinations.
- `backend/examinations/exam.controller.ts` at `3843cb35^` references
  `SchoolAuthorizationService.resolvePlatformOrSchoolStaffScope` (contract L21,
  L88). The real contradiction witness is examinations→schools, not
  examinations→curriculum-tree.

Root error: the subagent's §9 framing ("mechanically checkable before the first
task ran") was anachronistic for the curriculum edge, and this document
propagated it into the counterfactual without temporal verification. This is
precisely the "assertion without verification" failure the proposal diagnoses —
committed by the proposal itself. The reviewer applied §5's own falsification
criterion and the cited witness failed it. Owned.

### 13.2 Census object corrected (conceded)

The census object is the **deleted/renamed symbols and files + broken
signatures**, NOT the new module name. A new module on spec-day has no
consumers yet; its future consumers are an interview/design question, not grep.
The example `grep -rl "backend/curriculum"` was wrong: it greps the construction
target. Correct object: `schools`, `SchoolAuthorizationService`,
`student-learning-subjects`, the 7 deleted schemas, the 8 deleted contract
slices, changed export signatures. §4.1 example corrected accordingly.

### 13.3 Teeth: host-executed census, not author-asserted text (conceded — core redesign)

Charge: `untouched-verified` requires a zero-result command the AUTHOR writes
into XML; spec-guard parses XML and does not execute commands; the model can
narrow the grep to a path where zero is guaranteed. Same scope-check hint with
tags.

Correct. The deterministic enforcement MUST be a host tool that COMPUTES the
census from the actual repo, and lint compares the spec disposition against the
host output. New tool **`spec_guard_census`** (sibling of spec_guard_evidence /
spec_guard_approve):
- Input/Output: **superseded by §14.5 (round-3)** — input {repoRoot, baselineRef,
  currentRef?, scopeDir=package root, deletedSymbols[], renamedSymbols[]} derived
  from plan `<deletes>/<renames>`; brokenSignatures removed from v1.
- Host runs the census via **TS compiler API** (`ts.createProgram` over a worktree
  at committed baselineRef — §14.5 round-5; supersedes the round-3 "resolved
  specifier scan" label); NOT moving HEAD (§14.3); historical ref for counterfactuals.
- Output: per consumer scope — file count, edge list, **edge kind** per §14.1
  (runtime-import | type-import | schema-barrel | contract-barrel hard;
  incidental advisory; transitive not computed v1).
- `spec_guard_lint` package mode: reads the census output and checks
  `untouched-verified` dispositions against it. A detected runtime/contract edge
  into a scope declared untouched → error `untouched-contradicted`. The author
  cannot game it: the host computes the edges, not the XML text.

Edge-strength classification resolves the §3.3 vs §4.1 tension. **SUPERSEDED by
§14.1 (round-3 F7): type-import is HARD for contradiction (a type-only dependency
breaks typecheck, so the scope cannot claim untouched), compile-only for closeout.**
The earlier wording here classed type-only as soft/advisory — withdrawn. Transitive
edges are not computed in v1 (covered via direct upstream). Runtime / type-import /
schema-barrel / contract-barrel edges are hard for contradiction. "Zero edges" →
"zero hard edges"; absence of hard edges is a SIGNAL, not proof of behavioral
untouchedness — an untouched disposition still requires a behavioral justification
(interview), because examinations could lack the string "curriculum" yet depend on
schools authorization.

### 13.4 Behavioral closeout trigger corrected (conceded)

Charge: behavioral ACs on EVERY cross-scope surface is broader than the case;
an export rename fixable by compilation needs no browser matrix; universal e2e
falls into the grant-economy of assertion-weakening.

Correct. §10.2 "cross-scope consumer surfaces require behavioral ACs, never
compile-only" is too broad. Trigger = `change-kind` ∈ {surface, policy}
(UI/behavior/access), NOT the mere fact of multiple scopes. contract/data
renames verified by typecheck + migration receipt do not require a browser
matrix. The case broke access rules and tutor scope (policy/surface) — those
get behavioral closeout; a schema rename gets compile + receipt.

### 13.5 Schema machine-checkability (conceded)

`<volume>` and `<result>` prose in the §4.1 example are not lint-computable.
`P-R1..P-R8` range is not checkable by `program-dag`. Corrections:
- fan-out counts are NUMERIC fields populated from `spec_guard_census` output,
  not author prose. lint thresholds read numbers.
- deferral targets are explicit node refs (`<dep-P-R1/>`, `<dep-P-R2/>`, …),
  never a range string. program-dag validates each ref against a P node.
- census evidence references the host tool output digest, not a free-text
  command/result the author supplies.

### 13.6 Scope re-classification (conceded)

Charge: §9 rightly makes program tier core and panel deferrable, but §10–§12
then assemble a second product (topography, addendum state machine, four
authority classes, AMEND-GRANT, discovery budget, six pickup situations). §12
is internally consistent and rightly rejects a daemon, but it is P4 design, not
the acceptance unit. P0 drags reason codes and panel states into the seam before
execute hits a real divergence.

Correct. Re-classification:
- **Acceptance unit** (§13.7) is the minimal coherent fix.
- **§10 (goals/DoD), §11 (topography + discovery), §12 (addendum protocol) are
  P4 design** — valuable, answers to operator questions, but NOT required for
  acceptance. They land after the census proves itself on the archive.
- **P0 seam** (round-2 shrink, round-5 re-expansion — §14.5 is the single source):
  `<impact>` schema, plan `<deletes>/<renames>` schema, spec `<paths>` schema,
  `program.xml` schema, lint rule NAMES + owners, and the `spec_guard_census` tool
  CONTRACT. Reason codes, panel states, ADD-NNN live with P4; CDATA-aware parser is
  a P1 prerequisite (not P0 schema). The seam is what spec/plan/lint consume.

### 13.7 Corrected acceptance unit (adopted from review)

1. Orthogonal horizontal axis (impact), CLASSIFY_BOUNDARY unchanged.
2. **Deletion / signature-change census EXECUTED BY HOST** (`spec_guard_census`),
   not text in XML. Object = deleted/renamed symbols + broken signatures.
3. `untouched-verified` contradiction checked against the host census output
   (hard edges), with edge-strength classification; behavioral justification
   still required (absence of edges ≠ proof).
4. Program tier on a fired threshold, with a lightweight form for medium fan-out.
5. Consumer-coverage in the plan (explicit node refs, numeric counts).
6. Generation-gap fix in lint (prerequisite).
7. Behavioral closeout ONLY for change-kind surface/policy.
8. Panel + full addendum protocol AFTER the census on the archive shows it
   would fire on schools (14 scopes), not on a nonexistent curriculum-tree.

### 13.8 Calibration before error-mode (conceded)

A hard threshold with one calibration point either turns every next spec into a
program or gets raised until it never fires. The archive (30+ packages) exists
now; P5 was wrongly declared optional. Correction: **first packages run the
threshold as WARN (advisory), then ERROR only after calibration on the archive
confirms it fires on the schools deletion surface and not on noise.** Threshold
calibration moves INTO the acceptance rollout (before error-mode), not into
deferrable P5.

### 13.9 Refinements preserved (not concessions)

- Program DECLARATION (gate output, Nov 12) is distinct from charter CONTENT
  (emergent design, through sequenced packages / Path C). The gate fires before
  teardown; the invariants/decisions emerge during execution. Both claims hold
  once separated.
- Edge-strength classification addresses BOTH the over-report fear (§3.3) and the
  under-report fear (zero grep misses behavioral coupling). **Per §14.1 (round-3
  F7): runtime/type-import/schema-barrel/contract-barrel are HARD for contradiction;
  type-import is compile-only for closeout; transitive not computed v1; incidental
  (policy/access naming) is advisory.** Behavioral justification covers the residue.

### 13.10 Meta-lesson

The proposal's own R&D committed the failure it diagnoses: a counterfactual
assertion ("gates fire on Nov 12") built on present-day repo state without
verifying the historical state — an untouched-verified-style claim without
verification. The fix is the same fix the proposal prescribes: host-executed
census at a pinned ref, not author-asserted text. `spec_guard_census` accepts a
ref precisely so counterfactuals are checked against the tree they claim to
describe. The review improved the proposal materially; the corrected witness
(schools ← 14 scopes, examinations→SchoolAuthorizationService) passes the
falsification criterion the original witness failed.

### 13.11 Second review (grok-4.7, 2026-11-25) — body consistency + teeth hole

Charge 1 (CORRECT, fixed): §13 corrected the analysis but left the WITHDRAWN
variant in the proposal body (§4.1 grep backend/curriculum / "8 scopes" /
curriculum-tree / prose volume / P-R1..P-R8 range; §2.9, §11.1 curriculum-tree
decisive; §4.5/§4.6 zero-grep + universal behavioral ACs; §7 cancelled rollout;
§9 P0 table with reason codes/panel states). A "supersedes" note does not stop an
implementing agent reading the body. FIX: all body sections edited inline to
match §13/§14 — §4.1 example now deletion-census/host-tool/numeric/node-refs;
§4.5 behavioral trigger = change-kind surface/policy; §4.6 rules =
untouched-contradicted/census-incomplete/census-stale/stale-impact + warn|error
mode; §7 rewritten to the merged-unit rollout; §9 P0 shrunk to schemas + rule
names + census tool contract, reason codes/ADD-NNN/panel moved to P4, calibration
moved into P1.

Charge 2 (CORRECT, verified §15): "15 scopes" was a UNION grep
(`backend/schools OR SchoolAuthorizationService`); the reproducible SYMBOL census
(SchoolAuthorizationService alone) at `af92a878^` is **14**, without
credential-entities (which imports the schools path, not the symbol).
examinations is in the 14, so the gate fires. `0fa596c6` is dated **Nov 25**, not
24. Counts corrected throughout; §15 attaches the actual command output instead
of hand-written counts (host computes, author declares — applied to this doc).

Charge 3 (CORRECT, fixed): the census INPUT is caller-supplied; an empty/truncated
list honestly returns zero edges. FIX: census input is plan-derived;
`census-incomplete` lint rule rejects a plan deletion absent from the census
request (§14.1, §4.1, §4.6). This closes the teeth hole at the source.

---

## 14. Agreed design — taxonomy / threshold / ref-pinning (ACCEPTED 2026-11-25)

Operator accepted all ten recommendations as stated (v1-now / v2-later split
preserved). This section is the implementation-ready agreement feeding P0/P1.
Governing principle across all three: **host computes, author declares, lint
compares** — census digest analogous to §K approval digest.

### 14.1 Edge-strength taxonomy

A single hard/soft axis conflates three decisions; separate them:
- **contradiction** — is an `untouched` claim false?
- **closeout depth** — behavioral (browser/e2e) vs compile-only?
- **fan-out count** — does decomposition trigger?

Accepted kinds (TS/Nest/Drizzle/oRPC monorepo):

| kind | detection | fan-out | contradicts untouched | closeout |
|---|---|---|---|---|
| `runtime-import` | value-import used in non-elided position OR decorated-class param/property type (Nest DI, emitDecoratorMetadata) | yes | yes | behavioral |
| `type-import` | `import type` of deleted symbol | yes | yes | compile-only |
| `schema-barrel` | deleted table ref via `db/schemas` | yes | yes | behavioral (data) |
| `contract-barrel` | deleted slice ref via `contracts` | yes | yes | behavioral (API) |
| `incidental` | name in comment/string/test, no import | no | no (advisory) | interview-flag |
| `transitive` | depends via intermediate consumer | NOT computed v1 | no (witness=intermediate) | inherited |

Accepted rules:
- **type-import = hard contradiction, compile-only closeout.** A scope with a
  type-only dependency cannot claim untouched (typecheck breaks) but needs no
  browser matrix. Resolves the universal-e2e over-reach.
- **Direct-only census v1.** Transitive consumers are mediated by a direct
  consumer already counted; computing transitive inflates fan-out and is costly.
  Documented limitation: "transitive covered via direct upstream." Transitive
  computation deferred to v2 (revisit if calibration shows false-negatives).
- **incidental → interview-flag, only policy/access-naming.** Not any string
  mention (comment noise). Covers behavioral coupling without an import; does
  not enter fan-out, does not auto-contradict.
- **Under-report is fixed by the census OBJECT** (deleted symbol, e.g.
  `SchoolAuthorizationService`, not the new module name), not by the taxonomy.
- **Gaming mitigation — census input is PLAN-DERIVED from structured `<deletes>/
  <renames>` (§4.5, round-3 F1):** the host honestly greps whatever symbol list the
  caller supplies; an empty/truncated list honestly yields zero edges and falsely
  passes `verified-untouched`. Fix: the census request is derived from the plan's
  machine-readable deletion/rename elements (NOT prose, NOT free-supplied). Layer
  mapping (round-4 F7 corrected): `census-incomplete` = PLAN-time ERROR (plan
  `<deletes>` ⊆ spec-pinned census set — it needs the plan, so it cannot run at spec
  lint); `undeclared-deletion` = EXECUTION-time ERROR (P4; `git diff` baseline OID vs
  plan `<deletes>`). NO WARN layer. Under-declaration in BOTH spec and plan is caught
  only at execution — the "at the source" claim is downgraded to "declared-set
  consistency at spec/plan; undeclared deletions at execution".

### 14.2 warn→error threshold

Not all rules have equal precision; split them:
- **`untouched-contradicted`** (hard edge into a declared-untouched scope):
  HIGH precision → **error early**, after witness validation (schools anchor).
- **`cross-scope-fanout`** (decomposition threshold): LOWER precision →
  **warn until archive calibration**, then error.

Calibration (bounded research pass, moves INTO acceptance rollout, not P5):
- Replay `spec_guard_census` on the archive (30+ packages) at their spec-time refs.
- Label cascade vs clean: hybrid — automatic proxy (≥K reactive follow-ups
  touching the same scopes within N days, OR work-items/deferred-findings
  referencing the package's surfaces) + manual verification of anchors.
- Anchor positive: schools deletion (14 scopes → 13-package restoration).
  Anchor negatives: local features (`2026-11-04-whiteboard-fullscreen`,
  `2026-11-09-exam-sign-out-leave-guard`).
- Confusion matrix → threshold minimizing false-pos (clean→program) and
  false-neg (cascade→single).
- Provisional threshold: **≥3 distinct consumer scopes with hard shared-surface
  edges** → decomposition. Distinct-scopes v1; weighted (schema/contract edges
  heavier) deferred to v2. Per-repo overlay-configurable.

Mode mechanics (reuse lint errors/warnings + risk line):
- WARN: `risk: warn (cross_scope_cascade: N scopes)` at the approval gate;
  **requires recorded operator acknowledgment** (operator saw the warn and chose
  single-package). The acknowledgment seeds calibration data and future grants.
- ERROR: lint error blocks approve/validate; requires program declaration ONLY —
  no single-package/override grant above the threshold (F13, round-4 F4). Operator
  acknowledgment grants exist for WARN mode only; calibration.json mode flips are
  the only path from WARN to ERROR.
- Mode flip recorded in **`calibration.json`** (labeled archive results +
  thresholds + per-rule mode), never silent. Per-rule granularity.

### 14.3 ref-pinning semantics

Census runs at a **committed OID** (immutable, reproducible), not moving HEAD
and not the dirty working tree.

Pin lifecycle (child elements, no attributes — §4.1 convention; round-3 F6):
- **Spec pins baseline:** `<census><ref>…</ref><output-digest>…</output-digest>
  <deleted-symbols>…</deleted-symbols></census>`.
- **Plan inherits** the spec ref; records a delta if the repo moved.
- **Execution pre-flight:** drift check — new consumer edges at current HEAD vs
  the pinned baseline. Deletion-census runs at the PINNED pre-change ref (the
  symbols may already be deleted mid-execution; current HEAD would find zero).
- **Counterfactual / calibration:** explicit historical ref (e.g. `af92a878^`).

**Canonical census digest (round-3 F11):** `output-digest` = SHA-256 of a canonical
JSON form: `{schemaVersion, analyzer:{name:"typescript", version:<exact ts.version,
no caret>}, resolutionStrategy, resolvedOid (git rev-parse, not the spelled ref),
scopeDir, ownerScope, sortedDeletedSymbols, sortedDeletedPaths, sortedRenamedPairs,
perScope:[{scope, files (sorted, repo-relative, no ref prefix, NO line), edges
(sorted by source/target/kind; source=repo-relative file, target=symbol)}]}`.
(round-6 F5/F6: analyzer version + resolution strategy determine the edges, so they
MUST be in the digest — a caret TS range or node_modules strategy change otherwise
yields a different edge set with no repo change → false census-stale.
deletedPaths/renamed pairs are output-determining inputs: digest-covered + pinned in
`<census>` children. Edge source carries NO line number — line shifts cause false
stale-impact drift; line lives in a non-digested display field.) The HOST recomputes
and passes the digest to lint (F4); lint compares only. Tool input carries
`{baselineRef, currentRef?}`: census-stale re-computes at baselineRef; stale-impact
compares baselineRef vs currentRef. One `ref` field is insufficient.

**Canonicalization (round-4 F9):** sort = Unicode code-point (UTF-8 byte) order, not
locale; canonical JSON = lexicographically sorted keys, no insignificant whitespace,
fixed number/string escaping; `schemaVersion` = integer, bumped on ANY output-shape
change — a bump invalidates prior digests and requires re-census + re-approval.
`renamedSymbols` reflected in edges; `currentRef` intentionally outside the digest
(it is the drift comparison, not the pinned baseline).

Two distinct staleness checks:

| check | when | meaning | analogy |
|---|---|---|---|
| `census-stale` | lint | claimed fan-out ≠ host re-computation at pinned ref | §K stale-approval (artifact bytes) |
| `stale-impact` | execution pre-flight | new consumer edges at current HEAD vs pinned baseline | repo drift approve→execute |

`census-stale` is the teeth against author-gamed counts; `stale-impact` is drift
detection. lint re-runs the census at the pinned ref and compares the output
digest, so edited fan-out claims without re-census are caught.

Accepted handling:
- **Dirty working tree:** committed-only census + separate dirty warning.
  Uncommitted deletions are invisible to the census until committed (acceptable:
  the census measures consumers of symbols that WILL be deleted, which exist in
  the committed spec-time tree). Author commits/stashes relevant state before
  pinning.
- **Submodules (`projects/*` gitlinks):** v1 limitation — census within the main
  repo `scopeDir`; cross-repo consumers via declared `affected_modules` +
  interview. Submodule census deferred to v2.
- **ref unreachable** (shallow clone / GC) → error `census-ref-unreachable`.
- **Pin granularity:** spec baseline + plan delta + execution drift (one pin per
  approval window).

### 14.4 Accepted decisions (all ten, as stated)

| # | Decision | Accepted |
|---|---|---|
| 1.1 | transitive | direct-only v1; transitive v2 |
| 1.2 | incidental | only policy/access-naming flag |
| 1.3 | gaming | census-incomplete ERROR (spec, structured deletes) + undeclared-deletion ERROR (execution diff); no WARN layer (round-3 F8) |
| 2.1 | calibration labels | hybrid: auto proxy + manual anchors |
| 2.2 | threshold signal | distinct scopes v1; weighted v2 |
| 2.3 | WARN | recorded operator acknowledgment |
| 3.1 | dirty tree | committed-only + dirty warning |
| 3.2 | pre-flight | re-census drift at HEAD + deletion at pin |
| 3.3 | submodules | v1 defer + affected_modules |
| 3.4 | pin granularity | spec baseline + plan delta + execution drift |

### 14.5 Implications for P0 / P1 (scope boundary)

P0 seam (schemas + lint rule NAMES + census contract — the SUBSTRATE; round-5):
- `<impact>` schema: census child elements (ref, output-digest, deleted-symbols,
  deleted-paths), per-scope `S-<SCOPE>` with unique-tag `E-NNN` edges
  (kind/source/target), NUMERIC fan-out counts (1:1 with census output), disposition
  enum (cover-in-plan | defer-to-program | verified-untouched — NO exclusion bypass
  v1, round-4 F2), explicit deferral node refs (no ranges).
- **PLAN deletion schema (F1/F3, unique-tag):** every destructive task declares
  `<deletes><D-001><path>src/db/schemas/schools.ts</path></D-001>…</deletes>` and
  `<renames><R-001><from>…</from><to>…</to></R-001>…</renames>`. The HOST extracts
  each deleted path's exported symbols via the TS compiler API at baselineRef (so
  `<path>` need not hand-list symbols; the schools.ts→SchoolsModule mismatch is
  resolved by host export-extraction). Unique identities make entries addressable
  for census-incomplete and the digest edge list (generic repeating children were
  pairing-lossy — round-4 F3).
- **SPEC `<paths>` schema (F5):** unique-tag `P-NNN` entries (path + role
  create/modify/delete) — the deterministic trigger source for impact-present (spec
  had no path field; 0/107 `<evidence>`). impact-present fires when a `<paths>` entry
  touches db/schemas/, contracts/, migrations.
- `program.xml` schema: `P-<Id>` nodes, `dep-P-*` refs, owns-components,
  seam-contract, invariants, status. Layout `.vvoc/programs/<id>/program.xml` (F17).
- lint rule names + WHEN + OWNER (F7/F12):

  | rule | when | owner |
  |---|---|---|
  | impact-present (spec `<paths>` trigger) | spec lint | P1 |
  | untouched-contradicted | spec lint (vs host census) | P1 |
  | census-impact-coverage | spec lint (vs host census) | P1 |
  | census-stale | spec lint (digest re-compute) | P1 |
  | census-ref-unreachable | spec lint | P1 |
  | cross-scope-fanout (warn\|error) | spec lint | P1 |
  | census-incomplete (plan `<deletes>` ⊆ spec census set) | PLAN lint | P1/P3 |
  | cascade-concentration | plan lint | P3 (N/M calibrated P1) |
  | consumer-coverage | plan lint | P3 |
  | program-dag | program/plan lint | P2/P3 |
  | stale-impact (baseline vs current) | execute pre-flight | P4 |
  | undeclared-deletion (git diff vs plan `<deletes>`) | execute commit | P4 |

  §5 "work-item reference check" = vv-spec interview step (P2), not a lint rule.
- **`spec_guard_census` tool contract (F6 = TS COMPILER API; round-6 focused fixes):**
  input `{repoRoot, baselineRef, currentRef?, scopeDir, ownerScope?, deletedSymbols[],
  deletedPaths[], renamedSymbols[{from,to}], renamedPaths[{from,to}]}`. Symbol/path
  lists derived from plan `<deletes>/<renames>`; census-incomplete enforces plan ⊆
  spec-pinned set (precedence below).
  **Materialization (round-6 F1, Critical):** `git worktree add --detach <tmp>
  <resolvedOid>` (resolve baselineRef to an OID first; `af92a878^` is a valid
  commit-ish → a2c3ad5d…). A worktree has ONLY tracked files — NO node_modules.
  `@foundation/*` resolves exclusively via pnpm per-package symlinks (no tsconfig
  paths; 213/425 backend files import @foundation/* — the whole schema-barrel
  channel). The host MUST mirror pnpm's per-entry RELATIVE symlinks into the worktree
  (or inject a resolver mapping `@foundation/<pkg>/<sub>` →
  `<worktree>/packages/platform/<pkg>/<sub>` from pnpm-workspace.yaml globs).
  **FORBIDDEN: symlinking the live checkout's node_modules wholesale** — it resolves
  to the LIVE working tree, silently breaking ref-pinning (measured). The resolution
  strategy is part of the digest input. lib.es*.d.ts comes from the host typescript
  install (not the worktree). projects/* are gitlinks (worktree leaves them empty —
  v1 submodule deferral); packages/platform/* are main-repo trees (present).
  **Resolution = `ts.createProgram`** (moduleResolution: bundler honored; TS version
  pinned in digest): named-binding extraction, barrel re-export traversal, usage
  classification. `typescript` is a RUNTIME dep of the census HOST tool (lint.ts
  verdict engine stays zero-dep).
  **DI-aware usage (round-6 F2):** `runtime-import` = a reference in a non-elided
  value position OR a parameter/property type of a DECORATED class when
  `emitDecoratorMetadata` is on. Nest DI injects via constructor-param type
  annotations (`private readonly svc: SchoolAuthorizationService` is a RUNTIME edge,
  not type-only); a naive position-based test misclassifies 100% of the acceptance
  case's production edges. Fixture: examinations/exam.controller.ts = runtime-import.
  `type-import` = `import type` / elided type-only reference (hard contradiction,
  compile-only closeout).
  **Edge kinds + precedence (round-6 F7):** schema-barrel = deleted symbol declared
  under db/schemas (Drizzle table); contract-barrel = deleted symbol under contracts
  (oRPC slice); barrel kind takes PRECEDENCE over runtime-import by declaring-module
  path origin. `hardCount := |edges with kind ∈ {runtime-import, type-import,
  schema-barrel, contract-barrel}|` — all four are hard for contradiction AND fan-out
  (§14.1); closeout depth differs (type-import compile-only).
  **Output:** per-scope `{files, edges[E-NNN{kind,source,target}], hardCount}` +
  canonical output-digest (§14.3). `files` = files with ≥1 hard edge (F3), NOT all
  files in the scope. `source` = repo-relative file path (NO line number); `target` =
  symbol name; line numbers live in a non-digested display field (F6 — TS API returns
  absolute temp-worktree paths; `:line` in source causes false stale-impact drift).
  **Owner-scope exclusion (F3):** the scope declaring the deleted symbol is excluded
  from consumer fan-out — resolved from the symbol's declaration at baselineRef or
  via input `ownerScope` (the ad-hoc `grep -v '/schools/'` in evidence commands is NOT
  the contract).
  **Precedence (non-circular):** SPEC pins the census set; census-incomplete at PLAN
  lint checks plan `<deletes>/<renames>` ⊆ spec-pinned set (two distinct artifacts).
  **Scope partition (F8/F9):** scope = first segment under src/backend; src/db →
  S-DB, src/contracts → S-CONTRACTS, other src/<seg> → S-PKG-<SEG> fallback. The
  domain tsconfig EXCLUDES tests from the program (measured 1050 roots, 0 test files),
  so a tsconfig-driven program never sees them. To report tests advisory, build the
  program from an EXPLICIT file list including tests flagged advisory; otherwise drop
  the advisory claim and state tests are tsconfig-excluded. Fan-out counts production
  scopes only.
  **Acceptance (F3, census-derived NOT grep-derived):** the earlier "14 scopes / 49
  files" was a raw `git grep -l` MENTION count (49 incl 27 test/spec; 22 production
  mentions; only ~6 production files have an actual import binding, ~5 scopes).
  Acceptance is re-pinned to the census tool's OWN output with owner-scope + test
  exclusion. Robust witness assertion: **examinations ∈ runtime-import consumers of
  SchoolAuthorizationService at af92a878^ (DI constructor-param edge)**. Exact
  production scope/file count is census-derived (P1 measured: 10 scopes / 12 files; the
  full deletion surface via deletedPaths captures barrel consumers). Do NOT hand-pin
  a grep count.
  **Worktree lifecycle (F10):** unique tmp dir per run; `try/finally` with
  `git worktree remove --force` + `git worktree prune`; per-repo lock keyed by
  (resolvedOid, scopeDir) for concurrent spec/plan/pre-flight runs.
  **Path resolvability (F11):** a declared delete/rename `from` path that does not
  resolve at baselineRef → error `census-path-unresolvable` (not silent zero edges).
  **Perf/cache:** createProgram ~2s / getTypeChecker ~0.5s over the domain (measured);
  ~10–30s per full run; cache census output by (resolvedOid, deletedSet, scopeDir,
  tsVersion, resolutionStrategy); stale-impact needs two programs (baseline+current).
  **census-stale host/engine split (F4):** the HOST census tool recomputes and passes
  `censusDigest`/`censusStale` into SpecLintOptions (like §K currentSha256,
  index.ts:476); lint ONLY compares — it never re-runs the census (purity invariant
  lint.ts:183-184). The ownership row "census-stale | spec lint" means lint evaluates
  the comparison on host-supplied values, not that lint computes the census.

NOT in P0 (P4 execute): reason codes, ADD-NNN schema, panel states, AMEND-GRANT.
CDATA-aware parseXmlLite is a P1 prerequisite (NOT P0 schema — round-4 F11).

P1 (spec-guard): generation-gap fix + CDATA-aware parseXmlLite + spec_guard_census
(TS compiler API + worktree materialization + canonical digest + partition/exclusions)
+ impact-present / untouched-contradicted / census-impact-coverage / census-stale /
census-ref-unreachable / cross-scope-fanout WARN + archive calibration (incl.
cascade-concentration N/M). First validation (round-6 F3, census-derived):
spec_guard_census deletedSymbols=[SchoolAuthorizationService], baselineRef=af92a878^
(resolved OID), scopeDir=package root, ownerScope=schools, tests excluded, worktree
node_modules mirrored → witness assertion **examinations ∈ runtime-import consumers
(DI constructor-param edge, exam.controller.ts)**; production scope/file count is the
tool's output (P1 measured: 10 scopes / 12 import-binding files — NOT the grep mention
count 14/49). Acceptance fixtures from the real import-binding consumer files; a
full-deletion-surface fixture via deletedPaths captures barrel consumers.

---

## 15. Evidence appendix — reproducible command output (second review)

Per the review: attach command output rather than re-write counts by hand.
All commands run read-only in `~/projects/foundation`. `P=packages/domains/education-platform/src/backend`.

### 15.1 Symbol census — SchoolAuthorizationService alone at spec-time `af92a878^`

```
$ git grep -l 'SchoolAuthorizationService' af92a878^ -- "$P" | grep -v '/schools/' \
    | sed 's#.*src/backend/##' | cut -d/ -f1 | sort -u
abilities
agent-tools
agents-read-models
agents-registry
conversations
examinations
homework-submissions
owner-access
student-learning-groups
student-learning-subject-lessons
student-learning-subject-lessons-homeworks
student-learning-subjects
student-subject-journal
students
# count = 14 ; credential-entities NOT present ; examinations present
```

### 15.2 Why the earlier draft said 15 — union grep adds the path-only consumer

```
$ git grep -l 'backend/schools' af92a878^ -- "$P" | grep -v '/schools/' \
    | sed 's#.*src/backend/##' | cut -d/ -f1 | sort -u
credential-entities
# the union (backend/schools OR SchoolAuthorizationService) = 15;
# the reproducible SYMBOL census = 14. examinations is in the SYMBOL census, NOT in the literal-path grep (which yields only credential-entities). The gate fires on the symbol census.
```

### 15.3 Decisive witness — live runtime import at teardown parent `3843cb35^`

```
$ git show 3843cb35^:$P/examinations/exam.controller.ts | sed -n '189p'
import { SchoolAuthorizationService, STUDENT_SCHOOL_STAFF_SCOPE_FORBIDDEN_MESSAGE } from '../schools/school-authorization.service'
# GRACE contract lines 21, 88 name SchoolAuthorizationService.resolvePlatformOrSchoolStaffScope
# kind = runtime-import (value import, used) → hard edge, behavioral closeout
```

### 15.4 Anachronism — curriculum-tree.service.ts postdates the teardown

```
$ git log --oneline --diff-filter=A -- "$P/examinations/services/curriculum-tree.service.ts" | tail -1
0fa596c6 feat(education-platform)!: remove the examination taxonomy from the kernel
$ git show -s --format='%ci | %s' 0fa596c6
2026-11-25 10:06:52 +0200 | feat(education-platform)!: remove the examination taxonomy from the kernel
# first appearance Nov 25 (NOT Nov 24); contract links spec 2026-11-24-curriculum-question-binding
```

### 15.5 Construction target absent at spec-time

```
$ git ls-tree -r --name-only af92a878^ | grep -c 'backend/curriculum/'
0
# backend/curriculum did not exist at spec-time; grepping its consumers is meaningless.
# At teardown parent 3843cb35^ its consumers were 4 scopes / 9 files (assessments/enrollments/policies/sessions, §15.6) — not 8 scopes.
```

Reproducibility note: `af92a878^` is the spec-time proxy (parent of the first
curriculum add, before the construction target existed). `3843cb35^` is the
teardown parent (wave 9, after curriculum was built in waves 2–7). The deletion
census object is the symbols being REMOVED (schools / SchoolAuthorizationService
/ student-learning-subjects), which exist at both refs; the construction target
(curriculum) is not a census object at spec-time.

### 15.6 Corrected counts (round-3 F5/F15/F16) — command output, not hand-written

```
$ git grep -l 'SchoolAuthorizationService' af92a878^ -- "$P" | grep -v '/schools/' | wc -l
49            # all files (example <consumer-files>)
$ git grep -l 'SchoolAuthorizationService' af92a878^ -- "$P" | grep -v '/schools/' | grep -vc '\.test\.\|__tests__'
24            # non-test files (example <non-test-files>); scopes = 14 (§15.1)

$ git ls-tree -r --name-only af92a878^ -- "$D/src/contracts" | grep -c '\.contracts\.ts$'
23            # *.contracts.ts at spec-time (NOT 49)
$ git ls-tree -r --name-only af92a878^ -- "$D/src/contracts" | wc -l
28            # total files in src/contracts at spec-time

$ git grep -l '\.\./curriculum/' 3843cb35^ -- "$P" | grep -v '/curriculum/' | sed 's#.*src/backend/##' | cut -d/ -f1 | sort | uniq -c
   1 assessments
   6 enrollments
   1 policies
   1 sessions        # 4 scopes / 9 files (NOT "enrollments(5)+entry(1)")

$ for pat in 'backend/schools' '\.\./schools/' 'SchoolsModule'; do git grep -l "$pat" af92a878^ -- "$P" | grep -v '/schools/' | sed 's#.*src/backend/##' | cut -d/ -f1 | sort -u | wc -l; done
1             # literal backend/schools → misses relative imports
12            # ../schools/ → resolved-specifier census needed (F9)
2             # SchoolsModule
```
`D=packages/domains/education-platform`, `P=$D/src/backend`. The example fan-out
(14/49/24) and §2.2 counts now trace to these commands. `schema-lines`,
`forced-migrations`, `brokenSignatures` were removed from the example/contract
(not census-computable in v1; F5).

---

## 16. Third adversarial round — gpt-6-luna, 2026-11-25 (Result: BLOCKED)

Independent family (OpenAI gpt-6-luna vs prior xAI grok-4.7). Read the full
document + the real `parseXmlLite`/lint engine; re-ran every §15 command.
Dispatcher independently re-verified the key blockers (below). Verdict: the
body-consistency charge of round 2 is genuinely fixed and §15 reproduces
byte-for-byte, BUT the teeth and the P0 seam are not implementable as written.
P0 cannot freeze until the design revision below lands.

### 16.1 Verified positives (hold under re-execution)

- §15.1–§15.5 reproduce exactly (14 scopes, examinations present,
  credential-entities absent; union 15; import line 189; 0fa596c6 = Nov 25;
  curriculum absent at spec-time).
- The import witness `exam.controller.ts:189` exists at `af92a878^` too — the
  witness is spec-time-valid, not just teardown-valid.
- §4.1/§4.5/§4.6/§4.7/§7/§9 body substantively corrected (round-2 charge fixed).
- Counterfactual gate fires on the verified object (SchoolAuthorizationService
  alone → 14 incl. examinations); "gate fires ≠ charter authored" coherent.

### 16.2 Findings disposition (17; dispatcher-verified)

Design additions required (BLOCKERS — not text repair):

| # | Sev | Finding (verified) | Required design change |
|---|---|---|---|
| 1 | Critical | `census-incomplete` has no machine-readable input: 0/103 plans have `<deletes>/<renames>`; T-023 deletions are prose in `<description>` → rule is NLP-over-prose, vacuous | Add structured `<deletes><path>/<symbol></deletes>` + `<renames><from/><to/></renames>` to PLAN schema in P0; derive census request from it; gate destructive tasks on it |
| 2 | Important | Omitting a scope from `<impact>` bypasses every rule (no census→impact coverage); author lists 13 of 14 S-* → cascade path stays open | Add rule: every host-census consumer scope with ≥1 hard edge MUST appear as S-<SCOPE> or a recorded exclusion with grant |
| 3 | Important | `impact-present` triggerless: 0/107 specs have `<tier>`; interview choice not persisted | Key the rule on declared paths (db/schemas/, contracts/, migrations — classifyPlanRisk signal) OR add `<tier>` to spec schema |
| 4 | Important | `parseXmlLite` has NO CDATA handling; verified throw on archived plan with TS generics (`</snippet> closes <TeacherUiPolicy>`); plan-derived rules never run on real plans | Add CDATA-aware tokenization as explicit P1 prerequisite; plan-derived rules SKIPPED (not passed) on parse failure |
| 9 | Important | Path half of census object not greppable: relative import specifiers; `backend/schools`→1, `../schools/`→12, bare `schools`→21 noise; §15.2 comment "examinations in both" false | Census = resolved TS import-specifier scan, not literal grep; correct §15.2 comment |
| 11 | Important | `census-stale` digest undefined canonical form (ref-prefix instability, color.grep bytes); ref contract contradictory (default HEAD vs committed OID; one ref field but stale-impact needs baseline+current) | Define canonical digest (JSON, resolved OID, sorted repo-relative paths, no ref prefix, --no-color); input {baselineRef, currentRef?} |
| 14 | Important | Example `scope-dir=src/backend` excludes barrel consumers (contracts/db schemas live outside backend); barrel is the PRIMARY signal yet invisible | scopeDir = package/repo root with declared exclusions; per-scope aggregation downstream |

Text repairs (conceded, safe_auto unless noted):

| # | Sev | Finding | Fix |
|---|---|---|---|
| 5 | Important | Example numbers hand-written: consumer-files/hard-edges=41 (real: 49 files/24 non-test/14 scopes); schema-lines=361 from wi-13 prose; forced-migrations=7 not in contract output; brokenSignatures/renamedSymbols inputs have no defined computation | Align example fields 1:1 with contract output; attach commands; define or drop schema-lines/forced-migrations/brokenSignatures |
| 6 | safe_auto | §14.3 attribute form `<census ref=…>` vs §4.1 "no attributes" | Rewrite as child elements |
| 7 | safe_auto | §13.3/§13.9 type-import SOFT vs §14.1/§4.6 HARD | Mark §13.3/§13.9 superseded by §14.1 (type-import hard for contradiction, compile-only closeout) |
| 8 | Important | `census-incomplete` ERROR vs "plan-parse WARN" in same paragraph; §14.4 row 1.3 conflict | State layer mapping once: census-incomplete = spec-time ERROR; undeclared-deletion = execution ERROR; no WARN layer; update §14.4 |
| 10 | Important | P1 "first validation ≥14" object-dependent (only SchoolAuthorizationService alone yields 14; path-based yields 12) | Name object+command exactly per §15.1 |
| 15 | Minor | "49 *.contracts.ts" wrong: 23 *.contracts.ts / 28 files at af92a878^ (49 = HEAD dir count) | Cite ref + exact artifact |
| 16 | Minor | "enrollments(5)+entry(1)" wrong: 4 scopes (assessments/enrollments/policies/sessions), 9 files at 3843cb35^ | Attach command or restate |

Scoping / policy decisions (gated_auto — operator input):

| # | Sev | Finding | Decision needed |
|---|---|---|---|
| 12 | Important | P0 freezes 9 rule names; cascade-concentration/impact-present/census-ref-unreachable/program-dag assigned to no package; §5 "work-item reference check" has no rule/package/acceptance item | Add owner column (rule→package) or drop from P0; implement work-item check or delete §5 row |
| 13 | Important | Gate retains escape (b) "operator justifies single-package" which §9 calls the failure; §5 "forces a program" not entailed | POLICY: above ERROR threshold, force program (grant unavailable) OR allow visible override grant; restate §5 as "forces explicit recorded choice" |
| 17 | Minor | program.xml layout undecided (.vvoc/programs/ vs sibling) blocks P0 freeze | Decide in P0; example already assumes .vvoc/programs/ |

### 16.3 Dispatcher independent verification

- CDATA: ran shipped `lib/lint.js parseXmlLite` on
  `archive/2026-08-04-domain-fe-teacher-contribution/plan.xml` → THROW
  `malformed XML: </snippet> closes <TeacherUiPolicy>`. Confirmed.
- Structured deletion: `grep -rl '<deletes>|<renames>|<deleted>' .vvoc/specs
  --include=plan.xml` → 0 of 103. Confirmed.
- Tier: `grep -rl '<tier>' … --include=spec.xml` → 0 of 107. Confirmed.
- Counts: SchoolAuthorizationService at af92a878^ = 49 files / 24 non-test / 14
  scopes; contracts = 23 *.contracts.ts / 28 files; curriculum consumers at
  3843cb35^ = assessments(1)/enrollments(6)/policies(1)/sessions(1) = 4 scopes;
  path grep backend/schools→1, ../schools/→12, SchoolsModule→2. Confirmed.

### 16.4 Required design revision before P0 freeze

The round-2 fixes made the BODY consistent; this round shows the TEETH were
declared without the schema/parser/semantics that make them deterministic.
Revision must add (not merely reword):
1. Plan `<deletes>/<renames>` structured schema (P0) — the deterministic input
   for census-incomplete and the census request. Destructive tasks require it.
2. census→impact coverage rule — every host-census hard-edge consumer scope
   appears in `<impact>` or a granted exclusion. Closes omission bypass.
3. impact-present path-trigger (db/schemas/, contracts/, migrations) — computable
   without persisted tier.
4. CDATA-aware parseXmlLite (P1 prerequisite); plan-derived rules skip-on-parse-fail.
5. Census = resolved import-specifier scan; scopeDir = package/repo root;
   barrel consumers visible.
6. Canonical census digest + {baselineRef, currentRef?} contract.
7. Example fields aligned 1:1 with contract output; all counts command-backed.
8. Rule→package ownership map; work-item check implemented or dropped.
9. Gate-escape policy decided (F13); program layout decided (F17).
10. Text repairs F6/F7/F8/F10/F15/F16.

Meta-lesson (third iteration of the same pattern): each round the proposal
declared a tooth without the deterministic substrate that makes it bite —
round 1 author-asserted census, round 2 caller-supplied input, round 3 no
structured plan deletion-set + no CDATA parser + no trigger. The fix is always
the same: specify the machine-readable input, the host computation, and the
parser capability BEFORE declaring the rule. P0 must freeze the substrate
(plan deletes schema, census contract with resolved specifiers + canonical
digest, CDATA parser), not just rule names.

---

## 17. Round-3 design revision — APPLIED inline (2026-11-25)

All 17 findings addressed in the BODY (not appended corrections — the round-2
meta-lesson). Operator policy decision F13 = **force program above ERROR
threshold**. The substrate is now specified, so P0 is freezable.

Design additions (blockers):
- **F1:** plan `<deletes><path>/<symbol></deletes>` + `<renames><from/><to/></renames>`
  schema added to §4.5 and P0 (§14.5); destructive tasks require it; census request
  derived from it; census-incomplete is deterministic, not NLP-over-prose.
- **F2:** `census-impact-coverage` rule (§4.6) — every host-census hard-edge
  consumer scope must appear as S-<SCOPE> or a granted exclusion; closes omission.
- **F3:** `impact-present` path-trigger (db/schemas/, contracts/, migrations),
  not tier (§4.6); computable without persisted interview choice.
- **F4:** CDATA-aware `parseXmlLite` named as P1 prerequisite; plan-derived rules
  skip-with-warning on parse failure (§4.6, §14.5).
- **F9/F14:** census = resolved TS import-specifier scan; scopeDir = package/repo
  root (barrel consumers visible); §15.2 comment corrected (§14.5, §4.1, §15.6).
- **F11:** canonical census digest defined (resolved OID, sorted repo-relative
  paths, no ref prefix, --no-color); input {baselineRef, currentRef?} (§14.3, §14.5).

Text repairs:
- **F5:** example fan-out aligned to contract output (14/49/24), command-backed
  (§15.6); schema-lines/forced-migrations/brokenSignatures removed from v1.
- **F6:** §14.3 census pin rewritten as child elements (no attributes).
- **F7:** §13.3/§13.9 marked superseded by §14.1 (type-import HARD for
  contradiction, compile-only closeout).
- **F8:** layer mapping stated once — census-incomplete spec-time ERROR,
  undeclared-deletion execution ERROR, no WARN layer (§14.1, §14.4 row 1.3).
- **F10:** P1 first-validation object named exactly (SchoolAuthorizationService
  alone at af92a878^ → 14 incl. examinations) (§14.5).
- **F15/F16:** §2.2 counts corrected (contracts 23/28 at spec-time; curriculum
  4 scopes/9 files), command-backed (§15.6).

Scoping / policy:
- **F12:** rule→package ownership map added (§14.5); §5 work-item row relabelled
  as a vv-spec interview step (P2), not a lint rule.
- **F13:** gate = WARN→recorded choice / ERROR→force program (grant unavailable
  above threshold); §4.3 and §5 restated; silent escape closed.
- **F17:** program layout decided = `.vvoc/programs/<id>/program.xml` (§4.4, §14.5).

Status: round-3 revision applied; round-4 confirmation found 11 bounded holes
(§18); round-5 revision (§19) addresses them. P0 substrate = impact schema, plan
deletes/renames schema (unique-tag D/R), spec <paths> schema, program.xml at
.vvoc/programs/, lint rule names + when + owners, spec_guard_census contract
(TS compiler API + worktree + deletedPaths + canonical digest + baselineRef/
currentRef + partition/exclusions). CDATA-aware parseXmlLite is a P1 prerequisite,
NOT P0 schema (round-4 F11). Implementation not started; skills/plugins/profile
untouched.
Recommended next: a confirmation adversarial pass on the revised substrate, then
P0 implementation as a program-spec eating its own contract.

---

## 18. Confirmation round (grok-4.7, round 4) — Result BLOCKED, bounded fixes

Cross-family confirmation (xAI grok-4.7 checking the OpenAI-reviewed revision).
Empirical base now CLEAN: §15.1–§15.6 reproduce byte-for-byte; parser corpus
measured (36/103 plans throw, CDATA stripping fixes 33/36, 3 residual non-CDATA;
9/107 specs throw pre-existing). Round-3 fixes landed as TEXT, but several do not
close their holes and the revision introduced new ones. 11 findings, all conceded
(dispatcher verified F1/F6/F8 independently). Reviewer: bounded schema/contract/
text edits + one policy alignment + one architecture decision — NO redesign.

Dispatcher verification: package-root SchoolAuthorizationService at af92a878^ =
50 files (backend 49 + __tests__ 1); `src/__tests__/sch-staff-01.instructor-journey.test.ts:103`
= `import type { SchoolAuthorizationService, SchoolAuthorizedActor } from
'../backend/schools'` (hard type-import → 15th consumer); `deletedPaths` 0 hits in
doc; 701 files use `@foundation/*`, export maps present (platform/db `./schemas`),
domain tsconfig paths = 0.

| # | Sev | Finding (conceded) | Fix direction | Decision? |
|---|---|---|---|---|
| 1 | Critical | F1 `<path>` half has no census channel (no deletedPaths[]); census-incomplete circular ("derived from this set" + "absent from request"); example pairs schools.ts with SchoolsModule (not its export) | Add deletedPaths[]/renamedPaths[{from,to}] to input/output/digest; <deletes> pairs path+exported symbols (or host export-extraction); precedence: spec pins census set, census-incomplete = plan<deletes> ⊆ spec set; remove circular wording | contract |
| 2 | Important | F2 "recorded exclusion with a grant" undefined (no excluded disposition/element/grant-ref/rule) | Delete clause for v1 (every hard-edge consumer = cover-in-plan/defer-to-program) OR add excluded disposition + exclusion-grant + P1 rule | policy |
| 3 | Important | <deletes>/<renames>/<edge> generic repeating children violate unique-tag convention; parseXmlLite pairing-lossy (symbol's owning path unrecoverable, omitted <to> shifts pairs) | Unique identities: D-NNN(path/symbol), R-NNN(from/to), E-NNN, DS-NNN | schema |
| 4 | Important | F13 "program or nothing" contradicted by §14.2 ERROR "OR a recorded operator grant" | §14.2 ERROR = program only, no override grant; acknowledgment grants WARN only | text |
| 5 | Important | F3 path-trigger unevaluable: spec has no path field (0/107 <evidence>); PATH_RISK_RULES lacks db/schemas/contracts | Add spec <paths> schema (trigger source) OR raw-text token scan + extend PATH_RISK_RULES (db/schemas/contracts/migrations) | schema |
| 6 | Important | "resolved TS import-specifier scan" is a label not algorithm; needs export-map/barrel/named-binding/usage analysis; zero-dep engine vs typescript devDep only | **ARCHITECTURE DECISION:** bounded hand-rolled resolver + conservative taxonomy v1 (zero-dep) vs TS compiler API (accurate, +dep/perf/worktree) | **decision** |
| 7 | Important | census-incomplete mislabeled "spec-time" (needs plan → plan-time); undeclared-deletion backstop unowned (absent F12 map/P4), no diff base/scope; "at the source" overclaims | Relabel census-incomplete = plan-time; define undeclared-deletion (baseline OID, diff scope, comparison) + P4 owner; downgrade "at the source" | text+contract |
| 8 | Important | F10 "14 scopes at package root" wrong (14 = backend count; package root = 50 files/15 incl test type-import); scope partition undefined | Define partition (backend sub-scopes + package-level naming S-TESTS/S-DB/S-CONTRACTS) + test/generated exclusions; re-derive acceptance numbers; census = host tool not sed | **decision** |
| 9 | Minor | digest collation/JSON canonicalization/schemaVersion bump undefined | code-point sort; canonical JSON (sorted keys, no whitespace, fixed escaping); schemaVersion integer bump invalidates prior digests | text |
| 10 | Minor | F7 stale in §3.3/§6 (type-only "over-report"/"imports secondary") | Mark superseded by §14.1 or reword (imports primary fan-out signal; incidental advisory) | text |
| 11 | Minor | P0/P1/layout stale across §6/§9/§13.6/§17 ("what is P0?" 4 answers; CDATA P0 vs P1) | §14.5 single P0/P1 source; update §6 (layout decided), §9 P1 row, §13.6, §17 (CDATA=P1) | text |

### 18.1 The architecture decision (F6) — census resolver

The census edge taxonomy (§14.1) asks for `runtime-import` = "value-import … USED
(DI/call)" and `schema-barrel` = "deleted TABLE REF" — these need named-binding
extraction + re-export traversal + value-vs-type USAGE classification (AST), not
just import-string resolution. foundation requires: extensionless relative →
.ts/.tsx/index.ts; `@foundation/*` workspace export maps (701 files); one-level
barrel re-export traversal (contracts/db schemas); no tsconfig paths. The plugin
is a zero-dependency pure engine (typescript is devDependency only).

**DECISION (operator, 2026-11-25): (B) TS compiler API now.** Options were:
- **(A) Bounded hand-rolled resolver + conservative taxonomy v1 (recommended):**
  relative extension/index probing + workspace export-map resolution + one-level
  barrel traversal + named-import extraction + `import type` detection. Conservative
  edge classification: value-import of deleted symbol = runtime-import HARD (drop
  the "used" usage test for v1 — a value import is a compile dependency regardless);
  type-import = HARD compile-only; barrel-path import = barrel HARD. Zero runtime
  dependency preserved. Usage-precision/table-ref detection → v2 (TS API) if
  calibration shows misclassification. Acceptance fixtures from the 49 real files.
- **(B) TS compiler API now (ts.createProgram at historical ref):** accurate
  usage/barrel/type analysis, but adds typescript runtime dependency + perf budget
  + historical-ref materialization (temp worktree checkout). Heavier P1.

### 18.2 Scope partition / test-file policy (F8)

At package root the census sees `src/__tests__` type-imports (hard per taxonomy).
Decision: are test/generated files consumer scopes? **DECISION (operator): (A)
exclude test/generated from fan-out (advisory); acceptance = 14 production scopes.**
- **(A) Exclude test/generated from fan-out scopes (advisory only):** fan-out counts
  production scopes; test type-imports reported but not threshold-driving. Acceptance
  = 14 backend scopes / 49 production files. Partition = first segment under
  src/backend; package-level src/db, src/contracts map to S-DB/S-CONTRACTS.
- **(B) Include as consumers (S-TESTS):** 15 scopes / 50 files; test compile-breaks
  drive the gate. Stricter, but a test-only type-import may over-trigger decomposition.

### 18.3 Bounded revision plan (round 5)

Apply F1/F3/F5 schema (deletedPaths channel, unique-tag D/R/E/DS identities, spec
<paths>), F2 exclusion (delete clause v1), F4/F7/F9/F10/F11 text + layer/ownership,
F8 partition + acceptance re-derivation, per the F6/F8 decisions. Then P0 freeze.
The reviewer confirms none of this requires redesigning the proposal — the
direction and empirical base hold; the substrate needs its contract/schema/
resolver specified to implementation depth.

---

## 19. Round-5 revision — APPLIED (2026-11-25); F6=TS API, F8=exclude test

All 11 round-4 findings addressed inline. Operator decisions: **F6 = TS compiler
API now** (accurate AST usage/barrel/type analysis; +typescript runtime dep on the
census host tool + worktree materialization + perf budget); **F8 = exclude
test/generated** from fan-out scopes (advisory; acceptance = 14 production scopes /
49 files).

- **F1 (Critical):** census contract gains `deletedPaths[]`/`renamedPaths[]`; host
  extracts deleted-path exports via TS API; precedence non-circular (spec pins set;
  census-incomplete = plan ⊆ spec set at PLAN lint). §4.5, §4.6, §14.5.
- **F2:** exclusion bypass removed v1; census-impact-coverage requires cover-in-plan
  / defer-to-program for every hard-edge consumer. §4.6, §14.5.
- **F3:** unique-tag identities D-NNN/R-NNN/E-NNN (no generic repeating children).
  §4.5, §4.1, §14.5.
- **F4:** §14.2 ERROR = program only, no override grant; WARN acknowledgment only.
- **F5:** spec `<paths>` schema (P-NNN) is the impact-present trigger source. §4.6, §14.5.
- **F6:** spec_guard_census = `ts.createProgram` over temp worktree at baselineRef;
  export-map resolution + named-binding + barrel traversal + usage classification;
  typescript runtime dep on census host tool (lint.ts verdict engine stays zero-dep);
  perf/worktree-cleanup P1 acceptance items. §14.5, §14.1.
- **F7:** census-incomplete = PLAN-time; undeclared-deletion = EXECUTION-time P4 rule
  (diff base/scope/comparison defined) + ownership row; "at the source" downgraded.
  §4.6, §14.1, §14.5.
- **F8:** scope partition = first segment under src/backend + S-DB/S-CONTRACTS;
  test/generated excluded (advisory); acceptance re-pinned to 14 production scopes /
  49 files. §14.5, §15.6.
- **F9:** digest canonicalization (code-point sort, canonical JSON sorted keys/no
  whitespace/fixed escaping, schemaVersion bump invalidates). §14.3.
- **F10:** §3.3/§6 type-import marked superseded by §14.1 (imports primary fan-out).
- **F11:** §14.5 single P0/P1 source; §6 layout decided, §9 P1 row updated, §13.6
  re-expansion note, §17 CDATA=P1.

P0 substrate now specified to implementation depth: schemas (impact / plan-deletes /
spec-paths / program), census contract (TS API + worktree + deletedPaths + canonical
digest + partition/exclusions), rule names + when + owners, CDATA P1 prerequisite.
The direction and empirical base (§15) hold across four rounds. Ready for P0 freeze
and implementation as a program-spec eating its own contract.

---

## 20. Round-6 focused confirmation — census contract (gpt-6-luna): implementable_with_fixes, APPLIED

Scope: ONLY §14.5 spec_guard_census contract (TS API + worktree semantics), the
newest least-verified part. Result: **implementable_with_fixes** (1 Critical,
4 Important, 6 Minor). TS-API core SOUND (measured: TS 6.0.3 parses foundation
configs 0 errors; moduleResolution: bundler resolves directory/relative imports;
createProgram ~2044ms / 7639 files, getTypeChecker ~475ms — seconds, not minutes).
Breaks are in worktree resolution, DI classification, acceptance derivation, purity
boundary. All 11 conceded; dispatcher independently verified F1 (213 @foundation
files), F2 (exam.controller.ts:253 constructor-param + emitDecoratorMetadata:true),
F3 (import-binding production consumers: P1 census measured 10 scopes / 12 files, not 14/49 mentions).

| # | Sev | Finding | Fix applied |
|---|---|---|---|
| 1 | Critical | Fresh worktree has no node_modules → @foundation/* export-map resolution fails (213/425 files; whole schema-barrel channel); wholesale live-node_modules symlink silently resolves to LIVE tree, breaking ref-pinning (measured) | §14.5: mirror pnpm per-entry relative links OR inject resolver from pnpm-workspace.yaml; FORBID wholesale live symlink; resolutionStrategy in digest; resolve baselineRef→OID first |
| 2 | Important | "value-vs-type USAGE" misclassifies 100% of acceptance production edges: Nest DI = constructor-param TYPE annotations (emitDecoratorMetadata) = runtime tokens; position-based test calls them type-only | §14.1/§14.5: runtime-import = non-elided value ref OR decorated-class param/property type; fixture exam.controller.ts = runtime-import |
| 3 | Important | "14 scopes / 49 files" = raw git grep MENTION count (49 incl 27 test; 22 prod mentions; ~6 import-binding files / 5 scopes); 14th scope agent-tools test-only; owner-scope excluded only by ad-hoc grep -v; `files` undefined | §14.5: files = ≥1 hard edge; ownerScope input / declaration-resolution; acceptance re-pinned to census OUTPUT (witness: examinations ∈ runtime-import DI consumers), NOT grep count |
| 4 | Important | census-stale assigned to zero-dep pure engine forbidden to re-run census (lint.ts:183-184); §K precedent host-supplies (index.ts:476) | §14.5/§14.3: HOST recomputes, passes censusDigest/censusStale into SpecLintOptions; lint compares only |
| 5 | Important | digest pins repo state not analyzer state: typescript ^6.0.3 (plugin) vs 5.9.3 (foundation); caret upgrade changes edges → false census-stale; deletedPaths/renames not digest-covered | §14.3: analyzer{name,version exact} + resolutionStrategy + sortedDeletedPaths + sortedRenamedPairs in digest + pinned census |
| 6 | Minor | edge source path:line → digest unstable (line shift = false stale-impact); TS API absolute temp paths | §14.3/§4.1: source = repo-relative file (no line), target = symbol; display-line non-digested |
| 7 | Minor | hardCount + barrel-kind precedence undefined; "hard" 3-vs-4 kinds ambiguous; Drizzle table matches runtime+schema | §14.5: hardCount = all 4 kinds (consistent §14.1); barrel kind by declaring-module origin, precedence barrel > runtime |
| 8 | Minor | "advisory test tier" impossible: domain tsconfig excludes tests (1050 roots, 0 test files) | §14.5: explicit file list with tests advisory OR drop advisory claim (tsconfig-excluded) |
| 9 | Minor | package-level src/schemas,transport,utils,agents,frontend unscoped | §14.5: S-PKG-<SEG> fallback |
| 10 | Minor | worktree lifecycle no semantics; leftover worktree observed in foundation | §14.5: unique tmp/run, try/finally remove --force + prune, per-repo lock (resolvedOid,scopeDir) |
| 11 | Minor | nonexistent delete/rename path → silent zero edges, no error rule | §4.6/§14.5: census-path-unresolvable error |

Clean sub-points (no finding): lib.es*.d.ts from host TS install; af92a878^ valid
commit-ish (→a2c3ad5d…); projects/* gitlinks (worktree empty, v1 deferral consistent);
packages/platform main-repo trees present; rename `from`-side extraction at baseline
correct (target need not exist); getExportsOfModule covers value+type exports.

**Acceptance correction (F3):** §15.1/§15.6's "14 scopes / 49 files" are git-grep
MENTION counts (reproduce byte-for-byte AS mention counts). The census import-binding
production consumer count is 10 scopes / 12 files for SchoolAuthorizationService alone
(P1 census, alias-aware + barrel traversal — more complete than grep).
(examinations included via DI). The counterfactual witness is QUALITATIVE and robust:
examinations is a runtime-import consumer contradicting "untouched"; the exact count
is census-tool-derived, never hand-pinned. The full deletion surface (deletedPaths:
schools, student-learning-subjects, modules, schema/contract slices) captures the
barrel consumers the symbol-only census misses.

Status: census contract now specified to implementation depth (materialization,
DI-aware usage, edge-kind precedence, owner-scope, digest analyzer-state, host/engine
split, lifecycle, path-resolvability, perf/cache). P0 freezable. Six rounds total;
the TS-API decision (operator) is validated as sound with bounded contract fixes.
Next: P0 implementation as a program-spec eating its own contract.

---

## 21. P0 DELIVERED (2026-11-25) — schema-contract seam, dogfooded

P0 implemented as additive files (no SKILL.md / plugin code / profile change),
dogfooded as a program + package spec instantiating the new schemas.

Deliverables:
- Artifact templates (agent-facing, P2/P3 consume):
  `agent-presets/skills/vv-spec/references/{impact,paths,program}-template.xml`,
  `agent-presets/skills/vv-plan/references/{deletes,renames}-template.xml`.
- Host contracts (P1 consumes): `dsh-vv-spec-guard/schemas/census-contract.json`
  (input/output JSON schema + worktree/DI/digest/partition/lifecycle semantics),
  `lint-rules.json` (13 rules + when/owner/mode/inputs + prerequisites), `README.md`
  (seam manifest + schema→enforcement map + frozen invariants).
- Dogfood: `.vvoc/programs/2026-11-25-vv-cross-scope-impact/program.xml` (P-P0..P-P5
  DAG, 8 components, INV-1..6) + `.vvoc/specs/2026-11-25-p0-schema-contracts/spec.xml`
  (paths P-001..P-010, program membership links, approved + digest 3072c61f…).

Verification: all XML parse with shipped parseXmlLite; both JSON valid;
spec_guard_approve recorded the digest; approval-unverified resolved.

**Confirmed P1 prerequisite (generation gap reproduced):** the dogfood unique-tag
spec (no attributes) triggers `[package] <spec> requires a non-empty package
attribute` — lint.ts:341 is UNCONDITIONAL (not gated by structuralStatus), so the
legacy attribute rule fires on new-convention artifacts. P1 must gate/remove it (and
the legacy completeness vocabulary) for unique-tag artifacts. The current skill
spec-template.xml hits the same rule. P0 freezes the new schema; the current engine
predates it — this error is expected and is the concrete P1 generation-gap target.

P0 acceptance met: well-formed templates, valid JSON, faithful to §14.5/§20, dogfood
instantiates the schemas, additive only. Next: P1 (spec-guard enforcement) consumes
the seam — census engine + CDATA parser + generation-gap fix (incl. the package rule)
+ new rules + archive calibration; cross-scope-fanout ships WARN.

---

## 22. P1 DELIVERED (2026-11-25) — spec-guard enforcement, built + tested

P1 implemented in dsh-vv-spec-guard (modifies lint.ts/index.ts/package.json; adds
census.ts). Full build `tsc -p tsconfig.json` exit 0; 15/15 lint unit tests pass;
census acceptance PASS.

Deliverables:
- `src/lint.ts`: CDATA-aware parseXmlLite (sentinel-protect payloads); generation-gap
  fix (isLegacyGeneration gates the legacy package-attribute, completeness, AND
  wave/depends_on reference rules so unique-tag/hybrid artifacts are not falsely
  errored — verified: a hybrid archived plan went 26 false reference errors → 0,
  while a legacy bad-ref is still caught); 8 generation-neutral cross-scope
  rules (impact-present, untouched-contradicted, census-impact-coverage, census-stale,
  census-ref-unreachable, census-path-unresolvable, cross-scope-fanout warn|error,
  census-incomplete) + CensusLintData host-supplied options (host/engine split).
- `src/census.ts`: runCensus per census-contract.json — TS compiler API, injected
  workspace resolver (pnpm-workspace globs + package.json exports), DI-aware usage
  classification (decorated-class param/property type + emitDecoratorMetadata →
  runtime-import), edge kinds with barrel precedence, canonical digest (analyzer
  version + resolutionStrategy + sorted inputs + normalized edges), scope partition
  + owner/test exclusion, worktree lifecycle.
- `src/index.ts`: spec_guard_census tool registered; host recomputes census from spec
  <impact><census> (extract params → git repo root → runCensus → cache → CensusLintData)
  and passes it to lintSpec/lintPlan. typescript runtime dep in package.json.
- Dogfood: `.vvoc/specs/2026-11-25-p1-spec-guard-enforcement/spec.xml` (approved).
- Tests: `lint.p1.test.mjs` (15), `census.test.mjs` (acceptance).

Acceptance (census-derived, NOT grep): SchoolAuthorizationService at af92a878^
(resolvedOid a2c3ad5d…), ownerScope=schools excluded, tests advisory →
**10 production consumer scopes / 12 import-binding files, all runtime-import**;
examinations ∈ consumers via the DI constructor-param edge (exam.controller.ts:253,
@Controller decorator, emitDecoratorMetadata:true). outputDigest a0a5e10f… identical
across two full recomputes (determinism PASS). The census is alias-aware + traverses
barrel re-exports, so it finds MORE consumers than the literal grep (which gave the
14/49 mention count and missed barrel importers). The §20 "≈5/6" rough estimate is
superseded by this measured 10/12.

Environment caveat (honest): the implementation session's sandbox is workspace-write;
foundation/.git is outside it, so `git worktree add` registration is denied there.
census.ts falls back to `git archive <oid> | tar -x` (tracked files only, ref-pinned,
identical digest). The real worktree lifecycle (add/remove --force/prune) was proven
on a writable shared clone with the SAME digest. The plugin runs host-side unsandboxed
in production, so the worktree path is used there.

v1 simplifications (documented in census.ts header): namespace imports / import=require
/ renamed barrel re-exports (export {X as Y}) not individually traversed (named
bindings are); currentRef accepted but ignored (stale-impact baseline+current pair is
P4); scopeDir must be a package dir (partition is package-relative); no cross-process
cache/lock (index.ts caches); transitive consumers deferred (direct-only v1).

Activation: the profile symlinks dsh-vv-spec-guard to this workspace, so the rebuilt
lib is already in place; the RUNNING host cached the old module at boot. The live
spec_guard_lint/spec_guard_census MCP tools pick up P1 after a `dsh web` restart
(plugin reload). Verified directly against the built lib: the P0 dogfood spec now
lints with 0 errors (package error gone).

LIVE VERIFICATION (post-restart, 2026-11-25): boot marker applied=true, no error,
tools registered (deferred boot order). spec_guard_lint on P0 + P1 dogfood packages
→ 0 errors each (generation-gap fix live; approval digests verified). spec_guard_census
on the foundation witness (repoRoot=foundation, baselineRef=af92a878^,
scopeDir=packages/domains/education-platform, ownerScope=schools,
deletedSymbols=[SchoolAuthorizationService]) → resolvedOid a2c3ad5d…,
typescript@6.0.3 injected-resolver, outputDigest a0a5e10f… IDENTICAL to the sandboxed
acceptance run (digest independent of materialization mode + process), 10 production
consumer scopes all runtime-import, examinations witness present, 29 advisory test
edges. The unsandboxed host used the worktree path; the digest matches the sandboxed
git-archive fallback exactly.

Calibration: cross-scope-fanout ships WARN (default in the host wiring). The witness
confirms the gate fires on the schools deletion surface (10 scopes ≥ threshold 3).
The archive calibration pass (confirm it does NOT fire on local-feature noise) is the
documented gate to flipping ERROR — a P1 follow-up research task, not yet run.

Next: P2 (vv-spec skill wiring) + P3 (vv-plan skill wiring) consume the P0 templates
and P1 rules; P4 execution feedback; P5 panel + v2.

---

## 23. P2 DELIVERED (2026-11-25) — vv-spec skill wiring

P2 wired agent-presets/skills/vv-spec/SKILL.md (additive; skill-only, no plugin/profile
change). Frontmatter intact; paths/impact/program templates parse; P2 spec approved
(digest 5d366389…).

Added to the skill:
- `<scope_impact>` section (after classify_boundary): the orthogonal HORIZONTAL axis.
  Tier 2/3 trigger on shared-surface deletion/rename; declare the deletion surface,
  resolve baselineRef→OID, call spec_guard_census (host computes, DI-aware), populate
  <impact> from impact-template.xml with host output (never hand-written counts);
  census-impact-coverage + untouched-contradicted discipline; work-item reference
  check; implicit-premises (IP-NNN) surfacing; one confirmation card.
- `<decomposition_gate>` section: threshold ≥3 production consumer scopes; program
  (program-template.xml, .vvoc/programs/, dep-P DAG) OR recorded single-package choice;
  WARN vs ERROR modes; cut packages at unknowable contracts.
- spec_document_format: spec = core template + <paths> (paths-template.xml, always) +
  <impact> (impact-template.xml, when triggered); paths is the impact-present trigger
  source; program layout note.
- self_review: paths/impact host-computed/decomposition checks. task + roadmap updated.

Effect: vv-spec now PRODUCES the paths/impact/program artifacts that activate the P1
cross-scope rules. A cross-scope spec interview yields a census-backed impact matrix
and (when the gate fires) a program; spec_guard_lint reports impact-present /
census-impact-coverage / untouched-contradicted / cross-scope-fanout (WARN). This is
the shift-left the CURRICULUM case lacked: the horizontal fan-out is measured and
recorded BEFORE implementation, and "untouched" claims are verified against host census.

Activation: the skill is loaded by vv-controller sessions from the workspace symlink;
new sessions pick up the wired skill (no plugin restart needed for skill content, but
the P1 tools it calls require the restarted host — already live).

Next: P3 (vv-plan wiring: deletes/renames + consumer-coverage + scope-barrier waves +
behavioral ACs for surface/policy), then P4 execution feedback, P5 panel + v2. Archive
calibration (cross-scope-fanout WARN→ERROR) remains the gate before ERROR enforcement.

---

## 24. P3 DELIVERED (2026-11-25) — vv-plan wiring + plan/program lint rules

P3 completed the spec-to-plan cross-scope contract. Build exit 0; P1 tests 15/15,
P3 tests 11/11; dogfood program.xml lints 0 errors (program-dag validates the real
P0–P5 DAG). P3 spec approved (digest f1f15241…).

Skill (agent-presets/skills/vv-plan, additive):
- `<cross_scope_plan>` section: read spec <impact>; structured deletion surface
  (deletes D-NNN / renames R-NNN, subset of spec census set = census-incomplete);
  task <scope>; <consumer-coverage> (CC-NNN covered-by / deferral-target);
  scope-barrier waves (shared-contract wave closes consumers in-wave or defers with
  tracking); behavioral ACs for change-kind surface/policy (not universal e2e);
  cascade-concentration discipline (no T-023-style single-task teardown).
- plan_document_format: task children + scope/deletes/renames; consumer-coverage +
  scope-barrier rule. plan-template.xml extended (task <scope>, consumer-coverage
  section, destructive-task deletes reference). self_review + task updated.

Lint (dsh-vv-spec-guard, the P3-owned rules not in P1's 8):
- consumer-coverage (PLAN): every spec impact consumer scope (cover-in-plan /
  defer-to-program) maps to a plan task <scope> or a consumer-coverage deferral;
  reads sibling spec via host-supplied specText.
- cascade-concentration (PLAN): a task with ≥5 shared-surface deletes/renames
  (provisional threshold, pending archive calibration) → error requiring split/program.
- program-dag (PROGRAM, new lintProgram + lintFile program.xml routing): package DAG
  acyclic, dep-P refs resolve to declared P nodes, every charter component owned once.

Effect: the pipeline now produces AND validates the full cross-scope artifact chain —
spec paths/impact (P2) → plan deletes/consumer-coverage/scope-barrier (P3) → program
DAG (P2/P3). census-incomplete ties plan deletes ⊆ spec census set; consumer-coverage
ties spec impact consumers ⊆ plan tasks; program-dag validates the decomposition. The
CURRICULUM failure modes (undeclared consumers, concentrated teardown, no program) are
each gated by a deterministic rule.

Activation: skill content picked up by new vv-controller sessions; the new lint rules
require a `dsh web` restart to load the rebuilt plugin (P1 tools already live; P3 adds
lint rules + program.xml routing to the same plugin).

Next: P4 (execution feedback: stale-impact pre-flight, undeclared-deletion commit gate,
SCOPE_CASCADE_DISCOVERED + addendum + AMEND-GRANT), P5 (panel + v2). Archive calibration
(cross-scope-fanout + cascade-concentration thresholds WARN→ERROR) before ERROR mode.

---

## 25. End-to-end demonstration (2026-11-25, post-restart) — PASS

Replayed the CURRICULUM failure mode through the new pipeline with REAL foundation
census data. Reproducible: `dsh-vv-spec-guard/demo-cross-scope.mjs`.

- STEP 1 (host census, live MCP spec_guard_census): schools deletion surface at
  af92a878^ → 10 production consumer scopes, examinations present (DI runtime-import),
  outputDigest a0a5e10f… → fan-out 10 ≥ threshold 3 ⇒ decomposition gate requires a
  program. This is the horizontal fan-out the original domain-only spec never measured.
- STEP 2 (happy path): spec paths+impact built from the real census, plan with
  deletes⊆census-set + task scopes + consumer-coverage, program with a clean DAG →
  lintSpec/lintPlan/lintProgram all 0 errors (cross-scope-fanout WARN as designed).
- STEP 3 (the teeth): each CURRICULUM failure mode fires its rule on a mutated artifact —
  3a "examinations untouched" vs real DI edge → untouched-contradicted;
  3b omit a consumer scope → census-impact-coverage;
  3c tamper the census digest → census-stale;
  3d 7 schema deletes in one task (T-023) → cascade-concentration;
  3e plan drops a consumer → consumer-coverage;
  3f plan deletes an uncensused surface → census-incomplete;
  3g program cycle → program-dag.
  RESULT: happy path clean=true; all 7 gates fire=true.
- Live MCP structural rules post-restart: spec_guard_lint on a paths-without-impact spec
  → impact-present error; on a cyclic program.xml → program-dag cycle error. Confirms
  the restarted host serves the P2/P3 rules.

The spec→plan→program cross-scope contract is produced AND validated end-to-end; every
CURRICULUM failure mode is gated by a deterministic rule fed by host-computed census.

---

## 26. P4 DELIVERED (2026-11-25) — execution feedback closes the loop

P4 implemented; build exit 0; P4 host-check tests 8/8; extended P0–P4 demo PASS
(happy path clean, all 7 spec/plan gates fire, P4 execution feedback ok). P4 spec
approved (digest 178a6871…).

Host (dsh-vv-spec-guard/src/execute.ts + index.ts tool registration):
- checkUndeclaredDeletions → spec_guard_undeclared_deletion (COMMIT gate): git diff
  --name-status -M baseline..head vs plan <deletes>/<renames>; a diff deletion/rename
  the plan never declared → undeclared-deletion. Verified on the real teardown diff:
  341 deletions/renames, declared=[] → 341 undeclared; declaring one → 340.
- computeStaleImpact → spec_guard_stale_impact (PRE-FLIGHT drift gate): runCensus at
  baseline + current, new consumer scopes → drift. Same-ref determinism verified
  (no drift, identical digests). Two full census runs (the baseline+current pair).

Schema + vocabulary: impact-addendum-template.xml (ADD-NNN, append-only, lifecycle
recorded→triaged→resolving→resolved/deferred/spawned/parked); reason codes
SCOPE_CASCADE_DISCOVERED + ADDENDUM_BUDGET_EXHAUSTED added to the vv-execute envelope;
AMEND-GRANT (delta-digest-bound) in reviews/grants.md.

Skill wiring:
- vv-execute <execution_feedback>: pre-flight stale-impact, undeclared-deletion commit
  gate, discovery intake (append ADD-NNN, block seam, notify controller), triage by
  authority, resolution Paths A (safe_auto bounded amendment + AMEND-GRANT) / B
  (gated/manual escalation, stop seam) / C (emergent → program package), discovery
  budget (K=3 → ADDENDUM_BUDGET_EXHAUSTED → re-spec/program).
- vv-review <cross_scope_review> (name consumer entry files in dispatch; adversarial
  brief asks which untouched claims coupling contradicts) + <goal_attainment>
  (per-consumer attainment ledger at plan close; surface/policy needs behavioral
  evidence; unattained consumer blocks close unless deferred).

Demo STEP 4: undeclared-deletion catches the teardown's undeclared deletions (the
T-023 backstop); stale-impact pre-flight re-census catches approve→execute drift.

Activation: host tools need a `dsh web` restart to load; skill content picked up by new
sessions. The full P0–P4 chain is produced AND validated end-to-end.

Next: feedback round on P4, then P5 (panel impact chip + addendum-pending state + v2
census items). Archive calibration (cross-scope-fanout + cascade-concentration
WARN→ERROR) before ERROR enforcement.

---

## 27. P4 feedback round — two adversarial reviews, all findings fixed

Two independent feedback rounds (gpt-6-luna cleared_with_fixes; grok-4.7 blocked,
deeper) converged on the same holes. All addressed; build exit 0; P1 15/15, P3 11/11,
P4 13/13 (5 new regression tests). Verified on scratch git repos, not just committed
history.

Host correctness (execute.ts):
- F1/C1 (Critical): commit gate defaulted to HEAD → blind to the about-to-be-committed
  deletions (vacuous green at the mandated invocation). FIXED: default headRef=WORKTREE;
  skill passes it explicitly. Regression: uncommitted delete+rename now detected.
- F3: declared set was a flat union; a declared delete was satisfied by a rename (file
  survives at an undeclared path). FIXED: kind-separated — D/T match a declared delete,
  R must match a declared rename PAIR (from AND to). Regression verified.
- F4: stale-impact compared scope SETS, missing edge-level drift within a scope.
  FIXED: compares edge tuples (scope,kind,source,target); drift on new edges.
- current-side abort: a declared path already moved/vanished at currentRef hard-failed
  the current census. FIXED: tolerate absent declared paths on the current run, report
  them as removedDeclaredPaths drift.
- vacuous surface: empty deletion+rename surface returned a green. FIXED: typed refusal
  stale-impact-vacuous-surface.
- M3: git C-quoting + ./ normalization. FIXED: core.quotepath=false + normalizePath.
- M4: type-change (T) ignored. FIXED: counted as destructive.

Read-side enforcement (was prose):
- F5: unresolved-addendum had no read side. FIXED: lintAddendum (any non-terminal
  ADD-NNN blocks), host reads impact-addendum.xml in package mode, wired to validate-plan.
- baseline-oid pin: the commit gate's diff window was undefined. FIXED: spec_guard_approve
  records baseline_oid (approval-time commit) in approvals.json; the gate/skill use it.
- F6: goal_attainment was reviewer prose with no close gate. FIXED: persist
  reviews/goal-attainment.xml; vv-execute prepare-archive requires it when the spec has
  impact consumers (unattained non-deferred consumer stops the archive).
- F7: AMEND-GRANT delta-digest binding was unimplementable prose. FIXED: concrete record
  format (delta=sha256 of canonical plan diff, plan-before/plan-after digests) bound to
  the spec_guard_approve re-approval. (Full automatic delta-application verification is a
  follow-up; the binding is now auditable via recorded digests.)

Skill wiring (F2): the gates lived in a detached section. FIXED: undeclared-deletion
wired into the <commit> step; SCOPE_CASCADE_DISCOVERED intake wired into
<handle-status><blocked> (no operator-chat degeneration). ADDENDUM_BUDGET_EXHAUSTED added
to both envelope enums; parked/batching rules added; stale-impact input derivation +
failure branches named.

Schema/template: addendum gains <wave>, escalated status, receipts, and a pinned
evidence anchor (<excerpt> + <anchor-digest>). package.json files adds lib/execute.*.
lint-rules.json gains unresolved-addendum + stale-impact-vacuous-surface; stale-impact
description corrected to edge-level.

Residual (honest): AMEND-GRANT full delta-application auto-verification is a follow-up
(the digest binding is recorded/auditable, not yet machine-applied); the census cache +
per-repo lock (§14.5) remain unimplemented (two uncached runs per pre-flight, ~20-60s,
acceptable once-per-plan). The P4 package spec itself uses a bare <goal> (the P0/P1
generation-neutrality completeness gap noted by grok is a separate lint-vocabulary item).

---

## 28. P5 DELIVERED (2026-11-25) — panel cross-scope state; PROGRAM COMPLETE

P5 (optional panel polish) delivered: dsh-vv-panel/client.js gains an addendum-pending
operational state (any non-terminal ADD-NNN in impact-addendum.xml blocks execution,
attention styling, routes to vv-execute) and an impact fan-out suffix on the state chip
(consumer-scopes from the spec impact). Reads impact-addendum.xml through the
workspaceFiles bridge; STATE_SKILL + locale (en/ru) + fallback state list extended.
node --check OK; activation.test.mjs passes; helper logic verified. stale-approval
precedence preserved; state stays file-derived (no fabrication). P5 spec approved
(digest 6ae68992…).

Deferred P5 follow-ups (honest, non-goals): full program-rollup chip; v2 census items
(weighted threshold, transitive census, submodule census). These are genuinely v2.

### Program complete: P0 → P1 → P2 → P3 → P4 → P5

The vv cross-scope impact extension is delivered end-to-end and dogfooded as a program
(.vvoc/programs/2026-11-25-vv-cross-scope-impact/program.xml, all six packages applied,
each with its own approved spec):
- P0 schema-contract seam (impact/paths/program/deletes templates + census contract +
  lint rule registry).
- P1 spec-guard enforcement (CDATA parser, generation-gap fix, 8 cross-scope rules,
  spec_guard_census TS-API engine). Live-verified.
- P2 vv-spec wiring (SCOPE_IMPACT census-driven interview step + decomposition gate).
- P3 vv-plan wiring (deletes/renames, task scope, consumer-coverage, scope-barrier waves,
  behavioral ACs) + consumer-coverage/cascade-concentration/program-dag rules.
- P4 execution feedback (undeclared-deletion commit gate, stale-impact pre-flight,
  ADD-NNN addendum + AMEND-GRANT + discovery protocol, goal-attainment closeout). Two
  adversarial feedback rounds; all findings fixed (§27).
- P5 panel cross-scope state (addendum-pending + impact fan-out chip).

Every CURRICULUM failure mode is now gated by a deterministic rule fed by host-computed
census, and the full chain is produced AND validated end-to-end (demo-cross-scope.mjs:
happy path clean, all 7 spec/plan gates fire, P4 execution feedback ok). The shift-left
the case lacked is in place: horizontal fan-out measured before implementation,
"untouched" claims verified, decomposition forced, undeclared deletions caught at commit,
mid-execution discoveries routed to controlled amendment instead of operator chat.

Remaining follow-ups (not blockers): archive calibration to flip cross-scope-fanout +
cascade-concentration WARN→ERROR; AMEND-GRANT delta auto-verification; census cache +
per-repo lock; v2 census items; full program rollup. A `dsh web` restart activates the
P3/P4/P5 host changes in the live profile (P1 already live).

---

## 29. Follow-ups DELIVERED (2026-11-25) — all six, in order

Each residual follow-up implemented and tested. Build exit 0; 52 unit tests pass
(P1 15, P3 11, P4 13, amend 7, v2census 6); panel activation + full P0–P4 demo green.

1. **Archive calibration (WARN→ERROR):** crossScopeFanoutMode/Threshold +
   cascadeConcentrationThreshold now configurable (VvSpecGuardConfig); default mode
   'error' (calibrated gate). calibrate.mjs validates the threshold on real foundation
   surfaces: schools=10 fires, meets=1 quiet, whiteboard=3 boundary. Honest limit: the
   threshold is a scope-count discriminator; full cascade-label calibration is the deeper
   research pass, and the gate stays tunable (set 'warn' to disable).
2. **AMEND-GRANT delta auto-verification:** src/amend.ts — canonical LCS line-diff delta
   digest + verifyAmendGrant (checks delta + plan-before/after digests). Tool
   spec_guard_amend_verify (compute or verify mode). A small granted delta cannot sneak a
   larger change. 7 tests (match/tamper/wrong-delta/determinism).
3. **Census cache + per-repo lock:** runCensusCached in census.ts — result cache keyed by
   determinism inputs (incl. ts.version + resolutionStrategy) + per-repo promise-chain
   lock serializing worktree materialization. Verified: 1790ms→0ms reuse, concurrent runs
   serialized. Used by census tool, recompute, stale-impact.
4. **v2 census items (opt-in, default unchanged):** weightedFanout (barrel edges weigh 2);
   transitiveDepth (bounded importers-of-consumers pass); includeSubmodules (git ls-tree
   160000 gitlink detection → projects/*). Supplementary fields, core direct-edge digest
   unchanged. 6 tests.
5. **Full program rollup chip:** panel scanProgramRollup reads .vvoc/programs/, rolls up
   P-* applied/total, shows `prog:4/6` suffix on the state chip. File-derived, honest.
6. **Generation-neutrality completeness gap:** lintSpec now requires a bare <goal> for
   approved/applied unique-tag specs (not just the legacy wrappers), so "delivered" rests
   on a criterion. Verified.

Activation: a `dsh web` restart loads the new host tools/config (amend_verify, cached
census, calibrated error mode); panel rollup is client-side. The cross-scope pipeline is
now gating (error mode), machine-enforced on amendments, cached, and deeper-aware.

---

## 30. Live verification (post-restart, 2026-11-25) — all follow-ups confirmed

Via the live MCP tools after the user's restart:
- **spec_guard_amend_verify (compute):** returns canonical delta digest + plan-before/after.
- **spec_guard_amend_verify (verify, match):** "OK: applied change matches the AMEND-GRANT".
- **spec_guard_amend_verify (verify, tamper):** a sneaky extra task → "MISMATCH: plan-after,
  delta" — the granted delta cannot sneak a larger change.
- **spec_guard_census (cached):** 10 production scopes, digest a0a5e10f… (cache reuse).
- **spec_guard_undeclared_deletion:** real teardown 3843cb35^..3843cb35 → 341 deletions/
  renames, all undeclared at empty declared surface; distinguishes delete vs rename(from→to).
- **spec_guard_stale_impact:** af92a878^ vs 3843cb35^ → drift=false, digests differ by oid,
  no new consumer edges (tool works; positive drift unit-tested).
- **Error-mode gating (self-contained demo-gate repo, 3 consumer scopes):** spec_guard_lint
  → `[cross-scope-fanout] fan-out 3 ≥ threshold 3 … program decomposition required in ERROR
  mode` as an ERROR (calibrated mode active), plus census-impact-coverage firing on
  host-census scope-name mismatch. Demo repo cleaned up afterward.

All six follow-ups are live and enforced. The pipeline gates cross-scope fan-out (error
mode), machine-verifies amendments, caches census, and detects undeclared deletions / drift.

---

## 31. Full-archive calibration (follow-up #3) — real cascade rate

calibrate-archive.mjs replays all 185 foundation archive packages. Archived plans are
legacy (no structured deletes), so historical per-package fan-out is not reconstructable;
instead it labels OUTCOMES — did a destructive change spawn reactive follow-ups (the
cascade signal the gate exists to prevent).

Result:
- 185 packages; 16 destructive (removal/teardown/replace/extract); 56 reactive.
- **6/16 destructive changes spawned reactive follow-ups = 38% cascade rate.**
- Detected chains include the canonical CURRICULUM: education-platform-model →
  billing-model-reads + education-model-smoke-followup; curriculum-catalog →
  curriculum-tab-single-view → draft-base-lifecycle / editor-layout-contract →
  question-binding.

What this gives: (a) the gate targets a real, frequent problem (over a third of
destructive changes cascade); (b) a cascade-chain dataset that feeds design heuristics
(follow-up #4). Honest limit: outcome labels are inferred from goal keywords + slug
overlap (not hand-labeled ground truth), and this calibrates the cascade RATE / target
population, not the fan-out threshold itself (historical fan-out needs structured deletes
that legacy plans lack). The threshold stays tunable; the mini-calibration (calibrate.mjs:
schools=10 fires, meets=1 quiet) validates the scope-count discriminator on live refs.

---

## 32. GRACE → invariants (follow-up #2) — GRACE becomes a verified element

Goal: turn GRACE from nice-to-have documentation into a genuinely used verification
element. Foundation has START_INVARIANTS in 610 files — the semantic guarantees already
exist; the missing link was connecting them to the change pipeline.

Delivered (src/grace.ts + spec_guard_grace tool):
- parseGrace: extract MODULE_CONTRACT (PURPOSE/DEPENDS), START_INVARIANTS, START_MODULE_MAP.
- checkGrace: verify import-ban invariants ("NEVER imports from domains/*") against actual
  imports; classify invariants import-ban / reference-ban (structural) vs behavioral.
- atRiskInvariants: given changed symbols, surface every GRACE invariant mentioning them —
  the SEMANTIC consequence-inventory. Verified on foundation: changing
  SchoolAuthorizationService/schools surfaces 40 at-risk invariants across 322 files.
- spec_guard_grace tool: mode check (a file's GRACE contracts) + mode at-risk (scan a scope
  for invariants mentioning changed symbols). Behavioral invariants are surfaced as
  requiring executable verification (tests/e2e), not trusted as prose.

This is the semantic half of consequence-first (#4): the census gives the STRUCTURAL
consequence-inventory (who imports X); GRACE gives the SEMANTIC one (which guarantees mention
X). Together they enumerate what a change puts at risk. Import-bans are auto-checked;
behavioral guarantees become required verification.

Honest limits:
- MODULE_MAP verification is now FACTUAL via the TS API (closed): census.createScopeProgram
  + grace.tsPublicSurface extract the file's real public surface (file-level exports + public
  methods of exported classes, private/protected excluded) through the checker. Verified on
  curriculum-tree.service.ts: the 8-entry MODULE_MAP matches exactly (missing=[], extra=[]).
  The earlier regex class-method extraction was fragile and is replaced; regex remains only
  as a fallback when no repoRoot/scopeDir is supplied (labeled informational).
- Invariant classification is pattern-based (import-ban / reference-ban / behavioral), not
  full semantic understanding; behavioral invariants still need executable tests to truly
  verify (the next step: invariant → property-test generation).

Activation: spec_guard_grace loads on the next `dsh web` restart. 69 unit tests pass
(P1 15, P3 11, P4 13, amend 7, v2census 6, grace 17).

---

## 33. invariant → property-test — closing the behavioral verification loop

Behavioral GRACE invariants were surfaced as "requiring verification" but not tracked or
enforced. Now they become concrete, tracked, enforced verification obligations.

Delivered:
- grace.invariantObligations + propertyTestScaffold: each at-risk behavioral/reference-ban
  invariant → an obligation (IV-NNN) with a property-test scaffold (it.todo, named property).
  import-ban invariants are already auto-checked (no scaffold).
- invariant-verification.xml ledger (IV-NNN: invariant/module/test-path/status/evidence);
  grace.parseInvariantVerification.
- lint.lintInvariantVerification → unverified-invariant rule: any IV-NNN not discharged
  (verified/waived) is an error; wired into spec_guard_lint package mode, so it blocks
  plan-close. Connected to vv-review goal_attainment.
- spec_guard_invariant_tests tool: given changed symbols, generates the obligations + ledger
  XML + scaffolds for the package. Verified on foundation: SchoolAuthorizationService →
  4 behavioral obligations.

Honest design limit (important): a natural-language guarantee cannot be turned into a
CORRECT test fully automatically. The scaffold is an OBLIGATION + starting point, not a
finished test — the agent/human writes the actual assertion, then marks the obligation
verified with evidence. The closure is that the pipeline now TRACKS and ENFORCES that every
at-risk behavioral invariant gets a discharged test (or explicit waiver); it can no longer be
silently ignored as prose. This is the enforceable half; the test-authoring half remains
agent/human work (primed by the scaffold).

81 unit tests pass (P1 15, P3 11, P4 13, amend 7, v2census 6, grace 17, invariant 12).
Activation: spec_guard_invariant_tests + unverified-invariant load on the next restart.

The behavioral verification loop is now closed in the enforceable sense: invariant →
obligation → scaffold → test → verified/waived, with plan-close gated on discharge.

---

## 34. Live verification (post-restart) — GRACE + invariant tools confirmed

Via the live MCP tools after the user's restart:
- spec_guard_grace (check, TS surface) on curriculum-tree.service.ts:
  **MODULE_MAP ↔ public surface (TS API): OK** — the factual closure works live; import-ban
  invariants OK; 3 behavioral invariants surfaced as requiring tests.
- spec_guard_invariant_tests (SchoolAuthorizationService): 4 at-risk behavioral obligations;
  generates invariant-verification.xml ledger (IV-001..004, pending) + it.todo scaffolds.
- unverified-invariant gate (demo ledger): IV-001 pending → error; IV-002 verified → not
  flagged. Confirms plan-close is blocked on pending obligations. Demo cleaned up.

The full semantic verification chain is live: census (structural) + GRACE import-bans
(auto-checked) + GRACE MODULE_MAP (TS-API factual) + behavioral invariants → tracked,
enforced obligations.

---

## 35. #4 design-reasoning mechanisms — the generative half

The gates verify consequences; #4 makes the model REASON about them before committing.
Delivered as vv-spec skill sections + a design artifact (prompt-wiring, the "develop the
model's vector space" mechanisms):

- design-template.xml: a <design> spec section — consequence-inventory
  (structural/semantic/behavioral/future), consumer-contracts (CC-NNN), decomposition
  strategy (strangler/big-bang/single-package + rationale), pre-mortem.
- vv-spec <design_reasoning> with four sub-mechanisms:
  - consequence_first: evidence-backed consequence inventory (census + GRACE) before
    choosing the approach; every consequence accounted for (cover/defer/redesign).
  - consumer_driven: design the shared surface FROM consumer needs (contracts), inverting
    the CURRICULUM producer-centric failure.
  - strangler_preference: for shared-surface replacement, prefer build-alongside →
    migrate-per-consumer → census-gated demolition over big-bang when coexistence feasible;
    demolition moves from first step to last.
  - design_premortem: "assume it already cascaded — what was missed?" prospective hindsight;
    adversarial design lens (vv-review, different family) for Tier 3 before approval.
- Wired into spec_document_format + self_review + task; design-reasoning-missing lint nudge
  (advisory warning when a cross-scope spec has <impact> but no <design>).

Honest scope: these elicit consequence/failure/consumer reasoning (the model has the latent
capability; the structured forcing-functions activate it). They are NOT a guarantee of good
judgment — the deterministic gates (census/GRACE/invariant) verify the structural/semantic
parts; design taste remains model/human. The ceremony-without-substance risk is countered by
the adversarial lens + deterministic verification.

83 unit tests pass (P1 17, P3 11, P4 13, amend 7, v2census 6, grace 17, invariant 12).
Activation: skill content picked up by new vv-controller sessions; the lint nudge loads on
the next restart.

The loop is now complete: design reasoning GENERATES consequence-aware designs (#4) →
census/GRACE/invariant gates VERIFY them → execution feedback (addendum/amend/undeclared)
catches what slips through. Generative + verifying + enforcement halves all present.

---

## 36. Live vv-spec dry-run — found and fixed two real bugs

Ran the full vv-spec flow end-to-end on a synthetic foundation-like repo (shared
AuthorizationService + 3 consumer scopes: examinations/schools/students, runtime-import):
census → populate <impact> → decomposition gate → GRACE at-risk → invariant obligations →
<design> → program → lint → approve → behavioral ledger. The dry-run exposed two real defects
that synthetic unit tests had not:

1. **Census cache staleness (real bug).** runCensusCached keyed the cache by the LITERAL
   baselineRef ('HEAD'), not the resolved OID. After the branch moved (new commit), it
   returned the stale pre-move census (old OID/digest) — census-stale fired against the
   author's fresh digest. Fixed: resolveRef→OID FIRST, key on the immutable OID
   (resolveBaselineOid). Verified: HEAD → new OID 11cd8e4, fresh digest 086e6d88.
2. **cross-scope-fanout ignored a declared program (real gap).** The gate fired whenever
   fan-out ≥ threshold, even when the spec declared decomposition=program + a valid program
   path — so a correct program could never satisfy it. Fixed: the gate now skips when
   decomposition=program AND <program> path is present; it fires only when no program is
   declared. Verified: spec with program → errors=[], program DAG valid.

After the fixes the dry-run is clean: census (3 scopes, OID-pinned digest) → <impact>
host-computed → <design> (consequence inventory + consumer contracts + strangler +
pre-mortem) → program P-1..P-5 (build-alongside / migrate-per-consumer / census-gated
demolition) → lint spec errors=[] warnings=[] → approve digest + baseline_oid correct →
invariant gate: 3 pending obligations block close, discharged → 0.

Honest note: the live MCP host process still runs the pre-fix lib (loaded at startup), so
the MCP tools show census-stale / fanout until the next `dsh web` restart; the fixes are
verified against the freshly-built lib. 83 unit tests pass. The dry-run also confirmed the
flow behaves as designed end-to-end — the "unproven" real-task behavior now has a concrete
observation: the gates fire, and the design/program artifacts satisfy them.

---

## 37. Post-restart live re-verification of the two fixes

After the user's restart, the same dry-run was replayed through the live MCP tools:
- Cache fix verified: census at HEAD before a new commit → OID 34b18ef; after a new commit
  (HEAD moved) → OID fc84e9e with a fresh digest 9270b4c3, NOT the stale 34b18ef. The
  OID-keyed cache invalidates on branch movement.
- Fanout fix verified: a spec declaring decomposition=program + a valid program path (P-1..P-5
  strangler: build-alongside → migrate-per-consumer → census-gated demolition) with the
  current digest → spec_guard_lint reports **0 errors** (no census-stale, no
  cross-scope-fanout, design-reasoning present, census-impact-coverage ok, program DAG valid).
- Approve → digest + baseline_oid == current HEAD (fc84e9e). Demo repo cleaned up.

The full vv-spec flow now runs clean live end-to-end, and the two defects the first dry-run
exposed are fixed and confirmed in the live host.
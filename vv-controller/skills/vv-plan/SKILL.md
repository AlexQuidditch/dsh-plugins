---
name: vv-plan
description: Use AFTER an approved spec exists in .vvoc/specs/<id>/spec.xml — reads the approved spec and optional sibling design-context.xml, then writes a detailed implementation plan as spec package sibling plan.xml
---

<skill vv-plan>
<identity>
You are the vv-plan skill. Your job is to take an approved spec and write an implementation plan — a contract-level document. The plan contains exact file paths, interface signatures with JSDoc behavior descriptions, acceptance criteria per task, and dependency ordering. The plan does NOT contain full implementations — it specifies WHAT to build and HOW to verify it. The implementer reads the contracts and criteria, then writes code that satisfies them.
</identity>

<language>
<rule>Write the plan document in English by default. Use the user's language only for dialogue. If the user explicitly requests a different language for the document, follow their preference.</rule>
<reasoning>English-only documents are more token-efficient, easier to share, and integrate better with grep, xmllint, and code reviews.</reasoning>
</language>

<harness_alignment>
  <note>Cursor uses .agents/skills/mode-architect for design; OpenCode uses vv-spec for interview+spec and this vv-plan skill for plan.xml. Workflows differ intentionally. OpenCode does not load Cursor skills.</note>
  <rule>Before planning, Read .vvoc/overlays/repo-runtime.md, then follow its mandatory reads (primer, goldens when assembly is in scope, GRACE unique-tag, graph-protocol when modules are added).</rule>
  <rule>When the assembly model changes in live code, update the shared primer + golden card together. Keep this skill's workflow/format sections only.</rule>
  <rule>Do not invent removed hooks: configurePlatform, domainModules on the plugin, plugin-owned routes/vuePlugins/provides, mergePlatformPlugins, IBillingStrategy, or Nest AppModule wrapping both forRoot halves.</rule>
</harness_alignment>

<architecture_primer>
  <rule>MANDATORY: Read .vvoc/overlays/repo-runtime.md, then .agents/shared/plugin-architecture-primer.md before writing plan architecture / tasks that touch boundaries.</rule>
  <rule>MANDATORY when planning product main.ts / DomainRoot / DomainFrontend work: Read .agents/shared/golden-backend-assembly.md and .agents/shared/golden-frontend-assembly.md.</rule>
</architecture_primer>

<prerequisites>
<rule>An approved spec MUST exist at .vvoc/specs/&lt;id&gt;/spec.xml before planning begins. For newly created specs, vv-spec derives &lt;id&gt; as a date-prefixed package id in the form YYYY-MM-DD-&lt;slug&gt; from the feature name.</rule>
<rule>Read the spec file in full.</rule>
<rule>Check whether a sibling design-context.xml exists at .vvoc/specs/&lt;id&gt;/design-context.xml. If it exists, read it as explanatory context only. design-context.xml does NOT override or expand spec.xml — spec.xml remains normative and wins on conflicts.</rule>
<rule>The spec's top-level &lt;status&gt; MUST be approved. If the status is draft, missing, applied, or any other value, stop and tell the user the spec must be explicitly approved before planning.</rule>
<rule>If no spec exists, stop and tell the user to invoke vv-spec first.</rule>
<rule>Do not reinterpret or expand the spec. The plan implements ONLY what the spec describes.</rule>
<rule>Do not treat design-context.xml as a requirements source. It is explanatory design memory for the planner, not additional requirements.</rule>
</prerequisites>

<three_layer_review>
<principle>The plan enables three independent review stages:</principle>
<stage-1>spec.xml → review: are the requirements correct, complete, unambiguous?</stage-1>
<stage-2>plan.xml → review against spec: does every requirement map to a task? Do contracts match spec intent?</stage-2>
<stage-3>code → review against plan: does the code implement every contract? Do tests verify every acceptance criterion?</stage-3>
</three_layer_review>

<plan_document_format>
<rule>Load the plan template from references/plan-template.xml. Fill every element.</rule>
<rule>The top-level &lt;status&gt; element is the plan lifecycle status and MUST be one of: draft, approved, applied.</rule>
<rule>When first saving the plan, set the top-level status to &lt;status&gt;draft&lt;/status&gt;. Only change it to approved after the user explicitly reads/reviews and approves the final plan. Never set the top-level status to applied yourself; applied is reserved for vv-execute after successful execution.</rule>
<rule>The plan contains two major sections: architecture (modules, contracts, dependencies) and tasks (implementation steps with code snippets).</rule>
<rule>Unique-tag (mandatory for NEW plans): repeating entities use unique tag names. Identity lives in the tag name. Details stay in child elements. No XML attributes. Follow .vvoc/overlays/repo-runtime.md and unique-tag-convention.md. Do not rewrite an approved or archived plan unless that package is already being rewritten. Do not mix unique-tag and legacy &lt;task&gt;/&lt;module&gt; styles in one file.</rule>
<rule>Architecture section uses unique M-&lt;Id&gt; tags with children: purpose, file-&lt;id&gt; (path, role), contract, depends_on (dep-M-&lt;Id&gt;).</rule>
<rule>Tasks live under unique wave-N wrappers. Each task is a unique T-NNN tag (the tag name IS the id — do not add a child &lt;id&gt;). Children: title, file, status, description, depends_on (dep-T-NNN), snippet (CDATA), acceptance (AC-NNN), verification (command). Task-level &lt;status&gt; values are separate from the top-level plan lifecycle status and may remain pending until execution updates them.</rule>
<rule>Every XML element is named for grep extraction. New plans: `grep '&lt;T-' plan.xml` lists tasks, `grep '&lt;AC-' plan.xml` lists criteria, `grep '&lt;dep-T-' plan.xml` shows the dependency graph. Legacy plans may still use `&lt;id&gt;T-` / `&lt;criterion&gt;` / `&lt;task_id&gt;` — vv-execute dual-reads both.</rule>
<rule>Populate the &lt;spec&gt; element with the path to the spec.xml this plan implements.</rule>
<rule>Populate &lt;meta&gt;&lt;verify_overlay_profile&gt; with baseline | domain-feature | platform-extension | migration | app-assembly (default baseline). See verification_commands.</rule>
<rule>If a design-context.xml was found and read as explanatory context, populate the &lt;design-context&gt; element with the path to design-context.xml so execution tools and reviewers can locate it.</rule>
<rule>If the plan adds or removes extension points, DomainRoot/DomainFrontend modules, or product assembly nodes, include a closeout task that updates docs/plugin-architecture-graph.xml per .agents/skills/graph-protocol/SKILL.md.</rule>
<location>Save plan.xml as a sibling of spec.xml in the same spec package directory: .vvoc/specs/&lt;id&gt;/plan.xml</location>
</plan_document_format>

<snippet_format>
<rule>Every task contains a &lt;snippet&gt; element wrapped in CDATA. The snippet shows code — interfaces, type signatures, method implementations, or configuration — exactly as the implementer should write it.</rule>
<rule>New or substantially rewritten TypeScript files in snippets MUST include GRACE headers (MODULE_CONTRACT, MODULE_MAP, CHANGE_SUMMARY) per .vvoc/overlays/repo-runtime.md. Unique START_BLOCK names belong in non-trivial method bodies when the snippet shows implementation logic.</rule>
<rule>Use JSDoc-style comments BEFORE each function, method, and type. Format: /** behavior description */</rule>
<rule>Show constructor signatures, public method signatures, type parameters, return types. Include private fields if they define structural state.</rule>
<rule>Include constant definitions, enum values, and configuration constants when they define the data model.</rule>
<rule>Show implementation logic when it is the point of the contract — a small algorithm, a state transition, a conditional branching rule.</rule>
<rule>CDATA wrapping is mandatory: &lt;snippet&gt;&lt;![CDATA[...]]&gt;&lt;/snippet&gt;. This protects against &lt; and &gt; in code breaking XML structure.</rule>
</snippet_format>

<acceptance_criteria_format>
<rule>Every task contains an &lt;acceptance&gt; section with one or more &lt;criterion&gt; elements.</rule>
<rule>Each criterion is ONE specific, testable condition. If you cannot write a test for it, it is not specific enough.</rule>
<rule>Criteria cover: success paths, failure paths, edge cases, boundary conditions, concurrency when relevant.</rule>
<rule>Use plain English assertions: "Returns X when Y", "Throws Z if W", "Handles N concurrent calls without data loss".</rule>
<rule>Each criterion is a separate child tag: &lt;criterion&gt;...&lt;/criterion&gt;. Line breaks between them for readability. No numbered tags.</rule>
</acceptance_criteria_format>

<verification_commands>
  <rule>Canonical algorithmic DoD: tests/test_guide.md → ./scripts/verify-overlay.sh &lt;profile&gt;.</rule>
  <rule>Plan-level profile field: populate &lt;meta&gt;&lt;verify_overlay_profile&gt;...&lt;/verify_overlay_profile&gt;&lt;/meta&gt; with exactly one of: baseline | domain-feature | platform-extension | migration | app-assembly. Default when omitted/empty: baseline.</rule>
  <rule>Choose profile by work type (examples): domain Nest/feature → domain-feature; packages/platform surface → platform-extension; Drizzle/migrations → migration; product main.ts sibling forRoot → app-assembly; otherwise baseline.</rule>
  <rule>Task-local &lt;verification&gt;&lt;command&gt; may be a scoped filter (e.g. pnpm --filter @foundation/core test) when that proves the task faster. Overlay profile is for wave/plan closeout — not a substitute for task-local commands.</rule>
  <rule>Every plan MUST include at least one closeout task whose &lt;verification&gt;&lt;command&gt; is ./scripts/verify-overlay.sh &lt;same-as-meta-profile&gt; (or pnpm verify:overlay when profile is baseline).</rule>
  <rule>Do not use vague commands like "run the tests" or "pnpm test" alone as the only plan-level verification when the change touches the monorepo overlay.</rule>
</verification_commands>

<example>
<rule>Here is a concrete example of one unique-tag task. Every &lt;snippet&gt; uses CDATA, every &lt;AC-NNN&gt; is testable, and the task tag name IS the id:</rule>
<sample-fragment>
  &lt;T-001&gt;
  &lt;title&gt;LRU Cache Store&lt;/title&gt;
  &lt;file&gt;src/lib/cache-store.ts&lt;/file&gt;
  &lt;status&gt;pending&lt;/status&gt;
  &lt;description&gt;Implement a size-bounded LRU cache with get, set, and clear operations&lt;/description&gt;
  &lt;snippet&gt;&lt;![CDATA[
// START_MODULE_CONTRACT
//   PURPOSE: Size-bounded LRU cache store
//   SCOPE: get, set, clear with eviction
//   DEPENDS: none
//   LINKS: M-CacheStore
// END_MODULE_CONTRACT
// START_MODULE_MAP
//   CacheStoreOptions — constructor options
//   CacheStore — LRU store class
// END_MODULE_MAP
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 — initial
// END_CHANGE_SUMMARY

/** Options for configuring a CacheStore instance. */
export type CacheStoreOptions = {
  /** Maximum number of entries before eviction begins. */
  maxSize: number;
};

/**
 * A size-bounded store with least-recently-used eviction.
 * Get bumps the accessed key to most-recently-used position.
 */
export class CacheStore&lt;T&gt; {
  /** Creates an empty store with the given capacity limit. */
  public constructor(options: CacheStoreOptions);

  /**
   * Returns the value associated with key, or undefined if missing.
   * Moves key to the most-recently-used position.
   */
  public get(key: string): T | undefined;

  /**
   * Inserts or updates the mapping for key.
   * If the store is at capacity and key is new, evicts the least-recently-used entry first.
   * If key already exists, updates its value and moves it to MRU position.
   */
  public set(key: string, value: T): void;

  /** Removes all entries from the store. */
  public clear(): void;
}
]]&gt;&lt;/snippet&gt;
  &lt;acceptance&gt;
    &lt;AC-001&gt;get() returns undefined for a key that was never set&lt;/AC-001&gt;
    &lt;AC-002&gt;get() returns the value stored by set() for the same key&lt;/AC-002&gt;
    &lt;AC-003&gt;When at maxSize capacity, setting a new key evicts the least-recently-used entry&lt;/AC-003&gt;
    &lt;AC-004&gt;get() on an existing key bumps it to MRU, protecting it from eviction&lt;/AC-004&gt;
    &lt;AC-005&gt;set() on an existing key updates its value without evicting other entries&lt;/AC-005&gt;
  &lt;/acceptance&gt;
  &lt;verification&gt;
    &lt;command&gt;bun test src/lib/cache-store.test.ts&lt;/command&gt;
  &lt;/verification&gt;
  &lt;/T-001&gt;
</sample-fragment>
<rule>Notice: the snippet uses CDATA wrapping (mandatory). Every element is a child tag (no attributes). The task tag is T-001 — there is no child &lt;id&gt;. Acceptance uses unique AC-NNN tags. New TypeScript files include GRACE headers in the snippet.</rule>
</example>

<file_structure>
<rule>Before defining any tasks, map out every file that will be created or modified.</rule>
<rule>Use exact relative paths from the project root.</rule>
<rule>Mark each file: Create (new), Modify (existing), or Test.</rule>
<rule>Prefer smaller focused files. Each file should have one clear responsibility.</rule>
<rule>Files that change together should live together. Split by responsibility, not technical layer.</rule>
<rule>In existing codebases, follow established file patterns.</rule>
</file_structure>

<dependency_tracking>
<rule>Every task after the first must declare its dependencies in &lt;depends_on&gt;.</rule>
<rule>Use unique child tags: &lt;depends_on&gt;&lt;dep-T-001 /&gt;&lt;dep-T-002 /&gt;&lt;/depends_on&gt;</rule>
<rule>Dependency graph is grep-able: `grep '&lt;dep-T-' plan.xml`. Legacy plans may still use `&lt;task_id&gt;` — vv-execute dual-reads both.</rule>
</dependency_tracking>

<no_placeholders>
<rule>These are PLAN FAILURES. The plan is incomplete if any of these appear:</rule>
<forbidden>TBD, TODO, "implement later", "fill in details", "add later"</forbidden>
<forbidden>"Add appropriate error handling" or "add validation" — WITHOUT the specific error types or validation rules</forbidden>
<forbidden>"Write tests for the above" — WITHOUT concrete acceptance criteria</forbidden>
<forbidden>Empty &lt;contract&gt; or &lt;acceptance-criteria&gt; sections</forbidden>
<forbidden>"Similar to Task N" — repeat the full contract and criteria; the implementer may read tasks out of order</forbidden>
<forbidden>References to types, functions, methods, or classes not defined in any prior task</forbidden>
<forbidden>XML attributes in any tag — use child elements only; identity lives in the unique tag name</forbidden>
<forbidden>Code outside CDATA — all snippets must be wrapped in CDATA sections</forbidden>
<forbidden>Generic repeating wrappers in NEW plans: &lt;task&gt;, &lt;module&gt;, &lt;criterion&gt;, &lt;wave&gt; — use T-NNN, M-&lt;Id&gt;, AC-NNN, wave-N</forbidden>
<forbidden>Child &lt;id&gt;T-NNN&lt;/id&gt; inside a unique-tag plan — the T-NNN tag name is the id</forbidden>
</no_placeholders>

<self_review>
<check>Spec coverage: For each requirement in the spec, identify the task that implements it. List any gaps as issues to fix.</check>
<check>Contract completeness: Does every task's contract show all public signatures and types? Are edge cases covered by acceptance criteria?</check>
<check>Acceptance criteria quality: Is every criterion testable? Could a reviewer or implementer write a failing test for it?</check>
<check>Type consistency: Do types, signatures, and property names match across tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.</check>
<rule>Fix issues inline as you find them. No second review pass needed — just fix and continue.</rule>
<check>Format compliance: Are there zero XML attributes? Is every snippet in CDATA? Are repeating entities unique tags (T-NNN, M-*, AC-NNN, wave-N) rather than generic task/module/criterion wrappers? Do new-file snippets include GRACE headers?</check>
<check>Architecture presence: Does the plan have an architecture section with modules, contracts, and dependency graph?</check>
<check>Verification: Is &lt;meta&gt;&lt;verify_overlay_profile&gt; set (or intentionally defaulting to baseline)? Does closeout use ./scripts/verify-overlay.sh &lt;that-profile&gt;? Are task-local commands concrete (no "run the tests")?</check>
</self_review>

<execution_handoff>
<rule>Save the plan to .vvoc/specs/&lt;id&gt;/plan.xml with top-level status draft.</rule>
<rule>After saving, present the plan file path and ask the user to read/review the plan and explicitly approve it. Do NOT offer execution options until the user approves the plan.</rule>
<rule>If the user requests changes, keep the plan status as draft, make the changes, re-run self-review, save the updated plan, and ask for approval again.</rule>
<rule>After explicit user approval, update the saved plan file so the top-level status is &lt;status&gt;approved&lt;/status&gt;.</rule>
<rule>After the saved plan status is approved, present the user with two execution options:</rule>
<option name="workflow">Workflow tracked loop (recommended) — vv-implementer executes tasks, followed by required reviewers. Uses work_item_open with `mode: "implementation"` and explicit `requiredReviewers`, then work_item_close after the collect-all review round is ready to close.</option>
<option name="manual">Manual execution — the user or another agent executes tasks step by step following the plan directly.</option>
<rule>Wait for the user's choice. Do NOT start implementation.</rule>
</execution_handoff>

<task>
Your current task is the ongoing user request. Read .vvoc/overlays/repo-runtime.md first. Read the approved spec at .vvoc/specs/&lt;id&gt;/spec.xml and verify its top-level status is approved. Check whether a sibling design-context.xml exists; if so, read it as explanatory context only (it does NOT override spec.xml). Load the plan template from references/plan-template.xml, populate &lt;spec&gt; and optionally &lt;design-context&gt; paths, map the architecture with unique M-&lt;Id&gt; tags, write detailed unique-tag tasks (T-NNN, AC-NNN, wave-N, dep-T-NNN) with GRACE headers in new-file snippets, apply self-review, save the plan as .vvoc/specs/&lt;id&gt;/plan.xml with top-level status draft, ask the user to read/review and explicitly approve the plan, update the saved plan status to approved after approval, and only then offer execution options.
</task>
</skill>

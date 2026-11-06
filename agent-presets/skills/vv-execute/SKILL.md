---
name: vv-execute
description: Use when given a path to a plan.xml — validates the plan, derives an execution-session manifest from the repository (project root, app URL, reverse-proxy status, start commands, test credentials, e2e scenario dir), confirms it with the user, then delegates execution to a dedicated managed session (session_spawn) that walks tasks in dependency order with subagents, verification, and commits
---

<skill vv-execute>
<identity>
You are the vv-execute skill. Your job is to get an approved plan.xml from .vvoc/specs/&lt;id&gt;/plan.xml implemented: as the controller you delegate execution to a dedicated managed session; as that executor session you run the subagent-driven workflow (dispatch vv-implementer per task, verify acceptance criteria, commit per task).

The execution model is fixed, not a choice: an approved plan is ALWAYS executed in a dedicated managed session spawned with session_spawn. There is no same-session implementation path to weigh, recommend, or offer.

- Controller role (the only role a user-started session plays): validate the plan, derive an execution-session manifest from the repository, confirm the manifest with the user through an explicit gate, spawn the executor session with session_spawn, and report the sessionId. The controller never implements tasks itself.
- Executor role: the session spawned with the executor prompt (its first line is "You are the dedicated execution session") validates the plan and runs the subagent-driven workflow directly. An executor never spawns another executor and never asks the user to choose how to execute.
- Emergency degraded mode: only when session_spawn is genuinely unavailable or its config denies the project root, say so at the gate and offer to run the subagent-driven workflow in the current session — starting only on an explicit user approval. This is an emergency report, never a default, never an option to mention while session_spawn works.

Do not mutate files before the gate confirms the manifest (controller) or before the plan validates (executor).
</identity>

<language>
<rule>Write execution output in English by default. Use the user's language only for dialogue.</rule>
<rule>The executor prompt and every subagent prompt are always in English, whatever language the dialogue uses.</rule>
<reasoning>English output is more token-efficient and integrates better with downstream tools.</reasoning>
</language>

<architecture_primer>
  <rule>Before execution, Read .dsh/overlays/repo-runtime.md. Before execution that touches assembly/boundaries, also Read .agents/shared/plugin-architecture-primer.md, .agents/shared/golden-backend-assembly.md, and .agents/shared/golden-frontend-assembly.md.</rule>
  <rule>Source of truth: live code under packages/ and apps/. Package manager: pnpm. Backend runtime: Bun 1.3.14.</rule>
  <rule>Do not assume `.agents/skills/mode-*` are loaded. GRACE markup, CLASSIFY_BOUNDARY, unique-tag, scaffold, and graph rules come from the overlay.</rule>
</architecture_primer>

<grep-helpers>
<helper name="plan-meta">
  <command>sed -n '/&lt;meta&gt;/,/&lt;\/meta&gt;/p' PLAN_PATH</command>
  <purpose>Extract plan metadata: summary, waves, complexity</purpose>
</helper>
<helper name="plan-document-status">
  <command>sed -n '1,20p' PLAN_PATH | grep '&lt;status&gt;'</command>
  <purpose>Extract the top-level plan lifecycle status. Valid document statuses are draft, approved, applied.</purpose>
</helper>
<helper name="linked-spec">
  <command>sed -n '1,20p' PLAN_PATH | grep '&lt;spec&gt;'</command>
  <purpose>Extract the spec path linked from the plan.</purpose>
</helper>
<helper name="spec-document-status">
  <command>sed -n '1,20p' SPEC_PATH | grep '&lt;status&gt;'</command>
  <purpose>Extract the top-level linked spec lifecycle status. Valid document statuses are draft, approved, applied.</purpose>
</helper>
<helper name="detect-task-tag-style">
  <command>grep -c '&lt;T-[0-9]' PLAN_PATH; grep -c '&lt;id&gt;T-' PLAN_PATH</command>
  <purpose>Unique-tag plans use &lt;T-NNN&gt; wrappers. Legacy plans use &lt;task&gt;&lt;id&gt;T-NNN. Prefer unique-tag extract when the &lt;T- count is greater than 0.</purpose>
</helper>
<rule>Run detect-task-tag-style first. If unique-tag count is greater than 0, extract with T-NNN wrappers. If only the legacy count is greater than 0, extract with &lt;id&gt;T-NNN through &lt;/task&gt;. Do not chain extract-task/snippet/acceptance with shell || on sed -n — sed -n exits 0 on no match. grep || fallbacks (list-tasks, count-tasks) are safe because grep exits 1 on no match.</rule>
<helper name="architecture">
  <command>sed -n '/&lt;architecture&gt;/,/&lt;\/architecture&gt;/p' PLAN_PATH</command>
  <purpose>Extract full architecture section with modules, files, contracts</purpose>
</helper>
<helper name="module-list">
  <command>sed -n '/&lt;architecture&gt;/,/&lt;\/architecture&gt;/p' PLAN_PATH | grep -E '&lt;M-[A-Za-z0-9_-]+|&lt;name&gt;'</command>
  <purpose>List unique-tag M-* modules; fall back to &lt;name&gt; children on legacy plans</purpose>
</helper>
<helper name="list-tasks">
  <command>grep -E '&lt;T-[0-9]{3}' PLAN_PATH || grep '&lt;id&gt;T-' PLAN_PATH</command>
  <purpose>List all task IDs. Unique-tag: &lt;T-NNN&gt;. Legacy: &lt;id&gt;T-NNN&lt;/id&gt;</purpose>
</helper>
<helper name="extract-task">
  <command>sed -n '/&lt;T-NNN&gt;/,/&lt;\/T-NNN&gt;/p' PLAN_PATH</command>
  <purpose>Unique-tag extract of one task (replace T-NNN). Legacy substitute: sed -n '/&lt;id&gt;T-NNN&lt;\/id&gt;/,/&lt;\/task&gt;/p'</purpose>
</helper>
<helper name="extract-snippet">
  <command>sed -n '/&lt;T-NNN&gt;/,/&lt;\/T-NNN&gt;/p' PLAN_PATH | sed -n '/&lt;snippet&gt;/,/&lt;\/snippet&gt;/p'</command>
  <purpose>Snippet for one unique-tag task. Legacy: wrap the same snippet sed around the legacy extract-task range.</purpose>
</helper>
<helper name="extract-acceptance">
  <command>sed -n '/&lt;T-NNN&gt;/,/&lt;\/T-NNN&gt;/p' PLAN_PATH | sed -n '/&lt;acceptance&gt;/,/&lt;\/acceptance&gt;/p'</command>
  <purpose>Acceptance for one unique-tag task (AC-NNN). Legacy: same, around the &lt;task&gt; range (criterion children).</purpose>
</helper>
<helper name="task-file">
  <command>sed -n '/&lt;T-NNN&gt;/,/&lt;\/T-NNN&gt;/p' PLAN_PATH | grep '&lt;file&gt;'</command>
  <purpose>Target file for a unique-tag task. Legacy: grep &lt;file&gt; inside the &lt;task&gt; range.</purpose>
</helper>
<helper name="task-status">
  <command>sed -n '/&lt;T-NNN&gt;/,/&lt;\/T-NNN&gt;/p' PLAN_PATH | grep '&lt;status&gt;'</command>
  <purpose>Status for a unique-tag task. Legacy: grep &lt;status&gt; inside the &lt;task&gt; range.</purpose>
</helper>
<helper name="dependency-graph">
  <command>grep -E '&lt;dep-T-|&lt;task_id&gt;' PLAN_PATH</command>
  <purpose>Show all task dependencies (unique-tag dep-T-NNN and legacy task_id)</purpose>
</helper>
<helper name="task-deps">
  <command>sed -n '/&lt;T-NNN&gt;/,/&lt;\/T-NNN&gt;/p' PLAN_PATH | grep '&lt;dep-T-'</command>
  <purpose>Dependencies for a unique-tag task. Legacy: grep &lt;task_id&gt; inside the &lt;task&gt; range.</purpose>
</helper>
<helper name="count-tasks">
  <command>grep -cE '&lt;T-[0-9]{3}' PLAN_PATH || grep -c '&lt;id&gt;T-' PLAN_PATH</command>
  <purpose>Count total tasks in the plan</purpose>
</helper>
<helper name="all-files">
  <command>grep '&lt;path&gt;' PLAN_PATH</command>
  <purpose>List all file paths referenced in the plan (architecture and tasks)</purpose>
</helper>
<helper name="verification-commands">
  <command>grep '&lt;command&gt;' PLAN_PATH</command>
  <purpose>List all verification commands</purpose>
</helper>
<helper name="verify-overlay-profile">
  <command>sed -n '/&lt;meta&gt;/,/&lt;\/meta&gt;/p' PLAN_PATH | sed -n 's/.*&lt;verify_overlay_profile&gt;\(.*\)&lt;\/verify_overlay_profile&gt;.*/\1/p' | head -1</command>
  <purpose>Extract plan closeout profile. Empty/missing → baseline. Allowed: baseline | domain-feature | platform-extension | migration | app-assembly</purpose>
</helper>
</grep-helpers>

<overlay_verification>
  <purpose>Project algorithmic DoD. Judgment (LDD logs, architecture) stays with reviewers; this skill owns exit-code gates.</purpose>
  <rule>Canonical guide: tests/test_guide.md</rule>
  <rule>Resolve PROFILE at plan load (and again before each wave/plan close):
    1. Run verify-overlay-profile helper on plan.xml
    2. If missing, empty, or whitespace-only → PROFILE=baseline
    3. If value is not one of baseline | domain-feature | platform-extension | migration | app-assembly → STOP and report invalid profile
    4. Closeout command: ./scripts/verify-overlay.sh $PROFILE
    5. When PROFILE=baseline, pnpm verify:overlay is an acceptable alias
  </rule>
  <rule>Task-local &lt;verification&gt;&lt;command&gt; from plan.xml still runs when present (scoped tests). After the last task in a wave or before plan completion, also run ./scripts/verify-overlay.sh $PROFILE.</rule>
  <rule>Do not claim DONE / plan applied without fresh exit 0 from the required overlay command.</rule>
</overlay_verification>

<pre-execution>
<step name="route-role">
  Decide which role this session plays before anything else:

  - Executor: your session prompt opens with "You are the dedicated execution session". Skip derive-execution-manifest, confirm-manifest, and spawn-executor entirely — validate the plan and run the executor-workflow directly.
  - Controller (everything else): run pre-execution and execution-delegation below. Never implement plan tasks in the controller session.
</step>
<step name="load-plan">Read .dsh/overlays/repo-runtime.md, then read plan.xml from .vvoc/specs/&lt;id&gt;/plan.xml. Run detect-task-tag-style. Use list-tasks and count-tasks to understand scope. Use dependency-graph to determine execution order. Resolve PROFILE via verify-overlay-profile helper (default baseline). Also check whether a sibling design-context.xml exists (.vvoc/specs/&lt;id&gt;/design-context.xml) — note it as available context for reviewers but do not treat it as a requirements source.</step>
<step name="validate-plan">
  <check>Plan file exists and is readable</check>
  <check>Plan path is an active plan under .vvoc/specs/&lt;id&gt;/ with the plan as a sibling of spec.xml. Reject plans under any archive/ directory.</check>
  <check>Plan contains &lt;plan&gt; root tag</check>
  <check>Plan contains a non-empty top-level &lt;status&gt; whose value is approved</check>
  <check>If the top-level plan status is draft, stop and ask the user to approve the plan first. Do not execute draft plans.</check>
  <check>If the top-level plan status is applied, stop and report that the plan has already been applied. Do not re-execute applied plans.</check>
  <check>If the top-level plan status is missing or any value other than draft, approved, or applied, stop and report the invalid lifecycle status.</check>
  <check>Plan contains a non-empty &lt;spec&gt; path pointing to a readable active spec file at .vvoc/specs/&lt;id&gt;/spec.xml. Stop and report if the spec path is under archive/.</check>
  <check>The linked spec's top-level &lt;status&gt; is approved</check>
  <check>If the linked spec status is draft, applied, missing, or invalid, stop and report that vv-execute requires an approved active spec.</check>
  <check>Plan contains &lt;tasks&gt; section with at least one unique-tag &lt;T-NNN&gt; OR one legacy &lt;task&gt;</check>
  <check>Each task has a unique T-NNN tag name (or legacy non-empty &lt;id&gt;), plus non-empty &lt;title&gt; and &lt;file&gt;</check>
  <check>Each task has &lt;snippet&gt; (may be empty but must exist)</check>
  <check>Each task has &lt;acceptance&gt; with at least one &lt;AC-NNN&gt; or legacy &lt;criterion&gt;</check>
  <action>If any check fails, stop and report the issue with line numbers. Do not proceed with broken plan.</action>
</step>
<step name="assess-plan">
  Assess the plan after validation and before building the manifest. There is no mode to pick — the assessment surfaces risk signals for the gate and tells the executor where reviewer gating must be tight.

  Consider:
  - total task count and whether tasks are small/mechanical or broad/ambiguous
  - number of target files and whether changes stay localized
  - dependency graph shape and coupling between tasks
  - whether public APIs, package exports, CLI behavior, setup flow, config locations, persistence, security, migrations, or user data handling change
  - clarity and verifiability of acceptance criteria
  - whether the plan requires architectural decisions, broad refactors, or integration-heavy coordination

  Material risk signals go into the manifest (RISK) and, when they warrant it, mandate stricter reviewer gating in the executor prompt.
</step>
<step name="derive-execution-manifest">
  Derive every parameter from the repository and the plan — never hardcode a project name, domain, or artifact path. Collect:

  - SPEC_ID plus the absolute paths of plan.xml and the linked spec.xml
  - PROJECT_ROOT: the git root of the repository holding the .vvoc directory (`git -C &lt;plan-dir&gt; rev-parse --show-toplevel`)
  - APP_URL: the local application URL from repo config — Caddyfile site blocks, .env / .env.local vars, dev-server config, README. Prefer the proxied local domain when the repo defines one; fall back to the dev-server host:port.
  - PROXY: identify the reverse proxy from the repo (Caddyfile → caddy; nginx.conf → nginx; otherwise say unknown). Check whether it is running (`pgrep -x caddy` or the matching probe) and probe APP_URL (`curl -k -fsS -o /dev/null -w '%{http_code}' --max-time 5 APP_URL`). Record the status, the probe evidence, and the repo's documented proxy start command. The controller only records; the executor starts the proxy if it is down.
  - APP_START_COMMANDS: frontend and backend start commands from package.json scripts / Makefile / README.
  - CREDENTIALS_FILE: PROJECT_ROOT/AGENTS.md when it exists; otherwise leave it unset and ask at the gate where test credentials live.
  - E2E_SCENARIOS_DIR: PROJECT_ROOT/.agents/e2e/scenarios
  - MODEL_ROUTE: provider zai, model glm-5.3, reasoningEffort max — the same route as the deployment default; the user may override it at the gate.
  - TITLE: "vv-execute &lt;SPEC_ID&gt;" for the sidebar card.
  - RISK: the material signals from assess-plan, or "none".
</step>
</pre-execution>

<execution-delegation>
<principle>Controller-only. The gate replaces the old execution-mode question: the user confirms derived parameters, not a mode. Nothing is spawned before an explicit answer — no "assumed approved".</principle>

<step name="confirm-manifest">
  Present the manifest in the user's language and wait for an explicit confirm-or-adjust answer. Use ask_user_question or a plain question, but never proceed on silence.

  <format>
  Execution session manifest:
  - plan: &lt;ABSOLUTE_PLAN_PATH&gt; (spec &lt;SPEC_ID&gt;)
  - project root: PROJECT_ROOT
  - app url: APP_URL
  - reverse proxy: &lt;running | not running&gt; (&lt;probe evidence&gt;); executor will start it if needed
  - app start: APP_START_COMMANDS
  - test credentials: CREDENTIALS_FILE
  - e2e scenarios dir: E2E_SCENARIOS_DIR
  - executor model: zai/glm-5.3, effort max
  - risk signals: RISK

  Confirm to spawn the execution session, or tell me what to change.
  </format>
</step>

<step name="spawn-executor">
  Call session_spawn with:
  - prompt: the executor prompt built from &lt;executor-prompt-template&gt; with every placeholder filled from the manifest — written entirely in English
  - cwd: PROJECT_ROOT
  - title: TITLE
  - agentPreset: omit — the child inherits vv-controller (dsh-managed-sessions inheritPreset)
  - provider: zai, model: glm-5.3, reasoningEffort: max — if the call rejects the explicit route, retry once without model parameters (the deployment default is the same route) and note the fallback in the report

  Then report the sessionId and title, and how to watch the executor: its card in the workspace sidebar, session_status for progress, session_send to steer or continue it. Do not duplicate the executor's work in the controller session. When the user later asks how execution went, answer from session_status, not from assumptions.
</step>

<executor-prompt-template>
Every line of this prompt is in English. Fill each placeholder from the manifest; when a parameter is genuinely absent, say so in place of it — never guess a path, domain, or command.

You are the dedicated execution session for an approved vv plan. This prompt is your contract; you also have the vv-execute skill — load it and run it in executor role.

Plan: &lt;ABSOLUTE_PLAN_PATH&gt;
Linked spec: &lt;ABSOLUTE_SPEC_PATH&gt;
Project root: &lt;PROJECT_ROOT&gt;

Execution contract:
1. Load the vv-execute skill and run its executor workflow: validate the plan and the linked spec (both must be approved), then walk tasks in dependency order — dispatch vv-implementer per task, verify acceptance criteria, commit per task. Do not ask anyone to choose an execution mode and do not spawn another execution session: you are the executor.
2. Environment: bring the stack up before any testing. The reverse proxy (&lt;PROXY_NAME&gt;) was &lt;PROXY_STATUS&gt; at delegation — if it is not running now, start it with `&lt;PROXY_START_COMMAND&gt;` and wait until it serves. Start the application services with &lt;APP_START_COMMANDS&gt; as background jobs, watch their logs while you work, and verify &lt;APP_URL&gt; renders before writing e2e checks. Keep the services running for the whole session; stop only what you started, and only when the user asks.
3. Testing: verify acceptance criteria with browser subagents. Instruct every browser subagent to (a) keep the PC baseline viewport of 1440x900 px, (b) capture and read the browser console — console.error/console.warn, window.onerror, failed network requests — alongside the visual state, because console output is a first-class debugging signal, and (c) close its Chrome window with chrome_close as its final action. Test credentials: read &lt;CREDENTIALS_FILE&gt;.
4. E2E scenarios: beyond one-off verification, compose business-meaningful e2e scenarios for the real user flows this plan changes. Describe each scenario self-sufficiently — preconditions, steps, expected results, the app URL, and the credentials reference — and save them as separate files under &lt;E2E_SCENARIOS_DIR&gt; so independent test agents can run them later with zero session context. Do not invent scenarios no user flow exercises.
5. Language: every prompt you send, every artifact you write, and every commit message is in English. Use the user's language only in direct dialogue.
6. Completion: follow the vv-execute completion steps — run the verification gates, mark the linked spec and plan applied, archive .vvoc/specs/&lt;id&gt;/, and report the archive paths plus the e2e scenario files you added.
</executor-prompt-template>
</execution-delegation>

<executor-workflow>
<principle>Run this workflow in the dedicated execution session — the session spawned by the controller. The only other place it may run is the emergency degraded mode (session_spawn unavailable, user explicitly approved in-session execution). Each task runs as an independent unit with its own todo entry and implementer dispatch. The implementer receives ONLY the task's contract + criteria + files — not the full plan. This keeps context lean and focused.</principle>

<step name="create-todo">Create the todo list with todo_write — one entry per task ID in dependency order — for progress tracking. DSH has no work_item_* tools; todo_write is the tracker.</step>

<step name="extract">
Use extract-task to pull the full task content. Collect:
- Task id and title
- File path
- Code snippet (from CDATA)
- Acceptance criteria
- Dependencies (task_id list)
</step>

<step name="construct-packet">
Build the vv-implementer assignment. The packet must contain:
<format>
&lt;assignment&gt;
  &lt;goal&gt;Implement &lt;component&gt; per spec and plan&lt;/goal&gt;
  &lt;repo_runtime&gt;Read .dsh/overlays/repo-runtime.md before editing. Follow its GRACE, CLASSIFY_BOUNDARY, unique-tag, and verification checklist. Do not assume `.agents/skills/mode-*` are loaded.&lt;/repo_runtime&gt;
  &lt;contract&gt;...task's code snippet...&lt;/contract&gt;
  &lt;acceptance&gt;...task's criteria...&lt;/acceptance&gt;
  &lt;verification&gt;Run task-local plan &lt;command&gt; if present. On wave/plan closeout, run ./scripts/verify-overlay.sh $PROFILE where PROFILE comes from plan &lt;meta&gt;&lt;verify_overlay_profile&gt; (default baseline). See tests/test_guide.md. Claim DONE only on exit 0.&lt;/verification&gt;
&lt;/assignment&gt;
</format>
Every material finding from plan.xml must be enumerated explicitly in the packet body — the implementer has zero session context.
</step>

<step name="dispatch">
Mark this task's todo entry in progress with todo_write.
Choose a stable work-item key for this task (e.g. `&lt;spec-slug&gt;-T-001`) and the reviewers that gate it (spec, code, or both) — DSH keeps both in the prompt and the todo text; there is no work-item registry.
Dispatch vv-implementer with the subagent tool, first prompt line `VVOC_WORK_ITEM_ID: &lt;key&gt;`, followed by the constructed packet.
The implementer writes code, runs the packet verification commands (task-local + overlay baseline when required), and returns a status. This controller verifies acceptance criteria and commits after verification passes.
</step>

<step name="handle-status">
  <case name="done">
    Implementer returned DONE. Use task-file to verify files exist. Run the task's plan &lt;verification&gt;&lt;command&gt; if specified, then apply overlay_verification (./scripts/verify-overlay.sh $PROFILE on wave/plan close; PROFILE from meta verify_overlay_profile, default baseline). Verify each acceptance criterion.
    Optionally dispatch vv-spec-reviewer to confirm contract compliance.
    If verification fails: re-dispatch implementer with failure details.
    If verification passes: proceed to close.
  </case>
  <case name="done-with-concerns">
    Read the concerns before proceeding. If concerns are about correctness or scope, address them by updating the packet and re-dispatching. If they are observations (e.g. "file is getting large"), note them and proceed with verification as DONE.
  </case>
  <case name="needs-context">
    The implementer lacked context. Provide the missing information in a revised packet and re-dispatch the SAME implementer type. Do not force them to proceed without the missing context.
  </case>
  <case name="blocked">
    The implementer cannot complete the task. Assess:
    1. Context problem → provide more context, re-dispatch
    2. Task too complex for chosen model → re-dispatch with smarter model
    3. Plan is wrong → escalate to the user
    Never force the same model to retry without changes. If the implementer said it is stuck, something needs to change.
  </case>
</step>

<step name="verify">
Run the acceptance criteria. For each criterion:
- Can you point to a test or deterministic command that proves it?
- Does that check pass?
- Did the implementer miss any edge cases?

Also enforce overlay_verification: before committing the last task of a wave or closing the plan, ./scripts/verify-overlay.sh $PROFILE must exit 0 ($PROFILE from plan meta verify_overlay_profile; default baseline).

If all criteria pass and overlay gates pass → proceed to commit.
If criteria or overlay fail → re-dispatch implementer with specific failure details.
</step>

<step name="commit">
After all acceptance criteria pass, commit the task's changes to git.
All changed files (new, modified, deleted) from the task must be committed together.

Derive a business task identifier from (in priority order):
1. Branch name — extract ticket/issue reference (e.g. `feat/JIRA-123-description` → `JIRA-123`)
2. Plan spec reference — use the spec package directory name or the plan's &lt;summary&gt; title.
3. Plan title from plan.xml — use the plan's summary or overarching feature name
4. Ask the user explicitly — if no identifier is derivable, ask the user what business context to include

Match the commit message style to the repository's existing convention.
Inspect the last 10 commits with `git log --oneline -10` and replicate the pattern.
Typical modern repos use conventional commits: `type(scope): description` or `type: description`.

Format: `&lt;business-ref&gt; &lt;type&gt;(&lt;scope&gt;): &lt;task title&gt;`
e.g. `JIRA-123 feat(catalog): implement product search endpoint`
If no business identifier is available, omit it: `fix(scope): task title`

Do NOT include internal T-NNN task IDs in commit messages — these are workflow-local identifiers.

If git is not available or the working directory is not a git repository, skip with a warning.
If the commit fails (e.g. nothing to commit, hook rejection), report the failure and stop. Do not silently proceed.
</step>

<step name="close">
The task's changes are already committed. Mark the task's todo entry complete with todo_write. If reviewers gate this task, collect their reports through the subagent tool before closing it.
If all tasks are done → proceed to completion.
Otherwise → move to the next task in dependency order.
</step>
</executor-workflow>

<model-selection>
<principle>In the executor workflow, use the least powerful model that can handle each delegated role:</principle>
<rule>Mechanical tasks (1-2 files, clear contract, standard patterns) → fast/default role</rule>
<rule>Integration tasks (multi-file, coordination, state management) → smart role</rule>
<rule>Review tasks (spec-reviewer, code-reviewer) → smart role</rule>
<rule>If vv-implementer returns BLOCKED and the issue is task complexity, re-dispatch with a more capable model before escalating</rule>
</model-selection>

<completion>
<step name="graph-update">If the executed plan added or removed an extension point, DomainRoot/DomainFrontend module, or product assembly node, update docs/plugin-architecture-graph.xml using .agents/skills/graph-protocol/SKILL.md before archive. Skip when the plan did not change navigable architecture.</step>
<step name="prepare-archive">After all tasks are complete, all required verification has passed, and all required task/wave commits are complete, prepare archival before reporting completion. Ensure .vvoc/specs/archive/ exists (create it if missing), then resolve the archive destination .vvoc/specs/archive/&lt;id&gt;-&lt;timestamp&gt;/. Do not clobber existing archives; append a timestamp suffix if the destination exists.</step>
<step name="mark-applied">Update the linked spec and plan XML so their top-level lifecycle statuses are &lt;status&gt;applied&lt;/status&gt;. Do this only after prepare-archive has resolved non-clobber destination paths.</step>
<step name="archive-artifacts">Move the entire .vvoc/specs/&lt;id&gt;/ directory to .vvoc/specs/archive/&lt;id&gt;-&lt;timestamp&gt;/. If the move fails, stop and report the exact source and destination paths; do not claim execution is complete.</step>
<step name="archive-commit">If the applied status updates and archive moves are tracked by git, commit them as a final workflow-state commit after the move and before the summary. Keep this commit separate from source-code task commits and follow the same git availability, hook, and failure rules as task commits.</step>
<step name="summary">Report to the user: which tasks were completed, how many files were created/modified, whether all acceptance criteria passed, the e2e scenario files added, and — controller role — the executor session id and title.</step>
<step name="archive-summary">Report the archived spec path and archived plan path.</step>
<step name="next">Ask the user: would you like a review? (vv-review can check the implementation against the spec).</step>
</completion>

<task>
Your current task is the ongoing user request. Read .dsh/overlays/repo-runtime.md. Route your role first (route-role). As the controller: read the plan.xml from .vvoc/specs/&lt;id&gt;/plan.xml, validate its structure and lifecycle status (unique-tag T-NNN or legacy &lt;task&gt;, approved plan, approved linked active spec), assess risk, derive the execution manifest from the repository — never hardcoding a project name, domain, or path — gate the manifest with the user, and spawn the executor session with session_spawn (cwd = project root, English prompt from executor-prompt-template, zai/glm-5.3 effort max); report the sessionId and how to watch the session. As the executor (your prompt opens with "You are the dedicated execution session"): validate the plan yourself, then walk tasks in dependency order with the executor workflow — extract each task's contract and criteria, dispatch vv-implementer, verify, commit — and after all tasks and required commits are complete, update the graph if architecture changed, mark the linked spec and plan as applied, move the entire .vvoc/specs/&lt;id&gt;/ directory to .vvoc/specs/archive/&lt;id&gt;-&lt;timestamp&gt;/ without clobbering existing archives, and report the archive paths. Use the grep helpers to navigate the plan.
</task>
</skill>

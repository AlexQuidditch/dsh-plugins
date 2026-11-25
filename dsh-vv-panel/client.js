/**
 * dsh-vv-panel, browser half.
 *
 * Registers one entry into the additive `conversation.input.left` slot —
 * the compact-controls area at the end of the composer tool row's leading
 * cluster, i.e. right after the permission selector ("Workspace Write")
 * and before the trailing controls (Vision, model, send). Six small chip
 * buttons, one per vv-* skill, plus one operational-state chip; the panel
 * renders ONLY in sessions whose `agentPreset` projection is one of
 * TARGET_PRESETS (`vv-controller`, `cursor/vv-controller`), so other presets
 * never see it.
 *
 * Auto-run mechanics. A click composes `/skill-name` (+ any text the user
 * already typed in the composer, appended as context after a blank line)
 * into the draft and calls the composer's own `inputActions.submit()` —
 * the exact transaction a typed Enter goes through (adjudication, queue
 * echo, draft clearing). `/vv-*` is the harness's skill gesture: unknown
 * to the command registry, the line falls through to a plain user message,
 * and dsh-tool-skill's agent/pre-step listener injects the skill content
 * for the model round-trip.
 *
 * Operational-state chip (v2). The Host performs every filesystem read; the
 * browser never touches a path directly. The client plugin calls the
 * Host-generated Remote namespace `workspaceFiles` (selected into this
 * Web assembly by @deepseek-ai/dsh-api-remotes) with the current
 * `sessionId`:
 *
 *   ctx.remote.workspaceFiles.list(sessionId, '.vvoc/specs', signal)
 *   ctx.remote.workspaceFiles.readBytes(sessionId, path, {}, signal)
 *
 * The wire carries only the Session id; the Host derives the workspace root
 * from the Session header, so a caller never supplies (or spoofs) a path
 * root. Reads are read-only, bounded, and peer-access-checked by the Host.
 * The client folds the returned bytes into the §P closed state vocabulary —
 * it never invents a state: an unavailable bridge, an unreadable or
 * unrecognized package, or any failed read yields no state claim at all.
 *
 * The host half of this bundle stays a deliberate no-op: a statically
 * installed bundle has no custom client-callable RPC of its own (the Client
 * Remote capability set is fixed at build time by the Web app assembly), so
 * a host half could only expose derivation through a registered slash
 * command — which appends `command/run`/`command/done` events to the
 * session log on every refresh. The read bridge is the supported mechanism
 * that has no session-log side effects.
 */

window.__ModuleLoader__.load({
  id: 'dsh-vv-panel',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;

    // ── tunables (kept in one place; move to plugin Config if they churn) ──
    // Both vv families show the panel: the DeepSeek/GLM `vv-controller` and the
    // Cursor derivative `cursor/vv-controller` (same vv workflow, cursor route).
    const TARGET_PRESETS = new Set(['vv-controller', 'cursor/vv-controller']);
    const SKILLS = [
      { name: 'vv-spec', tipKey: 'tip.spec' },
      { name: 'vv-plan', tipKey: 'tip.plan' },
      { name: 'vv-execute', tipKey: 'tip.execute' },
      { name: 'vv-review', tipKey: 'tip.review' },
      { name: 'vv-reflect', tipKey: 'tip.reflect' },
      { name: 'vv-handoff', tipKey: 'tip.handoff' },
    ];

    // ─── operational-state derivation (pure JS; no React, no DOM) ───
    //
    // Closed §P vocabulary (hive-research/vv-contract-vocabulary.md §P).
    // `stale-approval` overrides every other state (§K); `archived` packages
    // live under .vvoc/specs/archive/ and are excluded from active selection.
    // Deliberate collapses, documented in README: awaiting-plan-approval →
    // draft-plan (the heuristic needs the host lint engine, which the browser
    // cannot run) and awaiting-review → executing (that state is defined as a
    // heuristic in §P).
    const SPECS_DIR = '.vvoc/specs';
    const ARCHIVE_DIR = 'archive';
    const STATE_SKILL = {
      'draft-spec': 'vv-spec',
      'awaiting-spec-approval': 'vv-spec',
      'spec-approved': 'vv-plan',
      'draft-plan': 'vv-plan',
      'awaiting-plan-approval': 'vv-plan',
      'ready-to-execute': 'vv-execute',
      'executing': 'vv-execute',
      'awaiting-review': 'vv-review',
      'applied': 'vv-reflect',
      'stale-approval': 'vv-plan',
      'archived': 'vv-handoff',
      'no-package': 'vv-spec',
    };
    const LIFECYCLE = ['draft', 'approved', 'applied'];
    const NOT_FOUND = 'workspace-file/not-found';

    /** Extract the top-level lifecycle status of spec.xml/plan.xml. */
    function readLifecycleStatus(text, expectedRoot) {
      if (typeof text !== 'string' || text.trim() === '') return undefined;
      const root = /<(spec|plan)\b([^>]*)>/i.exec(text);
      if (!root) return undefined;
      if (expectedRoot !== undefined && root[1].toLowerCase() !== expectedRoot) return undefined;
      // The host lint engine reads the root `status` attribute; the element
      // form is accepted as a fallback for packages written by hand.
      const attribute = /\bstatus\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(root[2]);
      if (attribute) {
        const value = (attribute[1] !== undefined ? attribute[1] : attribute[2]).trim().toLowerCase();
        return value;
      }
      const element = /<status>\s*([^<]*?)\s*<\/status>/i.exec(text);
      if (element) return element[1].trim().toLowerCase();
      return 'draft'; // the lint engine defaults a missing status to draft
    }

    /** §P `awaiting-spec-approval` heuristic: the interview produced goals + requirements. */
    function hasInterviewArtifacts(text) {
      return typeof text === 'string' && /<goal\b/i.test(text) && /<requirement\b/i.test(text);
    }

    /** Last approvals.json entry for one artifact wins (§K). */
    function lastApproval(approvalsText, artifact) {
      if (typeof approvalsText !== 'string' || approvalsText.trim() === '') return undefined;
      let parsed;
      try {
        parsed = JSON.parse(approvalsText);
      } catch {
        return undefined;
      }
      const list = parsed && Array.isArray(parsed.approvals) ? parsed.approvals : Array.isArray(parsed) ? parsed : [];
      let last;
      for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.artifact !== artifact || typeof entry.sha256 !== 'string') continue;
        last = entry;
      }
      return last;
    }

    /** Lowercase SHA-256 hex of one byte array, or undefined when WebCrypto is absent. */
    async function sha256Hex(bytes) {
      const subtle = typeof globalThis !== 'undefined' && globalThis.crypto ? globalThis.crypto.subtle : undefined;
      if (!subtle || typeof subtle.digest !== 'function' || !(bytes instanceof Uint8Array)) return undefined;
      const digest = await subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    }

    /**
     * The first artifact whose recorded approval digest no longer matches its bytes.
     *
     * Only the `approved` window is checked: the recorded digest pins the bytes
     * the operator approved, and reaching `applied` is the executor's own
     * lifecycle flip (mark-applied) — the clearance was consumed by execution.
     * Byte-checking the applied state would flag every executed package as stale.
     */
    async function staleArtifact(input, specStatus, planStatus) {
      const candidates = [
        ['spec.xml', specStatus],
        ['plan.xml', planStatus],
      ];
      for (const pair of candidates) {
        const artifact = pair[0];
        const status = pair[1];
        if (status !== 'approved') continue;
        const entry = lastApproval(input.approvalsText, artifact);
        if (entry === undefined) continue;
        const bytes = artifact === 'spec.xml' ? input.specBytes : input.planBytes;
        if (!bytes) continue;
        const digest = await sha256Hex(bytes);
        if (digest === undefined) continue; // cannot claim staleness without a digest
        if (digest !== entry.sha256.trim().toLowerCase()) return artifact;
      }
      return undefined;
    }

    /**
     * Derive one §P state from already-read package files.
     *
     * @param input - `{ packageId, specText, specBytes, planText, planBytes, approvalsText, receiptsText }`;
     *   `planText` absent means no plan.xml.
     * @returns `{ kind: 'state', state, skill, artifact? }` or `{ kind: 'unknown', reason }`.
     */
    async function deriveOperationalState(input) {
      const specStatus = readLifecycleStatus(input.specText, 'spec');
      if (specStatus === undefined) return { kind: 'unknown', reason: 'spec-unreadable' };
      if (LIFECYCLE.indexOf(specStatus) === -1) return { kind: 'unknown', reason: 'spec-status-invalid' };
      const planStatus = input.planText === undefined ? undefined : readLifecycleStatus(input.planText, 'plan');
      if (input.planText !== undefined && planStatus === undefined) return { kind: 'unknown', reason: 'plan-unreadable' };
      if (planStatus !== undefined && LIFECYCLE.indexOf(planStatus) === -1) {
        return { kind: 'unknown', reason: 'plan-status-invalid' };
      }

      // §K: a recorded approval whose digest no longer matches overrides all.
      const stale = await staleArtifact(input, specStatus, planStatus);
      if (stale !== undefined) {
        return { kind: 'state', state: 'stale-approval', skill: stale === 'spec.xml' ? 'vv-spec' : 'vv-plan', artifact: stale };
      }

      const done = (state, extra) => ({ kind: 'state', state, skill: STATE_SKILL[state], ...(extra || {}) });
      const specApproved = specStatus === 'approved' || specStatus === 'applied';

      if (input.planText === undefined) {
        if (!specApproved) {
          return hasInterviewArtifacts(input.specText) ? done('awaiting-spec-approval') : done('draft-spec');
        }
        return done('spec-approved');
      }
      if (planStatus === 'draft') return done('draft-plan');
      if (planStatus === 'applied') return done('applied');
      // plan approved: receipts.jsonl marks that execution has started (§P).
      const receipts = typeof input.receiptsText === 'string' ? input.receiptsText.trim() : '';
      return receipts === '' ? done('ready-to-execute') : done('executing');
    }

    /** One Host Remote call folded into `{ value } | { failure }`; `failure: 'not-found'` is an absent path. */
    async function remoteCall(call) {
      try {
        const result = await call();
        if (result && result.ok === true) return { value: result.value };
        const error = result && result.error ? result.error : undefined;
        const code = error && typeof error.code === 'string' ? error.code : 'remote-failure';
        return { failure: code === NOT_FOUND ? 'not-found' : code };
      } catch (error) {
        const code = error && typeof error.code === 'string' ? error.code : 'threw';
        return { failure: code === NOT_FOUND ? 'not-found' : code };
      }
    }

    /** Read one workspace file as bytes + UTF-8 text through the Host bridge. */
    async function readWorkspaceFile(workspaceFiles, sessionId, path, signal) {
      const result = await remoteCall(() => workspaceFiles.readBytes(sessionId, path, {}, signal));
      if (result.failure === 'not-found') return { missing: true };
      if (result.failure) return { failure: result.failure };
      const value = result.value && typeof result.value === 'object' ? result.value : {};
      let bytes;
      if (value.data instanceof Uint8Array) bytes = value.data;
      else if (typeof value.data === 'string') bytes = new TextEncoder().encode(value.data);
      if (!bytes) return { failure: 'decode' };
      return { bytes, text: new TextDecoder().decode(bytes) };
    }

    /**
     * Read .vvoc/specs/ and derive the active (latest non-archived) package state.
     *
     * @param workspaceFiles - the Host Remote `workspaceFiles` namespace.
     * @param sessionId - current Session id; the Host maps it to the workspace root.
     * @param signal - caller cancellation.
     * @returns `{ kind: 'state', packageId, state, skill, artifact? }`, `{ kind: 'no-package' }`,
     *   `{ kind: 'unknown', reason }`, or `{ kind: 'unavailable', reason }`.
     */
    async function scanOperationalState(workspaceFiles, sessionId, signal) {
      const listed = await remoteCall(() => workspaceFiles.list(sessionId, SPECS_DIR, signal));
      if (listed.failure === 'not-found') return { kind: 'no-package' };
      if (listed.failure) return { kind: 'unavailable', reason: listed.failure };
      const listValue = listed.value && typeof listed.value === 'object' ? listed.value : {};
      const entries = Array.isArray(listValue.entries) ? listValue.entries : [];
      const packageIds = entries
        .filter((entry) => entry && entry.type === 'directory' && entry.name !== ARCHIVE_DIR)
        .map((entry) => entry.name)
        .filter((name) => typeof name === 'string' && name !== '' && name !== '..' && !/[\\/]/.test(name));
      if (packageIds.length === 0) return { kind: 'no-package' };
      // Package ids are `YYYY-MM-DD-<slug>` by convention, so name order is age order.
      packageIds.sort();
      const packageId = packageIds[packageIds.length - 1];
      const base = `${SPECS_DIR}/${packageId}`;

      const spec = await readWorkspaceFile(workspaceFiles, sessionId, `${base}/spec.xml`, signal);
      const plan = await readWorkspaceFile(workspaceFiles, sessionId, `${base}/plan.xml`, signal);
      const readFailure = [spec, plan].filter((file) => file.failure !== undefined)[0];
      if (readFailure) return { kind: 'unavailable', reason: readFailure.failure };
      if (spec.missing === true && plan.missing === true) {
        return { kind: 'unknown', reason: 'empty-package' };
      }
      if (spec.missing === true) return { kind: 'unknown', reason: 'spec-missing' };

      // Sidecars are optional: absence is a fact (no approvals / no receipts), not an error.
      const approvals = await readWorkspaceFile(workspaceFiles, sessionId, `${base}/approvals.json`, signal);
      const receipts = await readWorkspaceFile(workspaceFiles, sessionId, `${base}/receipts.jsonl`, signal);
      const sidecarFailure = [approvals, receipts].filter((file) => file.failure !== undefined)[0];
      if (sidecarFailure) return { kind: 'unavailable', reason: sidecarFailure.failure };

      const derived = await deriveOperationalState({
        packageId,
        specText: spec.text,
        specBytes: spec.bytes,
        planText: plan.missing === true ? undefined : plan.text,
        planBytes: plan.missing === true ? undefined : plan.bytes,
        approvalsText: approvals.missing === true ? undefined : approvals.text,
        receiptsText: receipts.missing === true ? undefined : receipts.text,
      });
      if (derived.kind !== 'state') return derived;
      return { packageId, ...derived };
    }
    // ─── end operational-state derivation ───

    // Self-contained prompt sent by the fallback `state` chip when the live
    // read bridge is unavailable. Documented verbatim in README.md; it must
    // make sense to an agent with no prior context in the session.
    const CANNED_STATE_PROMPT = [
      'Operational-state check for this repository, with no assumptions about prior context.',
      '',
      'Locate the active vv spec package: the latest non-archived directory under .vvoc/specs/ (skip .vvoc/specs/archive/). If none exists, report `operational-state: no-package` and stop.',
      'Otherwise run the spec_guard_lint tool on that package directory (.vvoc/specs/<id>/) and read the package files: spec.xml, plan.xml, approvals.json, receipts.jsonl.',
      'Then report exactly this, without editing any file:',
      '',
      'operational-state: <one of: draft-spec, awaiting-spec-approval, spec-approved, draft-plan, awaiting-plan-approval, ready-to-execute, executing, awaiting-review, applied, stale-approval, archived, no-package>',
      'package: <package path>',
      'next: /<vv-spec|vv-plan|vv-execute|vv-review|vv-reflect|vv-handoff>',
      'why: <one short line>',
      '',
      'Rules: stale-approval overrides every other state (approvals.json digest mismatch reported by spec_guard_lint). Use only the state names above. If spec_guard_lint is unavailable, say so and report the state from the files you could read, marking the evidence you used.',
    ].join('\n');

    const NS = 'vvPanel';
    const DICTS = {
      en: {
        'title': 'vv-controller workflow panel',
        'tip.spec': 'vv-spec: draft a spec.xml from a request with no agreed contract',
        'tip.plan': 'vv-plan: write plan.xml for an approved spec',
        'tip.execute': 'vv-execute: implement an approved plan (review gates included)',
        'tip.review': 'vv-review: report findings only, no fixes',
        'tip.reflect': 'vv-reflect: capture durable lessons after long work',
        'tip.handoff': 'vv-handoff: hand the context over before ending the session',
        'state.none': 'no-package',
        'state.tooltip.none': 'No .vvoc/specs package in this workspace. Click: /vv-spec to start.',
        'state.tooltip': '{id} — {state}. Click: /{skill}',
        'state.tooltip.stale': '{id} — stale-approval ({artifact}). Re-approval required. Click: /{skill}',
        'state.fallback': 'state',
        'state.tooltip.fallback': 'Live state unavailable ({reason}). Click: ask the agent to run spec_guard_lint on the active package and report one line.',
      },
      ru: {
        'title': 'Панель рабочего цикла vv-controller',
        'tip.spec': 'vv-spec: собрать spec.xml из требования без контракта',
        'tip.plan': 'vv-plan: написать plan.xml по согласованной spec',
        'tip.execute': 'vv-execute: исполнить согласованный plan (с ревью-гейтами)',
        'tip.review': 'vv-review: только находки, без правок',
        'tip.reflect': 'vv-reflect: вынести уроки после длинной работы',
        'tip.handoff': 'vv-handoff: передать контекст в конце сессии',
        'state.none': 'нет пакета',
        'state.tooltip.none': 'В рабочей области нет пакета .vvoc/specs. Клик: /vv-spec, чтобы начать.',
        'state.tooltip': '{id} — {state}. Клик: /{skill}',
        'state.tooltip.stale': '{id} — stale-approval ({artifact}). Нужно повторное согласование. Клик: /{skill}',
        'state.fallback': 'состояние',
        'state.tooltip.fallback': 'Живое состояние недоступно ({reason}). Клик: попросить агента прогнать spec_guard_lint по активному пакету и отчитаться одной строкой.',
      },
    };

    /** One chip. Skill/state names are contract proper nouns and stay untranslated. */
    function VvChip({ label, title, disabled, onClick, className }) {
      return h('button', {
        type: 'button',
        className: className ? `vv-panel-chip ${className}` : 'vv-panel-chip',
        title,
        disabled,
        onClick,
      }, label);
    }

    /** Everything the extra chip needs, derived from one scan result. */
    function stateChipView(scan, t) {
      const key = (value) => (t ? t(value) : value);
      if (scan.kind === 'state') {
        const title = scan.state === 'stale-approval'
          ? key('state.tooltip.stale')
          : key('state.tooltip');
        return {
          label: scan.state,
          title: title.replace('{id}', scan.packageId).replace('{state}', scan.state).replace('{artifact}', scan.artifact || '')
            .replace('{skill}', scan.skill),
          skill: scan.skill,
          className: 'vv-panel-chip--state' + (scan.state === 'stale-approval' ? ' vv-panel-chip--attention' : ''),
        };
      }
      if (scan.kind === 'no-package') {
        return {
          label: key('state.none'),
          title: key('state.tooltip.none'),
          skill: 'vv-spec',
          className: 'vv-panel-chip--state',
        };
      }
      if (scan.kind === 'unavailable' || scan.kind === 'unknown') {
        return {
          label: key('state.fallback'),
          title: key('state.tooltip.fallback').replace('{reason}', scan.reason || 'unknown'),
          prompt: CANNED_STATE_PROMPT,
          className: 'vv-panel-chip--state vv-panel-chip--fallback',
        };
      }
      // 'loading': no extra claim is rendered until the first scan settles.
      return undefined;
    }

    /** The toolbar entry. Props come from the slot's standard kit + our injected t/remote. */
    function VvPanel(props) {
      // Hooks first: the preset gate below must not make hook order vary.
      // Selector hooks take a mandatory selector; pick the smallest slices.
      const useProjection = props.useProjection;
      const useInput = props.useInput;
      const useSession = props.useSession;
      const useAccess = props.useAccess;
      const preset = useProjection ? useProjection('agentPreset') : undefined;
      const draft = useInput ? useInput((s) => s.draft) : '';
      const phase = useInput ? useInput((s) => s.phase) : 'plain';
      const running = useSession ? useSession((s) => s.running) : undefined;
      const canRead = useAccess ? useAccess('workspaceFiles/list') : undefined;
      const [scan, setScan] = useState({ kind: 'loading' });

      const enabled = TARGET_PRESETS.has(preset);
      const sessionId = props.sessionId;
      const getRemote = props.vvRemote;
      const remoteReady = typeof getRemote === 'function';

      // Re-scan on session change, when the turn boundary moves (files change
      // during a turn; the chip catches up as soon as it settles), and when the
      // Host read capability becomes available.
      useEffect(() => {
        if (!enabled) return undefined;
        if (sessionId === undefined) {
          setScan({ kind: 'unavailable', reason: 'no-session' });
          return undefined;
        }
        if (canRead === false) {
          setScan({ kind: 'unavailable', reason: 'no-access' });
          return undefined;
        }
        let cancelled = false;
        let timer;
        let controller;
        const run = (attemptsLeft) => {
          if (cancelled) return;
          const remote = remoteReady ? getRemote() : undefined;
          const workspaceFiles = remote && remote.workspaceFiles;
          if (!workspaceFiles) {
            // The Web assembly may still be mounting its Remote faces during
            // boot; retry briefly before claiming the bridge is absent.
            if (attemptsLeft > 0) {
              timer = setTimeout(() => run(attemptsLeft - 1), 500);
              return;
            }
            setScan({ kind: 'unavailable', reason: 'no-bridge' });
            return;
          }
          controller = typeof AbortController === 'function' ? new AbortController() : undefined;
          scanOperationalState(workspaceFiles, sessionId, controller ? controller.signal : undefined)
            .then((result) => {
              if (cancelled) return;
              if (result.kind === 'state') setScan(result);
              else if (result.kind === 'no-package') setScan({ kind: 'no-package' });
              else if (result.kind === 'unknown') setScan({ kind: 'unknown', reason: result.reason });
              else setScan({ kind: 'unavailable', reason: result.reason });
            })
            .catch((error) => {
              if (cancelled) return;
              setScan({ kind: 'unavailable', reason: error && error.code ? String(error.code) : 'scan-failed' });
            });
        };
        // The dynamic `remote` injection may settle after this component's
        // first render (the Remote rows mount asynchronously during boot), so
        // retry for a few seconds before falling back to the canned prompt.
        run(8);
        return () => {
          cancelled = true;
          if (timer) clearTimeout(timer);
          if (controller) controller.abort();
        };
      }, [enabled, sessionId, running, canRead, remoteReady, getRemote]);

      if (!enabled) return null;

      const t = props.vvT;
      const inputActions = props.inputActions;
      const busy = phase === 'adjudicating' || phase === 'submitting';

      const submitLine = (line) => {
        if (!inputActions || busy) return;
        const typed = typeof draft === 'string' ? draft.trim() : '';
        // `/name` is the skill gesture; typed text rides along as context.
        inputActions.setDraft(typed ? `${line}\n\n${typed}` : line);
        inputActions.submit();
      };

      const extra = stateChipView(scan, t);
      const extraOnClick = extra
        ? () => submitLine(extra.prompt !== undefined ? extra.prompt : `/${extra.skill}`)
        : undefined;

      return h('div', {
        className: 'vv-panel',
        role: 'toolbar',
        'aria-label': t ? t('title') : 'vv-controller panel',
      },
        h('style', null, CSS),
        SKILLS.map((skill) => h(VvChip, {
          key: skill.name,
          label: skill.name,
          title: t ? t(skill.tipKey) : skill.name,
          disabled: busy || !inputActions,
          onClick: () => submitLine(`/${skill.name}`),
        })),
        extra ? h(VvChip, {
          key: 'vv-state',
          label: extra.label,
          title: extra.title,
          className: extra.className,
          disabled: busy || !inputActions,
          onClick: extraOnClick,
        }) : null,
      );
    }

    const CSS = [
      '.vv-panel { display: flex; align-items: center; flex-wrap: nowrap; gap: 4px; }',
      '.vv-panel-chip {',
      '  font: inherit; font-size: 11px; line-height: 1;',
      '  padding: 4px 8px; border-radius: 999px;',
      '  white-space: nowrap;',
      '  color: var(--dsw-alias-label-secondary);',
      '  background: var(--dsw-alias-bg-layer-1);',
      '  border: 1px solid var(--dsw-alias-border-l1);',
      '  cursor: pointer;',
      '}',
      '.vv-panel-chip:hover:not(:disabled) {',
      '  color: var(--dsw-alias-label-primary);',
      '  border-color: var(--dsw-alias-border-l2);',
      '}',
      '.vv-panel-chip:disabled { opacity: 0.5; cursor: default; }',
      '.vv-panel-chip--state { font-weight: 500; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }',
      '.vv-panel-chip--attention { font-weight: 600; border-style: dashed; }',
      '.vv-panel-chip--fallback { font-style: italic; }',
    ].join('\n');

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // Locale dictionaries for the panel's own strings (tooltips, labels).
        for (const [locale, dict] of Object.entries(DICTS)) {
          ctx.effect(() => ctx.locale.register(NS, locale, dict), `vv-panel locale ${locale}`);
        }
        const t = ctx.locale.bind(NS);

        // The Host Remote face is OPTIONAL but must be declared before use.
        // The proxied Client context refuses to hand out a Remote namespace the
        // plugin did not inject — `ctx.get('remote')` returns a face whose
        // `workspaceFiles` access throws "cannot get property
        // \"remote.workspaceFiles\" without inject". That throw lands inside
        // React's effect and takes the whole slot entry down, i.e. the chip row
        // disappears. The supported pattern (every shipped client plugin that
        // calls a Remote does this) is a dynamic injection of the dotted
        // service, so the face only exists while the Remote rows are mounted;
        // a missing face degrades the chip to the canned-prompt fallback.
        let remoteFace;
        ctx.inject(['remote', 'remote.workspaceFiles'], (child) => {
          remoteFace = child.remote;
          return () => { remoteFace = undefined; };
        });
        const remote = () => remoteFace;

        // One compact-controls entry in the composer tool row: right after
        // the permission selector, before the trailing Vision/model/send
        // controls. The registration's lifetime follows the owning slot
        // declaration.
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'vv-panel',
          order: 10,
          inject: () => ({ vvT: t, vvRemote: remote }),
        }, VvPanel));
      },
    };
  },
});

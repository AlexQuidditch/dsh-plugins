/**
 * dsh-vv-panel, browser half.
 *
 * Registers one entry into the additive `conversation.input.left` slot —
 * the compact-controls area at the end of the composer tool row's leading
 * cluster, i.e. right after the permission selector ("Workspace Write")
 * and before the trailing controls (Vision, model, send). Six small chip
 * buttons, one per vv-* skill; the panel renders ONLY in sessions whose
 * `agentPreset` projection equals TARGET_PRESET, so other presets never
 * see it.
 *
 * Auto-run mechanics. A click composes `/skill-name` (+ any text the user
 * already typed in the composer, appended as context after a blank line)
 * into the draft and calls the composer's own `inputActions.submit()` —
 * the exact transaction a typed Enter goes through (adjudication, queue
 * echo, draft clearing). `/vv-*` is the harness's skill gesture: unknown
 * to the command registry, the line falls through to a plain user message,
 * and dsh-tool-skill's agent/pre-step listener injects the skill content
 * for the model round-trip. No host half is involved.
 */
window.__ModuleLoader__.load({
  id: 'dsh-vv-panel',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // ── tunables (kept in one place; move to plugin Config if they churn) ──
    const TARGET_PRESET = 'vv-controller';
    const SKILLS = [
      { name: 'vv-spec', tipKey: 'tip.spec' },
      { name: 'vv-plan', tipKey: 'tip.plan' },
      { name: 'vv-execute', tipKey: 'tip.execute' },
      { name: 'vv-review', tipKey: 'tip.review' },
      { name: 'vv-reflect', tipKey: 'tip.reflect' },
      { name: 'vv-handoff', tipKey: 'tip.handoff' },
    ];

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
      },
      ru: {
        'title': 'Панель рабочего цикла vv-controller',
        'tip.spec': 'vv-spec: собрать spec.xml из требования без контракта',
        'tip.plan': 'vv-plan: написать plan.xml по согласованной spec',
        'tip.execute': 'vv-execute: исполнить согласованный plan (с ревью-гейтами)',
        'tip.review': 'vv-review: только находки, без правок',
        'tip.reflect': 'vv-reflect: вынести уроки после длинной работы',
        'tip.handoff': 'vv-handoff: передать контекст в конце сессии',
      },
    };

    /** One button: the skill name is a proper noun and stays untranslated. */
    function VvButton({ skill, title, disabled, onClick }) {
      return h('button', {
        type: 'button',
        className: 'vv-panel-chip',
        title,
        disabled,
        onClick,
      }, skill.name);
    }

    /** The toolbar entry. Props come from the slot's standard kit + our injected t. */
    function VvPanel(props) {
      // Hooks first: the preset gate below must not make hook order vary.
      // Selector hooks take a mandatory selector; pick the smallest slices.
      const useProjection = props.useProjection;
      const useInput = props.useInput;
      const preset = useProjection ? useProjection('agentPreset') : undefined;
      const draft = useInput ? useInput((s) => s.draft) : '';
      const phase = useInput ? useInput((s) => s.phase) : 'plain';

      if (preset !== TARGET_PRESET) return null;

      const t = props.vvT;
      const inputActions = props.inputActions;
      const busy = phase === 'adjudicating' || phase === 'submitting';

      const run = (skill) => () => {
        if (!inputActions || busy) return;
        const typed = typeof draft === 'string' ? draft.trim() : '';
        // `/name` is the skill gesture; typed text rides along as context.
        const line = typed ? `/${skill.name}\n\n${typed}` : `/${skill.name}`;
        inputActions.setDraft(line);
        inputActions.submit();
      };

      return h('div', {
        className: 'vv-panel',
        role: 'toolbar',
        'aria-label': t ? t('title') : 'vv-controller panel',
      },
        h('style', null, CSS),
        SKILLS.map((skill) => h(VvButton, {
          key: skill.name,
          skill,
          title: t ? t(skill.tipKey) : skill.name,
          disabled: busy || !inputActions,
          onClick: run(skill),
        })),
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
    ].join('\n');

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // Locale dictionaries for the panel's own strings (tooltips, label).
        for (const [locale, dict] of Object.entries(DICTS)) {
          ctx.effect(() => ctx.locale.register(NS, locale, dict), `vv-panel locale ${locale}`);
        }
        const t = ctx.locale.bind(NS);

        // One compact-controls entry in the composer tool row: right after
        // the permission selector, before the trailing Vision/model/send
        // controls. The registration's lifetime follows the owning slot
        // declaration.
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'vv-panel',
          order: 10,
          inject: () => ({ vvT: t }),
        }, VvPanel));
      },
    };
  },
});

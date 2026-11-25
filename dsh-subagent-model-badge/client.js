window.__ModuleLoader__.load({
  id: 'dsh-subagent-model-badge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'subagentModelBadge';

    const en = { label: 'Model', next: 'next' };
    const ru = { label: 'Модель', next: 'далее' };

    const CSS = [
      '.dsh-subagent-model-badge{display:flex;align-items:center;gap:6px;margin:0 2px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.dsh-subagent-model-badge__route{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:4px;padding:0 4px;white-space:nowrap}',
      '.dsh-subagent-model-badge__effort{font-size:11.5px;white-space:nowrap}',
      '.dsh-subagent-model-badge__next{font-size:11.5px;white-space:nowrap;color:var(--dsw-alias-state-warn-primary)}',
    ].join('');

    /**
     * True when the session is a subagent child: the catalog address, or the
     * Host summary row (`origin`/`parentId`) for a child opened without one.
     */
    function isSubagentSession(ctx, sessionId) {
      try {
        if (ctx.sessions.subagentAddress(sessionId) !== undefined) return true;
        const row = ctx.sessions.list.getSnapshot().byId[sessionId];
        return row !== undefined && (row.origin === 'subagent' || row.parentId !== undefined);
      } catch {
        return false;
      }
    }

    function routeText(route) {
      return route === null || route === undefined ? '' : route.provider + '/' + route.model;
    }

    /** Localized text, with an English fallback so a missing translator never breaks the dock. */
    function text(t, key, fallback) {
      return typeof t === 'function' ? t(key) : fallback;
    }

    function SubagentModelBadge({ isSubagent, useProjection, t }) {
      const selection = useProjection('modelSelection');
      if (isSubagent !== true || selection === undefined || selection === null) return null;
      const used = selection.lastUsed ?? selection.next;
      if (used === null || used === undefined) return null;
      const next = selection.next;
      const pending = next !== null && next !== undefined && selection.lastUsed !== null && selection.lastUsed !== undefined && (
        next.provider !== selection.lastUsed.provider ||
        next.model !== selection.lastUsed.model ||
        next.reasoningEffort !== selection.lastUsed.reasoningEffort
      );
      return h('div', {
        className: 'dsh-subagent-model-badge',
        role: 'note',
        'data-subagent-model': routeText(used),
      },
        h('span', null, text(t, 'label', en.label)),
        h('code', { className: 'dsh-subagent-model-badge__route' }, routeText(used)),
        used.reasoningEffort ? h('span', { className: 'dsh-subagent-model-badge__effort' }, '· ' + used.reasoningEffort) : null,
        pending ? h('span', { className: 'dsh-subagent-model-badge__next' }, text(t, 'next', en.next) + ' ' + routeText(next)) : null,
      );
    }

    return {
      inject: ['slots', 'sessions', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const selector = 'style[data-plugin="dsh-subagent-model-badge"]';
          const stale = document.querySelector(selector);
          if (stale !== null) stale.remove();
          const tag = document.createElement('style');
          tag.dataset.plugin = 'dsh-subagent-model-badge';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => tag.remove();
        }, 'subagent-model-badge: styles');

        ctx.effect(() => ctx.locale.register(NS, { en, ru }), 'subagent-model-badge: locale');

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'subagent-model-badge',
          order: 2,
          locale: NS,
          inject: (sessionId) => ({ isSubagent: isSubagentSession(ctx, sessionId) }),
        }, SubagentModelBadge));
      },
    };
  },
});

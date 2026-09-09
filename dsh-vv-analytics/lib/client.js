window.__ModuleLoader__.load({
	id: "dsh-vv-analytics",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/format.ts
		/**
		* Token-weighted cache hit rate of one step or session total.
		*
		* The denominator is the prompt's traffic — uncached input plus cache reads
		* and writes — and the numerator is the cache-read share. A step without any
		* prompt traffic yields `undefined` (the "n/a" state), because a misleading 0%
		* is worse than no number.
		*/
		function cacheHitRate(buckets) {
			const prompt = buckets.inputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens;
			if (prompt <= 0) return void 0;
			return buckets.cacheReadTokens / prompt;
		}
		/** Human label for the pill: "кэш 84%" or "кэш n/a". */
		function formatHitRate(rate) {
			if (rate === void 0) return "кэш n/a";
			return `кэш ${Math.round(rate * 100)}%`;
		}
		/** CSS class tier for a hit rate; undefined rate is the neutral tier. */
		function hitRateTier(rate) {
			if (rate === void 0) return "neutral";
			if (rate >= .8) return "green";
			if (rate >= .5) return "yellow";
			return "red";
		}
		//#endregion
		//#region \0dsh-css:/Users/alex_quidditch/projects/dsh-plugins/dsh-vv-analytics/src/client/CachePill.module.css.mjs
		const css = ".Bg_Prq_pill{white-space:nowrap;cursor:default;border-radius:11px;align-items:center;height:22px;padding:0 8px;font-size:12px;line-height:1;display:inline-flex}.Bg_Prq_neutral{color:var(--ds-text-tertiary,#8b8e99);background:var(--ds-surface-secondary,#8c91a01f)}.Bg_Prq_green{color:#2e7d32;background:#2e7d3224}.Bg_Prq_yellow{color:#9a6b00;background:#d69e2e29}.Bg_Prq_red{color:#b3261e;background:#b3261e24}";
		const tagId = "dsh-vv-analytics/CachePill.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-vv-analytics";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var CachePill_module_css_default = {
			"green": "Bg_Prq_green",
			"neutral": "Bg_Prq_neutral",
			"pill": "Bg_Prq_pill",
			"red": "Bg_Prq_red",
			"yellow": "Bg_Prq_yellow"
		};
		//#endregion
		//#region src/client/CachePill.tsx
		function CachePill(props) {
			props.sessionId;
			const usage = props.useProjection === void 0 ? void 0 : props.useProjection("tokenUsage");
			const rate = usage === void 0 ? void 0 : cacheHitRate({
				inputTokens: usage.uncachedInputTokens ?? 0,
				cacheReadTokens: usage.cacheReadTokens ?? 0,
				cacheWriteTokens: usage.cacheWriteTokens ?? 0
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: `${CachePill_module_css_default.pill} ${CachePill_module_css_default[hitRateTier(rate)]}`,
				title: "Кэш-попадание сессии: cacheRead / (cacheRead + cacheWrite + input)",
				children: formatHitRate(rate)
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services: the slot registry. */
		const inject = ["slots"];
		function apply(ctx) {
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "vv-cache-indicator",
				order: 20
			}, CachePill));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
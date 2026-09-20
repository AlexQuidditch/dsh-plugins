window.__ModuleLoader__.load({
	id: "dsh-vv-context",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/format.ts
		/**
		* Pure formatting helpers for the context panel. No DOM, no React — only
		* numbers and text, so the host entry can re-export them for the activation
		* test (the client preset bundles this file into the entry).
		*/
		/** Compact token notation: 1234 → "1.2k", 1234567 → "1.2M". */
		function formatTokens(tokens) {
			if (!Number.isFinite(tokens) || tokens < 0) return "—";
			if (tokens < 1e3) return String(Math.round(tokens));
			if (tokens < 1e6) return `${(tokens / 1e3).toFixed(1)}k`;
			return `${(tokens / 1e6).toFixed(1)}M`;
		}
		/**
		* Percentage of a total as a plain number (0..1), or undefined when the
		* denominator is absent or non-positive — an honest "no data" instead of a
		* fabricated zero.
		*/
		function shareOf(part, total) {
			if (total === void 0 || !Number.isFinite(total) || total <= 0) return void 0;
			if (!Number.isFinite(part) || part < 0) return void 0;
			return part / total;
		}
		/** "84%" or "—". */
		function formatPercent(share) {
			if (share === void 0) return "—";
			return `${Math.round(share * 100)}%`;
		}
		//#endregion
		//#region \0dsh-css:/Users/alex_quidditch/projects/dsh-plugins/dsh-vv-context/src/client/ContextPanel.module.css.mjs
		const css = ".Uq6wGq_pill{white-space:nowrap;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);height:22px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-radius:11px;align-items:center;padding:0 8px;font-size:12px;line-height:1;transition:color .15s,background-color .15s,border-color .15s;display:inline-flex}.Uq6wGq_pill:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.Uq6wGq_pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.Uq6wGq_overlay{z-index:1000;background:color-mix(in srgb, var(--dsw-alias-label-primary) 28%, transparent);justify-content:flex-end;align-items:flex-start;padding:56px 16px 16px;display:flex;position:fixed;inset:0}.Uq6wGq_panel{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);width:340px;max-height:calc(100vh - 96px);color:var(--dsw-alias-label-primary);box-shadow:0 12px 40px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent);border-radius:12px;padding:12px 16px 14px;overflow-y:auto}.Uq6wGq_header{justify-content:space-between;align-items:center;margin-bottom:6px;display:flex}.Uq6wGq_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600}.Uq6wGq_close{cursor:pointer;color:var(--dsw-alias-label-dimmed);background:0 0;border:none;border-radius:6px;padding:2px 6px;font-size:18px;line-height:1;transition:color .15s,background-color .15s}.Uq6wGq_close:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.Uq6wGq_close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.Uq6wGq_section{margin-top:10px}.Uq6wGq_sectionTitle{text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);margin:0 0 4px;font-size:12px;font-weight:600}.Uq6wGq_row{align-items:center;gap:8px;padding:3px 0;font-size:13px;display:flex}.Uq6wGq_rowLabel{color:var(--dsw-alias-label-secondary);flex:0 0 150px}.Uq6wGq_rowValue{text-align:right;font-variant-numeric:tabular-nums;min-width:52px;color:var(--dsw-alias-label-primary);flex:none}.Uq6wGq_barTrack{background:var(--dsw-alias-bg-layer-3);border-radius:3px;flex:auto;height:6px;overflow:hidden}.Uq6wGq_barFill{background:var(--dsw-alias-brand-primary);border-radius:3px;height:100%;display:block}.Uq6wGq_footer{color:var(--dsw-alias-label-tertiary);margin-top:10px;font-size:11px;line-height:1.4}";
		const tagId = "dsh-vv-context/ContextPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-vv-context";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var ContextPanel_module_css_default = {
			"barFill": "Uq6wGq_barFill",
			"barTrack": "Uq6wGq_barTrack",
			"close": "Uq6wGq_close",
			"footer": "Uq6wGq_footer",
			"header": "Uq6wGq_header",
			"overlay": "Uq6wGq_overlay",
			"panel": "Uq6wGq_panel",
			"pill": "Uq6wGq_pill",
			"row": "Uq6wGq_row",
			"rowLabel": "Uq6wGq_rowLabel",
			"rowValue": "Uq6wGq_rowValue",
			"section": "Uq6wGq_section",
			"sectionTitle": "Uq6wGq_sectionTitle",
			"title": "Uq6wGq_title"
		};
		//#endregion
		//#region src/client/ContextPanel.tsx
		/**
		* The /context inspector panel.
		*
		* One header button plus a fixed overlay with three sections, all derived from
		* the host token-meter projections read through the framework `useProjection`
		* hook (bound to the projection store, so the panel re-renders on every host
		* commit without manual subscriptions):
		*
		* - Использование — cumulative disjoint buckets of the session;
		* - Давление — last provider-reported prompt size, projected next-request
		*   size, and route capacity; percentage uses the projected figure and the
		*   route's contextWindow, and shows an em dash when either is absent;
		* - Состав — heuristic composition of the next request (system/tools/messages).
		*
		* Estimates are presented as estimates: percentages may exceed 100 and bars
		* only clamp their fill, mirroring the vv contract.
		*/
		function Row({ label, value, share, bar }) {
			const width = share === void 0 ? 0 : Math.min(100, share * 100);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ContextPanel_module_css_default.row,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ContextPanel_module_css_default.rowLabel,
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ContextPanel_module_css_default.rowValue,
						children: value
					}),
					bar === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ContextPanel_module_css_default.barTrack,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ContextPanel_module_css_default.barFill,
							style: { width: `${width}%` }
						})
					})
				]
			});
		}
		function ContextPanel(props) {
			props.sessionId;
			const [open, setOpen] = (0, react.useState)(false);
			const panelRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				const onClick = (event) => {
					if (panelRef.current !== null && !panelRef.current.contains(event.target)) setOpen(false);
				};
				document.addEventListener("keydown", onKey);
				document.addEventListener("mousedown", onClick);
				return () => {
					document.removeEventListener("keydown", onKey);
					document.removeEventListener("mousedown", onClick);
				};
			}, [open]);
			const pressure = props.useProjection === void 0 ? void 0 : props.useProjection("contextPressure");
			const breakdown = props.useProjection === void 0 ? void 0 : props.useProjection("contextBreakdown");
			const requestTokens = pressure?.projectedTokens ?? pressure?.pressureTokens;
			const occupancyShare = shareOf(requestTokens ?? 0, pressure?.contextWindow);
			const breakdownShare = shareOf((breakdown?.systemTokens ?? 0) + (breakdown?.toolsTokens ?? 0) + (breakdown?.messageTokens ?? 0), requestTokens);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: ContextPanel_module_css_default.pill,
				title: "Инспектор контекстного окна сессии",
				onClick: () => setOpen(!open),
				children: "ⓘ контекст"
			}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ContextPanel_module_css_default.overlay,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ContextPanel_module_css_default.panel,
					ref: panelRef,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ContextPanel_module_css_default.header,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ContextPanel_module_css_default.title,
								children: "Контекст сессии"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ContextPanel_module_css_default.close,
								onClick: () => setOpen(false),
								"aria-label": "Закрыть",
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: ContextPanel_module_css_default.section,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: ContextPanel_module_css_default.sectionTitle,
									children: "Давление на окно"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
									label: "Последний запрос",
									value: pressure === void 0 || pressure.pressureTokens === void 0 ? "—" : formatTokens(pressure.pressureTokens),
									share: void 0
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
									label: "Следующий запрос (оценка)",
									value: pressure === void 0 || pressure.projectedTokens === void 0 ? "—" : formatTokens(pressure.projectedTokens),
									share: void 0
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
									label: "Окно модели",
									value: pressure === void 0 || pressure.contextWindow === void 0 ? "—" : formatTokens(pressure.contextWindow),
									share: void 0
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
									label: "Занятость",
									value: formatPercent(occupancyShare),
									share: occupancyShare,
									bar: true
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: ContextPanel_module_css_default.section,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: ContextPanel_module_css_default.sectionTitle,
									children: "Состав (оценка)"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
									label: "System",
									value: formatTokens(breakdown?.systemTokens ?? 0),
									share: shareOf(breakdown?.systemTokens ?? 0, pressure?.projectedTokens ?? pressure?.pressureTokens)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
									label: "Tools",
									value: formatTokens(breakdown?.toolsTokens ?? 0),
									share: shareOf(breakdown?.toolsTokens ?? 0, pressure?.projectedTokens ?? pressure?.pressureTokens)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
									label: "Messages",
									value: formatTokens(breakdown?.messageTokens ?? 0),
									share: shareOf(breakdown?.messageTokens ?? 0, pressure?.projectedTokens ?? pressure?.pressureTokens)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
									label: "Доля от запроса",
									value: formatPercent(breakdownShare),
									share: breakdownShare,
									bar: true
								})
							]
						})
					]
				})
			})] });
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services: the slot registry. */
		const inject = ["slots"];
		function apply(ctx) {
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "vv-context-inspector",
				order: 30
			}, ContextPanel));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
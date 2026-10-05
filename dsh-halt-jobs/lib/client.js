window.__ModuleLoader__.load({
	id: "dsh-halt-jobs",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:/Users/alex_quidditch/projects/dsh-plugins/dsh-halt-jobs/src/client/HaltJobsPill.module.css.mjs
		const css = ".fZWhjW_wrap{align-items:center;display:inline-flex;position:relative}.fZWhjW_button{color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;align-items:center;padding:0;font-size:12px;line-height:1;transition:color .15s,opacity .15s;display:inline-flex}.fZWhjW_button:hover{color:var(--dsw-alias-label-primary)}.fZWhjW_button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.fZWhjW_idle{cursor:default;opacity:.62}.fZWhjW_idle:hover{color:var(--dsw-alias-label-secondary)}.fZWhjW_active{color:var(--dsw-alias-state-error-primary)}.fZWhjW_active:hover{color:var(--dsw-alias-state-error-primary);opacity:.85}.fZWhjW_busy{opacity:.55;cursor:progress}.fZWhjW_unknown{opacity:.3}.fZWhjW_note{z-index:40;white-space:nowrap;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border-radius:6px;padding:3px 8px;font-size:11px;line-height:16px;position:absolute;top:calc(100% + 6px);right:0;box-shadow:0 4px 14px #0000002e}";
		const tagId = "dsh-halt-jobs/HaltJobsPill.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-halt-jobs";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var HaltJobsPill_module_css_default = {
			"active": "fZWhjW_active",
			"busy": "fZWhjW_busy",
			"button": "fZWhjW_button",
			"idle": "fZWhjW_idle",
			"note": "fZWhjW_note",
			"unknown": "fZWhjW_unknown",
			"wrap": "fZWhjW_wrap"
		};
		//#endregion
		//#region src/client/HaltJobsPill.tsx
		/**
		* Text stop button in `conversation.session.header.actions`, immediately right
		* of the shipped background-jobs selector (`job-list`, order 20).
		*
		* Job state comes from the client `jobs` service through the slot's `useJobs`
		* hook (fed by `hooks: { jobs }` on the registration), with `watchRows`
		* opening the session's roster stream — the 0.2 replacement for the old
		* `useSessions(state => state.jobsBySession[id])` projection. The only host
		* call is `stop-all` on `/dsh-halt-jobs`, injected as a prop by the
		* registering module (./index.tsx).
		*/
		/** Stable empty list so a jobless session keeps one array identity. */
		const NO_JOBS = [];
		/** A job the registry still holds open; the button enables stop while any exist. */
		function isLive(job) {
			return job.status === "running" || job.status === "stopping";
		}
		function HaltJobsPill({ sessionId = "", useJobs, watchRows, stopAll }) {
			// The roster is streamed per watched session, so the pill must open the
			// stream itself: with no watcher, `rows[sessionId]` stays empty forever.
			(0, react.useEffect)(() => {
				if (sessionId === "" || typeof watchRows !== "function") return;
				return watchRows(sessionId);
			}, [sessionId, watchRows]);
			const jobs = useJobs?.((state) => state.rows?.[sessionId]) ?? NO_JOBS;
			const live = (0, react.useMemo)(() => jobs.filter(isLive).length, [jobs]);
			const settled = jobs.length - live;
			const [busy, setBusy] = (0, react.useState)(false);
			const [note, setNote] = (0, react.useState)("");
			(0, react.useEffect)(() => {
				if (note === "") return;
				const timer = setTimeout(() => setNote(""), 3200);
				return () => clearTimeout(timer);
			}, [note]);
			const pending = live > 0;
			const canStop = pending && !busy;
			let title;
			if (sessionId === "") title = "Фоновые задачи недоступны: сессия не выбрана";
			else if (pending) title = "Остановить все фоновые задачи сессии";
			else if (settled > 0) title = `Активных фоновых задач нет · завершённых: ${settled}`;
			else title = "Фоновых задач нет";
			const onClick = () => {
				if (!canStop) return;
				setBusy(true);
				setNote("");
				stopAll(sessionId).then((outcome) => {
					setBusy(false);
					if (outcome.ok) setNote(outcome.value.stopped > 0 ? `Остановлено задач: ${outcome.value.stopped}` : "Активных задач нет");
					else setNote(`Не удалось остановить: ${outcome.message}`);
				}).catch(() => {
					setBusy(false);
					setNote("Не удалось остановить");
				});
			};
			const className = [
				HaltJobsPill_module_css_default.button,
				pending ? HaltJobsPill_module_css_default.active : HaltJobsPill_module_css_default.idle,
				busy ? HaltJobsPill_module_css_default.busy : "",
				sessionId === "" ? HaltJobsPill_module_css_default.unknown : ""
			].filter(Boolean).join(" ");
			return canStop ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: HaltJobsPill_module_css_default.wrap,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className,
					title,
					"aria-label": title,
					"aria-disabled": canStop ? "false" : "true",
					onClick,
					children: "Остановить"
				}), note !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: HaltJobsPill_module_css_default.note,
					role: "status",
					children: note
				}) : null]
			}) : null;
		}
		//#endregion
		//#region src/client/index.ts
		/** Logical channel owned by the host half (src/index.ts). */
		const CHANNEL = "/dsh-halt-jobs";
		/** Coerce a wire number with a safe default. */
		function numberOf(value) {
			return typeof value === "number" && Number.isFinite(value) ? value : 0;
		}
		/** Required services: the wire client, the slot registry, and the jobs rosters. */
		const inject = ["connection", "slots", "jobs"];
		function apply(ctx) {
			const connection = ctx.get("connection");
			const jobs = ctx.get("jobs");
			const stopAll = (sessionId) => {
				if (connection === void 0) return Promise.resolve({
					ok: false,
					message: "connection service unavailable"
				});
				return connection.rpc.call(CHANNEL, "stop-all", { sessionId }).then((result) => result.ok ? {
					ok: true,
					value: {
						stopped: numberOf(result.value?.stopped),
						remaining: numberOf(result.value?.remaining)
					}
				} : {
					ok: false,
					message: result.error.message
				}).catch((error) => ({
					ok: false,
					message: error instanceof Error ? error.message : String(error)
				}));
			};
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "halt-stop-all",
				order: 100,
				inject: () => ({
					hooks: { jobs: jobs?.state },
					watchRows: (sessionId) => jobs?.watchRows(sessionId),
					stopAll
				})
			}, HaltJobsPill));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
window.__ModuleLoader__.load({
	id: "dsh-peak-hours",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		const h = react.createElement;

		//#region css
		const CSS = [
			".dph-wrap{position:relative;display:inline-flex;align-items:center}",
			".dph-pill{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:5px 12px;font-size:12px;line-height:1.5;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);cursor:pointer;transition:box-shadow .4s ease,background .4s ease,color .4s ease,border-color .4s ease}",
			".dph-pill:hover{color:var(--dsw-alias-label-primary)}",
			".dph-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".dph-dot{width:9px;height:9px;border-radius:50%;background:var(--dsw-alias-state-success-primary);transition:background .4s ease,box-shadow .4s ease}",
			".dph-on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, var(--dsw-alias-bg-layer-1));animation:dphPulse 2.2s ease-in-out infinite}",
			".dph-on .dph-dot{background:var(--dsw-alias-state-error-primary);box-shadow:0 0 8px 1px var(--dsw-alias-state-error-primary)}",
			"@keyframes dphPulse{0%,100%{box-shadow:0 0 6px 1px var(--dsw-alias-state-error-primary)}50%{box-shadow:0 0 16px 5px var(--dsw-alias-state-error-primary)}}",
			".dph-allowed{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-warning-primary,#d9a441);background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,#d9a441) 16%, var(--dsw-alias-bg-layer-1))}",
			".dph-allowed .dph-dot{background:var(--dsw-alias-state-warning-primary,#d9a441)}",
			".dph-offline{opacity:.6}",
			".dph-pop{z-index:60;position:absolute;top:calc(100% + 8px);right:0;width:300px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);border-radius:12px;box-shadow:0 12px 40px #0000003d;padding:12px 14px;font-size:12px;line-height:1.5}",
			".dph-title{font-size:13px;font-weight:600;margin-bottom:8px}",
			".dph-row{display:flex;justify-content:space-between;gap:10px;padding:2px 0}",
			".dph-k{color:var(--dsw-alias-label-tertiary)}",
			".dph-v{text-align:right;font-variant-numeric:tabular-nums}",
			".dph-sep{border-top:1px solid var(--dsw-alias-border-l1);margin:8px 0}",
			".dph-toggle{display:flex;align-items:flex-start;gap:8px;cursor:pointer}",
			".dph-toggle input{margin:2px 0 0;cursor:pointer}",
			".dph-note{color:var(--dsw-alias-label-tertiary);margin-top:6px;font-size:11px;line-height:1.4}",
			".dph-warn{color:var(--dsw-alias-state-error-primary)}",
			".dph-win{color:var(--dsw-alias-label-secondary);font-size:11px}",
		].join("");
		const TAG = "dsh-peak-hours/pill.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-peak-hours";
			tag.dataset.pluginCss = TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region helpers
		/** Compact remaining-time label: "12 мин" / "1 ч 20 мин" / "2 дн 3 ч". */
		function formatRemaining(totalSeconds) {
			const min = Math.max(0, Math.round(totalSeconds / 60));
			if (min < 60) return min + " мин";
			const hours = Math.floor(min / 60);
			const rest = min % 60;
			if (hours < 24) return rest === 0 ? hours + " ч" : hours + " ч " + rest + " мин";
			const days = Math.floor(hours / 24);
			const restHours = hours % 24;
			return restHours === 0 ? days + " дн" : days + " дн " + restHours + " ч";
		}

		/** The UTC offset of `tz` at `date`, in milliseconds. */
		function tzOffsetMs(tz, date) {
			const parts = {};
			for (const part of new Intl.DateTimeFormat("en-US", {
				timeZone: tz, hour12: false, year: "numeric", month: "2-digit",
				day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
			}).formatToParts(date)) {
				if (part.type !== "literal") parts[part.type] = part.value;
			}
			const hour = parts.hour === "24" ? 0 : Number(parts.hour);
			return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second)) - date.getTime();
		}

		/**
		 * A window rendered in the browser's own clock, so the schedule reads the
		 * same wherever the user is. Falls back to the configured label when the
		 * zone is unknown to Intl.
		 */
		function localWindowLabel(window) {
			const tz = window.tz || "UTC";
			try {
				const now = new Date();
				const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
				const at = (hhmm) => {
					let ts = Date.parse(day + "T" + hhmm + ":00Z");
					ts -= tzOffsetMs(tz, new Date(ts));
					ts -= tzOffsetMs(tz, new Date(ts)) - tzOffsetMs(tz, new Date(Date.parse(day + "T" + hhmm + ":00Z")));
					return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts));
				};
				return at(window.start) + "–" + at(window.end);
			} catch {
				return window.start + "–" + window.end + " " + tz;
			}
		}

		/** Every configured window, flattened for display. */
		function allWindows(schedules) {
			const out = [];
			for (const key of Object.keys(schedules || {})) {
				for (const window of schedules[key].windows || []) out.push(window);
			}
			return out;
		}
		//#endregion

		//#region component
		/** Poll cadence for the host state; the countdown ticks locally between polls. */
		const POLL_MS = 30000;

		function PeakHoursPill({ rpcCall }) {
			const [state, setState] = react.useState(null);
			const [offline, setOffline] = react.useState(false);
			const [open, setOpen] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [left, setLeft] = react.useState(0);
			const rootRef = react.useRef(null);
			/** Latest `refresh`, so the boundary effect can re-poll without re-subscribing. */
			const refreshRef = react.useRef(null);

			react.useEffect(() => {
				let alive = true;
				const refresh = () => {
					rpcCall("state", {}).then((result) => {
						if (!alive) return;
						if (result.ok) { setState(result.value); setLeft(result.value.secondsToChange); setOffline(false); }
						else setOffline(true);
					}).catch(() => { if (alive) setOffline(true); });
				};
				refresh();
				refreshRef.current = refresh;
				const poll = setInterval(refresh, POLL_MS);
				const tick = setInterval(() => setLeft((value) => (value > 0 ? value - 1 : 0)), 1000);
				return () => { alive = false; clearInterval(poll); clearInterval(tick); refreshRef.current = null; };
			}, [rpcCall]);

			// The countdown reached its boundary: ask the host instead of sitting
			// on "через 0 мин" until the next poll, which can be half a minute away.
			react.useEffect(() => {
				if (left === 0) refreshRef.current?.();
			}, [left]);

			// Outside click closes the popover; Escape too.
			react.useEffect(() => {
				if (!open) return;
				const onDown = (event) => {
					if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false);
				};
				const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
				document.addEventListener("mousedown", onDown);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("mousedown", onDown);
					document.removeEventListener("keydown", onKey);
				};
			}, [open]);

			const peak = state !== null && state.peak;
			const allowed = state !== null && state.allowPeak;
			const mode = state === null ? "soft" : state.mode;
			const blocking = mode === "hard";

			let text = "пик — нет связи";
			if (state !== null) {
				if (peak && allowed) text = "пик · разрешён";
				else if (peak) text = "конец пика через " + formatRemaining(left);
				else text = "пик через " + formatRemaining(left);
			}

			// Amber whenever the gate is suspended, so the switch is legible from
			// the pill alone — in peak and out of it. Red pulse means "blocked".
			const className = ["dph-pill", allowed ? "dph-allowed" : peak ? "dph-on" : "", offline && state === null ? "dph-offline" : ""]
				.filter(Boolean).join(" ");

			const toggle = () => {
				if (busy) return;
				setBusy(true);
				rpcCall("set-allow-peak", { allowPeak: !allowed }).then((result) => {
					setBusy(false);
					if (result.ok) { setState(result.value); setLeft(result.value.secondsToChange); setOffline(false); }
					else setOffline(true);
				}).catch(() => { setBusy(false); setOffline(true); });
			};

			const windows = state === null ? [] : allWindows(state.schedules);

			const popover = !open ? null : h("div", { className: "dph-pop", role: "dialog", "aria-label": "Пиковые часы" }, [
				h("div", { className: "dph-title", key: "t" }, "Пиковые часы DeepSeek"),
				h("div", { className: "dph-row", key: "status" }, [
					h("span", { className: "dph-k", key: "k" }, "Сейчас"),
					h("span", { className: "dph-v" + (peak ? " dph-warn" : ""), key: "v" }, state === null ? "нет связи с хостом" : (peak ? "пик" : "не пик")),
				]),
				h("div", { className: "dph-row", key: "next" }, [
					h("span", { className: "dph-k", key: "k" }, peak ? "Конец пика" : "Начало пика"),
					h("span", { className: "dph-v", key: "v" }, state === null ? "—" : "через " + formatRemaining(left)),
				]),
				h("div", { className: "dph-row", key: "mode" }, [
					h("span", { className: "dph-k", key: "k" }, "Режим гейта"),
					h("span", { className: "dph-v", key: "v" }, mode === "hard" ? "hard (блокирует)" : "soft (предупреждает)"),
				]),
				windows.length === 0 ? null : h("div", { className: "dph-win", key: "w" }, "Окна (твоё время): " + windows.map(localWindowLabel).join(", ")),
				h("div", { className: "dph-sep", key: "s" }),
				h("label", { className: "dph-toggle", key: "l" }, [
					h("input", { type: "checkbox", checked: allowed, disabled: busy, onChange: toggle, key: "i" }),
					h("span", { key: "s" }, "Разрешить работу в peak hours"),
				]),
				h("div", { className: "dph-note", key: "n" }, state === null
					? "Хост-половина не ответила. Переключатель и гейт живут на хосте: если dsh web только что обновлён, перезапустите его."
					: allowed
						? "Гейт выключен: вызовы проходят, " + (blocking ? "PEAK_HOURS_BLOCK не бросается" : "предупреждения не пишутся") + ". Настройка сохраняется между перезапусками."
						: blocking
							? "Сейчас вызовы в пик отклоняются ошибкой PEAK_HOURS_BLOCK."
							: "Сейчас вызовы в пик проходят с предупреждением в лог хоста."),
			]);

			return h("span", { className: "dph-wrap", ref: rootRef }, [
				h("button", {
					type: "button",
					className,
					key: "p",
					title: "Пиковые часы DeepSeek — нажми, чтобы открыть настройки",
					"aria-label": text,
					"aria-expanded": open,
					onClick: () => setOpen((value) => !value),
				}, [h("span", { className: "dph-dot", key: "d" }), h("span", { key: "x" }, text)]),
				popover,
			]);
		}
		//#endregion

		//#region registration
		/** Logical channel owned by the host half (lib/index.js). */
		const CHANNEL = "/dsh-peak-hours";

		/** Required services: the wire client and the slot registry. */
		const inject = ["connection", "slots"];

		function apply(ctx) {
			const connection = ctx.get("connection");
			const rpcCall = (endpoint, payload) => {
				if (connection === undefined) return Promise.resolve({ ok: false, error: { code: "no-connection", message: "connection service unavailable" } });
				return connection.rpc.call(CHANNEL, endpoint, payload)
					.then((result) => result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error })
					.catch((error) => ({ ok: false, error: { code: "transport", message: error instanceof Error ? error.message : String(error) } }));
			};

			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "deepseek-peak-indicator",
				inject: () => ({ rpcCall }),
			}, PeakHoursPill));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

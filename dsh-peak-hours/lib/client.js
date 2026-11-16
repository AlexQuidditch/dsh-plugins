window.__ModuleLoader__.load({
	id: "dsh-peak-hours",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const h = react.createElement;

		//#region css
		const CSS = [
			".dph-wrap{position:relative;display:inline-flex;align-items:center}",
			".dph-pill{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:5px 12px;font-size:12px;line-height:1.5;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);cursor:pointer;transition:box-shadow .4s ease,background .4s ease,color .4s ease,border-color .4s ease}",
			".dph-pill:hover{color:var(--dsw-alias-label-primary)}",
			".dph-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".dph-pill:disabled{cursor:default;opacity:.75}",
			".dph-dot{width:9px;height:9px;border-radius:50%;background:var(--dsw-alias-state-success-primary);transition:background .4s ease,box-shadow .4s ease}",
			".dph-on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, var(--dsw-alias-bg-layer-1));animation:dphPulse 2.2s ease-in-out infinite}",
			".dph-on .dph-dot{background:var(--dsw-alias-state-error-primary);box-shadow:0 0 8px 1px var(--dsw-alias-state-error-primary)}",
			"@keyframes dphPulse{0%,100%{box-shadow:0 0 6px 1px var(--dsw-alias-state-error-primary)}50%{box-shadow:0 0 16px 5px var(--dsw-alias-state-error-primary)}}",
			".dph-allowed{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-warn-primary,#d9a441);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#d9a441) 16%, var(--dsw-alias-bg-layer-1))}",
			".dph-allowed .dph-dot{background:var(--dsw-alias-state-warn-primary,#d9a441)}",
			".dph-paused{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, var(--dsw-alias-bg-layer-1));animation:dphPulseBlue 2.6s ease-in-out infinite}",
			".dph-paused .dph-dot{background:var(--dsw-alias-brand-primary);box-shadow:0 0 8px 1px var(--dsw-alias-brand-primary)}",
			"@keyframes dphPulseBlue{0%,100%{box-shadow:0 0 5px 0 var(--dsw-alias-brand-primary)}50%{box-shadow:0 0 12px 3px var(--dsw-alias-brand-primary)}}",
			".dph-soon{border-color:var(--dsw-alias-state-warn-primary,#d9a441)}",
			".dph-soon .dph-dot{background:var(--dsw-alias-state-warn-primary,#d9a441)}",
			".dph-muted .dph-dot{background:var(--dsw-alias-label-tertiary)}",
			".dph-offline{opacity:.6}",
			".dph-pop{z-index:60;position:absolute;top:calc(100% + 8px);right:0;width:330px;max-height:72vh;overflow:auto;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);border-radius:12px;box-shadow:0 12px 40px #0000003d;padding:12px 14px;font-size:12px;line-height:1.5}",
			".dph-title{font-size:13px;font-weight:600;margin-bottom:2px}",
			".dph-sub{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-bottom:8px;word-break:break-word}",
			".dph-row{display:flex;justify-content:space-between;gap:10px;padding:2px 0}",
			".dph-k{color:var(--dsw-alias-label-tertiary);flex:none}",
			".dph-v{text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}",
			".dph-sep{border-top:1px solid var(--dsw-alias-border-l1);margin:8px 0}",
			".dph-sec{font-weight:600;color:var(--dsw-alias-label-secondary);margin:2px 0 4px}",
			".dph-toggle{display:flex;align-items:flex-start;gap:8px;cursor:pointer}",
			".dph-toggle input{margin:2px 0 0;cursor:pointer}",
			".dph-note{color:var(--dsw-alias-label-tertiary);margin-top:6px;font-size:11px;line-height:1.4}",
			".dph-warn-text{color:var(--dsw-alias-state-error-primary)}",
			".dph-ok-text{color:var(--dsw-alias-state-success-primary)}",
			".dph-win{color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:6px}",
			".dph-win-row{padding:1px 0}",
			".dph-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}",
			".dph-btn{font:inherit;font-size:11px;line-height:1.4;padding:3px 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;cursor:pointer}",
			".dph-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2))}",
			".dph-btn:disabled{opacity:.5;cursor:default}",
			".dph-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}",
			".dph-error{color:var(--dsw-alias-state-error-primary);font-size:11px;margin-top:6px}",
			".dph-banner{display:flex;align-items:center;gap:10px;flex-wrap:wrap;box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px));max-width:calc(var(--dsh-composer-card-max-width,952px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px));margin:6px auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:7px 12px;font-size:12px;line-height:1.4;background:var(--dsw-alias-bg-layer-1)}",
			".dph-banner-text{flex:1 1 auto;min-width:0}",
			".dph-banner-actions{display:flex;flex-wrap:wrap;gap:6px;margin-left:auto;flex:none}",
			".dph-banner-paused{border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, var(--dsw-alias-bg-layer-1))}",
			".dph-banner-peak{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, var(--dsw-alias-bg-layer-1))}",
			".dph-banner-allowed{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#d9a441) 50%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#d9a441) 10%, var(--dsw-alias-bg-layer-1))}",
			".dph-banner-warn{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#d9a441) 55%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#d9a441) 12%, var(--dsw-alias-bg-layer-1))}",
			".dph-banner-budget{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 50%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, var(--dsw-alias-bg-layer-1))}",
			".dph-banner-note{font-size:11px}",
			".dph-notice{display:flex;align-items:flex-start;gap:9px;box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px));max-width:calc(var(--dsh-composer-card-max-width,952px) - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px));margin:6px auto;border:1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary,#d9a441) 42%, var(--dsw-alias-border-l2));border-left:3px solid var(--dsw-alias-state-warn-primary,#d9a441);border-radius:10px;padding:8px 10px;font-size:12px;line-height:1.45;background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#d9a441) 7%, var(--dsw-alias-bg-layer-1))}",
			".dph-notice-icon{flex:none;font-size:13px;line-height:1.3}",
			".dph-notice-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}",
			".dph-notice-title{font-weight:600;font-size:12px;color:var(--dsw-alias-label-primary)}",
			".dph-notice-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary)}",
			".dph-notice-steps{margin-top:3px;display:flex;flex-direction:column;gap:1px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}",
			".dph-notice-actions{flex:none;display:flex;align-items:flex-start;gap:6px;padding-top:1px}",
			".dph-defer{font:inherit;font-size:11px;line-height:1.4;padding:3px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}",
			".dph-defer:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2))}",
			".dph-defer:disabled{opacity:.5;cursor:default}",
			".dph-defer-sent{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}",
			".dph-row-marker{display:inline-flex;align-items:center;gap:2px;font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary);opacity:.9}",
			".dph-row-marker-ico{font-style:normal}",
			".dph-turn{display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:1.3;color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
			".dph-settings{display:flex;flex-direction:column;gap:12px;font-size:13px;line-height:1.45}",
			".dph-settings-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}",
			".dph-settings-title{font-size:16px;font-weight:600}",
			".dph-settings-sub{color:var(--dsw-alias-label-tertiary);font-size:12px}",
			".dph-settings-actions{display:flex;gap:8px;flex-wrap:wrap}",
			".dph-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}",
			".dph-field{display:flex;flex-direction:column;gap:4px;min-width:0}",
			".dph-field-label{color:var(--dsw-alias-label-secondary);font-size:12px}",
			".dph-input{font:inherit;font-size:12px;line-height:1.4;padding:5px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;min-width:0}",
			".dph-input:disabled{opacity:.6}",
			".dph-check{display:flex;align-items:center;gap:6px;font-size:12px}",
			".dph-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}",
			".dph-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}",
			".dph-card-key{font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
			".dph-card-title{color:var(--dsw-alias-label-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:.04em}",
			".dph-windows{display:flex;flex-direction:column;gap:6px}",
			".dph-window-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
			".dph-time{width:92px;flex:none}",
			".dph-dash{color:var(--dsw-alias-label-tertiary)}",
			".dph-tz{width:170px;flex:1 1 140px}",
			".dph-days{display:flex;gap:3px;flex-wrap:wrap}",
			".dph-day{display:inline-flex;align-items:center;gap:2px;font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:1px 4px}",
			".dph-day input{margin:0}",
			".dph-add{font:inherit;font-size:11px;padding:3px 9px;border-radius:7px;border:1px dashed var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;align-self:flex-start}",
			".dph-add:hover{border-color:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));color:var(--dsw-alias-label-primary)}",
			".dph-remove{font:inherit;font-size:11px;padding:1px 6px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}",
			".dph-remove:hover{color:var(--dsw-alias-state-error-primary)}",
			".dph-model-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px}",
			".dph-model-head{display:flex;align-items:center;justify-content:space-between;gap:8px}",
			".dph-model-key{font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
			".dph-inline{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
			".dph-warnings{color:var(--dsw-alias-state-warn-primary,#d9a441);font-size:12px;display:flex;flex-direction:column;gap:2px}",
			".dph-hint{color:var(--dsw-alias-label-tertiary);font-size:11px}",
			".dph-schedules{display:flex;flex-direction:column;gap:8px}",
			".dph-holidays{display:flex;flex-direction:column;gap:6px}",
			".dph-textarea{resize:vertical;min-height:62px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}",
		].join("");
		const CSS_TAG = "dsh-peak-hours/client.css";
		try {
			if (typeof document !== "undefined" && document !== null
				&& typeof document.querySelector === "function"
				&& typeof document.createElement === "function"
				&& document.head !== null && document.head !== undefined
				&& document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") === null) {
				const tag = document.createElement("style");
				if (tag.dataset !== null && tag.dataset !== undefined) {
					tag.dataset.plugin = "dsh-peak-hours";
					tag.dataset.pluginCss = CSS_TAG;
				}
				if (typeof tag.setAttribute === "function") {
					tag.setAttribute("data-plugin", "dsh-peak-hours");
					tag.setAttribute("data-plugin-css", CSS_TAG);
				}
				tag.textContent = CSS;
				document.head.appendChild(tag);
			}
		} catch (error) {
			// Styles are a nicety; never take the plugin down for a DOM quirk.
		}
		//#endregion

		//#region constants
		/** Logical channel owned by the host half (lib/index.js). */
		const CHANNEL = "/dsh-peak-hours";
		/** Host snapshot poll cadence; countdowns tick locally between polls. */
		const POLL_MS = 20000;
		/** Local countdown tick. */
		const TICK_MS = 1000;
		/** How long the transient "deferred" confirmation stays visible. */
		const FLASH_MS = 4000;
		const NOOP = () => {};
		const MODE_LABELS = {
			pause: "pause — пауза сессий",
			hard: "hard — блокировка вызовов",
			warn: "warn — только предупреждение",
		};
		const STRATEGY_LABELS = {
			auto: "auto — по длине окна",
			hold: "hold — удержание шага",
			requeue: "requeue — перенос шага",
		};
		const BACKGROUND_LABELS = {
			allow: "allow — разрешать",
			warn: "warn — предупреждать",
			block: "block — блокировать",
		};
		const WEEKDAYS = [
			{ value: 1, short: "Пн", label: "понедельник" },
			{ value: 2, short: "Вт", label: "вторник" },
			{ value: 3, short: "Ср", label: "среда" },
			{ value: 4, short: "Чт", label: "четверг" },
			{ value: 5, short: "Пт", label: "пятница" },
			{ value: 6, short: "Сб", label: "суббота" },
			{ value: 0, short: "Вс", label: "воскресенье" },
		];
		//#endregion

		//#region time helpers
		/** Human time left: "12 мин" / "1 ч 20 мин" / "2 дн 3 ч". */
		function formatRemaining(totalSeconds) {
			if (totalSeconds === null || totalSeconds === undefined) return "—";
			const seconds = Number(totalSeconds);
			if (!Number.isFinite(seconds)) return "—";
			const positive = Math.max(0, seconds);
			if (positive === 0) return "0 мин";
			const min = Math.max(1, Math.round(positive / 60));
			if (min < 60) return min + " мин";
			const hours = Math.floor(min / 60);
			const rest = min % 60;
			if (hours < 24) return rest === 0 ? hours + " ч" : hours + " ч " + rest + " мин";
			const days = Math.floor(hours / 24);
			const restHours = hours % 24;
			return restHours === 0 ? days + " дн" : days + " дн " + restHours + " ч";
		}

		/** `HH:MM` in the browser's local time (optional explicit zone for display). */
		function formatClock(iso, tz) {
			if (iso === null || iso === undefined || iso === "") return null;
			const date = iso instanceof Date ? iso : new Date(iso);
			if (Number.isNaN(date.getTime())) return null;
			try {
				const options = { hour: "2-digit", minute: "2-digit", hour12: false };
				if (typeof tz === "string" && tz !== "") options.timeZone = tz;
				return new Intl.DateTimeFormat(undefined, options).format(date);
			} catch (error) {
				return null;
			}
		}

		function parseMs(value) {
			if (value === null || value === undefined || value === "") return null;
			if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
			const parsed = Date.parse(String(value));
			return Number.isFinite(parsed) ? parsed : null;
		}

		/** Seconds elapsed since the snapshot was fetched, judged by the host clock. */
		function elapsedSecondsSince(state) {
			if (state === null || state === undefined || typeof state !== "object") return 0;
			const fetched = typeof state.__fetchedAt === "number" ? state.__fetchedAt : null;
			const server = parseMs(state.serverTime);
			const at = fetched !== null ? fetched : server;
			if (at === null) return 0;
			return Math.max(0, (Date.now() - at) / 1000);
		}

		/**
		 * Seconds until the next boundary of the session (else aggregate):
		 * the peak end while in peak, the next start outside it. `null` when the
		 * host could not name a boundary.
		 */
		function countdownOf(state) {
			if (state === null || state === undefined || typeof state !== "object" || state.offline === true) return null;
			const session = isObject(state.session) ? state.session : null;
			const aggregate = isObject(state.aggregate) ? state.aggregate : null;
			const source = session !== null ? session : aggregate;
			if (source === null) return null;
			let base = null;
			if (typeof source.secondsToChange === "number" && Number.isFinite(source.secondsToChange)) base = source.secondsToChange;
			if (base === null) {
				const inPeak = source.inPeak === true;
				const boundary = inPeak
					? (asIso(source.untilAt) || (aggregate !== null ? asIso(aggregate.untilAt) : null))
					: (asIso(source.nextStartAt) || (aggregate !== null ? asIso(aggregate.nextStartAt) : null));
				const at = parseMs(boundary);
				const server = parseMs(state.serverTime);
				if (at !== null && server !== null) base = (at - server) / 1000;
			}
			if (base === null) return null;
			return Math.max(0, Math.round(base - elapsedSecondsSince(state)));
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
		 * A configured window rendered in the browser's own clock, so the schedule
		 * reads the same wherever the user is. Falls back to the configured label
		 * when the zone is unknown to Intl.
		 */
		function localWindowLabel(window) {
			if (window === null || window === undefined || typeof window !== "object") return "—";
			const tz = typeof window.tz === "string" && window.tz !== "" ? window.tz : "UTC";
			const start = typeof window.start === "string" ? window.start : "--:--";
			const end = typeof window.end === "string" ? window.end : "--:--";
			try {
				const now = new Date();
				const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
				const at = (hhmm) => {
					const guess = Date.parse(day + "T" + hhmm + ":00Z");
					if (!Number.isFinite(guess)) throw new Error("bad time");
					let timestamp = guess - tzOffsetMs(tz, new Date(guess));
					timestamp = guess - tzOffsetMs(tz, new Date(timestamp));
					const clock = formatClock(new Date(timestamp).toISOString());
					return clock === null ? hhmm : clock;
				};
				return at(start) + "–" + at(end);
			} catch (error) {
				return start + "–" + end + " " + tz;
			}
		}

		/**
		 * Every configured window, flattened for display, keeping its family key
		 * (and model key) so an unlabelled list never reads as a duplicate.
		 */
		function allWindowsOf(schedules) {
			const out = [];
			if (!isObject(schedules)) return out;
			for (const key of Object.keys(schedules)) {
				const entry = schedules[key];
				if (!isObject(entry)) continue;
				if (Array.isArray(entry.windows)) {
					for (const window of entry.windows) out.push({ key: key, modelKey: null, window: window });
				}
				if (isObject(entry.models)) {
					for (const modelKey of Object.keys(entry.models)) {
						const rule = entry.models[modelKey];
						if (!isObject(rule) || !Array.isArray(rule.windows)) continue;
						for (const window of rule.windows) out.push({ key: key, modelKey: modelKey, window: window });
					}
				}
			}
			return out;
		}

		function describeWindow(entry, withKey) {
			const label = localWindowLabel(entry.window);
			if (withKey !== true) return label;
			const family = typeof entry.key === "string" && entry.key !== "" ? entry.key : "?";
			const prefix = typeof entry.modelKey === "string" && entry.modelKey !== "" ? family + "/" + entry.modelKey : family;
			return prefix + ": " + label;
		}

		/** Holiday calendar carried by the first window that has one. */
		function holidaysOfWindows(windows) {
			if (!Array.isArray(windows)) return null;
			for (const entry of windows) {
				const holidays = isObject(entry) && isObject(entry.window) ? entry.window.holidays : null;
				if (isObject(holidays) && Array.isArray(holidays.ranges) && holidays.ranges.length > 0) {
					return { tz: typeof holidays.tz === "string" ? holidays.tz : "Asia/Shanghai", count: holidays.ranges.length };
				}
			}
			return null;
		}

		/** Windows worth listing for this snapshot: the session's effective ones, else every family. */
		function windowsFor(state, session) {
			if (session !== null && session.known === false) return allWindowsOf(state && state.schedules);
			if (session !== null && Array.isArray(session.effectiveWindows)) {
				return session.effectiveWindows.map((window) => ({
					key: typeof session.matchedKey === "string" ? session.matchedKey : (typeof session.provider === "string" ? session.provider : ""),
					modelKey: typeof session.modelKey === "string" ? session.modelKey : null,
					window: window,
				}));
			}
			return allWindowsOf(state && state.schedules);
		}

		function asIso(value) {
			if (value === null || value === undefined || value === "") return null;
			if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
			return String(value);
		}

		function isObject(value) {
			return value !== null && value !== undefined && typeof value === "object" && Array.isArray(value) === false;
		}

		function errorText(error) {
			if (error === null || error === undefined) return "неизвестная ошибка";
			if (error instanceof Error) return error.message;
			return String(error);
		}

		function errorMessageOf(result) {
			if (result === null || result === undefined) return "хост не ответил";
			const error = result.error;
			if (isObject(error)) {
				if (typeof error.message === "string" && error.message !== "") return error.message;
				if (typeof error.code === "string" && error.code !== "") return error.code;
			}
			return "хост не ответил";
		}

		function safeNumber(value) {
			const number = Number(value);
			return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
		}

		function clockAndCountdown(clock, seconds) {
			const parts = [];
			if (typeof clock === "string" && clock !== "") parts.push(clock);
			if (typeof seconds === "number" && Number.isFinite(seconds)) parts.push("через " + formatRemaining(seconds));
			return parts.length === 0 ? "—" : parts.join(" · ");
		}
		//#endregion

		//#region shared state layer
		/** Map the wire envelope once: `{ok:true,value}` / `{ok:false,error}` / transport failures. */
		function createRpcCall(connection) {
			return function rpcCall(endpoint, payload) {
				if (connection === null || connection === undefined || !isObject(connection.rpc) || typeof connection.rpc.call !== "function") {
					return Promise.resolve({ ok: false, error: { code: "no-connection", message: "connection service unavailable" } });
				}
				let request;
				try {
					request = connection.rpc.call(CHANNEL, endpoint, payload === undefined ? {} : payload);
				} catch (error) {
					return Promise.resolve({ ok: false, error: { code: "transport", message: errorText(error) } });
				}
				return Promise.resolve(request).then((result) => {
					if (isObject(result) && result.ok === true) return { ok: true, value: result.value };
					const error = isObject(result) && isObject(result.error) ? result.error : null;
					return {
						ok: false,
						error: {
							code: error !== null && typeof error.code === "string" ? error.code : "transport",
							message: error !== null && typeof error.message === "string" ? error.message : "empty response",
						},
					};
				}, (error) => ({ ok: false, error: { code: "transport", message: errorText(error) } }));
			};
		}

		/**
		 * One snapshot cache per session (`''` = the global view), one poller per
		 * cache key, and the React bindings the slot components consume.
		 *
		 * Session-scoped state never lives outside this cache: every reader goes
		 * through a cache entry, so a remounted component and a stale tab agree.
		 */
		function createPeakStore(rpcCall) {
			const cache = new Map();

			function keyOf(sessionId) {
				return typeof sessionId === "string" && sessionId !== "" ? sessionId : "";
			}

			function entryOf(key) {
				let entry = cache.get(key);
				if (entry === undefined) {
					entry = { key: key, state: null, fetchedAt: 0, inflight: null, timer: null, listeners: new Set() };
					cache.set(key, entry);
				}
				return entry;
			}

			function read(sessionId) {
				const entry = cache.get(keyOf(sessionId));
				return entry === undefined ? null : entry.state;
			}

			function notify(entry) {
				for (const listener of Array.from(entry.listeners)) {
					try {
						listener(entry.state);
					} catch (error) {
						// One broken subscriber must not stop the others.
					}
				}
			}

			function payloadFor(sessionId) {
				const key = keyOf(sessionId);
				return key === "" ? {} : { sessionId: key };
			}

			/** Refresh one cache key; concurrent callers share the in-flight promise. */
			function refresh(sessionId) {
				const key = keyOf(sessionId);
				const entry = entryOf(key);
				if (entry.inflight !== null) return entry.inflight;
				const payload = payloadFor(sessionId);
				const request = Promise.resolve()
					.then(() => rpcCall("state", payload))
					.then((result) => {
						entry.inflight = null;
						if (isObject(result) && result.ok === true) entry.state = result.value;
						else {
							entry.state = {
								offline: true,
								error: isObject(result) && isObject(result.error) ? result.error : { code: "transport", message: "no reply" },
							};
						}
						entry.fetchedAt = Date.now();
						notify(entry);
						return entry.state;
					}, (error) => {
						entry.inflight = null;
						entry.state = { offline: true, error: { code: "transport", message: errorText(error) } };
						entry.fetchedAt = Date.now();
						notify(entry);
						return entry.state;
					});
				entry.inflight = request;
				return request;
			}

			/**
			 * Subscribe to one cache key: the first subscriber starts the 20 s poll,
			 * the last one stops it; every fresh subscription asks the host once.
			 */
			function subscribe(sessionId, listener) {
				const key = keyOf(sessionId);
				const entry = entryOf(key);
				entry.listeners.add(listener);
				if (entry.listeners.size === 1 && entry.timer === null) {
					entry.timer = setInterval(() => {
						void refresh(sessionId);
					}, POLL_MS);
					if (entry.timer !== null && entry.timer !== undefined && typeof entry.timer.unref === "function") entry.timer.unref();
				}
				void refresh(sessionId);
				return function unsubscribe() {
					entry.listeners.delete(listener);
					if (entry.listeners.size === 0 && entry.timer !== null) {
						clearInterval(entry.timer);
						entry.timer = null;
					}
				};
			}

			function usePeakState(sessionId) {
				const [state, setState] = react.useState(() => read(sessionId));
				react.useEffect(() => {
					let alive = true;
					const apply = (next) => {
						if (alive === true) setState(next);
					};
					apply(read(sessionId));
					const unsubscribe = subscribe(sessionId, apply);
					return () => {
						alive = false;
						unsubscribe();
					};
				}, [sessionId]);
				return {
					state: state,
					refresh: () => refresh(sessionId),
				};
			}

			return { usePeakState: usePeakState, refresh: refresh, read: read, subscribe: subscribe };
		}

		/** Local 1 s countdown: never negative, `null` when the host named no boundary. */
		function useCountdown(state) {
			const [, setTick] = react.useState(0);
			react.useEffect(() => {
				if (state === null || state === undefined || typeof state !== "object" || state.offline === true) return undefined;
				const timer = setInterval(() => setTick((value) => value + 1), TICK_MS);
				if (timer !== null && timer !== undefined && typeof timer.unref === "function") timer.unref();
				return () => clearInterval(timer);
			}, [state]);
			return countdownOf(state);
		}
		//#endregion

		//#region defensive prop readers
		function readPeak(props, sessionId) {
			const hook = props !== null && props !== undefined ? props.usePeakState : undefined;
			if (typeof hook === "function") {
				try {
					const result = hook(sessionId);
					if (result !== null && result !== undefined && typeof result === "object" && "state" in result) {
						return {
							state: result.state === undefined ? null : result.state,
							refresh: typeof result.refresh === "function" ? result.refresh : NOOP,
						};
					}
					return { state: result === undefined ? null : result, refresh: NOOP };
				} catch (error) {
					return { state: null, refresh: NOOP };
				}
			}
			return { state: null, refresh: NOOP };
		}

		function readCountdown(props, state) {
			const hook = props !== null && props !== undefined ? props.useCountdown : undefined;
			if (typeof hook === "function") {
				try {
					const value = hook(state);
					return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
				} catch (error) {
					return countdownOf(state);
				}
			}
			return countdownOf(state);
		}

		/** Draft / phase / attachment count through the session input hook (primitives only). */
		function readInputParts(props) {
			const useInput = props !== null && props !== undefined ? props.useInput : undefined;
			if (typeof useInput !== "function") return { draft: "", phase: "plain", images: 0 };
			let draft = "";
			let phase = "plain";
			let images = 0;
			try {
				const value = useInput((state) => (isObject(state) && typeof state.draft === "string" ? state.draft : ""));
				draft = typeof value === "string" ? value : "";
			} catch (error) {
				draft = "";
			}
			try {
				const value = useInput((state) => (isObject(state) && typeof state.phase === "string" ? state.phase : "plain"));
				phase = typeof value === "string" ? value : "plain";
			} catch (error) {
				phase = "plain";
			}
			try {
				const value = useInput((state) => {
					if (!isObject(state)) return 0;
					if (Array.isArray(state.imageIds)) return state.imageIds.length;
					if (Array.isArray(state.attachmentIds)) return state.attachmentIds.length;
					return 0;
				});
				images = typeof value === "number" && Number.isFinite(value) ? value : 0;
			} catch (error) {
				images = 0;
			}
			return { draft: draft, phase: phase, images: images };
		}

		function readSubagent(props) {
			const useSession = props !== null && props !== undefined ? props.useSession : undefined;
			if (typeof useSession !== "function") return false;
			try {
				const value = useSession((snapshot) => isObject(snapshot) && snapshot.subagent !== null && snapshot.subagent !== undefined);
				return value === true;
			} catch (error) {
				return false;
			}
		}

		function readProjection(props, key) {
			const useProjection = props !== null && props !== undefined ? props.useProjection : undefined;
			if (typeof useProjection !== "function") return undefined;
			try {
				return useProjection(key);
			} catch (error) {
				return undefined;
			}
		}

		function sessionOf(state) {
			if (!isObject(state)) return null;
			return isObject(state.session) ? state.session : null;
		}

		/**
		 * The first-generation host answered `state` with `{enabled, mode, allowPeak,
		 * peak, until, secondsToChange, schedules}` only. A new client talking to
		 * that host must say so instead of silently rendering half-filled controls
		 * ("без лимита", "—", "pause").
		 */
		function isLegacyHost(state) {
			if (!isObject(state) || state.offline === true) return false;
			return state.serverTime === undefined
				&& state.aggregate === undefined
				&& state.stats === undefined
				&& state.limit === undefined;
		}

		function modelLineOf(session, selection) {
			if (session !== null) {
				const provider = typeof session.provider === "string" && session.provider !== "" ? session.provider : null;
				const model = typeof session.model === "string" && session.model !== "" ? session.model : null;
				const displayName = typeof session.modelName === "string" && session.modelName !== "" ? session.modelName : model;
				if (provider !== null) return displayName === null ? provider + " · модель не указана" : provider + " · " + displayName;
			}
			const next = isObject(selection) ? (isObject(selection.next) ? selection.next : selection) : null;
			if (next !== null && typeof next.provider === "string" && next.provider !== "") {
				return typeof next.model === "string" && next.model !== "" ? next.provider + " · " + next.model : next.provider;
			}
			return "модель ещё не выбрана";
		}

		function modeLabel(mode) {
			return typeof mode === "string" && MODE_LABELS[mode] !== undefined ? MODE_LABELS[mode] : "pause — пауза сессий";
		}

		function strategyLabel(strategy) {
			return typeof strategy === "string" && STRATEGY_LABELS[strategy] !== undefined ? STRATEGY_LABELS[strategy] : STRATEGY_LABELS.auto;
		}

		function backgroundLabel(policy) {
			return typeof policy === "string" && BACKGROUND_LABELS[policy] !== undefined ? BACKGROUND_LABELS[policy] : BACKGROUND_LABELS.allow;
		}

		function budgetText(state) {
			const limit = isObject(state) && isObject(state.limit) ? state.limit : null;
			if (limit === null) return "без лимита";
			const daily = typeof limit.dailyMinutes === "number" && Number.isFinite(limit.dailyMinutes) ? limit.dailyMinutes : null;
			if (daily === null) return "без лимита";
			const used = Math.max(0, Math.round((Number(limit.usedSeconds) || 0) / 60));
			return used + " / " + daily + " мин" + (limit.exhausted === true ? " — исчерпан" : "");
		}
		//#endregion

		//#region pill (conversation.session.header.utilities)
		function infoRow(key, label, value, warn) {
			return h("div", { className: "dph-row", key: key }, [
				h("span", { className: "dph-k", key: "k" }, label),
				h("span", { className: "dph-v" + (warn === true ? " dph-warn-text" : ""), key: "v" }, value),
			]);
		}

		function renderWindowsSummary(windows, known, state) {
			if (!Array.isArray(windows) || windows.length === 0) {
				const configured = allWindowsOf(state && state.schedules).length;
				return h("div", { className: "dph-win", key: "windows" }, configured > 0 ? "Окна не заданы для этой модели" : "Окна пиковых часов не заданы");
			}
			// Two providers can peak in the same local clock (DeepSeek 06:00-10:00 UTC
			// and GLM 14:00-18:00 Beijing are 08:00-12:00 in Johannesburg), so an
			// unlabelled list reads as a duplicate. Label whenever more than one
			// family/route is on screen.
			const families = new Set(windows.map((entry) => (isObject(entry) && typeof entry.key === "string" && entry.key !== "" ? entry.key : "?")));
			const withKey = known === false || families.size > 1;
			const lines = windows.map((entry, index) => h("div", {
				className: "dph-win-row",
				key: "window-" + index,
			}, describeWindow(entry, withKey)));
			const block = h("div", { className: "dph-win", key: "windows" }, [h("div", { key: "heading" }, "Окна (твоё время)")].concat(lines));
			const holidays = holidaysOfWindows(windows);
			if (holidays === null) return block;
			return h("div", { key: "windows-wrap" }, [
				block,
				h("div", { className: "dph-note", key: "holidays" }, "Праздники-исключения: " + holidays.tz + " · " + holidays.count + " диапаз."),
			]);
		}

		/** Popover body (a plain builder: it owns no hooks, only the open popover renders it). */
		function popoverChildren(model) {
			const children = [];
			const stats = isObject(model.state) && isObject(model.state.stats) ? model.state.stats : {};
			children.push(h("div", { className: "dph-title", key: "title" }, "Пиковые часы"));
			children.push(h("div", { className: "dph-sub", key: "model" }, modelLineOf(model.session, model.selection)));
			if (model.legacy === true) {
				children.push(h("div", { className: "dph-note dph-warn-text", key: "legacy" }, "Клиент обновлён, а хост-половина — старой версии. Перезапустите dsh web: пауза, дневной бюджет, окна по модели и отложенная отправка включатся после рестарта."));
				const legacyPeak = isObject(model.state) && model.state.peak === true;
				const legacySeconds = isObject(model.state) && typeof model.state.secondsToChange === "number" ? model.state.secondsToChange : null;
				const legacyUntil = isObject(model.state) && typeof model.state.until === "string" && model.state.until !== "" ? model.state.until : null;
				children.push(infoRow("now", "Сейчас", legacyPeak === true ? "пик" : "не пик", legacyPeak === true));
				children.push(infoRow(
					"boundary",
					legacyPeak === true ? "Конец пика" : "Начало пика",
					legacyPeak === true
						? (legacyUntil !== null ? legacyUntil : "—")
						: (legacySeconds !== null ? "через " + formatRemaining(legacySeconds) : "—"),
				));
				children.push(renderWindowsSummary(model.windows, model.known, model.state));
				return children;
			}
			children.push(infoRow("now", "Сейчас", model.offline === true ? "нет связи с хостом" : model.inPeak === true ? "пик" : "не пик", model.inPeak === true));
			children.push(infoRow(
				"boundary",
				model.inPeak === true ? "Конец пика" : "Начало пика",
				model.offline === true ? "—" : clockAndCountdown(model.boundaryClock, model.left),
				model.inPeak === true && model.allowed !== true,
			));
			children.push(infoRow("gate", "Гейт", modeLabel(model.mode), model.mode === "hard" && model.inPeak === true));
			children.push(infoRow("strategy", "Режим pause", strategyLabel(model.strategy)));
			children.push(infoRow("budget", "Бюджет пика", budgetText(model.state)));
			if (model.deferredCount > 0) children.push(infoRow("deferred", "Отложено сообщений", String(model.deferredCount)));
			children.push(h("div", { className: "dph-sep", key: "sep-allow" }));
			children.push(h("label", { className: "dph-toggle", key: "allow" }, [
				h("input", {
					key: "checkbox",
					type: "checkbox",
					checked: model.allowed === true,
					disabled: model.busy === true || model.offline === true || model.allowSource === "limit",
					onChange: model.onToggleAllow,
				}),
				h("span", { key: "label" }, "Разрешить работу в peak hours"),
			]));
			if (model.allowSource === "limit") {
				children.push(h("div", { className: "dph-note dph-warn-text", key: "limit-note" }, "дневной бюджет исчерпан"));
			}
			const buttons = [];
			if (model.inPeak === true && (model.paused === true || model.allowed !== true)) {
				buttons.push(h("button", {
					key: "resume",
					type: "button",
					className: "dph-btn dph-btn-primary",
					disabled: model.busy === true || model.offline === true,
					onClick: model.onResume,
				}, "Продолжить сейчас"));
			}
			if (model.inPeak === true && model.allowed === true) {
				buttons.push(h("button", {
					key: "pause",
					type: "button",
					className: "dph-btn",
					disabled: model.busy === true || model.offline === true,
					onClick: model.onPause,
				}, "На паузу"));
			}
			if (buttons.length > 0) children.push(h("div", { className: "dph-actions", key: "buttons" }, buttons));
			children.push(renderWindowsSummary(model.windows, model.known, model.state));
			children.push(h("div", { className: "dph-sep", key: "sep-savings" }));
			children.push(h("div", { className: "dph-sec", key: "savings-title" }, "Сэкономлено (оценка)"));
			children.push(h("div", { className: "dph-note", key: "saved-tokens" }, "≈ " + safeNumber(stats.savedTokensEstimate) + " токенов"));
			children.push(infoRow("held-steps", "шагов отложено", String(safeNumber(stats.heldSteps))));
			children.push(infoRow("deferred-stats", "сообщений отложено", String(safeNumber(stats.deferredMessages))));
			children.push(infoRow("paused-stats", "пауз", formatRemaining(safeNumber(stats.pausedSeconds))));
			children.push(h("div", { className: "dph-note", key: "peak-usage" }, "Пик-вызовов: " + safeNumber(stats.peakCalls) + " · токенов в пик: " + safeNumber(stats.peakTokens)));
			if (typeof model.error === "string" && model.error !== "") children.push(h("div", { className: "dph-error", key: "error" }, model.error));
			if (model.offline === true) {
				children.push(h("div", { className: "dph-note", key: "offline-note" }, "Хост-половина не ответила. Если dsh web только что обновлён, перезапустите его: гейт и расписание живут на хосте."));
			}
			return children;
		}

		function PeakHoursPill(props) {
			const sessionId = props !== null && props !== undefined ? props.sessionId : undefined;
			const rpcCall = props !== null && props !== undefined ? props.rpcCall : undefined;
			const peak = readPeak(props, sessionId);
			const state = peak.state;
			const refresh = peak.refresh;
			const left = readCountdown(props, state);
			const [open, setOpen] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState("");
			const rootRef = react.useRef(null);
			const subagent = readSubagent(props);
			const selection = readProjection(props, "modelSelection");

			react.useEffect(() => {
				if (open !== true || typeof document === "undefined" || document === null) return undefined;
				const onDown = (event) => {
					const root = rootRef.current;
					if (root !== null && root !== undefined && typeof root.contains === "function") {
						if (root.contains(event.target) !== true) setOpen(false);
					} else {
						setOpen(false);
					}
				};
				const onKey = (event) => {
					if (event !== null && event !== undefined && event.key === "Escape") setOpen(false);
				};
				document.addEventListener("mousedown", onDown);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("mousedown", onDown);
					document.removeEventListener("keydown", onKey);
				};
			}, [open]);

			if (subagent === true) return null;

			const session = sessionOf(state);
			const offline = state === null || state === undefined || state.offline === true;
			const legacy = isLegacyHost(state);
			const aggregate = isObject(state) && isObject(state.aggregate) ? state.aggregate : null;
			const inPeak = session !== null ? session.inPeak === true : aggregate !== null && aggregate.inPeak === true;
			const known = session !== null ? session.known !== false : allWindowsOf(state && state.schedules).length > 0;
			const paused = session !== null && session.paused === true;
			const allowed = session !== null ? session.allow === true : isObject(state) && isObject(state.settings) && state.settings.allowPeakDefault === true;
			const allowSource = session !== null && typeof session.allowSource === "string" ? session.allowSource : "default";
			const mode = (session !== null && typeof session.mode === "string" ? session.mode : null)
				|| (isObject(state) && typeof state.mode === "string" ? state.mode : "pause");
			const strategy = isObject(state) && typeof state.pauseStrategy === "string" ? state.pauseStrategy : "auto";
			const warningMinutes = isObject(state) && isObject(state.settings) && Number.isFinite(Number(state.settings.prePeakWarningMinutes))
				? Number(state.settings.prePeakWarningMinutes)
				: 10;
			const untilClock = formatClock(session !== null ? (session.pausedUntil || session.untilAt) : aggregate !== null ? aggregate.untilAt : null);
			const nextClock = formatClock(session !== null ? session.nextStartAt : aggregate !== null ? aggregate.nextStartAt : null);
			const nearStart = inPeak !== true && offline !== true && left !== null && left > 0 && left <= warningMinutes * 60;
			const windows = windowsFor(state, session);
			const deferredCount = session !== null && Number.isFinite(Number(session.deferredCount)) ? Math.max(0, Number(session.deferredCount)) : 0;

			let text;
			let className = "dph-pill";
			if (offline === true) {
				text = "пик — нет связи";
				className += " dph-offline";
			} else if (legacy === true) {
				text = "хост не перезапущен";
				className += " dph-muted";
			} else if (inPeak === true && paused === true) {
				text = untilClock !== null ? "на паузе до " + untilClock : "на паузе";
				className += " dph-paused";
			} else if (inPeak === true && allowed === true) {
				text = "пик · разрешено";
				className += " dph-allowed";
			} else if (inPeak === true) {
				text = left !== null ? "конец пика через " + formatRemaining(left) : "пик идёт";
				className += " dph-on";
			} else if (known !== true) {
				text = "пик: окна не заданы";
				className += " dph-muted";
			} else if (nearStart === true) {
				text = left !== null ? "пик через " + formatRemaining(left) : "пик скоро";
				className += " dph-soon";
			} else if (left !== null) {
				text = "пик через " + formatRemaining(left);
			} else {
				text = "пик не в ближайшее время";
				className += " dph-muted";
			}

			const callHost = (endpoint, extra) => {
				if (busy === true || offline === true) return Promise.resolve(null);
				setBusy(true);
				setError("");
				const payload = Object.assign({}, extra || {});
				if (typeof sessionId === "string" && sessionId !== "") payload.sessionId = sessionId;
				return Promise.resolve()
					.then(() => (typeof rpcCall === "function" ? rpcCall(endpoint, payload) : Promise.resolve({ ok: false, error: { code: "no-connection", message: "connection service unavailable" } })))
					.then((result) => {
						setBusy(false);
						if (isObject(result) && result.ok === true) {
							refresh();
							return result;
						}
						setError(errorMessageOf(result));
						return null;
					}, (failure) => {
						setBusy(false);
						setError(errorText(failure));
						return null;
					});
			};

			const popover = open === true ? h("div", { className: "dph-pop", role: "dialog", "aria-label": "Пиковые часы" }, popoverChildren({
				state: state,
				session: session,
				selection: selection,
				offline: offline,
				inPeak: inPeak,
				left: left,
				paused: paused,
				allowed: allowed,
				allowSource: allowSource,
				mode: mode,
				strategy: strategy,
				known: known,
				legacy: legacy,
				windows: windows,
				deferredCount: deferredCount,
				boundaryClock: inPeak === true ? untilClock : nextClock,
				busy: busy,
				error: error,
				onToggleAllow: () => {
					void callHost("set-allow-peak", { allowPeak: allowed !== true });
				},
				onResume: () => {
					void callHost("resume-now");
				},
				onPause: () => {
					void callHost("pause-now");
				},
			})) : null;

			return h("span", { className: "dph-wrap", ref: rootRef }, [
				h("button", {
					key: "pill",
					type: "button",
					className: className,
					title: legacy === true
						? "Клиент обновлён, хост-половина не перезапущена — нажми, чтобы увидеть подсказку"
						: "Пиковые часы — нажми, чтобы открыть настройки",
					"aria-label": text,
					"aria-expanded": open === true,
					onClick: () => setOpen((value) => value !== true),
				}, [
					h("span", { className: "dph-dot", key: "dot" }),
					h("span", { key: "text" }, text),
				]),
				popover,
			]);
		}
		//#endregion

		//#region defer button (conversation.input.right)
		function PeakDeferButton(props) {
			const sessionId = props !== null && props !== undefined ? props.sessionId : undefined;
			const rpcCall = props !== null && props !== undefined ? props.rpcCall : undefined;
			const actions = props !== null && props !== undefined ? props.inputActions : undefined;
			const peak = readPeak(props, sessionId);
			const state = peak.state;
			const refresh = peak.refresh;
			const input = readInputParts(props);
			const [busy, setBusy] = react.useState(false);
			const [flash, setFlash] = react.useState(null);
			const [error, setError] = react.useState("");
			const draftRef = react.useRef(input.draft);
			draftRef.current = input.draft;
			const subagent = readSubagent(props);

			if (subagent === true) return null;

			const session = sessionOf(state);
			const offline = state === null || state === undefined || state.offline === true;
			const liveSession = typeof sessionId === "string" && sessionId !== "";
			if (offline === true || liveSession !== true || session === null) return null;
			if (session.inPeak !== true || isObject(state) === false || state.canDefer !== true) return null;

			const text = typeof input.draft === "string" ? input.draft : "";
			const hasAttachments = input.images > 0;
			const disabledReason = error !== ""
				? error
				: hasAttachments
					? "вложения не переносятся в отложенное сообщение"
					: input.phase !== "plain"
						? "дождись завершения отправки"
						: text.trim() === ""
							? "сначала набери текст сообщения"
							: "";
			const disabled = busy === true || disabledReason !== "" || typeof rpcCall !== "function";
			const until = formatClock(session.untilAt);
			const label = busy === true ? "…" : flash !== null ? "✓ отложено на " + flash : until !== null ? "⏰ до " + until : "⏰ отложить";
			const title = error !== "" ? error : hasAttachments ? disabledReason : "Отложить сообщение до конца пика";

			const defer = () => {
				if (disabled === true) return Promise.resolve(null);
				const submitted = text;
				setBusy(true);
				setError("");
				const payload = { sessionId: sessionId, text: submitted };
				if (typeof session.provider === "string" && session.provider !== "") payload.provider = session.provider;
				if (typeof session.model === "string" && session.model !== "") payload.model = session.model;
				return Promise.resolve()
					.then(() => rpcCall("defer", payload))
					.then((result) => {
						setBusy(false);
						if (isObject(result) && result.ok === true) {
							if (draftRef.current === submitted && isObject(actions) && typeof actions.setDraft === "function") actions.setDraft("");
							const value = isObject(result.value) ? result.value : {};
							const clock = formatClock(value.scheduledAt) || formatClock(value.peakEndsAt) || until;
							setFlash(clock !== null ? clock : "конца пика");
							refresh();
							const timer = setTimeout(() => setFlash(null), FLASH_MS);
							if (timer !== null && timer !== undefined && typeof timer.unref === "function") timer.unref();
						} else {
							setError(errorMessageOf(result));
						}
						return result;
					}, (failure) => {
						setBusy(false);
						setError(errorText(failure));
						return null;
					});
			};

			return h("button", {
				type: "button",
				className: "dph-defer" + (flash !== null ? " dph-defer-sent" : ""),
				title: title,
				disabled: disabled === true,
				"aria-label": "Отложить сообщение до конца пика",
				onClick: defer,
			}, label);
		}
		//#endregion

		/**
		 * Compact, dismissible "host half is stale" notice.
		 *
		 * Deliberately not a full-width text wall: title + one muted line, with
		 * "Что сделать?" expanding the restart steps and "Скрыть" leaving only the
		 * header pill as the reminder for the rest of this page session.
		 */
		function LegacyHostNotice() {
			const [dismissed, setDismissed] = react.useState(false);
			const [expanded, setExpanded] = react.useState(false);
			if (dismissed === true) return null;
			return h("div", {
				className: "dph-notice",
				key: "legacy-notice",
				role: "status",
				"aria-live": "polite",
			}, [
				h("span", { className: "dph-notice-icon", key: "icon", "aria-hidden": "true" }, "⚠"),
				h("div", { className: "dph-notice-body", key: "body" }, [
					h("div", { className: "dph-notice-title", key: "title" }, "Хост-половина плагина не перезапущена"),
					h("div", { className: "dph-notice-hint", key: "hint" }, "Пауза, дневной бюджет, окна по модели и отложенная отправка начнут работать после рестарта dsh web."),
					expanded === true ? h("div", { className: "dph-notice-steps", key: "steps" }, [
						h("div", { key: "step-1" }, "1. Перезапустите процесс dsh web, который обслуживает этот интерфейс."),
						h("div", { key: "step-2" }, "2. Обновите страницу — предупреждение исчезнет."),
						h("div", { key: "step-3" }, "Индикатор в шапке сессии продолжит показывать статус пика."),
					]) : null,
				]),
				h("div", { className: "dph-notice-actions", key: "actions" }, [
					h("button", {
						key: "steps",
						type: "button",
						className: "dph-btn",
						"aria-expanded": expanded === true,
						onClick: () => setExpanded((value) => value !== true),
					}, expanded === true ? "Свернуть" : "Что сделать?"),
					h("button", {
						key: "dismiss",
						type: "button",
						className: "dph-btn",
						title: "Скрыть предупреждение до перезагрузки страницы",
						onClick: () => setDismissed(true),
					}, "Скрыть"),
				]),
			]);
		}

		//#region banner (conversation.input.dock)
		function PeakBanner(props) {
			const sessionId = props !== null && props !== undefined ? props.sessionId : undefined;
			const rpcCall = props !== null && props !== undefined ? props.rpcCall : undefined;
			const actions = props !== null && props !== undefined ? props.inputActions : undefined;
			const peak = readPeak(props, sessionId);
			const state = peak.state;
			const refresh = peak.refresh;
			const left = readCountdown(props, state);
			const input = readInputParts(props);
			const [busy, setBusy] = react.useState(null);
			const [error, setError] = react.useState("");
			const [flash, setFlash] = react.useState(null);
			const draftRef = react.useRef(input.draft);
			draftRef.current = input.draft;
			const subagent = readSubagent(props);

			const session = sessionOf(state);
			const offline = state === null || state === undefined || state.offline === true;
			const legacy = isLegacyHost(state);
			const inPeak = session !== null && session.inPeak === true;
			const paused = session !== null && session.paused === true;
			const allowed = session !== null && session.allow === true;
			const mode = (session !== null && typeof session.mode === "string" ? session.mode : null)
				|| (isObject(state) && typeof state.mode === "string" ? state.mode : "pause");
			const warningMinutes = isObject(state) && isObject(state.settings) && Number.isFinite(Number(state.settings.prePeakWarningMinutes))
				? Number(state.settings.prePeakWarningMinutes)
				: 10;
			const warning = offline !== true
				&& session !== null
				&& inPeak !== true
				&& session.known !== false
				&& left !== null
				&& left > 0
				&& left <= warningMinutes * 60;
			const warningKey = warning === true && session !== null
				? String(session.id || sessionId || "") + "|" + String(session.nextStartAt || "")
				: "";
			const notifiedRef = react.useRef("");

			react.useEffect(() => {
				if (warningKey === "") return undefined;
				if (notifiedRef.current === warningKey) return undefined;
				notifiedRef.current = warningKey;
				try {
					if (typeof Notification === "undefined" || Notification === null || Notification.permission !== "granted") return undefined;
					if (typeof document === "undefined" || document === null || document.hidden !== true) return undefined;
					const note = new Notification("Пиковые часы", {
						body: "Пик начнётся через " + formatRemaining(left) + ". Долгие задачи встанут на паузу.",
					});
					if (note !== null && note !== undefined && typeof note.close === "function") {
						const timer = setTimeout(() => note.close(), 8000);
						if (timer !== null && timer !== undefined && typeof timer.unref === "function") timer.unref();
					}
				} catch (failure) {
					// Notifications are a nicety; the row already carries the warning.
				}
				return undefined;
			}, [warningKey]);

			if (subagent === true) return null;
			if (offline === true) return null;
			if (legacy === true) return h(LegacyHostNotice, { key: "legacy" });
			if (session === null) return null;

			const limit = isObject(state) && isObject(state.limit) ? state.limit : null;
			const exhausted = limit !== null && limit.exhausted === true;
			const untilClock = formatClock(session.pausedUntil || session.untilAt);
			const draftText = typeof input.draft === "string" ? input.draft : "";
			const canDeferDraft = isObject(state)
				&& state.canDefer === true
				&& draftText.trim() !== ""
				&& input.phase === "plain"
				&& input.images === 0;
			const deferReason = input.images > 0
				? "вложения не переносятся в отложенное сообщение"
				: input.phase !== "plain"
					? "дождись завершения отправки"
					: draftText.trim() === ""
						? "набери черновик, чтобы отложить его"
						: isObject(state) && state.canDefer !== true
							? "хост не может создавать задачи"
							: "";

			const runHost = (endpoint) => {
				if (busy !== null) return Promise.resolve(null);
				setBusy(endpoint);
				setError("");
				return Promise.resolve()
					.then(() => (typeof rpcCall === "function" ? rpcCall(endpoint, { sessionId: sessionId }) : Promise.resolve({ ok: false, error: { code: "no-connection", message: "connection service unavailable" } })))
					.then((result) => {
						setBusy(null);
						if (isObject(result) && result.ok === true) {
							refresh();
							return result;
						}
						setError(errorMessageOf(result));
						return null;
					}, (failure) => {
						setBusy(null);
						setError(errorText(failure));
						return null;
					});
			};

			const deferDraft = () => {
				if (busy !== null || canDeferDraft !== true || typeof rpcCall !== "function") return Promise.resolve(null);
				const submitted = draftText;
				setBusy("defer");
				setError("");
				const payload = { sessionId: sessionId, text: submitted };
				if (typeof session.provider === "string" && session.provider !== "") payload.provider = session.provider;
				if (typeof session.model === "string" && session.model !== "") payload.model = session.model;
				return Promise.resolve()
					.then(() => rpcCall("defer", payload))
					.then((result) => {
						setBusy(null);
						if (isObject(result) && result.ok === true) {
							if (draftRef.current === submitted && isObject(actions) && typeof actions.setDraft === "function") actions.setDraft("");
							const value = isObject(result.value) ? result.value : {};
							setFlash(formatClock(value.scheduledAt) || formatClock(value.peakEndsAt) || untilClock || "конца пика");
							refresh();
							const timer = setTimeout(() => setFlash(null), FLASH_MS);
							if (timer !== null && timer !== undefined && typeof timer.unref === "function") timer.unref();
						} else {
							setError(errorMessageOf(result));
						}
						return result;
					}, (failure) => {
						setBusy(null);
						setError(errorText(failure));
						return null;
					});
			};

			const hasDraftContent = draftText.trim() !== "" || input.images > 0;
			const remainingSuffix = left !== null && left > 0 ? " (ещё " + formatRemaining(left) + ")" : "";
			const nextClock = formatClock(session.nextStartAt);
			const showDefer = isObject(state)
				&& state.canDefer === true
				&& (canDeferDraft === true || hasDraftContent || input.phase !== "plain");
			const deferAction = () => h("button", {
				key: "defer",
				type: "button",
				className: "dph-btn",
				disabled: busy !== null || canDeferDraft !== true,
				title: canDeferDraft === true ? "Отложить черновик до конца пика" : deferReason,
				onClick: () => {
					void deferDraft();
				},
			}, "Отложить");

			let text = null;
			let tone = "";
			const buttons = [];
			if (inPeak === true && paused === true) {
				tone = "paused";
				text = "⏸ Пик" + (untilClock !== null ? " до " + untilClock : "") + remainingSuffix + " — сессия на паузе";
				buttons.push(h("button", {
					key: "resume",
					type: "button",
					className: "dph-btn dph-btn-primary",
					disabled: busy !== null,
					onClick: () => {
						void runHost("resume-now");
					},
				}, "Продолжить сейчас"));
				if (showDefer === true) buttons.push(deferAction());
			} else if (exhausted === true) {
				tone = "budget";
				const minutes = limit !== null && typeof limit.dailyMinutes === "number" ? limit.dailyMinutes : null;
				text = "⛔ Дневной бюджет пикового времени исчерпан"
					+ (minutes !== null ? " (" + minutes + " мин)" : "")
					+ (untilClock !== null ? " · пик до " + untilClock : "");
			} else if (inPeak === true && allowed !== true && mode === "pause") {
				tone = "paused";
				text = "🌙 Пиковые часы" + (untilClock !== null ? " до " + untilClock : "") + remainingSuffix;
				buttons.push(h("button", {
					key: "allow",
					type: "button",
					className: "dph-btn dph-btn-primary",
					disabled: busy !== null,
					title: "Разрешить работу в пик до конца текущего окна",
					onClick: () => {
						void runHost("resume-now");
					},
				}, "Разрешить сейчас"));
				if (showDefer === true) buttons.push(deferAction());
			} else if (inPeak === true && allowed !== true && mode === "hard") {
				tone = "peak";
				text = "⛔ Пик" + (untilClock !== null ? " до " + untilClock : "") + remainingSuffix + " — вызовы блокируются";
				if (showDefer === true) buttons.push(deferAction());
			} else if (inPeak === true && allowed === true) {
				tone = "allowed";
				const budgetMinutes = limit !== null && typeof limit.remainingSeconds === "number" && Number.isFinite(limit.remainingSeconds)
					? Math.max(0, Math.ceil(limit.remainingSeconds / 60))
					: null;
				text = "🌙 Пик разрешён" + (untilClock !== null ? " до " + untilClock : "") + remainingSuffix + " — работа идёт по пиковому тарифу"
					+ (budgetMinutes !== null && typeof limit.dailyMinutes === "number" ? " · бюджет пика " + budgetMinutes + " мин" : "");
				buttons.push(h("button", {
					key: "pause",
					type: "button",
					className: "dph-btn",
					disabled: busy !== null,
					title: "Запретить работу в пик для этой сессии",
					onClick: () => {
						void runHost("pause-now");
					},
				}, "Поставить на паузу"));
			} else if (warning === true) {
				tone = "warn";
				text = "⚠️ Пик начнётся через " + formatRemaining(left)
					+ (nextClock !== null ? " (в " + nextClock + ")" : "")
					+ " — долгие задачи встанут на паузу";
			} else {
				return null;
			}

			return h("div", { className: "dph-banner dph-banner-" + tone, role: "status" }, [
				h("span", { className: "dph-banner-text", key: "text" }, text),
				buttons.length > 0 ? h("span", { className: "dph-banner-actions", key: "actions" }, buttons) : null,
				flash !== null ? h("span", { className: "dph-banner-note dph-ok-text", key: "flash" }, "✓ отложено на " + flash) : null,
				error !== "" ? h("span", { className: "dph-banner-note dph-error", key: "error" }, error) : null,
			]);
		}
		//#endregion

		//#region sidebar row marker
		function PeakRowMarker(props) {
			const sessionId = props !== null && props !== undefined ? props.sessionId : undefined;
			const peak = readPeak(props, null);
			const state = peak.state;
			if (state === null || state === undefined || state.offline === true || typeof sessionId !== "string" || sessionId === "") return null;
			const paused = isObject(state.pausedSessions) ? state.pausedSessions[sessionId] : null;
			const deferred = isObject(state.deferredSessions) ? Number(state.deferredSessions[sessionId]) || 0 : 0;
			const parts = [];
			if (paused !== null && paused !== undefined) {
				const until = formatClock(isObject(paused) ? paused.until : null);
				parts.push(h("span", {
					className: "dph-row-marker-ico",
					key: "paused",
					title: until !== null ? "Пик: сессия на паузе до " + until : "Пик: сессия на паузе",
				}, "⏸"));
			}
			if (deferred > 0) {
				parts.push(h("span", {
					className: "dph-row-marker-ico",
					key: "deferred",
					title: "Отложено сообщений: " + deferred,
				}, "⏰"));
			}
			if (parts.length === 0) return null;
			return h("span", { className: "dph-row-marker", "aria-hidden": "false" }, parts);
		}
		//#endregion

		//#region turn marker (conversation.chat.turnTail)
		function PeakTurnMarker(props) {
			const sessionId = props !== null && props !== undefined ? props.sessionId : undefined;
			const peak = readPeak(props, sessionId);
			const session = sessionOf(peak.state);
			if (session === null) return null;
			const ownerTurn = props !== null && props !== undefined && isObject(props.turn) ? props.turn : null;
			const turnNumber = ownerTurn !== null && typeof ownerTurn.turn === "number"
				? ownerTurn.turn
				: props !== null && props !== undefined && typeof props.matched === "number"
					? props.matched
					: null;
			if (turnNumber === null) return null;
			const pausedTurns = Array.isArray(session.pausedTurns) ? session.pausedTurns : [];
			const peakTurns = Array.isArray(session.peakTurns) ? session.peakTurns : [];
			if (pausedTurns.indexOf(turnNumber) >= 0) {
				return h("span", {
					className: "dph-turn",
					title: "Этот turn был приостановлен на пиковых часах",
				}, "⏸ был на паузе в пик");
			}
			if (peakTurns.indexOf(turnNumber) >= 0) {
				return h("span", {
					className: "dph-turn",
					title: "Этот turn выполнялся в пиковые часы — токены по пиковому тарифу",
				}, "🌙 пик");
			}
			return null;
		}
		//#endregion

		//#region settings page (settings.section)
		function numberToInput(value) {
			return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
		}

		function inputToNumber(value) {
			const text = value === null || value === undefined ? "" : String(value).trim();
			if (text === "") return null;
			const number = Number(text);
			return Number.isFinite(number) ? number : null;
		}

		function cloneJson(value) {
			try {
				return JSON.parse(JSON.stringify(value));
			} catch (error) {
				return {};
			}
		}

		function formFromSnapshot(snapshot) {
			const value = isObject(snapshot) ? snapshot : {};
			const settings = isObject(value.settings) ? value.settings : {};
			return {
				mode: typeof value.mode === "string" ? value.mode : "pause",
				allowPeakDefault: settings.allowPeakDefault === true,
				dailyLimitMinutes: numberToInput(settings.dailyLimitMinutes),
				prePeakWarningMinutes: numberToInput(settings.prePeakWarningMinutes),
				maxHoldMinutes: numberToInput(settings.maxHoldMinutes),
				pauseStrategy: typeof settings.strategy === "string"
					? settings.strategy
					: typeof value.pauseStrategy === "string" ? value.pauseStrategy : "auto",
				backgroundPolicy: typeof settings.backgroundPolicy === "string" ? settings.backgroundPolicy : "allow",
				notifyBeforePeak: settings.notifyBeforePeak !== false,
				statsEnabled: settings.statsEnabled !== false,
				deferMarginSeconds: numberToInput(settings.deferMarginSeconds),
			};
		}

		/** Only the settings the user actually changed, in the host's allowed key set. */
		function buildSettingsPatch(snapshot, form) {
			if (form === null || form === undefined) return {};
			const base = formFromSnapshot(snapshot);
			const patch = {};
			if (form.mode !== base.mode) patch.mode = form.mode;
			if (form.allowPeakDefault !== base.allowPeakDefault) patch.allowPeakDefault = form.allowPeakDefault === true;
			const numeric = [
				["dailyLimitMinutes", "dailyLimitMinutes"],
				["prePeakWarningMinutes", "prePeakWarningMinutes"],
				["maxHoldMinutes", "maxHoldMinutes"],
				["deferMarginSeconds", "deferMarginSeconds"],
			];
			for (const pair of numeric) {
				const next = inputToNumber(form[pair[0]]);
				const previous = inputToNumber(base[pair[0]]);
				if (next !== previous) patch[pair[1]] = next;
			}
			if (form.pauseStrategy !== base.pauseStrategy) patch.strategy = form.pauseStrategy;
			if (form.backgroundPolicy !== base.backgroundPolicy) patch.backgroundPolicy = form.backgroundPolicy;
			if (form.notifyBeforePeak !== base.notifyBeforePeak) patch.notifyBeforePeak = form.notifyBeforePeak === true;
			if (form.statsEnabled !== base.statsEnabled) patch.statsEnabled = form.statsEnabled === true;
			return patch;
		}

		function renderField(label, control, key) {
			return h("label", { className: "dph-field", key: key }, [
				h("span", { className: "dph-field-label", key: "label" }, label),
				control,
			]);
		}

		function renderSelectField(key, label, value, options, onChange, disabled) {
			const children = options.map((option) => h("option", { key: option[0], value: option[0] }, option[1]));
			return renderField(label, h("select", {
				key: "control",
				className: "dph-input",
				value: value,
				disabled: disabled === true,
				onChange: (event) => onChange(event.target.value),
			}, children), key);
		}

		function renderNumberField(key, label, value, onChange, disabled) {
			return renderField(label, h("input", {
				key: "control",
				className: "dph-input",
				type: "number",
				min: "0",
				value: value,
				disabled: disabled === true,
				onChange: (event) => onChange(event.target.value),
			}), key);
		}

		function renderCheckboxField(key, label, checked, onChange, disabled) {
			return h("label", { className: "dph-check", key: key }, [
				h("input", {
					key: "control",
					type: "checkbox",
					checked: checked === true,
					disabled: disabled === true,
					onChange: (event) => onChange(event.target.checked === true),
				}),
				h("span", { key: "label" }, label),
			]);
		}

		/** One editable window row: start/end time inputs, IANA zone, weekday checkboxes. */
		function renderWindowRow(window, index, onChange, onRemove, disabled) {
			const value = isObject(window) ? window : {};
			const days = Array.isArray(value.days) ? value.days : null;
			const selected = (day) => days === null || days.indexOf(day) >= 0;
			const toggleDay = (day) => {
				const current = days === null ? [0, 1, 2, 3, 4, 5, 6] : days.slice();
				const at = current.indexOf(day);
				if (at >= 0) current.splice(at, 1);
				else current.push(day);
				current.sort((left, right) => left - right);
				const next = Object.assign({}, value);
				if (current.length === 7) delete next.days;
				else next.days = current;
				onChange(next);
			};
			const set = (patch) => onChange(Object.assign({}, value, patch));
			return h("div", { className: "dph-window-row", key: "window-" + index }, [
				h("input", {
					key: "start",
					className: "dph-input dph-time",
					type: "time",
					value: typeof value.start === "string" ? value.start : "00:00",
					disabled: disabled === true,
					onChange: (event) => set({ start: event.target.value }),
				}),
				h("span", { className: "dph-dash", key: "dash" }, "—"),
				h("input", {
					key: "end",
					className: "dph-input dph-time",
					type: "time",
					value: typeof value.end === "string" ? value.end : "01:00",
					disabled: disabled === true,
					onChange: (event) => set({ end: event.target.value }),
				}),
				h("input", {
					key: "tz",
					className: "dph-input dph-tz",
					type: "text",
					value: typeof value.tz === "string" ? value.tz : "UTC",
					placeholder: "IANA-таймзона",
					title: "IANA-таймзона, например Europe/Moscow. Неизвестные зоны хост отбросит с предупреждением.",
					disabled: disabled === true,
					onChange: (event) => set({ tz: event.target.value }),
				}),
				h("div", { className: "dph-days", key: "days" }, WEEKDAYS.map((day) => h("label", {
					key: "day-" + day.value,
					className: "dph-day",
					title: day.label,
				}, [
					h("input", {
						key: "check",
						type: "checkbox",
						checked: selected(day.value),
						disabled: disabled === true,
						onChange: () => toggleDay(day.value),
					}),
					h("span", { key: "short" }, day.short),
				]))),
				h("button", {
					key: "remove",
					type: "button",
					className: "dph-remove",
					title: "удалить окно",
					disabled: disabled === true,
					onClick: onRemove,
				}, "✕"),
			]);
		}

		/** Editable windows list: one row per window plus the add button. */
		function renderWindowsEditor(windows, onChange, disabled, addLabel) {
			const list = Array.isArray(windows) ? windows : [];
			const rows = list.map((window, index) => renderWindowRow(
				window,
				index,
				(next) => onChange(list.map((item, position) => (position === index ? next : item))),
				() => onChange(list.filter((item, position) => position !== index)),
				disabled,
			));
			rows.push(h("button", {
				key: "add-window",
				type: "button",
				className: "dph-add",
				disabled: disabled === true,
				onClick: () => onChange(list.concat([{ start: "00:00", end: "01:00", tz: "UTC" }])),
			}, addLabel || "+ окно"));
			return h("div", { className: "dph-windows" }, rows);
		}

		/** Local input for adding a provider/model key (prompt-style inline row). */
		function AddKeyRow(props) {
			const [text, setText] = react.useState("");
			const value = String(text === null || text === undefined ? "" : text).trim();
			const submit = () => {
				if (value === "") return;
				props.onAdd(value);
				setText("");
			};
			return h("div", { className: "dph-inline" }, [
				h("input", {
					key: "input",
					className: "dph-input",
					type: "text",
					value: text,
					placeholder: props.placeholder || "",
					disabled: props.disabled === true,
					onChange: (event) => setText(event.target.value),
				}),
				h("button", {
					key: "add",
					type: "button",
					className: "dph-add",
					disabled: props.disabled === true || value === "",
					onClick: submit,
				}, props.label || "Добавить"),
			]);
		}

		/** One provider family card: family windows plus the per-model overrides editor. */
		function holidaysToText(holidays) {
			if (!isObject(holidays) || !Array.isArray(holidays.ranges)) return "";
			return holidays.ranges
				.map((range) => {
					if (!Array.isArray(range) || range.length !== 2) return "";
					return range[0] === range[1] ? String(range[0]) : range[0] + ".." + range[1];
				})
				.filter((line) => line !== "")
				.join("\n");
		}

		function textToRanges(text) {
			const ranges = [];
			for (const raw of String(text || "").split(/\r?\n/)) {
				const line = raw.trim();
				if (line === "") continue;
				const match = /^(\d{4}-\d{2}-\d{2})(?:\s*\.\.\s*(\d{4}-\d{2}-\d{2}))?$/.exec(line);
				if (match === null) continue;
				const from = match[1];
				const to = match[2] === undefined ? from : match[2];
				ranges.push(from <= to ? [from, to] : [to, from]);
			}
			return ranges;
		}

		function renderHolidaysEditor(holidays, onChange, disabled) {
			const value = isObject(holidays) ? holidays : null;
			const tz = value !== null && typeof value.tz === "string" && value.tz !== "" ? value.tz : "Asia/Shanghai";
			const ranges = value !== null && Array.isArray(value.ranges) ? value.ranges : [];
			return h("div", { className: "dph-holidays", key: "holidays" }, [
				h("div", { className: "dph-field-label", key: "tz-label" }, "Праздники-исключения: таймзона"),
				h("input", {
					key: "tz",
					type: "text",
					className: "dph-input dph-tz",
					defaultValue: tz,
					disabled: disabled === true,
					onChange: (event) => {
						const nextTz = String(event?.target?.value ?? "").trim() || "Asia/Shanghai";
						onChange({ tz: nextTz, ranges: ranges });
					},
				}),
				h("textarea", {
					key: "ranges",
					className: "dph-input dph-textarea",
					rows: 3,
					defaultValue: holidaysToText(value),
					disabled: disabled === true,
					placeholder: "YYYY-MM-DD или YYYY-MM-DD..YYYY-MM-DD — по одному в строке",
					onChange: (event) => {
						const nextRanges = textToRanges(event?.target?.value ?? "");
						onChange(nextRanges.length === 0 ? null : { tz: tz, ranges: nextRanges });
					},
				}),
				h("div", { className: "dph-hint", key: "hint" }, "В эти даты пиковые окна не действуют (праздники КНР). Пусто — не исключать."),
			]);
		}

		function renderScheduleCard(scheduleKey, entry, onChange, disabled) {
			const value = isObject(entry) ? entry : {};
			const models = isObject(value.models) ? value.models : {};
			const modelCards = Object.keys(models).map((modelKey) => {
				const rule = isObject(models[modelKey]) ? models[modelKey] : {};
				return h("div", { className: "dph-model-card", key: "model-" + modelKey }, [
					h("div", { className: "dph-model-head", key: "head" }, [
						h("span", { className: "dph-model-key", key: "key" }, modelKey),
						h("button", {
							key: "remove",
							type: "button",
							className: "dph-remove",
							title: "удалить модель",
							disabled: disabled === true,
							onClick: () => {
								const next = Object.assign({}, models);
								delete next[modelKey];
								const nextEntry = Object.assign({}, value);
								if (Object.keys(next).length === 0) delete nextEntry.models;
								else nextEntry.models = next;
								onChange(nextEntry);
							},
						}, "✕"),
					]),
					renderWindowsEditor(rule.windows, (windows) => {
						const nextModels = Object.assign({}, models);
						nextModels[modelKey] = Object.assign({}, rule, { windows: windows });
						onChange(Object.assign({}, value, { models: nextModels }));
					}, disabled),
				]);
			});
			const addModel = (modelKey) => {
				if (models[modelKey] !== undefined) return;
				onChange(Object.assign({}, value, {
					models: Object.assign({}, models, {
						[modelKey]: { windows: [{ start: "00:00", end: "01:00", tz: "UTC" }] },
					}),
				}));
			};
			return h("div", { className: "dph-card", key: "schedule-" + scheduleKey }, [
				h("div", { className: "dph-card-head", key: "head" }, [
					h("span", { className: "dph-card-key", key: "key" }, scheduleKey),
				]),
				h("div", { className: "dph-card-title", key: "windows-title" }, "Окна (время провайдера)"),
				renderWindowsEditor(value.windows, (windows) => onChange(Object.assign({}, value, { windows: windows })), disabled),
				h("div", { className: "dph-card-title", key: "holidays-title" }, "Праздники-исключения (Китай)"),
				renderHolidaysEditor(value.holidays, (nextHolidays) => {
					const nextEntry = Object.assign({}, value);
					if (nextHolidays === null) delete nextEntry.holidays;
					else nextEntry.holidays = nextHolidays;
					onChange(nextEntry);
				}, disabled),
				h("div", { className: "dph-card-title", key: "models-title" }, "Модели"),
				modelCards,
				h(AddKeyRow, {
					key: "add-model",
					label: "+ модель",
					placeholder: "model id (например deepseek-chat)",
					disabled: disabled,
					onAdd: addModel,
				}),
			]);
		}

		function PeakSettingsSection(props) {
			const rpcCall = props !== null && props !== undefined ? props.rpcCall : undefined;
			const close = props !== null && props !== undefined ? props.close : undefined;
			const refresh = props !== null && props !== undefined && typeof props.refresh === "function" ? props.refresh : NOOP;
			const [snapshot, setSnapshot] = react.useState(null);
			const [form, setForm] = react.useState(null);
			const [schedules, setSchedules] = react.useState(null);
			const [schedulesDirty, setSchedulesDirty] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [saved, setSaved] = react.useState(false);
			const [error, setError] = react.useState("");
			const [warnings, setWarnings] = react.useState([]);
			const [offline, setOffline] = react.useState(() => typeof rpcCall !== "function");

			const applySnapshot = (value) => {
				const safe = isObject(value) ? value : {};
				setSnapshot(safe);
				setForm(formFromSnapshot(safe));
				setSchedules(isObject(safe.schedules) ? cloneJson(safe.schedules) : {});
				setSchedulesDirty(false);
				setWarnings(Array.isArray(safe.scheduleWarnings) ? safe.scheduleWarnings.map(String) : []);
			};

			const fetchState = () => {
				if (typeof rpcCall !== "function") return Promise.resolve({ ok: false, value: null, error: { code: "no-connection", message: "connection service unavailable" } });
				return Promise.resolve()
					.then(() => rpcCall("state", {}))
					.then((result) => {
						if (isObject(result) && result.ok === true && isObject(result.value)) return { ok: true, value: result.value, error: null };
						return { ok: false, value: null, error: isObject(result) && isObject(result.error) ? result.error : { code: "transport", message: "пустой ответ" } };
					}, (failure) => ({ ok: false, value: null, error: { code: "transport", message: errorText(failure) } }));
			};

			react.useEffect(() => {
				if (typeof rpcCall !== "function") {
					setOffline(true);
					return undefined;
				}
				let alive = true;
				const run = async () => {
					const result = await fetchState();
					if (alive !== true) return;
					if (result.ok === true) {
						applySnapshot(result.value);
						setOffline(false);
						setError("");
					} else {
						setOffline(true);
						setError(errorMessageOf(result));
					}
				};
				void run();
				return () => {
					alive = false;
				};
			}, [rpcCall]);

			const updateForm = (key, value) => {
				setForm((current) => Object.assign({}, current === null ? {} : current, { [key]: value }));
			};

			const save = async () => {
				if (busy === true || form === null) return null;
				if (typeof rpcCall !== "function") {
					setOffline(true);
					return null;
				}
				setBusy(true);
				setSaved(false);
				setError("");
				try {
					const patch = buildSettingsPatch(snapshot, form);
					const jobs = [];
					if (Object.keys(patch).length > 0) jobs.push(() => rpcCall("save-settings", { patch: patch }));
					if (schedulesDirty === true) jobs.push(() => rpcCall("save-schedules", { schedules: schedules === null ? {} : schedules }));
					if (jobs.length === 0) {
						setBusy(false);
						setSaved(true);
						return null;
					}
					let last = null;
					for (const job of jobs) {
						const result = await job();
						if (!(isObject(result) && result.ok === true)) {
							setBusy(false);
							setError(errorMessageOf(result));
							return null;
						}
						last = result;
					}
					if (isObject(last) && isObject(last.value)) {
						applySnapshot(last.value);
						setWarnings(Array.isArray(last.value.scheduleWarnings) ? last.value.scheduleWarnings.map(String) : []);
					}
					setBusy(false);
					setSaved(true);
					try {
						refresh();
					} catch (failure) {
						// The store refresh is best-effort; the page already saved.
					}
					return last;
				} catch (failure) {
					setBusy(false);
					setError(errorText(failure));
					return null;
				}
			};

			const reset = async () => {
				if (busy === true) return null;
				setBusy(true);
				setSaved(false);
				setError("");
				const result = await fetchState();
				setBusy(false);
				if (result.ok === true) {
					applySnapshot(result.value);
					setOffline(false);
				} else {
					setError(errorMessageOf(result));
				}
				return result;
			};

			const resetSchedules = async () => {
				if (busy === true || typeof rpcCall !== "function") return null;
				setBusy(true);
				setSaved(false);
				setError("");
				try {
					const result = await rpcCall("save-schedules", { schedules: null });
					if (isObject(result) && result.ok === true) {
						if (isObject(result.value)) applySnapshot(result.value);
						setBusy(false);
						setSaved(true);
						try {
							refresh();
						} catch (failure) {
							// best-effort
						}
					} else {
						setBusy(false);
						setError(errorMessageOf(result));
					}
					return result;
				} catch (failure) {
					setBusy(false);
					setError(errorText(failure));
					return null;
				}
			};

			const updateSchedule = (scheduleKey, entry) => {
				setSchedules((current) => Object.assign({}, current === null ? {} : current, { [scheduleKey]: entry }));
				setSchedulesDirty(true);
				setSaved(false);
			};

			const addProvider = (scheduleKey) => {
				const trimmed = String(scheduleKey || "").trim();
				if (trimmed === "") return;
				if (isObject(schedules) && schedules[trimmed] !== undefined) {
					setError("провайдер «" + trimmed + "» уже есть в расписании");
					return;
				}
				setSchedules((current) => Object.assign({}, current === null ? {} : current, {
					[trimmed]: { windows: [{ start: "00:00", end: "01:00", tz: "UTC" }] },
				}));
				setSchedulesDirty(true);
				setSaved(false);
				setError("");
			};

			const legacy = isLegacyHost(snapshot);
			const disabled = busy === true || offline === true || legacy === true;
			const actionBar = h("div", { className: "dph-settings-actions", key: "actions" }, [
				h("button", {
					key: "save",
					type: "button",
					className: "dph-btn dph-btn-primary",
					disabled: busy === true || form === null || legacy === true,
					onClick: () => {
						void save();
					},
				}, busy === true ? "…" : "Сохранить"),
				h("button", {
					key: "reset",
					type: "button",
					className: "dph-btn",
					disabled: busy === true || form === null || legacy === true,
					onClick: () => {
						void reset();
					},
				}, "Сбросить"),
				typeof close === "function" ? h("button", {
					key: "close",
					type: "button",
					className: "dph-btn",
					onClick: () => close(),
				}, "Закрыть") : null,
			]);

			const formEls = form === null ? null : h("div", { className: "dph-grid", key: "form" }, [
				renderSelectField("mode", "Режим гейта", form.mode, [
					["pause", "pause — паузить сессии"],
					["hard", "hard — блокировать вызовы"],
					["warn", "warn — только предупреждать"],
				], (value) => updateForm("mode", value), disabled),
				renderSelectField("strategy", "Режим pause (стратегия)", form.pauseStrategy, [
					["auto", "auto — по длине окна"],
					["hold", "hold — удерживать шаг"],
					["requeue", "requeue — переносить шаг"],
				], (value) => updateForm("pauseStrategy", value), disabled),
				renderNumberField("daily-limit", "дневной лимит пикового времени, мин; пусто = без лимита", form.dailyLimitMinutes, (value) => updateForm("dailyLimitMinutes", value), disabled),
				renderNumberField("pre-peak-warning", "предупреждать до пика, мин", form.prePeakWarningMinutes, (value) => updateForm("prePeakWarningMinutes", value), disabled),
				renderNumberField("max-hold", "максимум удержания шага, мин", form.maxHoldMinutes, (value) => updateForm("maxHoldMinutes", value), disabled),
				renderNumberField("defer-margin", "запас после конца пика, сек", form.deferMarginSeconds, (value) => updateForm("deferMarginSeconds", value), disabled),
				renderSelectField("background-policy", "Фоновые вызовы (заголовки, компакция)", form.backgroundPolicy, [
					["allow", "allow — разрешать"],
					["warn", "warn — предупреждать"],
					["block", "block — блокировать"],
				], (value) => updateForm("backgroundPolicy", value), disabled),
				renderCheckboxField("allow-default", "разрешать работу в пик по умолчанию", form.allowPeakDefault, (checked) => updateForm("allowPeakDefault", checked), disabled),
				renderCheckboxField("notify", "уведомлять до пика", form.notifyBeforePeak, (checked) => updateForm("notifyBeforePeak", checked), disabled),
				renderCheckboxField("stats", "считать статистику экономии", form.statsEnabled, (checked) => updateForm("statsEnabled", checked), disabled),
			]);

			const scheduleKeys = isObject(schedules) ? Object.keys(schedules) : [];
			const schedulesBlock = schedules === null ? null : h("div", { className: "dph-schedules", key: "schedules" }, [
				h("div", { className: "dph-card-title", key: "title" }, "Расписания пиковых часов"
					+ (isObject(snapshot) && snapshot.schedulesSource === "user" ? " (пользовательские)" : " (встроенные)")),
				h("div", { className: "dph-hint", key: "hint" }, "Окна задаются в таймзоне окна; ниже они показываются в твоём местном времени."),
				scheduleKeys.length === 0
					? h("div", { className: "dph-hint", key: "empty" }, "Расписаний нет — добавь провайдера ниже.")
					: null,
			].concat(scheduleKeys.map((scheduleKey) => renderScheduleCard(
				scheduleKey,
				schedules[scheduleKey],
				(entry) => updateSchedule(scheduleKey, entry),
				disabled,
			))).concat([
				h(AddKeyRow, {
					key: "add-provider",
					label: "+ провайдер",
					placeholder: "провайдер (например deepseek)",
					disabled: disabled,
					onAdd: addProvider,
				}),
				h("div", { className: "dph-inline", key: "reset-schedules" }, [
					h("button", {
						key: "button",
						type: "button",
						className: "dph-btn",
						disabled: disabled,
						onClick: () => {
							void resetSchedules();
						},
					}, "Сбросить расписания к встроенным"),
				]),
			]));

			return h("div", { className: "dph-settings" }, [
				h("div", { className: "dph-settings-head", key: "head" }, [
					h("div", { key: "titles" }, [
						h("div", { className: "dph-settings-title", key: "title" }, "Пиковые часы"),
						h("div", { className: "dph-settings-sub", key: "sub" }, "Режим гейта, дневной бюджет и окна пиковых часов по провайдерам и моделям."),
					]),
					actionBar,
				]),
				offline === true ? h("div", { className: "dph-error", key: "offline" }, "хост недоступен") : null,
				legacy === true ? h("div", { className: "dph-error", key: "legacy" }, "хост-половина старой версии: перезапустите dsh web, иначе настройки не сохраняются и лимиты не работают") : null,
				error !== "" ? h("div", { className: "dph-error", key: "error" }, error) : null,
				saved === true && error === "" ? h("div", { className: "dph-note dph-ok-text", key: "saved" }, "Сохранено") : null,
				warnings.length > 0 ? h("div", { className: "dph-warnings", key: "warnings" }, warnings.map((text, index) => h("div", { key: "warning-" + index }, String(text)))) : null,
				formEls !== null ? formEls : h("div", { className: "dph-note", key: "loading" }, offline === true ? "Настройки недоступны без хоста." : "Загрузка настроек…"),
				schedulesBlock,
			]);
		}
		//#endregion

		//#region registration
		/** Required services: the wire client and the slot registry. */
		const inject = ["connection", "slots"];

		function apply(ctx) {
			const connection = typeof ctx.get === "function" ? ctx.get("connection") : undefined;
			const rpcCall = createRpcCall(connection);
			const store = createPeakStore(rpcCall);
			/** The shared layer every registration hands its component. */
			const share = () => ({
				rpcCall: rpcCall,
				usePeakState: store.usePeakState,
				useCountdown: useCountdown,
				refresh: store.refresh,
			});

			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "deepseek-peak-indicator",
				order: 0,
				inject: share,
			}, PeakHoursPill));

			ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
				name: "conversation.input.right",
				id: "peak-defer",
				order: 10,
				inject: share,
			}, PeakDeferButton));

			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "peak-banner",
				order: 5,
				inject: share,
			}, PeakBanner));

			ctx.slots.inject("sidebar.session.row.trailing", () => ctx.slots.register({
				name: "sidebar.session.row.trailing",
				id: "peak-row-marker",
				order: 5,
				inject: share,
			}, PeakRowMarker));

			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "peak-hours",
				order: 70,
				label: () => "Пиковые часы",
				inject: share,
			}, PeakSettingsSection));

			// `conversation.chat.turnTail` is a chain: the pure selector claims the
			// turn number, so the component never needs engine-owned data.
			ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				id: "peak-turn-marker",
				order: 10,
				select: (owner) => {
					if (owner === null || owner === undefined || typeof owner !== "object") return null;
					const turn = owner.turn;
					if (turn === null || turn === undefined || typeof turn !== "object") return null;
					return typeof turn.turn === "number" ? turn.turn : null;
				},
				inject: share,
			}, PeakTurnMarker));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});

window.__ModuleLoader__.load({
	id: "dsh-hello-world",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/HelloAction.tsx
		function HelloAction({ runHello }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				title: "Отправить строку агенту",
				onClick: () => void runHello().catch((error) => {
					console.error("[dsh-hello-world] runHello failed:", error);
				}),
				children: "Foo"
			});
		}
		//#endregion
		//#region src/client/slots.ts
		/**
		* The line the action submits as a user message. A leading `/name` token is
		* a skill invocation: session.prompt, then dsh-tool-skill at pre-step.
		*/
		const HELLO_LINE = "/goal поесть";
		//#endregion
		//#region src/client/index.ts
		/** Required services: slot registry and the client sessions face. */
		const inject = ["slots", "sessions"];
		function apply(ctx) {
			ctx.slots.inject("conversation.chat.assistant-actions", () => ctx.slots.register({
				name: "conversation.chat.assistant-actions",
				id: "hello",
				order: 10,
				inject: (sessionId) => ({ runHello: async () => {
					const line = HELLO_LINE;
					const sessions = ctx.get("sessions");
					if (sessions === void 0) throw new Error("sessions service unavailable");
					const session = sessions.binding(sessionId)?.session;
					if (session === void 0) throw new Error(`no session for ${sessionId}`);
					if (line.startsWith("/")) {
						const result = await session.command(line);
						if (!result.ok) throw new Error(`session.command failed: ${result.error.code}: ${result.error.message}`);
						if (!result.value.matched) throw new Error(`unknown or malformed command: ${line}`);
						return;
					}
					const content = [{
						type: "text",
						text: line
					}];
					const result = await session.prompt(content, "queue");
					if (!result.ok) throw new Error(`session.prompt failed: ${result.error.code}: ${result.error.message}`);
				} })
			}, HelloAction));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
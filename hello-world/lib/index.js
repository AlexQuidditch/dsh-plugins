//#region lib/types/index.js
/**
* dsh-hello-world, host half.
*
* Registers the /hello slash command in the command plane (ctx.commands).
* Namespace plugin shape: named exports name / inject / apply, no default
* export (postmortem 0001: default export drops inject).
*/
const name = "hello-world";
/** The command registry must exist before this plugin starts. */
const inject = ["commands"];
function apply(ctx, config = {}) {
	const greeting = config.greeting ?? "Привет из плагина dsh-hello-world!";
	ctx.commands.register({
		name: "hello",
		description: "Отвечает приветствием (пример плагина dsh-hello-world)",
		input: { hint: "текст для ответа (необязательно!)" },
		handler: ({ rawInput }) => {
			const text = rawInput.trim();
			return {
				kind: "success",
				text: text ? `${greeting} ${text}` : greeting
			};
		}
	});
	ctx.logger.info("[hello-world] plugin loaded (greeting=%s)", greeting);
}
//#endregion
export { apply, inject, name };

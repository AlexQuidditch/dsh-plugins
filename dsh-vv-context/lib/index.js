//#region lib/types/format.js
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
//#region lib/types/index.js
const name = "vv-context";
function apply(ctx) {}
//#endregion
export { apply, formatPercent, formatTokens, name, shareOf };

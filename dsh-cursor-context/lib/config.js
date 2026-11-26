/**
 * Configuration resolution and the capacity decision for `dsh-cursor-context`.
 *
 * The Cursor SDK catalog describes every model with parameter definitions. A model
 * that offers a `context` parameter advertises its real capacity tiers (`256k`,
 * `500k`, `1m`), and the `cursor-to-dsh` adapter turns the preferred tier into
 * `context.contextWindow`. A model without that parameter has no advertised
 * capacity at all, so the adapter substitutes a flat `200_000` fallback. This
 * module implements the override table that replaces that fallback: an exact
 * per-model map plus one provider-wide default that applies only to models whose
 * catalog entry advertises no capacity.
 *
 * The module is pure and synchronous on purpose. It imports nothing from
 * `@deepseek-ai/*`, so it can be unit-tested and loaded without a Cordis runtime.
 *
 * @module dsh-cursor-context/config
 */

// START_MODULE_CONTRACT
// FILE: dsh-cursor-context/lib/config.js
// VERSION: 1.0.0
// PURPOSE: Turn the bundle row config into a frozen capacity table and answer one question: which context window should this model record.
// SCOPE: Config validation, catalog tier detection, per-model and provider-wide override precedence.
// INPUT: Raw bundle row config and one catalog entry of the patched provider.
// OUTPUT: A frozen config object and an override value (or `undefined` when the adapter's own value stands).
// KEYWORDS: DOMAIN(9): context-window; DOMAIN(8): cursor-catalog; CONCEPT(8): override-table; TECH(6): pure-functions
// LINKS: USES_API(6): CursorAdapter.models; READS_DATA_FROM(8): bundle row config
// LINKS_TO_SPECIFICATION: cursor-to-dsh `lib/models.js` (tier parsing and the 200_000 fallback)
// END_MODULE_CONTRACT

// START_INVARIANTS
// - `resolveConfig` never throws: every malformed input degrades to a documented default plus one warning string.
// - A capacity value is always a positive safe integer once accepted.
// - An explicit per-model entry always beats the provider-wide default.
// - The provider-wide default never touches a model that advertises its own tiers.
// END_INVARIANTS

// START_RATIONALE
// Q: Why does the provider-wide default skip models with advertised tiers?
// A: `grok-4.7` reports 256k and 500k tiers. Writing one flat default over every
//    model of the provider would inflate those routes as well, and an inflated
//    capacity defers compaction past the real limit, which fails the request
//    instead of condensing the history. The default is therefore a repair for
//    tierless models only, while an explicit per-model entry stays authoritative
//    for every model, tierless or not.
// Q: Why is the tier check a local copy of the adapter's parsing rules?
// A: The adapter exports no predicate for "has a context tier". Duplicating the
//    `(<digits>)(k|m)` grammar is three lines, read-only, and cannot disturb the
//    adapter; an import of `cursor-to-dsh/lib/models.js` would bind this bundle to
//    a private path of another package.
// END_RATIONALE

// START_CHANGE_SUMMARY
// LAST_CHANGE: 1.0.0 — initial bundle: per-model and provider-wide context capacity overrides.
// PREV_CHANGE_SUMMARY: none
// END_CHANGE_SUMMARY

// START_MODULE_MAP:
// CONST [5] Provider route assumed when the config omits one => DEFAULT_PROVIDER
// CONST [5] Capacity assumed for a tierless model when the config omits one => DEFAULT_CONTEXT_WINDOW
// PATTERN [6] Catalog tier grammar `(<digits>)(k|m)` => TIER_PATTERN
// FUNCTION [5] Accept a positive safe integer from a number or a digit string => positiveInteger
// FUNCTION [5] Convert one catalog tier label into tokens => tokenValue
// FUNCTION [5] Read the parameter definitions of one catalog entry => parameterDefs
// FUNCTION [7] Whether a catalog entry advertises at least one usable context tier => hasContextTiers
// FUNCTION [8] Resolve, validate, and freeze the bundle row config => resolveConfig
// FUNCTION [9] Decide the capacity override for one model => contextWindowFor
// END_MODULE_MAP

// START_USE_CASES:
// - Capacity repair: plugin author -> declares one model id in `contextWindows` -> the route records the real capacity.
// - Provider default: plugin author -> sets `defaultContextWindow` -> every tierless model of the provider stops reporting the flat fallback.
// - Safe shutdown: adapter consumer -> reads a restored `resolveModel` -> the original capacity returns.
// END_USE_CASES

export const DEFAULT_PROVIDER = 'cursor';

export const DEFAULT_CONTEXT_WINDOW = 1_048_576;

const TIER_PATTERN = /^(\d+(?:\.\d+)?)([km])$/i;

/**
 * Narrow one configured capacity to a positive safe integer.
 *
 * A number is accepted only when it is a positive safe integer, so `1.5`, `-1`,
 * `NaN`, and `Infinity` are rejected. A string is accepted when it is pure digits
 * after trimming, which lets a YAML value that was quoted (`"1048576"`) work the
 * same as a bare number. Everything else yields `undefined`, and the caller turns
 * that into a warning plus a documented default.
 *
 * @param value - candidate capacity from the bundle row config.
 * @returns the capacity in tokens, or `undefined` when the value is not usable.
 */
// START_FUNCTION_positiveInteger
export function positiveInteger(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return undefined;
    const parsed = Number(trimmed);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}
// END_FUNCTION_positiveInteger

/**
 * Convert one Cursor catalog tier label into a token count.
 *
 * Cursor writes tiers as short human labels: `256k`, `500k`, `1m`, and `1.05m`.
 * The multiplier is decimal (1k is 1000 tokens, 1m is 1e6 tokens), because that is
 * how the labels read and how the `cursor-to-dsh` adapter already parses them. The
 * label is trimmed and case-folded; a label outside the grammar, or one that
 * resolves to zero, yields `undefined`.
 *
 * @param label - catalog tier value, already coerced to a string.
 * @returns the token count, or `undefined` when the label is not a tier.
 */
// START_FUNCTION_tokenValue
export function tokenValue(label) {
  const match = TIER_PATTERN.exec(label.trim());
  if (match === null) return undefined;
  const size = Math.round(Number(match[1]) * (match[2].toLowerCase() === 'm' ? 1e6 : 1e3));
  return size > 0 ? size : undefined;
}
// END_FUNCTION_tokenValue

/**
 * Read the parameter definitions of one catalog entry.
 *
 * The live adapter keeps Cursor parameter definitions under `cursorParameters`
 * and the fallback list keeps them under `parameters`; this helper accepts either
 * shape and always returns an array, so the caller needs no optional chaining
 * around a possibly missing field.
 *
 * @param entry - one catalog entry as returned by the adapter's `models()`.
 * @returns the parameter definitions, or an empty array.
 */
// START_FUNCTION_parameterDefs
export function parameterDefs(entry) {
  const defs = entry?.cursorParameters ?? entry?.parameters;
  return Array.isArray(defs) ? defs : [];
}
// END_FUNCTION_parameterDefs

/**
 * Whether a catalog entry advertises at least one usable context tier.
 *
 * The `context` parameter is the only place Cursor publishes capacity, and its
 * values may be plain strings or objects carrying a `value` field. The function
 * returns true as soon as one value parses as a tier, which marks the model as
 * self-describing: the adapter already knows its capacity, so no override may
 * touch it. A missing entry, a missing parameter, or a parameter with unparsable
 * values all report false, and the caller treats that model as tierless.
 *
 * @param entry - one catalog entry, or `undefined` when the catalog lacks the id.
 * @returns true when the model publishes its own capacity tiers.
 */
// START_FUNCTION_hasContextTiers
export function hasContextTiers(entry) {
  const context = parameterDefs(entry).find((def) => def !== null && typeof def === 'object' && def.id === 'context');
  const values = Array.isArray(context?.values) ? context.values : [];
  return values.some((value) => {
    const label = value !== null && typeof value === 'object' ? value.value : value;
    return typeof label === 'string' && tokenValue(label) !== undefined;
  });
}
// END_FUNCTION_hasContextTiers

/**
 * Resolve, validate, and freeze the bundle row config.
 *
 * The bundle ships no `Config` schema export, because the profile does not hoist
 * `@deepseek-ai/schemastery` into this package's resolution scope. Validation is
 * therefore explicit here, and it never throws: each malformed field falls back
 * to a documented value and appends one human-readable line to `warnings`, which
 * the plugin logs once at activation. `defaultContextWindow` defaults to one
 * mebibyte when the key is absent; an explicit `null`, `false`, or `0` turns the
 * provider-wide default off, and a per-model map keeps working on its own.
 *
 * @param raw - untouched bundle row config from `cordis.patch.yml`.
 * @returns a frozen config object with `enabled`, `provider`, `defaultContextWindow`, a null-prototype `contextWindows` table, and `warnings`.
 */
// START_FUNCTION_resolveConfig
export function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const warnings = [];

  // START_BLOCK_RESOLVE_PROVIDER: the route whose `resolveModel` is wrapped.
  const provider = typeof source.provider === 'string' && source.provider.trim().length > 0 ? source.provider.trim() : DEFAULT_PROVIDER;
  if (source.provider !== undefined && provider !== source.provider.trim()) {
    warnings.push(`provider is not a non-empty string; using "${DEFAULT_PROVIDER}"`);
  }
  // END_BLOCK_RESOLVE_PROVIDER

  // START_BLOCK_RESOLVE_DEFAULT: provider-wide default for tierless models.
  let defaultContextWindow;
  if (source.defaultContextWindow === undefined) {
    defaultContextWindow = DEFAULT_CONTEXT_WINDOW;
  } else {
    defaultContextWindow = positiveInteger(source.defaultContextWindow);
    if (defaultContextWindow === undefined) {
      warnings.push(`defaultContextWindow=${String(source.defaultContextWindow)} is not a positive integer; the provider-wide default is off`);
    }
  }
  // END_BLOCK_RESOLVE_DEFAULT

  // START_BLOCK_RESOLVE_MAP: explicit per-model overrides; a broken entry is dropped, not fatal.
  const contextWindows = Object.create(null);
  const map = source.contextWindows;
  if (map !== undefined && map !== null) {
    if (typeof map !== 'object' || Array.isArray(map)) {
      warnings.push('contextWindows is not an object; per-model overrides are off');
    } else {
      for (const [key, value] of Object.entries(map)) {
        const model = typeof key === 'string' ? key.trim() : '';
        const capacity = positiveInteger(value);
        if (model.length === 0 || capacity === undefined) {
          warnings.push(`contextWindows["${key}"]=${String(value)} is not a positive integer; entry dropped`);
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(contextWindows, model)) continue;
        contextWindows[model] = capacity;
      }
    }
  }
  // END_BLOCK_RESOLVE_MAP

  return Object.freeze({
    enabled: source.enabled !== false,
    provider,
    defaultContextWindow,
    contextWindows: Object.freeze(contextWindows),
    warnings: Object.freeze(warnings),
  });
}
// END_FUNCTION_resolveConfig

/**
 * Decide the capacity override for one model.
 *
 * The order is deliberate. A disabled config or an empty model id yields no
 * override at all. An explicit `contextWindows` entry wins over everything, so an
 * operator can correct even a model that publishes tiers. Otherwise the
 * provider-wide default applies, but only to a model whose catalog entry carries
 * no usable tier: a self-describing model keeps the adapter's own number, because
 * the adapter read it from Cursor and this module cannot know better. A negative
 * result means "leave the adapter's value untouched".
 *
 * @param config - frozen result of {@link resolveConfig}.
 * @param model - exact model id from the adapter call.
 * @param entry - catalog entry for that id, or `undefined` when the catalog lacks it or could not be read.
 * @returns the capacity to record in tokens, or `undefined` to keep the adapter value.
 */
// START_FUNCTION_contextWindowFor
export function contextWindowFor(config, model, entry) {
  if (config === null || config === undefined || config.enabled === false) return undefined;
  if (typeof model !== 'string' || model.length === 0) return undefined;

  // START_BLOCK_EXPLICIT_ENTRY: an operator-declared number always wins.
  const mapped = config.contextWindows[model];
  if (mapped !== undefined) return mapped;
  // END_BLOCK_EXPLICIT_ENTRY

  // START_BLOCK_PROVIDER_DEFAULT: repair only the models that cannot describe themselves.
  if (config.defaultContextWindow === undefined) return undefined;
  if (hasContextTiers(entry)) return undefined;
  return config.defaultContextWindow;
  // END_BLOCK_PROVIDER_DEFAULT
}
// END_FUNCTION_contextWindowFor

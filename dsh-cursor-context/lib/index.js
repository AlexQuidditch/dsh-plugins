/**
 * `cursor-context` host plugin: real context capacity for Cursor routes.
 *
 * The `cursor-to-dsh` adapter derives `context.contextWindow` from the model's
 * Cursor catalog entry: it reads the model's `context` parameter tiers and takes
 * the preferred one. A model that offers no `context` parameter at all has no
 * advertised capacity, so the adapter falls back to a flat `200_000`. For
 * `deepseek-v41-flash-1017` that fallback is wrong by an order of magnitude: the
 * route really accepts about one mebibyte, but DSH records 200 000, and the
 * compaction threshold derived from that number condenses a healthy history far
 * too early while the UI reports a meaningless pressure percentage.
 *
 * This plugin fixes the recorded capacity without touching the adapter package.
 * It finds the already registered adapter instance of the configured provider on
 * `llm.adapters`, installs one own-property wrapper over the instance's
 * `resolveModel`, and lets the wrapper replace `context.contextWindow` in the
 * returned model info. Because `LlmAdapter.prepareCall` reads `this.resolveModel`,
 * every request, discovery pass, and metadata lookup passes through the wrapper
 * before `normalizeModelInfo` validates and freezes the value.
 *
 * The wrapper is layered, never replacing: the original method still runs first, so
 * display names, modalities, reasoning efforts, and system-prompt mode stay exactly
 * as the adapter produced them. Nothing is registered anew, so `DUPLICATE_ADAPTER`
 * cannot happen, and the adapter object keeps its identity, which keeps
 * `replayState` attached to historical assistant messages.
 *
 * Activation is defensive in both directions. The plugin usually activates after
 * `cursor-to-dsh` (the profile appends new bundle dependencies to the bundle list),
 * but a later registration, a reload, or a re-registration after a catalog reset is
 * covered by the `llm/adapters-updated` listener. Every failure path - no `llm`
 * service, no adapter for the route, no `resolveModel`, a non-object result - logs
 * one diagnostic and leaves the route exactly as it was.
 *
 * @module dsh-cursor-context
 */

// START_MODULE_CONTRACT
// FILE: dsh-cursor-context/lib/index.js
// VERSION: 1.0.0
// PURPOSE: Override the recorded context window of a registered Cursor adapter route by wrapping its `resolveModel`, with per-model entries and one provider-wide default.
// SCOPE: Adapter discovery, own-property method wrapping, idempotent re-activation, restore on dispose.
// INPUT: Cordis plugin context with the `llm` service, plus the bundle row config.
// OUTPUT: A patched `resolveModel` on one live adapter instance; nothing else changes.
// KEYWORDS: DOMAIN(10): context-window; DOMAIN(9): cursor-route; CONCEPT(9): runtime-adapter-patch; TECH(7): cordis-effect
// LINKS: USES_API(9): llm.adapters; USES_API(8): llm/adapters-updated; READS_DATA_FROM(7): bundle row config
// LINKS_TO_SPECIFICATION: cursor-to-dsh `lib/models.js:159` (flat 200_000 fallback)
// END_MODULE_CONTRACT

// START_INVARIANTS
// - The adapter instance is never replaced, re-registered, or removed.
// - The original `resolveModel` is called first for every request, so no other model metadata changes.
// - The wrapper is marked on the adapter, so repeated activation reuses it instead of stacking wrappers.
// - The wrapper is reference counted: a disposal that does not reach zero leaves it in place.
// - Disposal that reaches zero restores the adapter to the exact pre-activation shape.
// - No failure path throws into the host: every path logs and returns.
// END_INVARIANTS

// START_RATIONALE
// Q: Why patch the instance method instead of registering a replacing adapter?
// A: `LlmRuntime.registerAdapter` throws `DUPLICATE_ADAPTER` while another adapter owns the
//    route, and `LlmRuntime.forAdapter` compares adapter identity strictly: a replacement
//    loses `replayState` on every historical assistant message and the Cursor session would
//    be rebuilt from scratch. An own property on the existing instance keeps both.
// Q: Why `resolveModel` and not `prepareCall`?
// A: `CursorAdapter` inherits `prepareCall` from `LlmAdapter`, and that implementation calls
//    `this.resolveModel`. Wrapping the narrower method therefore covers every caller -
//    request preparation, `resolveModelInfo`, and discovery - without duplicating the base
//    class contract.
// Q: Why `Symbol.for` instead of a module-local symbol?
// A: Hot reload re-evaluates this module, so a local symbol would be new on every activation
//    and each activation would wrap the previous wrapper. `Symbol.for` lives in the global
//    registry, so the mark survives module identity changes.
// END_RATIONALE

// START_CHANGE_SUMMARY
// LAST_CHANGE: 1.0.0 — initial bundle: wraps one adapter's `resolveModel`, applies the capacity table, and reference-counts the wrapper so a hot reload cannot drop a live patch.
// PREV_CHANGE_SUMMARY: none
// END_CHANGE_SUMMARY

// START_MODULE_MAP:
// CONST [6] Global-registry mark carrying the wrapper record => PATCH_KEY
// CONST [5] Adapter method that every capacity read passes through => METHOD_NAME
// CONST [5] Runtime event emitted after the adapter topology changes => ADAPTERS_EVENT
// FUNCTION [5] Reach the `llm` service from the plugin context => resolveLlm
// FUNCTION [6] Read the registration record of one provider route => registrationOf
// FUNCTION [8] Read the catalog entry of one model without throwing => catalogEntry
// FUNCTION [4] Read the live reference count of a patch record => ownerCount
// FUNCTION [9] Install or reuse the `resolveModel` wrapper on one adapter => installWrapper
// FUNCTION [8] Release one reference and restore the adapter on the last one => restoreWrapper
// FUNCTION [9] Patch the configured route once, failing soft => attemptPatch
// FUNCTION [10] Plugin entry point => apply
// END_MODULE_MAP

// START_USE_CASES:
// - Route repair: operator -> declares the real capacity of one Cursor model -> DSH records it and compacts at the right threshold.
// - Late registration: host -> registers the Cursor adapter after this plugin -> the topology listener patches it.
// - Rollback: operator -> disables the bundle -> the original capacity returns.
// END_USE_CASES

import { contextWindowFor, resolveConfig } from './config.js';
import { createLdd } from './ldd.js';

export const name = 'cursor-context';

export const inject = ['llm'];

const PATCH_KEY = Symbol.for('dsh-cursor-context.patch');
const METHOD_NAME = 'resolveModel';
const ADAPTERS_EVENT = 'llm/adapters-updated';

/**
 * Reach the `llm` service from the plugin context.
 *
 * The service is normally injected, so `ctx.llm` is present and plain property access
 * is enough. The `ctx.get` fallback covers the case where the descriptor is not on the
 * context object itself, and both paths are wrapped: a throwing getter must not abort
 * activation, because an absent service only means there is nothing to patch yet.
 *
 * @param ctx - plugin root context.
 * @returns the `llm` service, or `undefined` when it is unavailable.
 */
// START_FUNCTION_resolveLlm
function resolveLlm(ctx) {
  try {
    if (ctx?.llm !== undefined && ctx.llm !== null) return ctx.llm;
  } catch {
    // fall through to ctx.get
  }
  try {
    const found = ctx?.get?.('llm');
    return found === undefined || found === null ? undefined : found;
  } catch {
    return undefined;
  }
}
// END_FUNCTION_resolveLlm

/**
 * Read the registration record of one provider route.
 *
 * `LlmRuntime.adapters` is a plain `Map` from provider id to a registration object that
 * carries `provider`, `adapter`, and the owning route list. The function accepts only a
 * map-like object with a `get` method and treats every unexpected shape as "no adapter",
 * which keeps a future runtime refactor from turning into a crash.
 *
 * @param llm - the `llm` service.
 * @param provider - provider route id.
 * @returns the registration object, or `undefined`.
 */
// START_FUNCTION_registrationOf
function registrationOf(llm, provider) {
  try {
    const adapters = llm?.adapters;
    if (adapters === undefined || adapters === null || typeof adapters.get !== 'function') return undefined;
    const registration = adapters.get(provider);
    if (registration === undefined || registration === null || typeof registration !== 'object') return undefined;
    return registration;
  } catch {
    return undefined;
  }
}
// END_FUNCTION_registrationOf

/**
 * Read the catalog entry of one model without throwing.
 *
 * The capacity decision needs the entry to tell a self-describing model from a tierless
 * one. `CursorAdapter.models()` is already memoized by the adapter for ten minutes, so a
 * call from inside the wrapper is a map lookup in the common case; the guard matters for
 * the other cases: an adapter whose `models` is missing, a catalog load that rejects, or a
 * return value that is not an array. All of them yield `undefined`, and the capacity
 * table then treats the model as tierless, which is exactly the fallback the adapter would
 * have applied anyway.
 *
 * @param adapter - the patched adapter instance.
 * @param model - exact model id.
 * @returns the catalog entry, or `undefined`.
 */
// START_FUNCTION_catalogEntry
async function catalogEntry(adapter, model) {
  try {
    if (typeof adapter?.models !== 'function') return undefined;
    const models = await adapter.models();
    if (!Array.isArray(models)) return undefined;
    return models.find((entry) => entry !== null && typeof entry === 'object' && entry.id === model);
  } catch {
    return undefined;
  }
}
// END_FUNCTION_catalogEntry

// START_FUNCTION_ownerCount
export function ownerCount(record) {
  const count = Number(record?.owners);
  return Number.isInteger(count) && count > 0 ? count : 0;
}
// END_FUNCTION_ownerCount

/**
 * Install or reuse the `resolveModel` wrapper on one adapter.
 *
 * The function is idempotent by contract. It first looks for a record on the adapter
 * under the global mark. A record means this adapter was already patched - by this
 * activation, by a previous activation that has not been disposed yet, or by a hot reload
 * of this module - so only the record's config is refreshed and nothing is wrapped a
 * second time. Otherwise the function captures the current method, notes whether it was
 * an own property, and defines a new own property that first delegates to the captured
 * function with the adapter as `this` and then asks the capacity table for a replacement.
 *
 * The function does not touch the reference count. Only the caller knows whether it
 * already holds a reference for this adapter, so the caller takes one reference per
 * activation and releases it on disposal; the wrapper is unwrapped by the last release.
 *
 * The wrapper returns a new object with a replaced `context` and never mutates the
 * adapter's result, because callers may freeze or reuse that object. When the table
 * answers "no override" or the value already matches, the original object is returned
 * untouched, so a route with correct metadata pays nothing but one comparison.
 *
 * @param adapter - live adapter instance of the configured provider.
 * @param config - frozen config from {@link resolveConfig}.
 * @param log - LDD logger of this bundle.
 * @returns the patch record, or `undefined` when the adapter cannot be wrapped.
 */
// START_FUNCTION_installWrapper
function installWrapper(adapter, config, log) {
  const existing = adapter[PATCH_KEY];
  if (existing !== undefined && existing !== null && existing.adapter === adapter) {
    // START_BLOCK_REUSE_RECORD: one wrapper per adapter, many activations.
    // The caller owns the reference count: it takes one reference per activation and
    // releases it on disposal, so a hot reload that activates the new copy before the
    // old one is disposed cannot let the old disposal tear down a live wrapper.
    existing.config = config;
    log.emit({ imp: 6, fn: 'installWrapper', block: 'REUSE_RECORD', op: 'state', text: `wrapper already installed on provider "${config.provider}"; config refreshed, owners=${String(ownerCount(existing))}`, status: 'OK' });
    return existing;
    // END_BLOCK_REUSE_RECORD
  }

  const original = adapter[METHOD_NAME];
  if (typeof original !== 'function') {
    log.emit({ imp: 9, fn: 'installWrapper', block: 'NO_METHOD', op: 'guard', text: `adapter of provider "${config.provider}" has no callable ${METHOD_NAME}; route left untouched`, status: 'SKIP' });
    return undefined;
  }

  const record = {
    adapter,
    original,
    config,
    hadOwn: Object.prototype.hasOwnProperty.call(adapter, METHOD_NAME),
    patched: undefined,
    owners: 0,
  };

  // START_BLOCK_DEFINE_WRAPPER: delegate first, then replace only the context capacity.
  const patched = async function resolveModel(provider, model, signal) {
    const resolved = await record.original.call(record.adapter, provider, model, signal);

    // START_BLOCK_CHECK_RESULT: a non-object result is the adapter's business, not ours.
    if (resolved === null || typeof resolved !== 'object') {
      log.emit({ imp: 9, fn: 'resolveModel', block: 'CHECK_RESULT', op: 'guard', text: `provider "${provider}" model "${model}" resolved to a non-object; override skipped`, status: 'SKIP' });
      return resolved;
    }
    // END_BLOCK_CHECK_RESULT

    // START_BLOCK_DECIDE_CAPACITY: the table owns the policy, this wrapper only applies it.
    const entry = await catalogEntry(record.adapter, model);
    const capacity = contextWindowFor(record.config, model, entry);
    if (capacity === undefined) return resolved;
    // END_BLOCK_DECIDE_CAPACITY

    // START_BLOCK_APPLY_CAPACITY: replace the number, keep every other field.
    const previous = resolved.context?.contextWindow;
    if (previous === capacity) return resolved;
    const next = { ...resolved, context: { ...(resolved.context ?? {}), contextWindow: capacity } };
    log.emit({ imp: 10, fn: 'resolveModel', block: 'APPLY_CAPACITY', op: 'business', text: `provider "${provider}" model "${model}" contextWindow ${String(previous)} -> ${String(capacity)} (tiers: ${entry === undefined ? 'unknown entry' : 'none advertised'})`, status: 'OK' });
    return next;
    // END_BLOCK_APPLY_CAPACITY
  };
  // END_BLOCK_DEFINE_WRAPPER

  record.patched = patched;
  try {
    Object.defineProperty(adapter, METHOD_NAME, {
      value: patched,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch (error) {
    log.emit({ imp: 9, fn: 'installWrapper', block: 'DEFINE_WRAPPER', op: 'io', text: `could not define the wrapper on provider "${config.provider}": ${String(error?.message ?? error)}`, status: 'FAIL' });
    return undefined;
  }
  try {
    Object.defineProperty(adapter, PATCH_KEY, { value: record, writable: true, configurable: true, enumerable: false });
  } catch (error) {
    log.emit({ imp: 7, fn: 'installWrapper', block: 'MARK_ADAPTER', op: 'io', text: `wrapper is live but the idempotency mark could not be stored: ${String(error?.message ?? error)}`, status: 'FAIL' });
  }
  log.emit({ imp: 9, fn: 'installWrapper', block: 'DEFINE_WRAPPER', op: 'business', text: `wrapped ${METHOD_NAME} of provider "${config.provider}" (own property before: ${String(record.hadOwn)})`, status: 'OK' });
  return record;
}
// END_FUNCTION_installWrapper

/**
 * Restore the adapter to its pre-activation shape.
 *
 * Restoration is reference counted, because the same wrapper can be shared by several
 * live activations: a hot reload usually activates the new copy of this module before the
 * old copy is disposed. Each call releases exactly one reference, and only the release
 * that reaches zero unwraps the adapter. That release is deliberately narrow as well: it
 * acts only when the method currently on the adapter is still this bundle's wrapper, so if
 * something else replaced it afterwards the newer owner wins and this function does
 * nothing but log. An adapter that originally carried the method as an own property gets
 * that property back; an adapter that inherited it - the normal case, because
 * `CursorAdapter` declares `resolveModel` on its prototype - gets the own property deleted
 * so the prototype method is visible again. The mark is removed last, so a failure in the
 * middle cannot leave an adapter that looks unpatched while it is still wrapped.
 *
 * @param record - patch record created by {@link installWrapper}.
 * @param log - LDD logger of this bundle.
 * @returns nothing; every failure is logged.
 */
// START_FUNCTION_restoreWrapper
function restoreWrapper(record, log) {
  if (record === null || record === undefined) return;
  const adapter = record.adapter;

  // START_BLOCK_RELEASE_REFERENCE: only the last owner may unwrap.
  record.owners = Math.max(0, ownerCount(record) - 1);
  if (record.owners > 0) {
    log.emit({ imp: 7, fn: 'restoreWrapper', block: 'RELEASE_REFERENCE', op: 'state', text: `release recorded; ${String(record.owners)} activation(s) still own the wrapper`, status: 'OK' });
    return;
  }
  // END_BLOCK_RELEASE_REFERENCE

  const current = adapter?.[METHOD_NAME];
  if (current !== record.patched) {
    // START_BLOCK_FOREIGN_OWNER: somebody else owns the method now; leave it alone.
    log.emit({ imp: 7, fn: 'restoreWrapper', block: 'FOREIGN_OWNER', op: 'guard', text: `${METHOD_NAME} was replaced after activation; restore skipped`, status: 'SKIP' });
    return;
    // END_BLOCK_FOREIGN_OWNER
  }

  // START_BLOCK_RESTORE_METHOD: put back exactly what was there before.
  try {
    if (record.hadOwn) {
      Object.defineProperty(adapter, METHOD_NAME, { value: record.original, writable: true, configurable: true, enumerable: false });
    } else {
      delete adapter[METHOD_NAME];
    }
    log.emit({ imp: 8, fn: 'restoreWrapper', block: 'RESTORE_METHOD', op: 'state', text: `original ${METHOD_NAME} restored (own property: ${String(record.hadOwn)})`, status: 'OK' });
  } catch (error) {
    log.emit({ imp: 9, fn: 'restoreWrapper', block: 'RESTORE_METHOD', op: 'state', text: `could not restore ${METHOD_NAME}: ${String(error?.message ?? error)}`, status: 'FAIL' });
  }
  // END_BLOCK_RESTORE_METHOD

  // START_BLOCK_DROP_MARK: the adapter must not keep a stale record.
  try {
    if (adapter[PATCH_KEY] === record) delete adapter[PATCH_KEY];
  } catch {
    // a mark left behind only costs one redundant reuse check on the next activation
  }
  // END_BLOCK_DROP_MARK
}
// END_FUNCTION_restoreWrapper

/**
 * Patch the configured route once, failing soft.
 *
 * This is the whole activation body minus bookkeeping. It resolves the service, finds the
 * registration of the configured provider, and hands the adapter to {@link installWrapper}.
 * Each step can legitimately find nothing: the plugin may activate before `cursor-to-dsh`
 * registers the route, the route may be disabled in the profile, or a future runtime may
 * store adapters differently. In all of those cases the function returns `undefined`, and
 * the caller keeps the topology listener armed so a later registration is still caught.
 *
 * @param ctx - plugin root context.
 * @param config - frozen config.
 * @param log - LDD logger of this bundle.
 * @returns the patch record when the route is patched, otherwise `undefined`.
 */
// START_FUNCTION_attemptPatch
function attemptPatch(ctx, config, log) {
  const llm = resolveLlm(ctx);
  if (llm === undefined) {
    log.emit({ imp: 9, fn: 'attemptPatch', block: 'RESOLVE_SERVICE', op: 'guard', text: 'llm service is unavailable; waiting for a later signal', status: 'SKIP' });
    return undefined;
  }

  // START_BLOCK_FIND_ADAPTER: the route must already be registered by its own bundle.
  const registration = registrationOf(llm, config.provider);
  const adapter = registration?.adapter;
  if (adapter === undefined || adapter === null || typeof adapter !== 'object') {
    log.emit({ imp: 8, fn: 'attemptPatch', block: 'FIND_ADAPTER', op: 'lookup', text: `provider "${config.provider}" has no registered adapter yet`, status: 'SKIP' });
    return undefined;
  }
  // END_BLOCK_FIND_ADAPTER

  return installWrapper(adapter, config, log);
}
// END_FUNCTION_attemptPatch

/**
 * Plugin entry point.
 *
 * The function resolves the config, prints every validation warning once, and then does
 * both activation steps that the runtime allows: an immediate patch attempt, because the
 * bundle list order normally puts this plugin after `cursor-to-dsh`, and one
 * `llm/adapters-updated` listener, because the adapter can also appear later - after a
 * reload, a catalog invalidation, or a profile edit that moves this plugin up. The
 * listener re-runs the same attempt and records the newest record, so disposing the plugin
 * restores whichever adapter it ended up patching.
 *
 * Everything is registered through `ctx.effect`, so a disable, a bundle removal, or a
 * shutdown restores the original method and deletes the mark before the plugin leaves the
 * tree. The function never throws: a route that cannot be patched simply keeps the
 * capacity the adapter produced.
 *
 * @param ctx - plugin root context.
 * @param configInput - bundle row config from `cordis.patch.yml`.
 */
// START_FUNCTION_apply
export function apply(ctx, configInput) {
  const log = createLdd(ctx);
  const config = resolveConfig(configInput);

  // START_BLOCK_CONFIG_REPORT: an operator must see why a declared value was dropped.
  for (const warning of config.warnings) {
    log.emit({ imp: 7, fn: 'apply', block: 'CONFIG_REPORT', op: 'config', text: warning, status: 'REJECT' });
  }
  if (!config.enabled) {
    log.emit({ imp: 6, fn: 'apply', block: 'CONFIG_REPORT', op: 'config', text: 'disabled by config; the route keeps the capacity the adapter reports', status: 'SKIP' });
    return;
  }
  // END_BLOCK_CONFIG_REPORT

  // START_BLOCK_PATCH_NOW: the common case, the adapter is already registered.
  const held = new Map();
  const patch = () => {
    const record = attemptPatch(ctx, config, log);
    if (record === undefined) return record;
    // START_BLOCK_TAKE_REFERENCE: one reference per adapter per activation, no matter
    // how often the topology event fires while this activation is live.
    if (held.has(record) === false) {
      record.owners = ownerCount(record) + 1;
      held.set(record, true);
    }
    // END_BLOCK_TAKE_REFERENCE
    return record;
  };
  const first = patch();
  // END_BLOCK_PATCH_NOW

  // START_BLOCK_LISTEN_TOPOLOGY: a late or renewed registration is patched as well.
  const onTopology = () => {
    try {
      patch();
    } catch (error) {
      log.emit({ imp: 8, fn: 'apply', block: 'LISTEN_TOPOLOGY', op: 'event', text: `topology listener failed: ${String(error?.message ?? error)}`, status: 'FAIL' });
    }
    return undefined;
  };
  try {
    const disposeListener = ctx.on(ADAPTERS_EVENT, onTopology);
    if (typeof disposeListener === 'function') {
      ctx.effect(() => () => {
        try {
          disposeListener();
        } catch {
          // the host may already have dropped the listener
        }
      });
    }
  } catch (error) {
    log.emit({ imp: 7, fn: 'apply', block: 'LISTEN_TOPOLOGY', op: 'io', text: `could not subscribe to ${ADAPTERS_EVENT}: ${String(error?.message ?? error)}`, status: 'FAIL' });
  }
  // END_BLOCK_LISTEN_TOPOLOGY

  // START_BLOCK_DISPOSE: releasing the references is the only rollback needed.
  try {
    ctx.effect(() => () => {
      // Every held adapter is released, because the topology listener may have patched
      // more than one instance when a route was re-registered. The wrapper survives
      // while another activation of this bundle still holds a reference to it.
      for (const record of [...held.keys()]) restoreWrapper(record, log);
      held.clear();
    });
  } catch (error) {
    log.emit({ imp: 9, fn: 'apply', block: 'DISPOSE', op: 'io', text: `could not register the restore effect: ${String(error?.message ?? error)}`, status: 'FAIL' });
  }
  // END_BLOCK_DISPOSE

  // START_BLOCK_ACTIVATION_SUMMARY: one line that tells an operator what is live.
  const models = Object.keys(config.contextWindows);
  log.emit({
    imp: 9,
    fn: 'apply',
    block: 'ACTIVATION_SUMMARY',
    op: 'business',
    text: `provider="${config.provider}" defaultContextWindow=${String(config.defaultContextWindow)} entries=[${models.join(', ')}] patched=${String(first !== undefined)}`,
    status: first === undefined ? 'SKIP' : 'OK',
  });
  // END_BLOCK_ACTIVATION_SUMMARY
}
// END_FUNCTION_apply

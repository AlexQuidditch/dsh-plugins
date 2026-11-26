/**
 * Activation test for the `cursor-context` host plugin.
 *
 * No DSH runtime is mounted. A fake Cordis-like context exposes an `llm` service whose
 * `adapters` map holds a fake Cursor adapter whose `resolveModel` lives on a prototype - the
 * same shape the real `CursorAdapter` has. The test drives the plugin through the four
 * situations that matter: activation after the adapter (the normal order), activation before
 * it (the topology listener), repeated activation (the idempotency mark), and disposal (the
 * restored method). It also checks that the wrapper changes nothing but the capacity.
 *
 * Run: node activation.test.mjs
 */

const plugin = await import('./lib/index.js');

let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log('ok  -', name);
    return;
  }
  failed += 1;
  console.log('FAIL -', name, detail);
}

const TIERLESS = {
  id: 'deepseek-v41-flash-1017',
  displayName: 'DeepSeek V4.1 Flash',
  parameters: [{ id: 'reasoning_effort', values: ['none', 'low', 'medium', 'high', 'max'] }],
};
const TIERED = { id: 'grok-4.7', displayName: 'Grok 4.7', parameters: [{ id: 'context', values: ['256k', '500k'] }] };

/** A stand-in with the exact prototype shape of the real adapter. */
class FakeCursorAdapter {
  constructor(catalog) {
    this.catalog = catalog;
    this.calls = 0;
  }

  async models() {
    return this.catalog;
  }

  async resolveModel(provider, model) {
    this.calls += 1;
    const entry = this.catalog.find((m) => m.id === model);
    const tier = entry?.parameters?.find((p) => p.id === 'context');
    const tiered = Array.isArray(tier?.values) ? tier.values : [];
    const info = {
      provider,
      id: model,
      name: entry?.displayName ?? model,
      inputModalities: ['text', 'image'],
      context: { contextWindow: tiered.length > 0 ? 256_000 : 200_000 },
      systemPromptUpdate: 'in-history',
      reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
    };
    return info;
  }
}

function makeCtx(services = {}) {
  const state = { listeners: new Map(), effects: [], infos: [], warns: [] };
  const ctx = {
    logger: {
      info: (line) => state.infos.push(String(line)),
      warn: (line) => state.warns.push(String(line)),
    },
    on(event, listener) {
      state.listeners.set(event, listener);
      return () => state.listeners.delete(event);
    },
    get(serviceName) {
      return services[serviceName];
    },
    effect(factory) {
      const dispose = factory();
      if (typeof dispose === 'function') state.effects.push(dispose);
      return dispose;
    },
    ...(services.llm === undefined ? {} : { llm: services.llm }),
  };
  return { ctx, state };
}

function makeLlm(adapters = new Map()) {
  return { adapters };
}

const allLines = (state) => [...state.infos, ...state.warns].join('\n');

// ── 1. the normal order: the adapter is already registered ──────────────────

{
  const adapter = new FakeCursorAdapter([TIERLESS, TIERED]);
  const llm = makeLlm(new Map([['cursor', { provider: { id: 'cursor' }, adapter }]]));
  const { ctx, state } = makeCtx({ llm });
  plugin.apply(ctx, { contextWindows: { 'deepseek-v41-flash-1017': 1_048_576 } });

  const info = await adapter.resolveModel('cursor', 'deepseek-v41-flash-1017');
  check('tierless model records the declared capacity', info.context.contextWindow === 1_048_576, JSON.stringify(info.context));
  check('every other field survives the wrapper', info.name === 'DeepSeek V4.1 Flash' && info.systemPromptUpdate === 'in-history' && info.reasoning?.defaultEffort === 'high', JSON.stringify(info));
  check('modalities are untouched', Array.isArray(info.inputModalities) && info.inputModalities.length === 2, JSON.stringify(info.inputModalities));

  const tiered = await adapter.resolveModel('cursor', 'grok-4.7');
  check('a self-describing model keeps the adapter number under the provider default', tiered.context.contextWindow === 256_000, JSON.stringify(tiered.context));

  const original = await FakeCursorAdapter.prototype.resolveModel.call(adapter, 'cursor', 'deepseek-v41-flash-1017');
  check('the adapter still computes its own fallback', original.context.contextWindow === 200_000, JSON.stringify(original.context));
  check('the wrapper is an own property', Object.prototype.hasOwnProperty.call(adapter, 'resolveModel'));
  check('the prototype was not modified', Object.prototype.hasOwnProperty.call(FakeCursorAdapter.prototype, 'resolveModel'));
  check('the topology listener is armed', state.listeners.has('llm/adapters-updated'));
  check('the activation summary reports the patch', allLines(state).includes('ACTIVATION_SUMMARY') && allLines(state).includes('patched=true'), allLines(state));
}

// ── 2. the late order: the adapter appears after activation ─────────────────

{
  const adapters = new Map();
  const { ctx, state } = makeCtx({ llm: makeLlm(adapters) });
  plugin.apply(ctx, {});
  check('activation without an adapter does not throw and reports a skip', allLines(state).includes('FIND_ADAPTER') && allLines(state).includes('[SKIP]'), allLines(state));

  const adapter = new FakeCursorAdapter([TIERLESS]);
  adapters.set('cursor', { provider: { id: 'cursor' }, adapter });
  const listener = state.listeners.get('llm/adapters-updated');
  check('topology listener is a function', typeof listener === 'function');
  listener();

  const info = await adapter.resolveModel('cursor', 'deepseek-v41-flash-1017');
  check('a late registration is patched by the listener', info.context.contextWindow === 1_048_576, JSON.stringify(info.context));
}

// ── 3. repeated activation reuses one wrapper ──────────────────────────────

{
  const adapter = new FakeCursorAdapter([TIERLESS]);
  const { ctx, state } = makeCtx({ llm: makeLlm(new Map([['cursor', { provider: { id: 'cursor' }, adapter }]])) });
  plugin.apply(ctx, {});
  const firstPatched = adapter.resolveModel;
  plugin.apply(ctx, {});
  check('a second activation reuses the wrapper instead of stacking one', adapter.resolveModel === firstPatched, 'the method identity changed');
  check('the reuse path is logged', allLines(state).includes('REUSE_RECORD'), allLines(state));
  const info = await adapter.resolveModel('cursor', 'deepseek-v41-flash-1017');
  check('the reused wrapper still applies the capacity', info.context.contextWindow === 1_048_576, JSON.stringify(info.context));
}

// ── 4. disposal restores the inherited method ──────────────────────────────

{
  const adapter = new FakeCursorAdapter([TIERLESS]);
  const { ctx, state } = makeCtx({ llm: makeLlm(new Map([['cursor', { provider: { id: 'cursor' }, adapter }]])) });
  plugin.apply(ctx, {});
  check('the route is patched before disposal', (await adapter.resolveModel('cursor', 'deepseek-v41-flash-1017')).context.contextWindow === 1_048_576);

  for (const dispose of state.effects) dispose();
  check('disposal removes the own property', Object.prototype.hasOwnProperty.call(adapter, 'resolveModel') === false);
  check('disposal drops the idempotency mark', adapter[Symbol.for('dsh-cursor-context.patch')] === undefined);
  check('the original number is back', (await adapter.resolveModel('cursor', 'deepseek-v41-flash-1017')).context.contextWindow === 200_000);
  check('the topology listener is gone', state.listeners.has('llm/adapters-updated') === false);
}

// ── 5. a disable keeps the route untouched ─────────────────────────────────

{
  const adapter = new FakeCursorAdapter([TIERLESS]);
  const { ctx, state } = makeCtx({ llm: makeLlm(new Map([['cursor', { provider: { id: 'cursor' }, adapter }]])) });
  plugin.apply(ctx, { enabled: false });
  check('disabled plugin wraps nothing', Object.prototype.hasOwnProperty.call(adapter, 'resolveModel') === false);
  check('disabled plugin arms no listener', state.listeners.size === 0);
  check('the original number stands', (await adapter.resolveModel('cursor', 'deepseek-v41-flash-1017')).context.contextWindow === 200_000);
}

// ── 6. broken surroundings degrade without throwing ───────────────────────

{
  const { ctx } = makeCtx({});
  let threw = false;
  try {
    plugin.apply(ctx, {});
  } catch {
    threw = true;
  }
  check('a missing llm service does not throw', threw === false);

  // A dedicated class without the method: the shared prototype must stay intact
  // because the later blocks rely on the inherited method.
  class MethodlessAdapter {
    constructor(catalog) {
      this.catalog = catalog;
    }

    async models() {
      return this.catalog;
    }
  }
  const methodless = new MethodlessAdapter([TIERLESS]);
  const { ctx: second, state: secondState } = makeCtx({ llm: makeLlm(new Map([['cursor', { provider: { id: 'cursor' }, adapter: methodless }]])) });
  threw = false;
  try {
    plugin.apply(second, {});
  } catch {
    threw = true;
  }
  check('an adapter without resolveModel does not throw', threw === false);
  check('the missing method is reported as a skip', allLines(secondState).includes('NO_METHOD'), allLines(secondState));
  check('no own property was added', Object.prototype.hasOwnProperty.call(methodless, 'resolveModel') === false);
  check('the shared adapter class keeps its prototype method', typeof FakeCursorAdapter.prototype.resolveModel === 'function');
}

// ── 7. a throwing delegate leaves the request alone ────────────────────────

{
  class ThrowingAdapter extends FakeCursorAdapter {
    async resolveModel() {
      throw new Error('catalog unavailable (stub)');
    }
  }
  const adapter = new ThrowingAdapter([TIERLESS]);
  const { ctx } = makeCtx({ llm: makeLlm(new Map([['cursor', { provider: { id: 'cursor' }, adapter }]])) });
  plugin.apply(ctx, {});
  let caught;
  try {
    await adapter.resolveModel('cursor', 'deepseek-v41-flash-1017');
  } catch (error) {
    caught = error;
  }
  check('the wrapper rethrows the adapter failure instead of hiding it', caught instanceof Error && caught.message.includes('catalog unavailable'), String(caught));
}

// ── 8. a non-object delegate result is passed through ─────────────────────

{
  class OddAdapter extends FakeCursorAdapter {
    async resolveModel() {
      return 'not-an-object';
    }
  }
  const adapter = new OddAdapter([TIERLESS]);
  const { ctx, state } = makeCtx({ llm: makeLlm(new Map([['cursor', { provider: { id: 'cursor' }, adapter }]])) });
  plugin.apply(ctx, {});
  const result = await adapter.resolveModel('cursor', 'deepseek-v41-flash-1017');
  check('an odd result is returned unchanged', result === 'not-an-object', String(result));
  check('the odd result is reported', allLines(state).includes('CHECK_RESULT'), allLines(state));
}

// ── 9. a re-registered route is patched too, and disposal restores both ────

{
  const adapters = new Map();
  const firstAdapter = new FakeCursorAdapter([TIERLESS]);
  adapters.set('cursor', { provider: { id: 'cursor' }, adapter: firstAdapter });
  const { ctx, state } = makeCtx({ llm: makeLlm(adapters) });
  plugin.apply(ctx, {});

  // The route is re-registered: a new adapter instance replaces the old one.
  const secondAdapter = new FakeCursorAdapter([TIERLESS]);
  adapters.set('cursor', { provider: { id: 'cursor' }, adapter: secondAdapter });
  state.listeners.get('llm/adapters-updated')();

  check('the re-registered adapter is patched as well', (await secondAdapter.resolveModel('cursor', 'deepseek-v41-flash-1017')).context.contextWindow === 1_048_576);
  check('the first adapter keeps its wrapper', (await firstAdapter.resolveModel('cursor', 'deepseek-v41-flash-1017')).context.contextWindow === 1_048_576);

  for (const dispose of state.effects) dispose();
  const restoredSecond = await secondAdapter.resolveModel('cursor', 'deepseek-v41-flash-1017');
  const restoredFirst = await firstAdapter.resolveModel('cursor', 'deepseek-v41-flash-1017');
  check('disposal restores the re-registered adapter', Object.prototype.hasOwnProperty.call(secondAdapter, 'resolveModel') === false && restoredSecond.context.contextWindow === 200_000, JSON.stringify(restoredSecond.context));
  check('disposal restores the first adapter too', Object.prototype.hasOwnProperty.call(firstAdapter, 'resolveModel') === false && restoredFirst.context.contextWindow === 200_000, JSON.stringify(restoredFirst.context));
}

// ── 10. a hot reload that overlaps does not lose the wrapper ───────────────

{
  const adapter = new FakeCursorAdapter([TIERLESS]);
  const { ctx: first, state: firstState } = makeCtx({ llm: makeLlm(new Map([['cursor', { provider: { id: 'cursor' }, adapter }]])) });
  const { ctx: second, state: secondState } = makeCtx({ llm: makeLlm(new Map([['cursor', { provider: { id: 'cursor' }, adapter }]])) });

  plugin.apply(first, {});
  plugin.apply(second, {});
  check('the overlapping activation reuses the live wrapper', secondState.infos.some((line) => line.includes('REUSE_RECORD')), secondState.infos.join('\n'));

  // The new activation is applied, then the old one is torn down.
  for (const dispose of firstState.effects) dispose();
  const survivors = await adapter.resolveModel('cursor', 'deepseek-v41-flash-1017');
  check('the wrapper survives the teardown of the superseded activation', survivors.context.contextWindow === 1_048_576, JSON.stringify(survivors.context));
  check('the wrapper stays installed while a reference is held', Object.prototype.hasOwnProperty.call(adapter, 'resolveModel'));

  for (const dispose of secondState.effects) dispose();
  const released = await adapter.resolveModel('cursor', 'deepseek-v41-flash-1017');
  check('the last teardown restores the original', released.context.contextWindow === 200_000 && Object.prototype.hasOwnProperty.call(adapter, 'resolveModel') === false, JSON.stringify(released.context));
}

// ── 11. LDD lines carry the documented grammar ──────────────────────────────
{
  const adapter = new FakeCursorAdapter([TIERLESS]);
  const { ctx, state } = makeCtx({ llm: makeLlm(new Map([['cursor', { provider: { id: 'cursor' }, adapter }]])) });
  plugin.apply(ctx, { contextWindows: { broken: 'lots' } });
  await adapter.resolveModel('cursor', 'deepseek-v41-flash-1017');
  const lines = [...state.infos, ...state.warns];
  const grammar = /^\[cursor-context\]\[IMP:\d{1,2}\]\[[^\]]+\]\[[^\]]+\]\[[^\]]+\] .+ \[(OK|SKIP|FAIL|REJECT)\]$/;
  const structured = lines.filter((line) => line.includes('[IMP:'));
  check('structured lines were emitted', structured.length >= 3, String(structured.length));
  check('every structured line matches the LDD grammar', structured.every((line) => grammar.test(line)), structured.find((line) => !grammar.test(line)));
  check('a rejected config value reaches the warn level', state.warns.some((line) => line.includes('REJECT')), state.warns.join(' | '));
  check('no IMP value escapes the 1-10 band', structured.every((line) => {
    const value = Number(/\[IMP:(\d+)\]/.exec(line)?.[1]);
    return Number.isInteger(value) && value >= 1 && value <= 10;
  }));
}

if (failed > 0) {
  console.log(`\n${failed} проверок не прошло`);
  process.exit(1);
}
console.log('\nOK: cursor-context wraps one adapter in place, applies the capacity table, survives a late registration, and restores the original method on dispose');

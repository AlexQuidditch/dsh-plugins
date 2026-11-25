/**
 * Activation test for the provider-retry host plugin.
 *
 * No DSH runtime is mounted: a fake Cordis-like context captures the
 * `agent/request-error` listener, and a fake `schedule` service records the
 * durable task the plugin creates. The pure parsing logic is covered by
 * tests/errors.test.mjs.
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

const ZAI_429 =
  '429: {"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-11-18 05:13:16"}';
const EXPECTED_AT = '2026-11-17T21:14:46.000Z'; // 2026-11-18 05:13:16 +08:00 + 90 s grace

function makeSchedule(options = {}) {
  const calls = [];
  return {
    calls,
    items: options.items ?? [],
    failList: options.failList === true,
    failCreate: options.failCreate === true,
    async list() {
      if (this.failList) throw new Error('list failed (stub)');
      return { items: this.items };
    },
    async create(request, actorSessionId) {
      calls.push({ request, actorSessionId });
      if (this.failCreate) throw new Error('create failed (stub)');
      return { id: 'task-1', ...request };
    },
  };
}

function makeAgent(options = {}) {
  const header = {
    ...(options.delegationDepth === undefined ? {} : { delegationDepth: options.delegationDepth }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    ...(options.parentSession === undefined ? {} : { parentSession: options.parentSession }),
  };
  return {
    id: options.id ?? 'session-root',
    session: { header },
    model: { current: () => ({ provider: 'zai', model: options.model ?? 'glm-5.3' }) },
  };
}

function makeCtx(services = {}) {
  const state = {
    listeners: new Map(),
    effects: [],
    infos: [],
    warns: [],
  };
  const ctx = {
    logger: {
      info: (...args) => state.infos.push(args.map(String).join(' ')),
      warn: (...args) => state.warns.push(args.map(String).join(' ')),
    },
    on(event, listener) {
      state.listeners.set(event, listener);
      return () => state.listeners.delete(event);
    },
    get(name) {
      return services[name];
    },
    effect(factory) {
      const dispose = factory();
      state.effects.push(dispose);
      return dispose;
    },
  };
  ctx.listeners = state.listeners;
  return { ctx, state };
}

const zaiFailure = { code: 'QUOTA', message: ZAI_429 };
const makePayload = (agent, failure = zaiFailure) => ({ agent, provider: 'zai', failure, signal: new AbortController().signal });
const noopNext = async () => ({ kind: 'noop' });

async function dispatch(ctx, payload, next = noopNext) {
  const listener = ctx.listeners?.get('agent/request-error');
  if (typeof listener !== 'function') throw new Error('request-error listener was not registered');
  return listener(payload, next);
}

// ── 1. quota failure schedules one durable task and stays out of the retry chain ──

{
  const schedule = makeSchedule();
  const { ctx, state } = makeCtx({ schedule });
  plugin.apply(ctx, {});
  check('listener registered', state.listeners.has('agent/request-error'));

  const agent = makeAgent();
  let nextCalls = 0;
  const decision = await dispatch(ctx, makePayload(agent), async () => {
    nextCalls += 1;
    return { kind: 'retry' };
  });

  check('quota failure does not ask the loop to retry in-turn', decision === undefined && nextCalls === 0, String(decision));
  check('exactly one schedule task created', schedule.calls.length === 1, String(schedule.calls.length));
  const call = schedule.calls[0];
  check('task target is the failed Session', call?.request?.target?.kind === 'session' && call.request.target.sessionId === 'session-root', JSON.stringify(call?.request?.target));
  check('actor Session suppresses the change notice', call?.actorSessionId === 'session-root', String(call?.actorSessionId));
  check('timing is the provider reset plus grace', call?.request?.timing?.kind === 'at' && call.request.timing.at === EXPECTED_AT, JSON.stringify(call?.request?.timing));
  check('title names provider/model and starts with the marker', typeof call?.request?.title === 'string' && call.request.title.startsWith('[retry] zai/glm-5.3'), String(call?.request?.title));
  check('prompt carries the provider error and the resume instruction', typeof call?.request?.prompt === 'string' && call.request.prompt.includes('Usage limit reached') && call.request.prompt.includes('Продолжи прерванную задачу') && call.request.prompt.includes('provider-retry'), String(call?.request?.prompt).slice(0, 120));
}

// ── 2. a pending task is not stacked ────────────────────────────────────────

{
  const schedule = makeSchedule({ items: [{ id: 'old-task', title: '[retry] zai/glm-5.3 → 2026-11-17 05:13:16', target: { kind: 'session', sessionId: 'session-root' } }] });
  const { ctx } = makeCtx({ schedule });
  plugin.apply(ctx, {});
  const decision = await dispatch(ctx, makePayload(makeAgent()));
  check('an already pending retry keeps the turn closed without a duplicate task', decision === undefined && schedule.calls.length === 0, `calls=${schedule.calls.length}`);
}

// ── 3. non-quota and short rate limits continue the waterfall ──────────────

{
  const schedule = makeSchedule();
  const { ctx } = makeCtx({ schedule });
  plugin.apply(ctx, {});
  let nextCalled = false;
  const decision = await dispatch(ctx, makePayload(makeAgent(), { code: 'INVALID_REQUEST', message: '400: invalid request' }), async () => {
    nextCalled = true;
    return { kind: 'retry' };
  });
  check('non-quota failure continues to the built-in retry chain', nextCalled === true && decision?.kind === 'retry', String(decision));
  check('non-quota failure creates no task', schedule.calls.length === 0);

  nextCalled = false;
  await dispatch(ctx, { ...makePayload(makeAgent()), failure: { code: 'RATE_LIMIT', message: '429: rate limited', providerRetryAfterMs: 5000 } }, async () => {
    nextCalled = true;
  });
  check('short rate limit continues to the in-turn retry policy', nextCalled === true);
  check('short rate limit creates no task', schedule.calls.length === 0);
}

// ── 4. failures degrade softly to the unmodified path ──────────────────────

{
  // No schedule service at all.
  const { ctx } = makeCtx({});
  plugin.apply(ctx, {});
  let nextCalled = false;
  await dispatch(ctx, makePayload(makeAgent()), async () => {
    nextCalled = true;
  });
  check('missing schedule service falls back to next()', nextCalled === true);

  // schedule.create throws.
  const schedule = makeSchedule({ failCreate: true });
  const second = makeCtx({ schedule });
  plugin.apply(second.ctx, {});
  nextCalled = false;
  await dispatch(second.ctx, makePayload(makeAgent()), async () => {
    nextCalled = true;
  });
  check('rejected schedule write falls back to next()', nextCalled === true);

  // list throws: dedupe must not block the retry.
  const listing = makeSchedule({ failList: true });
  const third = makeCtx({ schedule: listing });
  plugin.apply(third.ctx, {});
  await dispatch(third.ctx, makePayload(makeAgent()));
  check('failed task listing still attempts the retry', listing.calls.length === 1, String(listing.calls.length));

  // Turn already aborted.
  const aborted = makeSchedule();
  const fourth = makeCtx({ schedule: aborted });
  plugin.apply(fourth.ctx, {});
  const controller = new AbortController();
  controller.abort();
  nextCalled = false;
  await dispatch(fourth.ctx, { ...makePayload(makeAgent()), signal: controller.signal }, async () => {
    nextCalled = true;
  });
  check('aborted turn is not rescheduled', nextCalled === true && aborted.calls.length === 0);
}

// ── 5. delegated children: skipped by default, retargeted to the ancestor ──

{
  const schedule = makeSchedule();
  const { ctx } = makeCtx({ schedule });
  plugin.apply(ctx, {});
  let nextCalled = false;
  await dispatch(ctx, makePayload(makeAgent({ id: 'session-child', delegationDepth: 1, parentSession: 'session-parent' })), async () => {
    nextCalled = true;
  });
  check('delegated child is skipped by default', nextCalled === true && schedule.calls.length === 0);

  const ancestorSchedule = makeSchedule();
  const parent = { id: 'session-parent', session: { header: {} } };
  const parentCtx = makeCtx({ schedule: ancestorSchedule, agents: new Map([['session-parent', parent]]) });
  plugin.apply(parentCtx.ctx, { subagentPolicy: 'ancestor' });
  await dispatch(parentCtx.ctx, makePayload(makeAgent({ id: 'session-child', delegationDepth: 1, parentSession: 'session-parent' })));
  check('subagentPolicy=ancestor retargets the durable task to the root Session', ancestorSchedule.calls.length === 1 && ancestorSchedule.calls[0].request.target.sessionId === 'session-parent', JSON.stringify(ancestorSchedule.calls));
}

// ── 6. disabled config, cleanup, and the exact Z.ai prompt payload ──────────

{
  const schedule = makeSchedule();
  const { ctx, state } = makeCtx({ schedule });
  plugin.apply(ctx, { enabled: false });
  check('disabled plugin registers no listener', state.listeners.size === 0);

  const active = makeCtx({ schedule: makeSchedule() });
  plugin.apply(active.ctx, {});
  check('listener exists before cleanup', active.state.listeners.size === 1);
  for (const dispose of active.state.effects) dispose();
  check('cleanup removes the listener', active.state.listeners.size === 0);

  const timed = makeSchedule();
  const timedCtx = makeCtx({ schedule: timed });
  plugin.apply(timedCtx.ctx, {});
  await dispatch(timedCtx.ctx, makePayload(makeAgent()));
  const created = timed.calls[0]?.request;
  check('default config sends the provider wall clock in the prompt', typeof created?.prompt === 'string' && created.prompt.includes('Asia/Shanghai') && created.prompt.includes('05:13:16'), String(created?.prompt));
}

if (failed > 0) {
  console.log(`\n${failed} проверок не прошло`);
  process.exit(1);
}
console.log('\nOK: provider-retry registers on agent/request-error, schedules one durable retry at the parsed reset instant, dedupes, and degrades softly');

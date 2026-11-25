import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRetryPrompt,
  extractFailureBody,
  formatInZone,
  formatPlanTitle,
  parseResetHints,
  resolveConfig,
  resolveRetryPlan,
  statusOf,
  timeZoneForProvider,
  wallTimeToInstant,
} from '../lib/errors.js';

const ZAI_429 =
  '429: {"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-11-17 05:13:16"}';
const ZAI_CN_429 =
  '429: {"code":"1308","message":"已达到 5 小时的使用上限，您的限额将在 2026-11-16 08:55:45 重置."}';
const NOW = new Date('2026-11-16T20:00:00.000Z');

const config = (overrides = {}) => resolveConfig(overrides);
const plan = (failure, overrides = {}) =>
  resolveRetryPlan(
    {
      failure,
      provider: overrides.provider ?? 'zai',
      model: overrides.model ?? 'glm-5.3',
      now: overrides.now ?? NOW,
    },
    overrides.config ?? config(),
  );

test('config: Z.ai resets are interpreted in Asia/Shanghai, unknown providers in UTC', () => {
  const resolved = config();
  assert.equal(timeZoneForProvider('zai', resolved), 'Asia/Shanghai');
  assert.equal(timeZoneForProvider('unknown', resolved), 'UTC');
  assert.equal(config({ providerTimeZones: { zai: 'UTC' } }).providerTimeZones.zai, 'UTC');
});

test('config: sanitizes values and keeps the disable switch', () => {
  const resolved = config({ enabled: false, graceSeconds: -5, subagentPolicy: 'weird', titlePrefix: '  ' });
  assert.equal(resolved.enabled, false);
  assert.equal(resolved.graceSeconds, 0);
  assert.equal(resolved.subagentPolicy, 'skip');
  assert.equal(resolved.titlePrefix, '[retry]');
});

test('statusOf reads an HTTP status from the failure or its message prefix', () => {
  assert.equal(statusOf({ status: 402 }, 'oops'), 402);
  assert.equal(statusOf({}, '429: something'), 429);
  assert.equal(statusOf({}, 'plain text'), undefined);
});

test('extractFailureBody reads top-level and nested provider JSON', () => {
  assert.deepEqual(
    { code: extractFailureBody(ZAI_429).code, message: extractFailureBody(ZAI_429).message },
    { code: '1308', message: 'Usage limit reached for 5 hour. Your limit will reset at 2026-11-17 05:13:16' },
  );
  const nested = extractFailureBody('403: {"error":{"code":403,"message":"Budget exceeded","metadata":{"resets_at":"2026-11-17T00:00:00Z"}}}');
  assert.equal(nested.code, '403');
  assert.equal(nested.resetsAt, '2026-11-17T00:00:00Z');
  assert.equal(extractFailureBody('no json here').code, undefined);
});

test('timezone conversion matches the Z.ai +08:00 reset evidence', () => {
  assert.equal(wallTimeToInstant({ year: 2026, month: 11, day: 17, hour: 5, minute: 13, second: 16 }, 'Asia/Shanghai').toISOString(), '2026-11-16T21:13:16.000Z');
  assert.equal(wallTimeToInstant({ year: 2026, month: 11, day: 17, hour: 5, minute: 13, second: 16 }, 'UTC').toISOString(), '2026-11-17T05:13:16.000Z');
});

test('Z.ai 429 code 1308: reset stamp becomes a grace-padded schedule instant', () => {
  const result = plan({ code: 'QUOTA', message: ZAI_429 });
  assert.equal(result.action, 'schedule');
  assert.equal(result.at.toISOString(), '2026-11-16T21:14:46.000Z');
  assert.equal(result.resetAt.toISOString(), '2026-11-16T21:13:16.000Z');
  assert.equal(result.source, 'reset-at-naive');
  assert.equal(result.quota, true);
  assert.equal(result.bodyCode, '1308');
  assert.equal(result.zone, 'Asia/Shanghai');
});

test('Z.ai 5-hour quota is recognized by code even when the message carries no reset stamp', () => {
  const result = plan({ code: 'QUOTA', message: '429: {"code":"1308","message":"usage limit reached"}' });
  assert.equal(result.action, 'delegate');
  assert.equal(result.reason, 'no-reset-hint');
});

test('Chinese Z.ai wording also parses', () => {
  const result = plan({ code: 'QUOTA', message: ZAI_CN_429 });
  assert.equal(result.action, 'schedule');
  assert.equal(result.resetAt.toISOString(), '2026-11-16T00:55:45.000Z');
});

test('explicit offsets and Z are never shifted by the provider zone', () => {
  const z = plan({ code: 'QUOTA', message: '429: {"code":"1308","message":"reset at 2026-11-17T05:13:16Z"}' });
  assert.equal(z.resetAt.toISOString(), '2026-11-17T05:13:16.000Z');
  const offset = plan({ code: 'QUOTA', message: '429: {"code":"1308","message":"resets at 2026-11-17 05:13:16 +02:00"}' });
  assert.equal(offset.resetAt.toISOString(), '2026-11-17T03:13:16.000Z');
});

test('providerRetryAfterMs wins and a long Retry-After is scheduled', () => {
  const result = plan({ code: 'RATE_LIMIT', message: '429: rate limited', providerRetryAfterMs: 600000 });
  assert.equal(result.action, 'schedule');
  assert.equal(result.source, 'providerRetryAfterMs');
  assert.equal(result.at.toISOString(), '2026-11-16T20:11:30.000Z');
  assert.equal(result.quota, false);
});

test('a short Retry-After stays with the in-turn retry policy', () => {
  const result = plan({ code: 'RATE_LIMIT', message: '429: rate limited', providerRetryAfterMs: 5000 });
  assert.equal(result.action, 'delegate');
  assert.equal(result.reason, 'short-rate-limit');
});

test('relative reset hints are honored', () => {
  const result = plan({ code: 'QUOTA', message: '429: {"code":"1308","message":"limit hit, retry after 30 seconds"}' });
  assert.equal(result.action, 'schedule');
  assert.equal(result.source, 'relative-in-message');
  assert.equal(result.at.toISOString(), '2026-11-16T20:02:00.000Z');
});

test('OpenRouter metadata.resets_at is scheduled even on 403', () => {
  const result = plan(
    { code: 'QUOTA', message: '403: {"error":{"code":403,"message":"Budget exceeded","metadata":{"resets_at":"2026-11-17T00:00:00.000Z"}}}' },
    { provider: 'openrouter', config: config({ maxDelayMinutes: 60 * 24 * 8 }) },
  );
  assert.equal(result.action, 'schedule');
  assert.equal(result.resetAt.toISOString(), '2026-11-17T00:00:00.000Z');
  assert.equal(result.zone, 'UTC');
});

test('OpenRouter terminal credit/key limits are not scheduled', () => {
  const result = plan({ message: '402: {"error":{"code":402,"message":"Insufficient credits","metadata":{"limit_source":"openrouter_credits"}}}' }, { provider: 'openrouter' });
  assert.equal(result.action, 'delegate');
  assert.equal(result.reason, 'terminal-budget-limit');
});

test('DeepSeek insufficient balance is terminal, quota without reset is not scheduled by default', () => {
  const balance = plan({ code: 'QUOTA', message: '402: {"error":{"message":"Insufficient Balance"}}' }, { provider: 'deepseek' });
  assert.equal(balance.action, 'delegate');
  assert.equal(balance.reason, 'insufficient-balance');
  const quota = plan({ code: 'ACCOUNT_QUOTA', message: '402: account quota exhausted' }, { provider: 'deepseek' });
  assert.equal(quota.action, 'delegate');
  assert.equal(quota.reason, 'no-reset-hint');
});

test('scheduleWithoutReset uses the 5-hour estimate for Z.ai 1308', () => {
  const result = plan(
    { code: 'QUOTA', message: '429: {"code":"1308","message":"Usage limit reached for 5 hour."}' },
    { config: config({ scheduleWithoutReset: true, fiveHourFallbackMinutes: 300 }) },
  );
  assert.equal(result.action, 'schedule');
  assert.equal(result.source, 'fallback-300m');
  assert.equal(result.at.toISOString(), '2026-11-17T01:01:30.000Z');
});

test('Z.ai 1113 insufficient balance is terminal even with a 429 status', () => {
  const result = plan({ code: 'QUOTA', message: '429: {"code":"1113","message":"Insufficient balance"}' });
  assert.equal(result.action, 'delegate');
  assert.equal(result.reason, 'terminal-provider-code');
});

test('non-quota failures and auth failures delegate untouched', () => {
  assert.equal(plan({ code: 'INVALID_REQUEST', message: '400: invalid request' }).reason, 'not-a-quota-failure');
  assert.equal(plan({ code: 'AUTH', message: '401: bad api key' }).reason, 'not-a-quota-failure');
  assert.equal(plan({ code: 'QUOTA', message: '429: usage limit reached' }, { provider: 'zai' }).action, 'delegate');
});

test('a stale reset instant is clamped to now plus grace, never scheduled in the past', () => {
  const result = plan(
    { code: 'QUOTA', message: ZAI_429 },
    { now: new Date('2026-11-17T00:00:00.000Z') },
  );
  assert.equal(result.action, 'schedule');
  assert.equal(result.at.toISOString(), '2026-11-17T00:01:30.000Z');
});

test('a reset farther than maxDelayMinutes delegates instead of scheduling', () => {
  const result = plan(
    { code: 'QUOTA', message: '429: {"code":"1310","message":"Weekly Limit Exhausted. Your limit will reset at 2027-01-01 00:00:00"}' },
    { config: config({ maxDelayMinutes: 60 * 24 }) },
  );
  assert.equal(result.action, 'delegate');
  assert.equal(result.reason, 'reset-too-far');
});

test('timezone override changes the computed instant', () => {
  const result = plan({ code: 'QUOTA', message: ZAI_429 }, { config: config({ providerTimeZones: { zai: 'UTC' } }) });
  assert.equal(result.resetAt.toISOString(), '2026-11-17T05:13:16.000Z');
});

test('prompt and title explain the retry and stay within Host limits', () => {
  const result = plan({ code: 'QUOTA', message: ZAI_429 });
  result.failureMessage = ZAI_429;
  const prompt = buildRetryPrompt(result, config());
  assert.match(prompt, /provider-retry/);
  assert.match(prompt, /zai \(glm-5\.3\)/);
  assert.match(prompt, /2026-11-17T05:13:16|05:13:16/);
  assert.match(prompt, /Продолжи прерванную задачу/);
  assert.ok(prompt.includes('Usage limit reached'));
  const title = formatPlanTitle(result, config());
  assert.ok(title.startsWith('[retry] zai/glm-5.3'));
  assert.ok(title.length <= 120);
});

test('parseResetHints exposes only hints, not a decision', () => {
  const hints = parseResetHints({ providerRetryAfterMs: 1234 }, ZAI_429, 'Asia/Shanghai');
  assert.equal(hints.providedRetryAfterMs, 1234);
  const naive = parseResetHints({}, ZAI_429, 'Asia/Shanghai');
  assert.equal(naive.source, 'reset-at-naive');
  assert.equal(naive.instant, undefined);
});

test('formatInZone renders provider wall time for diagnostics', () => {
  assert.equal(formatInZone(new Date('2026-11-16T21:13:16.000Z'), 'Asia/Shanghai'), '2026-11-17 05:13:16');
});

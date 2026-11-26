/**
 * Unit tests for the capacity table and the config validator of `dsh-cursor-context`.
 *
 * The module under test is pure, so these tests need no Cordis runtime and no adapter:
 * they feed catalog entries shaped like the live Cursor SDK output and assert the
 * decision the wrapper would apply. The cases pin the two rules that matter in
 * production: a self-describing model keeps its adapter number unless an operator
 * declares one, and a tierless model receives the provider-wide default.
 *
 * Run: node --test tests/config.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CONTEXT_WINDOW,
  contextWindowFor,
  hasContextTiers,
  parameterDefs,
  positiveInteger,
  resolveConfig,
  tokenValue,
} from '../lib/config.js';

// ── tier grammar ────────────────────────────────────────────────────────────

test('tokenValue reads the Cursor tier labels as decimal tokens', () => {
  assert.equal(tokenValue('256k'), 256_000);
  assert.equal(tokenValue('500k'), 500_000);
  assert.equal(tokenValue('1m'), 1_000_000);
  assert.equal(tokenValue('1.05m'), 1_050_000);
  assert.equal(tokenValue(' 300K '), 300_000);
});

test('tokenValue rejects labels outside the grammar', () => {
  assert.equal(tokenValue('0k'), undefined);
  assert.equal(tokenValue(''), undefined);
  assert.equal(tokenValue('1024'), undefined);
  assert.equal(tokenValue('max'), undefined);
});

// ── catalog inspection ──────────────────────────────────────────────────────

test('hasContextTiers detects a published context parameter', () => {
  const described = { id: 'grok-4.7', parameters: [{ id: 'context', values: ['256k', '500k'] }] };
  assert.equal(hasContextTiers(described), true);
  assert.equal(hasContextTiers({ id: 'grok-4.7', cursorParameters: [{ id: 'context', values: [{ value: '1m' }] }] }), true);
});

test('hasContextTiers reports a tierless model as undescribed', () => {
  const tierless = {
    id: 'deepseek-v41-flash-1017',
    parameters: [{ id: 'reasoning_effort', values: ['none', 'low', 'medium', 'high', 'max'] }],
  };
  assert.equal(hasContextTiers(tierless), false);
  assert.equal(hasContextTiers(undefined), false);
  assert.equal(hasContextTiers({ id: 'x' }), false);
  assert.equal(hasContextTiers({ id: 'x', parameters: [{ id: 'context', values: ['auto'] }] }), false);
});

test('parameterDefs accepts both catalog shapes and never throws', () => {
  assert.deepEqual(parameterDefs({ parameters: [{ id: 'a' }] }), [{ id: 'a' }]);
  assert.deepEqual(parameterDefs({ cursorParameters: [{ id: 'b' }] }), [{ id: 'b' }]);
  assert.deepEqual(parameterDefs(null), []);
  assert.deepEqual(parameterDefs({ parameters: 'nope' }), []);
});

// ── config validation ───────────────────────────────────────────────────────

test('resolveConfig supplies the documented defaults for an empty row', () => {
  const config = resolveConfig(undefined);
  assert.equal(config.enabled, true);
  assert.equal(config.provider, 'cursor');
  assert.equal(config.defaultContextWindow, DEFAULT_CONTEXT_WINDOW);
  assert.deepEqual(Object.keys(config.contextWindows), []);
  assert.deepEqual([...config.warnings], []);
  assert.equal(Object.isFrozen(config), true);
});

test('resolveConfig keeps valid capacities and reports invalid ones', () => {
  const config = resolveConfig({
    provider: '  cursor  ',
    defaultContextWindow: '1048576',
    contextWindows: { 'deepseek-v41-flash-1017': 1_048_576, broken: 'lots', '  ': 5 },
  });
  assert.equal(config.provider, 'cursor');
  assert.equal(config.defaultContextWindow, 1_048_576);
  assert.equal(config.contextWindows['deepseek-v41-flash-1017'], 1_048_576);
  assert.equal(config.contextWindows.broken, undefined);
  assert.equal(config.warnings.length, 2, config.warnings.join(' | '));
});

test('resolveConfig treats a falsy default as an explicit disable', () => {
  const config = resolveConfig({ defaultContextWindow: null, contextWindows: { m: 4_000_000 } });
  assert.equal(config.defaultContextWindow, undefined);
  assert.equal(config.contextWindows.m, 4_000_000);
  assert.equal(config.warnings.length, 1, config.warnings.join(' | '));
});

test('resolveConfig survives a non-object config and a non-object map', () => {
  assert.equal(resolveConfig('nonsense').provider, 'cursor');
  const config = resolveConfig({ contextWindows: ['m'] });
  assert.deepEqual(Object.keys(config.contextWindows), []);
  assert.equal(config.warnings.length, 1, config.warnings.join(' | '));
});

// ── the decision ────────────────────────────────────────────────────────────

const TIERLESS = { id: 'deepseek-v41-flash-1017', parameters: [{ id: 'reasoning_effort', values: ['high'] }] };
const TIERED = { id: 'grok-4.7', parameters: [{ id: 'context', values: ['256k', '500k'] }] };

const defaults = resolveConfig({});

test('contextWindowFor repairs a tierless model with the provider default', () => {
  assert.equal(contextWindowFor(defaults, 'deepseek-v41-flash-1017', TIERLESS), 1_048_576);
  assert.equal(contextWindowFor(defaults, 'unknown-model', undefined), 1_048_576);
});

test('contextWindowFor leaves a self-describing model alone', () => {
  assert.equal(contextWindowFor(defaults, 'grok-4.7', TIERED), undefined);
  assert.equal(contextWindowFor(defaults, 'grok-4.7', undefined), 1_048_576, 'an unreadable entry counts as tierless');
});

test('contextWindowFor lets an explicit entry win over everything', () => {
  const config = resolveConfig({ defaultContextWindow: 200_000, contextWindows: { 'grok-4.7': 500_000 } });
  assert.equal(contextWindowFor(config, 'grok-4.7', TIERED), 500_000);
  assert.equal(contextWindowFor(config, 'deepseek-v41-flash-1017', TIERLESS), 200_000);
});

test('contextWindowFor answers nothing when the plugin is off or the default is off', () => {
  assert.equal(contextWindowFor(resolveConfig({ enabled: false }), 'deepseek-v41-flash-1017', TIERLESS), undefined);
  assert.equal(contextWindowFor(resolveConfig({ defaultContextWindow: 0 }), 'deepseek-v41-flash-1017', TIERLESS), undefined);
  assert.equal(contextWindowFor(defaults, '', TIERLESS), undefined);
  assert.equal(contextWindowFor(null, 'm', TIERLESS), undefined);
});

// ── integer guard ───────────────────────────────────────────────────────────

test('positiveInteger accepts only positive safe integers', () => {
  assert.equal(positiveInteger(1_048_576), 1_048_576);
  assert.equal(positiveInteger('1048576'), 1_048_576);
  assert.equal(positiveInteger(0), undefined);
  assert.equal(positiveInteger(-5), undefined);
  assert.equal(positiveInteger(1.5), undefined);
  assert.equal(positiveInteger(''), undefined);
  assert.equal(positiveInteger('1e6'), undefined);
  assert.equal(positiveInteger(Number.MAX_SAFE_INTEGER + 2), undefined);
  assert.equal(positiveInteger(null), undefined);
});

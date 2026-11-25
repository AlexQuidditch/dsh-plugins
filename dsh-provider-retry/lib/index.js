/**
 * `provider-retry` host plugin.
 *
 * The agent loop reports a failed model-request attempt through the
 * `agent/request-error` waterfall. By default an exhausted provider quota is
 * not retried in-turn: the step fails, the turn closes with the provider error,
 * and the session sits idle until the user acts. This plugin intercepts exactly
 * that failure class, parses the provider's reset instant (or `Retry-After`
 * milliseconds), and creates one durable `schedule` task that wakes the same
 * session when the limit has reset. The task's prompt tells the model to check
 * the real workspace state and resume, not restart, the interrupted work.
 *
 * It deliberately does not await the reset inside the failed request: a
 * five-hour sleep would keep the turn open, block shutdown, and lose the wait
 * on restart. The task is the durable state; the plugin keeps no memory.
 *
 * Everything fails soft: a missing `schedule`/`agents`/`sessions` service, an
 * unparsable failure, a subagent-owned session, or a rejected schedule write
 * drops back to the unmodified failure path (the listener calls `next()`).
 *
 * @module dsh-provider-retry
 */
import {
  buildRetryPrompt,
  formatPlanTitle,
  isValidTimeZone,
  resolveConfig,
  resolveRetryPlan,
  timeZoneForProvider,
} from './errors.js';

export const name = 'provider-retry';

/** Host schedule titles are trimmed and capped at 120 characters. */
const MAX_TITLE_CHARS = 120;
const LIST_LIMIT = 200;
const MAX_ANCESTRY_HOPS = 8;

/** Read a thrown value without trusting accessors. */
function messageOf(error) {
  try {
    const message = error !== null && error !== undefined ? error.message : undefined;
    if (typeof message === 'string' && message.length > 0) return message;
  } catch {
    // fall through to String()
  }
  try {
    return String(error);
  } catch {
    return 'unknown error';
  }
}

/** Read the model selected for the failed attempt, if the Agent exposes it. */
function modelOf(agent) {
  try {
    const current = agent?.model?.current?.();
    if (current !== null && typeof current === 'object' && typeof current.model === 'string' && current.model.length > 0) return current.model;
  } catch {
    // fall through to the session header
  }
  try {
    const header = agent?.session?.requestHeader?.();
    const model = header?.config?.model ?? header?.model;
    if (typeof model === 'string' && model.length > 0) return model;
  } catch {
    // no model is fine: the retry prompt describes the provider only
  }
  return undefined;
}

/** The persistent Session that owns this Agent, refused for delegated children. */
function targetSessionIdOf(ctx, agent, config) {
  const header = agent?.session?.header ?? {};
  const depth = Number.isInteger(header.delegationDepth) && header.delegationDepth > 0 ? header.delegationDepth : 0;
  if (depth === 0 && header.origin !== 'subagent') return agent.id;
  // A delegated child never receives reminder delivery, so the only durable
  // target is the nearest ancestor Session the schedule domain accepts.
  if (config.subagentPolicy !== 'ancestor') return undefined;
  let parentId = typeof header.parentSession === 'string' && header.parentSession.length > 0 ? header.parentSession : undefined;
  for (let hop = 0; hop < MAX_ANCESTRY_HOPS && parentId !== undefined; hop += 1) {
    let parent;
    try {
      const agents = ctx.get('agents');
      parent = agents?.get?.(parentId);
      if (parent === undefined) parent = ctx.get('sessions')?.get?.(parentId);
    } catch {
      parent = undefined;
    }
    if (parent === undefined || parent === null) return undefined;
    const parentHeader = parent.session?.header ?? parent.header ?? {};
    const parentDepth = Number.isInteger(parentHeader.delegationDepth) ? parentHeader.delegationDepth : 0;
    if (parentDepth === 0 && parentHeader.origin !== 'subagent') return parentId;
    parentId = typeof parentHeader.parentSession === 'string' && parentHeader.parentSession.length > 0 ? parentHeader.parentSession : undefined;
  }
  return undefined;
}

/**
 * Whether this plugin already put a pending retry on the Session. Used to keep
 * repeated failures from stacking tasks; the durable task list is the state.
 */
async function hasPendingTask(schedule, sessionId, config) {
  try {
    const result = await schedule.list({ active: true, limit: LIST_LIMIT });
    const items = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : [];
    return items.some((entry) => {
      if (entry === null || typeof entry !== 'object') return false;
      if (typeof entry.title !== 'string' || !entry.title.startsWith(config.titlePrefix)) return false;
      const target = entry.target;
      return target?.kind === 'session' && target.sessionId === sessionId;
    });
  } catch {
    // A failed listing must not block the retry: skip dedupe and try to write.
    return false;
  }
}

/**
 * Install the plugin: one `agent/request-error` listener, no timers, no state.
 * @param ctx - plugin root context.
 * @param configInput - bundle row config (validated in {@link resolveConfig}).
 */
export function apply(ctx, configInput) {
  const config = resolveConfig(configInput);
  const warn = (message, ...args) => {
    try {
      ctx.logger?.warn?.(message, ...args);
    } catch {
      // a logger must never break the plugin
    }
  };
  const info = (message, ...args) => {
    try {
      ctx.logger?.info?.(message, ...args);
    } catch {
      // ignore
    }
  };
  if (!config.enabled) {
    info('[provider-retry] disabled by config');
    return;
  }

  const service = (serviceName) => {
    try {
      const found = ctx.get(serviceName);
      return found === undefined || found === null ? undefined : found;
    } catch {
      return undefined;
    }
  };

  async function handleRequestError(payload, next) {
    try {
      const agent = payload?.agent;
      const failure = payload?.failure;
      if (agent === undefined || agent === null || failure === undefined || failure === null) return next();
      if (payload.signal?.aborted) return next();

      const plan = resolveRetryPlan(
        { failure, provider: payload.provider, model: modelOf(agent), now: new Date() },
        config,
      );
      if (plan.action !== 'schedule') {
        // Only quota failures are this plugin's business; everything else keeps
        // the built-in retry policy and turn-error path untouched.
        if (plan.reason === 'no-reset-hint') info('[provider-retry] quota failure without a reset hint (provider=%s code=%s status=%s)', plan.provider, plan.code, plan.status);
        return next();
      }

      const schedule = service('schedule');
      if (schedule === undefined || typeof schedule.create !== 'function') {
        warn('[provider-retry] schedule service unavailable; leaving the failure to the loop');
        return next();
      }
      const targetSessionId = targetSessionIdOf(ctx, agent, config);
      if (targetSessionId === undefined) {
        info('[provider-retry] no schedulable Session for provider=%s (delegated child)', plan.provider);
        return next();
      }
      if (await hasPendingTask(schedule, targetSessionId, config)) {
        info('[provider-retry] a retry task for Session %s is already pending; not stacking another', targetSessionId);
        return undefined;
      }

      const zone = plan.zone ?? timeZoneForProvider(plan.provider, config);
      if (!isValidTimeZone(zone)) {
        // resolveRetryPlan already fell back to UTC for parsing; keep titles readable.
      }
      plan.failureMessage = typeof failure.message === 'string' ? failure.message : '';
      const title = formatPlanTitle(plan, config).slice(0, MAX_TITLE_CHARS);
      const prompt = buildRetryPrompt(plan, config);
      try {
        await schedule.create(
          {
            title,
            prompt,
            timing: { kind: 'at', at: plan.at.toISOString() },
            target: { kind: 'session', sessionId: targetSessionId },
          },
          targetSessionId,
          payload.signal,
        );
      } catch (error) {
        warn('[provider-retry] could not schedule the retry for Session %s: %s', targetSessionId, messageOf(error));
        return next();
      }
      info(
        '[provider-retry] provider=%s model=%s reset=%s; retry scheduled at %s in Session %s (%s)',
        plan.provider,
        plan.model ?? '?',
        plan.resetAt === null ? 'unknown' : plan.resetAt.toISOString(),
        plan.at.toISOString(),
        targetSessionId,
        plan.source,
      );
      // Handled: do not retry the failed request in-turn. The turn closes with
      // the provider error and the durable task resumes the work after reset.
      return undefined;
    } catch (error) {
      warn('[provider-retry] request-error handling failed: %s', messageOf(error));
      return next();
    }
  }

  const disposers = [];
  try {
    disposers.push(ctx.on('agent/request-error', handleRequestError, { prepend: true }));
  } catch (error) {
    warn('[provider-retry] could not register the request-error listener: %s', messageOf(error));
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        for (const dispose of disposers.splice(0)) {
          try {
            dispose();
          } catch {
            // teardown races are not user-visible
          }
        }
      },
      'provider-retry: listeners',
    );
  }
  info(
    '[provider-retry] ready — quota resets become scheduled retries (grace=%ss, maxDelay=%smin, timezones=%s)',
    config.graceSeconds,
    config.maxDelayMinutes,
    Object.keys(config.providerTimeZones).join(','),
  );
}

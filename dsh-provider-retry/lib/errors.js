/**
 * Pure decision logic for the `provider-retry` host plugin.
 *
 * The plugin sits on the agent loop's `agent/request-error` waterfall: when a
 * model request fails because the provider reported an exhausted quota or a
 * rate limit, it decides whether the session should be retried later by a
 * durable `schedule` task once the provider's reset instant has passed.
 *
 * Nothing here touches DSH services, sockets, or the clock beyond the values a
 * caller passes in: failure classification, provider reset-hint parsing
 * (including the naive timestamps Z.ai returns), time-zone conversion, config
 * defaults, and prompt/title rendering are all pure.
 *
 * @module dsh-provider-retry/errors
 */

/** Harness failure codes that mark an exhausted quota rather than a transient rate limit. */
export const QUOTA_CODES = Object.freeze(['QUOTA', 'ACCOUNT_QUOTA']);

/** Codes the built-in `llm-retry` policy already retries inside the turn. */
export const BUILTIN_RETRY_CODES = Object.freeze(['RATE_LIMIT', 'EMPTY_RESPONSE', 'SERVER', 'TIMEOUT', 'TRANSPORT']);

/**
 * Z.ai (智谱 / GLM) returns `will reset at YYYY-MM-DD HH:MM:SS` in **Beijing
 * time (UTC+8)**, never UTC: field reports show the stamp matched the true
 * reset epoch only at +08:00, and Z.ai's own docs anchor plan windows to
 * UTC+8. Keyed by provider identity, not by sniffing Chinese text.
 */
export const PROVIDER_TIME_ZONES = Object.freeze({
  zai: 'Asia/Shanghai',
  zhipu: 'Asia/Shanghai',
  'zhipu-coding-plan': 'Asia/Shanghai',
});

/** Z.ai quota codes worth naming in a prompt/diagnostic. */
const ZAI_QUOTA_CODES = new Set(['1308', '1310', '1316', '1317', '1318', '1319', '1320', '1321']);
/** Z.ai codes that need a top-up, so a timed retry cannot help. */
const ZAI_TERMINAL_CODES = new Set(['1113', '1309']);

const DEFAULTS = Object.freeze({
  enabled: true,
  graceSeconds: 90,
  minScheduleDelaySeconds: 300,
  fallbackDelayMinutes: 20,
  fiveHourFallbackMinutes: 300,
  reprobeDelayMinutes: 60,
  maxDelayMinutes: 10080,
  scheduleWithoutReset: false,
  subagentPolicy: 'skip',
  titlePrefix: '[retry]',
});

function finitePositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function integerIn(value, fallback, min, max) {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, number));
}

function stringOr(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/**
 * Merge the row config with defaults and sanitize every value the plugin uses.
 * Unknown keys are ignored so an older config survives upgrades.
 * @param raw - bundle row config.
 * @returns frozen resolved config.
 */
export function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const zones = source.providerTimeZones !== null && typeof source.providerTimeZones === 'object' ? source.providerTimeZones : {};
  const providerTimeZones = { ...PROVIDER_TIME_ZONES };
  for (const [provider, zone] of Object.entries(zones)) {
    if (typeof provider === 'string' && provider.length > 0 && typeof zone === 'string' && zone.length > 0) providerTimeZones[provider] = zone;
  }
  return Object.freeze({
    enabled: source.enabled !== false,
    graceSeconds: integerIn(source.graceSeconds, DEFAULTS.graceSeconds, 0, 24 * 60 * 60),
    minScheduleDelaySeconds: integerIn(source.minScheduleDelaySeconds, DEFAULTS.minScheduleDelaySeconds, 1, 7 * 24 * 60 * 60),
    fallbackDelayMinutes: integerIn(source.fallbackDelayMinutes, DEFAULTS.fallbackDelayMinutes, 1, 30 * 24 * 60),
    fiveHourFallbackMinutes: integerIn(source.fiveHourFallbackMinutes, DEFAULTS.fiveHourFallbackMinutes, 1, 30 * 24 * 60),
    reprobeDelayMinutes: integerIn(source.reprobeDelayMinutes, DEFAULTS.reprobeDelayMinutes, 1, 30 * 24 * 60),
    maxDelayMinutes: integerIn(source.maxDelayMinutes, DEFAULTS.maxDelayMinutes, 1, 366 * 24 * 60),
    scheduleWithoutReset: source.scheduleWithoutReset === true,
    subagentPolicy: source.subagentPolicy === 'ancestor' ? 'ancestor' : 'skip',
    titlePrefix: stringOr(source.titlePrefix, DEFAULTS.titlePrefix),
    providerTimeZones: Object.freeze(providerTimeZones),
  });
}

/**
 * Resolve the IANA zone used to interpret a naive provider timestamp.
 * @param provider - provider id from the failed request.
 * @param config - resolved config.
 * @returns IANA time zone name (UTC when unknown).
 */
export function timeZoneForProvider(provider, config) {
  const zone = config.providerTimeZones[provider];
  return typeof zone === 'string' && zone.length > 0 ? zone : 'UTC';
}

/** Validate one IANA zone name without throwing. */
export function isValidTimeZone(zone) {
  if (typeof zone !== 'string' || zone.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function zoneParts(epochMs, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(epochMs));
  const read = (type) => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? undefined : Number(part.value);
  };
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute'), second: read('second') };
}

function offsetMsAt(epochMs, timeZone) {
  const parts = zoneParts(epochMs, timeZone);
  if (parts.year === undefined || parts.hour === undefined) return 0;
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - epochMs;
}

/**
 * Interpret one wall-clock reading in an IANA zone as an absolute instant.
 * Two offset passes make the result correct across a DST boundary.
 * @param wall - calendar fields in that zone.
 * @param timeZone - IANA zone; an invalid zone falls back to UTC.
 * @returns the corresponding Date.
 */
export function wallTimeToInstant(wall, timeZone) {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour ?? 0, wall.minute ?? 0, wall.second ?? 0, wall.millisecond ?? 0);
  const first = guess - offsetMsAt(guess, zone);
  const second = guess - offsetMsAt(first, zone);
  return new Date(second);
}

/** Render one instant as `YYYY-MM-DD HH:MM:SS` in the given zone. */
export function formatInZone(date, timeZone) {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const parts = zoneParts(date.getTime(), zone);
  const pad = (value) => String(value ?? 0).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

/**
 * Extract the provider's own body fields when the adapter put the raw JSON
 * payload into the failure message (pi-ai failures carry only message + code).
 * @param text - failure message.
 * @returns code/message/resets_at hints, or empty fields.
 */
export function extractFailureBody(text) {
  if (typeof text !== 'string') return {};
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  let body;
  try {
    body = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
  const error = body !== null && typeof body === 'object' && body.error !== null && typeof body.error === 'object' ? body.error : undefined;
  const code = body?.code ?? error?.code;
  const message = body?.message ?? error?.message;
  const resetsAt = body?.metadata?.resets_at ?? body?.resets_at ?? error?.metadata?.resets_at ?? error?.resets_at;
  return {
    code: code === undefined || code === null ? undefined : String(code),
    message: typeof message === 'string' ? message : undefined,
    resetsAt: typeof resetsAt === 'string' ? resetsAt : undefined,
    limitSource: body?.metadata?.limit_source ?? error?.metadata?.limit_source,
  };
}

/** Read the HTTP status from a failure or from its `429: {...}` message prefix. */
export function statusOf(failure, text) {
  if (failure !== null && typeof failure === 'object' && Number.isInteger(failure.status) && failure.status >= 100 && failure.status <= 599) return failure.status;
  const match = typeof text === 'string' ? /^\s*(\d{3})\b/.exec(text) : null;
  return match === null ? undefined : Number(match[1]);
}

const UNIT_MS = Object.freeze({ ms: 1, s: 1000, sec: 1000, second: 1000, m: 60000, min: 60000, minute: 60000, h: 3600000, hour: 3600000, d: 86400000, day: 86400000 });

function unitToMs(unit, fallbackMs) {
  if (typeof unit !== 'string') return fallbackMs;
  const lower = unit.toLowerCase();
  if (lower === 'ms' || lower === 'millisecond' || lower === 'milliseconds') return 1;
  return UNIT_MS[lower] ?? UNIT_MS[lower.replace(/s$/, '')] ?? fallbackMs;
}

function relativeHint(text) {
  // "retry after 30 seconds" / "Retry-After: 5" / "try again in 2 minutes" / "reset in 1h30m" (first unit only)
  const patterns = [
    /retry[- ]?after[:\s]+(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)?/i,
    /(?:try|retry)\s+again\s+in\s+(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)?/i,
    /(?:reset(?:s)?|available|resumes?)\s+in\s+(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)?/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match === null) continue;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const unit = match[2];
    const ms = unitToMs(unit, 1000) * amount;
    if (Number.isFinite(ms) && ms > 0) return { ms, source: 'relative-in-message' };
  }
  return undefined;
}

function naiveWall(dateText, timeText, zone) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(timeText);
  if (dateMatch === null || timeMatch === null) return undefined;
  return wallTimeToInstant(
    {
      year: Number(dateMatch[1]),
      month: Number(dateMatch[2]),
      day: Number(dateMatch[3]),
      hour: Number(timeMatch[1]),
      minute: Number(timeMatch[2]),
      second: timeMatch[3] === undefined ? 0 : Number(timeMatch[3]),
      millisecond: timeMatch[4] === undefined ? 0 : Number(timeMatch[4].padEnd(3, '0')),
    },
    zone,
  );
}

function parseDateToken(dateText, timeText, offsetText, zone) {
  if (typeof offsetText === 'string' && offsetText.length > 0) {
    const normalized = /^[+-]\d{2}:?\d{2}$/.test(offsetText) && !offsetText.includes(':') ? `${offsetText.slice(0, 3)}:${offsetText.slice(3)}` : offsetText;
    return new Date(`${dateText}T${timeText}${normalized}`);
  }
  return naiveWall(dateText, timeText, zone);
}

/**
 * Find an absolute or relative reset hint in a provider failure message.
 * `providerRetryAfterMs` wins over everything else.
 * @param failure - LlmFailure-like payload.
 * @param text - failure message.
 * @param zone - IANA zone used for naive stamps.
 * @returns plan hints (`resetAt`, `source`, `relative`) or an empty object.
 */
export function parseResetHints(failure, text, zone) {
  const provided = failure !== null && typeof failure === 'object' ? finitePositive(failure.providerRetryAfterMs) : undefined;
  if (provided !== undefined) return { providedRetryAfterMs: provided, source: 'providerRetryAfterMs' };
  const message = typeof text === 'string' ? text : '';
  const body = extractFailureBody(message);
  const haystack = body.message === undefined ? message : `${message}\n${body.message}`;

  // Explicit offset/`Z` stamp anywhere in the message: an absolute instant.
  const aware = /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(Z|[+-]\d{2}:?\d{2})\b/.exec(haystack);
  if (aware !== null) {
    const instant = parseDateToken(aware[1], aware[2], aware[3], zone);
    if (instant !== undefined && !Number.isNaN(instant.getTime())) return { resetAt: instant, source: 'timestamp-with-offset' };
  }

  // "reset at <naive wall clock>" — Z.ai's format; also CN `<stamp> 重置`.
  const resetAt = /(?:reset(?:s|ting)?|resets|flush(?:es)?|next\s+flush)\s+(?:at|on)\s+(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)/i.exec(haystack);
  if (resetAt !== null) {
    const instant = naiveWall(resetAt[1], resetAt[2], zone);
    if (instant !== undefined) return { resetAt: instant, source: 'reset-at-naive', naive: true };
  }
  const chinese = /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s*(?:重置|恢复|清零)/u.exec(haystack);
  if (chinese !== null) {
    const instant = naiveWall(chinese[1], chinese[2], zone);
    if (instant !== undefined) return { resetAt: instant, source: 'reset-cn', naive: true };
  }
  const resetsAt = typeof body.resetsAt === 'string' ? new Date(body.resetsAt) : undefined;
  if (resetsAt !== undefined && !Number.isNaN(resetsAt.getTime())) return { resetAt: resetsAt, source: 'resets_at' };

  // Any bare timestamp under a quota-ish message ("next reset 2026-…")
  const bare = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(haystack);
  if (bare !== null) {
    const instant = naiveWall(bare[1], bare[2], zone);
    if (instant !== undefined) return { resetAt: instant, source: 'bare-timestamp', naive: true };
  }

  const relative = relativeHint(haystack);
  if (relative !== undefined) return { relativeMs: relative.ms, source: relative.source };
  return {};
}

function truncate(value, limit) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

/**
 * Decide what the plugin should do with one failed model request.
 *
 * Returns `{ action: 'schedule', at, ... }` when a durable retry task should be
 * created, otherwise `{ action: 'delegate', reason }` so the caller continues
 * the waterfall and leaves the failure to the rest of the loop.
 *
 * @param request - failure facts: `failure`, `provider`, `model`, optional `now`.
 * @param config - resolved config from {@link resolveConfig}.
 * @returns a schedule plan or a delegate decision.
 */
export function resolveRetryPlan(request, config) {
  const now = request.now instanceof Date ? request.now : new Date();
  const provider = typeof request.provider === 'string' && request.provider.length > 0 ? request.provider : 'unknown';
  const model = typeof request.model === 'string' && request.model.length > 0 ? request.model : undefined;
  const failure = request.failure !== null && typeof request.failure === 'object' ? request.failure : {};
  const text = typeof failure.message === 'string' ? failure.message : '';
  const code = typeof failure.code === 'string' ? failure.code : '';
  const status = statusOf(failure, text);
  const body = extractFailureBody(text);
  const haystack = `${text}\n${body.message ?? ''}`;
  const zone = timeZoneForProvider(provider, config);
  const quotaCode = QUOTA_CODES.includes(code);
  const zaiCode = body.code !== undefined && ZAI_QUOTA_CODES.has(body.code) ? body.code : undefined;
  const terminalZai = body.code !== undefined && ZAI_TERMINAL_CODES.has(body.code);
  const quotaish = quotaCode
    || zaiCode !== undefined
    || status === 429
    || status === 402
    || /usage\s+limit|rate[-\s]?limit|too\s+many\s+requests|quota|limit\s+(?:reached|exceeded|exhausted)|budget|credits?/i.test(haystack);
  const balanceOnly = /insufficient\s+balance|insufficient_quota|insufficient\s+credits|余额不足|no\s+balance/i.test(haystack)
    && !/reset|resets_at|resumes?/i.test(haystack);
  // `hardQuota` marks failures the built-in RATE_LIMIT retry policy ignores: a
  // quota reset never recovers inside one turn, so this plugin may act even on
  // a short delay. A plain 429 stays with the built-in retry for short waits.
  const hardQuota = quotaCode || zaiCode !== undefined;
  const terminalBudget = body.limitSource === 'openrouter_credits' || body.limitSource === 'openrouter_key_limit';

  if (terminalZai) return { action: 'delegate', reason: 'terminal-provider-code', provider, model, code, status, bodyCode: body.code };
  if (terminalBudget) return { action: 'delegate', reason: 'terminal-budget-limit', provider, model, code, status, limitSource: body.limitSource };
  if (!quotaish) return { action: 'delegate', reason: 'not-a-quota-failure', provider, model, code, status };

  const hints = parseResetHints(failure, text, zone);

  // Terminal payment/top-up failures cannot be fixed by waiting. OpenRouter's
  // 403 budget rejections carry `metadata.resets_at`, so a reset hint wins.
  if ((status === 401 || status === 403) && hints.resetAt === undefined) return { action: 'delegate', reason: 'auth-or-forbidden', provider, model, code, status };
  if (balanceOnly && hints.resetAt === undefined && hints.providedRetryAfterMs === undefined && hints.relativeMs === undefined) {
    return { action: 'delegate', reason: 'insufficient-balance', provider, model, code, status };
  }

  const graceMs = config.graceSeconds * 1000;
  const minDelayMs = config.minScheduleDelaySeconds * 1000;
  const maxDelayMs = config.maxDelayMinutes * 60000;
  let at;
  let source = hints.source;
  let resetAt = hints.resetAt ?? null;

  if (hints.providedRetryAfterMs !== undefined) {
    at = new Date(now.getTime() + hints.providedRetryAfterMs);
    source = 'providerRetryAfterMs';
  } else if (hints.relativeMs !== undefined) {
    at = new Date(now.getTime() + hints.relativeMs);
    source = hints.source;
  } else if (resetAt !== null) {
    at = resetAt;
    source = hints.source;
  } else if (hardQuota && config.scheduleWithoutReset) {
    // No reset stamp. Known windows get their own estimate; everything else
    // gets one re-probe after the configured fallback delay.
    const fiveHour = zaiCode === '1308' || /5[-\s]?hour|past\s+5\s+hours/i.test(haystack);
    const weekly = zaiCode === '1310' || zaiCode === '1317' || /weekly|7[-\s]?day/i.test(haystack);
    const delayMinutes = fiveHour ? config.fiveHourFallbackMinutes : weekly ? config.reprobeDelayMinutes : config.fallbackDelayMinutes;
    at = new Date(now.getTime() + delayMinutes * 60000);
    source = `fallback-${delayMinutes}m`;
    resetAt = null;
  } else {
    return { action: 'delegate', reason: hardQuota && !config.scheduleWithoutReset ? 'no-reset-hint' : 'transient-rate-limit', provider, model, code, status, bodyCode: body.code };
  }

  const planned = at.getTime() + graceMs;
  if (!hardQuota) {
    // A short rate-limit window is better handled in-turn by the built-in
    // retry policy; only a long wait is worth a durable task.
    if (at.getTime() - now.getTime() < minDelayMs) return { action: 'delegate', reason: 'short-rate-limit', provider, model, code, status, at, source };
    if (planned - now.getTime() > maxDelayMs) return { action: 'delegate', reason: 'reset-too-far', provider, model, code, status, at, source };
  } else if (planned - now.getTime() > maxDelayMs) {
    return { action: 'delegate', reason: 'reset-too-far', provider, model, code, status, at, source };
  }
  // A reset instant in the past (clock skew, stale payload) still gets one
  // local retry after the grace period, never an immediate in-turn retry.
  // Keep the instant strictly in the future even when graceSeconds is 0: the
  // Host refuses a non-future `at`.
  const floorMs = Math.max(1000, hardQuota ? Math.min(graceMs, minDelayMs) : minDelayMs);
  const finalAt = new Date(Math.max(planned, now.getTime() + floorMs));
  return { action: 'schedule', at: finalAt, resetAt, source, provider, model, quota: hardQuota, code, status, bodyCode: body.code, limitSource: body.limitSource, zone };
}

/**
 * Build the model-facing instruction the scheduled task delivers. It restates
 * everything a fresh turn needs: who failed, the provider's message, when the
 * retry fires, and that the work must be resumed rather than restarted.
 * @returns prompt text.
 */
export function buildRetryPrompt(plan, config) {
  const provider = plan.provider ?? 'unknown';
  const modelPart = plan.model === undefined ? '' : ` (${plan.model})`;
  const resetLocal = plan.resetAt === null || plan.resetAt === undefined ? 'время сброса не сообщено' : `${formatInZone(plan.resetAt, plan.zone ?? 'UTC')} ${plan.zone ?? 'UTC'}`;
  const codePart = plan.code === undefined && plan.status === undefined ? '' : ` [${plan.status ?? ''}${plan.status === undefined ? '' : ' '}${plan.code ?? ''}${plan.bodyCode === undefined ? '' : ` / ${plan.bodyCode}`}]`;
  return [
    '[provider-retry] Отложенный повтор после лимита провайдера',
    `Ход был прерван ошибкой провайдера ${provider}${modelPart}${codePart}. Провайдер сообщил:`,
    truncate(plan.failureMessage ?? plan.rawMessage ?? '', 600) || 'текст ошибки не сообщён',
    `Повтор запланирован автоматически на ${plan.at.toISOString()} (${formatInZone(plan.at, plan.zone ?? 'UTC')} ${plan.zone ?? 'UTC'}); повторное срабатывание — после ${resetLocal}. Предыдущий ход уже завершился ошибкой, сессия простаивала; это не продолжение старого хода.`,
    'Продолжи прерванную задачу с того места, где она остановилась: сначала проверь фактическое состояние (git status, изменённые файлы, план/задачи), не повторяй уже выполненные шаги. Если работа была завершена до ошибки — кратко подтверди результат; если нет — выполни оставшееся.',
    config === undefined ? '' : `Если провайдер снова ответит лимитом, плагин снова отложит повтор (grace ${config.graceSeconds} с, без подряд идущих дублей задач).`,
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');
}

/** Render the calendar clock of a plan for a schedule task title (≤ 120 chars). */
export function formatPlanTitle(plan, config) {
  const prefix = config?.titlePrefix ?? '[retry]';
  const model = plan.model === undefined ? '?' : plan.model;
  const clock = formatInZone(plan.at, plan.zone ?? 'UTC');
  const title = `${prefix} ${plan.provider}/${model} → ${clock}`;
  return title.length <= 120 ? title : `${title.slice(0, 119)}…`;
}

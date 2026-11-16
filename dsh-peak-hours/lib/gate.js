/**
 * `llm/stream` gate — the last line of defense at the model-call boundary.
 *
 * The pause machinery (`./pause.js`) stops *steps*; this gate inspects the
 * actual streaming request. In peak hours it:
 *
 * - applies the background-call policy (`session-title`, `compaction`,
 *   `auto-review`, …) — `block` rejects before any adapter work, `warn` logs
 *   once per window and lets the call through;
 * - for conversation calls, blocks (`hard` mode) or warns (`warn` mode) when
 *   the session's allow override is off; `pause` mode leaves conversation
 *   blocking to the pre-step listener (a long tool loop may legitimately span
 *   the window boundary);
 * - wraps every call that does run in peak for token/time accounting, so the
 *   savings counters are real rather than guessed.
 *
 * The plugin is a LINKED package: no `@deepseek-ai/*` imports, no timers, all
 * services through `ctx.get()`. The listener is deliberately a SYNC function
 * returning an AsyncIterable — the waterfall contract — and the only await
 * points live inside the wrapper generator, so a block rejects synchronously
 * (before the downstream chain is touched).
 */
import { allowFor } from './config.js'
import { ancestorsOf } from './session-tree.js'
import { overviewFor } from './schedule.js'

/** Once-per-window warning throttle size; the map is cleared when it grows past this. */
const WARN_THROTTLE_LIMIT = 200

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Best-effort logger call: a broken logger must never break the gate. */
function safeCall(logger, method, args) {
  try {
    const fn = logger?.[method]
    if (typeof fn === 'function') fn.apply(logger, args)
  } catch {
    // Observability only.
  }
}

/** Exact token count of one `usage` chunk (provider total when it is trustworthy). */
function usageTotal(usage) {
  if (usage === null || usage === undefined || typeof usage !== 'object') return 0
  const total = Number(usage.totalTokens)
  if (Number.isFinite(total) && total >= 0) return total
  const input = Number(usage.inputTokens)
  const output = Number(usage.outputTokens)
  return (Number.isFinite(input) && input > 0 ? input : 0)
    + (Number.isFinite(output) && output > 0 ? output : 0)
}

/** The stable machine code carried by every peak rejection. */
export const PEAK_HOURS_BLOCK_CODE = 'PEAK_HOURS_BLOCK'

/** Build the synchronous hard-block error for one conversation request. */
function conversationBlockError({ provider, model, overview }) {
  const untilLabel = typeof overview?.untilLabel === 'string' && overview.untilLabel !== ''
    ? overview.untilLabel
    : 'the end of the current peak window'
  const error = new Error(
    `PEAK_HOURS_BLOCK: provider "${provider}" model "${model}" is inside a peak-priced window until ${untilLabel}; `
    + 'the request was rejected before any adapter work. Retry after the window, switch to an off-peak route/model, '
    + 'or tick the "Разрешить работу в peak hours" checkbox in the peak-hours header indicator to allow peak work for this session.',
  )
  error.code = PEAK_HOURS_BLOCK_CODE
  return error
}

/** Build the synchronous background-policy block error naming the purpose. */
function backgroundBlockError({ provider, model, purpose, overview }) {
  const untilLabel = typeof overview?.untilLabel === 'string' && overview.untilLabel !== ''
    ? overview.untilLabel
    : 'the end of the current peak window'
  const error = new Error(
    `PEAK_HOURS_BLOCK: background model call (purpose "${purpose}") for provider "${provider}" model "${model}" `
    + `is inside a peak-priced window until ${untilLabel}; the request was rejected before any adapter work. `
    + 'Set the peak-hours background policy to "allow" or "warn" to permit background calls during peak hours.',
  )
  error.code = PEAK_HOURS_BLOCK_CODE
  return error
}

/**
 * @param {object} options
 * @param {import('@deepseek-ai/cordis').Context} options.ctx - plugin ROOT context.
 * @param {() => object} options.getResolved - current effective config (never cached).
 * @param {object} options.store - durable state store from `./state.js`.
 * @param {object} options.stats - counters from `./stats.js`.
 * @param {object} options.logger - cordis logger with `info`/`warn`.
 * @param {() => Date} [options.now] - clock injection for tests.
 */
export function createLlmGate({ ctx, getResolved, store, stats, logger, now = () => new Date() }) {
  /** `${purpose ?? 'conversation'}|${provider}|${model}|${untilAt}` -> true once logged. */
  const warned = new Set()
  let disposer = null
  let started = false
  let disposed = false

  function logInfo(...args) {
    safeCall(logger, 'info', args)
  }

  function logWarn(...args) {
    safeCall(logger, 'warn', args)
  }

  function currentNow() {
    const value = now()
    return value instanceof Date ? value : new Date(value)
  }

  function safeResolved() {
    try {
      return getResolved() ?? {}
    } catch (error) {
      logWarn('[peak-hours] gate: could not resolve config: %s', messageOf(error))
      return {}
    }
  }

  /** Log once per purpose/provider/model/window (a warning per chunk would flood the log). */
  function warnOnce(kind, { provider, model, purpose, overview, message }) {
    const untilKey = overview?.untilAt instanceof Date ? overview.untilAt.toISOString() : ''
    const key = `${kind}|${purpose ?? ''}|${provider}|${model}|${untilKey}`
    if (warned.has(key)) return
    if (warned.size >= WARN_THROTTLE_LIMIT) warned.clear()
    warned.add(key)
    logWarn('[peak-hours] %s', message)
  }

  /**
   * Account one peak call that actually ran: capture its duration and usage,
   * feed the savings counters, then rethrow any downstream failure untouched.
   */
  function accountStream(next, { isConversation, provider, model, purpose }) {
    const startedAt = Date.now()
    let tokens = 0
    return (async function* accountPeakStream() {
      try {
        for await (const chunk of next()) {
          if (chunk?.type === 'usage' && chunk.usage !== undefined) tokens += usageTotal(chunk.usage)
          yield chunk
        }
      } finally {
        try {
          stats.notePeakCall({ tokens, durationMs: Date.now() - startedAt, conversation: isConversation })
        } catch (error) {
          logWarn('[peak-hours] could not account a peak call: %s', messageOf(error))
        }
        if (isConversation) {
          try {
            stats.observeCall(tokens)
          } catch (error) {
            logWarn('[peak-hours] could not update the tokens-per-step estimate: %s', messageOf(error))
          }
        }
        logInfo(
          '[peak-hours] peak call accounted: provider=%s model=%s purpose=%s conversation=%s tokens=%d',
          provider,
          model,
          purpose ?? '-',
          isConversation ? 'yes' : 'no',
          tokens,
        )
      }
    })()
  }

  /**
   * `llm/stream` waterfall listener. MUST stay synchronous: the waterfall
   * contract expects a returned AsyncIterable, and a sync throw is what makes
   * `hard` blocking happen before adapter dispatch.
   */
  function onStream(options, next) {
    const resolved = safeResolved()
    if (resolved.enabled === false) return next()
    const provider = String(options?.provider ?? '')
    const model = String(options?.model ?? '')
    if (provider === '') return next()
    const overview = overviewFor(provider, model, currentNow(), resolved.schedules)
    if (!overview.known || !overview.inPeak) return next()

    const rawSessionId = options?.sessionId
    const sessionId = rawSessionId === undefined || rawSessionId === null ? undefined : String(rawSessionId)
    const isConversation = sessionId !== undefined && options?.purpose === undefined
    // A schedule entry (or a model rule inside it) may override the global mode.
    const mode = overview.mode ?? resolved.mode
    const purpose = typeof options?.purpose === 'string' && options.purpose !== '' ? options.purpose : undefined

    // 1. Auxiliary/background calls follow the configured background policy.
    if (purpose !== undefined) {
      const policy = resolved.backgroundPolicy ?? 'allow'
      if (policy === 'block') throw backgroundBlockError({ provider, model, purpose, overview })
      if (policy === 'warn') {
        warnOnce('background', {
          provider,
          model,
          purpose,
          overview,
          message: `background call (purpose "${purpose}") for provider "${provider}" model "${model}" ran inside peak hours until ${overview.untilLabel ?? 'the window end'} (policy "warn")`,
        })
      }
      return accountStream(next, { isConversation: false, provider, model, purpose })
    }

    // 2. A hand-built, session-less call is not part of a conversation we guard.
    if (!isConversation) return next()

    // 3. Conversation calls honour the session's allow override and the mode.
    const allow = allowFor(resolved, store, sessionId, ancestorsOf(ctx, sessionId))
    if (!allow.allow && mode === 'hard') {
      throw conversationBlockError({ provider, model, overview })
    }
    if (!allow.allow && mode === 'warn') {
      warnOnce('conversation', {
        provider,
        model,
        overview,
        message: `conversation call for provider "${provider}" model "${model}" is inside peak hours until ${overview.untilLabel ?? 'the window end'} (mode "warn"); tick "Разрешить работу в peak hours" in the header indicator to stop this warning`,
      })
    }
    return accountStream(next, { isConversation: true, provider, model })
  }

  function start() {
    if (started || disposed) return
    started = true
    try {
      disposer = ctx.on('llm/stream', onStream, { global: true, prepend: true })
    } catch (error) {
      logWarn('[peak-hours] could not register the llm/stream gate: %s', messageOf(error))
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    warned.clear()
    const remove = disposer
    disposer = null
    if (typeof remove === 'function') {
      try {
        remove()
      } catch (error) {
        logWarn('[peak-hours] could not remove the llm/stream gate: %s', messageOf(error))
      }
    }
    started = false
  }

  return { start, dispose }
}

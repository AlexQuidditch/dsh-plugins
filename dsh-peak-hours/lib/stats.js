/**
 * Savings counters and daily peak-allowance accounting — no cordis imports.
 *
 * The plugin cannot know what the user *would* have spent, so every economic
 * number is explicitly an estimate:
 *
 * - `movedTokensEstimate` — for every step held at the peak boundary, the
 *   rolling average tokens-per-conversation-call observed so far;
 * - `savedTokensEstimate` — that moved volume times the configured off-peak
 *   discount (DeepSeek/GLM bill off-peak calls at roughly half price);
 * - `peakCalls` / `peakTokens` — real model calls that *did* run in peak (only
 *   when the user allowed peak work or a background-purpose call went through);
 * - `allowedPeakSeconds` / daily allowance — real conversation time spent in
 *   peak while allowed, which the daily limit uses.
 */
import { createStateStore } from './state.js'

/** Exponential smoothing weight for the rolling tokens-per-call estimate. */
const AVG_WEIGHT = 0.25

/**
 * @param {object} options
 * @param {ReturnType<typeof createStateStore>} options.store
 * @param {() => object} options.resolveConfig - effective configuration.
 */
export function createStats({ store, resolveConfig }) {
  let averageTokens = Math.max(0, Number(store.stats().lastAvgTokens) || 0)

  /** Feed one observed conversation call into the rolling average. */
  function observeCall(tokens) {
    const value = Number(tokens)
    if (!Number.isFinite(value) || value <= 0) return
    averageTokens = averageTokens === 0 ? value : averageTokens * (1 - AVG_WEIGHT) + value * AVG_WEIGHT
    store.bumpStats({ lastAvgTokens: averageTokens })
  }

  /** One step was held at the peak boundary: one model call did not happen yet. */
  function noteHeldStep() {
    const estimate = Math.round(averageTokens)
    store.bumpStats({
      heldSteps: 1,
      ...(estimate > 0 ? { movedTokensEstimate: estimate } : {}),
    })
  }

  /** A pause ended (or is being accounted for) after `seconds` of waiting. */
  function notePausedSeconds(seconds) {
    const value = Math.round(Number(seconds))
    if (!Number.isFinite(value) || value <= 0) return
    store.bumpStats({ pausedSeconds: value })
  }

  /** One deferred prompt (message or scheduled draft) was queued. */
  function noteDeferred() {
    store.bumpStats({ deferredMessages: 1 })
  }

  /**
   * One model call actually ran during peak hours.
   *
   * @param {{tokens?: number, durationMs?: number, conversation?: boolean}} call
   */
  function notePeakCall({ tokens = 0, durationMs = 0, conversation = false } = {}) {
    const counted = Math.max(0, Math.round(Number(tokens) || 0))
    const seconds = Math.max(0, Math.round(Number(durationMs) / 1000))
    store.bumpStats({
      peakCalls: 1,
      ...(counted > 0 ? { peakTokens: counted } : {}),
    })
    if (conversation) {
      if (seconds > 0) {
        store.addAllowedSeconds(seconds)
        store.bumpStats({ allowedPeakSeconds: seconds })
      }
    }
  }

  /** Remaining daily allowance in seconds, or null when unlimited. */
  function remainingAllowance() {
    const resolved = resolveConfig()
    if (resolved.dailyLimitMinutes === null) return null
    const used = store.limitSecondsToday()
    return Math.max(0, Math.round(resolved.dailyLimitMinutes * 60 - used))
  }

  /** Whether the daily allowance has been exhausted. */
  function allowanceExhausted() {
    return store.limitExhausted(resolveConfig().dailyLimitMinutes)
  }

  /** Display summary for the popover / banner. */
  function summary() {
    const resolved = resolveConfig()
    const stats = store.stats()
    const discount = resolved.offPeakDiscount
    const moved = Math.max(0, Math.round(Number(stats.movedTokensEstimate) || 0))
    return {
      pausedSeconds: Math.max(0, Math.round(Number(stats.pausedSeconds) || 0)),
      heldSteps: Math.max(0, Math.round(Number(stats.heldSteps) || 0)),
      deferredMessages: Math.max(0, Math.round(Number(stats.deferredMessages) || 0)),
      peakCalls: Math.max(0, Math.round(Number(stats.peakCalls) || 0)),
      peakTokens: Math.max(0, Math.round(Number(stats.peakTokens) || 0)),
      allowedPeakSeconds: Math.max(0, Math.round(Number(stats.allowedPeakSeconds) || 0)),
      movedTokensEstimate: moved,
      savedTokensEstimate: Math.round(moved * discount),
      avgTokensPerStep: Math.round(averageTokens),
      discount,
      day: stats.day,
    }
  }

  /** Reset counters (settings page action). */
  function reset() {
    averageTokens = 0
    store.resetStats()
  }

  return {
    observeCall,
    noteHeldStep,
    notePausedSeconds,
    noteDeferred,
    notePeakCall,
    remainingAllowance,
    allowanceExhausted,
    summary,
    reset,
  }
}

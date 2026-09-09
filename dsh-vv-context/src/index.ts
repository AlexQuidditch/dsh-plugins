/**
 * dsh-vv-context, host half.
 *
 * The inspector is a browser-only feature: every figure comes from the host's
 * token-meter projections, which the runtime already serves to the browser
 * (session/projection frames). The host half intentionally stays a no-op so
 * the Loader row still activates, and re-exports the pure formatters the
 * activation test and future CLI consumers share with ./client.
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'vv-context'

export { formatPercent, formatTokens, shareOf } from './format.js'

export function apply(ctx: Context): void {
  // no-op: the feature surface lives in ./client (browser half).
  void ctx
}

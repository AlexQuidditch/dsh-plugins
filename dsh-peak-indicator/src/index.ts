/**
 * dsh-peak-indicator, host half.
 *
 * The indicator is a browser-only feature: the peak/off-peak clock is derived
 * from the current UTC time on the client (see src/client). The host half
 * intentionally stays a no-op so the Loader row still activates.
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'peak-indicator'

export function apply(ctx: Context): void {
  // no-op: the feature surface lives in ./client (browser half).
  void ctx
}

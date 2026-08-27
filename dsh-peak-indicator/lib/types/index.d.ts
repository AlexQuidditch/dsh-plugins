/**
 * dsh-peak-indicator, host half.
 *
 * The indicator is a browser-only feature: the peak/off-peak clock is derived
 * from the current UTC time on the client (see src/client). The host half
 * intentionally stays a no-op so the Loader row still activates.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "peak-indicator";
export declare function apply(ctx: Context): void;

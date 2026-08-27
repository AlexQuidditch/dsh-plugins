/**
 * dsh-hello-world, host half.
 *
 * Registers the /hello slash command in the command plane (ctx.commands).
 * Namespace plugin shape: named exports name / inject / apply, no default
 * export (postmortem 0001: default export drops inject).
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "hello-world";
/** The command registry must exist before this plugin starts. */
export declare const inject: string[];
/** Config from the Loader entry (see cordis.patch.yml). */
export interface HelloWorldConfig {
    greeting?: string;
}
export declare function apply(ctx: Context, config?: HelloWorldConfig): void;

/**
 * dsh-halt-jobs, host half.
 *
 * Registers one authenticated Connection RPC channel (`/dsh-halt-jobs`) with a
 * single endpoint, `stop-all`, that cancels every running background job owned
 * by one session. The browser half (./client) renders the stop pill beside the
 * shipped background-jobs selector and calls this endpoint on click.
 *
 * Ownership is fenced twice: Connection applies the Host/Origin fence and the
 * browser-session cookie before this handler runs, and the jobs registry
 * itself checks the killing agent against each job's owner. The caller is
 * resolved from the payload's session id through the live agent registry, so
 * one request can only act on the session it names — and only while that
 * session is live in this process.
 *
 * The service slices below are structural on purpose: `connection`, `jobs`,
 * and `agents` are host-core services whose real typings live in packages a
 * bundle plugin should not have to depend on at build time.
 *
 * `rpc.handle` does `owner.webServer.register` on the Context that *read*
 * the service. Cordis then resolves `webServer` against that Context's
 * shadow fiber — the Connection plugin itself, whose inject is only
 * `credentials`. A plugin-level `inject: ['webServer']` never reaches that
 * lookup, which is why `dsh web` died with "cannot get property webServer
 * without inject" even after we declared it. Connection's own tests call
 * `handle` from the root Context (no plugin runtime → reflect.get skips
 * the inject check). We do the same, and wait for `webServer` via
 * `ctx.inject` so the route is not mounted before the HTTP server exists.
 * Disposal stays on this plugin's inject fiber so unload still unregisters.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "halt-jobs";
/** Services required before activation: the RPC registry, the job registry, and the agent registry. */
export declare const inject: string[];
export declare function apply(ctx: Context): void;

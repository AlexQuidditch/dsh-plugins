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
import type { Context } from '@deepseek-ai/cordis'

export const name = 'halt-jobs'

/** Services required before activation: the RPC registry, the job registry, and the agent registry. */
export const inject = ['connection', 'jobs', 'agents']

/** Logical channel: absolute, one segment, never the reserved `/api`. */
const CHANNEL = '/dsh-halt-jobs'

/** Wire endpoint name. */
const ENDPOINT = 'stop-all'

/** The envelope Connection RPC responses must carry. */
type RpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

/** Structural slice of the Connection service this plugin consumes. */
interface ConnectionLike {
  rpc: {
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult>,
    ): () => Promise<void>
  }
}

/** Structural slice of a job snapshot as returned by the registry. */
interface JobSnapshotLike {
  id: string
  status: string
  ownerSession?: string
}

/** Structural slice of the jobs registry this plugin consumes. */
interface JobsLike {
  list(caller?: unknown): JobSnapshotLike[]
  kill(id: string, caller?: unknown, reason?: string): 'requested' | 'already-finished'
}

/** Structural slice of the agent registry this plugin consumes. */
interface AgentsLike {
  get(id: string): unknown | undefined
}

function failure(code: string, message: string): RpcResult {
  return { ok: false, error: { code, message, details: {} } }
}

/** Read `payload.sessionId` as a non-empty string, or `undefined`. */
function sessionIdOf(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== 'object' || !('sessionId' in payload)) return undefined
  const value = (payload as { sessionId?: unknown }).sessionId
  return typeof value === 'string' && value !== '' ? value : undefined
}

export function apply(ctx: Context): void {
  const jobs = ctx.get('jobs') as JobsLike | undefined
  const agents = ctx.get('agents') as AgentsLike | undefined
  if (jobs === undefined || agents === undefined) return

  ctx.inject(['webServer'], (webCtx) => {
    const connection = webCtx.root.get('connection') as ConnectionLike | undefined
    if (connection === undefined) return

    const dispose = connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
      if (endpoint !== ENDPOINT) {
        return failure('halt-jobs/unknown-endpoint', `unknown endpoint ${JSON.stringify(endpoint)}`)
      }
      const sessionId = sessionIdOf(payload)
      if (sessionId === undefined) {
        return failure('halt-jobs/bad-request', 'payload.sessionId must be a non-empty string')
      }

      const caller = agents.get(sessionId)
      if (caller === undefined) {
        return failure('halt-jobs/session-not-live', `no live agent for session ${JSON.stringify(sessionId)}`)
      }

      let owned: JobSnapshotLike[]
      try {
        owned = jobs.list(caller).filter((job) => job.ownerSession === sessionId)
      } catch (error) {
        return failure('halt-jobs/read-failed', error instanceof Error ? error.message : String(error))
      }

      let stopped = 0
      for (const job of owned) {
        if (job.status !== 'running') continue
        try {
          jobs.kill(job.id, caller, 'stopped from the session-header stop pill')
          stopped += 1
        } catch {
          // One stubborn job never blocks the rest: the pill's count re-reads live state anyway.
        }
      }

      let remaining = 0
      try {
        for (const job of jobs.list(caller)) {
          if (job.ownerSession !== sessionId) continue
          if (job.status === 'running' || job.status === 'stopping') remaining += 1
        }
      } catch {
        remaining = 0
      }

      return { ok: true, value: { stopped, remaining } }
    })

    webCtx.effect(() => dispose, 'halt-jobs: rpc channel')
  })
}

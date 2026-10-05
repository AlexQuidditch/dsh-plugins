/**
 * dsh-halt-jobs, browser half.
 *
 * Registers the stop pill into `conversation.session.header.actions` — the
 * title-adjacent strip that also hosts the shipped background-jobs selector
 * (`job-list`, order 20) — at order 100, immediately to its right.
 *
 * The pill's live count reads the client `jobs` service (`ctx.jobs.state`)
 * through the slot's `useJobs` hook, and `watchRows` opens the session's roster
 * stream. That pair replaces the pre-0.2 `useSessions(state => state.jobsBySession)`
 * projection, which 0.2 removed. The only wire call is the `stop-all` endpoint
 * on the host half's `/dsh-halt-jobs` Connection channel, made through the
 * client's `connection` service.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge so the actions key resolves.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

import { HaltJobsPill } from './HaltJobsPill.tsx'
import type { StopAllOutcome } from './HaltJobsPill.tsx'

/** Logical channel owned by the host half (src/index.ts). */
const CHANNEL = '/dsh-halt-jobs'

/** The envelope Connection RPC results carry on the wire. */
type WireResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details?: unknown } }

/** Structural slice of the client `connection` service this plugin consumes. */
interface ConnectionLike {
  rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<WireResult>
  }
}

/**
 * Structural slice of the client `jobs` service (0.2): the selector store the
 * renderer wraps as `useJobs`, and the reference-counted roster stream opener.
 */
interface JobsLike {
  /** `ClientJobsModel`: `getSnapshot()` + `subscribe()`, handed to the hook bag. */
  state: unknown
  watchRows(sessionId: string): (() => void) | undefined
}

/** Coerce a wire number with a safe default. */
function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Required services: the wire client, the slot registry, and the jobs rosters. */
export const inject = ['connection', 'slots', 'jobs']

export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionLike | undefined
  const jobs = ctx.get('jobs') as JobsLike | undefined

  const stopAll = (sessionId: string): Promise<StopAllOutcome> => {
    if (connection === undefined) {
      return Promise.resolve({ ok: false, message: 'connection service unavailable' })
    }
    return connection.rpc.call(CHANNEL, 'stop-all', { sessionId })
      .then((result): StopAllOutcome => result.ok
        ? {
            ok: true,
            value: {
              stopped: numberOf((result.value as { stopped?: unknown } | null)?.stopped),
              remaining: numberOf((result.value as { remaining?: unknown } | null)?.remaining),
            },
          }
        : { ok: false, message: result.error.message })
      .catch((error: unknown): StopAllOutcome => ({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }))
  }

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    {
      name: 'conversation.session.header.actions',
      id: 'halt-stop-all',
      order: 100,
      // Inject share: the jobs store rides the renderer's `hooks` bag (every
      // `hooks.<name>` becomes a `use<Name>` selector prop), and the roster
      // opener + wire call join the spread props.
      inject: () => ({
        hooks: { jobs: jobs?.state },
        watchRows: (sessionId: string) => jobs?.watchRows(sessionId),
        stopAll,
      }),
    },
    HaltJobsPill,
  ))
}

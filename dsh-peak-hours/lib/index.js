/**
 * dsh-peak-hours, host half.
 *
 * One plugin for both halves of the peak-price story, so the pill the user
 * reads and the gate that acts can never disagree:
 *
 * - the `llm/stream` waterfall (prepended, global) gates model calls by provider
 *   peak-price schedule — `soft` warns, `hard` rejects with PEAK_HOURS_BLOCK
 *   before any adapter work;
 * - one authenticated Connection channel (`/dsh-peak-hours`) serves the header
 *   indicator its state and carries the user's "allow work in peak hours"
 *   override back.
 *
 * The override is the point of the merge: `soft` only writes to the host log
 * (where nobody looks), while the toggle is a real, discoverable switch that
 * suspends the gate. It is persisted under the DSH home, so a restart never
 * silently re-arms blocking the user just disabled.
 *
 * Schedules match provider FAMILIES, not exact ids: the config says `deepseek`
 * and covers `deepseek-official` / `deepseek-vision` (see ./schedule.js).
 * Unknown providers and malformed windows fail open.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { decidePeak, peakOverview, resolveSchedule } from './schedule.js'

export const name = 'peak-hours'

/** Services required before activation: the RPC registry. */
export const inject = ['connection']

/** Logical channel: absolute, one segment, never the reserved `/api`. */
const CHANNEL = '/dsh-peak-hours'

/** Wire endpoints. */
const EP_STATE = 'state'
const EP_SET_ALLOW = 'set-allow-peak'

/** The DSH home, matching the other bundles in this repo. */
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** Where the user's override survives a restart. */
function overridePath() {
  return join(dshHome(), 'peak-hours.json')
}

function failure(code, message) {
  return { ok: false, error: { code, message, details: {} } }
}

/** The persisted override, or `undefined` when never written / unreadable. */
function readOverride() {
  try {
    const raw = JSON.parse(readFileSync(overridePath(), 'utf8'))
    return typeof raw?.allowPeak === 'boolean' ? raw.allowPeak : undefined
  } catch {
    return undefined
  }
}

function writeOverride(allowPeak) {
  const file = overridePath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ allowPeak, updatedAt: new Date().toISOString() }, null, 2)}\n`)
}

export function apply(ctx, config = {}) {
  if (config.enabled === false) return
  const globalMode = config.mode ?? 'soft'
  const schedules = config.schedules ?? {}

  // Live for the gate and the channel alike; the file is the durable copy.
  let allowPeak = readOverride() ?? config.allowPeak ?? false

  /** Everything the indicator needs, computed from the one schedule. */
  const snapshot = () => {
    const now = new Date()
    const overview = peakOverview(now, schedules)
    return {
      enabled: true,
      mode: globalMode,
      allowPeak,
      peak: overview.peak,
      until: overview.until ?? null,
      secondsToChange: overview.secondsToChange,
      schedules,
    }
  }

  // ── the gate ──────────────────────────────────────────────────────────────

  ctx.on('llm/stream', function peakGate(options, next) {
    const provider = typeof options.provider === 'string' ? options.provider : ''
    if (provider === '') return next()

    const decision = decidePeak(provider, new Date(), schedules)
    for (const broken of decision.broken) {
      ctx.logger.warn('[peak-hours] schedule disabled (fail-open): %s', broken)
    }
    if (!decision.inPeak) return next()

    if (allowPeak) {
      ctx.logger.info('[peak-hours] provider "%s" is in peak hours, allowed by the user override', provider)
      return next()
    }

    // Same family resolution as the decision: a config that says `deepseek`
    // must be able to carry the mode for the runtime id `deepseek-official`.
    const mode = resolveSchedule(provider, schedules)?.schedule.mode ?? globalMode
    if (mode === 'hard') {
      throw new Error(
        `PEAK_HOURS_BLOCK: provider "${provider}" is in peak hours until ${decision.until} (elevated pricing); `
        + 'retry outside the window, switch the provider, or allow peak hours from the header indicator',
      )
    }
    ctx.logger.warn(
      '[peak-hours] soft: provider "%s" is in peak hours until %s · elevated pricing (schedule "%s"); '
      + 'turn on "allow peak hours" in the header indicator to stop seeing this',
      provider,
      decision.until,
      decision.matched ?? provider,
    )
    return next()
  }, { global: true, prepend: true })

  // ── the channel the indicator talks to ────────────────────────────────────
  //
  // `rpc.handle` does `owner.webServer.register` against the Context that READ
  // the service, so we mirror dsh-halt-jobs: read `connection` from the ROOT
  // context (a plain reflect.get, no plugin-runtime inject check) and wait for
  // `webServer` through `ctx.inject` so the route mounts only once HTTP exists.
  ctx.inject(['webServer'], (webCtx) => {
    const connection = webCtx.root.get('connection')
    if (connection === undefined) return

    const dispose = connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
      if (endpoint === EP_STATE) return { ok: true, value: snapshot() }

      if (endpoint === EP_SET_ALLOW) {
        const next = payload?.allowPeak
        if (typeof next !== 'boolean') {
          return failure('peak-hours/bad-request', 'payload.allowPeak must be a boolean')
        }
        allowPeak = next
        try {
          writeOverride(next)
        } catch (error) {
          return failure('peak-hours/persist-failed', error instanceof Error ? error.message : String(error))
        }
        ctx.logger.info('[peak-hours] peak-hour override %s', next ? 'ENABLED by the user' : 'disabled by the user')
        return { ok: true, value: snapshot() }
      }

      return failure('peak-hours/unknown-endpoint', `unknown endpoint ${JSON.stringify(endpoint)}`)
    })

    webCtx.effect(() => dispose, 'peak-hours: rpc channel')
  })
}

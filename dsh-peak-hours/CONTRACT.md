# dsh-peak-hours — internal contract (host ↔ client, module APIs)

This file is the single source of truth for the second generation of the plugin.
Host modules read it as their interface spec; the Web client half talks to the
host only through the endpoints below. Keep it in sync with `lib/index.js`.

## Host module map

| module | role |
|---|---|
| `lib/schedule.js` | pure engine: normalize/match windows per provider **and model**, Chinese-holiday exclusions (`holidays: {tz, dates?, ranges?}` per entry/model rule, normalized onto each window as `window.holidays`), `overviewFor`, `peakEndsAt`, `nextPeakStartAt`, `decidePeak`, `windowContains` |
| `lib/session-tree.js` | read-only lineage helpers: `sessionHeaderOf`, `ancestorsOf`, `isDescendantOf`, `isSubagentSessionHeader`; a subagent child inherits the nearest ancestor's allow override |
| `lib/state.js` | durable `$DSH_HOME/peak-hours.json`: per-session allow overrides, schedule overrides, settings, stats, daily limit, deferred queue, turn marks |
| `lib/config.js` | merge bundle config + user state → effective config; `allowFor(resolved, store, sessionId)` |
| `lib/stats.js` | savings counters, daily allowance accounting, rolling tokens-per-step estimate |
| `lib/pause.js` | `agent/pre-step` pause machinery: hold for short windows, requeue for long ones; auto-resume; deferred delivery. An entry-level `mode` override (`schedules[key].mode` or a model rule's `mode`) wins over the global mode; only `pause` pauses. The root listener sees every agent, so subagent child sessions are gated on their own steps; a child is never requeued (only held), and a parent allow/resume also releases the holds of its descendants. |
| `lib/gate.js` | `llm/stream` gate: `hard` blocking, background-call policy (`session-title`/`compaction`/`auto-review`), peak-call usage accounting. The effective mode is `schedules[key].mode` / model-rule `mode` when set, else the global mode. |
| `lib/defer.js` | one-shot `schedule` tasks targeting the session at peak end, re-arm on boot |
| `lib/context.js` | `systemPrompt.context` section + `peak_hours_status` tool |
| `lib/index.js` | wiring + RPC channel + snapshot builder |

Rules: host modules must not import `@deepseek-ai/*` packages (a linked plugin
cannot resolve them); use only `node:*`, local files, and services obtained via
`ctx.get()` / `ctx.inject()`. `llm/stream` listeners must be **synchronous** and
return an `AsyncIterable` (delay inside an async generator, never `async` the
listener itself).

## RPC channel `/dsh-peak-hours`

All calls use the existing envelope: request `{ endpoint, payload }`, reply
`{ ok: true, value }` or `{ ok: false, error: { code, message, details } }`.

### `state`

Request: `{ sessionId?: string }`. Response: the **snapshot** below. The client
polls it (≈15–20 s) and between polls ticks the countdown locally.

### `set-allow-peak`

`{ sessionId?: string, allowPeak: boolean, until?: 'forever' | 'peak-end' | number, scope?: 'session' | 'default' }`

- with `sessionId` (and no `scope:'default'`): writes the per-session override;
- without `sessionId` or `scope:'default'`: writes the global default
  (`allowPeakDefault`) and clears session overrides? No — the default only
  applies where no session override exists;
- `until: number` = minutes; `'peak-end'` = until the open peak window ends
  (computed from the session model, else aggregate); `'forever'`/absent = no
  expiry.
- reply: snapshot for `sessionId`.

### `resume-now`

`{ sessionId: string, minutes?: number }` — temporary allow-true override
(default: until the current peak ends) and immediately release the session:
wake deferred messages, resolve a hold. Reply: snapshot.

### `pause-now`

`{ sessionId: string }` — turn the session's allow override off and drop any
temporary override. A running step finishes; the next step holds. Reply: snapshot.

### `defer`

`{ sessionId: string, text: string, provider?: string, model?: string }` —
create one `schedule` task targeted at `sessionId`, timed at the session model's
peak end + `defer.marginSeconds`. Errors: `peak-hours/not-in-peak`,
`peak-hours/schedule-unavailable`, `peak-hours/bad-request`,
`peak-hours/defer-failed`. Reply: `{ taskId, scheduledAt, peakEndsAt }`.

### `cancel-defer`

`{ sessionId: string }` — delete this plugin's pending deferred tasks for the
session. Reply: `{ cancelled: number }`.

### `save-settings`

`{ patch: object }` — merged into user settings (null clears a key). Reply:
snapshot. Allowed keys: `mode`, `allowPeakDefault`, `dailyLimitMinutes`,
`prePeakWarningMinutes`, `maxHoldMinutes`, `backgroundPolicy`,
`notifyBeforePeak`, `deferMarginSeconds`, `statsEnabled`, `pauseStrategy`
(`strategy`).

### `save-schedules`

`{ schedules?: object | null }` — `null` resets to the bundle config; otherwise
stored verbatim (host normalizes and drops invalid windows). Reply: snapshot
(with `scheduleWarnings`).

### `reset-stats`

`{}` — reset savings counters. Reply: snapshot.

## Snapshot

```js
{
  serverTime: ISO,
  enabled: boolean,
  mode: 'pause' | 'hard' | 'warn',
  pauseStrategy: 'auto' | 'hold' | 'requeue',
  settings: {
    allowPeakDefault, dailyLimitMinutes, prePeakWarningMinutes, maxHoldMinutes,
    backgroundPolicy, notifyBeforePeak, deferMarginSeconds, statsEnabled,
  },
  schedules: { [key]: { windows: [{start,end,tz,days?,holidays?}], models?: {...}, holidays?: {tz, ranges}, mode?, offPeakDiscount?, label? } },
  schedulesSource: 'bundle' | 'user',
  scheduleWarnings: string[],
  canDefer: boolean,                 // host mounted the `schedule` service
  aggregate: {                       // all configured windows, when no model is known
    inPeak, untilLabel, nextStartAt, secondsToChange,
  },
  stats: {
    pausedSeconds, heldSteps, deferredMessages, peakCalls, peakTokens,
    allowedPeakSeconds, movedTokensEstimate, savedTokensEstimate,
    avgTokensPerStep, discount, day,
  },
  limit: { dailyMinutes, usedSeconds, remainingSeconds, exhausted },
  pausedSessions: { [sessionId]: { until: ISO|null, kind: 'hold'|'queued' } },
  deferredSessions: { [sessionId]: number },
  session: null | {
    id, provider, model, modelName, reasoningEffort, modelKnown,
    matchedKey, modelKey, known,           // known = schedule entry found for the model
    inPeak, untilAt, untilLabel, nextStartAt, secondsToChange,
    mode, offPeakDiscount,
    effectiveWindows: [{start,end,tz,days?}],
    allow, allowSource: 'session'|'inherited'|'default'|'limit'|'disabled', allowUntil,
    paused, pauseKind: 'hold'|'queued'|null, pausedSince, pausedUntil,
    deferredCount,
    peakTurns: number[], pausedTurns: number[],
  },
}
```

### First-generation host detection

A host that predates this generation answers `state` with only
`{enabled, mode, allowPeak, peak, until, secondsToChange, schedules}` — no
`serverTime`/`aggregate`/`stats`/`limit`/`session`. The client must surface that
as «хост не перезапущен» (pill, popover warning, composer banner, settings
error) and must not render budget/statistics/pause controls as if they were
known. `isLegacyHost(state)` in `lib/client.js` is the one predicate.

## Client slots

| slot | component | order | purpose |
|---|---|---|---|
| `conversation.session.header.utilities` | pill + popover | 0 | model-aware peak status, checkbox, resume, budget, stats, windows |
| `conversation.input.right` | defer button | 10 | “⏰ до HH:MM” defers the current draft to peak end |
| `conversation.input.dock` | banner | 5 | peak / paused / pre-peak warning row with actions |
| `sidebar.session.row.trailing` | marker | 5 | paused / deferred sessions in the sidebar |
| `settings.section` | settings page | 70 | label «Пиковые часы»: mode, limits, schedules editor |
| `conversation.chat.turnTail` | turn chip | 10 | “пик” / “пауза” marks on completed turns |

Standard props available on every session-scope slot: `sessionId`,
`useSession`, `useSessionStatus`, `useProjection('modelSelection')`,
`useInput` (draft/phase/attachmentIds), `inputActions` (`setDraft`, `submit`),
`useChat`, `useConversation`. `sidebar.session.row.trailing` receives
`{ sessionId }`; `settings.section` receives `{ close }`; `turnTail` receives
`{ turn, seq, openFile }` where `turn.turn` is the turn number.

Client rules: no `react-dom` requirement (avoid overlays/portals — every
component renders inline); keep all CSS in the injected stylesheet with
`dsh-peak-hours` data attribute; Russian copy; fail soft when the host channel
is unreachable; never keep session-scoped state in module globals (only the
shared snapshot cache keyed by sessionId).

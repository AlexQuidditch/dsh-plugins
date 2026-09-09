/**
 * dsh-vv-guardian, host half.
 *
 * vv Guardian-lite: an `approval/request` waterfall listener registered with
 * { prepend: true }, so it runs BEFORE the human answerer chain. It
 * auto-approves only routine low-risk requests and passes everything else
 * through with next().
 *
 * What counts as routine: sandbox escalations whose target mode is listed in
 * `autoApprove` (default: `workspace-write` — the default session file
 * policy, so the grant is exactly what an ordinary session would already
 * allow). Escalation to `danger-full-access` and every unknown approval kind
 * keeps flowing to the human answerer; when nothing answers, the approval
 * service fails closed (`unavailable`).
 *
 * The request reason is built by dsh-sandbox/escalation as
 * `escalate sandbox to <mode>: <justification>`; the mode is parsed from it,
 * nothing else is trusted.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Minimal structural shape of one approval/request payload. */
interface ApprovalRequest {
  agent?: unknown
  reason?: unknown
  toolName?: unknown
  callId?: unknown
}

// The runtime declares this event in @deepseek-ai/dsh-user-approval, which is
// not published to the public registry at the deployment version; declare it
// locally so the bundle stays installable. Interface merging keeps the
// runtime declaration authoritative when both are present.
declare module '@deepseek-ai/cordis' {
  interface Events {
    'approval/request'(request: ApprovalRequest, next: () => unknown): unknown
  }
}

export const name = 'vv-guardian'

/** Bundle config (see cordis.patch.yml). */
export interface VvGuardianConfig {
  /** Whether the auto-answerer is active. Default: true. */
  enabled?: boolean
  /** Sandbox target modes auto-approved without a human. Default: ['workspace-write']. */
  autoApprove?: string[]
}

/** Parsed out of the escalation reason built by dsh-sandbox/escalation. */
const ESCALATION_REASON = /^escalate sandbox to ([a-z0-9-]+):/

export function apply(ctx: Context, config: VvGuardianConfig = {}): void {
  if (config.enabled === false) return
  const autoApprove = new Set(config.autoApprove ?? ['workspace-write'])

  ctx.on('approval/request', function approvalGuard(req: ApprovalRequest, next: () => unknown) {
    const reason = typeof req.reason === 'string' ? req.reason : ''
    const match = ESCALATION_REASON.exec(reason)
    if (match !== null && autoApprove.has(match[1])) {
      ctx.logger.info('[vv-guardian] auto-approved %s escalation to %s', String(req.toolName ?? 'tool'), match[1])
      return 'allowed-once'
    }
    // Routine-vs-risky boundary: everything else stays manual (or fails closed).
    return next()
  }, { prepend: true })
}

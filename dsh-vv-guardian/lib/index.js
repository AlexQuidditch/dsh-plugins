export const name = 'vv-guardian';
/** Parsed out of the escalation reason built by dsh-sandbox/escalation. */
const ESCALATION_REASON = /^escalate sandbox to ([a-z0-9-]+):/;
export function apply(ctx, config = {}) {
    if (config.enabled === false)
        return;
    const autoApprove = new Set(config.autoApprove ?? ['workspace-write']);
    ctx.on('approval/request', function approvalGuard(req, next) {
        const reason = typeof req.reason === 'string' ? req.reason : '';
        const match = ESCALATION_REASON.exec(reason);
        if (match !== null && autoApprove.has(match[1])) {
            ctx.logger.info('[vv-guardian] auto-approved %s escalation to %s', String(req.toolName ?? 'tool'), match[1]);
            return 'allowed-once';
        }
        // Routine-vs-risky boundary: everything else stays manual (or fails closed).
        return next();
    }, { prepend: true });
}

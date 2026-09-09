import { decidePeak } from './schedule.js';
export const name = 'vv-peak-hours';
export function apply(ctx, config = {}) {
    if (config.enabled === false)
        return;
    const globalMode = config.mode ?? 'soft';
    const schedules = config.schedules ?? {};
    ctx.on('llm/stream', function peakGate(options, next) {
        const provider = typeof options.provider === 'string' ? options.provider : '';
        if (provider === '')
            return next();
        const decision = decidePeak(provider, new Date(), schedules);
        for (const broken of decision.broken) {
            ctx.logger.warn('[vv-peak-hours] schedule disabled (fail-open): %s', broken);
        }
        if (!decision.inPeak)
            return next();
        const mode = schedules[provider]?.mode ?? globalMode;
        if (mode === 'hard') {
            throw new Error(`PEAK_HOURS_BLOCK: provider "${provider}" is in peak hours until ${decision.until} (elevated pricing); retry outside the window or switch the provider`);
        }
        ctx.logger.warn('[vv-peak-hours] soft: provider "%s" is in peak hours until %s · elevated pricing', provider, decision.until);
        return next();
    }, { global: true, prepend: true });
}

import { PeakIndicator } from "./PeakIndicator.js";
/** Required services: the slot registry. */
export const inject = ['slots'];
export function apply(ctx) {
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'deepseek-peak-indicator',
    }, PeakIndicator));
}

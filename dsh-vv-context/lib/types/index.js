export const name = 'vv-context';
export { formatPercent, formatTokens, shareOf } from './format.js';
export function apply(ctx) {
    // no-op: the feature surface lives in ./client (browser half).
    void ctx;
}

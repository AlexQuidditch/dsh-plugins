/**
 * dsh-vv-panel, host half.
 *
 * Deliberately a no-op: the whole capability lives in the browser half
 * (`./client.js`) — six buttons under the composer that submit a `/vv-*`
 * skill gesture as a user message. Kept as a plain `apply` export so the
 * Loader row has a host-side entry point that activates cleanly.
 */
export function apply() {}

/**
 * dsh-vv-panel, host half.
 *
 * Deliberately a no-op: the capability lives in the browser half
 * (`./client.js`) — six buttons under the composer that submit a `/vv-*`
 * skill gesture as a user message, plus one operational-state chip. The
 * state chip reads `.vvoc/specs/` through the Host's own `workspaceFiles`
 * Remote (the browser half calls `ctx.remote.workspaceFiles.*`; the Host
 * performs every filesystem read), so no plugin-specific host entry point is
 * needed here. Kept as a plain `apply` export so the Loader row has a
 * host-side entry point that activates cleanly.
 */
export function apply() {}

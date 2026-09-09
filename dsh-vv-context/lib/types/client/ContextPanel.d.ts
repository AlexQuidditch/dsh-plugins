/**
 * The /context inspector panel.
 *
 * One header button plus a fixed overlay with three sections, all derived from
 * the host token-meter projections read through the framework `useProjection`
 * hook (bound to the projection store, so the panel re-renders on every host
 * commit without manual subscriptions):
 *
 * - Использование — cumulative disjoint buckets of the session;
 * - Давление — last provider-reported prompt size, projected next-request
 *   size, and route capacity; percentage uses the projected figure and the
 *   route's contextWindow, and shows an em dash when either is absent;
 * - Состав — heuristic composition of the next request (system/tools/messages).
 *
 * Estimates are presented as estimates: percentages may exceed 100 and bars
 * only clamp their fill, mirroring the vv contract.
 */
import { type JSX } from 'react';
/** Framework standard kit for a session-scoped slot (runtime-supplied). */
interface PanelProps {
    sessionId?: string;
    useProjection?: (key: string) => unknown;
}
export declare function ContextPanel(props: PanelProps): JSX.Element | null;
export {};

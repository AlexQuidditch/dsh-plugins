/**
 * The cache pill component.
 *
 * Reads the session's tokenUsage projection through the framework hook
 * (`useProjection`) and renders one compact pill. The hook is bound to the
 * projection store, so the pill re-renders whenever the host commits a new
 * value — no manual subscription, no polling.
 */
import type { JSX } from 'react';
/** Framework standard kit for a session-scoped slot (runtime-supplied). */
interface PillProps {
    sessionId?: string;
    useProjection?: (key: string) => unknown;
}
export declare function CachePill(props: PillProps): JSX.Element | null;
export {};

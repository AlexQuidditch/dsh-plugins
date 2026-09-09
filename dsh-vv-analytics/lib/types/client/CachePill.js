import { jsx as _jsx } from "react/jsx-runtime";
import { cacheHitRate, formatHitRate, hitRateTier } from "../format.js";
import styles from './CachePill.module.css';
export function CachePill(props) {
    void props.sessionId;
    const raw = props.useProjection === undefined ? undefined : props.useProjection('tokenUsage');
    const usage = raw;
    const rate = usage === undefined
        ? undefined
        : cacheHitRate({
            inputTokens: usage.uncachedInputTokens ?? 0,
            cacheReadTokens: usage.cacheReadTokens ?? 0,
            cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        });
    return _jsx("span", { className: `${styles.pill} ${styles[hitRateTier(rate)]}`, title: "\u041A\u044D\u0448-\u043F\u043E\u043F\u0430\u0434\u0430\u043D\u0438\u0435 \u0441\u0435\u0441\u0441\u0438\u0438: cacheRead / (cacheRead + cacheWrite + input)", children: formatHitRate(rate) });
}

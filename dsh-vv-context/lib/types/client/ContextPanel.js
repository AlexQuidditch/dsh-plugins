import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { useEffect, useRef, useState } from 'react';
import { formatPercent, formatTokens, shareOf } from "../format.js";
import styles from './ContextPanel.module.css';
function Row({ label, value, share, bar }) {
    const width = share === undefined ? 0 : Math.min(100, share * 100);
    return (_jsxs("div", { className: styles.row, children: [_jsx("span", { className: styles.rowLabel, children: label }), _jsx("span", { className: styles.rowValue, children: value }), bar === true && _jsx("span", { className: styles.barTrack, children: _jsx("span", { className: styles.barFill, style: { width: `${width}%` } }) })] }));
}
export function ContextPanel(props) {
    void props.sessionId;
    const [open, setOpen] = useState(false);
    const panelRef = useRef(null);
    useEffect(() => {
        if (!open)
            return;
        const onKey = (event) => { if (event.key === 'Escape')
            setOpen(false); };
        const onClick = (event) => {
            if (panelRef.current !== null && !panelRef.current.contains(event.target))
                setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onClick);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onClick);
        };
    }, [open]);
    const usage = (props.useProjection === undefined ? undefined : props.useProjection('tokenUsage'));
    const pressure = (props.useProjection === undefined ? undefined : props.useProjection('contextPressure'));
    const breakdown = (props.useProjection === undefined ? undefined : props.useProjection('contextBreakdown'));
    const input = usage?.uncachedInputTokens ?? 0;
    const output = usage?.outputTokens ?? 0;
    const cacheRead = usage?.cacheReadTokens ?? 0;
    const cacheWrite = usage?.cacheWriteTokens ?? 0;
    const usageTotal = input + output + cacheRead + cacheWrite;
    const requestTokens = pressure?.projectedTokens ?? pressure?.pressureTokens;
    const occupancyShare = shareOf(requestTokens ?? 0, pressure?.contextWindow);
    const breakdownShare = shareOf((breakdown?.systemTokens ?? 0) + (breakdown?.toolsTokens ?? 0) + (breakdown?.messageTokens ?? 0), requestTokens);
    return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: styles.pill, title: "\u0418\u043D\u0441\u043F\u0435\u043A\u0442\u043E\u0440 \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u043D\u043E\u0433\u043E \u043E\u043A\u043D\u0430 \u0441\u0435\u0441\u0441\u0438\u0438", onClick: () => setOpen(!open), children: "\u24D8 \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442" }), open && (_jsx("div", { className: styles.overlay, children: _jsxs("div", { className: styles.panel, ref: panelRef, children: [_jsxs("div", { className: styles.header, children: [_jsx("span", { className: styles.title, children: "\u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442 \u0441\u0435\u0441\u0441\u0438\u0438" }), _jsx("button", { type: "button", className: styles.close, onClick: () => setOpen(false), "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: "\u00D7" })] }), _jsxs("section", { className: styles.section, children: [_jsx("h3", { className: styles.sectionTitle, children: "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u0435" }), _jsx(Row, { label: "\u0412\u0445\u043E\u0434 (\u0431\u0435\u0437 \u043A\u044D\u0448\u0430)", value: formatTokens(input), share: shareOf(input, usageTotal) }), _jsx(Row, { label: "\u041A\u044D\u0448-\u0447\u0442\u0435\u043D\u0438\u0435", value: formatTokens(cacheRead), share: shareOf(cacheRead, usageTotal) }), _jsx(Row, { label: "\u041A\u044D\u0448-\u0437\u0430\u043F\u0438\u0441\u044C", value: formatTokens(cacheWrite), share: shareOf(cacheWrite, usageTotal) }), _jsx(Row, { label: "\u0412\u044B\u0432\u043E\u0434", value: formatTokens(output), share: shareOf(output, usageTotal) }), _jsx(Row, { label: "\u0412\u0441\u0435\u0433\u043E", value: formatTokens(usageTotal), share: undefined })] }), _jsxs("section", { className: styles.section, children: [_jsx("h3", { className: styles.sectionTitle, children: "\u0414\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u043D\u0430 \u043E\u043A\u043D\u043E" }), _jsx(Row, { label: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0437\u0430\u043F\u0440\u043E\u0441", value: pressure === undefined || pressure.pressureTokens === undefined ? '—' : formatTokens(pressure.pressureTokens), share: undefined }), _jsx(Row, { label: "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0437\u0430\u043F\u0440\u043E\u0441 (\u043E\u0446\u0435\u043D\u043A\u0430)", value: pressure === undefined || pressure.projectedTokens === undefined ? '—' : formatTokens(pressure.projectedTokens), share: undefined }), _jsx(Row, { label: "\u041E\u043A\u043D\u043E \u043C\u043E\u0434\u0435\u043B\u0438", value: pressure === undefined || pressure.contextWindow === undefined ? '—' : formatTokens(pressure.contextWindow), share: undefined }), _jsx(Row, { label: "\u0417\u0430\u043D\u044F\u0442\u043E\u0441\u0442\u044C", value: formatPercent(occupancyShare), share: occupancyShare, bar: true })] }), _jsxs("section", { className: styles.section, children: [_jsx("h3", { className: styles.sectionTitle, children: "\u0421\u043E\u0441\u0442\u0430\u0432 (\u043E\u0446\u0435\u043D\u043A\u0430)" }), _jsx(Row, { label: "System", value: formatTokens(breakdown?.systemTokens ?? 0), share: shareOf(breakdown?.systemTokens ?? 0, pressure?.projectedTokens ?? pressure?.pressureTokens) }), _jsx(Row, { label: "Tools", value: formatTokens(breakdown?.toolsTokens ?? 0), share: shareOf(breakdown?.toolsTokens ?? 0, pressure?.projectedTokens ?? pressure?.pressureTokens) }), _jsx(Row, { label: "Messages", value: formatTokens(breakdown?.messageTokens ?? 0), share: shareOf(breakdown?.messageTokens ?? 0, pressure?.projectedTokens ?? pressure?.pressureTokens) }), _jsx(Row, { label: "\u0414\u043E\u043B\u044F \u043E\u0442 \u0437\u0430\u043F\u0440\u043E\u0441\u0430", value: formatPercent(breakdownShare), share: breakdownShare, bar: true })] }), _jsx("div", { className: styles.footer, children: "\u041E\u0446\u0435\u043D\u043A\u0438 \u043D\u0435 \u043F\u0440\u0435\u0442\u0435\u043D\u0434\u0443\u044E\u0442 \u043D\u0430 \u0442\u043E\u0447\u043D\u0443\u044E \u0442\u043E\u043A\u0435\u043D\u0438\u0437\u0430\u0446\u0438\u044E \u043F\u0440\u043E\u0432\u0430\u0439\u0434\u0435\u0440\u0430; \u043F\u0440\u043E\u0447\u0435\u0440\u043A \u2014 \u0447\u0435\u0441\u0442\u043D\u043E\u0435 \u00AB\u043D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445\u00BB." })] }) }))] }));
}

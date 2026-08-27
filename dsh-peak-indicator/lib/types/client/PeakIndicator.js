import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The DeepSeek peak-hours pill rendered in the session header utility strip.
 *
 * Derives peak/off-peak from the current UTC time and re-derives it every 15
 * seconds. Per the DeepSeek pricing page, peak hours are 01:00–04:00 and
 * 06:00–10:00 UTC, Monday through Friday; every other hour (including
 * weekends and the 04:00–06:00 / 10:00–next-day-01:00 gaps) is off-peak.
 * Colors come from theme tokens through the CSS module; no host round-trip is
 * needed, so the indicator stays live even without a Host.
 */
import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import styles from './PeakIndicator.module.css';
/** Peak windows in minutes-of-day (UTC): [start, end). Weekday only. */
const PEAK_WINDOWS = [[60, 240], [360, 600]];
/** getUTCDay() values for Mon..Fri. */
const WEEKDAYS = new Set([1, 2, 3, 4, 5]);
const DAY_MIN = 1440;
function isPeak(day, minutes) {
    if (!WEEKDAYS.has(day))
        return false;
    for (const [start, end] of PEAK_WINDOWS) {
        if (minutes >= start && minutes < end)
            return true;
    }
    return false;
}
/** Minutes until the status flips at the next boundary (crosses weekends). */
function minutesToNextChange(day, minutes) {
    const nowAbs = day * DAY_MIN + minutes;
    let best = Number.POSITIVE_INFINITY;
    for (let d = 0; d <= 8; d += 1) {
        const wd = (day + d) % 7;
        if (!WEEKDAYS.has(wd))
            continue;
        for (const window of PEAK_WINDOWS) {
            for (const boundary of window) {
                const abs = (day + d) * DAY_MIN + boundary;
                const delta = abs - nowAbs;
                if (delta > 0 && delta < best)
                    best = delta;
            }
        }
    }
    return Number.isFinite(best) ? best : DAY_MIN;
}
function currentState() {
    const now = new Date();
    const day = now.getUTCDay();
    const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const peak = isPeak(day, minutes);
    const untilChange = minutesToNextChange(day, minutes);
    return {
        peak,
        untilChange,
        text: peak
            ? `конец пика через ${formatRemaining(untilChange)}`
            : `пик через ${formatRemaining(untilChange)}`,
    };
}
function formatRemaining(min) {
    const hours = Math.floor(min / 60);
    const m = min % 60;
    if (min >= DAY_MIN) {
        const days = Math.floor(min / DAY_MIN);
        const rest = min % DAY_MIN;
        return rest === 0 ? `${days} дн` : `${days} дн ${formatRemaining(rest)}`;
    }
    if (hours === 0)
        return `${m} мин`;
    if (m === 0)
        return `${hours} ч`;
    return `${hours} ч ${m} мин`;
}
/** The peak windows (UTC minutes-of-day) re-expressed in the browser's local time, as HH:mm. */
function localWindowLabel() {
    const now = new Date();
    const y = now.getFullYear();
    const mo = now.getMonth();
    const da = now.getDate();
    const local = (min) => format(new Date(Date.UTC(y, mo, da, Math.floor(min / 60), min % 60)), 'HH:mm');
    return PEAK_WINDOWS
        .map(([start, end]) => `${local(start)}–${local(end)}`)
        .join(' и ');
}
export function PeakIndicator() {
    const [state, setState] = useState(() => currentState());
    useEffect(() => {
        const id = setInterval(() => setState(currentState()), 30_000);
        return () => clearInterval(id);
    }, []);
    return (_jsxs("span", { className: state.peak ? `${styles.ind} ${styles.on}` : styles.ind, title: localWindowLabel(), children: [_jsx("span", { className: styles.dot }), _jsx("span", { children: state.text })] }));
}

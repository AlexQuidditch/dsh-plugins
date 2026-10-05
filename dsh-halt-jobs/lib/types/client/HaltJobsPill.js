import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Text stop button in `conversation.session.header.actions`, immediately right
 * of the shipped background-jobs selector (`job-list`, order 20).
 *
 * Job state comes from the client `jobs` service through the slot's `useJobs`
 * hook (fed by `hooks: { jobs }` on the registration), with `watchRows` opening
 * the session's roster stream — the 0.2 replacement for the old
 * `useSessions(state => state.jobsBySession[id])` projection. The only host
 * call is `stop-all` on `/dsh-halt-jobs`, injected as a prop by the
 * registering module (./index.tsx).
 */
import { useEffect, useMemo, useState } from 'react';
import styles from './HaltJobsPill.module.css';
/** Stable empty list so a jobless session keeps one array identity. */
const NO_JOBS = [];
/** A job the registry still holds open; the button enables stop while any exist. */
function isLive(job) {
    return job.status === 'running' || job.status === 'stopping';
}
export function HaltJobsPill({ sessionId = '', useJobs, watchRows, stopAll }) {
    // The roster is streamed per watched session, so the pill must open the
    // stream itself: with no watcher, `rows[sessionId]` stays empty forever.
    useEffect(() => {
        if (sessionId === '' || typeof watchRows !== 'function')
            return;
        return watchRows(sessionId);
    }, [sessionId, watchRows]);
    const jobs = useJobs?.((state) => state.rows?.[sessionId]) ?? NO_JOBS;
    const live = useMemo(() => jobs.filter(isLive).length, [jobs]);
    const settled = jobs.length - live;
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState('');
    useEffect(() => {
        if (note === '')
            return;
        const timer = setTimeout(() => setNote(''), 3200);
        return () => clearTimeout(timer);
    }, [note]);
    const pending = live > 0;
    const canStop = pending && !busy;
    let title;
    if (sessionId === '')
        title = 'Фоновые задачи недоступны: сессия не выбрана';
    else if (pending)
        title = 'Остановить все фоновые задачи сессии';
    else if (settled > 0)
        title = `Активных фоновых задач нет · завершённых: ${settled}`;
    else
        title = 'Фоновых задач нет';
    const onClick = () => {
        if (!canStop)
            return;
        setBusy(true);
        setNote('');
        stopAll(sessionId)
            .then((outcome) => {
            setBusy(false);
            if (outcome.ok) {
                setNote(outcome.value.stopped > 0
                    ? `Остановлено задач: ${outcome.value.stopped}`
                    : 'Активных задач нет');
            }
            else {
                setNote(`Не удалось остановить: ${outcome.message}`);
            }
        })
            .catch(() => {
            setBusy(false);
            setNote('Не удалось остановить');
        });
    };
    const className = [
        styles.button,
        pending ? styles.active : styles.idle,
        busy ? styles.busy : '',
        sessionId === '' ? styles.unknown : '',
    ].filter(Boolean).join(' ');
    return (canStop ? (_jsxs("span", { className: styles.wrap, children: [_jsx("button", { type: "button", className: className, title: title, "aria-label": title, "aria-disabled": canStop ? 'false' : 'true', onClick: onClick, children: "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C" }), note !== '' ? _jsx("span", { className: styles.note, role: "status", children: note }) : null] })) : null);
}

---
name: managed-sessions
description: Use when work must outlive the current turn, run in parallel, or stay visible and continuable for the user — spawn and drive real workspace sessions with session_spawn / session_send / session_status / session_cancel instead of subagents
---

<skill managed-sessions>

<identity>
Alongside subagents, this runtime has managed sessions: standalone top-level sessions in a workspace. They are visible to the user in the sidebar, live independently of your session, outlive your turn and your session, and can be opened and continued by hand. This skill is the routing policy and the discipline for working with them.
</identity>

<tools>
- `session_spawn { prompt, cwd?, title?, agentPreset?, provider?, model?, reasoningEffort? }` — create a session and deliver its first prompt. Returns the `sessionId`. The directory defaults to your workspace; when that directory is already registered as a workspace, the session joins its group in the sidebar. Without `provider`/`model` the session rides the deployment default; `model` also accepts the `provider/model` form, and its provider is inferred from the catalog when the model is unambiguous there.
- `session_send { sessionId, text, mode? }` — deliver a message. `mode=queue` (default) queues it for the next turn, `mode=steer` injects it into the running turn. A cold session is resumed from disk.
- `session_status { sessionId?, messages? }` — with no arguments: every session with its `running` / `blank` / `subagent` flags and directory. With a `sessionId`: `live agent`, `running`, event count, how the last turn ended, and the text of the most recent assistant replies (`messages`: 1–10).
- `session_cancel { sessionId }` — cancel the active turn; the message queue is preserved.
</tools>

<routing>
Choose by asking what should happen to the result:

- **subagent** — you need the result within this same turn: count, search, read many files and return a digest, review a diff. The child's context is disposable afterwards, and nobody cares when it disappears.
- **session_spawn** — work that:
  - spans more than one turn (a build, a migration, a long refactor, a series of checks);
  - must stay visible to the user and continuable by hand;
  - runs in parallel with something else (several workers at once);
  - must outlive your session: yours can be closed and the work remains.

Do not spawn a session for a question that one file read or one `bash` call answers. Do not spawn a session to "pass context along": it inherits none of yours.
</routing>

<discipline>
1. `prompt` must be self-contained. The child sees neither your history, nor this skill, nor the files you are holding in your head. State what to do, where (exact paths), how to verify the result, what counts as done, and in what form to return the report.
2. `title` — always. The user finds work in the sidebar by its title, and `session-<uuid>` is not findable.
3. Do not poll in a loop. After `session_spawn`, return control and check state on your next step: `session_status { sessionId, messages: 1 }`. Waiting inside one turn is a wasted turn.
4. Before spawning again — `session_status` with no arguments: do not create duplicates or a second session for the same work. A sensible ceiling is 2–3 live workers per task; every session spends its own tokens and has its own approval flow.
5. Take the result from the latest assistant replies. `last turn end: completed` means the turn is done; `error` or `blocked` means show the user the failure text — do not silently respawn and do not pretend the work is progressing.
6. Read status correctly: `running: yes` with a growing `events` count means work is in progress, leave it alone. `live agent: no` with `running: no` means the session is cold and the next `session_send` resumes it. `blank` means the session exists but has not run a turn yet.
7. If a session hits an approval prompt, the question goes to the user in the GUI, not to you. Tell the user about it and do not work around the wait.
8. Close sessions you no longer need, and stalled ones: `session_cancel` for the active turn, then tell the user what to do with them. Abandoned sessions are clutter in the sidebar.
9. Change a child's model only when the task genuinely needs another route (a cheap model for routine work, a vision model for screenshots): `provider`/`model` on `session_spawn`. That choice belongs to this one session and leaves the deployment default alone. Do not set `reasoningEffort` without a reason: without it the model runs at its own default effort.
</discipline>

<antipatterns>
- Spawning a session for a single action and abandoning it immediately: doing it yourself is cheaper.
- Spawning five sessions "just in case" and never watching them.
- Telling the child "do it like last time" without file references or acceptance criteria.
- Waiting synchronously for the result and occupying your own turn: a managed session exists precisely so the work can run in parallel.
- Assuming a spawn replaces review: when you accept the work, read what the worker actually did.
</antipatterns>

<reporting>
When the work is finished, assemble a report from the workers' latest replies (`session_status { sessionId, messages: 1 }` for each) and tell the user: which sessions exist (id + title), what each one did, what remains, and where to look. Do not retell the whole log — only the result, the status, and the session references.
</reporting>

</skill>

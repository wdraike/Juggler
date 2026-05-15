# Phase 8: Scheduler Nudge + Health Fix — Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Two tightly coupled improvements to the scheduler lifecycle:

1. **Frontend-driven nudge:** When the browser tab is visible and an active task's end time passes, the frontend fires a lightweight `POST /api/schedule/nudge` to trigger a scheduler run. No run when tab is hidden or closed — no wasted server resources.

2. **Health check fix:** Replace the "time since last scheduler run" health indicator (a false signal in a reactive system) with two real failure signals: a stuck-claim DB query and a module-level `lastError` exported by `scheduleQueue.js`.

Out of scope: day-rollover cron, periodic forced reschedule, push notifications, any UI beyond what the existing health dot already shows.

</domain>

<decisions>
## Implementation Decisions

### Nudge Endpoint
- **D-01:** New `POST /api/schedule/nudge` endpoint. Calls `enqueueScheduleRun(userId, 'frontend:task-end-nudge')` — goes through the queue exactly like every other trigger. Does NOT call `runScheduleAndPersist` directly, so the 3s poll debounce and cross-instance claim logic apply normally.
- **D-02:** Authenticated (JWT required). No body needed. Returns `{ queued: true }`.

### Next-Task-End Computation
- **D-03:** Frontend computes `nextTaskEnd` locally from already-loaded task data. Tasks have `scheduled_at` (UTC) + `duration` (minutes). No backend change needed for this. Recompute whenever the task list or SSE `schedule:changed` fires.

### Visibility Edge Cases
- **D-04:** When the `setTimeout` fires and `document.visibilityState !== 'visible'`: arm a one-shot `visibilitychange` listener. When the tab becomes visible, check if the deadline was ≤15 minutes ago — if yes, fire the nudge; if >15 minutes ago, skip (stale — the next mutation will reschedule). Clear the listener after firing or skipping.
- **D-05:** On SSE `schedule:changed`: always recompute `nextTaskEnd` and reset the timer. This handles the case where a mutation already ran the scheduler while the tab was hidden.

### Health Signal
- **D-06:** Remove the "last run time" check from `health.routes.js` entirely. Replace with two true-failure signals:
  - **Stuck claim:** Query `schedule_queue` for rows where `claimed_by IS NOT NULL AND claimed_at < NOW() - INTERVAL {CLAIM_TTL + 60} SECOND`. If any exist → scheduler `error`.
  - **Last error:** `scheduleQueue.js` exports `getLastError()` returning `{ message, timestamp }` or `null`. Health route calls it — if non-null and within the last 10 minutes → scheduler `error`.
- **D-07:** If no stuck claims and no recent error: scheduler reports `operational` regardless of how long since the last run. The old `idle` / `stale` states are removed — they were false negatives in a reactive system.

### Claude's Discretion
- Timer implementation: `setTimeout` with Date arithmetic is sufficient. No `requestAnimationFrame` or worker thread needed.
- Where to place frontend nudge logic: co-locate with the existing SSE `schedule:changed` handler in `useTaskState.js` (line 458 area) — that's already where schedule state is managed.
- `getLastError()` storage: module-level `var _lastError = null` in `scheduleQueue.js`, written on any unhandled `runScheduleAndPersist` throw inside `processUser`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scheduler Core
- `juggler-backend/src/scheduler/scheduleQueue.js` — queue mechanics, `enqueueScheduleRun`, `CLAIM_TTL_SECONDS`, `processUser` (where `_lastError` should be written)
- `juggler-backend/src/routes/schedule.routes.js` — existing schedule API routes; new nudge endpoint goes here

### Health
- `juggler-backend/src/routes/health.routes.js` — full detailed health endpoint; scheduler section is lines 82–111 (replace this block)

### Frontend Schedule State
- `juggler-frontend/src/hooks/useTaskState.js` — SSE `schedule:changed` handler at line 458; `nextTaskEnd` timer logic goes near here
- `juggler-frontend/src/components/layout/AppLayout.jsx` — where `useTaskState` is consumed; `visibilitychange` listener can be added here or in the hook

### Architecture
- `juggler-backend/CLAUDE.md` — scheduler safety rules ("Scheduler bugs cascade"; event-queue pattern; no cascading scheduler calls from within the scheduler)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `enqueueScheduleRun(userId, source)` in `scheduleQueue.js` — already the canonical trigger for all scheduler runs; nudge endpoint just calls this
- `authenticateJWT` middleware — already used by all `/api/schedule/*` routes; apply to nudge endpoint the same way
- SSE `schedule:changed` event handler in `useTaskState.js:458` — already resets task state; extend it to also recompute and reset the nudge timer

### Established Patterns
- All scheduler triggers call `enqueueScheduleRun` then return immediately — nudge endpoint must follow this pattern, not call `runScheduleAndPersist` directly
- Health routes read `schedule_queue` table directly (line 82–111) — stuck-claim query fits this pattern
- Frontend timer pattern: `setTimeout` + `Date.now()` arithmetic used in heartbeat (`AppLayout.jsx:198`)

### Integration Points
- New `POST /api/schedule/nudge` route added to `juggler-backend/src/routes/schedule.routes.js`
- `scheduleQueue.js` exports a new `getLastError()` function; `health.routes.js` imports and calls it
- Frontend: `nextTaskEnd` timer lives in or adjacent to the SSE handler in `useTaskState.js`

</code_context>

<specifics>
## Specific Ideas

- The 15-minute staleness threshold for visibility edge case is a judgment call — the planner can adjust based on typical session patterns.
- `getLastError()` should return `{ message, timestamp }` so the health route can check recency (only flag errors from the last 10 minutes, not old crashes from before the current user's session).

</specifics>

<deferred>
## Deferred Ideas

- **Day-rollover cron:** A midnight nudge-all-users cron to handle the "no mutations since yesterday" case. Valid idea but separate from this phase.
- **Pollen/weather-triggered reschedule:** Auto-reschedule weather-sensitive tasks when conditions change. Different trigger source, different phase.

</deferred>

---

*Phase: 8-scheduler-nudge-health*
*Context gathered: 2026-05-14*

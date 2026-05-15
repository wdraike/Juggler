# Phase 08 — Scheduler Nudge + Health Fix: Summary

## What was implemented

- Added `_lastError` module-level variable to `scheduleQueue.js`, written inside the `processUser` catch block before the SSE emit, capturing `{ message, timestamp }` for any unhandled scheduler error
- Exported `getLastError()` from `scheduleQueue.js` — pure read, returns `{ message, timestamp }` or `null`
- Added `POST /api/schedule/nudge` route to `schedule.routes.js` — authenticated (JWT), rate-limited (existing 10 req/min `schedulerLimiter`), calls `enqueueScheduleRun(req.user.id, 'frontend:task-end-nudge')`, returns `{ queued: true }`
- Replaced the scheduler block in `health.routes.js` (old "time since last run" / idle/stale logic) with two true-failure signals: stuck-claim DB query (`claimed_at < NOW() - INTERVAL 120 SECOND`) and `getLastError()` recency check (10-minute window)
- Added `computeNextTaskEnd(tasks)` helper to `useTaskState.js` — computes the soonest future end time across all active tasks from already-loaded state
- Added `armNudgeTimer(nextEndMs)` helper to `useTaskState.js` — sets a `setTimeout` for the task end; fires `POST /api/schedule/nudge` immediately if tab is visible, or arms a one-shot `visibilitychange` listener with a 15-minute staleness check if tab is hidden
- Declared `nudgeTimerRef` and `nudgePendingRef` alongside existing timer refs
- Wired `armNudgeTimer` to both exit paths of the `schedule:changed` SSE handler (empty-changeset early-return and normal path after `loadPlacements()`) so the timer resets on every schedule change
- Called `armNudgeTimer` on SSE mount (after `connectSSE()`) for tasks already active at page load
- Added nudge timer cleanup to both the SSE useEffect cleanup and the standalone cleanup useEffect

## Files changed

- `juggler-backend/src/scheduler/scheduleQueue.js` — added `_lastError` var, assigned in processUser catch, added `getLastError()` function, added to module.exports
- `juggler-backend/src/routes/schedule.routes.js` — added `var { enqueueScheduleRun } = require('../scheduler/scheduleQueue')` import, added `POST /nudge` route handler
- `juggler-backend/src/routes/health.routes.js` — added `getLastError` import, replaced lines 82–111 scheduler block with stuck-claim query + getLastError() check; removed idle/stale states
- `juggler-frontend/src/hooks/useTaskState.js` — added `nudgeTimerRef`, `nudgePendingRef`, `computeNextTaskEnd`, `armNudgeTimer`; wired to both schedule:changed exit paths and mount; added cleanup in both useEffect cleanups

## Smoke test results

| Test | Description | Result |
|------|-------------|--------|
| 1 | `getLastError: function`, `initial value: null` | PASS |
| 2 | `nudge route: FOUND`, `methods: [ 'post' ]` | PASS |
| 3 | No `idle`/`stale`/`generatedAt`/`schedule_cache` in active logic | PASS |
| 4 | `grep -c "getLastError" health.routes.js` = 2 | PASS |
| 5 | `grep -c "schedule/nudge" useTaskState.js` = 2 | PASS |
| 6 | `npm run build` succeeds, build folder ready | PASS |

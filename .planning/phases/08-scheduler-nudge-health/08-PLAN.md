---
phase: 08-scheduler-nudge-health
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - juggler-backend/src/scheduler/scheduleQueue.js
  - juggler-backend/src/routes/schedule.routes.js
  - juggler-backend/src/routes/health.routes.js
  - juggler-frontend/src/hooks/useTaskState.js
autonomous: true
requirements:
  - SCHED-NUDGE-01
  - SCHED-NUDGE-02
  - SCHED-NUDGE-03
  - SCHED-HEALTH-01
  - SCHED-HEALTH-02

must_haves:
  truths:
    - "When an active task's end time passes and the tab is visible, POST /api/schedule/nudge is fired automatically"
    - "When the tab is hidden at task-end and becomes visible within 15 min, the nudge fires once"
    - "When the tab is hidden at task-end and becomes visible >15 min later, the nudge is skipped"
    - "On SSE schedule:changed, the nudge timer resets to the new nextTaskEnd"
    - "GET /api/health/detailed reports scheduler: operational when no stuck claims and no recent error"
    - "GET /api/health/detailed reports scheduler: error when a claim is stuck beyond CLAIM_TTL+60s"
    - "GET /api/health/detailed reports scheduler: error when getLastError() returns a non-null entry within 10 minutes"
    - "scheduleQueue.js exports getLastError() returning {message, timestamp} or null"
  artifacts:
    - path: "juggler-backend/src/scheduler/scheduleQueue.js"
      provides: "_lastError module var + getLastError() export"
      exports: ["enqueueScheduleRun", "stopPollLoop", "getLastError", "_internal"]
    - path: "juggler-backend/src/routes/schedule.routes.js"
      provides: "POST /api/schedule/nudge endpoint"
      contains: "enqueueScheduleRun"
    - path: "juggler-backend/src/routes/health.routes.js"
      provides: "scheduler health via stuck-claim query + getLastError()"
      contains: "getLastError"
    - path: "juggler-frontend/src/hooks/useTaskState.js"
      provides: "nudge timer + visibilityState edge case"
      contains: "schedule/nudge"
  key_links:
    - from: "juggler-frontend/src/hooks/useTaskState.js"
      to: "POST /api/schedule/nudge"
      via: "apiClient.post after setTimeout fires"
      pattern: "schedule/nudge"
    - from: "juggler-backend/src/routes/schedule.routes.js"
      to: "scheduleQueue.enqueueScheduleRun"
      via: "nudge route handler"
      pattern: "enqueueScheduleRun.*frontend:task-end-nudge"
    - from: "juggler-backend/src/routes/health.routes.js"
      to: "scheduleQueue.getLastError"
      via: "require + call inside detailed health handler"
      pattern: "getLastError"
---

<objective>
Implement two targeted improvements to the scheduler lifecycle:

1. Frontend nudge — when the browser tab is visible and an active task's end time passes, fire POST /api/schedule/nudge so the scheduler processes the user's next work without waiting for a user mutation.
2. Health fix — replace the misleading "time since last run" health signal with two true failure signals: a stuck-claim DB query and a getLastError() export from scheduleQueue.js.

Purpose: The current health check raises false idle/stale alerts in a reactive system. The nudge closes the gap where a user's task ends and no mutation triggers the scheduler.
Output: getLastError() in scheduleQueue.js, POST /api/schedule/nudge route, updated health.routes.js scheduler block, nudge timer in useTaskState.js.
</objective>

<execution_context>
@/Users/david/Offline Coding/Raike & Sons/juggler/.planning/phases/08-scheduler-nudge-health/08-CONTEXT.md
</execution_context>

<context>
@/Users/david/Offline Coding/Raike & Sons/juggler/juggler-backend/src/scheduler/scheduleQueue.js
@/Users/david/Offline Coding/Raike & Sons/juggler/juggler-backend/src/routes/schedule.routes.js
@/Users/david/Offline Coding/Raike & Sons/juggler/juggler-backend/src/routes/health.routes.js
@/Users/david/Offline Coding/Raike & Sons/juggler/juggler-frontend/src/hooks/useTaskState.js

<interfaces>
<!-- Key contracts. Read once; no re-reads needed. -->

From scheduleQueue.js (current exports):
  module.exports = { enqueueScheduleRun, stopPollLoop, _internal: { tryClaim, releaseClaim, CLAIM_TTL_SECONDS, INSTANCE_ID } }

  CLAIM_TTL_SECONDS = 60   // used in stuck-claim query threshold (TTL + 60 = 120 s)

  async function enqueueScheduleRun(userId, source)
    // inserts schedule_queue row; marks dirty[userId]; fire-and-forget from caller

  async function processUser(userId)
    // catch block at line 245: catches unhandled errors from runScheduleAndPersist
    // _lastError must be written HERE (inside the catch, before releaseClaim)

From health.routes.js:
  Lines 82–111: the scheduler block to REPLACE in full.
  The replacement must keep the outer guard: `if (healthStatus.services.database === 'operational') { ... }`

From schedule.routes.js:
  Existing rate limiter: schedulerLimiter (10 req/min per user)
  Middleware pattern: authenticateJWT + schedulerLimiter, then async handler
  All existing routes return res.json(result) or res.status(500).json({ error: '...' })

From useTaskState.js:
  Task fields (from rowToTask):
    task.scheduledAt  — UTC ISO string e.g. "2026-05-14T14:00:00Z"
    task.dur          — integer, minutes
    task.status       — "active" | "pending" | "done" | "disabled" | ...

  State access inside the SSE handler block (lines 458–524):
    taskStateRef.current.tasks  — Map or array of task objects (use taskStateRef for current value)
    apiClient.post('/schedule/nudge')  — correct base is already /api/ prefixed by apiClient

  SSE handler location: eventSource.addEventListener('schedule:changed', function(e) { ... })
    — nudge timer reset goes at the END of this handler, after loadPlacements()

  Existing timer refs in scope (see useEffect cleanup at line 551):
    saveTimerRef, placementTimerRef  — pattern to follow for nudgeTimerRef

  Refs pattern: declare with useRef(null) near the other timer refs (line 82–86 area),
    clear in the SSE handler before rescheduling, clear in the useEffect cleanup return.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add _lastError + getLastError() to scheduleQueue.js</name>
  <files>juggler-backend/src/scheduler/scheduleQueue.js</files>
  <behavior>
    - getLastError() returns null when no error has been recorded
    - getLastError() returns { message: string, timestamp: number } after processUser catch fires
    - A second error overwrites the first (only latest error is kept)
    - getLastError() is a pure read — calling it does not clear _lastError
  </behavior>
  <action>
    Add a module-level variable `var _lastError = null;` in the "In-memory state" block (near line 78, alongside `dirty`, `running`, `startupScanDone`).

    In the `processUser` catch block (currently line 245–249), before the SSE emit, assign:
      `_lastError = { message: err && err.message ? err.message : String(err), timestamp: Date.now() };`

    Add a new exported function:
      `function getLastError() { return _lastError; }`

    Add `getLastError` to module.exports alongside `enqueueScheduleRun` and `stopPollLoop`.

    Do NOT touch tryClaim, releaseClaim, pollLoop, enqueueScheduleRun, or any logic outside the catch block and the exports object. The _lastError write must occur INSIDE the existing catch(err) block in processUser — not in the finally block, and not at the top level.
  </action>
  <verify>
    <automated>cd "/Users/david/Offline Coding/Raike & Sons/juggler/juggler-backend" && node -e "
      var sq = require('./src/scheduler/scheduleQueue');
      sq.stopPollLoop();
      if (typeof sq.getLastError !== 'function') throw new Error('getLastError not exported');
      if (sq.getLastError() !== null) throw new Error('initial value should be null');
      console.log('PASS: getLastError exported, initial value null');
    " 2>&1</automated>
  </verify>
  <done>
    getLastError is exported from scheduleQueue.js, returns null on clean start, returns { message, timestamp } after a processUser catch sets it. Module loads without errors.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add POST /api/schedule/nudge to schedule.routes.js</name>
  <files>juggler-backend/src/routes/schedule.routes.js</files>
  <behavior>
    - POST /api/schedule/nudge with valid JWT returns 200 { queued: true }
    - POST /api/schedule/nudge without JWT returns 401
    - Handler calls enqueueScheduleRun(req.user.id, 'frontend:task-end-nudge') — not runScheduleAndPersist
    - Handler respects the existing schedulerLimiter (10 req/min per user)
  </behavior>
  <action>
    At the top of schedule.routes.js, add a NEW require line (scheduleQueue is not currently imported in this file):
      `var { enqueueScheduleRun } = require('../scheduler/scheduleQueue');`

    Add the nudge route BEFORE the stepper block (around line 145), after the existing `/placements` route:

      `router.post('/nudge', authenticateJWT, schedulerLimiter, async function(req, res) {`
      `  try {`
      `    await enqueueScheduleRun(req.user.id, 'frontend:task-end-nudge');`
      `    res.json({ queued: true });`
      `  } catch (err) {`
      `    console.error('[NUDGE] enqueue failed:', err.message);`
      `    res.status(500).json({ error: 'Failed to queue nudge' });`
      `  }`
      `});`

    Do NOT call runScheduleAndPersist, withSyncLock, or any scheduler internals directly — enqueueScheduleRun is the only call (per D-01).

    No request body parsing needed — nudge carries no payload (per D-02).
  </action>
  <verify>
    <automated>cd "/Users/david/Offline Coding/Raike & Sons/juggler/juggler-backend" && node -e "
      var router = require('./src/routes/schedule.routes');
      var routes = router.stack || [];
      var nudge = routes.find(function(r) { return r.route && r.route.path === '/nudge'; });
      if (!nudge) throw new Error('/nudge route not registered');
      var methods = Object.keys(nudge.route.methods);
      if (!methods.includes('post')) throw new Error('/nudge must be POST');
      console.log('PASS: POST /nudge registered');
    " 2>&1</automated>
  </verify>
  <done>
    POST /api/schedule/nudge is registered in schedule.routes.js, uses authenticateJWT + schedulerLimiter, calls enqueueScheduleRun with source 'frontend:task-end-nudge', returns { queued: true }.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Replace scheduler health block in health.routes.js</name>
  <files>juggler-backend/src/routes/health.routes.js</files>
  <behavior>
    - When no stuck claims and getLastError() is null: scheduler = 'operational', detail omitted or blank
    - When stuck claims exist: scheduler = 'error', detail describes stuck count
    - When getLastError() is non-null and timestamp within last 10 minutes: scheduler = 'error', detail includes error message
    - When getLastError() is non-null but older than 10 minutes: treated as non-recent, does not trigger error
    - When database is not 'operational': scheduler = 'unknown' (unchanged outer guard behavior)
    - Old 'idle' and 'stale' states do not appear in any response (per D-07)
  </behavior>
  <action>
    At the top of health.routes.js, add the import for getLastError:
      `const { getLastError } = require('../scheduler/scheduleQueue');`

    Replace lines 82–111 (the entire scheduler comment block through the closing `}`) with:

      `if (healthStatus.services.database === 'operational') {`
      `  try {`
      `    // Stuck-claim check: rows claimed longer than CLAIM_TTL + 60 seconds`
      `    // (CLAIM_TTL = 60s; the +60s buffer avoids false positives during a slow run)`
      `    const stuckRows = await db.raw(`
      `      'SELECT COUNT(*) AS cnt FROM schedule_queue' +`
      `      ' WHERE claimed_by IS NOT NULL AND claimed_at < DATE_SUB(NOW(), INTERVAL 120 SECOND)'`
      `    );`
      `    const stuckCount = (stuckRows[0] && stuckRows[0][0] && stuckRows[0][0].cnt) ? parseInt(stuckRows[0][0].cnt, 10) : 0;`
      ``
      `    // Last-error check: module-level error recorded by processUser catch`
      `    const lastErr = getLastError();`
      `    const TEN_MIN_MS = 10 * 60 * 1000;`
      `    const recentError = lastErr && (Date.now() - lastErr.timestamp) < TEN_MIN_MS;`
      ``
      `    if (stuckCount > 0) {`
      `      healthStatus.services.scheduler = 'error';`
      `      healthStatus.detail.scheduler = stuckCount + ' stuck claim(s) in schedule_queue';`
      `    } else if (recentError) {`
      `      healthStatus.services.scheduler = 'error';`
      `      healthStatus.detail.scheduler = 'recent scheduler error: ' + lastErr.message;`
      `    } else {`
      `      healthStatus.services.scheduler = 'operational';`
      `    }`
      `  } catch (error) {`
      `    healthStatus.services.scheduler = 'error';`
      `    healthStatus.detail.scheduler = error.message;`
      `  }`
      `} else {`
      `  healthStatus.services.scheduler = 'unknown';`
      `}`

    The INTERVAL value of 120 SECOND is CLAIM_TTL_SECONDS (60) + 60 buffer, hardcoded as the constant is not easily importable into the routes file without restructuring. Add a comment citing this.

    Do NOT change any other section of health.routes.js — the DB, SSE, and rollup logic stay untouched.
  </action>
  <verify>
    <automated>cd "/Users/david/Offline Coding/Raike & Sons/juggler/juggler-backend" && node -e "
      // Verify the file loads without error and getLastError import is present
      delete require.cache[require.resolve('./src/scheduler/scheduleQueue')];
      var sq = require('./src/scheduler/scheduleQueue');
      sq.stopPollLoop();
      delete require.cache[require.resolve('./src/routes/health.routes')];
      var router = require('./src/routes/health.routes');
      console.log('PASS: health.routes.js loads, getLastError integrated');
    " 2>&1 | grep -v 'DeprecationWarning\|ExperimentalWarning'</automated>
  </verify>
  <done>
    health.routes.js loads cleanly, the old schedule_cache/idle/stale logic is gone, stuck-claim query and getLastError() check are in place, and GET /api/health/detailed returns scheduler 'operational' when no failures exist.
  </done>
</task>

<task type="auto">
  <name>Task 4: Add nudge timer + visibility edge case to useTaskState.js</name>
  <files>juggler-frontend/src/hooks/useTaskState.js</files>
  <action>
    All changes are inside the useTaskState function body. Follow the existing patterns exactly (var-style functions inside callbacks, useRef for mutable refs).

    STEP A — Declare the nudge timer ref near the other timer refs (line 82–86 area):
      `const nudgeTimerRef = useRef(null);`
      `const nudgePendingRef = useRef(null);  // { deadline: number } when tab-hidden timer fired`

    STEP B — Add a helper function just BEFORE the connectSSE function (inside the useEffect that establishes the SSE connection). The helper computes the soonest task end time across all active tasks with a future scheduledAt:

      `function computeNextTaskEnd(tasks) {`
      `  // tasks: array or iterable from taskStateRef.current.tasks (Map values or array)`
      `  var now = Date.now();`
      `  var soonest = null;`
      `  var list = Array.isArray(tasks) ? tasks : (tasks instanceof Map ? Array.from(tasks.values()) : Object.values(tasks));`
      `  list.forEach(function(t) {`
      `    if (t.status !== 'active') return;`
      `    if (!t.scheduledAt || !t.dur) return;`
      `    var endMs = new Date(t.scheduledAt).getTime() + (t.dur * 60 * 1000);`
      `    if (endMs <= now) return;  // already past`
      `    if (soonest === null || endMs < soonest) soonest = endMs;`
      `  });`
      `  return soonest;  // ms since epoch, or null`
      `}`

    STEP C — Add a helper that arms/rearms the nudge timer. Place it immediately after computeNextTaskEnd:

      `function armNudgeTimer(nextEndMs) {`
      `  if (nudgeTimerRef.current) { clearTimeout(nudgeTimerRef.current); nudgeTimerRef.current = null; }`
      `  nudgePendingRef.current = null;`
      `  if (!nextEndMs) return;`
      `  var delay = nextEndMs - Date.now();`
      `  if (delay <= 0) return;`
      `  nudgeTimerRef.current = setTimeout(function() {`
      `    nudgeTimerRef.current = null;`
      `    if (document.visibilityState === 'visible') {`
      `      // Tab visible — fire immediately`
      `      apiClient.post('/schedule/nudge').catch(function(e) {`
      `        console.warn('[nudge] POST failed:', e && e.message);`
      `      });`
      `    } else {`
      `      // Tab hidden — arm one-shot visibilitychange listener`
      `      nudgePendingRef.current = { deadline: nextEndMs };`
      `      var onVisible = function() {`
      `        document.removeEventListener('visibilitychange', onVisible);`
      `        var pending = nudgePendingRef.current;`
      `        nudgePendingRef.current = null;`
      `        if (!pending) return;`
      `        var ageMs = Date.now() - pending.deadline;`
      `        if (ageMs <= 15 * 60 * 1000) {`
      `          // Within 15-minute staleness window — fire`
      `          apiClient.post('/schedule/nudge').catch(function(e) {`
      `            console.warn('[nudge] POST failed (visibility):', e && e.message);`
      `          });`
      `        }`
      `        // else: stale — skip; next mutation will retrigger the scheduler`
      `      };`
      `      document.addEventListener('visibilitychange', onVisible, { once: true });`
      `    }`
      `  }, delay);`
      `}`

    STEP D — The schedule:changed handler has TWO exit paths. Add `armNudgeTimer` to BOTH so D-05 (reset on every schedule:changed) is always honored:

      Path 1 — empty changeset early-return (around line 471): BEFORE the `return` statement that exits when `addedArr.length + changedArr.length + removedArr.length === 0`, add:
        `armNudgeTimer(computeNextTaskEnd(taskStateRef.current.tasks));`

      Path 2 — normal path: at the END of the handler after the existing `loadPlacements()` call (around line 523), add:
        `// Recompute nudge timer on every schedule change (D-05)`
        `armNudgeTimer(computeNextTaskEnd(taskStateRef.current.tasks));`

    STEP E — Between `connectSSE();` and the useEffect cleanup `return function()` (these are adjacent at lines 541-543), add:

      `// Arm nudge timer for current task state on mount`
      `armNudgeTimer(computeNextTaskEnd(taskStateRef.current.tasks));`

    STEP F — In the useEffect cleanup function (the return at line 543), add timer cleanup:
      `if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);`
      `nudgePendingRef.current = null;`

    STEP G — In the existing cleanup useEffect (line 551–556), add:
      `if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);`

    Do NOT add a new useEffect just for the nudge — everything co-locates with the existing SSE useEffect (the one that has the connectSSE function), per the CONTEXT.md decision. Do NOT use requestAnimationFrame or a Web Worker.

    The `taskStateRef.current.tasks` shape: in this codebase the reducer stores tasks as a Map keyed by id. computeNextTaskEnd handles Map, array, or plain object via the branching logic above.
  </action>
  <verify>
    <automated>cd "/Users/david/Offline Coding/Raike & Sons/juggler/juggler-frontend" && grep -c "schedule/nudge" src/hooks/useTaskState.js && grep -c "nudgeTimerRef" src/hooks/useTaskState.js && grep -c "armNudgeTimer" src/hooks/useTaskState.js && grep -c "computeNextTaskEnd" src/hooks/useTaskState.js && grep -c "visibilitychange" src/hooks/useTaskState.js</automated>
  </verify>
  <done>
    useTaskState.js contains nudgeTimerRef, nudgePendingRef, computeNextTaskEnd, and armNudgeTimer. The schedule:changed handler calls armNudgeTimer after loadPlacements. The useEffect cleanup clears the timer. The string "schedule/nudge" appears in the file (the apiClient.post call).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → POST /api/schedule/nudge | Authenticated user fires a scheduler trigger |
| processUser catch → _lastError | Internal error state readable by health endpoint |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-08-01 | Denial of Service | POST /api/schedule/nudge | mitigate | schedulerLimiter (10 req/min per user) already applied — same limit as /run |
| T-08-02 | Spoofing | POST /api/schedule/nudge | mitigate | authenticateJWT required; userId taken from verified token, not request body |
| T-08-03 | Information Disclosure | GET /api/health/detailed — scheduler error detail | accept | Route is already auth-gated (authenticateJWT); error message is internal scheduler text, not user PII |
| T-08-04 | Elevation of Privilege | visibilitychange listener fires stale nudge | accept | 15-min staleness check caps the exposure window; nudge only enqueues — enqueueScheduleRun is the same low-privilege path as all other triggers |
</threat_model>

<verification>
## Smoke Tests

Run in order after all four tasks complete.

### 1. Backend module integrity
```bash
cd juggler-backend
node -e "
  var sq = require('./src/scheduler/scheduleQueue');
  sq.stopPollLoop();
  console.log('getLastError:', typeof sq.getLastError);
  console.log('initial value:', sq.getLastError());
"
```
Expected: `getLastError: function` and `initial value: null`

### 2. Nudge route registered
```bash
cd juggler-backend
node -e "
  var r = require('./src/routes/schedule.routes');
  var nudge = r.stack.find(function(s){ return s.route && s.route.path === '/nudge'; });
  console.log('nudge route:', nudge ? 'FOUND' : 'MISSING');
  console.log('methods:', nudge ? Object.keys(nudge.route.methods) : 'n/a');
"
```
Expected: `nudge route: FOUND`, `methods: [ 'post' ]`

### 3. Health routes load + old idle/stale removed
```bash
cd juggler-backend
grep -n "idle\|stale\|generatedAt\|schedule_cache" src/routes/health.routes.js
```
Expected: zero matches (old logic fully replaced)

### 4. Health references getLastError
```bash
cd juggler-backend
grep -c "getLastError" src/routes/health.routes.js
```
Expected: 2 (one require import, one call)

### 5. Frontend nudge present
```bash
cd juggler-frontend
grep -c "schedule/nudge" src/hooks/useTaskState.js
```
Expected: 2 (one visible path, one visibility-deferred path)

### 6. Frontend build clean
```bash
cd juggler-frontend
npm run build 2>&1 | tail -5
```
Expected: build succeeds with no errors

### 7. Backend lint/test
```bash
cd juggler-backend
npm run lint 2>&1 | tail -10
```
Expected: lint passes (no new errors introduced)
</verification>

<success_criteria>
- getLastError() is exported from scheduleQueue.js, returns null initially, returns { message, timestamp } after a processUser error
- POST /api/schedule/nudge calls enqueueScheduleRun with source 'frontend:task-end-nudge' and returns { queued: true } for authenticated users
- GET /api/health/detailed no longer returns 'idle' or 'stale' for the scheduler
- GET /api/health/detailed returns scheduler: 'error' when stuck claims exist
- GET /api/health/detailed returns scheduler: 'error' when getLastError() is non-null and within 10 minutes
- Frontend nudge timer fires POST /api/schedule/nudge when tab is visible at task end
- Frontend defers and applies 15-minute staleness check when tab is hidden at task end
- Frontend resets nudge timer on every SSE schedule:changed event
- npm run build passes for juggler-frontend
- npm run lint && npm test passes for juggler-backend
</success_criteria>

<output>
After completion, create `.planning/phases/08-scheduler-nudge-health/08-01-SUMMARY.md` using the template at `~/.claude/get-shit-done/templates/summary.md`.
</output>

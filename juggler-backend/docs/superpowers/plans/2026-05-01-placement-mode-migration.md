# Placement Mode Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw flag reads (`marker`, `rigid`, `when='fixed'`) in the scheduler with a single `placement_mode` enum read, then convert that enum from a VIRTUAL column to a STORED column and drop the now-redundant `marker` and `rigid` DB columns.

**Architecture:** Two phases. Phase 2: `buildItems()` in `unifiedScheduleV2.js` switches from reading raw flags to reading `t.placementMode`; instTask objects in `runSchedule.js` get `placementMode` added. Phase 4: a migration converts the VIRTUAL column to STORED (backfilling from the existing CASE expression), drops `marker` and `rigid` from `task_masters`, rebuilds the views with computed `marker`/`rigid` columns (backward-compat shim for all non-scheduler readers), and the write-path derives `placement_mode` from incoming API fields.

**Tech Stack:** Node.js, MySQL 8, Knex.js migrations, Jest

---

## Files Modified

| File | What changes |
|------|-------------|
| `src/scheduler/unifiedScheduleV2.js` | `buildItems()`: raw flag reads → `pm = t.placementMode`. Stepper snapshot: `p.task.marker` → `p.task.placementMode`. |
| `src/scheduler/runSchedule.js` | Add `placementMode: master.placementMode` to the instTask clone object. |
| `src/controllers/task.controller.js` | `taskToRow()`: stop writing `rigid`/`marker`; add `placement_mode` derivation. `rowToTask()`: add `placementMode` field; keep `marker`/`rigid` derived from it. `isUserAnchored`: read `placement_mode`. |
| `src/lib/tasks-write.js` | Remove `rigid`/`marker` from `MASTER_FIELDS`, `MASTER_UPDATE_FIELDS`, `pickMaster()`. |
| `src/db/migrations/20260501000300_placement_mode_stored.js` | New migration: VIRTUAL → STORED, backfill, drop `marker`/`rigid`, rebuild views. |
| `tests/unifiedSchedule.test.js` | Update `makeTask()` calls: `marker: true` → `placementMode: 'marker'`; `rigid: true, recurring: true` → `placementMode: 'recurring_rigid', recurring: true`; `when: 'fixed'` tasks → `placementMode: 'fixed'`. |

---

## Task 1 — Phase 2: Update `buildItems()` in `unifiedScheduleV2.js`

**Files:**
- Modify: `src/scheduler/unifiedScheduleV2.js:222-388`

- [ ] **Replace the raw-flag block (lines 233–244) with placement_mode reads**

  The exact block to replace (lines 233–244):
  ```javascript
  var isMarker = !!t.marker;
  // Markers are calendar indicators — they coexist with other placements at
  // the same minute, so dur=0 means they never consume occupancy.
  var dur = isMarker ? 0 : effectiveDuration(t);
  var pri = normalizePri(t.pri);
  var priRank = PRI_RANK[pri] || 50;
  var when = t.when || '';
  var fixed = hasWhen(when, 'fixed');
  var allday = hasWhen(when, 'allday');
  var pinned = !!t.datePinned;
  var rigid = !!t.rigid;
  var recurring = !!t.recurring;
  var flexWhen = !!t.flexWhen;
  ```

  Replace with:
  ```javascript
  var pm = t.placementMode || 'flexible';
  var isMarker = pm === 'marker';
  // Markers are calendar indicators — they coexist with other placements at
  // the same minute, so dur=0 means they never consume occupancy.
  var dur = isMarker ? 0 : effectiveDuration(t);
  var pri = normalizePri(t.pri);
  var priRank = PRI_RANK[pri] || 50;
  var when = t.when || '';
  var fixed = pm === 'fixed';
  var allday = hasWhen(when, 'allday');
  var pinned = !!t.datePinned;
  var recurring = pm === 'recurring_rigid' || pm === 'recurring_window' || pm === 'recurring_flexible';
  var flexWhen = !!t.flexWhen;
  ```

- [ ] **Update the `anchorMin` block (line ~253)**

  Old:
  ```javascript
  if (recurring && t.preferredTimeMins != null && anchorMin == null) {
    anchorMin = t.preferredTimeMins;
  }
  ```

  New:
  ```javascript
  if ((pm === 'recurring_rigid' || pm === 'recurring_window') && t.preferredTimeMins != null && anchorMin == null) {
    anchorMin = t.preferredTimeMins;
  }
  ```

- [ ] **Replace `isWindowMode` derivation (lines ~283–303)**

  Old block:
  ```javascript
  // Time-window mode (preferred time ± flex) vs time-block mode (when tags).
  // Authoritative signal: preferred_time_mins is set AND not rigid. V1's
  // legacy `preferred_time` boolean is not in the DB — placement_mode's
  // `recurring_window` value is equivalent to these two conditions. In
  // window mode the `when` tags are ignored in favor of a narrow window
  // around preferredTimeMins; otherwise the when tags drive placement.
  var DEFAULT_TIME_FLEX = 60;
  var isWindowMode = !rigid && t.preferredTimeMins != null;
  ```

  New (keep the rest of the block — `windowLo`/`windowHi` clamping — unchanged):
  ```javascript
  // Time-window mode: placement_mode 'recurring_window' means preferred_time_mins
  // ± timeFlex. In window mode the `when` tags are ignored.
  var DEFAULT_TIME_FLEX = 60;
  var isWindowMode = pm === 'recurring_window';
  ```

- [ ] **Update `isDayLocked` (line ~349)**

  Old:
  ```javascript
  var isDayLocked = recurring && (rigid || splitTot > 1 || !isFlexibleTpc);
  ```

  New:
  ```javascript
  var isDayLocked = recurring && (pm === 'recurring_rigid' || splitTot > 1 || !isFlexibleTpc);
  ```

- [ ] **Update the `items.push()` block (line ~362)**

  Change `isRigid: rigid` to `isRigid: pm === 'recurring_rigid'`:
  ```javascript
  items.push({
    task: t,
    id: t.id,
    dur: dur,
    pri: pri,
    priRank: priRank,
    when: when,
    whenParts: parseWhen(when),
    isFixedWhen: fixed,
    isAllDay: allday,
    isPinned: pinned,
    isRigid: pm === 'recurring_rigid',   // ← changed from: rigid
    isRecurring: recurring,
    isMarker: isMarker,
    // ... rest unchanged
  ```

---

## Task 2 — Phase 2: Update stepper snapshot + instTask in runSchedule.js

**Files:**
- Modify: `src/scheduler/unifiedScheduleV2.js:505–544`
- Modify: `src/scheduler/runSchedule.js:725–754`

- [ ] **Fix stepper snapshot (unifiedScheduleV2.js line ~515)**

  Old:
  ```javascript
  locked: !!p.locked, marker: !!(p.task && p.task.marker)
  ```

  New:
  ```javascript
  locked: !!p.locked, marker: !!(p.task && p.task.placementMode === 'marker')
  ```

- [ ] **Fix stepper recording (unifiedScheduleV2.js line ~534)**

  Old:
  ```javascript
  rigid: !!t.rigid,
  ```

  New:
  ```javascript
  rigid: !!(t.placementMode === 'recurring_rigid'),
  ```

- [ ] **Add `placementMode` to instTask clone in runSchedule.js (line ~725–754)**

  The object being built there (recurring instance synthesis) needs `placementMode` so `buildItems()` can read it. Add after the existing `marker: master.marker` line:
  ```javascript
  placementMode: master.placementMode,
  ```

  (Keep `marker: master.marker` and `rigid: master.rigid` for now — they'll be removed in Task 5 when the columns are dropped. During Phase 2 the columns still exist so reading them is harmless.)

---

## Task 3 — Phase 2: Update scheduler tests

After Phase 2, `buildItems()` reads `t.placementMode` not raw flags. Any test that passes tasks directly to the scheduler (not through the API) must add `placementMode`. Tests that pass tasks to cal-sync adapters or through the full API do **not** need changes — the view and `rowToTask()` handle those.

**Transformation rules:**
- `marker: true` → remove; add `placementMode: 'marker'`
- `recurring: true, rigid: true` → keep `recurring: true`, remove `rigid: true`, add `placementMode: 'recurring_rigid'`
- `when: 'fixed', time: '...'` (for fixed non-recurring tasks going to the scheduler) → remove `when: 'fixed'`, add `placementMode: 'fixed'`
- `recurring: true, preferredTimeMins: N` (window mode) → keep both, add `placementMode: 'recurring_window'`

**Files:**
- Modify: `tests/unifiedSchedule.test.js`
- Modify: `tests/schedulerSupplyDemand.test.js`
- Modify: `tests/schedulerTimeSimulation.test.js`
- Modify: `tests/schedulerScenarios.test.js`
- Modify: `tests/schedulerRules.test.js`

- [ ] **`tests/unifiedSchedule.test.js` — apply transformation rules**

  Hits (run `grep -n "marker: true\|rigid: true\|when: 'fixed'" tests/unifiedSchedule.test.js` to confirm):
  - Line ~109: `marker: true` → `placementMode: 'marker'`
  - Lines ~152,163: `when: 'fixed', time: '9:00 AM'` → `placementMode: 'fixed', time: '9:00 AM'`
  - Line ~253: `recurring: true, rigid: true` → `placementMode: 'recurring_rigid', recurring: true`
  - Line ~283: `recurring: true, preferredTimeMins: 720` → add `placementMode: 'recurring_window'`

- [ ] **`tests/schedulerSupplyDemand.test.js` — apply transformation rules**

  All 13 hits are `recurring: true, rigid: true, when: 'lunch'|'morning'|'evening'`. For each:
  ```javascript
  // Old:
  makeTask({ id: 'recur1', recurring: true, rigid: true, when: 'lunch', dur: 30, ... })
  // New:
  makeTask({ id: 'recur1', placementMode: 'recurring_rigid', recurring: true, when: 'lunch', dur: 30, ... })
  ```
  Note: keep `when: 'lunch'` etc. — these time-block tags still drive `eligibleWindows()` for `recurring_rigid` tasks placed outside window mode.

- [ ] **`tests/schedulerTimeSimulation.test.js` — apply transformation rules**

  Line ~448: `marker: true, when: 'fixed'`
  ```javascript
  // Old:
  makeTask({ ..., marker: true, when: 'fixed' })
  // New:
  makeTask({ ..., placementMode: 'marker' })
  ```
  (A marker is zero-occupancy — it doesn't use the 'fixed' scheduling path.)

- [ ] **`tests/schedulerScenarios.test.js` — apply transformation rules**

  All hits are `recurring: true, rigid: true`. Apply the same pattern as `schedulerSupplyDemand.test.js`.

- [ ] **`tests/schedulerRules.test.js` — apply transformation rules**

  - `makeTask({ ..., recurring: true, rigid: true, ... })` (multiple hits) → add `placementMode: 'recurring_rigid'`, remove `rigid: true`
  - `makeTask({ ..., marker: true, ... })` (line ~570) → remove `marker: true`, add `placementMode: 'marker'`

---

## Task 4 — Phase 2: Run tests and commit

**Files:** none (test run only)

- [ ] **Run the full backend test suite**

  From `juggler-backend/`:
  ```bash
  npm test -- --testPathPattern="unifiedSchedule" --forceExit
  ```

  Expected: all tests pass. If any fail, the symptom will be a task that isn't placed where expected — trace back to which `makeTask()` call is still using raw flags.

- [ ] **Run the full suite to confirm no regressions**

  ```bash
  npm test --forceExit
  ```

  Expected: same pass/fail counts as before this task.

- [ ] **Commit Phase 2**

  ```bash
  git add src/scheduler/unifiedScheduleV2.js src/scheduler/runSchedule.js tests/unifiedSchedule.test.js
  git commit -m "feat(scheduler): read placement_mode enum in buildItems() instead of raw flags (#13 phase 2)"
  ```

---

## Task 5 — Phase 4a: Migration — VIRTUAL → STORED, drop `marker`/`rigid`

**Files:**
- Create: `src/db/migrations/20260501000300_placement_mode_stored.js`

- [ ] **Write the migration**

  ```javascript
  /**
   * Issue #13 Phase 4: convert placement_mode from VIRTUAL to STORED,
   * then drop the legacy marker and rigid flag columns.
   *
   * Order of operations:
   *   1. Drop the VIRTUAL column (MySQL can't ALTER VIRTUAL → regular in-place).
   *   2. Add placement_mode as a regular NOT NULL column, default 'flexible'.
   *   3. Backfill from existing flags using the same CASE expression.
   *   4. Drop marker and rigid columns.
   *   5. Rebuild views — expose computed marker/rigid for backward-compat readers.
   */
  exports.up = async function(knex) {
    // 1. Drop VIRTUAL column
    await knex.schema.table('task_masters', function(t) {
      t.dropColumn('placement_mode');
    });

    // 2. Add as regular stored column
    await knex.schema.table('task_masters', function(t) {
      t.enu('placement_mode', [
        'marker', 'fixed', 'pinned_date', 'recurring_rigid',
        'recurring_window', 'recurring_flexible', 'flexible'
      ]).notNullable().defaultTo('flexible').after('marker');
    });

    // 3. Backfill from existing flags (same CASE as the old VIRTUAL expression)
    await knex.raw(`
      UPDATE task_masters SET placement_mode = CASE
        WHEN marker = 1 THEN 'marker'
        WHEN \`when\` LIKE '%fixed%' THEN 'fixed'
        WHEN rigid = 1 AND recurring = 0 THEN 'fixed'
        WHEN recurring = 1 AND rigid = 1
             AND preferred_time_mins IS NOT NULL THEN 'recurring_rigid'
        WHEN recurring = 1 AND preferred_time_mins IS NOT NULL THEN 'recurring_window'
        WHEN recurring = 1 THEN 'recurring_flexible'
        ELSE 'flexible'
      END
    `);

    // 4. Drop legacy flag columns
    await knex.schema.table('task_masters', function(t) {
      t.dropColumn('marker');
      t.dropColumn('rigid');
    });

    // 5. Rebuild views — drop in reverse dependency order, recreate forward
    await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
    await knex.raw('DROP VIEW IF EXISTS tasks_v');

    // tasks_v: expose computed marker + rigid for all existing readers
    await knex.raw(`
      CREATE VIEW tasks_v AS
      SELECT
        m.id                         AS id,
        m.user_id                    AS user_id,
        CONVERT('recurring_template' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS task_type,
        m.text                       AS text,
        m.dur                        AS dur,
        m.pri                        AS pri,
        m.project                    AS project,
        m.section                    AS section,
        m.notes                      AS notes,
        m.url                        AS url,
        m.location                   AS location,
        m.tools                      AS tools,
        m.\`when\`                   AS \`when\`,
        m.day_req                    AS day_req,
        m.recurring                  AS recurring,
        CASE WHEN m.placement_mode = 'recurring_rigid' THEN 1 ELSE 0 END AS rigid,
        m.time_flex                  AS time_flex,
        m.flex_when                  AS flex_when,
        m.split                      AS split,
        m.split_min                  AS split_min,
        m.recur                      AS recur,
        m.recur_start                AS recur_start,
        m.recur_end                  AS recur_end,
        CASE WHEN m.placement_mode = 'marker' THEN 1 ELSE 0 END AS marker,
        m.preferred_time_mins        AS preferred_time_mins,
        m.placement_mode             AS placement_mode,
        m.travel_before              AS travel_before,
        m.travel_after               AS travel_after,
        m.depends_on                 AS depends_on,
        m.desired_at                 AS desired_at,
        m.disabled_at                AS disabled_at,
        m.disabled_reason            AS disabled_reason,
        m.deadline                   AS deadline,
        m.start_after_at             AS start_after_at,
        m.prev_when                  AS prev_when,
        m.tz                         AS tz,
        CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS source_id,
        NULL                         AS scheduled_at,
        NULL                         AS date_pinned,
        CAST(NULL AS DATE)           AS \`date\`,
        CAST(NULL AS CHAR(3)) COLLATE utf8mb4_unicode_ci AS \`day\`,
        CAST(NULL AS TIME)           AS \`time\`,
        CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS \`status\`,
        NULL                         AS time_remaining,
        NULL                         AS unscheduled,
        NULL                         AS overdue,
        NULL                         AS slack_mins,
        NULL                         AS occurrence_ordinal,
        NULL                         AS split_ordinal,
        NULL                         AS split_total,
        CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS split_group,
        CAST(0 AS UNSIGNED)          AS \`generated\`,
        CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS gcal_event_id,
        m.depends_on                 AS depends_on_json,
        m.created_at                 AS created_at,
        m.updated_at                 AS updated_at,
        CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS msft_event_id,
        CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS apple_event_id,
        m.id                         AS master_id
      FROM task_masters m
      WHERE m.recurring = 1

      UNION ALL

      SELECT
        i.id                         AS id,
        i.user_id                    AS user_id,
        CASE WHEN m.recurring = 1 THEN 'recurring_instance' ELSE 'task' END AS task_type,
        m.text                       AS text,
        COALESCE(i.dur, m.dur)       AS dur,
        m.pri                        AS pri,
        m.project                    AS project,
        m.section                    AS section,
        m.notes                      AS notes,
        m.url                        AS url,
        m.location                   AS location,
        m.tools                      AS tools,
        m.\`when\`                   AS \`when\`,
        m.day_req                    AS day_req,
        m.recurring                  AS recurring,
        CASE WHEN m.placement_mode = 'recurring_rigid' THEN 1 ELSE 0 END AS rigid,
        m.time_flex                  AS time_flex,
        m.flex_when                  AS flex_when,
        m.split                      AS split,
        m.split_min                  AS split_min,
        m.recur                      AS recur,
        m.recur_start                AS recur_start,
        m.recur_end                  AS recur_end,
        CASE WHEN m.placement_mode = 'marker' THEN 1 ELSE 0 END AS marker,
        m.preferred_time_mins        AS preferred_time_mins,
        m.placement_mode             AS placement_mode,
        m.travel_before              AS travel_before,
        m.travel_after               AS travel_after,
        m.depends_on                 AS depends_on,
        m.desired_at                 AS desired_at,
        m.disabled_at                AS disabled_at,
        m.disabled_reason            AS disabled_reason,
        m.deadline                   AS deadline,
        m.start_after_at             AS start_after_at,
        m.prev_when                  AS prev_when,
        m.tz                         AS tz,
        CASE WHEN m.recurring = 1 THEN m.id ELSE NULL END AS source_id,
        i.scheduled_at               AS scheduled_at,
        i.date_pinned                AS date_pinned,
        i.\`date\`                   AS \`date\`,
        i.\`day\`                    AS \`day\`,
        i.\`time\`                   AS \`time\`,
        i.\`status\`                 AS \`status\`,
        i.time_remaining             AS time_remaining,
        i.unscheduled                AS unscheduled,
        i.overdue                    AS overdue,
        i.slack_mins                 AS slack_mins,
        i.occurrence_ordinal         AS occurrence_ordinal,
        i.split_ordinal              AS split_ordinal,
        i.split_total                AS split_total,
        i.split_group                AS split_group,
        CAST(0 AS UNSIGNED)          AS \`generated\`,
        CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS gcal_event_id,
        m.depends_on                 AS depends_on_json,
        m.created_at                 AS created_at,
        i.updated_at                 AS updated_at,
        CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS msft_event_id,
        CONVERT(NULL USING utf8mb4) COLLATE utf8mb4_unicode_ci AS apple_event_id,
        i.master_id                  AS master_id
      FROM task_instances i
      JOIN task_masters m ON m.id = i.master_id
    `);

    await knex.raw(`
      CREATE VIEW tasks_with_sync_v AS
      SELECT
        v.id, v.user_id, v.task_type, v.text, v.dur, v.pri, v.project, v.section,
        v.notes, v.url, v.location, v.tools, v.\`when\`, v.day_req, v.recurring, v.rigid,
        v.time_flex, v.flex_when, v.split, v.split_min, v.recur, v.recur_start,
        v.recur_end, v.marker, v.preferred_time_mins, v.placement_mode,
        v.travel_before, v.travel_after,
        v.depends_on, v.desired_at, v.disabled_at, v.disabled_reason,
        v.deadline, v.start_after_at, v.prev_when, v.tz, v.source_id, v.scheduled_at,
        v.date_pinned, v.\`date\`, v.\`day\`, v.\`time\`, v.\`status\`, v.time_remaining,
        v.unscheduled, v.overdue, v.slack_mins, v.occurrence_ordinal, v.split_ordinal, v.split_total,
        v.split_group, v.\`generated\`, v.depends_on AS depends_on_json,
        v.created_at, v.updated_at, v.master_id,
        gcl.provider_event_id AS gcal_event_id,
        mcl.provider_event_id AS msft_event_id,
        acl.provider_event_id AS apple_event_id
      FROM tasks_v v
      LEFT JOIN (
        SELECT task_id, ANY_VALUE(provider_event_id) AS provider_event_id
        FROM cal_sync_ledger
        WHERE status = 'active' AND provider = 'gcal' AND task_id IS NOT NULL
        GROUP BY task_id
      ) gcl ON gcl.task_id = v.id
      LEFT JOIN (
        SELECT task_id, ANY_VALUE(provider_event_id) AS provider_event_id
        FROM cal_sync_ledger
        WHERE status = 'active' AND provider = 'msft' AND task_id IS NOT NULL
        GROUP BY task_id
      ) mcl ON mcl.task_id = v.id
      LEFT JOIN (
        SELECT task_id, ANY_VALUE(provider_event_id) AS provider_event_id
        FROM cal_sync_ledger
        WHERE status = 'active' AND provider = 'apple' AND task_id IS NOT NULL
        GROUP BY task_id
      ) acl ON acl.task_id = v.id
    `);
  };

  exports.down = async function(knex) {
    throw new Error(
      'Down migration for placement_mode_stored not implemented — ' +
      'restoring dropped columns requires data reconstruction from placement_mode.'
    );
  };
  ```

- [ ] **Run the migration**

  From `juggler-backend/`:
  ```bash
  npx knex migrate:latest
  ```

  Expected output: `Batch N run: 1 migrations`

- [ ] **Verify the column state**

  ```bash
  npx knex --client mysql2 raw "DESCRIBE task_masters" 2>/dev/null || \
  node -e "const k=require('./src/db/knex'); k.raw('DESCRIBE task_masters').then(r=>console.log(JSON.stringify(r[0].map(c=>({Field:c.Field,Type:c.Type,Extra:c.Extra})),null,2))).finally(()=>k.destroy())"
  ```

  Expected: `placement_mode` row shows `Type: enum(...)` with `Extra: ''` (not `VIRTUAL GENERATED`). No `marker` or `rigid` rows.

---

## Task 6 — Phase 4b: Update write-path

**Files:**
- Modify: `src/controllers/task.controller.js`
- Modify: `src/lib/tasks-write.js`

- [ ] **Add `derivePlacementMode` helper in `task.controller.js`** (near the top, after existing helper functions)

  ```javascript
  // Derives placement_mode from the set of scheduling fields.
  // Mirrors the CASE expression that was the VIRTUAL column definition.
  function derivePlacementMode(marker, rigid, when, recurring, preferredTimeMins) {
    if (marker) return 'marker';
    var whenStr = when || '';
    if (whenStr.includes('fixed')) return 'fixed';
    if (rigid && !recurring) return 'fixed';
    if (recurring && rigid && preferredTimeMins != null) return 'recurring_rigid';
    if (recurring && preferredTimeMins != null) return 'recurring_window';
    if (recurring) return 'recurring_flexible';
    return 'flexible';
  }
  ```

- [ ] **Update `taskToRow()` (line ~420) — stop writing `marker`/`rigid`, derive `placement_mode`**

  Remove these two lines:
  ```javascript
  if (task.rigid !== undefined) row.rigid = task.rigid ? 1 : 0;
  if (task.marker !== undefined) row.marker = task.marker ? 1 : 0;
  ```

  Add placement_mode derivation. Because PATCH operations may only send some fields, the caller (`updateTask`) must pass the current task values for any field not in the patch. Add an optional `currentTask` parameter to `taskToRow()`:

  Change signature:
  ```javascript
  function taskToRow(task, userId, timezone, currentTask) {
  ```

  Then add near the end of `taskToRow()`, before `row.updated_at = db.fn.now()`:
  ```javascript
  // Derive placement_mode whenever a placement-relevant field is touched.
  var placementFields = ['marker', 'rigid', 'when', 'recurring', 'preferredTimeMins', 'placementMode'];
  var touchesPlacement = placementFields.some(function(f) { return task[f] !== undefined; });
  if (touchesPlacement) {
    if (task.placementMode !== undefined) {
      row.placement_mode = task.placementMode;
    } else {
      var cur = currentTask || {};
      row.placement_mode = derivePlacementMode(
        task.marker !== undefined ? !!task.marker : !!(cur.marker),
        task.rigid  !== undefined ? !!task.rigid  : !!(cur.rigid),
        task.when   !== undefined ? task.when      : (cur.when || ''),
        task.recurring !== undefined ? !!task.recurring : !!(cur.recurring),
        task.preferredTimeMins !== undefined ? task.preferredTimeMins : cur.preferredTimeMins
      );
    }
  }
  ```

- [ ] **Pass `existing` into `taskToRow()` calls in `updateTask()` (line ~803)**

  Find every call to `taskToRow(task, ...)` inside `updateTask()` where `existing` or `fastExisting` is already loaded, and add it as the fourth argument:

  ```javascript
  // Fast path example (line ~848 area):
  var fastRow = taskToRow(req.body, req.user.id, req.timezone, fastExisting);

  // Slow path example (line ~927 area):
  var row = taskToRow(req.body, req.user.id, req.timezone, existing);
  ```

  In `createTask()` there is no current task — the fourth arg is omitted (or pass `null`).

- [ ] **Update `isUserAnchored` derivation (line ~302)**

  Old:
  ```javascript
  var isUserAnchored = boolish(row.date_pinned) || boolish(row.generated) ||
    boolish(row.recurring) || whenParts.indexOf('fixed') !== -1 || boolish(row.marker);
  ```

  New (the view now provides computed `marker`; `placement_mode` is also available):
  ```javascript
  var isUserAnchored = boolish(row.date_pinned) || boolish(row.generated) ||
    boolish(row.recurring) || whenParts.indexOf('fixed') !== -1 || boolish(row.marker) ||
    row.placement_mode === 'fixed' || row.placement_mode === 'marker';
  ```

- [ ] **Add `placementMode` to `rowToTask()` output (line ~384 area)**

  After the `marker` line:
  ```javascript
  marker: !!row.marker,
  ```

  Add:
  ```javascript
  placementMode: row.placement_mode || 'flexible',
  ```

- [ ] **Update `tasks-write.js` — remove `marker`/`rigid`, add `placement_mode`**

  In `MASTER_FIELDS` (line 20):
  - Remove `'rigid'` and `'marker'`
  - Add `'placement_mode'`

  In `MASTER_UPDATE_FIELDS` (line 50):
  - Remove `'rigid'` and `'marker'`
  - Add `'placement_mode'`

  In `pickMaster()` (line 82):
  - Remove: `out.rigid = out.rigid ? 1 : 0;`
  - Remove: `out.marker = out.marker ? 1 : 0;`

---

## Task 7 — Phase 4c: Run tests and commit Phase 4

- [ ] **Run the full backend test suite**

  ```bash
  npm test --forceExit
  ```

  Expected: same pass counts. If integration tests fail on "Unknown column 'rigid'" or "Unknown column 'marker'" that means there's still a write path sending those columns — search for `row.rigid` or `row.marker` and remove.

- [ ] **Spot-check the view shape integration test**

  ```bash
  npm test -- --testPathPattern="viewShape" --forceExit
  ```

  Expected: passes. This test verifies the DB view columns match expected shape — confirm `marker` and `rigid` still appear (now computed) and `placement_mode` appears as a non-null enum value.

- [ ] **Commit Phase 4**

  ```bash
  git add \
    src/db/migrations/20260501000300_placement_mode_stored.js \
    src/controllers/task.controller.js \
    src/lib/tasks-write.js
  git commit -m "feat(db): placement_mode STORED; drop marker/rigid columns (#13 phase 4)"
  ```

---

## Task 8 — Update docs and Issues.txt

**Files:**
- Modify: `docs/SCHEMA.md`
- Modify: `docs/SCHEDULER.md` (if it mentions raw flags)
- Modify: `docs/SCHEDULER-V2-SPEC.md` (mark phases complete)

- [ ] **Update SCHEMA.md `placement_mode` section**

  Change the note "scheduler v1 ignores it; v2 will branch on it" to "scheduler reads placement_mode directly; marker and rigid columns are dropped — views expose computed booleans for backward compatibility."

- [ ] **Mark #13 complete in Issues.txt**

  Move issue #13 from the "Deferred" / design-decisions section into Done with:
  ```
  13.  can we consolidate the date in the 'task_master' to be simpler... [DONE 2026-05-01 — placement_mode ENUM stored column; scheduler reads it directly; marker+rigid dropped; views expose computed booleans]
  ```

- [ ] **Commit docs**

  ```bash
  git add docs/SCHEMA.md docs/SCHEDULER.md docs/SCHEDULER-V2-SPEC.md
  git add -p  # check Issues.txt too
  git commit -m "docs: mark placement_mode migration complete (#13)"
  ```

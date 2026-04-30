# Time Column MySQL Type Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `task_instances.time` from `varchar(20)` (storing `"H:MM AM/PM"` strings) to MySQL `TIME` (storing `"HH:MM:SS"`), update the scheduler write path to produce the new format, and rebuild the views that reference the column.

**Architecture:** The DB `time` column is a denormalized cache written only by the scheduler; `rowToTask()` derives `task.time` from `scheduled_at` and never reads `row.time` from the DB, so the app-layer `task.time` property always stays as `"H:MM AM/PM"` and requires zero changes. Only three things change: (1) a new DB-format helper is added to `dateHelpers.js`, (2) `runSchedule.js` uses it for the single write, (3) a migration backfills existing rows and alters the column.

**Tech Stack:** Node.js/Express, MySQL 8, Knex.js migrations, shared `dateHelpers.js`

---

## File Map

| Action | Path | Change |
|--------|------|--------|
| Modify | `juggler/shared/scheduler/dateHelpers.js` | Add `formatMinutesToTimeDb(mins)` helper |
| Modify | `juggler/juggler-backend/src/scheduler/runSchedule.js` | Use `formatMinutesToTimeDb` at line ~855 |
| Create | `juggler/juggler-backend/src/db/migrations/20260501000000_time_column_to_time_type.js` | Backfill + ALTER + view rebuild |

---

### Task 1: Add `formatMinutesToTimeDb()` to dateHelpers.js

The existing `formatMinutesToTime(mins)` returns `"H:MM AM/PM"` (e.g. `"5:00 PM"`) for display. We need a parallel DB variant that returns `"HH:MM:SS"` (e.g. `"17:00:00"`) for MySQL `TIME` storage. This is the only new function; do not change any existing functions.

**Files:**
- Modify: `juggler/shared/scheduler/dateHelpers.js`

- [ ] **Step 1: Write the failing test**

  In `juggler/juggler-backend/tests/dateHelpers.test.js` (or wherever dateHelpers tests live — search for it first):
  ```js
  const { formatMinutesToTimeDb } = require('../../../shared/scheduler/dateHelpers');

  describe('formatMinutesToTimeDb', () => {
    it('converts midnight (0) to 00:00:00', () => {
      expect(formatMinutesToTimeDb(0)).toBe('00:00:00');
    });
    it('converts 5:00 PM (1020) to 17:00:00', () => {
      expect(formatMinutesToTimeDb(1020)).toBe('17:00:00');
    });
    it('converts 11:30 AM (690) to 11:30:00', () => {
      expect(formatMinutesToTimeDb(690)).toBe('11:30:00');
    });
    it('converts noon (720) to 12:00:00', () => {
      expect(formatMinutesToTimeDb(720)).toBe('12:00:00');
    });
  });
  ```

- [ ] **Step 2: Locate the test file and run to verify it fails**

  ```bash
  # Find the test file
  find juggler/juggler-backend/tests -name "*.test.js" | grep -i date
  # Run it (adjust path to match what you found)
  cd juggler/juggler-backend && npm test -- --testPathPattern=dateHelpers
  ```
  Expected: FAIL with "formatMinutesToTimeDb is not a function"

- [ ] **Step 3: Add the function to dateHelpers.js**

  Find the `formatMinutesToTime` function (around line 258) and add the new function directly after it:
  ```js
  function formatMinutesToTimeDb(startMin) {
    var hh = Math.floor(startMin / 60);
    var mm = startMin % 60;
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm + ':00';
  }
  ```

  Then add `formatMinutesToTimeDb` to the module exports at the bottom of `dateHelpers.js`. Search for the `module.exports` block and add it there.

- [ ] **Step 4: Run tests to verify they pass**

  ```bash
  cd juggler/juggler-backend && npm test -- --testPathPattern=dateHelpers
  ```
  Expected: PASS (all 4 new tests green)

- [ ] **Step 5: Run the full quality gate**

  ```bash
  cd juggler/juggler-backend && npm run lint && npm test
  ```
  Expected: lint clean, all tests pass

- [ ] **Step 6: Commit**

  ```bash
  cd juggler
  git add shared/scheduler/dateHelpers.js juggler-backend/tests/dateHelpers.test.js
  git commit -m "feat(scheduler): add formatMinutesToTimeDb helper for MySQL TIME writes"
  ```

---

### Task 2: Update runSchedule.js to use `formatMinutesToTimeDb`

The scheduler computes a placement start (integer minutes since midnight) and writes it to the DB. Currently at line ~855:
```js
var newTime = formatMinutesToTime(placement.start);  // produces "H:MM AM/PM" — wrong for DB
```
After this task, `newTime` will be `"HH:MM:SS"` for the DB write while the in-memory `t.time` on the task object (derived by `rowToTask()` from `scheduled_at`) continues to return `"H:MM AM/PM"` to the app layer unchanged.

**Files:**
- Modify: `juggler/juggler-backend/src/scheduler/runSchedule.js`

- [ ] **Step 1: Locate the exact line**

  ```bash
  grep -n "formatMinutesToTime" juggler/juggler-backend/src/scheduler/runSchedule.js
  ```
  You will see at least two hits:
  - The `require` / `var` destructuring at the top
  - The actual call that produces `newTime` (around line 855)

- [ ] **Step 2: Update the require/import line**

  Find the line where `formatMinutesToTime` is destructured from `dateHelpers` (likely near the top of `runSchedule.js`, within a `require` or destructuring block). Add `formatMinutesToTimeDb` to the same destructuring. Example — if you see:
  ```js
  var { ..., formatMinutesToTime, ... } = require('../../shared/scheduler/dateHelpers');
  ```
  Change to:
  ```js
  var { ..., formatMinutesToTime, formatMinutesToTimeDb, ... } = require('../../shared/scheduler/dateHelpers');
  ```
  (Adjust the actual path and destructuring style to match what's already there.)

- [ ] **Step 3: Change the write-path call**

  Find the line that reads:
  ```js
  var newTime = formatMinutesToTime(placement.start);
  ```
  Change it to:
  ```js
  var newTime = formatMinutesToTimeDb(placement.start);
  ```
  Do NOT change any other call to `formatMinutesToTime` — those remain for display/app-layer use.

- [ ] **Step 4: Run the quality gate**

  ```bash
  cd juggler/juggler-backend && npm run lint && npm test
  ```
  Expected: lint clean, all tests pass (scheduler tests should pass; the column is still varchar at this point so writes still succeed)

- [ ] **Step 5: Commit**

  ```bash
  cd juggler
  git add juggler-backend/src/scheduler/runSchedule.js
  git commit -m "feat(scheduler): write HH:MM:SS to task_instances.time (prep for TIME column)"
  ```

---

### Task 3: Write and run the migration

The migration must: drop both views, backfill all existing `"H:MM AM/PM"` rows to `"HH:MM:SS"`, alter the column to `TIME NULL`, then rebuild both views with the template-branch `time` placeholder changed from `CONVERT(NULL USING utf8mb4)` to `CAST(NULL AS TIME)`.

The full view SQL comes from the most recent view-creating migration: `20260428000000_tighten_instance_date_day_types.js`. Copy it verbatim and make only the one `time` template-branch change.

**Files:**
- Create: `juggler/juggler-backend/src/db/migrations/20260501000000_time_column_to_time_type.js`

The `tasks_with_sync_v` definition is unchanged — it references `v.time` from `tasks_v` and requires no edits.

- [ ] **Step 1: Write the migration file**

  Create `juggler/juggler-backend/src/db/migrations/20260501000000_time_column_to_time_type.js`:

  ```js
  /**
   * Issue #19: task_instances.time varchar(20) → TIME
   *
   * Existing rows store "H:MM AM/PM" strings. MySQL STR_TO_DATE('%l:%i %p')
   * converts them to 24h time which MySQL then stores as TIME.
   *
   * Views must be dropped and rebuilt because MySQL caches column types at
   * view creation time. The template branch changes its time placeholder from
   * CONVERT(NULL USING utf8mb4) to CAST(NULL AS TIME) so the UNION ALL types
   * stay consistent across branches.
   *
   * rowToTask() derives task.time from scheduled_at (not from this column), so
   * no app-layer code changes are needed beyond the scheduler write path.
   */
  exports.up = async function(knex) {
    // 1. Drop views — they pin task_instances.time's column type.
    await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
    await knex.raw('DROP VIEW IF EXISTS tasks_v');

    // 2. Backfill: convert "H:MM AM/PM" strings → MySQL TIME.
    //    STR_TO_DATE('%l:%i %p'): %l=12h hour (no leading zero), %i=min, %p=AM/PM
    //    NULL rows remain NULL.
    await knex.raw(
      "UPDATE task_instances SET `time` = STR_TO_DATE(`time`, '%l:%i %p') WHERE `time` IS NOT NULL"
    );

    // 3. Alter column type.
    await knex.raw('ALTER TABLE task_instances MODIFY `time` TIME NULL');

    // 4. Rebuild tasks_v — copy from 20260428000000 with one change:
    //    template branch time placeholder: CONVERT(NULL...) → CAST(NULL AS TIME)
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
        m.rigid                      AS rigid,
        m.time_flex                  AS time_flex,
        m.flex_when                  AS flex_when,
        m.split                      AS split,
        m.split_min                  AS split_min,
        m.recur                      AS recur,
        m.recur_start                AS recur_start,
        m.recur_end                  AS recur_end,
        m.marker                     AS marker,
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
        m.rigid                      AS rigid,
        m.time_flex                  AS time_flex,
        m.flex_when                  AS flex_when,
        m.split                      AS split,
        m.split_min                  AS split_min,
        m.recur                      AS recur,
        m.recur_start                AS recur_start,
        m.recur_end                  AS recur_end,
        m.marker                     AS marker,
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

    // 5. Rebuild tasks_with_sync_v — unchanged from 20260428000000.
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
        v.unscheduled, v.slack_mins, v.occurrence_ordinal, v.split_ordinal, v.split_total,
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
    // Reverse: drop views, widen column back to varchar, backfill TIME → "H:MM AM/PM"
    await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
    await knex.raw('DROP VIEW IF EXISTS tasks_v');
    await knex.raw(
      "ALTER TABLE task_instances MODIFY `time` VARCHAR(20) " +
      "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL"
    );
    // TIME values come back as "HH:MM:SS" after widening — convert to "H:MM AM/PM"
    await knex.raw(
      "UPDATE task_instances SET `time` = DATE_FORMAT(`time`, '%l:%i %p') WHERE `time` IS NOT NULL"
    );
    throw new Error(
      'Down-migration leaves views dropped. Re-run the latest view-creating migration to restore tasks_v / tasks_with_sync_v.'
    );
  };
  ```

- [ ] **Step 2: Run the migration against your dev DB**

  ```bash
  cd juggler/juggler-backend
  npx knex migrate:latest --env development
  ```
  Expected: Migration completes with no errors.

- [ ] **Step 3: Verify the backfill and column type**

  Connect to your MySQL dev DB and run:
  ```sql
  DESCRIBE task_instances;
  -- Confirm: Field=time, Type=time, Null=YES

  SELECT time FROM task_instances WHERE time IS NOT NULL LIMIT 10;
  -- Confirm: values look like "17:00:00", "09:30:00", etc. (not "H:MM AM/PM")

  SELECT * FROM tasks_v LIMIT 3;
  -- Should return without error

  SELECT * FROM tasks_with_sync_v LIMIT 3;
  -- Should return without error
  ```

- [ ] **Step 4: Run the quality gate**

  ```bash
  cd juggler/juggler-backend && npm run lint && npm test
  ```
  Expected: lint clean, all tests pass

- [ ] **Step 5: Smoke-test the running app**

  Start the backend (`juggler-backend/`) and frontend (`juggler-frontend/`). Open the app and confirm:
  - Tasks load correctly
  - Scheduled tasks show the correct time (e.g., "5:00 PM" — derived from `scheduled_at`, not the DB column)
  - The scheduler runs without errors (trigger a manual reschedule if possible)
  - No console errors about invalid time values

- [ ] **Step 6: Commit**

  ```bash
  cd juggler
  git add juggler-backend/src/db/migrations/20260501000000_time_column_to_time_type.js
  git commit -m "feat(db): migrate task_instances.time from varchar to MySQL TIME (issue #19)"
  ```

---

## Self-Review

**Spec coverage:**
- ✅ `formatMinutesToTimeDb()` helper added (Task 1)
- ✅ Scheduler write path updated (Task 2)
- ✅ Backfill + column alter (Task 3)
- ✅ Views rebuilt with correct placeholder type (Task 3)
- ✅ App-layer `task.time` (`"H:MM AM/PM"`) unaffected — `rowToTask()` ignores DB column

**Placeholder scan:** All steps contain actual code or commands. No TBDs.

**Type consistency:**
- `formatMinutesToTimeDb(startMin)` — takes integer minutes, returns `"HH:MM:SS"` string
- `STR_TO_DATE(\`time\`, '%l:%i %p')` — handles existing `"H:MM AM/PM"` rows (e.g. `"5:00 PM"` → `17:00:00`)
- `CAST(NULL AS TIME)` — correct MySQL NULL cast for the UNION ALL template branch

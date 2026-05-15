'use strict';

/**
 * Drop dead-by-stat columns where audit evidence (2026-05-08) confirms 100% NULL
 * population and zero application code references.
 *
 * Discovery process:
 *   1. Read .planning/todos/pending/2026-05-08-juggler-db-db-055-*.md through -074-*.md
 *      (20 dead-by-stat findings from the juggler code-review audit).
 *   2. Grepped all 20 candidate columns across juggler-backend/src/**\/*.js and
 *      juggler-frontend/src/**\/*.{js,jsx}.
 *   3. Only columns with ZERO references in application code are included here.
 *
 * Result: 1 column dropped, 19 skipped (all have active code references).
 *
 * ── Column dropped ───────────────────────────────────────────────────────────
 *
 *   cal_sync_ledger.calendar_id  (DB-055)
 *     Added in 20260415000000_create_user_calendars.js for future multi-calendar
 *     awareness on the ledger. SCHEMA.md §cal_sync_ledger/#1 confirms it is
 *     "not populated by any insert site" (100% NULL, 61309 rows, audit 2026-05-08).
 *     All application references to `calendar_id` in apple.adapter.js and
 *     apple-cal.controller.js are against the `user_calendars` table, not this one.
 *     The `cal_sync_ledger` SELECT and INSERT sites never set or read this column.
 *
 * ── Columns skipped (active code references found) ───────────────────────────
 *
 *   cal_sync_ledger.error_detail  (DB-056)
 *     Read by health.routes.js:142 and written by cal-sync.controller.js:1529.
 *     The audit flagged it as 100% NULL but the code path that writes it fires
 *     on push errors — absence of data means no errors occurred, not dead code.
 *
 *   feature_events.request_id  (DB-057)
 *     Written by feature-gate.js:31 (reads x-request-id header).
 *
 *   sync_history.error_detail  (DB-058)
 *     Written via logSyncAction() (cal-sync.controller.js:172) on sync errors.
 *
 *   sync_history.calendar_name  (DB-059)
 *     Written via logSyncAction() and read by cal-sync.controller.js:2280 and
 *     CalSyncPanel.jsx:1082 for display in the sync history UI.
 *
 *   task_instances.time_remaining  (DB-060)
 *     Actively read/written by runSchedule.js, task.controller.js, tasks-write.js.
 *
 *   task_instances.slack_mins  (DB-061)
 *     Actively written by runSchedule.js (7+ sites) and read by task.controller.js.
 *
 *   task_instances.generated  (DB-062)
 *     Actively read by runSchedule.js (6+ guards), schedulerSession.js,
 *     cal-sync.controller.js, tasks-write.js, and ConflictsView.jsx.
 *
 *   task_masters.recur_end  (DB-063)
 *     Actively read/written by task.controller.js and task-write-queue.js.
 *
 *   task_masters.split_min  (DB-064)
 *     Actively read by reconcile-splits.js and runSchedule.js.
 *
 *   task_masters.travel_before  (DB-065)
 *     Read/written by task.controller.js.
 *
 *   task_masters.travel_after  (DB-066)
 *     Read/written by task.controller.js.
 *
 *   task_masters.disabled_at  (DB-067)
 *     Read/written by task.controller.js, task-write-queue.js,
 *     billing-webhooks.controller.js, and reconcile-splits.js.
 *
 *   task_masters.disabled_reason  (DB-068)
 *     Read/written by task.controller.js and billing-webhooks.controller.js.
 *
 *   task_masters.weather_cloud  (DB-069)
 *     Read/written by task.controller.js and tasks-write.js.
 *
 *   task_masters.weather_temp_min  (DB-070)
 *     Read/written by task.controller.js and tasks-write.js.
 *
 *   task_masters.weather_temp_max  (DB-071)
 *     Read/written by task.controller.js and tasks-write.js.
 *
 *   task_masters.weather_temp_unit  (DB-072)
 *     Read/written by task.controller.js and tasks-write.js.
 *
 *   task_masters.weather_humidity_min  (DB-073)
 *     Read/written by task.controller.js and tasks-write.js.
 *
 *   task_masters.weather_humidity_max  (DB-074)
 *     Read/written by task.controller.js and tasks-write.js.
 */

exports.up = async function(knex) {
  const hasLedger = await knex.schema.hasTable('cal_sync_ledger');
  if (!hasLedger) return;

  const hasColumn = await knex.schema.hasColumn('cal_sync_ledger', 'calendar_id');
  if (!hasColumn) return;

  await knex.schema.alterTable('cal_sync_ledger', function(t) {
    t.dropColumn('calendar_id');
  });
};

exports.down = async function(knex) {
  const hasLedger = await knex.schema.hasTable('cal_sync_ledger');
  if (!hasLedger) return;

  const hasColumn = await knex.schema.hasColumn('cal_sync_ledger', 'calendar_id');
  if (hasColumn) return; // already present — nothing to restore

  await knex.schema.alterTable('cal_sync_ledger', function(t) {
    // VARCHAR(500) with explicit collation to match the table's utf8mb4_unicode_ci
    // collation (set by 20260508000100_fix_core_tables_collation.js).
    // Positioned after `provider` to match the original column order.
    t.string('calendar_id', 500).collate('utf8mb4_unicode_ci').nullable().after('provider');
  });
};

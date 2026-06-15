/**
 * Index hygiene — re-derived from the live test schema (juggler_test) cross-
 * referenced against grep-confirmed query patterns in src/.
 *
 * Conservative by mandate: ADDs are safe and are added freely where a real hot
 * query needs them; DROPs are limited to strict leading-prefix DUPLICATES whose
 * coverage (including the underlying FK) is fully provided by a wider index that
 * remains. Anything uncertain is FLAGGED in the audit report, NOT dropped.
 *
 * ── ADD ────────────────────────────────────────────────────────────────────
 *   1. cal_sync_ledger(task_id, status)
 *      The single hottest ledger predicate in the task slice is
 *      `(task_id, status='active')`. It appears in the task facade and repo on
 *      the per-task read/update path, e.g.:
 *        - slices/task/adapters/KnexTaskRepository.js:163  .where({ task_id, status:'active' })
 *        - slices/task/facade.js:374-376, 462, 519-520, 562-563, 590-591, 665-666, 808-809
 *      Today only the single-column `cal_sync_ledger_task_id_index (task_id)`
 *      exists; MySQL must filter `status` as a residual. The existing
 *      `idx_csl_provider_status_task (provider, status, task_id)` does NOT lead
 *      with task_id, so it cannot serve `(task_id, status)` lookups. A
 *      `(task_id, status)` composite makes these exact-match reads index-only on
 *      the predicate and is a strict superset of the single-col `task_id`
 *      index (so the latter is dropped below — see DROP #1 note).
 *
 * ── DROP (strict leading-prefix duplicates) ─────────────────────────────────
 *   (REMOVED — was: drop cal_sync_ledger_user_id_index. Migration 20260515001000
 *    deliberately KEPT that index because (user_id, status)-without-provider
 *    queries use it as an optimizer tiebreak. Not reversed here. ernie WARN-3.)
 *
 *   2. cal_sync_ledger.cal_sync_ledger_task_id_index (task_id)
 *      Made redundant by the new ADD #1 `idx_csl_task_status (task_id, status)`,
 *      which leads with task_id and thus serves every `where task_id` lookup as
 *      well as the standalone index did. Net change on task_id: same leading
 *      column, one extra trailing column — no coverage lost.
 *
 *   3. user_calendars.user_calendars_user_id_provider_index (user_id, provider)
 *      Redundant: the UNIQUE `user_calendars_user_id_provider_calendar_id_unique
 *      (user_id, provider, calendar_id)` is a strict superset and serves both
 *      the `(user_id, provider)` reads (controllers/apple-cal.controller.js,
 *      slices/calendar/adapters/AppleCalendarAdapter.js:53,
 *      slices/task/adapters/KnexTaskRepository.js:222) and the
 *      `user_calendars_user_id_foreign` FK on user_id (leads with user_id).
 *
 * ── FLAGGED, NOT TOUCHED (see report) ───────────────────────────────────────
 *   - cal_history's 4 secondary indexes: grep-confirmed unread today (table is
 *     insert-only + purge-by-created_at), but were deliberately created "for
 *     performance" for a planned reporting surface; one of them serves the
 *     task_id FK. Forward-looking design decision — left in place.
 *   - cal_sync_ledger_status_index (status): never a leading predicate alone,
 *     but low cost and a plausible status-sweep target. Left in place.
 *   - feature_events created_at-leading admin query has no created_at index, but
 *     it is a low-traffic service-key analytics route where writes dominate.
 *     Not worth indexing. Left in place.
 */

async function indexExists(knex, table, keyName) {
  try {
    var rows = await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [table, keyName]);
    return rows[0].length > 0;
  } catch (e) {
    // Table may not exist on a bare DB; let the caller decide.
    return false;
  }
}

exports.up = async function (knex) {
  // ADD #1 — cal_sync_ledger(task_id, status)
  if (!(await indexExists(knex, 'cal_sync_ledger', 'idx_csl_task_status'))) {
    await knex.raw(
      'CREATE INDEX idx_csl_task_status ON cal_sync_ledger (task_id, status) ' +
        "COMMENT 'task slice per-task active-ledger lookups'"
    );
  }

  // DROP #2 — cal_sync_ledger_task_id_index (now subsumed by idx_csl_task_status).
  // Done AFTER the ADD so the FK/lookups are never momentarily index-less.
  if (await indexExists(knex, 'cal_sync_ledger', 'cal_sync_ledger_task_id_index')) {
    await knex.raw('DROP INDEX cal_sync_ledger_task_id_index ON cal_sync_ledger');
  }

  // (NOTE: the originally-planned drop of cal_sync_ledger_user_id_index was
  // REMOVED — migration 20260515001000 deliberately KEPT it because several
  // queries filter (user_id, status) without provider and the standalone index
  // is a useful optimizer tiebreak there (e.g. cal-sync.controller.js:2167).
  // Reversing that documented keep-decision is out of scope here. ernie WARN-3.)

  // DROP #2 — user_calendars_user_id_provider_index (subsumed by the unique
  // (user_id, provider, calendar_id)).
  if (await indexExists(knex, 'user_calendars', 'user_calendars_user_id_provider_index')) {
    await knex.raw('DROP INDEX user_calendars_user_id_provider_index ON user_calendars');
  }
};

exports.down = async function (knex) {
  // Reverse in mirror order. Recreate dropped indexes first, then drop the added.

  if (!(await indexExists(knex, 'user_calendars', 'user_calendars_user_id_provider_index'))) {
    await knex.raw(
      'CREATE INDEX user_calendars_user_id_provider_index ON user_calendars (user_id, provider)'
    );
  }

  if (!(await indexExists(knex, 'cal_sync_ledger', 'cal_sync_ledger_task_id_index'))) {
    await knex.raw('CREATE INDEX cal_sync_ledger_task_id_index ON cal_sync_ledger (task_id)');
  }

  if (await indexExists(knex, 'cal_sync_ledger', 'idx_csl_task_status')) {
    await knex.raw('DROP INDEX idx_csl_task_status ON cal_sync_ledger');
  }
};

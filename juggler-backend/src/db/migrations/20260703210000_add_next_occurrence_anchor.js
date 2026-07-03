'use strict';

/**
 * 999.1091 (C1) — add nullable `next_occurrence_anchor` DATE column to task_masters
 * and expose it in tasks_v / tasks_with_sync_v.
 *
 * Rationale: the recurrence-anchor concept (today `rolling_anchor`, only ever
 * populated for recur.type==='rolling') generalizes to ALL other recur types
 * (daily/weekly/biweekly/monthly/interval) so the scheduler always has a
 * "next occurrence in this master's own pattern" pointer, advanced on each
 * terminal (done/skip) event — see juggler-backend/src/lib/next-occurrence-anchor.js.
 *
 * Schema decision (David, PM call, 2026-07-03): a NEW column, not a widened
 * `rolling_anchor`. The semantics genuinely differ — rolling_anchor anchors to the
 * ACTUAL completion date (arithmetic-projection type); next_occurrence_anchor anchors
 * to the next THEORETICAL occurrence in the master's own calendar pattern. Conflating
 * them in one column would make rolling_anchor misleading for non-rolling masters.
 * rolling-anchor.js / rolling_anchor are completely UNCHANGED by this migration.
 *
 * Migration policy (juggler CLAUDE.md 999.733 / template: 20260624120000_add_earliest_
 * start_to_task_instances.js): schema changes that alter tasks_v's shape MUST recreate
 * the view in the same migration. NEVER hand-copy the view body — read it live
 * (SHOW CREATE VIEW) and inject the new column by anchoring on an existing column
 * present in every branch that needs it. DDL implies commit -> non-transactional.
 *
 * Anchor choice: NOT `rolling_anchor` — verified live (test-bed, fresh migrate:latest,
 * 2026-07-03) that `tasks_v` does NOT currently expose `rolling_anchor` at all, even
 * though `task_masters.rolling_anchor` exists and is correctly read/written on the raw
 * table by facade.js/mcp/tasks.js. Root cause (separately tracked, OUT OF SCOPE here —
 * flagged to backlog): `20260520000100_add_rolling_anchor.js` added rolling_anchor to
 * the view correctly, but the LATER `20260614010000_recreate_tasks_v_with_completed_at.js`
 * hand-coded the view's full SQL from a captured snapshot that omitted it (that
 * migration's own header even documents the general hazard: a prior regex-patch
 * silently no-op'd due to MySQL DDL normalization — the snapshot itself was simply
 * incomplete), and no later migration restored it (unlike `end_date`/`unplaced_reason`,
 * which DID get dedicated "restore" migrations after similar drops). Net effect: any
 * read path through tasks_v/tasks_with_sync_v (e.g. taskMappers.js's `rollingAnchor`
 * projection, consumed by expandRecurring.js's getAnchor) has been silently getting
 * `rolling_anchor: null` since 2026-06-14, even though the master row's actual column
 * is populated — the WRITE side works, the VIEW read side has been dark. Filed as a
 * new backlog item (see HANDOFF); this migration only needs a reliable anchor point,
 * so it uses `m`.`weather_humidity_max` AS `weather_humidity_max` — verified present,
 * IDENTICAL, exactly twice (once per union branch) in the live view as of this
 * migration — rather than the missing rolling_anchor column.
 */
exports.config = { transaction: false };

// Strip the non-portable DEFINER/ALGORITHM/SQL SECURITY preamble so the def can be
// re-created cleanly, then normalize "CREATE VIEW" → "CREATE OR REPLACE VIEW" is not
// needed — we DROP + CREATE explicitly, matching the sibling earliest_start migration.
function portableViewSql(createViewStmt) {
  return String(createViewStmt)
    .replace(/^CREATE\s+ALGORITHM=\S+\s+DEFINER=`[^`]+`@`[^`]+`\s+SQL SECURITY \w+\s+VIEW/i, 'CREATE VIEW');
}

function replaceAll(haystack, needle, replacement) {
  return haystack.split(needle).join(replacement);
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

exports.up = async function up(knex) {
  // 1. Add the column.
  var hasCol = await knex.schema.hasColumn('task_masters', 'next_occurrence_anchor');
  if (!hasCol) {
    await knex.schema.table('task_masters', function(t) {
      t.date('next_occurrence_anchor').nullable().defaultTo(null);
    });
  }

  // 2. Read BOTH live view definitions FIRST (tasks_with_sync_v depends on tasks_v,
  //    so it must be dropped before tasks_v — but we need its CURRENT def, which is
  //    only readable while it still exists, so capture both before dropping either).
  var rowsV = await knex.raw('SHOW CREATE VIEW `tasks_v`');
  var sqlV = portableViewSql(rowsV[0][0]['Create View']);
  if (sqlV.includes('next_occurrence_anchor')) return; // idempotent — already injected

  var rowsSync = await knex.raw('SHOW CREATE VIEW `tasks_with_sync_v`');
  var sqlSync = portableViewSql(rowsSync[0][0]['Create View']);

  // 3. Inject next_occurrence_anchor next to weather_humidity_max in tasks_v — BOTH
  //    union branches share the identical literal (weather_humidity_max lives on the
  //    joined master row `m` in either branch, same as rolling_anchor would), so one
  //    global replace covers both. (rolling_anchor itself is NOT used as the anchor —
  //    see the file header note — it is absent from the live view.)
  var vAnchor = '`m`.`weather_humidity_max` AS `weather_humidity_max`';
  var vCount = countOccurrences(sqlV, vAnchor);
  if (vCount !== 2) {
    throw new Error('add_next_occurrence_anchor: expected 2 occurrences of the weather_humidity_max anchor in tasks_v, found ' + vCount + ' — view shape unexpected; aborting to avoid a malformed view');
  }
  sqlV = replaceAll(sqlV, vAnchor, vAnchor + ',`m`.`next_occurrence_anchor` AS `next_occurrence_anchor`');

  // 4. Inject v.next_occurrence_anchor next to v.weather_humidity_max in
  //    tasks_with_sync_v (which SELECTs straight through from tasks_v — single
  //    occurrence expected). Anchor on the FULL "`v`.`col` AS `col`" literal, not just
  //    the bare column reference — `v`.`weather_humidity_max` alone is a substring of
  //    that longer literal and would insert mid-clause, splitting "AS `col`" in half
  //    and producing a duplicate-column-name view (caught live: see commit history).
  var syncAnchor = '`v`.`weather_humidity_max` AS `weather_humidity_max`';
  var syncCount = countOccurrences(sqlSync, syncAnchor);
  if (syncCount !== 1) {
    throw new Error('add_next_occurrence_anchor: expected 1 occurrence of the weather_humidity_max anchor in tasks_with_sync_v, found ' + syncCount + ' — view shape unexpected; aborting to avoid a malformed view');
  }
  sqlSync = replaceAll(sqlSync, syncAnchor, syncAnchor + ',`v`.`next_occurrence_anchor`');

  // 5. Drop dependent-first, recreate base-first.
  await knex.raw('DROP VIEW IF EXISTS `tasks_with_sync_v`');
  await knex.raw('DROP VIEW IF EXISTS `tasks_v`');
  await knex.raw(sqlV);
  await knex.raw(sqlSync);
};

exports.down = async function down(knex) {
  var rowsV = await knex.raw('SHOW CREATE VIEW `tasks_v`');
  var sqlV = portableViewSql(rowsV[0][0]['Create View']);
  sqlV = sqlV.split(',`m`.`next_occurrence_anchor` AS `next_occurrence_anchor`').join('');

  var hasSyncView = await knex.schema.hasTable('tasks_with_sync_v');
  var sqlSync = null;
  if (hasSyncView) {
    var rowsSync = await knex.raw('SHOW CREATE VIEW `tasks_with_sync_v`');
    sqlSync = portableViewSql(rowsSync[0][0]['Create View']);
    // NOTE: the bare (no-AS) literal inserted by up() is what THIS migration wrote,
    // but MySQL's view-definition storage always re-normalizes to an explicit alias
    // on any subsequent SHOW CREATE VIEW read (verified live) — so the CURRENT text
    // being stripped here always carries " AS `next_occurrence_anchor`", never bare.
    // Stripping the bare form left a dangling `AS \`col\`` (ernie BLOCK, ref 999.1091).
    sqlSync = sqlSync.split(',`v`.`next_occurrence_anchor` AS `next_occurrence_anchor`').join('');
  }

  await knex.raw('DROP VIEW IF EXISTS `tasks_with_sync_v`');
  await knex.raw('DROP VIEW IF EXISTS `tasks_v`');
  await knex.raw(sqlV);
  if (sqlSync) await knex.raw(sqlSync);

  var hasCol = await knex.schema.hasColumn('task_masters', 'next_occurrence_anchor');
  if (hasCol) {
    await knex.schema.table('task_masters', function(t) {
      t.dropColumn('next_occurrence_anchor');
    });
  }
};

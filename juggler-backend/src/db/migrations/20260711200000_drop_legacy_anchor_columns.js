'use strict';

/**
 * Drop the legacy `rolling_anchor` and `next_occurrence_anchor` columns from
 * `task_masters`. `next_start` (added by 20260709120000) is now the single
 * unified anchor — getAnchor() reads it first and the dual-write path has been
 * collapsed to next_start-only.
 *
 * This migration:
 *   1. Backfills any NULL next_start from the legacy columns (safety net — the
 *      W1 migration already did this, but rows created between W1 and this
 *      migration that somehow got a legacy anchor without next_start are covered).
 *   2. Drops `rolling_anchor` and `next_occurrence_anchor` from task_masters.
 *   3. Recreates tasks_v / tasks_with_sync_v WITHOUT the dropped columns.
 *
 * The canonical view SSOT (src/db/views/canonical-views.sql + view-columns.json)
 * is updated in lockstep — run `node scripts/regenerate-canonical-views.js`
 * against a freshly-migrated *_test DB after applying this migration.
 */
exports.config = { transaction: false };

var migrationHelpers = require('../migration-helpers');
var portableViewSql = migrationHelpers.portableViewSql;
var replaceAll = migrationHelpers.replaceAll;
var countOccurrences = migrationHelpers.countOccurrences;

exports.up = async function up(knex) {
  // 1. Safety-net backfill: next_start = COALESCE(rolling_anchor, next_occurrence_anchor)
  await knex.raw(
    'UPDATE `task_masters` SET `next_start` = COALESCE(`rolling_anchor`, `next_occurrence_anchor`) ' +
    'WHERE `next_start` IS NULL AND (`rolling_anchor` IS NOT NULL OR `next_occurrence_anchor` IS NOT NULL)'
  );

  // 2. Read current view definitions, strip the two dropped columns.
  var rowsV = await knex.raw('SHOW CREATE VIEW `tasks_v`');
  var sqlV = portableViewSql(rowsV[0][0]['Create View']);

  // Strip rolling_anchor and next_occurrence_anchor from tasks_v (appears twice —
  // once per UNION branch, both referencing `m`).
  var rollingAnchorLit = ',`m`.`rolling_anchor` AS `rolling_anchor`';
  var nextOccAnchorLit = ',`m`.`next_occurrence_anchor` AS `next_occurrence_anchor`';

  // ponytail: the column order in the view may have next_occurrence_anchor BEFORE
  // rolling_anchor, so strip both independently.
  var vCountRA = countOccurrences(sqlV, rollingAnchorLit);
  if (vCountRA !== 2 && vCountRA !== 0) {
    throw new Error('drop_legacy_anchor_columns: expected 0 or 2 occurrences of rolling_anchor in tasks_v, found ' + vCountRA);
  }
  if (vCountRA === 2) sqlV = replaceAll(sqlV, rollingAnchorLit, '');

  var vCountNOA = countOccurrences(sqlV, nextOccAnchorLit);
  if (vCountNOA !== 2 && vCountNOA !== 0) {
    throw new Error('drop_legacy_anchor_columns: expected 0 or 2 occurrences of next_occurrence_anchor in tasks_v, found ' + vCountNOA);
  }
  if (vCountNOA === 2) sqlV = replaceAll(sqlV, nextOccAnchorLit, '');

  var syncExists = await knex.schema.hasTable('tasks_with_sync_v');
  var sqlSync = null;
  if (syncExists) {
    var rowsSync = await knex.raw('SHOW CREATE VIEW `tasks_with_sync_v`');
    sqlSync = portableViewSql(rowsSync[0][0]['Create View']);

    var syncRALit = ',`v`.`rolling_anchor` AS `rolling_anchor`';
    var syncNOALit = ',`v`.`next_occurrence_anchor` AS `next_occurrence_anchor`';

    var syncCountRA = countOccurrences(sqlSync, syncRALit);
    if (syncCountRA !== 1 && syncCountRA !== 0) {
      throw new Error('drop_legacy_anchor_columns: expected 0 or 1 occurrences of rolling_anchor in tasks_with_sync_v, found ' + syncCountRA);
    }
    if (syncCountRA === 1) sqlSync = replaceAll(sqlSync, syncRALit, '');

    var syncCountNOA = countOccurrences(sqlSync, syncNOALit);
    if (syncCountNOA !== 1 && syncCountNOA !== 0) {
      throw new Error('drop_legacy_anchor_columns: expected 0 or 1 occurrences of next_occurrence_anchor in tasks_with_sync_v, found ' + syncCountNOA);
    }
    if (syncCountNOA === 1) sqlSync = replaceAll(sqlSync, syncNOALit, '');
  }

  // 3. Drop views first (dependent first), recreate without the dropped columns.
  await knex.raw('DROP VIEW IF EXISTS `tasks_with_sync_v`');
  await knex.raw('DROP VIEW IF EXISTS `tasks_v`');
  await knex.raw(sqlV);
  if (sqlSync) await knex.raw(sqlSync);

  // 4. Drop the columns. Guarded with hasColumn (mirrors down()'s re-add guard)
  //    so a retry after a partial-failure mid-up() doesn't wedge trying to drop
  //    an already-dropped column.
  var hasRAToDrop = await knex.schema.hasColumn('task_masters', 'rolling_anchor');
  var hasNOAToDrop = await knex.schema.hasColumn('task_masters', 'next_occurrence_anchor');
  if (hasRAToDrop || hasNOAToDrop) {
    await knex.schema.table('task_masters', function(t) {
      if (hasRAToDrop) t.dropColumn('rolling_anchor');
      if (hasNOAToDrop) t.dropColumn('next_occurrence_anchor');
    });
  }
};

exports.down = async function down(knex) {
  // Re-add the columns.
  var hasRA = await knex.schema.hasColumn('task_masters', 'rolling_anchor');
  var hasNOA = await knex.schema.hasColumn('task_masters', 'next_occurrence_anchor');
  if (!hasRA || !hasNOA) {
    await knex.schema.table('task_masters', function(t) {
      if (!hasRA) t.date('rolling_anchor').nullable().defaultTo(null);
      if (!hasNOA) t.date('next_occurrence_anchor').nullable().defaultTo(null);
    });
  }

  // Backfill from next_start so the legacy columns have data.
  await knex.raw(
    'UPDATE `task_masters` SET `rolling_anchor` = `next_start` ' +
    'WHERE `rolling_anchor` IS NULL AND `next_start` IS NOT NULL AND ' +
    "JSON_EXTRACT(`recur`, '$.type') = '\"rolling\"'"
  );
  await knex.raw(
    'UPDATE `task_masters` SET `next_occurrence_anchor` = `next_start` ' +
    'WHERE `next_occurrence_anchor` IS NULL AND `next_start` IS NOT NULL AND ' +
    "JSON_EXTRACT(`recur`, '$.type') != '\"rolling\"'"
  );

  // Re-inject the columns into the views.
  var rowsV = await knex.raw('SHOW CREATE VIEW `tasks_v`');
  var sqlV = portableViewSql(rowsV[0][0]['Create View']);
  var nextStartLit = ',`m`.`next_start` AS `next_start`';
  sqlV = replaceAll(sqlV, nextStartLit,
    nextStartLit + ',`m`.`rolling_anchor` AS `rolling_anchor`,`m`.`next_occurrence_anchor` AS `next_occurrence_anchor`');

  var syncExists = await knex.schema.hasTable('tasks_with_sync_v');
  var sqlSync = null;
  if (syncExists) {
    var rowsSync = await knex.raw('SHOW CREATE VIEW `tasks_with_sync_v`');
    sqlSync = portableViewSql(rowsSync[0][0]['Create View']);
    sqlSync = replaceAll(sqlSync, ',`v`.`next_start` AS `next_start`',
      ',`v`.`next_start` AS `next_start`,`v`.`rolling_anchor` AS `rolling_anchor`,`v`.`next_occurrence_anchor` AS `next_occurrence_anchor`');
  }

  await knex.raw('DROP VIEW IF EXISTS `tasks_with_sync_v`');
  await knex.raw('DROP VIEW IF EXISTS `tasks_v`');
  await knex.raw(sqlV);
  if (sqlSync) await knex.raw(sqlSync);
};
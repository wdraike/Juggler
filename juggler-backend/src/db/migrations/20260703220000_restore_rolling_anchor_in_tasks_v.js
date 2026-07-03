'use strict';

/**
 * 999.1094 — restore `rolling_anchor` to `tasks_v` / `tasks_with_sync_v`.
 *
 * Root cause (discovered as a side-finding while building 999.1091, verifying that
 * migration end-to-end against a live DB — see its file header): `rolling_anchor` was
 * added to both views correctly by `20260520000100_add_rolling_anchor.js`, but the
 * LATER `20260614010000_recreate_tasks_v_with_completed_at.js` hand-coded the view's
 * full SQL from a captured snapshot that omitted it, and no later migration restored
 * it (unlike `end_date`/`unplaced_reason`, which DID get dedicated restores after
 * similar drops). `task_masters.rolling_anchor` itself is fine and correctly written
 * (facade.js `applyRollingAnchor`, mcp/tools/tasks.js `set_task_status`) — only the
 * VIEW read path was dark. Consequence: `runSchedule.js:621` reads `allTasks`
 * exclusively from `tasks_v`; `taskMappers.js`'s `rollingAnchor: row.rolling_anchor ||
 * null` therefore always evaluated to null for every row the scheduler ever saw;
 * `expandRecurring.js`'s `getAnchor` never received a real anchor and silently fell
 * back to the static `recur_start` for every rolling-type master since 2026-06-14.
 *
 * Anchored on `next_occurrence_anchor` (added by the immediately-prior migration,
 * `20260703210000_add_next_occurrence_anchor.js`, in this same batch) rather than on
 * any older column — guaranteed present and, being brand new, has zero risk of having
 * ALSO been silently dropped by some other historical hand-copy migration.
 *
 * DDL implies commit → non-transactional. See sibling migration for the general
 * SHOW-CREATE-VIEW-and-inject policy (juggler CLAUDE.md 999.733).
 */
exports.config = { transaction: false };

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
  var rowsV = await knex.raw('SHOW CREATE VIEW `tasks_v`');
  var sqlV = portableViewSql(rowsV[0][0]['Create View']);
  if (sqlV.includes('`m`.`rolling_anchor`')) return; // idempotent — already present

  var rowsSync = await knex.raw('SHOW CREATE VIEW `tasks_with_sync_v`');
  var sqlSync = portableViewSql(rowsSync[0][0]['Create View']);

  // tasks_v: inject next to next_occurrence_anchor in BOTH union branches (identical
  // literal in both — same joined master row `m`).
  var vAnchor = '`m`.`next_occurrence_anchor` AS `next_occurrence_anchor`';
  var vCount = countOccurrences(sqlV, vAnchor);
  if (vCount !== 2) {
    throw new Error('restore_rolling_anchor: expected 2 occurrences of the next_occurrence_anchor anchor in tasks_v, found ' + vCount + ' — view shape unexpected; aborting to avoid a malformed view');
  }
  sqlV = replaceAll(sqlV, vAnchor, vAnchor + ',`m`.`rolling_anchor` AS `rolling_anchor`');

  // tasks_with_sync_v: inject next to v.next_occurrence_anchor. Verified live
  // (fresh migrate:latest with this migration held back) that MySQL renders this
  // specific passthrough WITH an explicit "AS" clause — anchor on the full literal,
  // not the bare column reference (a bare anchor is a substring/prefix of the full
  // literal and would insert mid-clause, producing a duplicate-column-name view).
  var syncAnchor = '`v`.`next_occurrence_anchor` AS `next_occurrence_anchor`';
  var syncCount = countOccurrences(sqlSync, syncAnchor);
  if (syncCount !== 1) {
    throw new Error('restore_rolling_anchor: expected 1 occurrence of the next_occurrence_anchor anchor in tasks_with_sync_v, found ' + syncCount + ' — view shape unexpected; aborting to avoid a malformed view');
  }
  sqlSync = replaceAll(sqlSync, syncAnchor, syncAnchor + ',`v`.`rolling_anchor`');

  await knex.raw('DROP VIEW IF EXISTS `tasks_with_sync_v`');
  await knex.raw('DROP VIEW IF EXISTS `tasks_v`');
  await knex.raw(sqlV);
  await knex.raw(sqlSync);
};

exports.down = async function down(knex) {
  var rowsV = await knex.raw('SHOW CREATE VIEW `tasks_v`');
  var sqlV = portableViewSql(rowsV[0][0]['Create View']);
  sqlV = sqlV.split(',`m`.`rolling_anchor` AS `rolling_anchor`').join('');

  var rowsSync = await knex.raw('SHOW CREATE VIEW `tasks_with_sync_v`');
  var sqlSync = portableViewSql(rowsSync[0][0]['Create View']);
  // NOTE: MySQL's view-definition storage always re-normalizes to an explicit
  // alias on any subsequent SHOW CREATE VIEW read (verified live), even though
  // up() inserted the bare (no-AS) literal — so the CURRENT text being stripped
  // here always carries " AS `rolling_anchor`", never bare. Stripping the bare
  // form left a dangling `AS \`col\`` (ernie BLOCK, ref 999.1091/999.1094).
  sqlSync = sqlSync.split(',`v`.`rolling_anchor` AS `rolling_anchor`').join('');

  await knex.raw('DROP VIEW IF EXISTS `tasks_with_sync_v`');
  await knex.raw('DROP VIEW IF EXISTS `tasks_v`');
  await knex.raw(sqlV);
  await knex.raw(sqlSync);
};

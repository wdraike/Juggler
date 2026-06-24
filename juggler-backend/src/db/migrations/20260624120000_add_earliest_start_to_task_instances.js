'use strict';

/**
 * Leg A (scheduler-recurring-rework) — add nullable `earliest_start` DATE column to
 * task_instances and expose it in tasks_v.
 *
 * Rationale (MILESTONE-SPEC §1, "instance-owns-its-window"): a recurring/split
 * instance must carry its scheduling window ON THE ROW — a SOFT `earliest_start`
 * floor (default = the occurrence's spaced target day, relaxable later) alongside
 * the already-stored HARD `implied_deadline` (cycle boundary). The scheduler then
 * reads the window off the row instead of reconstructing it every run.
 *
 * Migration policy (juggler CLAUDE.md 999.733):
 *   - Schema changes that alter tasks_v shape MUST recreate the view in the same
 *     migration so the read model never lags.
 *   - NEVER hand-copy the full view body — it has been rebuilt by many migrations
 *     and the body differs per environment (memory: juggler-prod-migration-lag,
 *     retro-config / hand-copy landmine). Instead this migration reads the LIVE
 *     view definition (SHOW CREATE VIEW) and injects the new column by anchoring on
 *     the existing `implied_deadline` columns (present in BOTH union branches since
 *     20260621000000). This is environment-safe: it preserves whatever columns the
 *     current view already has (end_date, unplaced_reason, etc.) and only adds
 *     earliest_start. DDL implies commit → non-transactional.
 */
exports.config = { transaction: false };

// Strip the non-portable DEFINER/ALGORITHM/SQL SECURITY preamble so the def can be
// re-created cleanly, then normalize "CREATE VIEW" → "CREATE OR REPLACE VIEW".
function portableViewSql(createViewStmt) {
  return String(createViewStmt)
    .replace(/^CREATE\s+ALGORITHM=\S+\s+DEFINER=`[^`]+`@`[^`]+`\s+SQL SECURITY \w+\s+VIEW/i, 'CREATE VIEW');
}

exports.up = async function up(knex) {
  // 1. Add the column.
  const hasCol = await knex.schema.hasColumn('task_instances', 'earliest_start');
  if (!hasCol) {
    await knex.schema.table('task_instances', function(t) {
      t.date('earliest_start').nullable().defaultTo(null);
    });
  }

  // 2. Read the live view and inject earliest_start next to implied_deadline in BOTH
  //    union branches (instance branch: real column; template branch: NULL cast).
  const rows = await knex.raw('SHOW CREATE VIEW `tasks_v`');
  let sql = portableViewSql(rows[0][0]['Create View']);
  if (sql.includes('earliest_start')) return; // idempotent — already injected

  // instance branch anchor: `i`.`implied_deadline` AS `implied_deadline`
  const instAnchor = '`i`.`implied_deadline` AS `implied_deadline`';
  // template branch anchor: cast(NULL as date) AS `implied_deadline`
  const tmplAnchor = 'cast(NULL as date) AS `implied_deadline`';
  if (!sql.includes(instAnchor) || !sql.includes(tmplAnchor)) {
    throw new Error('add_earliest_start: implied_deadline anchors not found in tasks_v — view shape unexpected; aborting to avoid a malformed view');
  }
  sql = sql.replace(instAnchor, instAnchor + ',`i`.`earliest_start` AS `earliest_start`');
  sql = sql.replace(tmplAnchor, tmplAnchor + ',cast(NULL as date) AS `earliest_start`');

  await knex.raw('DROP VIEW IF EXISTS `tasks_v`');
  await knex.raw(sql);
};

exports.down = async function down(knex) {
  // Rebuild the view without earliest_start (read live, strip the injected columns),
  // then drop the column.
  const rows = await knex.raw('SHOW CREATE VIEW `tasks_v`');
  let sql = portableViewSql(rows[0][0]['Create View']);
  sql = sql
    .replace(',`i`.`earliest_start` AS `earliest_start`', '')
    .replace(',cast(NULL as date) AS `earliest_start`', '');
  await knex.raw('DROP VIEW IF EXISTS `tasks_v`');
  await knex.raw(sql);
  const hasCol = await knex.schema.hasColumn('task_instances', 'earliest_start');
  if (hasCol) {
    await knex.schema.table('task_instances', function(t) {
      t.dropColumn('earliest_start');
    });
  }
};

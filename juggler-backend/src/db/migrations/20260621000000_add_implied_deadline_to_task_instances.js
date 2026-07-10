'use strict';

/**
 * Add nullable `implied_deadline` DATE column to task_instances (R50.7).
 *
 * The recurring/split implied deadline (recurringPeriodEndKey output) is NOT
 * SQL-expressible — it requires JS recurrence classification — so it MUST be
 * materialized to a column during the scheduler's expand/reconcile insert pass
 * (W3) rather than computed in a generated column.
 *
 * Migration policy (juggler CLAUDE.md 999.733):
 *   - Schema changes that alter tasks_v shape MUST recreate the view in the same
 *     migration (DROP VIEW IF EXISTS → CREATE VIEW) so the read model never lags.
 *   - COLLATE utf8mb4_unicode_ci explicit on all string columns/view where (re)created.
 *   - DDL (CREATE/DROP VIEW) causes MySQL implicit commits → non-transactional.
 *
 * 999.1403/999.1295 REWRITE (2026-07-09): the original up()/down() restated the
 * FULL June-21 view body as frozen strings (UP_VIEW_SQL / DOWN_VIEW_SQL) — the
 * exact "hand-copied view body" trap 999.1189 bans. Both snapshots referenced
 * `i`.`overdue`, which 20260703190000_drop_overdue_column later removed, so any
 * out-of-sequence down()/up() (the committed round-trip test
 * tests/db/20260621000000_implied_deadline.test.js drives this migration's own
 * down()/up() directly against a CURRENT schema) failed at CREATE VIEW and left
 * `tasks_v` DROPPED — corrupting the shared juggler_test schema for every
 * subsequent suite in a full-gate run. Rewritten to the 999.733 discipline:
 * read the LIVE `SHOW CREATE VIEW`, anchor-patch the implied_deadline
 * projections in/out, never restate the body. Sequence-equivalent: applied at
 * its own slot the live view IS the 20260614010000 shape, so the patched
 * result is byte-identical to the old UP_VIEW_SQL / DOWN_VIEW_SQL outputs.
 * (Editing an applied migration is allowed here because the resulting schema
 * at every sequence position is unchanged — only out-of-sequence
 * reversibility, which was BROKEN, changes.)
 */
exports.config = { transaction: false };

var { portableViewSql } = require('../migration-helpers');

// Projections this migration owns (leading commas — the completed_at
// projection they append to is never the first item in either UNION arm).
var TEMPLATE_PROJ = ',cast(NULL as date) AS `implied_deadline`';
var INSTANCE_PROJ = ',`i`.`implied_deadline` AS `implied_deadline`';
// Insert anchors: the completed_at projection of each UNION arm.
// 'NULL AS `completed_at`' is unique to the template arm;
// '`i`.`completed_at` AS `completed_at`' is unique to the instance arm.
var TEMPLATE_ANCHOR = 'NULL AS `completed_at`';
var INSTANCE_ANCHOR = '`i`.`completed_at` AS `completed_at`';

async function readLiveTasksV(knex) {
  var rows = await knex.raw('SHOW CREATE VIEW `tasks_v`');
  return portableViewSql(rows[0][0]['Create View']);
}

exports.up = async function(knex) {
  // 1. Add the column (skip if a half-completed prior run already added it).
  var hasCol = await knex.schema.hasColumn('task_instances', 'implied_deadline');
  if (!hasCol) {
    await knex.schema.table('task_instances', function(t) {
      t.date('implied_deadline').nullable().defaultTo(null);
    });
  }

  // 2. Patch the LIVE view: expose implied_deadline in both UNION arms,
  //    anchored directly after each arm's completed_at projection (canonical
  //    position). Idempotent: skip if the projections are already present.
  var sql = await readLiveTasksV(knex);
  if (sql.indexOf(TEMPLATE_PROJ) === -1 && sql.indexOf(INSTANCE_PROJ) === -1) {
    if (sql.indexOf(TEMPLATE_ANCHOR) === -1 || sql.indexOf(INSTANCE_ANCHOR) === -1) {
      throw new Error(
        '20260621000000 up(): completed_at anchors not found in both tasks_v ' +
        'UNION arms — view shape unexpected; aborting to avoid a malformed view. ' +
        'Inspect `SHOW CREATE VIEW tasks_v` and update the anchors.'
      );
    }
    sql = sql
      .replace(TEMPLATE_ANCHOR, TEMPLATE_ANCHOR + TEMPLATE_PROJ)
      .replace(INSTANCE_ANCHOR, INSTANCE_ANCHOR + INSTANCE_PROJ);
    await knex.raw('DROP VIEW IF EXISTS `tasks_v`');
    await knex.raw(sql);
  }
};

exports.down = async function(knex) {
  // 1. Patch the LIVE view: strip this migration's implied_deadline projections
  //    from both UNION arms FIRST (the view must never reference a dropped
  //    column). Anchor-strip, never restate the body.
  var sql = await readLiveTasksV(knex);
  var hasTemplateProj = sql.indexOf(TEMPLATE_PROJ) !== -1;
  var hasInstanceProj = sql.indexOf(INSTANCE_PROJ) !== -1;
  if (hasTemplateProj !== hasInstanceProj) {
    throw new Error(
      '20260621000000 down(): implied_deadline projection found in only ONE ' +
      'tasks_v UNION arm — view shape unexpected; aborting to avoid a ' +
      'malformed view. Inspect `SHOW CREATE VIEW tasks_v`.'
    );
  }
  if (hasTemplateProj && hasInstanceProj) {
    sql = sql.replace(TEMPLATE_PROJ, '').replace(INSTANCE_PROJ, '');
    await knex.raw('DROP VIEW IF EXISTS `tasks_v`');
    await knex.raw(sql);
  }

  // 2. Drop the column.
  var hasCol = await knex.schema.hasColumn('task_instances', 'implied_deadline');
  if (hasCol) {
    await knex.schema.table('task_instances', function(t) {
      t.dropColumn('implied_deadline');
    });
  }
};

'use strict';

/**
 * W4 (sched-drop-overdue-column, M-5 / 999.1085) — drop `task_instances.overdue`.
 *
 * Standing ruling (David): "no persistent overdue field — always calculated."
 * `overdue` becomes computed-on-read ONLY (taskMappers.js `computeOverdueForRow`,
 * W1). Every writer of the stored column was removed in W1-W3 (this leg) BEFORE
 * this migration lands — see SPEC.md "Design — write-side sites that become dead"
 * and TRACEABILITY.md WRITE-1/READ-1 — so no live code path still expects the
 * column to exist by the time this runs.
 *
 * Steps (juggler CLAUDE.md 999.733 view-recreate discipline — read live
 * `SHOW CREATE VIEW`, anchor-replace, NEVER hand-copy a view body):
 *   1. Drop `idx_task_instances_missed_scan` (added 20260630120000 for the
 *      cal-history cron's `overdue=0` scan) — its sole consumer (markMissedTasks)
 *      was retired in this same leg's W2 (see cal-history-cron.js), and the
 *      indexed column is about to disappear regardless.
 *   2. Read the LIVE `tasks_v` view SQL and strip the `overdue` projection from
 *      BOTH UNION branches via anchor-replace (mirrors 20260625000000's
 *      injection style, run in reverse — removal instead of addition).
 *   3. DROP + recreate `tasks_with_sync_v` then `tasks_v` (drop dependent view
 *      first — MySQL errors on dropping a view another view depends on).
 *      `tasks_with_sync_v` is ALSO read live + anchor-replaced (not hand-copied)
 *      — the most recent migration touching it (20260625000000) hardcoded a
 *      literal snapshot, but juggler CLAUDE.md 999.733 flags hand-copying a
 *      view body as a documented drift hazard (memory: juggler-prod-migration-
 *      lag), so this migration applies the SAME live-read anchor-replace
 *      discipline to tasks_with_sync_v as it does to tasks_v, eliminating that
 *      risk entirely rather than perpetuating it.
 *   4. `ALTER TABLE task_instances DROP COLUMN overdue`.
 *
 * DDL (CREATE/DROP VIEW, ALTER TABLE) causes MySQL implicit commits —
 * non-transactional so knex does not wrap this in a misleading transaction.
 */

exports.config = { transaction: false };

const INDEX_NAME = 'idx_task_instances_missed_scan';

async function indexExists(knex, table, indexName) {
  const rows = await knex.raw(
    'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1',
    [table, indexName]
  );
  return rows[0].length > 0;
}

// Strip the non-portable DEFINER/ALGORITHM/SQL SECURITY preamble so the def
// can be re-created cleanly (mirrors 20260624120000's portableViewSql).
function portableViewSql(createViewStmt) {
  return String(createViewStmt)
    .replace(/^CREATE\s+ALGORITHM=\S+\s+DEFINER=`[^`]+`@`[^`]+`\s+SQL SECURITY \w+\s+VIEW/i, 'CREATE VIEW');
}

exports.up = async function up(knex) {
  // 1. Drop the now-dead cal-history-cron scan index (idempotent guard, mirrors
  //    20260630120000's own add-side guard in reverse).
  if (await indexExists(knex, 'task_instances', INDEX_NAME)) {
    await knex.raw(`DROP INDEX ${INDEX_NAME} ON task_instances`);
  }

  // 2. Read the live tasks_v view and strip the `overdue` projection from BOTH
  //    UNION branches. Idempotent — a re-run after `overdue` is already gone
  //    from tasks_v is a no-op for this view (still falls through to check
  //    tasks_with_sync_v and the column itself below).
  const tvRows = await knex.raw('SHOW CREATE VIEW `tasks_v`');
  let tvSql = portableViewSql(tvRows[0][0]['Create View']);

  const tvTemplateAnchor = 'NULL AS `overdue`,';
  const tvInstanceAnchor = '`i`.`overdue` AS `overdue`,';
  const tvNeedsStrip = tvSql.includes(tvTemplateAnchor) || tvSql.includes(tvInstanceAnchor);

  if (tvNeedsStrip) {
    if (!tvSql.includes(tvTemplateAnchor) || !tvSql.includes(tvInstanceAnchor)) {
      throw new Error(
        'drop_overdue_column: `overdue` anchors not found in BOTH tasks_v UNION ' +
        'branches — view shape unexpected; aborting to avoid a malformed view. ' +
        'Inspect `SHOW CREATE VIEW tasks_v` and update the anchors.'
      );
    }
    tvSql = tvSql.replace(tvTemplateAnchor, '').replace(tvInstanceAnchor, '');
  }

  // 3. tasks_with_sync_v: read live + strip `overdue` too (single SELECT over
  //    tasks_v, no UNION — one anchor).
  const svRows = await knex.raw('SHOW CREATE VIEW `tasks_with_sync_v`');
  let svSql = portableViewSql(svRows[0][0]['Create View']);
  const svAnchor = '`v`.`overdue` AS `overdue`,';
  const svNeedsStrip = svSql.includes(svAnchor);
  if (svNeedsStrip) {
    svSql = svSql.replace(svAnchor, '');
  }

  if (tvNeedsStrip || svNeedsStrip) {
    // Drop dependent view first, then the base view; recreate both.
    await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
    await knex.raw('DROP VIEW IF EXISTS tasks_v');
    await knex.raw(tvSql);
    await knex.raw(svSql);
  }

  // 4. Drop the column itself.
  const hasCol = await knex.schema.hasColumn('task_instances', 'overdue');
  if (hasCol) {
    await knex.schema.table('task_instances', function (t) {
      t.dropColumn('overdue');
    });
  }
};

exports.down = async function down(knex) {
  // Schema-only revert — does NOT attempt to backfill correct values into the
  // resurrected column (accepted limitation, same as 20260501000100's original
  // down() note: the computed value is not retro-persistable without re-running
  // the scheduler for every historical row).
  const hasCol = await knex.schema.hasColumn('task_instances', 'overdue');
  if (!hasCol) {
    await knex.schema.table('task_instances', function (t) {
      t.tinyint('overdue').notNullable().defaultTo(0);
    });
  }

  if (!(await indexExists(knex, 'task_instances', INDEX_NAME))) {
    await knex.raw(`CREATE INDEX ${INDEX_NAME} ON task_instances (overdue, scheduled_at)`);
  }

  // Restore the view projections. Re-inject `overdue` into both tasks_v UNION
  // branches (anchoring on `unscheduled`, present in both) and into
  // tasks_with_sync_v (anchoring on `v`.`unscheduled`), mirroring the up()
  // anchor-replace in reverse.
  const tvRows = await knex.raw('SHOW CREATE VIEW `tasks_v`');
  let tvSql = portableViewSql(tvRows[0][0]['Create View']);
  const tvNeedsRestore = !tvSql.includes('`overdue`');

  if (tvNeedsRestore) {
    const tvTemplateAnchor = 'NULL AS `unscheduled`,';
    const tvInstanceAnchor = '`i`.`unscheduled` AS `unscheduled`,';
    if (!tvSql.includes(tvTemplateAnchor) || !tvSql.includes(tvInstanceAnchor)) {
      throw new Error(
        'drop_overdue_column.down: `unscheduled` anchors not found in BOTH ' +
        'tasks_v UNION branches — cannot restore `overdue` projection.'
      );
    }
    tvSql = tvSql
      .replace(tvTemplateAnchor, tvTemplateAnchor + 'NULL AS `overdue`,')
      .replace(tvInstanceAnchor, tvInstanceAnchor + '`i`.`overdue` AS `overdue`,');
  }

  const svRows = await knex.raw('SHOW CREATE VIEW `tasks_with_sync_v`');
  let svSql = portableViewSql(svRows[0][0]['Create View']);
  const svNeedsRestore = !svSql.includes('`overdue`');
  if (svNeedsRestore) {
    const svAnchor = '`v`.`unscheduled` AS `unscheduled`,';
    if (!svSql.includes(svAnchor)) {
      throw new Error(
        'drop_overdue_column.down: `unscheduled` anchor not found in ' +
        'tasks_with_sync_v — cannot restore `overdue` projection.'
      );
    }
    svSql = svSql.replace(svAnchor, svAnchor + '`v`.`overdue` AS `overdue`,');
  }

  if (tvNeedsRestore || svNeedsRestore) {
    await knex.raw('DROP VIEW IF EXISTS tasks_with_sync_v');
    await knex.raw('DROP VIEW IF EXISTS tasks_v');
    await knex.raw(tvSql);
    await knex.raw(svSql);
  }
};

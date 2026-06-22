'use strict';

/**
 * Expose task_instances.unplaced_reason / unplaced_detail in the tasks_v view.
 *
 * DB-single-source (David, 2026-06-22): migration 20260622010000 added the two
 * columns to the task_instances TABLE, but every app read goes through the
 * tasks_v VIEW, which enumerates columns explicitly (no `i.*`). Without exposing
 * them on the view, taskMappers.rowToTask reads `undefined` and the Unplaced view
 * never sees the persisted reason. Per juggler CLAUDE.md, a schema change that
 * alters the shape of tasks_v must recreate the view.
 *
 * Drift-proof: read the LIVE view SQL (`SHOW CREATE VIEW`) and regex-inject the
 * two columns next to `completed_at` in BOTH UNION branches — never hand-copy the
 * 170-line def (the prod-migration-lag trap). Mirrors 20260603000000
 * (add_completed_at_to_tasks_v_view), backtick-tolerant + idempotent.
 *
 * tasks_with_sync_v is intentionally NOT patched: no app read path for the
 * Unplaced/calendar views uses it (the task slice queries tasks_v directly and
 * attaches event ids in app code) — same scope as the completed_at migration.
 */

exports.up = async function up(knex) {
  const viewResult = await knex.raw('SHOW CREATE VIEW tasks_v');
  const currentViewSql = viewResult[0][0]['Create View'];

  // Idempotent: already exposed → nothing to do.
  if (/unplaced_reason/i.test(currentViewSql)) return;

  // Append the two columns at the END of each UNION branch's SELECT list, anchored
  // on that branch's FROM clause — robust to column reordering (later migrations
  // insert columns, so anchoring on a specific neighbor like completed_at is
  // fragile). MySQL normalizes the instance JOIN as `from (\`task_instances\` \`i\`
  // join \`task_masters\` \`m\` on(...))`, and the template branch as
  // `from \`task_masters\` \`m\` where (\`m\`.\`recurring\` = 1)` — the latter's
  // trailing `m where` makes it distinct from the instance JOIN's `task_masters`.

  // Instance branch — insert before `from (task_instances`.
  let sql = currentViewSql.replace(
    /(\s+from\s+\(\s*`?task_instances`?)/i,
    ',`i`.`unplaced_reason` AS `unplaced_reason`,`i`.`unplaced_detail` AS `unplaced_detail`$1'
  );

  // Template (recurring_template) branch — insert before `from task_masters m where`.
  sql = sql.replace(
    /(\s+from\s+`?task_masters`?\s+`?m`?\s+where)/i,
    ',NULL AS `unplaced_reason`,NULL AS `unplaced_detail`$1'
  );

  // Both branches MUST have injected (instance via `i.`, template via NULL).
  if (!/`i`\.`unplaced_reason`/i.test(sql) || !/NULL\s+AS\s+`unplaced_reason`/i.test(sql)) {
    throw new Error(
      '[20260622020000] failed to inject unplaced_reason into BOTH tasks_v UNION ' +
      'branches — a FROM anchor was not found in the live view SQL. Inspect ' +
      '`SHOW CREATE VIEW tasks_v` and update the regex; do NOT recreate the view unchanged.'
    );
  }

  await knex.raw('DROP VIEW IF EXISTS tasks_v');
  await knex.raw(sql);
};

exports.down = async function down(knex) {
  const viewResult = await knex.raw('SHOW CREATE VIEW tasks_v');
  const currentViewSql = viewResult[0][0]['Create View'];

  const sql = currentViewSql
    .replace(/,\s*\n?\s*`?i`?\.`?unplaced_reason`?\s+AS\s+`?unplaced_reason`?/i, '')
    .replace(/,\s*\n?\s*`?i`?\.`?unplaced_detail`?\s+AS\s+`?unplaced_detail`?/i, '')
    .replace(/,\s*\n?\s*NULL\s+AS\s+`?unplaced_reason`?/i, '')
    .replace(/,\s*\n?\s*NULL\s+AS\s+`?unplaced_detail`?/i, '');

  await knex.raw('DROP VIEW IF EXISTS tasks_v');
  await knex.raw(sql);
};

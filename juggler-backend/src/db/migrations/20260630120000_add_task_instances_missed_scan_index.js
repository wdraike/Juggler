'use strict';

/**
 * Add covering index for the markMissedTasks cron scan (999.956).
 *
 * The cal-history cron's markMissedTasks query scans task_instances WITHOUT a
 * user_id filter (it is user-agnostic — every user's past-due instances get
 * flagged overdue). The only existing scheduled_at index is the composite
 * (user_id, scheduled_at), whose LEADING column is user_id — so a user-agnostic
 * `scheduled_at < ?` range cannot use it and MySQL falls back to a full-table
 * scan that grows unbounded as instance history accumulates.
 *
 * Add idx_task_instances_missed_scan (overdue, scheduled_at): the cron filters
 * `overdue = 0` (equality — the loop already skips already-overdue rows) AND
 * `scheduled_at < <cutoff>` (range). Leading `overdue` (equality) then
 * `scheduled_at` (range) is the textbook composite-index shape for that access
 * pattern, turning the full scan into an index range scan.
 *
 * PERF-ONLY: an index changes the access PATH, never WHICH rows match — the set
 * of instances flagged overdue is byte-identical before and after (never-missing
 * invariant preserved).
 *
 * NOTE: MySQL implicitly commits on DDL, so this is NOT wrapped in a transaction;
 * it is made idempotent via an information_schema guard so it also applies cleanly
 * on a DB seeded from a prod schema snapshot that already carries the index.
 */

const INDEX_NAME = 'idx_task_instances_missed_scan';

async function indexExists(knex, table, indexName) {
  const rows = await knex.raw(
    'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1',
    [table, indexName]
  );
  return rows[0].length > 0;
}

exports.up = async function (knex) {
  if (await indexExists(knex, 'task_instances', INDEX_NAME)) {
    console.log(`${INDEX_NAME} already exists, skipping`);
    return;
  }
  await knex.raw(
    `CREATE INDEX ${INDEX_NAME} ON task_instances (overdue, scheduled_at)`
  );
  console.log(`Created ${INDEX_NAME} (overdue, scheduled_at) on task_instances`);
};

exports.down = async function (knex) {
  if (!(await indexExists(knex, 'task_instances', INDEX_NAME))) {
    console.log(`${INDEX_NAME} does not exist, skipping`);
    return;
  }
  await knex.raw(`DROP INDEX ${INDEX_NAME} ON task_instances`);
  console.log(`Dropped ${INDEX_NAME}`);
};

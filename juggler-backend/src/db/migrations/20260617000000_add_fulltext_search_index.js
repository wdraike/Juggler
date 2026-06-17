'use strict';

/**
 * Add FULLTEXT index on task_masters(text, notes) for server-side search.
 *
 * MySQL FULLTEXT indexes enable MATCH…AGAINST queries for efficient
 * text search across task descriptions and notes. The index is placed
 * on `task_masters` (the base table) because MySQL does not support
 * FULLTEXT indexes on views.
 *
 * The `tasks_v` view UNIONs task_masters (recurring templates) with
 * task_instances JOIN task_masters — in both branches, `text` and
 * `notes` come from `task_masters`. So searching `task_masters`
 * covers all tasks visible through `tasks_v`.
 *
 * Prerequisite: the table must use utf8mb4_unicode_ci collation
 * (already enforced by the 20260508000100 / 20260515000100 collation
 * migrations). If the collation drifts, FULLTEXT may fail to index
 * CJK/emoji content correctly.
 */
exports.up = async function (knex) {
  const exists = await knex.raw(
    "SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS " +
    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_masters' AND INDEX_NAME = 'ft_tasks_search'"
  );
  if (exists[0][0].cnt > 0) {
    console.log('[FULLTEXT] ft_tasks_search already exists — skipping');
    return;
  }

  await knex.raw(
    'ALTER TABLE task_masters ADD FULLTEXT INDEX ft_tasks_search (text, notes) ' +
    "COMMENT 'FULLTEXT for task description + notes search (999.253)'"
  );
  console.log('[FULLTEXT] Created ft_tasks_search on task_masters(text, notes)');
};

exports.down = async function (knex) {
  await knex.raw(
    'ALTER TABLE task_masters DROP INDEX ft_tasks_search'
  );
  console.log('[FULLTEXT] Dropped ft_tasks_search from task_masters');
};
/**
 * No-op migration — superseded by 20260527213906_add_terminal_scheduled_at_constraint.js
 *
 * Originally attempted to add a CHECK constraint on the old `tasks` table,
 * which was split into task_masters/task_instances before this migration ran.
 * The equivalent constraint was already added correctly by the earlier migration
 * (20260527213906) on task_instances. This file is kept to preserve migration history
 * and prevent knex from re-running it.
 */

exports.up = async function() {};
exports.down = async function() {};
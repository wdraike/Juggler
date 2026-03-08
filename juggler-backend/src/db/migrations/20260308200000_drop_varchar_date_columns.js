/**
 * Drop legacy varchar date/time columns — scheduled_at (UTC DATETIME) is now
 * the single source of truth. Add original_scheduled_at for scheduler reset.
 *
 * Dropped columns:
 *   date        VARCHAR(10)   — local "M/D" date string
 *   time        VARCHAR(20)   — local "H:MM AM/PM" time string
 *   day         VARCHAR(3)    — local day abbreviation
 *   due         VARCHAR(10)   — local "M/D" due date
 *   start_after VARCHAR(10)   — local "M/D" start-after date
 *   original_date  VARCHAR(10)
 *   original_time  VARCHAR(20)
 *   original_day   VARCHAR(3)
 *
 * Added columns:
 *   original_scheduled_at DATETIME — scheduler saves the user's original
 *       scheduled_at here before moving a task, so it can be reset next run.
 */

exports.up = async function(knex) {
  await knex.schema.alterTable('tasks', function(table) {
    table.datetime('original_scheduled_at').nullable().after('scheduled_at');
  });

  // Copy original_date+original_time → original_scheduled_at for any
  // currently scheduler-moved tasks (so the next reset still works).
  // We do this BEFORE dropping the columns.
  var path = require('path');
  var dateHelpers = require(path.resolve(__dirname, '..', '..', '..', '..', 'shared', 'scheduler', 'dateHelpers'));

  var users = await knex('users').select('id', 'timezone');
  var tzMap = {};
  users.forEach(function(u) { tzMap[u.id] = u.timezone || 'America/New_York'; });

  var moved = await knex('tasks')
    .whereNotNull('original_date')
    .select('id', 'user_id', 'original_date', 'original_time');

  for (var i = 0; i < moved.length; i++) {
    var t = moved[i];
    var tz = tzMap[t.user_id] || 'America/New_York';
    var utc = dateHelpers.localToUtc(t.original_date, t.original_time || '12:00 AM', tz);
    if (utc) {
      await knex('tasks').where('id', t.id).update({ original_scheduled_at: utc });
    }
  }

  // Now drop the old columns
  await knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('date');
    table.dropColumn('time');
    table.dropColumn('day');
    table.dropColumn('due');
    table.dropColumn('start_after');
    table.dropColumn('original_date');
    table.dropColumn('original_time');
    table.dropColumn('original_day');
  });
};

exports.down = async function(knex) {
  // Re-add the varchar columns (data will be lost)
  await knex.schema.alterTable('tasks', function(table) {
    table.varchar('date', 10).nullable();
    table.varchar('time', 20).nullable();
    table.varchar('day', 3).nullable();
    table.varchar('due', 10).nullable();
    table.varchar('start_after', 10).nullable();
    table.varchar('original_date', 10).nullable();
    table.varchar('original_time', 20).nullable();
    table.varchar('original_day', 3).nullable();
  });

  await knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('original_scheduled_at');
  });
};

/**
 * Add scheduled_at DATETIME (UTC) column to tasks.
 * This is the source of truth for task date+time — stored as UTC.
 * The varchar date/time/day columns become derived caches.
 *
 * Also add due_at DATE and start_after_at DATE columns.
 */

var path = require('path');
var dateHelpers = require(path.resolve(__dirname, '..', '..', '..', '..', 'shared', 'scheduler', 'dateHelpers'));

exports.up = async function(knex) {
  // 1. Add new columns
  await knex.schema.alterTable('tasks', function(table) {
    table.datetime('scheduled_at').nullable().after('time');
    table.date('due_at').nullable().after('due');
    table.date('start_after_at').nullable().after('start_after');
  });

  // 2. Migrate existing date+time → scheduled_at (UTC)
  // Load all users to get their timezones
  var users = await knex('users').select('id', 'timezone');
  var tzMap = {};
  users.forEach(function(u) { tzMap[u.id] = u.timezone || 'America/New_York'; });

  // Process in batches
  var tasks = await knex('tasks')
    .whereNotNull('date')
    .where('date', '!=', '')
    .select('id', 'user_id', 'date', 'time', 'due', 'start_after');

  var batchSize = 100;
  for (var i = 0; i < tasks.length; i += batchSize) {
    var batch = tasks.slice(i, i + batchSize);
    for (var j = 0; j < batch.length; j++) {
      var t = batch[j];
      var tz = tzMap[t.user_id] || 'America/New_York';
      var update = {};

      // Convert date+time to scheduled_at
      if (t.date && t.time) {
        var utc = dateHelpers.localToUtc(t.date, t.time, tz);
        if (utc) update.scheduled_at = utc;
      } else if (t.date) {
        // Date-only: store as midnight local → UTC
        var utcMidnight = dateHelpers.localToUtc(t.date, '12:00 AM', tz);
        if (utcMidnight) update.scheduled_at = utcMidnight;
      }

      // Convert due to due_at
      if (t.due) {
        var dueISO = dateHelpers.toDateISO(t.due);
        if (dueISO) update.due_at = dueISO;
      }

      // Convert start_after to start_after_at
      if (t.start_after) {
        var saISO = dateHelpers.toDateISO(t.start_after);
        if (saISO) update.start_after_at = saISO;
      }

      if (Object.keys(update).length > 0) {
        await knex('tasks').where('id', t.id).update(update);
      }
    }
  }
};

exports.down = async function(knex) {
  await knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('scheduled_at');
    table.dropColumn('due_at');
    table.dropColumn('start_after_at');
  });
};

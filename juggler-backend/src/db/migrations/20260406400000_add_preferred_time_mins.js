/**
 * Add preferred_time_mins column to store the user's preferred time for
 * recurring tasks in Time Window mode as minutes since midnight (local tz).
 *
 * This replaces the overloaded use of template scheduled_at as a time anchor.
 * 720 = 12:00 PM, 420 = 7:00 AM, etc. No timezone conversion needed.
 *
 * Backfills from template scheduled_at using each user's timezone.
 */
exports.up = async function(knex) {
  // 1. Add the column
  await knex.schema.alterTable('tasks', function(table) {
    table.integer('preferred_time_mins').nullable()
      .comment('Preferred time as minutes from midnight (local tz). For recurring templates in Time Window mode.');
  });

  // 2. Backfill from template scheduled_at for Time Window mode templates
  var templates = await knex('tasks')
    .where('task_type', 'recurring_template')
    .where('preferred_time', 1)
    .whereNotNull('scheduled_at')
    .select('id', 'user_id', 'scheduled_at');

  if (templates.length === 0) return;

  // Get user timezones
  var userIds = [...new Set(templates.map(function(t) { return t.user_id; }))];
  var users = await knex('users').whereIn('id', userIds).select('id', 'timezone');
  var tzMap = {};
  users.forEach(function(u) { tzMap[u.id] = u.timezone || 'America/New_York'; });

  // Convert each template's scheduled_at to local minutes
  for (var i = 0; i < templates.length; i++) {
    var t = templates[i];
    var tz = tzMap[t.user_id] || 'America/New_York';
    // MySQL returns datetime as string without 'Z' — must append to parse as UTC
    var raw = String(t.scheduled_at);
    var utcDate = new Date(raw.indexOf('Z') >= 0 || raw.indexOf('T') >= 0 ? raw : raw.replace(' ', 'T') + 'Z');

    // Use Intl to get local hour/minute in the user's timezone
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
    }).formatToParts(utcDate);

    var vals = {};
    parts.forEach(function(p) { vals[p.type] = parseInt(p.value, 10); });
    var mins = (vals.hour % 24) * 60 + vals.minute;

    await knex('tasks').where('id', t.id).update({ preferred_time_mins: mins });
  }

  if (templates.length > 0) {
    console.log('[MIGRATION] backfilled preferred_time_mins on ' + templates.length + ' templates');
  }
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('preferred_time_mins');
  });
};

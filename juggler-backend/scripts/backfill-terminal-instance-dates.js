// One-shot cleanup: populate task_instances.date for terminal-status rows
// (done/skip/cancel) that have a scheduled_at but a NULL date. Those rows
// were bypassing the scheduler's terminal-dedup query — a skipped instance
// would reappear on the next expansion because its date wasn't recognized
// as already filled.
//
// Derives the local date from scheduled_at in the user's timezone, matching
// rowToTask's behavior on the read path.
var db = require('../src/db');
var utcToLocal = require('../src/scheduler/dateHelpers').utcToLocal;

(async function() {
  var users = await db('users').select('id', 'timezone');
  var tzByUser = {};
  users.forEach(function(u) { tzByUser[u.id] = u.timezone || 'America/New_York'; });

  var rows = await db('task_instances')
    .whereIn('status', ['done', 'skip', 'cancel'])
    .whereNull('date')
    .whereNotNull('scheduled_at')
    .select('id', 'user_id', 'scheduled_at');

  console.log('Rows with NULL date + scheduled_at:', rows.length);

  var updated = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var tz = tzByUser[r.user_id] || 'America/New_York';
    var local = utcToLocal(r.scheduled_at, tz);
    if (!local || !local.date) continue;
    await db('task_instances').where('id', r.id).update({
      date: local.date,
      day: local.day || null,
      time: local.time || null
    });
    updated++;
  }
  console.log('Backfilled:', updated);

  var remaining = await db('task_instances')
    .whereIn('status', ['done', 'skip', 'cancel'])
    .whereNull('date')
    .count('id as cnt').first();
  console.log('Remaining NULL-date terminal rows:', remaining.cnt);

  await db.destroy();
})().catch(function(e) { console.error(e); process.exit(1); });

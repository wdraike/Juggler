// Delete orphaned PENDING task_instances rows (master_id IS NULL AND status = '').
// Preserves completed history (status in {done, skip, cancel}) — that's the
// whole reason the FK is ON DELETE SET NULL. Pending rows with a NULL master
// are dangling state: the template they belonged to is gone, and they'll
// never be reconciled by the scheduler.
var db = require('../src/db');

(async function() {
  var orphans = await db('task_instances')
    .whereNull('master_id')
    .where('status', '')
    .select('id', 'scheduled_at', 'occurrence_ordinal', 'created_at');

  console.log('Found ' + orphans.length + ' orphaned pending instance(s):');
  orphans.forEach(function(r) {
    console.log('  ' + r.id + '  sa=' + r.scheduled_at + '  ord=' + r.occurrence_ordinal + '  created=' + r.created_at);
  });

  if (orphans.length === 0) {
    console.log('Nothing to clean up.');
    await db.destroy();
    return;
  }

  var ids = orphans.map(function(r) { return r.id; });
  var deleted = await db('task_instances').whereIn('id', ids).del();
  console.log('Deleted ' + deleted + ' rows.');

  // Sanity check: any remaining NULL-master rows should now all be terminal.
  var remaining = await db('task_instances')
    .whereNull('master_id')
    .select('status')
    .count('id as cnt')
    .groupBy('status');
  console.log('Remaining NULL-master rows by status:');
  remaining.forEach(function(r) { console.log('  status=' + JSON.stringify(r.status) + ' count=' + r.cnt); });

  await db.destroy();
})().catch(function(e) { console.error(e); process.exit(1); });

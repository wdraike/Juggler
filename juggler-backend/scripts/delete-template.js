var db = require('../src/db');
(async function() {
  var id = process.argv[2];
  if (!id) { console.error('Usage: node scripts/delete-template.js <masterId>'); process.exit(2); }
  var master = await db('task_masters').where('id', id).first();
  if (!master) { console.log('No master found for id ' + id); process.exit(0); }
  console.log('Found master: ' + JSON.stringify(master.text) + ' (user=' + master.user_id + ')');
  var instCount = await db('task_instances').where('master_id', id).count('id as c').first();
  console.log('Instance rows to remove: ' + instCount.c);
  // Also clean any cal-sync ledger entries pointing at this master or its instances
  var ledger = await db('cal_sync_ledger').where('task_id', id).count('id as c').first();
  var ledgerInsts = await db('cal_sync_ledger').whereIn('task_id', function() {
    this.select('id').from('task_instances').where('master_id', id);
  }).count('id as c').first();
  console.log('Ledger rows to mark deleted: ' + (ledger.c + ledgerInsts.c));

  await db.transaction(async function(trx) {
    await trx('cal_sync_ledger').where('task_id', id).update({ status: 'deleted' });
    await trx('cal_sync_ledger').whereIn('task_id', function() {
      this.select('id').from('task_instances').where('master_id', id);
    }).update({ status: 'deleted' });
    await trx('task_instances').where('master_id', id).del();
    await trx('task_masters').where('id', id).del();
  });
  console.log('Deleted template ' + id + ' and all its instances.');
  process.exit(0);
})().catch(function(e) { console.error(e); process.exit(1); });

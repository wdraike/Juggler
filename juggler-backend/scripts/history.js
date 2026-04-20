var db = require('../src/db');
(async function() {
  var mid = process.argv[2];
  // All rows ever (including terminal) by master_id
  var byMaster = await db('task_instances').where('master_id', mid).count('id as c').first();
  console.log('by master_id: ' + byMaster.c);
  // All rows ever by id prefix
  var byPrefix = await db('task_instances').whereRaw("id LIKE ?", [mid + '%']).count('id as c').first();
  console.log('by id prefix ' + mid + '%: ' + byPrefix.c);
  var rows = await db('task_instances').whereRaw("id LIKE ?", [mid + '%']).select('id','occurrence_ordinal','date','status','created_at','updated_at');
  rows.forEach(function(r) { console.log('  ' + r.id + ' ord=' + r.occurrence_ordinal + ' date=' + r.date + ' status=' + JSON.stringify(r.status) + ' created=' + r.created_at); });
  process.exit(0);
})().catch(function(e) { console.error(e); process.exit(1); });

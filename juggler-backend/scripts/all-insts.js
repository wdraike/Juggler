var db = require('../src/db');
(async function() {
  var mid = process.argv[2];
  var insts = await db('task_instances').where('master_id', mid).select('id','occurrence_ordinal','date','time','scheduled_at','status','unscheduled','generated');
  console.log('ALL instances for ' + mid + ': ' + insts.length);
  insts.sort(function(a, b) { return (a.occurrence_ordinal || 0) - (b.occurrence_ordinal || 0); });
  insts.forEach(function(i) {
    console.log('  ord=' + i.occurrence_ordinal + ' id=' + i.id + ' date=' + i.date + ' time=' + i.time + ' status=' + JSON.stringify(i.status) + ' unscheduled=' + i.unscheduled);
  });
  process.exit(0);
})().catch(function(e) { console.error(e); process.exit(1); });

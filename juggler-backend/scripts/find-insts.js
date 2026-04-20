var db = require('../src/db');
(async function() {
  var masterId = process.argv[2];
  var insts = await db('task_instances')
    .where('master_id', masterId)
    .select();
  console.log('instances for master ' + masterId + ': ' + insts.length);
  insts.forEach(function(i) { console.log(JSON.stringify(i)); });
  // Also check legacy tasks table if it exists
  try {
    var legacy = await db('tasks').whereRaw("id LIKE ?", [masterId + '%']).select();
    console.log('legacy tasks matching ' + masterId + '%: ' + legacy.length);
    legacy.slice(0, 5).forEach(function(i) { console.log(JSON.stringify({ id: i.id, text: i.text, date: i.date, status: i.status })); });
  } catch (e) { console.log('(no legacy tasks table)'); }
  process.exit(0);
})().catch(function(e) { console.error(e); process.exit(1); });

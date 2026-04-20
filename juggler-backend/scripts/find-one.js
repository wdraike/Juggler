var db = require('../src/db');
(async function() {
  var id = process.argv[2];
  var m = await db('task_masters').where('id', id).first();
  console.log('── master ──');
  console.log(JSON.stringify(m, null, 2));
  process.exit(0);
})().catch(function(e) { console.error(e); process.exit(1); });

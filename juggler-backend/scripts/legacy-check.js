var db = require('../src/db');
(async function() {
  // For every recurring template owned by this user, count its instances.
  var userId = '019d29f9-9ef9-74eb-af2d-0418237d0bd9';
  var tpls = await db('task_masters').where({ user_id: userId, recurring: 1 }).select('id', 'text');
  for (var i = 0; i < tpls.length; i++) {
    var t = tpls[i];
    var cnt = await db('task_instances').where({ master_id: t.id, user_id: userId }).count('id as c').first();
    var openCnt = await db('task_instances').where({ master_id: t.id, user_id: userId }).where(function() { this.where('status', '').orWhereNull('status'); }).count('id as c').first();
    console.log(t.id + '  ' + (t.id.startsWith('t1') ? '(legacy)' : '(uuidv7)') +
                '  inst=' + cnt.c + '  open=' + openCnt.c + '  text=' + JSON.stringify(t.text));
  }
  process.exit(0);
})().catch(function(e) { console.error(e); process.exit(1); });

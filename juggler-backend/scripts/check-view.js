var db = require('../src/db');
(async function() {
  // Query the view directly for the template
  var rows = await db('tasks_v').where('id', 't1776265177779m8i0').select();
  console.log('tasks_v rows for t1776265177779m8i0: ' + rows.length);
  rows.forEach(function(r) { console.log(JSON.stringify(r, null, 2)); });

  // Also peek at what templates are in tasks_v for this user
  var tpls = await db('tasks_v').where({ user_id: '019d29f9-9ef9-74eb-af2d-0418237d0bd9', task_type: 'recurring_template' }).select('id', 'text', 'recurring');
  console.log('\nTotal recurring_template rows in tasks_v for user: ' + tpls.length);
  process.exit(0);
})().catch(function(e) { console.error(e); process.exit(1); });

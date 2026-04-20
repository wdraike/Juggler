var db = require('../src/db');
async function run() {
  var name = process.argv[2] || 'submit';
  var masters = await db('task_masters')
    .whereRaw('LOWER(text) LIKE ?', ['%' + name.toLowerCase() + '%'])
    .select();
  console.log('Matches in task_masters: ' + masters.length);
  for (var i = 0; i < masters.length; i++) {
    var m = masters[i];
    console.log('\n── Master ──');
    console.log('  id:                 ' + m.id);
    console.log('  user_id:            ' + m.user_id);
    console.log('  text:               ' + JSON.stringify(m.text));
    console.log('  task_type (derived): ' + (m.recurring ? 'recurring_template' : 'one-off master'));
    console.log('  recurring:          ' + m.recurring);
    console.log('  status:             ' + JSON.stringify(m.status));
    console.log('  deadline:           ' + m.deadline);
    console.log('  start_after_at:     ' + m.start_after_at);
    console.log('  when:               ' + JSON.stringify(m.when));
    console.log('  pri:                ' + m.pri);
    console.log('  disabled_at:        ' + m.disabled_at);
    console.log('  updated_at:         ' + (m.updated_at ? new Date(m.updated_at).toISOString() : 'null'));
    var insts = await db('task_instances').where('master_id', m.id).where('user_id', m.user_id).select();
    console.log('  instances: ' + insts.length);
    insts.slice(0, 10).forEach(function(x) {
      console.log('    id=' + x.id + '  date=' + x.date + '  time=' + x.time +
                  '  scheduled_at=' + (x.scheduled_at ? new Date(x.scheduled_at).toISOString() : 'null') +
                  '  status=' + JSON.stringify(x.status) +
                  '  unscheduled=' + x.unscheduled +
                  '  date_pinned=' + x.date_pinned +
                  '  split_total=' + x.split_total);
    });
  }
  process.exit(0);
}
run().catch(function(e) { console.error(e); process.exit(1); });

const fs = require('fs');
const db = require('./src/db');
const state = JSON.parse(fs.readFileSync('../state.json', 'utf8'));
const origTasks = state.extraTasks || [];

// Build map of original habit data by id
var origById = {};
origTasks.filter(function(t) { return t.habit; }).forEach(function(t) { origById[t.id] = t; });

db('tasks').where('habit', 1).select('id','text','date','time','when').then(async function(rows) {
  var fixes = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var orig = origById[r.id];
    if (!orig) continue;
    var timeChanged = orig.time && r.time !== orig.time;
    var whenChanged = orig.when && r.when !== orig.when;
    if (timeChanged || whenChanged) {
      var upd = { updated_at: db.fn.now() };
      if (timeChanged) {
        // Skip non-parseable time strings that are too long for the column
        if (orig.time.length > 20) { console.log('SKIP ' + r.id + ' bad time: ' + orig.time); continue; }
        upd.time = orig.time;
      }
      if (whenChanged) upd.when = orig.when;
      try {
        await db('tasks').where('id', r.id).update(upd);
      } catch(e) { console.log('ERR ' + r.id + ': ' + e.message); continue; }
      console.log('FIX ' + r.id + ' (' + r.text + ' ' + r.date + '): ' +
        (timeChanged ? 'time ' + r.time + ' -> ' + orig.time + ' ' : '') +
        (whenChanged ? 'when ' + r.when + ' -> ' + orig.when : ''));
      fixes++;
    }
  }
  console.log('\nTotal fixes:', fixes);
  process.exit();
}).catch(function(e) { console.error(e.message); process.exit(1); });

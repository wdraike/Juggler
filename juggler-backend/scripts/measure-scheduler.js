// Run the scheduler N times against a real user and capture per-phase timing.
// Output: median of runs 2..N (first run skipped to avoid cold-cache noise).
// Usage: node scripts/measure-scheduler.js <userId> [runs]
var db = require('../src/db');
var { runScheduleAndPersist } = require('../src/scheduler/runSchedule');

(async function() {
  var userId = process.argv[2];
  var runs = parseInt(process.argv[3] || '6', 10);
  if (!userId) { console.error('Usage: node scripts/measure-scheduler.js <userId> [runs]'); process.exit(2); }

  var samples = [];
  // Capture the timing line by overriding console.log briefly.
  var orig = console.log;
  for (var i = 0; i < runs; i++) {
    var captured = null;
    console.log = function() {
      var msg = Array.prototype.slice.call(arguments).join(' ');
      if (msg.indexOf('[SCHED] perf') === 0) captured = msg;
      orig.apply(console, arguments);
    };
    try {
      await runScheduleAndPersist(userId);
    } catch (e) {
      orig.call(console, 'run ' + i + ' failed:', e.message);
    }
    console.log = orig;
    if (captured) samples.push(parseLine(captured));
    orig.call(console, 'run ' + (i + 1) + '/' + runs + ' done');
  }

  var warm = samples.slice(1); // drop first run
  if (warm.length === 0) {
    orig.call(console, 'no successful runs');
    await db.destroy();
    return;
  }
  function median(arr, key) {
    var s = arr.map(function(x) { return x[key]; }).sort(function(a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
  }
  orig.call(console, '\n=== Median over ' + warm.length + ' warm runs ===');
  ['load','expand','reconcile','schedule','persist','total'].forEach(function(k) {
    orig.call(console, k.padEnd(10) + ' ' + median(warm, k) + 'ms');
  });
  orig.call(console, 'tasks=' + warm[0].tasks);
  await db.destroy();
})().catch(function(e) { console.error(e); process.exit(1); });

function parseLine(line) {
  var out = {};
  (line.match(/(load|expand|reconcile|schedule|persist|total)=(\d+)ms/g) || [])
    .forEach(function(m) { var [k, v] = m.replace('ms', '').split('='); out[k] = parseInt(v, 10); });
  var t = line.match(/tasks=(\d+)/); if (t) out.tasks = parseInt(t[1], 10);
  return out;
}

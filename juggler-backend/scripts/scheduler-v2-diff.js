/**
 * scheduler-v2-diff — run v1 and v2 against the same real-user task set
 * and print where they diverge. Surfaces the gaps that matter on actual
 * data, so step 4.5 can be surgical rather than speculative.
 *
 * Usage:
 *   node scripts/scheduler-v2-diff.js                   # runs for first user
 *   node scripts/scheduler-v2-diff.js <user-id>         # runs for specific user
 *   node scripts/scheduler-v2-diff.js <user-id> verbose # also prints per-task diff
 */
var db = require('../src/db');
var taskController = require('../src/controllers/task.controller');
var rowToTask = taskController.rowToTask;
var buildSourceMap = taskController.buildSourceMap || function(rows) {
  var m = {};
  rows.forEach(function(r) {
    if (r.task_type === 'recurring_template' && r.id) m[r.id] = r;
  });
  return m;
};
var unifiedSchedule = require('../src/scheduler/unifiedSchedule');
var unifiedScheduleV2 = require('../src/scheduler/unifiedScheduleV2');
var scheduleDiff = require('../src/scheduler/scheduleDiff');
var constants = require('../src/scheduler/constants');
var dateHelpers = require('../src/scheduler/dateHelpers');

async function loadCfg(userId) {
  var rows = await db('user_config').where('user_id', userId).select();
  var config = {};
  rows.forEach(function(row) {
    var val = typeof row.config_value === 'string'
      ? JSON.parse(row.config_value) : row.config_value;
    config[row.config_key] = val;
  });
  var user = await db('users').where('id', userId).first();
  return {
    timezone: (user && user.timezone) || 'America/New_York',
    timeBlocks: config.time_blocks || constants.DEFAULT_TIME_BLOCKS,
    toolMatrix: config.tool_matrix || constants.DEFAULT_TOOL_MATRIX,
    locSchedules: config.loc_schedules || {},
    locScheduleDefaults: config.loc_schedule_defaults || {},
    locScheduleOverrides: config.loc_schedule_overrides || {},
    hourLocationOverrides: config.hour_location_overrides || {},
    preferences: config.preferences || {},
    splitDefault: config.preferences ? config.preferences.splitDefault : undefined,
    splitMinDefault: config.preferences ? config.preferences.splitMinDefault : undefined
  };
}

function flattenPlacements(dayPlacements) {
  var out = {};
  Object.keys(dayPlacements || {}).forEach(function(dk) {
    (dayPlacements[dk] || []).forEach(function(p) {
      var id = p && p.task && p.task.id;
      if (!id) return;
      var existing = out[id];
      if (!existing || (p.start != null && p.start < existing.start)) {
        out[id] = { dateKey: dk, start: p.start, dur: p.dur };
      }
    });
  });
  return out;
}

function pickUnplaced(result) {
  var s = {};
  (result.unplaced || []).forEach(function(t) {
    if (t && t.id) s[t.id] = true;
  });
  return s;
}

function fmtTime(mins) {
  if (mins == null) return '-';
  var h = Math.floor(mins / 60), m = mins % 60;
  return h + ':' + (m < 10 ? '0' : '') + m;
}

function taskBrief(t) {
  if (!t) return '(unknown)';
  var bits = [];
  if (t.taskType && t.taskType !== 'task') bits.push(t.taskType);
  if (t.recurring) bits.push('recurring');
  if (t.rigid) bits.push('rigid');
  if (t.marker) bits.push('marker');
  if (t.datePinned) bits.push('pinned');
  if (t.split) bits.push('split=' + (t.splitMin || '?'));
  if (t.when) bits.push('when=' + t.when);
  if (t.deadline) bits.push('deadline=' + t.deadline);
  if (t.dependsOn && t.dependsOn.length) bits.push('deps=' + t.dependsOn.length);
  if (t.location && t.location.length) bits.push('loc=' + t.location.join(','));
  if (t.tools && t.tools.length) bits.push('tools=' + t.tools.join(','));
  bits.push('dur=' + (t.dur || 30));
  bits.push('pri=' + (t.pri || 'P3'));
  return bits.join(' ');
}

async function run() {
  var userId = process.argv[2];
  var verbose = process.argv[3] === 'verbose' || process.argv[2] === 'verbose';
  if (userId === 'verbose') userId = null;

  if (!userId) {
    var firstUser = await db('users').select('id', 'email').first();
    if (!firstUser) { console.log('No users found.'); process.exit(0); }
    userId = firstUser.id;
    console.log('No user id passed; defaulting to ' + firstUser.email + ' (' + userId + ')');
  }

  var cfg = await loadCfg(userId);
  console.log('Timezone:', cfg.timezone);

  var taskRows = await db('tasks_v').where('user_id', userId).select();
  console.log('Tasks loaded from tasks_v:', taskRows.length);

  var srcMap = buildSourceMap(taskRows);
  var allTasks = taskRows.map(function(r) { return rowToTask(r, cfg.timezone, srcMap); });

  var statuses = {};
  allTasks.forEach(function(t) { statuses[t.id] = t.status || ''; });

  // Today + nowMins in user timezone.
  var nowDate = new Date();
  var parts = new Intl.DateTimeFormat('en-US', {
    timeZone: cfg.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(nowDate);
  var vals = {};
  parts.forEach(function(p) { vals[p.type] = p.value; });
  var todayKey = vals.year + '-' + vals.month + '-' + vals.day;
  var nowMins = parseInt(vals.hour, 10) * 60 + parseInt(vals.minute, 10);

  console.log('Today:', todayKey, 'nowMins:', nowMins);
  console.log('');

  // Run both.
  var t1Start = Date.now();
  var r1;
  try { r1 = unifiedSchedule(allTasks, statuses, todayKey, nowMins, cfg); }
  catch (e) { console.error('v1 error:', e.message); process.exit(1); }
  var t1Ms = Date.now() - t1Start;

  var t2Start = Date.now();
  var r2;
  try { r2 = unifiedScheduleV2(allTasks, statuses, todayKey, nowMins, cfg); }
  catch (e) { console.error('v2 error:', e.message); console.error(e.stack); process.exit(1); }
  var t2Ms = Date.now() - t2Start;

  console.log('v1: ' + t1Ms + 'ms, placed=' + (r1.placedCount || 0) + ' unplaced=' + (r1.unplaced || []).length);
  console.log('v2: ' + t2Ms + 'ms, placed=' + (r2.placedCount || 0) + ' unplaced=' + (r2.unplaced || []).length);

  var p1 = flattenPlacements(r1.dayPlacements);
  var p2 = flattenPlacements(r2.dayPlacements);
  var u1 = pickUnplaced(r1);
  var u2 = pickUnplaced(r2);

  var taskById = {};
  allTasks.forEach(function(t) { taskById[t.id] = t; });

  var allIds = {};
  Object.keys(p1).forEach(function(id) { allIds[id] = true; });
  Object.keys(p2).forEach(function(id) { allIds[id] = true; });
  Object.keys(u1).forEach(function(id) { allIds[id] = true; });
  Object.keys(u2).forEach(function(id) { allIds[id] = true; });

  var counts = { match: 0, moved: 0, onlyV1: 0, onlyV2: 0, bothUnplaced: 0 };
  var buckets = { moved: [], onlyV1: [], onlyV2: [] };

  Object.keys(allIds).forEach(function(id) {
    var a = p1[id], b = p2[id];
    var ua = !!u1[id], ub = !!u2[id];
    if (!a && !b && ua && ub) { counts.bothUnplaced++; return; }
    if (a && b) {
      if (a.dateKey === b.dateKey && Math.abs((a.start || 0) - (b.start || 0)) <= 1) {
        counts.match++;
      } else {
        counts.moved++;
        buckets.moved.push({ id: id, v1: a, v2: b });
      }
      return;
    }
    if (a && !b) { counts.onlyV1++; buckets.onlyV1.push({ id: id, v1: a, v2Unplaced: ub }); return; }
    if (b && !a) { counts.onlyV2++; buckets.onlyV2.push({ id: id, v2: b, v1Unplaced: ua }); return; }
  });

  console.log('');
  console.log('=== DIFF SUMMARY ===');
  console.log('  match         :', counts.match);
  console.log('  moved         :', counts.moved);
  console.log('  onlyV1 (v2 missed)  :', counts.onlyV1);
  console.log('  onlyV2 (v2 over-placed) :', counts.onlyV2);
  console.log('  bothUnplaced  :', counts.bothUnplaced);

  // Validate v2's output for the "no overlapping placements per day" invariant.
  var overlaps = scheduleDiff.findOverlaps(r2);
  console.log('');
  console.log('=== V2 INTERNAL OVERLAPS ===');
  console.log('  count:', overlaps.length);
  overlaps.slice(0, 15).forEach(function(o) {
    var aT = taskById[o.a.id], bT = taskById[o.b.id];
    console.log('  [' + o.dateKey + '] ' +
      o.a.id + '@' + fmtTime(o.a.start) + '+' + o.a.dur + 'm vs ' +
      o.b.id + '@' + fmtTime(o.b.start) + '+' + o.b.dur + 'm');
    if (aT) console.log('    A: ' + (aT.text || '').substring(0, 50));
    if (bT) console.log('    B: ' + (bT.text || '').substring(0, 50));
  });
  if (overlaps.length > 15) console.log('  ... ' + (overlaps.length - 15) + ' more');

  // Per-bucket breakdowns, capped unless verbose.
  function sampleBucket(label, rows, cap, formatRow) {
    if (rows.length === 0) return;
    console.log('');
    console.log('=== ' + label + ' (' + rows.length + ') ===');
    var max = verbose ? rows.length : Math.min(cap, rows.length);
    for (var i = 0; i < max; i++) formatRow(rows[i]);
    if (!verbose && rows.length > cap) {
      console.log('  ... ' + (rows.length - cap) + ' more (pass "verbose" as 3rd arg to see all)');
    }
  }

  sampleBucket('ONLY V1 (v2 failed to place)', buckets.onlyV1, 15, function(d) {
    var t = taskById[d.id];
    console.log('  [' + d.id + '] v1=' + d.v1.dateKey + '@' + fmtTime(d.v1.start) + ' dur=' + d.v1.dur);
    console.log('    ' + taskBrief(t) + ' | ' + (t && t.text ? t.text.substring(0, 60) : ''));
  });

  sampleBucket('ONLY V2 (v2 placed, v1 did not)', buckets.onlyV2, 15, function(d) {
    var t = taskById[d.id];
    console.log('  [' + d.id + '] v2=' + d.v2.dateKey + '@' + fmtTime(d.v2.start) + ' dur=' + d.v2.dur);
    console.log('    ' + taskBrief(t) + ' | ' + (t && t.text ? t.text.substring(0, 60) : ''));
  });

  sampleBucket('MOVED (both placed, different slot)', buckets.moved, 15, function(d) {
    var t = taskById[d.id];
    var gap = '';
    if (d.v1.dateKey === d.v2.dateKey) {
      gap = ' (same day, Δ=' + Math.abs((d.v1.start || 0) - (d.v2.start || 0)) + 'm)';
    } else {
      gap = ' (different day)';
    }
    console.log('  [' + d.id + '] v1=' + d.v1.dateKey + '@' + fmtTime(d.v1.start) +
      ' vs v2=' + d.v2.dateKey + '@' + fmtTime(d.v2.start) + gap);
    console.log('    ' + taskBrief(t) + ' | ' + (t && t.text ? t.text.substring(0, 60) : ''));
  });

  console.log('');
  console.log('Done. Re-run with "verbose" as last arg to see every diff.');
  await db.destroy();
}

run().catch(function(e) { console.error(e); process.exit(1); });

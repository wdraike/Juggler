// Run expandRecurring against the real DB for one user and see what it
// would produce — without persisting anything.
var db = require('../src/db');
var rowToTask = require('../src/controllers/task.controller').rowToTask;
var buildSourceMap = require('../src/controllers/task.controller').buildSourceMap;
var expandRecurring = require('../../shared/scheduler/expandRecurring').expandRecurring;
var dateHelpers = require('../../shared/scheduler/dateHelpers');
var RECUR_EXPAND_DAYS = require('../src/scheduler/constants').RECUR_EXPAND_DAYS;

(async function() {
  var userId = process.argv[2];
  if (!userId) { console.error('Usage: node scripts/trace-expand.js <userId>'); process.exit(2); }
  var taskRows = await db('tasks_v').where('user_id', userId)
    .where(function() {
      this.where('status', '').orWhere('status', 'wip').orWhereNull('status')
        .orWhere('task_type', 'recurring_template');
    })
    .select();
  console.log('Loaded ' + taskRows.length + ' rows from tasks_v');
  var srcMap = buildSourceMap(taskRows);
  var allTasks = taskRows.map(function(r) { return rowToTask(r, 'America/New_York', srcMap); });
  var statuses = {};
  allTasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var end = new Date(today); end.setDate(end.getDate() + RECUR_EXPAND_DAYS);
  console.log('Expanding from ' + dateHelpers.formatDateKey(today) + ' to ' + dateHelpers.formatDateKey(end));
  var sources = allTasks.filter(function(t) {
    if (!t.recur || t.recur.type === 'none') return false;
    if (t.taskType === 'recurring_instance') return false;
    var st = statuses[t.id] || t.status || '';
    if (st === 'pause' || st === 'disabled') return false;
    return true;
  });
  console.log('Recurring sources: ' + sources.length);
  sources.forEach(function(s) {
    console.log('  - ' + JSON.stringify(s.text) + ' (id=' + s.id + ')  recur=' + JSON.stringify(s.recur));
  });
  // DEBUG: inspect the template that's supposed to match
  var target = allTasks.filter(function(t) { return t.id === 't1776265177779m8i0'; });
  console.log('\nDEBUG target row count: ' + target.length);
  target.forEach(function(t) {
    console.log('  text: ' + t.text);
    console.log('  taskType: ' + t.taskType);
    console.log('  recurring: ' + t.recurring);
    console.log('  status: ' + JSON.stringify(t.status));
    console.log('  recur: ' + JSON.stringify(t.recur));
    console.log('  typeof recur: ' + typeof t.recur);
  });
  // Also count by taskType
  var byType = {};
  allTasks.forEach(function(t) { byType[t.taskType] = (byType[t.taskType] || 0) + 1; });
  console.log('\nTasks by type: ' + JSON.stringify(byType));
  var result = expandRecurring(allTasks, today, end, { statuses: statuses });
  console.log('\nexpandRecurring produced ' + result.length + ' occurrences');
  var filtered = result.filter(function(r) { return r.sourceId === 't1776265177779m8i0'; });
  console.log('For "Submit Weekly UI Claim" (t1776265177779m8i0): ' + filtered.length);
  filtered.forEach(function(r) {
    console.log('  - id=' + r.id + '  date=' + r.date + '  _candidateDate=' + r._candidateDate);
  });
  process.exit(0);
})().catch(function(e) { console.error(e); process.exit(1); });

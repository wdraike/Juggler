// Focused trace for the re-added SWUC template.
var db = require('../src/db');
var rowToTask = require('../src/controllers/task.controller').rowToTask;
var buildSourceMap = require('../src/controllers/task.controller').buildSourceMap;
var expandRecurring = require('../../shared/scheduler/expandRecurring').expandRecurring;
var dateHelpers = require('../../shared/scheduler/dateHelpers');
var RECUR_EXPAND_DAYS = require('../src/scheduler/constants').RECUR_EXPAND_DAYS;

var TEMPLATE_ID = 't1776649350872m2xp';

(async function() {
  var userId = '019d29f9-9ef9-74eb-af2d-0418237d0bd9';
  var taskRows = await db('tasks_v').where('user_id', userId)
    .where(function() {
      this.where('status', '').orWhere('status', 'wip').orWhereNull('status')
        .orWhere('task_type', 'recurring_template');
    })
    .select();
  console.log('Loaded ' + taskRows.length + ' rows');
  var srcMap = buildSourceMap(taskRows);
  var allTasks = taskRows.map(function(r) { return rowToTask(r, 'America/New_York', srcMap); });
  var statuses = {};
  allTasks.forEach(function(t) { statuses[t.id] = t.status || ''; });

  // Dump the template as-seen by scheduler
  var tmpl = allTasks.find(function(t) { return t.id === TEMPLATE_ID; });
  console.log('\n=== Template view ===');
  if (!tmpl) {
    console.log('NOT FOUND in allTasks list!');
  } else {
    console.log('id           : ' + tmpl.id);
    console.log('text         : ' + tmpl.text);
    console.log('taskType     : ' + tmpl.taskType);
    console.log('recurring    : ' + tmpl.recurring);
    console.log('status       : ' + JSON.stringify(tmpl.status));
    console.log('recur        : ' + JSON.stringify(tmpl.recur));
    console.log('recurStart   : ' + (tmpl.recurStart || null));
    console.log('recurEnd     : ' + (tmpl.recurEnd || null));
    console.log('dur          : ' + tmpl.dur);
    console.log('when         : ' + JSON.stringify(tmpl.when));
    console.log('preferredTimeMins: ' + tmpl.preferredTimeMins);
    console.log('flexMins     : ' + tmpl.flexMins);
    console.log('deadline     : ' + tmpl.deadline);
  }

  // Count existing instances for this template (sibling_id)
  var existing = allTasks.filter(function(t) {
    return t.sourceId === TEMPLATE_ID || t.sibling_id === TEMPLATE_ID;
  });
  console.log('\nExisting instances in view: ' + existing.length);
  existing.forEach(function(e) {
    console.log('  - ' + e.id + ' ord=' + e.recurOrdinal + ' date=' + e.when + ' status=' + JSON.stringify(e.status) + ' genDate=' + (e.genDate || null));
  });

  // Run expansion
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var end = new Date(today); end.setDate(end.getDate() + RECUR_EXPAND_DAYS);
  console.log('\nExpanding ' + dateHelpers.formatDateKey(today) + ' -> ' + dateHelpers.formatDateKey(end));
  var result = expandRecurring(allTasks, today, end, { statuses: statuses });
  var ours = result.filter(function(r) { return r.sourceId === TEMPLATE_ID; });
  console.log('\nexpandRecurring produced ' + result.length + ' total, ' + ours.length + ' for SWUC');
  ours.forEach(function(r) {
    console.log('  - id=' + r.id + ' ord=' + r.recurOrdinal + ' date=' + r._candidateDate + ' when=' + r.when);
  });

  process.exit(0);
})().catch(function(e) { console.error(e); process.exit(1); });

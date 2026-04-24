var v2 = require('../src/scheduler/unifiedScheduleV2');
var db = require('../src/db');
var rtk = require('../src/controllers/task.controller');
(async () => {
  var taskRows = await db('tasks_v').where('user_id', '019d29f9-9ef9-74eb-af2d-0418237d0bd9').select();
  var srcMap = {};
  taskRows.forEach(r => { if (r.task_type === 'recurring_template') srcMap[r.id] = r; });
  var allTasks = taskRows.map(r => rtk.rowToTask(r, 'America/New_York', srcMap));
  var statuses = {};
  allTasks.forEach(t => statuses[t.id] = t.status || '');
  var configRows = await db('user_config').where('user_id', '019d29f9-9ef9-74eb-af2d-0418237d0bd9').select();
  var config = {};
  configRows.forEach(r => { config[r.config_key] = typeof r.config_value === 'string' ? JSON.parse(r.config_value) : r.config_value; });
  var cfg = { timezone: 'America/New_York', timeBlocks: config.time_blocks, toolMatrix: config.tool_matrix, locSchedules: config.loc_schedules || {}, locScheduleDefaults: config.loc_schedule_defaults || {}, locScheduleOverrides: config.loc_schedule_overrides || {}, hourLocationOverrides: config.hour_location_overrides || {}, preferences: config.preferences || {} };
  var nowDate = new Date();
  var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(nowDate);
  var v = {}; parts.forEach(p => v[p.type] = p.value);
  var nowMins = parseInt(v.hour, 10)*60 + parseInt(v.minute, 10);
  var r = v2(allTasks, statuses, '2026-04-23', nowMins, cfg);
  ['2026-04-23','2026-04-24'].forEach(dk => {
    var list = (r.dayPlacements[dk]||[]).slice().sort((a,b)=>a.start-b.start);
    console.log('\nDAY ' + dk + ' (' + list.length + '):');
    list.forEach(p => {
      var h=Math.floor(p.start/60), m=p.start%60;
      console.log('  ' + (h%12||12) + ':' + (m<10?'0':'') + m + (h>=12?'p':'a') + ' dur=' + p.dur + 'm | ' + (p.task.text||'').substring(0,55));
    });
  });
  console.log('\nUNPLACED (' + r.unplaced.length + '):');
  r.unplaced.slice(0,15).forEach(t => console.log('  | ' + (t.text||'').substring(0,60)));
  await db.destroy();
})();

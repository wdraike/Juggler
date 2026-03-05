/**
 * Test scheduler against real DB data
 * Run: cd juggler-backend && node scripts/test-scheduler.js
 */
var db = require("../src/db");
var rtk = require("../src/controllers/task.controller");
var unifiedSchedule = require("../src/scheduler/unifiedSchedule");
var constants = require("../src/scheduler/constants");

async function loadCfg(userId) {
  var rows = await db("user_config").where("user_id", userId).select();
  var config = {};
  rows.forEach(function(row) {
    var val = typeof row.config_value === "string"
      ? JSON.parse(row.config_value) : row.config_value;
    config[row.config_key] = val;
  });
  return {
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

async function test() {
  var userId = "24297d4e-6d74-4530-acee-d415e67c9a8f";
  var taskRows = await db("tasks").where("user_id", userId).select();
  var allTasks = taskRows.map(rtk.rowToTask);

  console.log("Total tasks for user:", allTasks.length);

  var mar4 = allTasks.filter(function(t) { return t.date === "3/4"; });
  console.log("Tasks with date=3/4:", mar4.length);
  mar4.forEach(function(t) {
    console.log("  " + t.id + " | " + t.text.substring(0,40) + " | status=" + (t.status||"(empty)") + " habit=" + t.habit + " rigid=" + t.rigid + " dur=" + t.dur);
  });

  var statuses = {};
  allTasks.forEach(function(t) { statuses[t.id] = t.status || ""; });

  var cfg = await loadCfg(userId);

  var result = unifiedSchedule(allTasks, statuses, "3/4", 600, cfg);
  var p = result.dayPlacements["3/4"] || [];
  console.log("\n=== Placements for 3/4 ===");
  console.log(p.length + " items");
  p.forEach(function(x) {
    var h = Math.floor(x.start/60), m = x.start%60;
    console.log("  " + h + ":" + (m<10?"0":"") + m + " " + x.task.text.substring(0,40) + " (" + x.dur + "m)");
  });

  var bf = p.filter(function(x) { return x.task.text.toLowerCase().indexOf("breakfast") >= 0; });
  console.log("\nBreakfast on 3/4:", bf.length ? "YES at " + Math.floor(bf[0].start/60) + ":" + (bf[0].start%60<10?"0":"") + bf[0].start%60 : "MISSING");

  await db.destroy();
}
test().catch(function(e) { console.error(e); process.exit(1); });

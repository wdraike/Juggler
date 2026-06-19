var crypto = require('crypto');
var db = require('./test-db');

function uid(prefix) {
  return (prefix || 'task') + '-' + crypto.randomBytes(6).toString('hex');
}

/**
 * Create a task in task_masters.
 * The scheduler reads from task_masters via tasks_v view.
 * This is the correct table for scheduler tests to seed data into.
 */
async function createTask(taskData) {
  var id = uid('tm');
  // Build a row that matches task_masters columns
  var row = {
    id: id,
    user_id: taskData.user_id || 1,
    text: taskData.text || '',
    dur: taskData.dur || 30,
    pri: taskData.pri || 'P3',
    status: taskData.status || '',
    created_at: new Date(),
    updated_at: new Date()
  };
  // Handle recurring-specific fields
  if (taskData.when) row.when = taskData.when;
  if (taskData.recur) row.recur = typeof taskData.recur === 'string' ? taskData.recur : JSON.stringify(taskData.recur);
  if (taskData.recur_start) row.recur_start = taskData.recur_start;
  if (taskData.recur_end) row.recur_end = taskData.recur_end;
  if (taskData.day_req) row.day_req = taskData.day_req;
  if (taskData.disabled_at) row.disabled_at = taskData.disabled_at;
  if (taskData.disabled_reason) row.disabled_reason = taskData.disabled_reason;
  if (taskData.deadline) row.deadline = taskData.deadline;
  if (taskData.tz) row.tz = taskData.tz;
  if (taskData.placement_mode) row.placement_mode = taskData.placement_mode;
  if (taskData.notes) row.notes = taskData.notes;
  if (taskData.split) row.split = taskData.split;
  if (taskData.horizon) row.horizon = taskData.horizon;
  row.recurring = taskData.recurring !== undefined ? taskData.recurring : (taskData.recur ? 1 : 0);

  var [task] = await db('task_masters').insert(row).returning('*');
  return task;
}

/**
 * Create a recurring template in task_masters.
 */
async function createRecurringTask(taskData) {
  return createTask(taskData);
}

module.exports = { createTask, createRecurringTask, createTask };

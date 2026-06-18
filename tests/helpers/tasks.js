var crypto = require('crypto');
var db = require('./test-db');

function uid(prefix) {
  return (prefix || 'task') + '-' + crypto.randomBytes(6).toString('hex');
}

async function createTask(taskData) {
  const [task] = await db('task_instances').insert({
    id: uid('ti'),
    ...taskData,
    user_id: 1,
    created_at: new Date(),
    updated_at: new Date()
  }).returning('*');
  return task;
}

async function updateTask(taskId, updates) {
  const [task] = await db('task_instances').where('id', taskId).update({
    ...updates,
    updated_at: new Date()
  }).returning('*');
  return task;
}

async function createRecurringTask(taskData) {
  const [task] = await db('task_masters').insert({
    id: uid('tm'),
    ...taskData,
    user_id: 1,
    created_at: new Date(),
    updated_at: new Date()
  }).returning('*');
  return task;
}

module.exports = { createTask, updateTask, createRecurringTask };
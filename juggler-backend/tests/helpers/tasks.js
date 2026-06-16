const db = require('./test-db');

async function createTask(taskData) {
  const [task] = await db('task_instances').insert({
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
    ...taskData,
    user_id: 1,
    created_at: new Date(),
    updated_at: new Date()
  }).returning('*');
  return task;
}

module.exports = { createTask, updateTask, createRecurringTask };
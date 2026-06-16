const db = require('../tests/helpers/test-db');

async function getTasks(filter = {}) {
  const tasks = await db('task_instances').where(filter).first();
  return tasks || {};
}

async function getTaskInstances(filter = {}) {
  const instances = await db('task_instances').where(filter);
  return instances;
}

module.exports = { getTasks, getTaskInstances };
const db = require('./test-db');

// Callers pass EITHER a filter object (e.g. { id: 'ti-…' }) OR a bare master id
// string (e.g. getTaskInstances(task.id)). Normalize a bare string to a
// { master_id } filter — knex .where() throws on a raw string ("operator undefined").
function normalizeFilter(filter) {
  if (typeof filter === 'string') return { master_id: filter };
  return filter || {};
}

// snake_case → camelCase for a single key (e.g. rolling_anchor → rollingAnchor).
function toCamel(key) {
  return key.replace(/_([a-z0-9])/g, function (_, c) { return c.toUpperCase(); });
}

// MySQL DATE columns come back as a 'YYYY-MM-DD' string under knex dateStrings:true,
// but as a JS Date object otherwise. Tests assert `.rollingAnchor === '2026-06-17'`,
// so normalize a Date to a UTC YYYY-MM-DD string. Pass strings/null through untouched.
function normalizeDate(val) {
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  return val;
}

// Surface every column on a task_masters row in BOTH its original snake_case key
// and a camelCase alias, so tests can read `.rollingAnchor` (alias of rolling_anchor)
// while existing snake_case reads still work. Real DB values only — nothing fabricated.
function camelizeMaster(row) {
  if (!row) return row;
  const out = Object.assign({}, row);
  for (const key of Object.keys(row)) {
    const camel = toCamel(key);
    let value = row[key];
    if (key === 'rolling_anchor' || key === 'recur_start' || key === 'recur_end') {
      value = normalizeDate(value);
      out[key] = value; // also normalize the snake_case key for DATE columns
    }
    if (camel !== key && out[camel] === undefined) out[camel] = value;
  }
  return out;
}

async function getTasks(filter = {}) {
  const tasks = await db('task_instances').where(normalizeFilter(filter)).first();
  return tasks || {};
}

// Two modes:
//   getTaskInstances(filter)        → ARRAY of task_instances rows (legacy contract,
//                                     preserved exactly for all existing callers).
//   getTaskInstances(id, true)      → SINGLE task_masters object (the recurring template
//                                     identified by `id`), with snake_case columns mirrored
//                                     to camelCase so tests can read `.rollingAnchor` etc.
//                                     Returns {} when no such master exists.
async function getTaskInstances(filter = {}, includeMaster = false) {
  if (includeMaster) {
    // `filter` is the MASTER id (a bare string id from createTask) or a filter object.
    const masterFilter = typeof filter === 'string' ? { id: filter } : (filter || {});
    const master = await db('task_masters').where(masterFilter).first();
    return camelizeMaster(master) || {};
  }
  const instances = await db('task_instances').where(normalizeFilter(filter));
  return instances;
}

module.exports = { getTasks, getTaskInstances };

/**
 * Cancel-series soft-delete (R55, no hard delete).
 *
 * - softCancelById / softCancelWhere set status='cancelled' (non-terminal) and
 *   KEEP the row — even an unplaced instance (scheduled_at NULL), which the
 *   terminal_scheduled_at constraint would reject for a terminal status.
 * - A soft-cancelled recurring template is NOT re-expanded by the scheduler
 *   (fabrication stops), and its cancelled instances are excluded from the
 *   write-set — but all rows persist as the historical record.
 *
 * Traceability: WBS juggler-master-instance-redesign L5 / REQUIREMENTS R55.
 * Requires: cd test-bed && make up  (test-bed MySQL @3407).
 */

var db = require('../src/db');
var { runScheduleAndPersist } = require('../src/scheduler/runSchedule');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');
var tasksWrite = require('../src/lib/tasks-write');
var { assertDbAvailable } = require('./helpers/requireDB');

var available = false;
var USER_ID = 'cancel-soft-test-001';
var TZ = 'America/New_York';

beforeAll(async () => {
  await assertDbAvailable();
  try { await db.raw('SELECT 1'); available = true; } catch (e) { return; }
  await cleanup();
  await db('users').insert({ id: USER_ID, email: 'cancelsoft@test.com', timezone: TZ, created_at: db.fn.now(), updated_at: db.fn.now() });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) });
}, 15000);

afterAll(async () => { if (available) await cleanup(); await db.destroy(); });

async function cleanup() {
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeEach(async () => {
  if (!available) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
});

function seedTask(o) {
  var t = Object.assign({ id: 'cs-' + Math.random().toString(36).slice(2, 10), user_id: USER_ID, task_type: 'task', text: 'T', dur: 30, pri: 'P3', status: '', recurring: 0, created_at: db.fn.now(), updated_at: db.fn.now() }, o);
  return tasksWrite.insertTask(db, t).then(function () { return t; });
}

describe('cancel-series soft-delete (R55)', () => {
  test('softCancelById keeps an UNPLACED instance as record (no terminal_scheduled_at violation)', async () => {
    if (!available) return;
    await seedTask({ id: 'm-solo', text: 'Solo', status: '' });
    // unplaced single task (scheduled_at NULL)
    var res = await tasksWrite.softCancelById(db, 'm-solo', USER_ID);
    expect(res.masterCancelled + res.instanceCancelled).toBeGreaterThan(0);
    var row = await db('task_masters').where({ id: 'm-solo', user_id: USER_ID }).first();
    expect(row).toBeDefined();                 // row KEPT (not deleted)
    expect(row.status).toBe('cancelled');
    expect(row.scheduled_at).toBeNull();       // cancelled is non-terminal → null allowed
  }, 30000);

  test('a cancelled recurring template stops fabrication; rows retained, none scheduled', async () => {
    if (!available) return;
    await seedTask({ id: 'tmpl-c', task_type: 'recurring_template', recurring: 1, recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }), text: 'Daily', dur: 20 });
    await runScheduleAndPersist(USER_ID);
    var afterRun1 = await db('task_instances').where({ user_id: USER_ID }).count('* as c').first();
    expect(afterRun1.c).toBeGreaterThan(0);    // fabricated

    // cancel-series: soft-cancel the template + its instances (what the facade now does —
    // the facade cancels instances by id via softCancelWhere(whereIn('id', pendingIds))).
    await tasksWrite.softCancelById(db, 'tmpl-c', USER_ID);
    var instIds = await db('task_instances').where({ master_id: 'tmpl-c', user_id: USER_ID }).pluck('id');
    await tasksWrite.softCancelWhere(db, USER_ID, function (q) { return q.whereIn('id', instIds); });

    await runScheduleAndPersist(USER_ID);
    var rows = await db('task_instances').where({ user_id: USER_ID }).select('status', 'scheduled_at');
    expect(rows.length).toBe(Number(afterRun1.c));          // rows RETAINED (record), none added
    expect(rows.every(function (r) { return r.status === 'cancelled'; })).toBe(true);
    // none active/schedulable
    expect(rows.filter(function (r) { return r.status === '' || r.status === 'wip'; }).length).toBe(0);
    var tmpl = await db('task_masters').where({ id: 'tmpl-c' }).first();
    expect(tmpl.status).toBe('cancelled');   // master soft-cancelled, not deleted
  }, 30000);

  test('a cancelled task does NOT leak into the active count (R55 entity-limit)', async () => {
    if (!available) return;
    var entityLimits = require('../src/middleware/entity-limits');
    await seedTask({ id: 'active-1', text: 'Active', status: '' });
    await seedTask({ id: 'tocancel', text: 'ToCancel', status: '' });
    var before = await entityLimits.countActiveTasks(USER_ID);
    await tasksWrite.softCancelById(db, 'tocancel', USER_ID);
    var after = await entityLimits.countActiveTasks(USER_ID);
    expect(after).toBe(before - 1);   // cancelled no longer counts as active
  }, 30000);
});

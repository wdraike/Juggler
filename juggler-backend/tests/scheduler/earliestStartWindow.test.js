/**
 * Leg A (scheduler-recurring-rework) — instance-owns-window foundation.
 *
 * Asserts: when the scheduler prefabricates recurring instance rows, each row
 * persists a SOFT `earliest_start` window floor = the occurrence's own day.
 * This is the stored-window foundation; the scheduler does NOT yet read it
 * (Leg C wires it), so this leg must NOT change placement behavior.
 *
 * test-bed 3407 (NODE_ENV=test). Never bare jest on dev 3308.
 */
var db = require('../../src/db');
var { runScheduleAndPersist } = require('../../src/scheduler/runSchedule');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
var { assertDbAvailable } = require('../helpers/requireDB');

var available = false;
var USER_ID = 'earliest-start-test-001';
var TZ = 'America/New_York';

function dayKey(off) {
  var d = new Date(); d.setUTCDate(d.getUTCDate() + off);
  var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, a = d.getUTCDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (a < 10 ? '0' : '') + a;
}

beforeAll(async () => {
  await assertDbAvailable();
  try { await db.raw('SELECT 1'); available = true; } catch (e) { console.warn('no DB', e.message); return; }
  await cleanup();
  await db('users').insert({ id: USER_ID, email: 'es@test.com', timezone: TZ, created_at: db.fn.now(), updated_at: db.fn.now() });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) });
}, 15000);

afterAll(async () => { if (available) await cleanup(); await db.destroy(); });

async function cleanup() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeEach(async () => {
  if (!available) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where({ user_id: USER_ID, config_key: 'schedule_cache' }).del();
});

describe('Leg A — instance earliest_start window foundation', () => {
  test('freshly prefabricated recurring instances persist earliest_start = their day', async () => {
    if (!available) return;
    await db('task_masters').insert({
      id: 'es-tmpl', user_id: USER_ID, text: 'Window task', dur: 30, status: '', recurring: 1,
      recur: JSON.stringify({ type: 'weekly', days: 'MTWRFSU', timesPerCycle: 4 }),
      recur_start: dayKey(0), when: 'morning', placement_mode: 'time_window', time_flex: 10080,
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await runScheduleAndPersist(USER_ID);

    var rows = await db('task_instances')
      .where({ user_id: USER_ID, master_id: 'es-tmpl' })
      .select('id', 'date', 'earliest_start');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // Every prefabricated instance carries a non-null earliest_start floor. The floor
    // is the occurrence's original spaced day; `date` may move FORWARD if the instance
    // roamed within its week, so the invariant is floor <= placed-day (never after).
    rows.forEach(function(r) {
      expect(r.earliest_start).not.toBeNull();
      var es = String(r.earliest_start).slice(0, 10);
      var dt = String(r.date).slice(0, 10);
      expect(es <= dt).toBe(true);
    });
  }, 20000);

  test('column is exposed in tasks_v (read model carries the window)', async () => {
    if (!available) return;
    var v = await db.raw('SHOW CREATE VIEW `tasks_v`');
    expect(v[0][0]['Create View']).toContain('earliest_start');
  });
});

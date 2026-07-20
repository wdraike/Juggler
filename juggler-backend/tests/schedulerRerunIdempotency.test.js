// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
/**
 * Characterization guard — scheduler re-run idempotency (B2).
 *
 * Locks the EXISTING guarantee (deterministic IDs + match-by-date reconcile +
 * collision-dedup) so the upcoming fabricate-once-persist work (L2: durable
 * persistence past horizon + frozen-field locking) cannot silently regress it.
 *
 * Invariant: a 2nd consecutive runScheduleAndPersist with no input change
 *   (a) creates ZERO new task_instances rows, and
 *   (b) moves ZERO placements (every instance's scheduled_at is unchanged).
 *
 * Traceability: WBS juggler-master-instance-redesign B2 / REQUIREMENTS R51.
 * Requires: cd test-bed && make up  (test-bed MySQL @3407).
 */

var db = require('../src/db');
var { runScheduleAndPersist } = require('../src/scheduler/runSchedule');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');
var tasksWrite = require('../src/lib/tasks-write');
var { assertDbAvailable } = require('./helpers/requireDB');

var available = false;
var USER_ID = 'rerun-idem-test-001';
var TZ = 'America/New_York';

beforeAll(async () => {
  await assertDbAvailable();
  try { await db.raw('SELECT 1'); available = true; } catch (e) {
    console.warn('Test DB not available:', e.message);
    return;
  }
  await cleanup();
  await db('users').insert(__stampFixture({
    id: USER_ID, email: 'rerunidem@test.com', timezone: TZ,
    created_at: db.fn.now(), updated_at: db.fn.now()
  }));
  await db('user_config').insert(__stampFixture({ user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) }));
  await db('user_config').insert(__stampFixture({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) }));
}, 15000);

afterAll(async () => {
  if (available) await cleanup();
  await db.destroy();
});

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

function seedTask(overrides) {
  var task = Object.assign({
    id: 'ri-' + Math.random().toString(36).slice(2, 10),
    user_id: USER_ID, task_type: 'task', text: 'Test', dur: 30, pri: 'P3',
    status: '', recurring: 0, created_at: db.fn.now(), updated_at: db.fn.now()
  }, overrides);
  return tasksWrite.insertTask(db, task).then(function () { return task; });
}

function seedTemplate(overrides) {
  return seedTask(Object.assign({
    task_type: 'recurring_template', recurring: 1,
    recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' })
  }, overrides));
}

// Snapshot the durable instance rows for this user as a stable id -> scheduled_at map.
async function snapshotInstances() {
  var rows = await db('task_instances').where('user_id', USER_ID).select('id', 'scheduled_at');
  var map = {};
  rows.forEach(function (r) {
    map[r.id] = r.scheduled_at instanceof Date ? r.scheduled_at.toISOString() : String(r.scheduled_at);
  });
  return map;
}

describe('scheduler re-run idempotency (B2 guard)', () => {
  test('2nd run with no change: 0 new instance rows AND 0 moved placements', async () => {
    if (!available) return;

    // A recurring daily template + a recurring template with split enabled +
    // a plain placeable task — exercises the materialization + reconcile paths.
    await seedTemplate({ id: 'idem-daily', text: 'Daily', dur: 20 });
    await seedTemplate({ id: 'idem-split', text: 'Split', dur: 120, split: 1, split_min: 60 });
    await seedTask({ id: 'idem-plain', text: 'Plain', when: 'morning', dur: 30 });

    await runScheduleAndPersist(USER_ID);
    var after1 = await snapshotInstances();
    var count1 = Object.keys(after1).length;
    expect(count1).toBeGreaterThan(0); // materialization actually produced rows

    await runScheduleAndPersist(USER_ID);
    var after2 = await snapshotInstances();
    var count2 = Object.keys(after2).length;

    // (a) zero new rows — the deterministic-key / match-by-date reconcile must
    // re-map the 2nd run onto the SAME rows, never insert duplicates.
    expect(count2).toBe(count1);
    expect(Object.keys(after2).sort()).toEqual(Object.keys(after1).sort());

    // (b) zero moved placements — unchanged inputs must not rewrite scheduled_at.
    Object.keys(after1).forEach(function (id) {
      expect(after2[id]).toBe(after1[id]);
    });
  }, 30000);
});

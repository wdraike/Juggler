// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
/**
 * Frozen invariant (R52) — a STARTED (status 'wip') instance is immovable.
 *
 * Bug fixed: the scheduler loaded 'wip' instances into the placement queue and
 * re-placed them, yanking started work to a new slot (a future wip at 2026-07-15
 * 14:00 was moved to today 10:00). A started instance with a placement must be
 * pinned at its existing slot and never recomputed — and a past started instance
 * stays at its original date (overdue), never rolled forward.
 *
 * Non-started placeable tasks must STILL be scheduled (no over-broad freeze).
 *
 * Fix: unifiedScheduleV2.js buildItems sets isStarted + anchors a wip task from
 * its live t.time; the immovable classification + past-anchored guard route a
 * started-with-placement through tryPlaceAtTime (reserve slot, no move).
 *
 * Traceability: WBS juggler-master-instance-redesign L2 / REQUIREMENTS R52.
 * Requires: cd test-bed && make up  (test-bed MySQL @3407).
 */

var db = require('../src/db');
var { runScheduleAndPersist } = require('../src/scheduler/runSchedule');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');
var tasksWrite = require('../src/lib/tasks-write');
var { assertDbAvailable } = require('./helpers/requireDB');

var available = false;
var USER_ID = 'frozen-invariant-test-001';
var TZ = 'America/New_York';

beforeAll(async () => {
  await assertDbAvailable();
  try { await db.raw('SELECT 1'); available = true; } catch (e) {
    console.warn('Test DB not available:', e.message);
    return;
  }
  await cleanup();
  await db('users').insert(__stampFixture({
    id: USER_ID, email: 'frozeninv@test.com', timezone: TZ,
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

function seedTask(overrides) {
  var task = Object.assign({
    id: 'fz-' + Math.random().toString(36).slice(2, 10),
    user_id: USER_ID, task_type: 'task', text: 'Test', dur: 30, pri: 'P3',
    status: '', recurring: 0, created_at: db.fn.now(), updated_at: db.fn.now()
  }, overrides);
  return tasksWrite.insertTask(db, task).then(function () { return task; });
}

describe('frozen invariant (R52): started instances are immovable', () => {
  test('a future wip instance is pinned — scheduler does not move it', async () => {
    if (!available) return;
    var future = '2026-07-15 14:00:00';
    await seedTask({ id: 'wip-future', text: 'Started future', status: 'wip', when: 'morning', scheduled_at: future, dur: 30 });
    await runScheduleAndPersist(USER_ID);
    var row = await db('tasks_v').where('id', 'wip-future').first();
    expect(row.scheduled_at).toBe(future);
    expect(row.status).toBe('wip');
  }, 30000);

  test('a past wip instance stays at its original date — not rolled forward', async () => {
    if (!available) return;
    var past = '2026-06-10 14:00:00';
    await seedTask({ id: 'wip-past', text: 'Started past', status: 'wip', when: 'morning', scheduled_at: past, dur: 30 });
    await runScheduleAndPersist(USER_ID);
    var row = await db('tasks_v').where('id', 'wip-past').first();
    expect(row.scheduled_at).toBe(past);
  }, 30000);

  test('a non-started placeable task is STILL scheduled (freeze is not over-broad)', async () => {
    if (!available) return;
    await seedTask({ id: 'plain', text: 'Plain', status: '', when: 'morning', dur: 30 });
    await runScheduleAndPersist(USER_ID);
    var row = await db('tasks_v').where('id', 'plain').first();
    expect(row.scheduled_at).toBeTruthy();
  }, 30000);
});

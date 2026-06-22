/**
 * Master-edit refabrication (R53) — resetRecurringInstances drops ONLY future
 * not-started instances (soft-cancel, R55) and PRESERVES past + started + terminal.
 *
 * Called on a recur/split edit (facade recurCleanup). The scheduler's next expand
 * pass regenerates the future per the new cadence; survivors keep their rows.
 *
 * Traceability: WBS juggler-master-instance-redesign L3 / REQUIREMENTS R53.
 * Requires: cd test-bed && make up  (test-bed MySQL @3407).
 */

var db = require('../src/db');
var tasksWrite = require('../src/lib/tasks-write');
var { assertDbAvailable } = require('./helpers/requireDB');

var available = false;
var USER_ID = 'master-edit-test-001';

beforeAll(async () => {
  await assertDbAvailable();
  try { await db.raw('SELECT 1'); available = true; } catch (e) { return; }
  await cleanup();
  await db('users').insert({ id: USER_ID, email: 'masteredit@test.com', timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now() });
}, 15000);

afterAll(async () => { if (available) await cleanup(); await db.destroy(); });

async function cleanup() {
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeEach(async () => {
  if (!available) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
});

async function insMaster() {
  await db('task_masters').insert({ id: 'M', user_id: USER_ID, text: 'Recurring', status: '', recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }), created_at: db.fn.now(), updated_at: db.fn.now() });
}
async function insInst(id, ord, status, scheduledAt) {
  await db('task_instances').insert({ id: id, master_id: 'M', user_id: USER_ID, occurrence_ordinal: ord, split_ordinal: 1, split_total: 1, dur: 30, status: status, scheduled_at: scheduledAt, generated: 0, created_at: db.fn.now(), updated_at: db.fn.now() });
}

describe('master-edit refabrication (R53): resetRecurringInstances', () => {
  test('drops FUTURE not-started (soft-cancel); keeps past pending, past done, and future started', async () => {
    if (!available) return;
    await insMaster();
    await insInst('past-done', 1, 'done', '2026-06-01 10:00:00');   // terminal past → keep
    await insInst('past-pending', 2, '', '2026-06-05 10:00:00');     // past overdue (status='') → keep (R50)
    await insInst('future-pending', 3, '', '2026-07-20 10:00:00');   // future not-started → drop (soft)
    await insInst('future-unplaced', 4, '', null);                   // future unplaced → drop (soft)
    await insInst('future-started', 5, 'wip', '2026-07-21 10:00:00'); // started → keep (frozen, R52)

    var dropped = await tasksWrite.resetRecurringInstances(db, USER_ID, 'M', '[test]');
    expect(dropped).toBe(2); // only the two future not-started

    var byId = {};
    (await db('task_instances').where({ user_id: USER_ID }).select('id', 'status', 'occurrence_ordinal')).forEach(function (r) { byId[r.id] = r; });

    // survivors untouched (status + ordinal preserved — no renumber)
    expect(byId['past-done'].status).toBe('done');
    expect(byId['past-pending'].status).toBe('');
    expect(byId['past-pending'].occurrence_ordinal).toBe(2);
    expect(byId['future-started'].status).toBe('wip');

    // future not-started dropped via SOFT-cancel (rows KEPT as record, not deleted)
    expect(byId['future-pending'].status).toBe('cancelled');
    expect(byId['future-unplaced'].status).toBe('cancelled');
    // all 5 rows still present (no hard delete)
    expect(Object.keys(byId).length).toBe(5);
  }, 30000);
});

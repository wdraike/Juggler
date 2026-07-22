// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
/**
 * 999.2187 guard #2 (David ruling 2026-07-22, "delete orphans everywhere"):
 * recurStart is the hard floor for recurring occurrences (guard #1, expandRecurring).
 * A pending (status='') instance dated BEFORE its master's recur_start is an
 * out-of-window orphan. The single-task recur_start edit already drops these
 * inline; anchor edits routed through resetRecurringInstances (Next Cycle Starts /
 * batch / material) were future-only (R53 "past untouched") and STRANDED them —
 * the "Haircut" pre-recurStart strand. resetRecurringInstances must now ALSO drop
 * pending instances dated before recur_start, so every edit path is consistent.
 * Terminal history (done/skip/cancel) is status!='' and stays untouched. Masters
 * with no recur_start are unaffected (R53 past-pending behavior preserved).
 *
 * Requires: cd test-bed && make up  (test-bed MySQL @3407).
 */

var db = require('../src/db');
var tasksWrite = require('../src/lib/tasks-write');
var { assertDbAvailable } = require('./helpers/requireDB');

var available = false;
var USER_ID = 'prestart-orphan-test-001';

beforeAll(async () => {
  await assertDbAvailable();
  try { await db.raw('SELECT 1'); available = true; } catch { return; }
  await cleanup();
  await db('users').insert(__stampFixture({ id: USER_ID, email: 'prestart@test.com', timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now() }));
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

async function insMaster(recurStart) {
  await db('task_masters').insert(__stampFixture({
    id: 'M', user_id: USER_ID, text: 'Haircut', status: '',
    recur: JSON.stringify({ type: 'interval', every: 6, unit: 'weeks' }),
    recur_start: recurStart,
    created_at: db.fn.now(), updated_at: db.fn.now()
  }));
}
async function insInst(id, ord, status, date, scheduledAt) {
  await db('task_instances').insert(__stampFixture({
    id: id, master_id: 'M', user_id: USER_ID, occurrence_ordinal: ord,
    split_ordinal: 1, split_total: 1, dur: 90, status: status,
    date: date, scheduled_at: scheduledAt, generated: 0,
    created_at: db.fn.now(), updated_at: db.fn.now()
  }));
}

describe('999.2187 guard #2: resetRecurringInstances drops pre-recurStart pending orphans', () => {
  test('deletes pending dated before recur_start; keeps on/after-start pending, pre-start terminal, and still drops future', async () => {
    if (!available) return;
    await insMaster('2026-07-22');
    // scheduled_at in the far PAST so the existing future-delete branch never
    // touches these — isolating the new pre-recurStart-orphan logic. status=''.
    await insInst('orphan-pre',   1, '',     '2026-07-21', '2020-06-01 19:30:00'); // < recurStart → DELETE (was stranded)
    await insInst('keep-on',      2, '',     '2026-07-22', '2020-06-01 13:00:00'); // == recurStart → KEEP
    await insInst('keep-done-pre',3, 'done', '2026-07-20', '2020-06-01 10:00:00'); // pre-start but terminal → KEEP (tombstone)
    // and one genuine future not-started, to prove the existing R53 drop still fires.
    await insInst('future-pending',4, '',    '2099-07-20', '2099-07-20 10:00:00'); // future → DELETE (existing behavior)

    var dropped = await tasksWrite.resetRecurringInstances(db, USER_ID, 'M', '[test]');
    expect(dropped).toBe(2); // orphan-pre + future-pending

    var byId = {};
    (await db('task_instances').where({ user_id: USER_ID }).select('id', 'status')).forEach(function (r) { byId[r.id] = r; });

    expect(byId['orphan-pre']).toBeUndefined();     // pre-recurStart pending dropped (no longer stranded)
    expect(byId['future-pending']).toBeUndefined(); // existing future drop intact
    expect(byId['keep-on'].status).toBe('');        // on-recurStart pending preserved
    expect(byId['keep-done-pre'].status).toBe('done'); // pre-start terminal untouched (R53 history)
    expect(Object.keys(byId).length).toBe(2);
  }, 30000);

  test('no recur_start: past pending is preserved (R53 unaffected)', async () => {
    if (!available) return;
    await insMaster(null); // anchor-independent / no recur_start
    await insInst('past-pending', 1, '', '2020-06-05', '2020-06-05 10:00:00'); // past pending, no recurStart to be before

    var dropped = await tasksWrite.resetRecurringInstances(db, USER_ID, 'M', '[test]');
    expect(dropped).toBe(0);
    var rows = await db('task_instances').where({ user_id: USER_ID }).select('id');
    expect(rows.length).toBe(1); // preserved
  }, 30000);
});

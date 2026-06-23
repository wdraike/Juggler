/**
 * 999.841 — split-part persistence
 *
 * David ruling (2026-06-23): every split chunk persists as its OWN
 * task_instances row with its OWN scheduled_at — the scheduler must NEVER
 * merge-delete chunk rows (separate rows let it redistribute incomplete
 * chunks later). Contiguous chunks are merged in the UI only, not the DB.
 *
 * THE BUG: runSchedule.js post-placement merge (:1336-1415) folds contiguous
 * chunks into the primary and HARD-DELETES the secondaries (:1941-1947), so a
 * 4hr split_total=4 occurrence collapses to 1 row.
 *
 * Run:
 *   DB_PORT=3407 DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=rootpass \
 *     DB_NAME=juggler_schedbatch_test NODE_ENV=test npx jest \
 *     tests/scheduler/split-part-persistence.test.js --testTimeout=30000 --forceExit
 */
'use strict';

process.env.NODE_ENV = 'test';
if (!process.env.DB_NAME) process.env.DB_NAME = 'juggler_splitpart_test';

var db = require('../../src/db');
var { runScheduleAndPersist } = require('../../src/scheduler/runSchedule');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');

var USER_ID = 'splitpart-test-u1';
var TZ = 'America/New_York';
var MASTER_ID = 'splitpart-master-1';

var dbAvailable = false;

function todayISO() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function cleanup() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del().catch(() => {});
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeAll(async () => {
  try { await db.raw('SELECT 1'); dbAvailable = true; } catch (e) { dbAvailable = false; }
  if (!dbAvailable) throw new Error('TEST-FR-001: test-bed DB not reachable. Run: cd test-bed && make up');
  await cleanup();
  await db('users').insert({ id: USER_ID, email: 'splitpart@test.com', timezone: TZ, created_at: db.fn.now(), updated_at: db.fn.now() });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) });
}, 20000);

afterAll(async () => { if (dbAvailable) await cleanup(); await db.destroy(); });

beforeEach(async () => {
  if (!dbAvailable) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where({ user_id: USER_ID, config_key: 'schedule_cache' }).del();
});

async function seedSplitMaster() {
  await db('task_masters').insert({
    id: MASTER_ID,
    user_id: USER_ID,
    text: 'Apply for Jobs',
    dur: 240,
    pri: 'P1',
    status: '',
    recurring: 1,
    recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', every: 1 }),
    placement_mode: 'anytime',
    split: 1,
    split_min: 60,
    recur_start: todayISO(),
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
}

describe('999.841 — split chunks persist as separate rows (not merge-deleted)', () => {
  it("today's 4hr split_total=4 occurrence keeps all 4 chunk rows after a run", async () => {
    await seedSplitMaster();
    await runScheduleAndPersist(USER_ID);

    var rows = await db('task_instances')
      .where({ user_id: USER_ID, master_id: MASTER_ID, date: todayISO() })
      .select('split_ordinal', 'split_total', 'dur', 'scheduled_at')
      .orderBy('split_ordinal');

    // All 4 chunk rows must survive — NOT merged-deleted into one.
    expect(rows.length).toBe(4);
    expect(rows.map(r => Number(r.split_ordinal)).sort()).toEqual([1, 2, 3, 4]);
    rows.forEach(r => {
      expect(Number(r.split_total)).toBe(4);
      expect(Number(r.dur)).toBe(60);
    });
    // Total scheduled minutes for the occurrence == master.dur (no lost time).
    expect(rows.reduce((s, r) => s + Number(r.dur), 0)).toBe(240);
  });

  it('chunk rows survive a SECOND run (no churn-loss across runs)', async () => {
    await seedSplitMaster();
    await runScheduleAndPersist(USER_ID);
    await runScheduleAndPersist(USER_ID);

    var rows = await db('task_instances')
      .where({ user_id: USER_ID, master_id: MASTER_ID, date: todayISO() })
      .select('split_ordinal');
    expect(rows.length).toBe(4);
  });
});

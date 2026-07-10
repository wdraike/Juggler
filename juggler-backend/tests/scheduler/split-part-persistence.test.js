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
// 999.1037 fix-follow-up: unconditional (not `if (!process.env.DB_NAME)`).
// jest.config.js's setupFiles now loads .env.test (DB_NAME=juggler_test) BEFORE
// this file's own top-level code runs, so a conditional guard here is a
// permanent no-op (ernie BLOCK, 2026-07-01) and this file would silently run
// against the SHARED juggler_test schema instead of its isolated one — exactly
// the testbed-juggler-test-pollution class already hit once (2026-06-21).
// Reassert unconditionally so this file's isolation always wins.
process.env.DB_NAME = 'juggler_splitpart_test';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '3407';
process.env.DB_USER = process.env.DB_USER || 'root';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'rootpass';

// 999.1176: reset the db singleton cache so getDefaultDb() re-reads
// process.env.DB_NAME on the next require. Without this, a prior test file's
// require('../../src/db') permanently caches a connection to juggler_test
// (from .env.test), and this file's DB_NAME override is silently ignored —
// the test runs against the shared juggler_test and flakes when other
// suites leave interfering state.
var dbLib = require('../../src/lib/db');
if (typeof dbLib._resetForTests === 'function') dbLib._resetForTests();

var knexLib = require('knex');
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

// 999.1176: self-provision the isolated DB (create + migrate) so the test
// doesn't depend on juggler_splitpart_test being pre-created by globalSetup
// (which only migrates juggler_test). Mirrors overdue-split-persistence-e3.test.js.
async function ensureIsolatedDbProvisioned() {
  var bootstrap = knexLib({
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    }
  });
  try {
    await bootstrap.raw('SELECT 1');
  } catch (e) {
    await bootstrap.destroy();
    throw new Error('TEST-FR-001: test-bed MySQL not reachable at ' + process.env.DB_HOST + ':' + process.env.DB_PORT + '. Run: cd test-bed && make up');
  }
  await bootstrap.raw(
    'CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    [process.env.DB_NAME]
  );
  await bootstrap.destroy();
  await db.migrate.latest();
}

beforeAll(async () => {
  try { await ensureIsolatedDbProvisioned(); dbAvailable = true; } catch (e) { dbAvailable = false; throw e; }
  await cleanup();
  await db('users').insert({ id: USER_ID, email: 'splitpart@test.com', timezone: TZ, created_at: db.fn.now(), updated_at: db.fn.now() });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) });
}, 600000); // 999.1409 (via 999.1247 gate triage): fresh-test-bed provisioning of the
            // isolated DB runs the full migration set (~6 min measured) — 20s timed out
            // mid-provision and left a stuck knex_migrations_lock behind.

afterAll(async () => {
  if (dbAvailable) await cleanup();
  await db.destroy();
  // 999.1176: reset the singleton so the next test file gets a fresh connection
  // to whatever DB_NAME it sets, not our juggler_splitpart_test.
  if (typeof dbLib._resetForTests === 'function') dbLib._resetForTests();
});

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

  // The whole-occurrence-loss regression (the 2026-06 "Apply for Jobs" hole):
  // a PAST pending split occurrence must keep ALL its chunk rows after a run —
  // proves the hole can't reopen. Two former delete paths, both now closed:
  //   - secondaries via the post-placement merge-delete (this leg / 999.841)
  //   - the PRIMARY via the reconciler's past-pending hard-delete (d8fa69a:
  //     never-hard-delete a past incomplete recurring instance)
  it('a PAST (yesterday) pending split occurrence keeps all 4 chunk rows after a run', async () => {
    await seedSplitMaster();
    var y = new Date(); y.setDate(y.getDate() - 1);
    var yISO = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
    // Seed 4 pending chunks for yesterday (so1 placed, so2-4 split parts).
    for (var k = 1; k <= 4; k++) {
      await db('task_instances').insert({
        id: MASTER_ID + '-y-' + k, user_id: USER_ID, master_id: MASTER_ID,
        occurrence_ordinal: 50, split_ordinal: k, split_total: 4, split_group: MASTER_ID + '-y',
        dur: 60, status: '', date: yISO,
        scheduled_at: k === 1 ? yISO + ' 09:00:00' : null,
        unscheduled: k === 1 ? null : 1,
        created_at: db.fn.now(), updated_at: db.fn.now()
      });
    }

    await runScheduleAndPersist(USER_ID);

    var rows = await db('task_instances')
      .where({ user_id: USER_ID, master_id: MASTER_ID, occurrence_ordinal: 50 })
      .select('split_ordinal', 'status');
    // All 4 chunk rows must SURVIVE (not hard-deleted) — '' or 'missed', never gone.
    expect(rows.length).toBe(4);
    rows.forEach(function (r) { expect(['', 'missed']).toContain(r.status); });
  });
});

/**
 * 999.844 — pencil-vs-pen lifecycle guards (narrow scope, David ruling 2026-06-23).
 *
 * Guard 1 (MASTER-DELETE): a series-delete must KEEP every history-bearing
 *   instance verbatim — done/cancel/skip/pause/missed — and soft-cancel only
 *   genuinely-pending instances + the master (status='cancelled'). No hard delete.
 *   Before the fix, pause/missed were treated as pending → overwritten to 'cancelled'.
 *
 * Guard 2 (TERMINAL one-way, narrow): the SCHEDULER must never flip a terminal
 *   instance back to active/pending. Terminal rows load as terminalDedupRows and
 *   are excluded from the schedulable write-set — this pins that invariant.
 *
 * Run:
 *   DB_PORT=3407 DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=rootpass \
 *     DB_NAME=juggler_schedbatch_test NODE_ENV=test npx jest \
 *     tests/scheduler/lifecycle-guards-844.test.js --testTimeout=30000 --forceExit
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
process.env.DB_NAME = 'juggler_lifecycle844_test';

var db = require('../../src/db');
var tasksWrite = require('../../src/lib/tasks-write');
var facade = require('../../src/slices/task/facade');
var { runScheduleAndPersist } = require('../../src/scheduler/runSchedule');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');

var USER_ID = 'lc844-test-u1';
var TZ = 'America/New_York';
var MASTER_ID = 'lc844-master-1';
var available = false;

function ymd(offsetDays) {
  var d = new Date();
  d.setDate(d.getDate() + offsetDays);
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
  try { await db.raw('SELECT 1'); available = true; } catch (e) { available = false; }
  if (!available) throw new Error('TEST-FR-001: test-bed DB not reachable. Run: cd test-bed && make up');
  await cleanup();
  await db('users').insert({ id: USER_ID, email: 'lc844@test.com', timezone: TZ, created_at: db.fn.now(), updated_at: db.fn.now() });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) });
}, 20000);

afterAll(async () => { if (available) await cleanup(); await db.destroy(); });

beforeEach(async () => {
  if (!available) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
});

async function seedMaster() {
  await db('task_masters').insert({
    id: MASTER_ID, user_id: USER_ID, text: 'Meds', dur: 5, pri: 'P1', status: '',
    recurring: 1, recur: JSON.stringify({ type: 'daily' }), placement_mode: 'anytime',
    created_at: db.fn.now(), updated_at: db.fn.now()
  });
}

async function seedInst(suffix, status, ord) {
  await db('task_instances').insert({
    id: MASTER_ID + '-' + suffix, user_id: USER_ID, master_id: MASTER_ID,
    occurrence_ordinal: ord, split_ordinal: 1, split_total: 1, dur: 5, status: status,
    // terminal statuses require a non-null scheduled_at (CHECK constraint)
    date: ymd(-2), scheduled_at: status === '' ? null : ymd(-2) + ' 08:00:00',
    created_at: db.fn.now(), updated_at: db.fn.now()
  });
}

describe('999.844 Guard 1 — series-delete keeps history (done/skip/pause/missed) verbatim', () => {
  it('soft-cancels only pending + master; preserves done/skip/pause/missed/cancel verbatim', async () => {
    await seedMaster();
    await seedInst('done', 'done', 1);
    await seedInst('skip', 'skip', 2);
    await seedInst('pause', 'pause', 3);
    await seedInst('missed', 'missed', 4);
    await seedInst('cancel', 'cancel', 5);
    await seedInst('pending', '', 6);

    var res = await facade.deleteTask({ id: MASTER_ID, userId: USER_ID, scope: 'series' });
    expect(res.status).toBe(200);

    async function statusOf(suffix) {
      var r = await db('task_instances').where({ id: MASTER_ID + '-' + suffix }).select('status').first();
      return r ? r.status : '__DELETED__';
    }

    // History-bearing instances kept VERBATIM — not overwritten, not deleted.
    expect(await statusOf('done')).toBe('done');
    expect(await statusOf('skip')).toBe('skip');
    expect(await statusOf('pause')).toBe('pause');   // RED before fix (was 'cancelled')
    expect(await statusOf('missed')).toBe('missed'); // RED before fix (was 'cancelled')
    expect(await statusOf('cancel')).toBe('cancel');
    // Genuinely-pending → soft-cancelled (series stops generating).
    expect(await statusOf('pending')).toBe('cancelled');
    // Master soft-cancelled, row kept.
    var master = await db('task_masters').where({ id: MASTER_ID }).select('status').first();
    expect(master.status).toBe('cancelled');
  });
});

describe('999.844 Guard 2 — scheduler never reactivates a terminal instance', () => {
  it('a past terminal (done/skip/missed) instance keeps its status after a scheduler run', async () => {
    await seedMaster();
    await seedInst('done', 'done', 1);
    await seedInst('skip', 'skip', 2);
    await seedInst('missed', 'missed', 3);

    await runScheduleAndPersist(USER_ID);

    var rows = await db('task_instances')
      .whereIn('id', [MASTER_ID + '-done', MASTER_ID + '-skip', MASTER_ID + '-missed'])
      .select('id', 'status');
    var byId = {};
    rows.forEach(function (r) { byId[r.id] = r.status; });
    // System must NOT flip terminal → '' / 'wip'.
    expect(byId[MASTER_ID + '-done']).toBe('done');
    expect(byId[MASTER_ID + '-skip']).toBe('skip');
    expect(byId[MASTER_ID + '-missed']).toBe('missed');
  });
});

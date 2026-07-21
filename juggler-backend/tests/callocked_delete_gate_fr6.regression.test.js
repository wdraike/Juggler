// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
/**
 * callocked_delete_gate_fr6.regression.test.js
 *
 * Traceability: juggler-recur-lifecycle-redesign SPEC.md FR-6 (cal_locked delete
 * gate).
 *
 * "Delete is gated/warned when any instance of the series has `cal_locked` set."
 *
 * `cal_locked` is NOT a DB column — it is DERIVED per-request in
 * `KnexTaskRepository.fetchTaskWithEventIds`/`fetchTasksWithEventIds`
 * (src/slices/task/adapters/KnexTaskRepository.js:176-194): a task is
 * `cal_locked` when it has an ACTIVE `cal_sync_ledger` row whose `origin` is a
 * real calendar provider (not `'juggler'`) — i.e. the task is calendar-born.
 *
 * IMPORTANT DISCOVERY (verified by direct read, DeleteTask.js:109-124): the
 * app ALREADY HAS a provider-origin delete guard (`findProviderLedgerRow` /
 * `PROVIDER_ORIGIN_DELETE_BLOCKED`, 403) — but it is EXPLICITLY SKIPPED for
 * scope=series: `var isSeriesDelete = scope === 'series'; if (!isSeriesDelete)
 * { ... check ... }`. So series-delete today runs with ZERO cal_locked/
 * provider-origin checking on any instance in the series — this is a
 * genuinely new gate to add, not a variant of an existing one.
 *
 * Contract choice (telly's design pick — no existing convention pins the exact
 * shape for THIS specific gate; the sibling provider-origin block returns 403 +
 * a PROVIDER_ORIGIN_DELETE_BLOCKED-shaped code, which this test mirrors as the
 * most consistent choice in this file — grover/Oscar should treat the exact
 * status code (403 vs 409) and `code` string as negotiable, but the BEHAVIOR
 * (series delete refuses to proceed while any instance is cal_locked) as the
 * binding acceptance criterion):
 *   - status 403, body.code === 'CAL_LOCKED_DELETE_BLOCKED'
 *
 * Run: cd juggler/juggler-backend && npx jest --testPathPattern="callocked_delete_gate_fr6" --runInBand
 * (requires test-bed MySQL @3407)
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'fr6-callocked-001';

jest.mock('../src/scheduler/scheduleQueue', function () {
  return { enqueueScheduleRun: jest.fn(), stopPollLoop: jest.fn() };
});
jest.mock('../src/lib/redis', function () {
  return {
    getClient: jest.fn().mockReturnValue(null),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    invalidateTasks: jest.fn().mockResolvedValue(true),
    invalidateConfig: jest.fn().mockResolvedValue(true)
  };
});
jest.mock('../src/lib/sse-emitter', function () {
  return { emit: jest.fn(), addClient: jest.fn() };
});

var facade = require('../src/slices/task/facade');

async function seedUser() {
  var existing = await db('users').where('id', USER_ID).first();
  if (!existing) {
    await db('users').insert(__stampFixture({
      id: USER_ID,
      email: 'fr6-callocked@test.invalid',
      name: 'FR-6 cal_locked delete gate test',
      timezone: 'America/New_York',
      created_at: new Date(),
      updated_at: new Date()
    }));
  }
}

async function clearUserTasks() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
}

async function seedSeries(tmplId) {
  var now = new Date();
  await db('task_masters').insert(__stampFixture({
    id: tmplId, user_id: USER_ID, text: 'FR-6 cal_locked gate series', dur: 30, pri: 'P3',
    recurring: 1, status: '', recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', every: 1 }),
    created_at: now, updated_at: now
  }));
  var instId = tmplId + '-i1';
  await db('task_instances').insert(__stampFixture({
    id: instId, master_id: tmplId, user_id: USER_ID, status: '',
    occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
    date: '2020-01-10', scheduled_at: new Date('2020-01-10T10:00:00Z'),
    created_at: now, updated_at: now
  }));
  return instId;
}

async function lockWithCalendarOrigin(instId) {
  await db('cal_sync_ledger').insert(__stampFixture({
    user_id: USER_ID, provider: 'gcal', task_id: instId,
    provider_event_id: 'gcal-evt-' + Date.now(), origin: 'gcal', status: 'active'
  }));
}

describe('FR-6 — cal_locked instance blocks/warns series delete', function () {

  beforeAll(async function () {
    // Date-only fake timers (999.2157): Date frozen, every timer API real — no hangs
    installDateOnlyFakeTimers(new Date('2026-01-15T12:00:00Z'));
    await assertDbAvailable();
    await clearUserTasks();
    await db('users').where('id', USER_ID).del();
    await seedUser();
  }, 15000);

  afterEach(async function () {
    jest.useRealTimers();
    await clearUserTasks();
  });

  afterAll(async function () {
    await clearUserTasks();
    await db('users').where('id', USER_ID).del();
    await db.destroy();
  }, 10000);

  test('series delete is BLOCKED when an instance in the series is cal_locked (active non-juggler ledger row)', async function () {
    var tmplId = 'fr6-cl-tmpl-' + Date.now();
    var instId = await seedSeries(tmplId);
    await lockWithCalendarOrigin(instId);

    var result = await facade.deleteTask({ id: tmplId, userId: USER_ID, scope: 'series' });

    // RED (current code): DeleteTask.js:110-124 skips the ONLY existing
    // provider-origin/cal_locked check entirely when scope==='series'
    // (`if (!isSeriesDelete) { ... }`) — this currently returns 200 and
    // proceeds to soft-cancel the whole series regardless of the lock.
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('CAL_LOCKED_DELETE_BLOCKED');

    // The series must be UNTOUCHED — the master's status must still be the
    // pre-delete value, not soft-cancelled/soft-disabled.
    var master = await db('task_masters').where('id', tmplId).first();
    expect(master.status).toBe('');
  });

  test('control: series delete proceeds normally when NO instance is cal_locked', async function () {
    var tmplId = 'fr6-cl-control-' + Date.now();
    await seedSeries(tmplId);

    var result = await facade.deleteTask({ id: tmplId, userId: USER_ID, scope: 'series' });
    expect(result.status).toBe(200);
  });
});

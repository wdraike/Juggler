/**
 * softdelete_master_fr6.regression.test.js
 *
 * Traceability: juggler-recur-lifecycle-redesign SPEC.md FR-6 (Soft-delete
 * master) / AC7.
 *
 * CORRECTED 2020-01-09 (SPEC.md FR-6/AC7 "SUPERSEDED, second correction"):
 * this file's original two RED assertions demanded the WRONG target shape
 * (`status='disabled'` + `disabled_at`/`disabled_reason` on the master, and
 * hard-delete of non-terminal instances). That was telly's own invented
 * convention, never this codebase's, and grover correctly BLOCKED rather than
 * implement it (see BUILD-LOG-W2.md Deviation #2) because it directly
 * contradicts two pre-existing, binding-invariant GREEN suites:
 * `tests/slices/task/facade.collaborators.db.test.js` (Block D/I, "R55
 * no-hard-delete") and `tests/scheduler/lifecycle-guards-844.test.js`
 * ("999.844 Guard 1 — series-delete keeps history verbatim").
 *
 * Ground truth (verified by direct read of `cascadeRecurringDelete`,
 * facade.js:673-741, R55/999.844 — a BINDING prior ruling, unchanged by this
 * leg): **nothing is ever hard-deleted.** On series delete:
 *   - The MASTER row is soft-CANCELLED (`status='cancelled'`) via
 *     `softCancelById` — row survives, kept as historical record.
 *   - Non-terminal ("pending") instances are ALSO soft-cancelled
 *     (`softCancelWhere`, status='cancelled', row KEPT) — never hard-deleted.
 *   - `done`/`cancel`/`skip`/`pause` instances are kept verbatim, untouched.
 * This file now LOCKS IN that already-shipped behavior as a regression guard
 * (proving the "orphan display text" bug FR-6 originally chased never
 * existed — the master row is never removed, so `tasks_v`'s join to it never
 * breaks), rather than asserting new (and wrong) target behavior. These three
 * tests are GREEN against current code with no grover fix required — see
 * SPEC.md FR-6/AC7 second-correction text for the full ruling.
 *
 * Uses the same `facade.deleteTask({..., scope:'series'})` direct-call
 * convention as tests/deletetask-scope-instance-characterization.db.test.js.
 *
 * Run: cd juggler/juggler-backend && npx jest --testPathPattern="softdelete_master_fr6" --runInBand
 * (requires test-bed MySQL @3407)
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'fr6-softdelete-001';

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
    await db('users').insert({
      id: USER_ID,
      email: 'fr6-softdelete@test.invalid',
      name: 'FR-6 soft-delete master test',
      timezone: 'America/New_York',
      created_at: new Date(),
      updated_at: new Date()
    });
  }
}

async function clearUserTasks() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
}

async function seedSeriesWithHistory(tmplId) {
  var now = new Date();
  await db('task_masters').insert({
    id: tmplId, user_id: USER_ID, text: 'FR-6 series with done history', dur: 30, pri: 'P3',
    recurring: 1, status: '', recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', every: 1 }),
    created_at: now, updated_at: now
  });
  var doneId = tmplId + '-done1';
  var openId = tmplId + '-open1';
  await db('task_instances').insert([
    {
      id: doneId, master_id: tmplId, user_id: USER_ID, status: 'done',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      date: '2020-01-01', scheduled_at: new Date('2020-01-01T10:00:00Z'),
      completed_at: now, created_at: now, updated_at: now
    },
    {
      id: openId, master_id: tmplId, user_id: USER_ID, status: '',
      occurrence_ordinal: 2, split_ordinal: 1, split_total: 1, dur: 30,
      date: '2020-01-10', scheduled_at: new Date('2020-01-10T10:00:00Z'),
      created_at: now, updated_at: now
    }
  ]);
  return { doneId: doneId, openId: openId };
}

describe('FR-6/AC7 — series delete soft-CANCELS the master + soft-cancels open instances (never hard-deletes) + keeps done text', function () {

  beforeAll(async function () {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));
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

  test('master row is soft-CANCELLED (status=cancelled) — NOT hard-deleted, and NOT disabled_at/disabled_reason (999.844/R55 binding invariant, regression guard)', async function () {
    var tmplId = 'fr6-tmpl-' + Date.now();
    await seedSeriesWithHistory(tmplId);

    var result = await facade.deleteTask({ id: tmplId, userId: USER_ID, scope: 'series' });
    expect(result.status).toBe(200);

    var master = await db('task_masters').where('id', tmplId).first();
    expect(master).toBeTruthy(); // row must survive (soft, not hard, delete)
    // GREEN today (R55/999.844, binding — see facade.collaborators.db.test.js
    // Block D/I + lifecycle-guards-844.test.js Guard 1): cascadeRecurringDelete's
    // softCancelById (facade.js:736) sets status='cancelled'. disabled_at/
    // disabled_reason are a DIFFERENT app convention (DowngradeLimitsEnforcer.js/
    // ReEnableTask.js) never used by series-delete — asserted absent here to
    // lock the distinction in as a regression guard.
    expect(master.status).toBe('cancelled');
    expect(master.disabled_at).toBeFalsy();
  });

  test('non-terminal (open) instances are soft-CANCELLED (row kept, status=cancelled) — NEVER hard-deleted (999.844/R55 binding invariant, regression guard)', async function () {
    var tmplId = 'fr6-tmpl2-' + Date.now();
    var ids = await seedSeriesWithHistory(tmplId);

    var result = await facade.deleteTask({ id: tmplId, userId: USER_ID, scope: 'series' });
    expect(result.status).toBe(200);

    var openRow = await db('task_instances').where('id', ids.openId).first();
    // GREEN today (R55/999.844, binding): cascadeRecurringDelete's
    // softCancelWhere (facade.js:710) KEEPS the row and sets status='cancelled'
    // — never a hard DELETE. A hard-delete regression would make this row
    // toBeFalsy(); this guard catches that reversal.
    expect(openRow).toBeTruthy();
    expect(openRow.status).toBe('cancelled');
  });

  test('done instances remain queryable with correct display text after series delete (regression guard — already true today via the surviving master row)', async function () {
    var tmplId = 'fr6-tmpl3-' + Date.now();
    var ids = await seedSeriesWithHistory(tmplId);

    var result = await facade.deleteTask({ id: tmplId, userId: USER_ID, scope: 'series' });
    expect(result.status).toBe(200);

    // This assertion is NOT expected to RED under current code — the master row
    // already survives (soft-cancelled, not hard-deleted), so tasks_v's JOIN to
    // task_masters for `text` already resolves correctly. Kept here as a
    // regression guard: FR-6's whole rationale is "hard-deleting the master
    // orphans done-instance display text" — if a future change reintroduces a
    // hard DELETE of task_masters on series-delete, THIS is the test that
    // catches the orphan-text regression FR-6 exists to prevent.
    var doneRow = await db('tasks_v').where('id', ids.doneId).first();
    expect(doneRow).toBeTruthy();
    expect(doneRow.status).toBe('done');
    expect(doneRow.text).toBe('FR-6 series with done history');
  });
});

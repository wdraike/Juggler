/**
 * 999.1627 — Cal-sync Phase 3b dedup identity characterization.
 *
 * David ruling (2026-07-15, verbatim): "NATIVE-ID DEDUP: provider_event_id
 * ... is the SOLE dedup identity for incoming provider events. The
 * title+date match at cal-sync.controller.js:~1505 is demoted to a
 * NON-DESTRUCTIVE 'possible duplicate' hint (e.g. flag/suggest-merge) —
 * silent absorption into an unrelated task dies. Accepted trade: a
 * hand-mirrored native task + its calendar event may both appear (visible
 * dup > invisible swallow)."
 *
 * BEFORE the fix, Phase 3b's `dupTask` match (cal-sync.controller.js, the
 * "Future event — create task" branch) matched a NEW provider event against
 * ANY existing task with the same (text, date) and, if found, silently
 * absorbed the event into that task's cal_sync_ledger row: no new task/
 * block was created, and the event's own time + gcal_event_id were
 * discarded. Recurring titles ("Lunch" etc.) collided routinely.
 *
 * AFTER the fix: a title+date collision no longer suppresses task creation.
 * The colliding event still gets its own new task + its own ledger row
 * keyed on provider_event_id (visible duplicate, per the accepted trade),
 * and a non-destructive 'possible_duplicate' sync_history hint is recorded
 * (mirrors the existing logSyncAction pattern — no new schema/UI).
 *
 * Uses the W4 golden-master harness's ProviderSim (mocked network boundary,
 * no real GCal credentials needed) — same DB-backed, no-live-API technique
 * as tests/cal-sync/characterization/W4-sync-goldenMaster.characterization.test.js.
 * This file does NOT participate in golden-diff comparison; it asserts
 * directly on DB state.
 */

'use strict';

jest.setTimeout(60000);

jest.mock('../../../src/scheduler/scheduleQueue', () => ({ enqueueScheduleRun: jest.fn() }));
jest.mock('../../../src/lib/sse-emitter', () => ({ emit: jest.fn() }));

var {
  db, TEST_USER_ID, seedTestUser, destroyTestUser, mockReq, mockRes
} = require('../helpers/test-setup');
var { assertDbAvailable } = require('../../helpers/requireDB');
var { makeTask } = require('../helpers/test-fixtures');
var { sync } = require('../../../src/controllers/cal-sync.controller');

var H = require('./harness/syncGoldenHarness');

/** Mirrors W4 harness's seedUserConfig — puts gcal in ingest-only mode so
 *  Phase 2 (push local tasks -> new events) never fires, isolating Phase 3b
 *  (pull unledgered provider events) dedup-identity behavior from incidental
 *  push side effects (a plain local task is otherwise itself eligible for
 *  push and would legitimately pick up its own gcal_event_id). */
async function seedUserConfig(key, valueObj) {
  await db('user_config').insert({
    user_id: TEST_USER_ID, config_key: key, config_value: JSON.stringify(valueObj)
  });
}

var NO_PROVIDERS = {
  gcal_refresh_token: null,
  msft_cal_refresh_token: null, msft_cal_access_token: null,
  apple_cal_username: null, apple_cal_password: null,
  apple_cal_server_url: null, apple_cal_calendar_url: null
};
var GCAL_ONLY = Object.assign({}, NO_PROVIDERS, { gcal_refresh_token: 'w1627-fake-gcal-refresh' });

var sim = new H.ProviderSim();

beforeAll(async () => {
  await assertDbAvailable();
  jest.useFakeTimers({
    now: H.FIXED_NOW,
    doNotFake: [
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask',
      'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback'
    ]
  });
  sim.install();
  await destroyTestUser();
});

beforeEach(async () => {
  sim.reset();
  jest.setSystemTime(H.FIXED_NOW);
  await destroyTestUser();
});

afterAll(async () => {
  sim.uninstall();
  jest.useRealTimers();
  await destroyTestUser();
  await db.destroy();
});

test('999.1627: title+date collision with a DIFFERENT existing task creates its own task/ledger row keyed on provider_event_id — no silent absorption', async () => {
  var user = await seedTestUser(GCAL_ONLY);
  // Ingest-only: isolates Phase 3b pull-dedup from Phase 2 push (a plain
  // local task with no ledger row is otherwise itself eligible for push and
  // would legitimately pick up its own unrelated gcal_event_id).
  await seedUserConfig('cal_sync_settings', { gcal: { mode: 'ingest' } });

  // Pre-existing, unrelated task that happens to share title+date with the
  // incoming provider event (e.g. a recurring "Lunch").
  var existingTask = await makeTask({
    id: 'w1627-existing',
    text: 'Lunch',
    scheduled_at: '2026-06-17 14:00:00', // same UTC instant as the event below
    dur: 30,
    when: 'morning'
  });
  var existingBefore = await db('tasks_with_sync_v').where({ id: existingTask.id }).first();
  expect(existingBefore.gcal_event_id).toBeFalsy();

  // A genuinely distinct calendar event — different id, same title+date.
  sim.seedRemoteEvent('gcal', {
    id: 'ev-gcal-w1627-dup',
    title: 'Lunch',
    startDateTime: '2026-06-17T14:00:00.000Z',
    endDateTime: '2026-06-17T14:30:00.000Z',
    isAllDay: false,
    durationMinutes: 30,
    lastModified: '2026-06-16T11:00:00.000Z'
  });

  var req = mockReq(user);
  var res = mockRes();
  await sync(req, res);

  expect(res.statusCode).toBe(200);

  // The new event must get its OWN ledger row keyed on its OWN provider_event_id.
  var newLedger = await db('cal_sync_ledger')
    .where({ user_id: TEST_USER_ID, provider_event_id: 'ev-gcal-w1627-dup' })
    .first();
  expect(newLedger).toBeTruthy();
  expect(newLedger.status).toBe('active');
  expect(newLedger.task_id).not.toBe(existingTask.id); // NOT hijacked into the unrelated task

  // A NEW task must exist, carrying the event's own gcal_event_id (derived
  // from the active cal_sync_ledger row via tasks_with_sync_v — gcal_event_id
  // is NOT a persisted column on task_masters/task_instances; tasks_v always
  // returns it NULL, see src/db/views/canonical-views.sql).
  var newTask = await db('tasks_with_sync_v').where({ id: newLedger.task_id }).first();
  expect(newTask).toBeTruthy();
  expect(newTask.text).toBe('Lunch');
  expect(newTask.gcal_event_id).toBe('ev-gcal-w1627-dup');

  // The pre-existing task must remain completely untouched by this event.
  var existingAfter = await db('tasks_with_sync_v').where({ id: existingTask.id }).first();
  expect(existingAfter.gcal_event_id).toBeFalsy();
  var ledgerForExisting = await db('cal_sync_ledger')
    .where({ user_id: TEST_USER_ID, task_id: existingTask.id, provider_event_id: 'ev-gcal-w1627-dup' });
  expect(ledgerForExisting.length).toBe(0);

  // Both tasks visibly present (accepted trade: visible dup > invisible swallow).
  var allLunch = await db('tasks_v').where({ user_id: TEST_USER_ID, text: 'Lunch' });
  expect(allLunch.length).toBe(2);

  // Non-destructive "possible duplicate" hint recorded (mirrors existing
  // sync_history/logSyncAction pattern — no new schema/UI).
  var hint = await db('sync_history')
    .where({ user_id: TEST_USER_ID, action: 'possible_duplicate' })
    .first();
  expect(hint).toBeTruthy();
  expect(hint.task_id).toBe(newLedger.task_id);
  expect(hint.detail).toEqual(expect.stringContaining(existingTask.id));
});

test('999.1627: a non-colliding new event still creates a task normally (no regression)', async () => {
  var user = await seedTestUser(GCAL_ONLY);

  sim.seedRemoteEvent('gcal', {
    id: 'ev-gcal-w1627-nocollide',
    title: 'Dentist appointment',
    startDateTime: '2026-06-18T14:00:00.000Z',
    endDateTime: '2026-06-18T15:00:00.000Z',
    isAllDay: false,
    durationMinutes: 60,
    lastModified: '2026-06-16T11:00:00.000Z'
  });

  var req = mockReq(user);
  var res = mockRes();
  await sync(req, res);

  var ledger = await db('cal_sync_ledger')
    .where({ user_id: TEST_USER_ID, provider_event_id: 'ev-gcal-w1627-nocollide' })
    .first();
  expect(ledger).toBeTruthy();
  var task = await db('tasks_with_sync_v').where({ id: ledger.task_id }).first();
  expect(task.text).toBe('Dentist appointment');
  expect(task.gcal_event_id).toBe('ev-gcal-w1627-nocollide');

  var hint = await db('sync_history')
    .where({ user_id: TEST_USER_ID, action: 'possible_duplicate' })
    .first();
  expect(hint).toBeFalsy(); // no collision -> no hint
});

test('999.1627: an already-known event (provider_event_id already ledgered) is NOT duplicated on re-sync', async () => {
  var user = await seedTestUser(GCAL_ONLY);

  sim.seedRemoteEvent('gcal', {
    id: 'ev-gcal-w1627-idem',
    title: 'Standup',
    startDateTime: '2026-06-18T14:00:00.000Z',
    endDateTime: '2026-06-18T14:30:00.000Z',
    isAllDay: false,
    durationMinutes: 30,
    lastModified: '2026-06-16T11:00:00.000Z'
  });

  var req1 = mockReq(user);
  var res1 = mockRes();
  await sync(req1, res1);

  var afterFirst = await db('cal_sync_ledger')
    .where({ user_id: TEST_USER_ID, provider_event_id: 'ev-gcal-w1627-idem' });
  expect(afterFirst.length).toBe(1);

  // Re-sync with no remote changes: the event's provider_event_id is now
  // already known (active ledger row) — must update in place, never duplicate.
  var req2 = mockReq(user);
  var res2 = mockRes();
  await sync(req2, res2);

  var afterSecond = await db('cal_sync_ledger')
    .where({ user_id: TEST_USER_ID, provider_event_id: 'ev-gcal-w1627-idem' });
  expect(afterSecond.length).toBe(1);

  var allStandup = await db('tasks_v').where({ user_id: TEST_USER_ID, text: 'Standup' });
  expect(allStandup.length).toBe(1);
});

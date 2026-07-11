/**
 * W4 — cal-sync sync() Golden Master (999.1025 Phase 1: characterization BEFORE extraction)
 *
 * Pins the CURRENT observable behavior of the ~2,150-line sync() in
 * src/controllers/cal-sync.controller.js as a snapshot oracle BEFORE the
 * ports/adapters/use-case extraction begins. Same discipline as the H6
 * scheduler golden master (tests/characterization/scheduler/goldenMaster.h6.test.js):
 * this suite MUST be green against the un-refactored controller AND must stay
 * green bit-for-bit after extraction.
 *
 * Per run it pins: HTTP status+body, ordered per-provider adapter calls with
 * payloads, SSE events, schedule-run enqueues, and full DB row deltas
 * (tasks_v, cal_sync_ledger, sync_history, sync_locks, task_write_queue, users
 * calendar columns). See harness/syncGoldenHarness.js for determinism rules.
 *
 * BEHAVIORAL AXES COVERED:
 *   A  — push-only (new local tasks -> events) + back-to-back idempotence
 *   B  — pull-only (remote event edit -> task update + fixed promotion)
 *   C  — bidirectional (local edit repush + remote edit pull, one run)
 *   D  — terminal tasks: done (calCompletedBehavior=update) + cancel
 *   D2 — terminal done with calCompletedBehavior=delete (event deleted, 999.1455)
 *   E  — remote deletion lifecycle: push, then 3 missing syncs (miss 1,2,3 -> delete)
 *   E2 — missing event + locally-modified task -> re-create decision (never deletes)
 *   F  — sync-window edges: past / in-window / beyond +60d / past-with-ledger cleanup
 *   G  — ingest-only mode (remote events -> new fixed tasks, no pushes)
 *   H1 — token validation failure (invalid_grant -> token cols nulled)
 *   H2 — listEvents 5xx (provider skipped, ledger untouched)
 *   H3 — createEvent failure (error ledger row)
 *   H4 — updateEvent 410 (ledger -> deleted_remote)
 *   I  — lock contention (foreign sync_locks row -> 409 + sync:lock_conflict, no writes)
 *   J  — multi-provider (gcal+msft): event deleted on gcal only across the miss
 *        threshold while msft stays live (Bug #4 cross-provider guard)
 *   L  — write-phase lock lost mid-write (another process/timeout invalidates
 *        it): 503, clean abort before the transaction, zero partial writes
 *        (W4b follow-up, 999.1025 sub-leg jug-syncharness)
 *   M  — sync exceeds the 5-minute timeout budget before the write phase:
 *        clean abort, zero writes (W4b follow-up)
 *   N  — split-chunk write-phase choreography: non-contiguous chunks push
 *        individually (with "(N/total)" title suffixes), then merge into one
 *        combined event once they become contiguous — follower event+ledger
 *        torn down, follower's task_instances row NEVER deleted (999.841)
 *        (W4b follow-up — see NOTE at axis N below: this pins the CURRENT
 *        task_instances-based choreography, not the schedule_cache framing
 *        the original gap was named for; schedule_cache was removed from
 *        cal-sync entirely by 29b7fafc, which landed after the gap was filed)
 *   O  — write-phase optimistic-concurrency conflict-skip (:2051): a task
 *        concurrently edited (or deleted) between the API-phase snapshot and
 *        the write-phase transaction has its queued update SKIPPED, so a
 *        real user/MCP edit made mid-sync is never clobbered by a stale
 *        provider pull (999.1025 sub-leg jug-syncharness, zoe WARN
 *        zoe-syncharness-conflictskip-unpinned — see NOTE at axis O below)
 *
 * AXES DELIBERATELY NOT COVERED (documented, with reasons):
 *   - Apple/CalDAV flows (multi-calendar user_calendars model, CDN grace,
 *     ctag): owned by apple-cal-*.test.js unit suites + W0 C1 source pin.
 *     Simulating the CalDAV URL-keyed store is an extraction-phase follow-up.
 *
 * RUN (test-bed pool; NEVER bare npx jest against a dev .env):
 *   cd test-bed && scripts/run-suite.sh juggler -- --testPathPattern='W4-sync-goldenMaster'
 *   (tests/cal-sync/ is in run-suite's default ignore list; the explicit
 *    --testPathPattern run documented in the leg notes is the gate for this file)
 * Regenerate goldens (known-good tree only):
 *   UPDATE_GOLDEN=1 <same command>
 *
 * L/M/N determinism notes (999.1025 sub-leg jug-syncharness-999-1025):
 *   - L drives the REAL sync-lock.js heartbeat/refreshLock mechanism end to
 *     end: it lets the real write-phase lock get acquired, then (via a
 *     partial jest.mock of task-write-queue that passes through to the real
 *     flushQueueInLock by default) deletes the sync_locks row itself —
 *     simulating "another process invalidates it" — and waits out one real
 *     10s heartbeat tick so the REAL refreshLock() observes the row gone.
 *     ~14s of real wall-clock wait against the 10s heartbeat interval
 *     (timers are NOT faked — see beforeAll) — a deliberate ~4s slack
 *     margin (widened from an initial 11s/~1s margin per ernie's
 *     jug-syncharness-999-1025 CODE-REVIEW INFO finding
 *     jug-syncharness-999-1025-L-heartbeat-margin: a >1s event-loop delay
 *     of the setInterval callback under CI contention could otherwise let
 *     the wait expire before refreshLock() observes the deleted row,
 *     producing a spurious 200-instead-of-503 flake); still comfortably
 *     << axis I's ~35s.
 *   - M advances the FAKED clock (jest.setSystemTime, instant, no real wait)
 *     past the 300000ms budget the moment the first provider network call
 *     resolves, via the harness's generic script.advanceClockMs hook.
 *   - O reuses the SAME flushQueueInLock passthrough-mock seam as L (run the
 *     real flush, then mutate the DB before the write phase's freshRows
 *     conflict-detection query) to inject a concurrent edit/delete — no real
 *     wait, no clock manipulation, fully deterministic.
 */

'use strict';

jest.setTimeout(120000);

jest.mock('../../../src/scheduler/scheduleQueue', () => ({ enqueueScheduleRun: jest.fn() }));
jest.mock('../../../src/lib/sse-emitter', () => ({ emit: jest.fn() }));
// Axis L (lock-lost 503): partial mock — every OTHER call (this suite's other
// 17 scenarios included) passes straight through to the REAL flushQueueInLock;
// only axis L arms a single mockImplementationOnce override. sync-lock.js and
// task-write-queue.js themselves are NEVER mocked — the lock/heartbeat/refresh
// mechanism stays 100% real, matching the harness's "real lock/queue" invariant.
jest.mock('../../../src/lib/task-write-queue', () => {
  var actual = jest.requireActual('../../../src/lib/task-write-queue');
  return Object.assign({}, actual, { flushQueueInLock: jest.fn(actual.flushQueueInLock) });
});

var scheduleQueue = require('../../../src/scheduler/scheduleQueue');
var sseEmitter = require('../../../src/lib/sse-emitter');
var taskWriteQueue = require('../../../src/lib/task-write-queue');
var actualFlushQueueInLock = jest.requireActual('../../../src/lib/task-write-queue').flushQueueInLock;

var {
  db, TEST_USER_ID, seedTestUser, cleanupTestData, destroyTestUser, mockReq, mockRes
} = require('../helpers/test-setup');
var { assertDbAvailable } = require('../../helpers/requireDB');
var { makeTask, makeLedgerRow } = require('../helpers/test-fixtures');
var { sync } = require('../../../src/controllers/cal-sync.controller');
var tasksWrite = require('../../../src/lib/tasks-write');

var H = require('./harness/syncGoldenHarness');

var NO_PROVIDERS = {
  gcal_refresh_token: null,
  msft_cal_refresh_token: null, msft_cal_access_token: null,
  apple_cal_username: null, apple_cal_password: null,
  apple_cal_server_url: null, apple_cal_calendar_url: null
};
var GCAL_ONLY = Object.assign({}, NO_PROVIDERS, { gcal_refresh_token: 'w4-fake-gcal-refresh' });
var GCAL_MSFT = Object.assign({}, GCAL_ONLY, { msft_cal_refresh_token: 'w4-fake-msft-refresh' });

var sim = new H.ProviderSim();
var deps;

/** Force every seeded/touched task row back to the fixed past timestamp so the
 *  write-phase watermark (max updated_at) is deterministic for the NEXT run. */
async function stabilizeTaskTimestamps() {
  var fields = { created_at: H.FIXED_PAST, updated_at: H.FIXED_PAST };
  await db('task_masters').where('user_id', TEST_USER_ID).update(fields);
  await db('task_instances').where('user_id', TEST_USER_ID).update(fields);
}

/** Direct base-table task edit — fixture control without production write-path
 *  side effects. The two-table model splits columns (e.g. `text` lives only on
 *  task_masters; task_instances has its own status/updated_at), so each table
 *  gets only the fields it actually has. */
var _tableCols = {};
async function tableCols(table) {
  if (!_tableCols[table]) {
    var info = await db(table).columnInfo();
    _tableCols[table] = new Set(Object.keys(info));
  }
  return _tableCols[table];
}
async function editTask(id, fields) {
  var tables = ['task_masters', 'task_instances'];
  for (var i = 0; i < tables.length; i++) {
    var cols = await tableCols(tables[i]);
    var subset = {};
    Object.keys(fields).forEach(function (k) { if (cols.has(k)) subset[k] = fields[k]; });
    if (Object.keys(subset).length) {
      await db(tables[i]).where({ id: id, user_id: TEST_USER_ID }).update(subset);
    }
  }
}

async function seedUserConfig(key, valueObj) {
  await db('user_config').insert({
    user_id: TEST_USER_ID, config_key: key, config_value: JSON.stringify(valueObj)
  });
}

/** Seed a task with deterministic UTC-string datetimes + fixed id. */
async function seedTask(id, scheduledAtUtc, overrides) {
  var t = await makeTask(Object.assign({
    id: id,
    user_id: TEST_USER_ID,
    text: 'W4 ' + id,
    scheduled_at: scheduledAtUtc,
    dur: 30,
    when: 'morning',
    status: ''
  }, overrides || {}));
  return t;
}

async function run(label) {
  return H.recordedSyncRun(deps, label);
}

beforeAll(async () => {
  await assertDbAvailable();
  // Freeze ONLY Date — timers stay real so DB I/O, throttle() and lock backoff work.
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
  deps = {
    db: db, sync: sync, sim: sim, sseEmitter: sseEmitter,
    scheduleQueue: scheduleQueue, mockReq: mockReq, mockRes: mockRes,
    userId: TEST_USER_ID
  };
  await destroyTestUser();
});

beforeEach(async () => {
  sim.reset();
  // Axis M advances the faked system clock mid-test (jest.setSystemTime) —
  // reset it here so a clock jump never leaks into a later test.
  jest.setSystemTime(H.FIXED_NOW);
  await destroyTestUser();
});

afterAll(async () => {
  sim.uninstall();
  jest.useRealTimers();
  await destroyTestUser();
  await db.destroy();
});

// ─── A: push-only + idempotence ──────────────────────────────────────────────

test('A — push-only: two new local tasks create events; immediate re-run is a no-op', async () => {
  await seedTestUser(GCAL_ONLY);
  await seedTask('w4a-1', '2026-06-17 14:00:00');
  await seedTask('w4a-2', '2026-06-18 15:00:00', { dur: 45, when: 'afternoon' });
  await stabilizeTaskTimestamps();

  var run1 = await run('initial push');
  await stabilizeTaskTimestamps();
  var run2 = await run('idempotent re-run');

  // Hard invariants on top of the golden:
  expect(run1.statusCode).toBe(200);
  expect(run2.statusCode).toBe(200);
  var run2Methods = (run2.providerCalls.gcal || []).map(function (c) { return c.method; });
  expect(run2Methods).not.toContain('createEvent');
  expect(run2Methods).not.toContain('batchCreateEvents');
  expect((run2.dbDelta.cal_sync_ledger || {}).added).toBeUndefined();

  H.checkGolden('A-push-only', [run1, run2]);
});

// ─── B: pull-only (remote edit) ──────────────────────────────────────────────

test('B — pull-only: remote event moved -> task pulled + promoted to fixed', async () => {
  await seedTestUser(GCAL_ONLY);
  await seedTask('w4b-1', '2026-06-17 14:00:00');
  await stabilizeTaskTimestamps();
  var run1 = await run('initial push');

  // Remote move: +2h, lastModified after the ledger's echo-guard (+30s).
  var ev = sim.store('gcal').find(function (e) { return e.id === 'ev-gcal-w4b-1'; });
  expect(ev).toBeTruthy();
  ev.startDateTime = '2026-06-17T16:00:00.000Z';
  ev.endDateTime = '2026-06-17T16:30:00.000Z';
  ev.lastModified = '2026-06-16T13:00:00.000Z';

  await stabilizeTaskTimestamps();
  var run2 = await run('pull remote move');

  expect(run2.enqueues.length).toBe(1); // pulled>0 must trigger a reschedule
  H.checkGolden('B-pull-remote-edit', [run1, run2]);
});

// ─── C: bidirectional ────────────────────────────────────────────────────────

test('C — bidirectional: local edit repushes, remote edit pulls, in one run', async () => {
  await seedTestUser(GCAL_ONLY);
  await seedTask('w4c-1', '2026-06-17 14:00:00');
  await seedTask('w4c-2', '2026-06-18 15:00:00');
  await stabilizeTaskTimestamps();
  var run1 = await run('initial push');

  await stabilizeTaskTimestamps();
  // Local edit on c1 (text change -> hash mismatch -> repush).
  await editTask('w4c-1', { text: 'W4 w4c-1 EDITED', updated_at: '2026-06-02 00:00:00' });
  // Remote edit on c2's event.
  var ev = sim.store('gcal').find(function (e) { return e.id === 'ev-gcal-w4c-2'; });
  ev.startDateTime = '2026-06-18T17:00:00.000Z';
  ev.endDateTime = '2026-06-18T17:30:00.000Z';
  ev.lastModified = '2026-06-16T13:00:00.000Z';

  var run2 = await run('bidirectional run');
  H.checkGolden('C-bidirectional', [run1, run2]);
});

// ─── D: terminal-task handling ───────────────────────────────────────────────

test('D — terminal tasks: done (behavior=update) and cancel', async () => {
  await seedTestUser(GCAL_ONLY);
  await seedTask('w4d-done', '2026-06-17 14:00:00');
  await seedTask('w4d-cancel', '2026-06-18 15:00:00');
  await stabilizeTaskTimestamps();
  var run1 = await run('initial push');

  await stabilizeTaskTimestamps();
  await editTask('w4d-done', { status: 'done', updated_at: '2026-06-02 00:00:00' });
  await editTask('w4d-cancel', { status: 'cancel', updated_at: '2026-06-02 00:00:00' });

  var run2 = await run('terminal handling');
  H.checkGolden('D-terminal-update-mode', [run1, run2]);
});

test('D2 — terminal done with calCompletedBehavior=delete: event is deleted (999.1455 fix)', async () => {
  // Fixed 999.1455: cal-sync.controller.js call site was passing the
  // isIngestOnly FUNCTION itself (always truthy) into handleTerminalTaskSync,
  // whose first guard was
  // `if (!task || !event || ledger.origin !== JUGGLER_ORIGIN || isIngestOnly) return {…empty…}`
  // (src/lib/cal-sync-helpers.js:26). The helper therefore ALWAYS no-opped, and
  // calCompletedBehavior='delete' did NOT delete the event for a done task —
  // the done task was repushed (checkmark path) exactly like behavior='update'.
  // Fix: call site now passes isIngestOnly(pid) (the boolean result), so the
  // guard evaluates correctly and the delete branch is reachable. A done task
  // now has its calendar event actually deleted when calCompletedBehavior='delete'.
  await seedTestUser(GCAL_ONLY);
  await seedUserConfig('preferences', { calCompletedBehavior: 'delete' });
  await seedTask('w4d2-1', '2026-06-17 14:00:00');
  await stabilizeTaskTimestamps();
  var run1 = await run('initial push');

  await stabilizeTaskTimestamps();
  await editTask('w4d2-1', { status: 'done', updated_at: '2026-06-02 00:00:00' });

  var run2 = await run('done with delete behavior');
  var methods = (run2.providerCalls.gcal || []).map(function (c) { return c.method; });
  expect(methods).toContain('deleteEvent'); // delete branch now reachable
  expect(methods).not.toContain('batchUpdateEvents'); // no repush — event is gone
  H.checkGolden('D2-terminal-delete-mode', [run1, run2]);
});

// ─── E: remote deletion / miss threshold ─────────────────────────────────────

test('E — remote deletion lifecycle: push, then 3 missing syncs -> miss_count 1,2,3 and task deleted', async () => {
  await seedTestUser(GCAL_ONLY);
  await seedTask('w4e-1', '2026-06-17 14:00:00');
  await stabilizeTaskTimestamps();
  var run1 = await run('initial push');

  // Delete the event remotely; task stays UNCHANGED locally (hashes match the
  // ledger), so the miss-counter path — not the modified-task re-create path —
  // is exercised across MISS_THRESHOLD (3) consecutive syncs.
  sim.store('gcal').length = 0;

  await stabilizeTaskTimestamps();
  var run2 = await run('miss 1');
  await stabilizeTaskTimestamps();
  var run3 = await run('miss 2');
  await stabilizeTaskTimestamps();
  var run4 = await run('miss 3 — threshold');

  // Hard invariant: the task must survive misses 1-2 and be gone after miss 3.
  expect((run2.dbDelta.tasks_v || {}).removed).toBeUndefined();
  expect((run3.dbDelta.tasks_v || {}).removed).toBeUndefined();
  expect(run4.body.deleted_remote).toBeGreaterThan(0);
  H.checkGolden('E-remote-deletion-lifecycle', [run1, run2, run3, run4]);
});

test('E2 — remote event missing but task looks locally modified: re-create decision, not deletion', async () => {
  // Seeded (non-matching) hashes make the task read as "changed since last
  // push" — sync must NOT delete it on a missing event; it takes the
  // data-loss-prevention re-create path (ledger -> replaced, action=repush).
  await seedTestUser(GCAL_ONLY);
  await seedTask('w4e-miss1', '2026-06-17 14:00:00');
  await seedTask('w4e-miss3', '2026-06-18 15:00:00');
  await stabilizeTaskTimestamps();

  var common = {
    provider: 'gcal', origin: 'juggler', status: 'active',
    last_pushed_hash: 'seed-hash', last_user_hash: 'seed-hash', last_pulled_hash: 'seed-hash',
    last_modified_at: '2026-06-10 00:00:00', last_pushed_at: '2026-06-10 00:00:00',
    task_updated_at: H.FIXED_PAST, synced_at: H.FIXED_PAST, created_at: H.FIXED_PAST
  };
  await makeLedgerRow(Object.assign({}, common, {
    task_id: 'w4e-miss1', provider_event_id: 'ev-gcal-w4e-miss1',
    event_start: '2026-06-17T14:00:00.000Z', miss_count: 0
  }));
  await makeLedgerRow(Object.assign({}, common, {
    task_id: 'w4e-miss3', provider_event_id: 'ev-gcal-w4e-miss3',
    event_start: '2026-06-18T15:00:00.000Z', miss_count: 2
  }));
  // Neither event exists in the simulated remote store.

  var run1 = await run('missing events on modified tasks');
  expect((run1.dbDelta.tasks_v || {}).removed).toBeUndefined(); // never deletes a modified task
  H.checkGolden('E2-remote-missing-modified-recreate', [run1]);
});

// ─── F: sync-window edges ────────────────────────────────────────────────────

test('F — window edges: past skipped, in-window pushed, beyond +60d skipped, past-with-ledger cleaned', async () => {
  await seedTestUser(GCAL_ONLY);
  await seedTask('w4f-past', '2026-06-15 14:00:00');       // yesterday — not pushed
  await seedTask('w4f-in', '2026-06-20 14:00:00');         // in window — pushed
  await seedTask('w4f-beyond', '2026-08-20 14:00:00');     // beyond windowEnd (2026-08-15)
  await seedTask('w4f-pastled', '2026-06-15 15:00:00');    // past + ledger + live event
  await stabilizeTaskTimestamps();

  sim.seedRemoteEvent('gcal', {
    id: 'ev-gcal-w4f-pastled', title: 'W4 w4f-pastled',
    startDateTime: '2026-06-15T15:00:00.000Z', endDateTime: '2026-06-15T15:30:00.000Z',
    lastModified: '2026-06-15T15:00:00.000Z'
  });
  await makeLedgerRow({
    provider: 'gcal', origin: 'juggler', status: 'active',
    task_id: 'w4f-pastled', provider_event_id: 'ev-gcal-w4f-pastled',
    last_pushed_hash: 'seed-hash', last_user_hash: 'seed-hash', last_pulled_hash: 'seed-hash',
    event_start: '2026-06-15T15:00:00.000Z',
    last_modified_at: '2026-06-10 00:00:00', last_pushed_at: '2026-06-10 00:00:00',
    task_updated_at: H.FIXED_PAST, synced_at: H.FIXED_PAST, created_at: H.FIXED_PAST,
    miss_count: 0
  });

  var run1 = await run('window edges');
  // Hard invariant: only the in-window task is pushed.
  var created = [];
  (run1.providerCalls.gcal || []).forEach(function (c) {
    if (c.method === 'batchCreateEvents') created = created.concat(c.args.tasks.map(function (t) { return t.id; }));
    if (c.method === 'createEvent') created.push(c.args.task.id);
  });
  expect(created).toEqual(['w4f-in']);
  H.checkGolden('F-window-edges', [run1]);
});

// ─── G: ingest-only mode ─────────────────────────────────────────────────────

test('G — ingest-only: remote events become fixed tasks, nothing is pushed', async () => {
  await seedTestUser(GCAL_ONLY);
  await seedUserConfig('cal_sync_settings', { gcal: { mode: 'ingest' } });
  // A local task that WOULD be pushed in full mode — must be skipped.
  await seedTask('w4g-local', '2026-06-17 14:00:00');
  await stabilizeTaskTimestamps();

  sim.seedRemoteEvent('gcal', {
    id: 'ev-gcal-ingest-future', title: 'Dentist appointment',
    startDateTime: '2026-06-18T14:00:00.000Z', endDateTime: '2026-06-18T15:00:00.000Z',
    lastModified: '2026-06-16T11:00:00.000Z'
  });
  sim.seedRemoteEvent('gcal', {
    id: 'ev-gcal-ingest-past', title: 'Old meeting',
    startDateTime: '2026-06-10T14:00:00.000Z', endDateTime: '2026-06-10T15:00:00.000Z',
    lastModified: '2026-06-10T14:00:00.000Z'
  });

  var run1 = await run('ingest-only run');
  var methods = (run1.providerCalls.gcal || []).map(function (c) { return c.method; });
  expect(methods).not.toContain('createEvent');
  expect(methods).not.toContain('batchCreateEvents');
  H.checkGolden('G-ingest-only', [run1]);
});

// ─── H: provider error paths ─────────────────────────────────────────────────

test('H1 — invalid_grant on token validation: tokens nulled, provider excluded', async () => {
  await seedTestUser(GCAL_ONLY);
  await seedTask('w4h1-1', '2026-06-17 14:00:00');
  await stabilizeTaskTimestamps();
  sim.script('gcal').tokenError = 'invalid_grant: Token has been expired or revoked.';

  var run1 = await run('token expired');
  expect(run1.statusCode).toBe(200);
  var methods = (run1.providerCalls.gcal || []).map(function (c) { return c.method; });
  expect(methods).toEqual(['getValidAccessToken']);
  H.checkGolden('H1-token-expired', [run1]);
});

test('H2 — listEvents 503: provider skipped, existing ledger untouched', async () => {
  await seedTestUser(GCAL_ONLY);
  await seedTask('w4h2-1', '2026-06-17 14:00:00');
  await stabilizeTaskTimestamps();
  await makeLedgerRow({
    provider: 'gcal', origin: 'juggler', status: 'active',
    task_id: 'w4h2-1', provider_event_id: 'ev-gcal-w4h2-1',
    last_pushed_hash: 'seed-hash', last_user_hash: 'seed-hash', last_pulled_hash: 'seed-hash',
    event_start: '2026-06-17T14:00:00.000Z',
    last_modified_at: '2026-06-10 00:00:00', last_pushed_at: '2026-06-10 00:00:00',
    task_updated_at: H.FIXED_PAST, synced_at: H.FIXED_PAST, created_at: H.FIXED_PAST,
    miss_count: 0
  });
  sim.script('gcal').listError = 'Calendar API error 503: Service unavailable';

  var run1 = await run('fetch 503');
  expect(run1.dbDelta.cal_sync_ledger).toBeUndefined(); // ledger must be untouched
  H.checkGolden('H2-fetch-503', [run1]);
});

test('H3 — createEvent failure: error ledger row, no task link', async () => {
  await seedTestUser(GCAL_ONLY);
  await seedTask('w4h3-1', '2026-06-17 14:00:00');
  await stabilizeTaskTimestamps();
  sim.script('gcal').createError = 'Calendar API error 500: Backend Error';

  var run1 = await run('create failure');
  H.checkGolden('H3-create-error', [run1]);
});

test('H4 — updateEvent 410 on repush: ledger transitions to deleted_remote', async () => {
  await seedTestUser(GCAL_ONLY);
  await seedTask('w4h4-1', '2026-06-17 14:00:00');
  await stabilizeTaskTimestamps();
  var run1 = await run('initial push');

  await stabilizeTaskTimestamps();
  await editTask('w4h4-1', { text: 'W4 w4h4-1 EDITED', updated_at: '2026-06-02 00:00:00' });
  sim.script('gcal').updateError = 'Calendar API error 410: Resource has been deleted';

  var run2 = await run('repush hits 410');
  H.checkGolden('H4-update-410', [run1, run2]);
});

// ─── I: lock contention ──────────────────────────────────────────────────────

test('I — foreign sync lock held: 409 + sync:lock_conflict + zero DB writes (slow: ~35s of real backoff)', async () => {
  await seedTestUser(GCAL_ONLY);
  await seedTask('w4i-1', '2026-06-17 14:00:00');
  await stabilizeTaskTimestamps();
  // Foreign holder with a DB-clock expiry far beyond the 8-attempt backoff (~35s).
  await db.raw(
    'INSERT INTO sync_locks (user_id, lock_token, acquired_at, expires_at) VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 300 SECOND))',
    [TEST_USER_ID, 'w4-foreign-lock-token']
  );

  try {
    var run1 = await run('lock contention');
    expect(run1.statusCode).toBe(409);
    expect(run1.dbDelta).toEqual({});
    expect(run1.sse.some(function (e) { return e.event === 'sync:lock_conflict'; })).toBe(true);
    H.checkGolden('I-lock-contention', [run1]);
  } finally {
    await db('sync_locks').where('user_id', TEST_USER_ID).del();
  }
}, 150000);

// ─── J: multi-provider miss-threshold guard ──────────────────────────────────

test('J — multi-provider: event deleted on gcal only, msft still live — task survives across the gcal miss threshold (Bug #4 guard)', async () => {
  await seedTestUser(GCAL_MSFT);
  await seedTask('w4j-1', '2026-06-17 14:00:00');
  await stabilizeTaskTimestamps();
  var run1 = await run('initial push to both providers');

  // Remote deletion on gcal ONLY; the msft event stays live. Task unchanged
  // locally, so the gcal ledger walks the miss counter to the threshold while
  // the msft ledger keeps matching — the cross-provider guard decides the
  // task's fate at the threshold.
  var gstore = sim.store('gcal');
  gstore.length = 0;

  await stabilizeTaskTimestamps();
  var run2 = await run('gcal miss 1');
  await stabilizeTaskTimestamps();
  var run3 = await run('gcal miss 2');
  await stabilizeTaskTimestamps();
  var run4 = await run('gcal miss 3 — threshold with msft active');

  H.checkGolden('J-multi-provider-miss-guard', [run1, run2, run3, run4]);
});

// ─── L: write-phase lock lost mid-write (503) ────────────────────────────────

test('L — write-phase lock lost mid-write (another process invalidates it): 503, no partial writes (slow: ~14s real heartbeat wait)', async () => {
  await seedTestUser(GCAL_ONLY);
  await seedTask('w4l-1', '2026-06-17 14:00:00');
  await stabilizeTaskTimestamps();

  // Arm ONE flushQueueInLock call (the write phase's very next await after
  // lock acquisition) to: run the REAL flush first (matches production
  // ordering), then delete the sync_locks row ourselves — simulating
  // "another process/timeout invalidates it" — then wait out one real 10s
  // heartbeat tick (with ~4s of slack — see the L/M/N determinism notes
  // near the top of this file). lockHeartbeat's setInterval is a REAL
  // timer (un-faked, see beforeAll) so it fires naturally during the wait
  // and calls the REAL refreshLock() against the DB, which finds 0
  // matching rows and sets writePhaseLockLost=true — the exact production
  // mechanism, not a stub.
  taskWriteQueue.flushQueueInLock.mockImplementationOnce(async function (userId) {
    await actualFlushQueueInLock(userId);
    await db('sync_locks').where('user_id', userId).del();
    await new Promise(function (r) { setTimeout(r, 14000); });
  });

  var run1 = await run('lock lost mid-write');

  expect(run1.statusCode).toBe(503);
  expect(run1.body).toEqual({ error: 'Sync lock lost. Please retry.', retryAfter: 5 });
  // Clean abort: the write-phase transaction is never entered (the
  // writePhaseLockLost check returns BEFORE `getDb().transaction(...)`), so
  // no task/ledger row is touched — no partial-write corruption.
  expect(run1.dbDelta.tasks_v).toBeUndefined();
  expect(run1.dbDelta.cal_sync_ledger).toBeUndefined();
  expect(run1.sse.some(function (e) {
    return e.event === 'sync:progress' && e.payload && e.payload.phase === 'error';
  })).toBe(true);
  H.checkGolden('L-lock-lost-mid-write', [run1]);
});

// ─── M: sync-timeout guard (>5 min elapsed before the write phase) ──────────

test('M — sync exceeds the 5-minute timeout before the write phase: clean abort, zero writes', async () => {
  await seedTestUser(GCAL_ONLY);
  await seedTask('w4m-1', '2026-06-17 14:00:00');
  await stabilizeTaskTimestamps();

  // Deterministic: Date is fully faked, so jumping it past the 300000ms
  // budget the instant the first provider call resolves (getValidAccessToken,
  // top of Phase 1) guarantees sync()'s own Date.now() re-read at its
  // sync_timeout check (after all of Phase 1-3) sees an elapsed budget — no
  // real wait needed.
  sim.script('gcal').advanceClockMs = 300001;

  var run1 = await run('sync exceeds timeout before write phase');

  expect(run1.statusCode).toBe(200);
  expect(run1.body.error).toBe('sync_timeout');
  // The timeout check runs BEFORE lock acquisition and BEFORE any DB write —
  // Phase 1-3 only builds in-memory buffers. Zero writes, clean abort.
  expect(run1.dbDelta).toEqual({});
  H.checkGolden('M-sync-timeout', [run1]);
});

// ─── N: split-chunk write-phase choreography ─────────────────────────────────
//
// NOTE on naming: the original 999.1025-phase-1 gap (0e51d0be) named this
// "split-chunk schedule_cache choreography". That specific codepath (a
// schedule_cache read driving synthetic per-part task expansion) was REMOVED
// by 29b7fafc ("finish W4 — remove schedule_cache from cal-sync", 999.1217),
// which landed AFTER 0e51d0be — schedule_cache is no longer read by sync() at
// all (see the controller's own 999.1217 comments at the top of the merge
// pass and inside the push-queue loop). The underlying RISK the gap named is
// still real and still live: split chunks persist as SEPARATE task_instances
// rows (999.841) and sync()'s mergeContiguousSplitChunks() pass (merge
// contiguous chunks into one event; suppress + delete follower events/ledger
// rows) is exactly the kind of deeply-woven write-phase logic 999.1025's
// extraction risks breaking. This scenario pins the CURRENT (post-999.1217)
// task_instances-based choreography instead of the stale schedule_cache
// framing.

test('N — split-chunk choreography: non-contiguous chunks push individually, then merge into one event on becoming contiguous', async () => {
  await seedTestUser(GCAL_ONLY);

  var templateId = 'w4n-tmpl';
  await makeTask({
    id: templateId, task_type: 'recurring_template', recurring: 1,
    text: 'W4N split task', dur: 30, status: ''
  });
  // Two chunks of the SAME occurrence (shared master_id + occurrence_ordinal,
  // per mergeContiguousSplitChunks' grouping key) — the real production write
  // path (runSchedule.js uses the same insertTasksBatch call for split
  // chunks), not a narrower internal. c2 starts 90 minutes after c1 ends —
  // NOT contiguous (mergeContiguousSplitChunks' 30s tolerance).
  await tasksWrite.insertTasksBatch(db, [
    {
      id: 'w4n-c1', user_id: TEST_USER_ID, task_type: 'recurring_instance', source_id: templateId,
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 2,
      scheduled_at: '2026-06-17 14:00:00', dur: 30, status: ''
    },
    {
      id: 'w4n-c2', user_id: TEST_USER_ID, task_type: 'recurring_instance', source_id: templateId,
      occurrence_ordinal: 1, split_ordinal: 2, split_total: 2,
      scheduled_at: '2026-06-17 16:00:00', dur: 30, status: ''
    }
  ]);
  await stabilizeTaskTimestamps();

  var run1 = await run('non-contiguous split chunks push individually');
  // Hard invariant: BOTH chunks are pushed as separate events (non-contiguous
  // singleton branch — each gets its own "(N/2)" title suffix, no merge/delete).
  var run1Ids = [];
  (run1.providerCalls.gcal || []).forEach(function (c) {
    if (c.method === 'batchCreateEvents') run1Ids = run1Ids.concat(c.args.tasks.map(function (t) { return t.id; }));
    if (c.method === 'createEvent') run1Ids.push(c.args.task.id);
  });
  expect(run1Ids.sort()).toEqual(['w4n-c1', 'w4n-c2']);

  // Edit c2 to start exactly where c1 ends (14:30) — now contiguous.
  await stabilizeTaskTimestamps();
  await editTask('w4n-c2', { scheduled_at: '2026-06-17 14:30:00', updated_at: '2026-06-02 00:00:00' });

  var run2 = await run('chunks become contiguous — merge into one event');

  // Hard invariants: c1 (leader) is repushed with the merged 60-min span;
  // c2 (follower)'s event is torn down and its ledger row marked
  // deleted_local — but c2's task_instances ROW itself is NEVER deleted
  // (999.841 binding ruling: split-chunk rows are never merged/deleted at the
  // task level — only the calendar event + ledger entry are cleaned up).
  var run2Methods = (run2.providerCalls.gcal || []).map(function (c) { return c.method; });
  var hadUpdate = run2Methods.indexOf('updateEvent') !== -1 || run2Methods.indexOf('batchUpdateEvents') !== -1;
  var hadDelete = run2Methods.indexOf('deleteEvent') !== -1 || run2Methods.indexOf('batchDeleteEvents') !== -1;
  expect(hadUpdate).toBe(true); // leader repushed (merged dur/title -> hash mismatch)
  expect(hadDelete).toBe(true); // follower's individually-synced event torn down

  var removedTaskIds = ((run2.dbDelta.tasks_v || {}).removed || []).map(function (r) { return r.id; });
  expect(removedTaskIds).not.toContain('w4n-c2');
  var c2Ledger = await db('cal_sync_ledger').where({ user_id: TEST_USER_ID, task_id: 'w4n-c2' }).first();
  expect(c2Ledger).toBeTruthy();
  expect(c2Ledger.status).toBe('deleted_local');
  var c2Instance = await db('task_instances').where({ id: 'w4n-c2', user_id: TEST_USER_ID }).first();
  expect(c2Instance).toBeTruthy(); // chunk row survives — 999.841

  H.checkGolden('N-split-chunk-merge-choreography', [run1, run2]);
});

// ─── O: write-phase conflict-skip (concurrent edit / concurrent delete) ─────
//
// Pins cal-sync.controller.js:2051 `if (conflictSkipIds.has(upd.id)) continue;`
// — the write-phase optimistic-concurrency guard that skips a queued task
// update when the task was concurrently MODIFIED (freshTime > origTime,
// :2009-2013) or DELETED (:2004-2007) between the API-phase snapshot and the
// write-phase transaction. Found unpinned by zoe's adversarial coverage probe
// (999.1025 sub-leg jug-syncharness, WARN zoe-syncharness-conflictskip-unpinned):
// the exact mutation `if (conflictSkipIds.has(upd.id)) continue;` ->
// `if (false && ...)` survived all 18 pre-existing scenarios.
//
// Injection uses the SAME flushQueueInLock passthrough-mock seam axis L
// installs (real flush runs first — matching production ordering, since
// flushQueueInLock is the write phase's very first await, immediately before
// the freshRows conflict-detection query at :1995 — then we mutate the DB).
//
// w4o-edit is set up exactly like axis B (push, then remote move) so run2
// would normally PULL the remote's new scheduled_at into the task. This is
// deliberate: gcal_event_id/msft_event_id/apple_event_id are NOT in
// tasks-write.js's MASTER_UPDATE_FIELDS/INSTANCE_UPDATE_FIELDS allowlists, so
// a taskUpdates entry containing ONLY the eventIdCol linkage field (the write
// axis A/H3/H4/N exercise, :662/:1484/:1521/:1580) is silently dropped by
// splitUpdateFields() regardless of conflictSkipIds — dead code, same class
// as the axis-N schedule_cache reframe (confirmed by reading tasks-write.js;
// see TEST-CATALOG.md). Pinning the skip against a LIVE field (scheduled_at,
// which IS in INSTANCE_UPDATE_FIELDS) is required for this pin to be
// mutation-sensitive. Mid-write we simulate the user rescheduling w4o-edit
// (bumping updated_at forward of the FIXED_PAST watermark sync() snapshotted
// at API-phase start) — conflictSkipIds must populate and the pull must be
// skipped, so the user's own reschedule survives untouched.
//
// w4o-del is set up identically, but mid-write we delete the row entirely
// (task_instances + task_masters) — simulating the user deleting the task
// mid-sync, exercising the :2004-2007 detection branch.
// NOTE (honesty, not a defect — verified by reading tasks-write.js
// updateTaskById): unlike w4o-edit, the w4o-del sub-case is NOT independently
// mutation-sensitive at :2051 under the CURRENT updateTaskById, which
// silently no-ops an UPDATE matching 0 rows (no throw, no dbDelta change)
// whether or not the skip fires — there is nothing left to "clobber" once a
// row is gone. The assertions below (200, row stays absent, no crash,
// nothing resurrected) characterize real CURRENT behavior and exercise the
// :2004-2007 detection branch, but this test's RED-flip on zoe's exact
// mutation comes from w4o-edit alone (confirmed in the mutation-verify step).
async function deleteTaskRow(id) {
  await db('task_instances').where({ id: id, user_id: TEST_USER_ID }).del();
  await db('task_masters').where({ id: id, user_id: TEST_USER_ID }).del();
}

test('O — write-phase conflict-skip: concurrent edit survives untouched, concurrent delete does not crash', async () => {
  await seedTestUser(GCAL_ONLY);
  await seedTask('w4o-edit', '2026-06-17 14:00:00');
  await seedTask('w4o-del', '2026-06-18 15:00:00');
  await stabilizeTaskTimestamps();
  var run1 = await run('initial push (both tasks)');

  // Remote move on BOTH events — same trigger axis B uses to force a pull.
  ['w4o-edit', 'w4o-del'].forEach(function (id) {
    var ev = sim.store('gcal').find(function (e) { return e.id === 'ev-gcal-' + id; });
    expect(ev).toBeTruthy();
    ev.startDateTime = '2026-06-17T16:00:00.000Z';
    ev.endDateTime = '2026-06-17T16:30:00.000Z';
    ev.lastModified = '2026-06-16T13:00:00.000Z';
  });
  await stabilizeTaskTimestamps();

  // Arm ONE flushQueueInLock call: run the REAL flush first (production
  // ordering), then inject the two concurrent mutations BEFORE the write
  // phase's freshRows conflict-detection query runs.
  taskWriteQueue.flushQueueInLock.mockImplementationOnce(async function (userId) {
    await actualFlushQueueInLock(userId);
    // Concurrent user reschedule of w4o-edit.
    await editTask('w4o-edit', {
      scheduled_at: '2026-06-17 09:00:00',
      updated_at: '2026-06-16 11:59:00'
    });
    // Concurrent user delete of w4o-del.
    await deleteTaskRow('w4o-del');
  });

  var run2 = await run('concurrent edit + concurrent delete mid-write');

  expect(run2.statusCode).toBe(200);

  // w4o-edit: the pull must be SKIPPED — the concurrent edit survives
  // byte-for-byte. A clobber would show the remote's pulled scheduled_at
  // (derived from 16:00 UTC) and a fresh (now) updated_at instead.
  var editedInstance = await db('task_instances').where({ id: 'w4o-edit', user_id: TEST_USER_ID }).first();
  expect(editedInstance).toBeTruthy();
  expect(editedInstance.scheduled_at).toBe('2026-06-17 09:00:00');
  expect(editedInstance.updated_at).toBe('2026-06-16 11:59:00');

  // w4o-del: no crash, row stays deleted, nothing resurrected.
  var deletedInstance = await db('task_instances').where({ id: 'w4o-del', user_id: TEST_USER_ID }).first();
  var deletedMaster = await db('task_masters').where({ id: 'w4o-del', user_id: TEST_USER_ID }).first();
  expect(deletedInstance).toBeUndefined();
  expect(deletedMaster).toBeUndefined();

  H.checkGolden('O-write-phase-conflict-skip', [run1, run2]);
});

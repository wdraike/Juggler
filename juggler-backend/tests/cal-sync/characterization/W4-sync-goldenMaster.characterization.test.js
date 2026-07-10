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
 *
 * AXES DELIBERATELY NOT COVERED (documented, with reasons):
 *   - Apple/CalDAV flows (multi-calendar user_calendars model, CDN grace,
 *     ctag): owned by apple-cal-*.test.js unit suites + W0 C1 source pin.
 *     Simulating the CalDAV URL-keyed store is an extraction-phase follow-up.
 *   - Write-phase lock-lost 503: only reachable via the 10s heartbeat losing a
 *     refresh race mid-write — no deterministic seam exists without modifying
 *     the controller (forbidden in Phase 1). Lock behavior is owned by
 *     20-sync-lock / 23-sync-consistency; the 503 branch shape is pinned by
 *     code reading only.
 *   - 5-minute sync_timeout guard: requires Date.now to advance mid-run;
 *     frozen-clock harness cannot reach it without a seam.
 *   - Split-chunk replacement (splitPlacements/schedule_cache choreography) and
 *     recurring ledger self-heal: high-value but needs schedule_cache fixtures;
 *     flagged as W4b follow-up before the Phase-2/3 extraction legs.
 *
 * RUN (test-bed pool; NEVER bare npx jest against a dev .env):
 *   cd test-bed && scripts/run-suite.sh juggler -- --testPathPattern='W4-sync-goldenMaster'
 *   (tests/cal-sync/ is in run-suite's default ignore list; the explicit
 *    --testPathPattern run documented in the leg notes is the gate for this file)
 * Regenerate goldens (known-good tree only):
 *   UPDATE_GOLDEN=1 <same command>
 */

'use strict';

jest.setTimeout(120000);

jest.mock('../../../src/scheduler/scheduleQueue', () => ({ enqueueScheduleRun: jest.fn() }));
jest.mock('../../../src/lib/sse-emitter', () => ({ emit: jest.fn() }));

var scheduleQueue = require('../../../src/scheduler/scheduleQueue');
var sseEmitter = require('../../../src/lib/sse-emitter');

var {
  db, TEST_USER_ID, seedTestUser, cleanupTestData, destroyTestUser, mockReq, mockRes
} = require('../helpers/test-setup');
var { assertDbAvailable } = require('../../helpers/requireDB');
var { makeTask, makeLedgerRow } = require('../helpers/test-fixtures');
var { sync } = require('../../../src/controllers/cal-sync.controller');

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

// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
/**
 * FIX-04: DB-based claiming tests for scheduleQueue.js
 *
 * Tests the cross-instance race-prevention mechanism added in Plan 07-02.
 * Each test exercises the claim/release surface directly by calling the
 * exported helpers — no poll-loop timing involved.
 *
 * Three scenarios:
 *   1. Race prevention: two concurrent claim attempts for same user_id —
 *      exactly one wins (claimed: true), the other loses (claimed: false).
 *   2. Stale reclaim: a claim from a crashed instance (claimed_at > CLAIM_TTL_SECONDS
 *      ago) is reclaimable by a fresh instance.
 *   3. Release: after processUser completes, claimed_by/claimed_at are NULL,
 *      so a subsequent claim for the same user succeeds immediately.
 *
 * Requires test-bed MySQL @3407 (TEST-FR-001: throws loud on no-DB).
 * DB ops use raw SQL to backdate timestamps — same pattern as syncLockStartup.test.js.
 *
 * RED phase: these tests FAIL until scheduleQueue.js implements tryClaim / releaseClaim.
 */
process.env.NODE_ENV = 'test';

var testDb = require('./helpers/testDb');
var { assertDbAvailable } = require('./helpers/requireDB');

var hasDb = false;
var db;

// ── Helpers imported from the module under test ───────────────────────────
// We import the internal helpers so tests can call them directly without
// going through the poll loop. These are exported via _internal for testing.
var scheduleQueue;
var tryClaim;
var releaseClaim;
var CLAIM_TTL_SECONDS;

beforeAll(async function() {
  await assertDbAvailable();
  hasDb = true;
  db = testDb.getDb();

  // Seed a test user (schedule_queue has FK to users)
  var userId = '__claim_test_user__';
  await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]);
  await db('users').where('id', userId).del();
  await db('users').insert(__stampFixture({
    id: userId,
    email: 'claim-test@test.com',
    name: 'Claim Test User',
    timezone: 'America/New_York',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  }));

  // Import scheduleQueue — if it exports _internal.tryClaim and
  // _internal.releaseClaim these tests will run; otherwise they'll
  // fail with "tryClaim is not a function" (the expected RED state).
  scheduleQueue = require('../src/scheduler/scheduleQueue');
  var internals = scheduleQueue._internal || {};
  tryClaim = internals.tryClaim;
  releaseClaim = internals.releaseClaim;
  CLAIM_TTL_SECONDS = internals.CLAIM_TTL_SECONDS || 60;
});

afterAll(async function() {
  if (hasDb) {
    var userId = '__claim_test_user__';
    await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]).catch(function() {});
    await db('users').where('id', userId).del().catch(function() {});
    await testDb.destroy();
  }
});

// ── Test 1: Race prevention ───────────────────────────────────────────────
//
// Two "instances" call tryClaim for the same userId back-to-back.
// Because the first claim atomically sets claimed_by, the second must lose.
// This simulates the poll tick racing between two Cloud Run replicas.

test('only one of two concurrent claim attempts wins', async function() {
  // Require the internal helpers — RED state: tryClaim is not yet defined.
  expect(typeof tryClaim).toBe('function');
  expect(typeof releaseClaim).toBe('function');

  var userId = '__claim_test_user__';

  // Ensure no leftover claim
  await db.raw(
    'UPDATE schedule_queue SET claimed_by = NULL, claimed_at = NULL WHERE user_id = ?',
    [userId]
  ).catch(function() {});

  // Insert a fresh unclaimed queue row
  await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]);
  await db('schedule_queue').insert(__stampFixture({
    user_id: userId,
    source: 'test-race'
  }));

  // Two instances race — call tryClaim sequentially to simulate concurrent
  // reads that both saw claimed_by=NULL before either wrote.
  var result1 = await tryClaim(userId, 'instance-A');
  var result2 = await tryClaim(userId, 'instance-B');

  // Exactly one must have claimed; the other must not
  var wins = [result1.claimed, result2.claimed].filter(Boolean).length;
  var losses = [result1.claimed, result2.claimed].filter(function(c) { return !c; }).length;
  expect(wins).toBe(1);
  expect(losses).toBe(1);

  // The loser must report reason='already_claimed' (not 'no_row' or any other reason).
  // This catches a regression where the loser returns claimed:false for the wrong reason.
  var loser = result1.claimed ? result2 : result1;
  expect(loser.claimed).toBe(false);
  expect(loser.reason).toBe('already_claimed');

  // Cleanup
  await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]);
});

// ── Test 2: Stale reclaim ──────────────────────────────────────────────────
//
// A row with claimed_by='instance-old' and claimed_at 120s ago (past CLAIM_TTL_SECONDS=60)
// must be reclaimable by 'instance-new'. This is the crashed-instance recovery path.

test('fresh instance reclaims a stale claim past CLAIM_TTL_SECONDS', async function() {
  expect(typeof tryClaim).toBe('function');

  var userId = '__claim_test_user__';

  // Insert a row that looks like it was claimed 120s ago by a now-dead instance
  await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]);
  await db.raw(
    'INSERT INTO schedule_queue (user_id, source, claimed_by, claimed_at, created_by, updated_by) ' +
    'VALUES (?, ?, ?, DATE_SUB(NOW(), INTERVAL 120 SECOND), ?, ?)',
    [userId, 'test-stale', 'instance-old', 'jest', 'jest']
  );

  // Verify the stale claim is present
  var before = await db('schedule_queue').where('user_id', userId).first();
  expect(before.claimed_by).toBe('instance-old');

  // Fresh instance attempts to reclaim — should succeed because claimed_at is expired
  var result = await tryClaim(userId, 'instance-new');
  expect(result.claimed).toBe(true);

  // Verify claimed_by was updated to the new instance
  var after = await db('schedule_queue').where('user_id', userId).first();
  expect(after.claimed_by).toBe('instance-new');

  // Cleanup
  await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]);
});

// ── Test 3: Release ────────────────────────────────────────────────────────
//
// After releaseClaim is called, claimed_by and claimed_at are NULL.
// A subsequent tryClaim for the same user then succeeds without waiting for TTL.
// This verifies the normal happy-path: run completes → claim released → next
// enqueue cycle picks up cleanly.

test('released claim allows immediate re-claim (no TTL wait)', async function() {
  expect(typeof tryClaim).toBe('function');
  expect(typeof releaseClaim).toBe('function');

  var userId = '__claim_test_user__';

  // Insert fresh unclaimed row
  await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]);
  await db('schedule_queue').insert(__stampFixture({
    user_id: userId,
    source: 'test-release'
  }));

  // Claim it
  var claim1 = await tryClaim(userId, 'instance-C');
  expect(claim1.claimed).toBe(true);

  // Release it (simulates processUser completing)
  await releaseClaim(userId, 'instance-C');

  // Verify the row is now unclaimed
  var row = await db('schedule_queue').where('user_id', userId).first();
  expect(row).toBeTruthy();
  expect(row.claimed_by).toBeNull();
  expect(row.claimed_at).toBeNull();

  // Another claim should succeed immediately (no TTL wait needed)
  var claim2 = await tryClaim(userId, 'instance-D');
  expect(claim2.claimed).toBe(true);

  // Cleanup
  await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]);
});

// ── Test 4: no_row branch ──────────────────────────────────────────────────
//
// tryClaim for a userId that has no schedule_queue row (but the user exists in users)
// must return { claimed: false, reason: 'no_row' }.
// This covers the branch at scheduleQueue.js:183 — missed by Tests 1–3 which always
// seed a row before calling tryClaim.

test('tryClaim returns claimed:false reason:no_row when no schedule_queue row exists', async function() {
  expect(typeof tryClaim).toBe('function');

  var userId = '__claim_test_user__';

  // Ensure no schedule_queue row exists for this user
  await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]);

  // Verify the row is truly absent (sanity check)
  var absent = await db('schedule_queue').where('user_id', userId).first();
  expect(absent).toBeUndefined();

  var result = await tryClaim(userId, 'instance-E');
  expect(result.claimed).toBe(false);
  expect(result.reason).toBe('no_row');

  // No cleanup needed — no row was inserted
});

// ── Test 5: ClockPort-driven TTL expiry (999.1195) ─────────────────────────
//
// Same crashed-instance recovery contract as Test 2, but driven ENTIRELY by an
// injected FakeClockAdapter on the legacy path — no raw-SQL timestamp
// backdating, no real waiting, no global-Date monkeypatching. Before 999.1195
// tryClaim read new Date() / Date.now() directly, so this scenario could only
// be simulated by hand-editing rows (Test 2) or patching the global Date
// (the false-green trap).

test('FakeClockAdapter drives claim TTL expiry deterministically (no SQL backdating)', async function() {
  var FakeClockAdapter = require('../src/slices/scheduler/adapters/FakeClockAdapter');
  var setClockPort = (scheduleQueue._internal || {}).setClockPort;
  expect(typeof setClockPort).toBe('function');

  var userId = '__claim_test_user__';
  var fake = new FakeClockAdapter({ startTime: '2026-01-15T12:00:00Z' });
  setClockPort(fake);
  try {
    await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]);
    await db('schedule_queue').insert(__stampFixture({ user_id: userId, source: 'test-fake-clock' }));

    // instance-A claims at fake T0 — claimed_at is stamped FROM the fake clock.
    var claimA = await tryClaim(userId, 'instance-A');
    expect(claimA.claimed).toBe(true);

    // 1s inside the TTL: a second instance must lose, deterministically.
    fake.advance((CLAIM_TTL_SECONDS - 1) * 1000);
    var early = await tryClaim(userId, 'instance-B');
    expect(early.claimed).toBe(false);
    expect(early.reason).toBe('already_claimed');

    // Cross the TTL boundary (fake clock only — no sleep): now reclaimable.
    fake.advance(2 * 1000); // T0 + CLAIM_TTL + 1s
    var late = await tryClaim(userId, 'instance-B');
    expect(late.claimed).toBe(true);

    var after = await db('schedule_queue').where('user_id', userId).first();
    expect(after.claimed_by).toBe('instance-B');
  } finally {
    setClockPort(null); // restore the production MysqlClockAdapter
    await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]);
  }
});

// ── Test 6: ClockPort-driven debounce boundary (999.1195) ──────────────────
//
// The processUser quiet-period gate previously mixed the injectable _now()
// (enqueue stamps) with bare Date.now() (the debounce comparison), so the
// boundary could only be tested with real sleeps or Date monkeypatching. With
// both sides on the ClockPort the remaining-wait math is EXACT under a fake
// clock.

test('FakeClockAdapter drives the debounce quiet-period boundary math exactly', async function() {
  var FakeClockAdapter = require('../src/slices/scheduler/adapters/FakeClockAdapter');
  var internals = scheduleQueue._internal || {};
  expect(typeof internals.setClockPort).toBe('function');
  expect(typeof internals.DEBOUNCE_MS).toBe('number');

  var userId = '__claim_test_user__';
  var fake = new FakeClockAdapter({ startTime: '2026-01-15T12:00:00Z' });
  internals.setClockPort(fake);
  try {
    await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]);
    // Simulate an enqueue at fake T0 (production stamps this map via _now()).
    scheduleQueue._lastEnqueueTime.set(userId, fake.now().getTime());

    // 500ms into the quiet period: refused, with the EXACT remaining wait.
    fake.advance(500);
    var r1 = await scheduleQueue.processUser(userId);
    expect(r1).toEqual({ ran: false, reason: 'debounce', wait: internals.DEBOUNCE_MS - 500 });

    // Cross the boundary: the debounce gate opens and processUser proceeds to
    // the claim path; no queue row exists, so no_row proves the gate passed.
    fake.advance(internals.DEBOUNCE_MS); // T0 + DEBOUNCE_MS + 500
    var r2 = await scheduleQueue.processUser(userId);
    expect(r2.ran).toBe(false);
    expect(r2.reason).toBe('no_row');
  } finally {
    internals.setClockPort(null); // restore the production MysqlClockAdapter
    scheduleQueue._lastEnqueueTime.delete(userId);
  }
});

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
 * Uses the real MySQL test DB when available; skips automatically otherwise.
 * DB ops use raw SQL to backdate timestamps — same pattern as syncLockStartup.test.js.
 *
 * RED phase: these tests FAIL until scheduleQueue.js implements tryClaim / releaseClaim.
 */
process.env.NODE_ENV = 'test';

var testDb = require('./helpers/testDb');

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
  hasDb = await testDb.isAvailable();
  if (hasDb) {
    db = testDb.getDb();

    // Seed a test user (schedule_queue has FK to users)
    var userId = '__claim_test_user__';
    await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]);
    await db('users').where('id', userId).del();
    await db('users').insert({
      id: userId,
      email: 'claim-test@test.com',
      name: 'Claim Test User',
      timezone: 'America/New_York',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
  }

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

function maybeTest(name, fn, timeout) {
  return (hasDb ? test : test.skip)(name, fn, timeout || 10000);
}

// ── Test 1: Race prevention ───────────────────────────────────────────────
//
// Two "instances" call tryClaim for the same userId back-to-back.
// Because the first claim atomically sets claimed_by, the second must lose.
// This simulates the poll tick racing between two Cloud Run replicas.

maybeTest('only one of two concurrent claim attempts wins', async function() {
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
  await db('schedule_queue').insert({
    user_id: userId,
    source: 'test-race'
  });

  // Two instances race — call tryClaim sequentially to simulate concurrent
  // reads that both saw claimed_by=NULL before either wrote.
  var result1 = await tryClaim(userId, 'instance-A');
  var result2 = await tryClaim(userId, 'instance-B');

  // Exactly one must have claimed; the other must not
  var wins = [result1.claimed, result2.claimed].filter(Boolean).length;
  var losses = [result1.claimed, result2.claimed].filter(function(c) { return !c; }).length;
  expect(wins).toBe(1);
  expect(losses).toBe(1);

  // Cleanup
  await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]);
});

// ── Test 2: Stale reclaim ──────────────────────────────────────────────────
//
// A row with claimed_by='instance-old' and claimed_at 120s ago (past CLAIM_TTL_SECONDS=60)
// must be reclaimable by 'instance-new'. This is the crashed-instance recovery path.

maybeTest('fresh instance reclaims a stale claim past CLAIM_TTL_SECONDS', async function() {
  expect(typeof tryClaim).toBe('function');

  var userId = '__claim_test_user__';

  // Insert a row that looks like it was claimed 120s ago by a now-dead instance
  await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]);
  await db.raw(
    'INSERT INTO schedule_queue (user_id, source, claimed_by, claimed_at) ' +
    'VALUES (?, ?, ?, DATE_SUB(NOW(), INTERVAL 120 SECOND))',
    [userId, 'test-stale', 'instance-old']
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

maybeTest('released claim allows immediate re-claim (no TTL wait)', async function() {
  expect(typeof tryClaim).toBe('function');
  expect(typeof releaseClaim).toBe('function');

  var userId = '__claim_test_user__';

  // Insert fresh unclaimed row
  await db.raw('DELETE FROM schedule_queue WHERE user_id = ?', [userId]);
  await db('schedule_queue').insert({
    user_id: userId,
    source: 'test-release'
  });

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

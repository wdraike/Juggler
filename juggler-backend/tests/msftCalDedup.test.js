/**
 * FIX-03: DB-backed OAuth code dedup tests for msft-cal.controller.js
 *
 * Verifies that markCodeUsed() is safe at N Cloud Run instances:
 *   1. First call wins, duplicate call returns false.
 *   2. Cross-instance simulation — dedup row is in the DB, not instance memory.
 *   3. TTL expiry — expired rows are swept before INSERT IGNORE; the code
 *      is reclaimable once the sweep removes the stale row.
 *
 * Uses the real MySQL test DB (TEST-FR-001: fails loud when unavailable).
 * DB ops use raw SQL to backdate expires_at — same pattern as syncLockStartup.test.js.
 *
 * RED phase: these tests FAIL until msft-cal.controller.js replaces the
 * in-memory usedCodes Set with the DB-backed markCodeUsed() implementation.
 *
 * Reference: RESEARCH.md Category 4g + Pitfall 5
 */
process.env.NODE_ENV = 'test';

var testDb = require('./helpers/testDb');
var crypto = require('crypto');
var { assertDbAvailable } = require('./helpers/requireDB');

var db;

// ── Helper: compute the hash markCodeUsed() stores ───────────────────────
// Must match the exact computation in msft-cal.controller.js so tests can
// inspect / backdate rows to simulate TTL expiry.
function codeHash(code) {
  var key = code.substring(0, 40);
  return crypto.createHash('sha256').update(key).digest('hex');
}

// ── markCodeUsed() imported from the module under test ────────────────────
// The controller doesn't export markCodeUsed() directly, but we can exercise
// it via the exported callback handler — however, that would require wiring
// the full HTTP stack. Instead we test the DB contract directly.
//
// Approach:
//   - Import the controller module so its module-level side effects run.
//   - Invoke the DB directly to verify the oauth_code_nonces table interaction.
//   - For Tests 1 and 2, call the controller's markCodeUsed via the _internal
//     export if present; otherwise fall back to calling db.raw directly so we
//     can test both sides of the contract.
//
// Note: markCodeUsed is not exported from msft-cal.controller.js by default.
// Test 1 and 2 will verify the behaviour by inspecting DB rows after calling
// the real HTTP handler callback or by exercising the internal function.
// We expose it via a test-only export when the module is loaded in test mode.
// If the controller does NOT export _internal.markCodeUsed, the tests will
// fail with a clear message (the expected RED state before implementation).

var controller;
var markCodeUsed;

beforeAll(async function() {
  await assertDbAvailable(testDb.isAvailable);
  db = testDb.getDb();

  // Ensure the oauth_code_nonces table exists (migration must have run)
  await db.raw('SELECT 1 FROM oauth_code_nonces LIMIT 1');

  // Clean slate for our test codes
  await db.raw("DELETE FROM oauth_code_nonces WHERE code_hash LIKE 'test-%'").catch(function() {});

  // Import the controller.  In RED state the in-memory Set is still present;
  // the _internal export will not exist and markCodeUsed will be undefined.
  controller = require('../src/controllers/msft-cal.controller');
  markCodeUsed = controller._internal && controller._internal.markCodeUsed;
});

afterAll(async function() {
  await testDb.destroy();
});

// ── Test 1: First call wins; duplicate call on same instance returns false ──
//
// Simulates the normal single-instance case: browser sends the callback once,
// markCodeUsed returns true. If the browser sends it again (same instance),
// markCodeUsed must return false (the DB row is already there).

test('first markCodeUsed call returns true; duplicate on same instance returns false', async function() {
  // RED check: markCodeUsed must be exported for direct testing
  expect(typeof markCodeUsed).toBe('function');

  var code = 'test-code-dedup-first-' + Date.now();

  // First call: should insert a nonce row and return true
  var first = await markCodeUsed(code);
  expect(first).toBe(true);

  // Verify the row is in the DB
  var hash = codeHash(code);
  var row = await db('oauth_code_nonces').where('code_hash', hash).first();
  expect(row).toBeTruthy();
  expect(row.code_hash).toBe(hash);

  // Second call (same code, same instance): INSERT IGNORE finds the row, returns false
  var second = await markCodeUsed(code);
  expect(second).toBe(false);

  // Cleanup
  await db('oauth_code_nonces').where('code_hash', hash).del();
});

// ── Test 2: Cross-instance simulation ─────────────────────────────────────
//
// "Instance A" calls markCodeUsed and succeeds (true). Then a fresh require()
// of the controller module — simulating "Instance B" with a separate module
// registry and no in-memory state — calls markCodeUsed for the same code.
// Because the dedup is in the DB, Instance B must return false.
//
// This is the critical multi-server scenario: load balancer routes the
// browser's retry to a different Cloud Run pod. The in-memory Set on the old
// implementation would have MISSED this; the DB row does not.

test('cross-instance dedup: Instance B returns false for a code already used by Instance A', async function() {
  expect(typeof markCodeUsed).toBe('function');

  var code = 'test-code-cross-instance-' + Date.now();

  // "Instance A" claims the code
  var instanceA = await markCodeUsed(code);
  expect(instanceA).toBe(true);

  // Simulate "Instance B" by requiring a fresh (isolated) copy of the controller.
  // jest.isolateModules creates a fresh module registry for the callback.
  var instanceBResult;
  await new Promise(function(resolve, reject) {
    jest.isolateModules(function() {
      try {
        var controllerB = require('../src/controllers/msft-cal.controller');
        var markCodeUsedB = controllerB._internal && controllerB._internal.markCodeUsed;
        if (typeof markCodeUsedB !== 'function') {
          reject(new Error('_internal.markCodeUsed not exported from controller (expected RED failure)'));
          return;
        }
        markCodeUsedB(code).then(function(result) {
          instanceBResult = result;
          resolve();
        }).catch(reject);
      } catch (e) {
        reject(e);
      }
    });
  });

  // Instance B must return false — the DB row inserted by Instance A is the gate
  expect(instanceBResult).toBe(false);

  // Cleanup
  var hash = codeHash(code);
  await db('oauth_code_nonces').where('code_hash', hash).del();
});

// ── Test 3: TTL expiry — sweep removes stale row, new call succeeds ────────
//
// Insert a row with expires_at already in the past. When markCodeUsed is called
// for the same code, the sweep (DELETE WHERE expires_at < NOW()) removes the
// stale row before the INSERT IGNORE. The INSERT IGNORE succeeds with
// affectedRows=1, and markCodeUsed returns true.
//
// This verifies the sweep-before-insert pattern handles the TTL-expiry case.

test('markCodeUsed sweeps expired rows and succeeds for the same code hash', async function() {
  expect(typeof markCodeUsed).toBe('function');

  var code = 'test-code-ttl-expiry-' + Date.now();
  var hash = codeHash(code);

  // Pre-seed a row that is already expired (1 minute in the past)
  await db.raw(
    'DELETE FROM oauth_code_nonces WHERE code_hash = ?',
    [hash]
  );
  await db.raw(
    'INSERT INTO oauth_code_nonces (code_hash, expires_at) ' +
    'VALUES (?, DATE_SUB(NOW(), INTERVAL 1 MINUTE))',
    [hash]
  );

  // Verify the stale row is there before we call markCodeUsed
  var before = await db('oauth_code_nonces').where('code_hash', hash).first();
  expect(before).toBeTruthy();

  // markCodeUsed must sweep the expired row and then succeed (true)
  var result = await markCodeUsed(code);
  expect(result).toBe(true);

  // Verify the fresh row now exists (expires_at > NOW())
  var after = await db('oauth_code_nonces').where('code_hash', hash).first();
  expect(after).toBeTruthy();
  // expires_at should be in the future
  var expiresAt = new Date(after.expires_at);
  expect(expiresAt.getTime()).toBeGreaterThan(Date.now() - 5000); // Allow 5s clock skew

  // Cleanup
  await db('oauth_code_nonces').where('code_hash', hash).del();
});

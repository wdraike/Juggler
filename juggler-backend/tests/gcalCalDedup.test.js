/**
 * 999.992: DB-backed OAuth code dedup tests for gcal.controller.js
 *
 * Mirrors tests/msftCalDedup.test.js (the proven pattern for this exact
 * dedup behavior, applied to msftCallback/msftMarkCodeUsed in
 * src/slices/calendar/facade.js). gcalCallback has NO replay guard today —
 * a captured auth code can be re-exchanged within its window. This test
 * pins the same DB-backed dedup contract for the gcal path:
 *
 *   1. First call wins, duplicate call returns false.
 *   2. Cross-instance simulation — dedup row is in the DB, not instance memory.
 *   3. TTL expiry — expired rows are swept before INSERT IGNORE; the code
 *      is reclaimable once the sweep removes the stale row.
 *
 * Uses the real MySQL test DB (TEST-FR-001: fails loud when unavailable).
 * DB ops use raw SQL to backdate expires_at — same pattern as
 * msftCalDedup.test.js / syncLockStartup.test.js.
 *
 * RED phase (999.992, pre-fix): these tests FAIL because:
 *   - src/slices/calendar/facade.js has no `gcalMarkCodeUsed` function/export.
 *   - src/controllers/gcal.controller.js has no `_internal` export at all
 *     (msft-cal.controller.js exports `_internal: { markCodeUsed: facade.msftMarkCodeUsed }`;
 *     gcal.controller.js has no analogous line).
 *   - gcalCallback (facade.js ~L172) calls gcalApi.getTokensFromCode with NO
 *     markCodeUsed precondition at all — the bug this leg fixes.
 *
 * Intended fix (bert, this leg):
 *   - facade.js: add `gcalMarkCodeUsed(code)` mirroring `msftMarkCodeUsed`
 *     (sha256 of code.substring(0,40); sweep expired rows; INSERT IGNORE;
 *     return affectedRows === 1); call it at the top of gcalCallback (after
 *     the missing-param check, before getTokensFromCode); short-circuit with
 *     a 302 redirect to `frontendUrl + '/?gcal=connected'` on duplicate
 *     (no re-exchange). Export `gcalMarkCodeUsed` from facade.js module.exports.
 *   - gcal.controller.js: add `_internal: { markCodeUsed: facade.gcalMarkCodeUsed }`
 *     to module.exports, mirroring msft-cal.controller.js exactly.
 *
 * Reference: tests/msftCalDedup.test.js; WBS-jug992 W1; TRACEABILITY-jug992 BUG-992.
 */
process.env.NODE_ENV = 'test';

// ── jug992 re-review (zoe mutation BLOCK): mock ONLY gcal-api ────────────
// Tests 1-4 below call gcalMarkCodeUsed/markCodeUsed DIRECTLY via _internal —
// they pin the dedup HELPER's contract but never exercise gcalCallback's own
// duplicate-code short-circuit branch (facade.js ~L191-195). zoe proved this
// with a mutation: setting that guard to `if (false)` left the whole suite
// green, because nothing in this file called gcalCallback() itself.
//
// Test 5 (bottom of this file) closes that gap by calling facade.gcalCallback()
// — the real wiring — directly, twice, with the same code. gcal-api is mocked
// so the assertion can count token-exchange calls without a live Google OAuth
// round-trip; lib/db is intentionally NOT mocked, so Test 5 still exercises
// the SAME real test-bed oauth_code_nonces table Tests 1-4 use — a true
// end-to-end run of the callback, not a db-mock simulation of it. Mocking
// gcal-api here is safe for Tests 1-4: none of them ever touch gcalApi (they
// call markCodeUsed directly), so this mock is inert for the rest of the file.
jest.mock('../src/lib/gcal-api', () => ({
  createOAuth2Client: jest.fn(() => ({})),
  getAuthUrl: jest.fn(),
  getTokensFromCode: jest.fn(() => Promise.resolve({
    access_token: 'mock-at-' + Date.now(),
    refresh_token: 'mock-rt',
    expiry_date: Date.now() + 3600000
  }))
}));

var testDb = require('./helpers/testDb');
var crypto = require('crypto');
var { assertDbAvailable } = require('./helpers/requireDB');

var db;

// ── Helper: compute the hash gcalMarkCodeUsed() must store ───────────────
// Must match the exact computation in facade.js's gcalMarkCodeUsed (mirrors
// msftMarkCodeUsed) so tests can inspect / backdate rows to simulate TTL expiry.
function codeHash(code) {
  var key = code.substring(0, 40);
  return crypto.createHash('sha256').update(key).digest('hex');
}

// ── markCodeUsed() imported from the module under test ────────────────────
// gcal.controller.js does not export markCodeUsed() by default (pre-fix).
// We reach it via the same `_internal` test-only export pattern
// msft-cal.controller.js already uses for facade.msftMarkCodeUsed. If
// gcal.controller.js does NOT export _internal.markCodeUsed, these tests
// fail with a clear message — the expected RED state before the fix lands.

var controller;
var markCodeUsed;

beforeAll(async function() {
  await assertDbAvailable(testDb.isAvailable);
  db = testDb.getDb();

  // Ensure the oauth_code_nonces table exists (migration must have run;
  // shared table — already used by msftMarkCodeUsed, no new migration needed)
  await db.raw('SELECT 1 FROM oauth_code_nonces LIMIT 1');

  // Clean slate for our test codes
  await db.raw("DELETE FROM oauth_code_nonces WHERE code_hash LIKE 'test-%'").catch(function() {});

  controller = require('../src/controllers/gcal.controller');
  markCodeUsed = controller._internal && controller._internal.markCodeUsed;
});

afterAll(async function() {
  await testDb.destroy();
});

// ── Test 1: First call wins; duplicate call on same instance returns false ──
test('first gcalMarkCodeUsed call returns true; duplicate on same instance returns false', async function() {
  // RED check: markCodeUsed must be exported for direct testing
  expect(typeof markCodeUsed).toBe('function');

  var code = 'test-code-gcal-dedup-first-' + Date.now();

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
// Because the dedup is in the DB, Instance B must return false. This is the
// critical multi-server scenario: load balancer routes the browser's retry
// to a different Cloud Run pod.

test('cross-instance dedup: Instance B returns false for a gcal code already used by Instance A', async function() {
  expect(typeof markCodeUsed).toBe('function');

  var code = 'test-code-gcal-cross-instance-' + Date.now();

  // "Instance A" claims the code
  var instanceA = await markCodeUsed(code);
  expect(instanceA).toBe(true);

  // Simulate "Instance B" by requiring a fresh (isolated) copy of the controller.
  var instanceBResult;
  await new Promise(function(resolve, reject) {
    jest.isolateModules(function() {
      try {
        var controllerB = require('../src/controllers/gcal.controller');
        var markCodeUsedB = controllerB._internal && controllerB._internal.markCodeUsed;
        if (typeof markCodeUsedB !== 'function') {
          reject(new Error('_internal.markCodeUsed not exported from gcal.controller (expected RED failure)'));
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
test('gcalMarkCodeUsed sweeps expired rows and succeeds for the same code hash', async function() {
  expect(typeof markCodeUsed).toBe('function');

  var code = 'test-code-gcal-ttl-expiry-' + Date.now();
  var hash = codeHash(code);

  // Pre-seed a row that is already expired (1 minute in the past)
  await db.raw(
    'DELETE FROM oauth_code_nonces WHERE code_hash = ?',
    [hash]
  );
  await db.raw(
    'INSERT INTO oauth_code_nonces (code_hash, expires_at, created_by, updated_by) ' +
    'VALUES (?, DATE_SUB(NOW(), INTERVAL 1 MINUTE), ?, ?)',
    [hash, 'jest', 'jest']
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
  var expiresAt = new Date(after.expires_at);
  expect(expiresAt.getTime()).toBeGreaterThan(Date.now() - 5000); // Allow 5s clock skew

  // Cleanup
  await db('oauth_code_nonces').where('code_hash', hash).del();
});

// ── Test 4: msft path is unchanged (acceptance criterion (4)) ─────────────
//
// The gcal fix must not alter msftCallback/msftMarkCodeUsed behavior. Pin
// that the existing msft dedup contract still holds via the same _internal
// surface msft-cal.controller.js already exposes — a regression here would
// mean the gcal fix touched shared code in a way that broke the sibling.

test('msft dedup contract is unaffected by the gcal fix (acceptance criterion 4)', async function() {
  var msftController = require('../src/controllers/msft-cal.controller');
  var msftMarkCodeUsed = msftController._internal && msftController._internal.markCodeUsed;
  expect(typeof msftMarkCodeUsed).toBe('function');

  var code = 'test-code-msft-unaffected-' + Date.now();
  var first = await msftMarkCodeUsed(code);
  expect(first).toBe(true);
  var second = await msftMarkCodeUsed(code);
  expect(second).toBe(false);

  var hash = codeHash(code);
  await db('oauth_code_nonces').where('code_hash', hash).del();
});

// ── Test 5: CALLBACK-LEVEL — pins the security branch inside gcalCallback ──
//
// THIS is the assertion that closes zoe's mutation BLOCK (jug992 re-review).
// Tests 1-4 above pin gcalMarkCodeUsed/markCodeUsed in isolation; this test
// calls facade.gcalCallback() itself — the real wiring a browser retry/replay
// would hit — twice with the SAME code, and asserts the duplicate NEVER
// reaches gcalApi.getTokensFromCode a second time. If the guard at
// facade.js:191 (`if (!(await gcalMarkCodeUsed(code))) { ...return 302... }`)
// is removed or short-circuited to `if (false)`, getTokensFromCode is called
// TWICE and this test goes RED (mutation-verified — see TEST-REVIEW.md for
// the captured RED output).

describe('gcalCallback — callback-level duplicate-code short-circuit (security branch)', function() {
  var facade;
  var gcalApi;
  var SignJWT;
  // Same default-secret computation as facade.js's getJwtSecret(): reads
  // process.env.JWT_SECRET, falls back to the known local-dev default when
  // unset (non-production). No .env.test in this repo sets JWT_SECRET.
  var TEST_JWT_SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET || 'local-dev-jwt-secret-juggler');

  beforeAll(function() {
    facade = require('../src/slices/calendar/facade');
    gcalApi = require('../src/lib/gcal-api');
    SignJWT = require('jose').SignJWT;
  });

  beforeEach(function() {
    gcalApi.getTokensFromCode.mockClear();
  });

  test('first call proceeds to token exchange; duplicate call short-circuits without re-exchange', async function() {
    var testUserId = 'test-user-gcal-callback-dedup';
    var code = 'test-code-gcal-callback-dedup-' + Date.now();
    var reqUser = { id: testUserId };

    var state = await new SignJWT({ userId: testUserId })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(TEST_JWT_SECRET_KEY);

    // ── (1) First call: fresh code → proceeds to exchange ──
    var first = await facade.gcalCallback(code, state, reqUser);
    expect(gcalApi.getTokensFromCode).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(302);
    expect(first.redirect).toMatch(/\?gcal=connected/);

    // ── (2) Second call: SAME code → must short-circuit, no re-exchange ──
    var second = await facade.gcalCallback(code, state, reqUser);
    expect(gcalApi.getTokensFromCode).toHaveBeenCalledTimes(1); // still 1 — pinned
    expect(second.status).toBe(302);
    expect(second.redirect).toMatch(/\?gcal=connected/);

    // Cleanup the dedup row this test created
    var hash = codeHash(code);
    await db('oauth_code_nonces').where('code_hash', hash).del();
  });
});

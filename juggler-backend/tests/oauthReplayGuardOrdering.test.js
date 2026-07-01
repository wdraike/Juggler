/**
 * 999.993 (leg jug993): trust-check-vs-nonce-burn ORDERING guard.
 *
 * gcalCallback (src/slices/calendar/facade.js ~L186) and msftCallback (~L330)
 * currently call the replay-nonce DB write (gcalMarkCodeUsed/msftMarkCodeUsed)
 * BEFORE verifyStateToken(state) and BEFORE the reqUser-match check. That means
 * an unauthenticated/forged-state request — or a valid-state request replayed
 * by the wrong authenticated user — still BURNS an oauth_code_nonces row before
 * being rejected. A subsequent legitimate request with the correct state/user
 * would then find its own code already "used" by the attacker's probe (nonce
 * exhaustion / unauthorized write-amplification).
 *
 * RED phase (pre-fix, this leg): the two "no nonce burned" assertions below
 * FAIL on current code — the nonce row IS inserted before the 400/403 is
 * returned. Root cause: markCodeUsed() runs first; verifyStateToken() +
 * user-match run second. Fix (bert, NOT this file): reorder so
 * verifyStateToken + user-match run BEFORE markCodeUsed.
 *
 * GREEN-and-must-stay-GREEN (regression guards): fresh code + valid state →
 * 302 connected + exactly 1 nonce row; duplicate code replay → 302
 * short-circuit with NO re-exchange. These prove the reorder preserves the
 * replay-guard's own contract (jug992) while fixing the ordering bug.
 *
 * Seam: extends tests/gcalCalDedup.test.js's callback-level pattern (Test 5)
 * — calls facade.gcalCallback()/facade.msftCallback() directly (the real
 * wiring), against the real test-bed oauth_code_nonces table, with only the
 * external OAuth token-exchange calls (gcalApi/msftCalApi) and the state-JWT
 * verification (verifyStateToken) mocked out — no real network calls, no
 * dependency on jose's exact reject-message shape.
 *
 * Reference: WBS-jug993 W1/W2; TRACEABILITY-jug993 BUG-993.
 */
process.env.NODE_ENV = 'test';

// ── Mock external OAuth token-exchange APIs — no real network calls ────────
jest.mock('../src/lib/gcal-api', () => ({
  createOAuth2Client: jest.fn(() => ({})),
  getAuthUrl: jest.fn(),
  getTokensFromCode: jest.fn(() => Promise.resolve({
    access_token: 'mock-at-' + Date.now(),
    refresh_token: 'mock-rt',
    expiry_date: Date.now() + 3600000
  }))
}));

jest.mock('../src/lib/msft-cal-api', () => ({
  generatePkce: jest.fn(() => ({ codeVerifier: 'mock-cv', codeChallenge: 'mock-cc' })),
  getAuthUrl: jest.fn(),
  getTokensFromCode: jest.fn(() => Promise.resolve({
    accessToken: 'mock-msft-at-' + Date.now(),
    refreshToken: 'mock-msft-rt',
    expiresOn: Date.now() + 3600000
  })),
  getUserInfo: jest.fn(() => Promise.resolve({ email: 'mock-msft-user@example.com' }))
}));

// ── Mock verifyStateToken so RED/GREEN state is controlled deterministically
// (no dependency on jose's exact throw shape for a "forged" state) — getJwtSecret
// stays real (unused by these tests directly, but keeps the module shape intact).
var mockVerifyStateToken = jest.fn();
jest.mock('../src/lib/jwt-secret', () => {
  var actual = jest.requireActual('../src/lib/jwt-secret');
  return {
    getJwtSecret: actual.getJwtSecret,
    verifyStateToken: function() { return mockVerifyStateToken.apply(null, arguments); }
  };
});

var testDb = require('./helpers/testDb');
var crypto = require('crypto');
var { assertDbAvailable } = require('./helpers/requireDB');

var db;
var facade;
var gcalApi;
var msftCalApi;

function codeHash(code) {
  var key = code.substring(0, 40);
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function nonceRowCount(code) {
  var hash = codeHash(code);
  var rows = await db('oauth_code_nonces').where('code_hash', hash);
  return rows.length;
}

async function cleanupCode(code) {
  var hash = codeHash(code);
  await db('oauth_code_nonces').where('code_hash', hash).del();
}

beforeAll(async function() {
  await assertDbAvailable(testDb.isAvailable);
  db = testDb.getDb();
  await db.raw('SELECT 1 FROM oauth_code_nonces LIMIT 1');
  await db.raw("DELETE FROM oauth_code_nonces WHERE code_hash LIKE 'test-%'").catch(function() {});

  facade = require('../src/slices/calendar/facade');
  gcalApi = require('../src/lib/gcal-api');
  msftCalApi = require('../src/lib/msft-cal-api');
});

afterAll(async function() {
  await testDb.destroy();
});

beforeEach(function() {
  mockVerifyStateToken.mockReset();
  gcalApi.getTokensFromCode.mockClear();
  msftCalApi.getTokensFromCode.mockClear();
});

// ═══════════════════════════════════════════════════════════════════════
// gcalCallback (W1)
// ═══════════════════════════════════════════════════════════════════════
describe('gcalCallback — trust-check ordering (999.993, W1)', function() {
  test('BUG-993 W1(1): forged/invalid state -> 400 AND no nonce burned', async function() {
    var code = 'test-code-gcal-badstate-' + Date.now();
    var reqUser = { id: 'test-user-gcal-badstate' };

    mockVerifyStateToken.mockRejectedValue(new Error('forged/invalid state signature'));

    var beforeCount = await nonceRowCount(code);
    expect(beforeCount).toBe(0);

    var res = await facade.gcalCallback(code, 'forged-state-value', reqUser);

    expect(res.status).toBe(400);
    expect(res.body).toMatch(/Invalid or expired state parameter/);

    // RED on current code: markCodeUsed runs BEFORE verifyStateToken, so a
    // row is inserted for this code even though the state was rejected.
    var afterCount = await nonceRowCount(code);
    expect(afterCount).toBe(0);

    await cleanupCode(code);
  });

  test('BUG-993 W1(2): valid state, wrong authenticated user -> 403 AND no nonce burned', async function() {
    var code = 'test-code-gcal-wronguser-' + Date.now();
    var stateOwnerId = 'test-user-gcal-owner';
    var reqUser = { id: 'test-user-gcal-attacker' };

    mockVerifyStateToken.mockResolvedValue({ payload: { userId: stateOwnerId } });

    var beforeCount = await nonceRowCount(code);
    expect(beforeCount).toBe(0);

    var res = await facade.gcalCallback(code, 'valid-state-value', reqUser);

    expect(res.status).toBe(403);
    expect(res.body).toMatch(/does not match authenticated user/);

    // RED on current code: markCodeUsed runs BEFORE the user-match check, so
    // a row is inserted for this code even though the requester was rejected.
    var afterCount = await nonceRowCount(code);
    expect(afterCount).toBe(0);

    await cleanupCode(code);
  });

  test('REGRESSION (stay GREEN): valid state, matching user, fresh code -> 302 connected + exactly 1 nonce row', async function() {
    var code = 'test-code-gcal-fresh-' + Date.now();
    var userId = 'test-user-gcal-fresh';
    var reqUser = { id: userId };

    mockVerifyStateToken.mockResolvedValue({ payload: { userId: userId } });

    var res = await facade.gcalCallback(code, 'valid-state-value', reqUser);

    expect(res.status).toBe(302);
    expect(res.redirect).toMatch(/\?gcal=connected/);
    expect(gcalApi.getTokensFromCode).toHaveBeenCalledTimes(1);

    var count = await nonceRowCount(code);
    expect(count).toBe(1);

    await cleanupCode(code);
  });

  test('REGRESSION (stay GREEN): duplicate code replay -> 302 short-circuit, no re-exchange', async function() {
    var code = 'test-code-gcal-dup-' + Date.now();
    var userId = 'test-user-gcal-dup';
    var reqUser = { id: userId };

    mockVerifyStateToken.mockResolvedValue({ payload: { userId: userId } });

    var first = await facade.gcalCallback(code, 'valid-state-value', reqUser);
    expect(first.status).toBe(302);
    expect(gcalApi.getTokensFromCode).toHaveBeenCalledTimes(1);

    var second = await facade.gcalCallback(code, 'valid-state-value', reqUser);
    expect(second.status).toBe(302);
    expect(second.redirect).toMatch(/\?gcal=connected/);
    // Still 1 — the duplicate must NOT re-exchange the code.
    expect(gcalApi.getTokensFromCode).toHaveBeenCalledTimes(1);

    var count = await nonceRowCount(code);
    expect(count).toBe(1);

    await cleanupCode(code);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// msftCallback (W2) — parity
// ═══════════════════════════════════════════════════════════════════════
describe('msftCallback — trust-check ordering (999.993, W2)', function() {
  test('BUG-993 W2(1): forged/invalid state -> 400 AND no nonce burned', async function() {
    var code = 'test-code-msft-badstate-' + Date.now();
    var reqUser = { id: 'test-user-msft-badstate' };

    mockVerifyStateToken.mockRejectedValue(new Error('forged/invalid state signature'));

    var beforeCount = await nonceRowCount(code);
    expect(beforeCount).toBe(0);

    var res = await facade.msftCallback(code, 'forged-state-value', reqUser);

    expect(res.status).toBe(400);
    expect(res.body).toMatch(/Invalid or expired state parameter/);

    // RED on current code: msftMarkCodeUsed runs BEFORE verifyStateToken, so
    // a row is inserted for this code even though the state was rejected.
    var afterCount = await nonceRowCount(code);
    expect(afterCount).toBe(0);

    await cleanupCode(code);
  });

  test('BUG-993 W2(2): valid state, wrong authenticated user -> 403 AND no nonce burned', async function() {
    var code = 'test-code-msft-wronguser-' + Date.now();
    var stateOwnerId = 'test-user-msft-owner';
    var reqUser = { id: 'test-user-msft-attacker' };

    mockVerifyStateToken.mockResolvedValue({ payload: { userId: stateOwnerId, cv: 'irrelevant-cv' } });

    var beforeCount = await nonceRowCount(code);
    expect(beforeCount).toBe(0);

    var res = await facade.msftCallback(code, 'valid-state-value', reqUser);

    expect(res.status).toBe(403);
    expect(res.body).toMatch(/does not match authenticated user/);

    // RED on current code: msftMarkCodeUsed runs BEFORE the user-match check,
    // so a row is inserted even though the requester was rejected.
    var afterCount = await nonceRowCount(code);
    expect(afterCount).toBe(0);

    await cleanupCode(code);
  });

  test('REGRESSION (stay GREEN): valid state, matching user, fresh code -> 302 connected + exactly 1 nonce row', async function() {
    var code = 'test-code-msft-fresh-' + Date.now();
    var userId = 'test-user-msft-fresh';
    var reqUser = { id: userId };

    mockVerifyStateToken.mockResolvedValue({ payload: { userId: userId, cv: 'test-code-verifier' } });

    var res = await facade.msftCallback(code, 'valid-state-value', reqUser);

    expect(res.status).toBe(302);
    expect(res.redirect).toMatch(/\?msftcal=connected/);
    expect(msftCalApi.getTokensFromCode).toHaveBeenCalledTimes(1);

    var count = await nonceRowCount(code);
    expect(count).toBe(1);

    await cleanupCode(code);
  });

  test('REGRESSION (stay GREEN): duplicate code replay -> 302 short-circuit, no re-exchange', async function() {
    var code = 'test-code-msft-dup-' + Date.now();
    var userId = 'test-user-msft-dup';
    var reqUser = { id: userId };

    mockVerifyStateToken.mockResolvedValue({ payload: { userId: userId, cv: 'test-code-verifier' } });

    var first = await facade.msftCallback(code, 'valid-state-value', reqUser);
    expect(first.status).toBe(302);
    expect(msftCalApi.getTokensFromCode).toHaveBeenCalledTimes(1);

    var second = await facade.msftCallback(code, 'valid-state-value', reqUser);
    expect(second.status).toBe(302);
    expect(second.redirect).toMatch(/\?msftcal=connected/);
    // Still 1 — the duplicate must NOT re-exchange the code.
    expect(msftCalApi.getTokensFromCode).toHaveBeenCalledTimes(1);

    var count = await nonceRowCount(code);
    expect(count).toBe(1);

    await cleanupCode(code);
  });

  test('REGRESSION (stay GREEN): valid state, matching user, missing PKCE code_verifier -> 400 (checked AFTER verify)', async function() {
    var code = 'test-code-msft-missingcv-' + Date.now();
    var userId = 'test-user-msft-missingcv';
    var reqUser = { id: userId };

    // No `cv` in the decoded payload — verify+user-match PASS, then the PKCE
    // guard must still fire (400), same as pre-fix, just now running after
    // the trust checks instead of after the nonce burn.
    mockVerifyStateToken.mockResolvedValue({ payload: { userId: userId } });

    var res = await facade.msftCallback(code, 'valid-state-value', reqUser);

    expect(res.status).toBe(400);
    expect(res.body).toMatch(/Missing PKCE code_verifier/);
    expect(msftCalApi.getTokensFromCode).not.toHaveBeenCalled();
    // The PKCE guard is a same-class trust check sitting ABOVE msftMarkCodeUsed,
    // so a missing-cv (still-unauthorized-to-proceed) request must NOT burn a
    // nonce either — pins the guard's position above the nonce write (zoe jug993).
    var pkceNonceCount = await nonceRowCount(code);
    expect(pkceNonceCount).toBe(0);

    await cleanupCode(code);
  });
});

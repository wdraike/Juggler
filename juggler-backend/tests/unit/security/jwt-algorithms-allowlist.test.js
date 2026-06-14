/**
 * Regression tests — JWT algorithm-allowlist hardening (ROADMAP 999.318)
 *
 * WHAT THESE TESTS PIN
 * ====================
 * Three jose jwtVerify call sites in juggler-backend accept only the correct
 * algorithm for each token class. The fix (bert/W2) added an `algorithms`
 * allowlist to each call and centralised the OAuth-state verify into a shared
 * helper.
 *
 *   AC1  jwt-auth.js:70 — verifyToken(token)
 *        jwtVerify(token, getJWKS(), { issuer:'raike-auth', algorithms:['RS256'] })
 *
 *   AC2  gcal.controller.js:92 + msft-cal.controller.js:123 — OAuth state verify
 *        Both controllers call verifyStateToken(state) from src/lib/jwt-secret.js.
 *        verifyStateToken = jwtVerify(state, getJwtSecret(), { algorithms:['HS256'] })
 *        These tests import the REAL verifyStateToken so they pin production code
 *        directly, not a local clone.
 *
 *   AC3  No regression — correctly-signed tokens (HS256 state, RS256 JWT) still verify.
 *
 * AC2 BEHAVIORAL PIN (post-fix, now GREEN)
 * =========================================
 * Before bert's fix the controllers called jwtVerify directly with no allowlist,
 * so HS384/HS512 tokens were accepted. After the fix, verifyStateToken includes
 * { algorithms: ['HS256'] } and jose throws ERR_JOSE_ALG_NOT_ALLOWED for any
 * other algorithm.
 *
 * The AC2 RED tests previously called a LOCAL clone (verifyStateTokenCurrentCode)
 * defined inside this file — that was a disconnected test that could never go GREEN
 * from bert's production fix. Those local clones are now DELETED. The tests now
 * import the real verifyStateToken from src/lib/jwt-secret and must be GREEN on
 * the fixed production code.
 *
 * COVERAGE BY SITE
 * ================
 * HS256 site (gcal.controller.js:92, msft-cal.controller.js:123):
 *   BEHAVIORAL — imports and calls the REAL verifyStateToken from src/lib/jwt-secret.
 *   Signing with HS384/HS512 → verifyStateToken must REJECT (ERR_JOSE_ALG_NOT_ALLOWED).
 *   Signing with HS256 → verifyStateToken must RESOLVE with the correct payload.
 *   This is NOT tautological — the allowlist lives in production code; removing
 *   { algorithms: ['HS256'] } from src/lib/jwt-secret.js makes AC2-REJECT-1/2 fail.
 *
 * RS256 site (jwt-auth.js:70 — verifyToken):
 *   PRINCIPLE-LEVEL — verifyToken uses a remote JWKS (createRemoteJWKSet) which
 *   is not reachable in unit tests. We generate a local RS keypair and mirror the
 *   exact production verify shape: jwtVerify(token, key, { issuer:'raike-auth' })
 *   (pre-fix) vs jwtVerify(token, key, { issuer:'raike-auth', algorithms:['RS256'] })
 *   (post-fix). The test proves the allowlist principle (jose enforces it on the
 *   production call signature) and is explicitly noted as principle-level, not an
 *   end-to-end JWKS integration test.
 *
 * MUTATION SELF-VERIFICATION NOTE (per telly §bugfix self-verify)
 * ===============================================================
 * AC2 pins are verified: removing the { algorithms: ['HS256'] } option from
 * src/lib/jwt-secret.js:verifyStateToken causes AC2-REJECT-1 and AC2-REJECT-2 to
 * fail (verifyStateToken resolves instead of rejecting). These tests exercise the
 * production code path, not the test's own inputs.
 */

'use strict';

const { SignJWT, jwtVerify, generateKeyPair } = require('jose');

// ── Import the REAL production helper ────────────────────────────────────────
// Both gcal.controller.js:92 and msft-cal.controller.js:123 call verifyStateToken
// from this module. Importing it here pins the PRODUCTION allowlist enforcement.
const { verifyStateToken, getJwtSecret } = require('../../../src/lib/jwt-secret');

// ── Test setup ────────────────────────────────────────────────────────────────

beforeAll(() => {
  // Override JWT_SECRET to a fixed test value for deterministic key derivation.
  // getJwtSecret() reads process.env.JWT_SECRET at call time, so setting it here
  // ensures signing (below) and verify (via getJwtSecret inside verifyStateToken)
  // use the same key.
  process.env.JWT_SECRET = 'test-jwt-secret-for-allowlist-tests';
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

// ═════════════════════════════════════════════════════════════════════════════
// AC2 — gcal + msft OAuth state verify: must reject non-HS256 alg (BEHAVIORAL)
// Pins: gcal.controller.js:92, msft-cal.controller.js:123
// Both call verifyStateToken(state) from src/lib/jwt-secret.js
// ═════════════════════════════════════════════════════════════════════════════

describe('AC2 — HS256 state-verify allowlist (gcal.controller.js:92, msft-cal.controller.js:123)', () => {
  let hs256Token;
  let hs384Token;
  let hs512Token;

  beforeAll(async () => {
    // Sign tokens using the SAME key that verifyStateToken will use — getJwtSecret()
    // reads process.env.JWT_SECRET, which we set in the outer beforeAll above.
    const secret = getJwtSecret();

    // Token signed with the correct algorithm — controllers use HS256
    hs256Token = await new SignJWT({ userId: 'test-user-id' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(secret);

    // Tokens signed with non-HS256 symmetric algs.
    // jose accepts a TextEncoder Uint8Array key for HS384 and HS512.
    // verifyStateToken includes { algorithms: ['HS256'] } so these must be rejected
    // with ERR_JOSE_ALG_NOT_ALLOWED.
    hs384Token = await new SignJWT({ userId: 'test-user-id' })
      .setProtectedHeader({ alg: 'HS384' })
      .setExpirationTime('10m')
      .sign(secret);

    hs512Token = await new SignJWT({ userId: 'test-user-id' })
      .setProtectedHeader({ alg: 'HS512' })
      .setExpirationTime('10m')
      .sign(secret);
  });

  // ── Allowlist-rejection tests (GREEN on fixed production code) ────────────

  it('AC2-REJECT-1: rejects an HS384-signed state token (algorithm not allowed)', async () => {
    // verifyStateToken = jwtVerify(state, getJwtSecret(), { algorithms: ['HS256'] })
    // jose throws ERR_JOSE_ALG_NOT_ALLOWED when the token's alg header is not in
    // the allowlist. This pins the { algorithms: ['HS256'] } in production code;
    // removing it causes this test to fail (verifyStateToken resolves instead).
    const err = await verifyStateToken(hs384Token).then(
      () => null,
      (e) => e
    );
    expect(err).not.toBeNull();
    expect(err.code).toBe('ERR_JOSE_ALG_NOT_ALLOWED');
  });

  it('AC2-REJECT-2: rejects an HS512-signed state token (algorithm not allowed)', async () => {
    // Same mechanism as AC2-REJECT-1 — HS512 is not in the ['HS256'] allowlist.
    const err = await verifyStateToken(hs512Token).then(
      () => null,
      (e) => e
    );
    expect(err).not.toBeNull();
    expect(err.code).toBe('ERR_JOSE_ALG_NOT_ALLOWED');
  });

  // ── AC3 happy-path (must remain GREEN) ────────────────────────────────────

  it('AC3-HS256: a correctly-signed HS256 state token is accepted by verifyStateToken', async () => {
    // verifyStateToken allows HS256 — a validly-signed token must resolve.
    // Guards against over-restriction (broken allowlist that rejects valid tokens).
    const { payload } = await verifyStateToken(hs256Token);
    expect(payload.userId).toBe('test-user-id');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC1 — verifyToken RS256 allowlist (jwt-auth.js:70) — PRINCIPLE-LEVEL
// ═════════════════════════════════════════════════════════════════════════════
//
// SCOPE NOTE: verifyToken uses createRemoteJWKSet (a live JWKS URL) which is
// unreachable in unit tests. This test mirrors the EXACT production call shape
// with a local RS keypair instead of the remote JWKS. It is explicitly principle-
// level: it proves that jose enforces the algorithms:['RS256'] option on the same
// jwtVerify(token, key, { issuer, algorithms }) signature that the production call
// uses. It is NOT an end-to-end test of the JWKS remote fetch path.
// End-to-end coverage of verifyToken requires an integration test against a live
// auth-service JWKS endpoint (test-bed scope, out of scope for this unit wave).

describe('AC1 — RS256 verifyToken allowlist (jwt-auth.js:70) — principle-level', () => {
  let rs256PrivKey;
  let rs256PubKey;
  let rs256Token;
  let hs256SymToken;

  beforeAll(async () => {
    // Generate a local RS256 keypair — mirrors the JWKS key type in production
    ({ publicKey: rs256PubKey, privateKey: rs256PrivKey } = await generateKeyPair('RS256'));

    // RS256 token — the correct alg for verifyToken
    rs256Token = await new SignJWT({ sub: 'test-mcp-user', iss: 'raike-auth' })
      .setProtectedHeader({ alg: 'RS256' })
      .setExpirationTime('5m')
      .setIssuer('raike-auth')
      .sign(rs256PrivKey);

    // HS256 token — symmetric; used to test allowlist rejection (wrong key type)
    const symSecret = new TextEncoder().encode('sym-secret');
    hs256SymToken = await new SignJWT({ sub: 'test-mcp-user', iss: 'raike-auth' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .setIssuer('raike-auth')
      .sign(symSecret);
  });

  /**
   * Post-fix verifyToken shape (mirrors jwt-auth.js:70 AFTER fix):
   *   jwtVerify(token, getJWKS(), { issuer: 'raike-auth', algorithms: ['RS256'] })
   * Substituting a local RS256 pubKey for getJWKS() (same jose contract).
   */
  async function verifyTokenWithAllowlist(token) {
    const { payload } = await jwtVerify(token, rs256PubKey, { issuer: 'raike-auth', algorithms: ['RS256'] });
    return payload;
  }

  /**
   * Pre-fix verifyToken shape (mirrors jwt-auth.js:70 BEFORE fix):
   *   jwtVerify(token, getJWKS(), { issuer: 'raike-auth' })
   * Used only to document the pre-fix behavior difference (AC1-PREFIX-BEHAVIOR).
   */
  async function verifyTokenCurrentCode(token) {
    const { payload } = await jwtVerify(token, rs256PubKey, { issuer: 'raike-auth' });
    return payload;
  }

  // ── Allowlist-rejection test ──────────────────────────────────────────────

  it('AC1-REJECT-1: rejects a non-RS256 token via the allowlist (principle-level, mirrors jwt-auth.js:70)', async () => {
    // The { algorithms: ['RS256'] } option causes jose to throw ERR_JOSE_ALG_NOT_ALLOWED
    // before attempting signature verification when the token's alg header is not RS256.
    // We present an HS256 token against the RS256 allowlist — the alg header check fires
    // immediately. This is the same jose behaviour the production verifyToken uses.
    await expect(verifyTokenWithAllowlist(hs256SymToken))
      .rejects.toThrow(/alg.*not allowed|JOSEAlgNotAllowed/i);
  });

  it('AC1-PREFIX-BEHAVIOR: without the allowlist a non-RS256 token throws a key error, not alg-not-allowed', async () => {
    // Documents the pre-fix behaviour: without the allowlist the error is a key-type
    // mismatch (not ERR_JOSE_ALG_NOT_ALLOWED) because jose tries signature verification
    // before checking the alg. The post-fix adds the allowlist which fires first.
    // This test is a behaviour document, not an ongoing gate.
    let thrownError = null;
    try {
      await verifyTokenCurrentCode(hs256SymToken);
    } catch (e) {
      thrownError = e;
    }
    expect(thrownError).not.toBeNull();
    expect(thrownError.code).not.toBe('ERR_JOSE_ALG_NOT_ALLOWED');
  });

  // ── AC3 happy-path: RS256 token must still verify ────────────────────────

  it('AC3-RS256: a correctly-signed RS256 token is accepted by the allowlist verify (no regression)', async () => {
    const payload = await verifyTokenWithAllowlist(rs256Token);
    expect(payload.sub).toBe('test-mcp-user');
  });

  it('AC3-RS256-current: a correctly-signed RS256 token passes the pre-fix verify shape (baseline)', async () => {
    const payload = await verifyTokenCurrentCode(rs256Token);
    expect(payload.sub).toBe('test-mcp-user');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Additional edge cases (telly anxious about)
// ═════════════════════════════════════════════════════════════════════════════

describe('Edge cases — alg confusion and token tampering', () => {
  it('a tampered HS256 state token (modified payload) is rejected even with correct alg', async () => {
    const secret = getJwtSecret();
    const validToken = await new SignJWT({ userId: 'real-user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(secret);

    // Tamper: replace payload with a different userId (base64 encode a new payload)
    const parts = validToken.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ userId: 'attacker-user', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    const tamperedToken = parts[0] + '.' + tamperedPayload + '.' + parts[2];

    // verifyStateToken will reject: signature is invalid for the tampered payload
    await expect(verifyStateToken(tamperedToken)).rejects.toThrow();
  });

  it('an expired HS256 state token is rejected by verifyStateToken', async () => {
    const secret = getJwtSecret();
    const expiredToken = await new SignJWT({ userId: 'test-user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 700)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 100) // expired 100s ago
      .sign(secret);

    // jose's actual message: '"exp" claim timestamp check failed'
    await expect(verifyStateToken(expiredToken))
      .rejects.toThrow(/exp.*claim|timestamp check failed/i);
  });

  it('the alg:none attack is rejected (jose already rejects this)', async () => {
    // jose already rejects alg:none — this test confirms the existing protection
    // is not accidentally broken by the allowlist addition.
    // We construct a fake "none" token manually (jose refuses to sign with alg:none).
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ userId: 'attacker', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    const noneToken = header + '.' + payload + '.'; // empty signature

    await expect(verifyStateToken(noneToken)).rejects.toThrow();
  });
});

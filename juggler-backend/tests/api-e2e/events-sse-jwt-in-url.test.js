/**
 * Security regression tests — BUG-946 W1 (999.946)
 *
 * GET /api/events promotes a raw JWT-in-URL (?token=<JWT>) to a Bearer
 * Authorization header on an opaque-token MISS (src/app.js ~L326-341):
 *
 *   if (req.query.token && !req.headers.authorization) {
 *     var sseToken = sseTokens.get(req.query.token);
 *     if (sseToken && sseToken.expiresAt > Date.now()) { ... opaque hit ... }
 *     // Not an opaque token — treat as JWT (existing behavior)
 *     req.headers.authorization = 'Bearer ' + req.query.token;   // <-- THE BUG
 *   }
 *
 * A raw JWT is not a registered opaque token, so it falls through the opaque
 * check and gets promoted to a Bearer header, then authenticateJWT verifies
 * it normally — the JWT authenticates via the URL. This leaks JWTs into
 * proxy/access logs, browser history, and Referer headers.
 *
 * The fix (bert, NOT this file): on an opaque-token miss, return 401 instead
 * of promoting to a Bearer header. A real Authorization *header* JWT (no
 * query token) must still authenticate — only the query-token-as-JWT path is
 * removed.
 *
 * Harness: real Express app (src/app.js), real DB (test-bed 3407), real
 * RS256 JWT verified via a local JWKS server — mirrors the exact signing/
 * verification path production's authenticateJWT uses (tests/api-e2e/
 * server-setup.js). This is NOT a mocked-auth unit test: the JWT presented
 * in the URL is genuinely valid, which is what makes the vulnerability real
 * (an attacker-obtained valid JWT, not just any string, authenticates via
 * the URL on current code).
 *
 * Streaming-response control: the real GET /api/events success path never
 * calls res.end() (heartbeat + keep-alive, by design for a live SSE
 * connection) — an un-mocked supertest request would hang indefinitely
 * waiting for the response to complete. We mock ONLY src/lib/sse-emitter's
 * addClient() to call res.end() immediately after the handler registers the
 * client, so a successful (200) connection resolves promptly in the test
 * without altering any auth-relevant behavior — sse-emitter has no role in
 * the auth decision (that happens entirely upstream of addClient()).
 *
 * Self-verification / anti-tautology:
 *   - The CORE test drives the REAL production route (GET /api/events) with
 *     a REAL Authorization-header-less request carrying the JWT only in the
 *     query string — exactly the attacker's request shape. It does not call
 *     any auth helper directly.
 *   - RED on current code: the JWT-promotion line accepts the query JWT,
 *     authenticateJWT verifies it successfully (real JWKS, real signature),
 *     and the handler starts the SSE stream → status 200, addClient called.
 *     expect(res.status).toBe(401) FAILS — this is the security regression
 *     proof captured in Proof of Work below.
 *   - GREEN after bert's fix: the opaque-miss branch returns 401 before
 *     authenticateJWT ever runs → addClient is never called → both
 *     assertions (status 401, addClient not called) pass.
 *
 * SECOND DEFECT DISCOVERED WHILE AUTHORING (distinct from the JWT-promotion
 * vuln above — flagged for bert, NOT fixed here):
 *   `app.get('/api/events', shimFn, authenticateJWT, handlerFn)` registers
 *   THREE handlers for one route. On an opaque-token HIT, shimFn sets
 *   req.user and calls `return next()` — but in a multi-handler Express
 *   route, next() advances to the NEXT handler in the SAME route, which is
 *   `authenticateJWT`, NOT `handlerFn`. authenticateJWT (auth-client's)
 *   unconditionally requires `req.headers.authorization` to start with
 *   'Bearer ' and 401s otherwise — the opaque-hit branch never sets that
 *   header. Confirmed empirically: a fresh, valid, unexpired opaque token
 *   returns 401 with body `{"error":"Authentication required"}` (proves the
 *   request reached authenticateJWT, not a token-lookup failure). This means
 *   the opaque-token flow, as currently coded, NEVER succeeds — independent
 *   of the JWT-promotion bug above. The WBS's own AC2 ("valid opaque →
 *   200 + consumed one-time") requires this fixed too; the "regression
 *   guard" test below therefore starts RED for a DIFFERENT root cause than
 *   the CORE-RED test, not just as a byproduct of the promotion fix. bert's
 *   fix must route an opaque HIT directly to the SSE handler, bypassing
 *   authenticateJWT (e.g. inline the streaming logic in the shim's hit
 *   branch, or restructure the route so authenticateJWT only sits on the
 *   header/JWT path).
 */

'use strict';

process.env.NODE_ENV = 'test';

// ── sse-emitter: force res.end() on addClient so a 200 SSE connection ────────
// resolves the supertest promise instead of hanging on the open stream.
// Auth happens entirely BEFORE this middleware runs, so this mock cannot mask
// or fake an auth decision — it only lets a genuinely-opened stream close.
const mockAddClientSpy = jest.fn(function (userId, res) {
  try { res.end(); } catch (_e) { /* already closed */ }
});
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: function (...args) { return mockAddClientSpy(...args); }
}));
const addClientSpy = mockAddClientSpy;

const request = require('supertest');
const harness = require('./server-setup');
const { requireDB } = require('../helpers/requireDB');

let app;
let validJwt;

beforeAll(async () => {
  app = await harness.setup();
  if (app) validJwt = await harness.makeJWT();
}, 30000);

afterAll(async () => {
  await harness.teardown();
  await harness.destroy();
}, 15000);

beforeEach(() => {
  addClientSpy.mockClear();
});

const harnessProbe = () => harness.isAvailable();

// Fetch a fresh one-time opaque SSE token via the real POST /api/events/token
// endpoint (JWT sent in the Authorization HEADER, per the intended flow).
async function fetchOpaqueToken() {
  const res = await request(app)
    .post('/api/events/token')
    .set('Authorization', `Bearer ${validJwt}`);
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('token');
  return res.body.token;
}

describe('999.946 W1 — GET /api/events: raw JWT-in-URL must NOT authenticate', () => {
  // ── CORE RED ────────────────────────────────────────────────────────────
  test(
    'CORE-RED: ?token=<valid JWT> with NO Authorization header is REJECTED (401), ' +
    'not promoted to a Bearer JWT and authenticated',
    requireDB(async () => {
      const res = await request(app)
        .get('/api/events')
        .query({ token: validJwt });
        // Deliberately NO .set('Authorization', ...) — the JWT is presented
        // ONLY in the URL query string, exactly as an attacker (or the
        // current buggy frontend) would send it.

      // RED on current code: app.js promotes req.query.token to
      // `Authorization: Bearer <token>` (L338-339) because it is not a
      // registered opaque token; authenticateJWT then verifies the
      // genuinely-valid JWT and the SSE stream opens → res.status === 200.
      // This assertion FAILS on current code (actual 200, expected 401) —
      // that failure IS the security regression proof.
      // GREEN after bert's fix: opaque-miss → 401 before authenticateJWT runs.
      expect(res.status).toBe(401);

      // Belt-and-braces: the connection must never have reached the SSE
      // handler (sseEmitter.addClient is called there, after auth). On
      // current (buggy) code this assertion ALSO fails (addClient WAS
      // called) — an independent signal of the same regression.
      expect(addClientSpy).not.toHaveBeenCalled();
    }, harnessProbe)
  );
});

describe('999.946 — regression guards (must stay GREEN before AND after the fix)', () => {
  // ── Opaque token: one-time, consumed on use ──────────────────────────────
  // NOTE (RED on current code, root cause DISTINCT from the CORE-RED promotion
  // bug above): the opaque-HIT branch in app.js calls `return next()`, which
  // in this multi-handler route advances to `authenticateJWT` — NOT to the
  // SSE handler. authenticateJWT then 401s with {"error":"Authentication
  // required"} because no Authorization header was ever set on the opaque
  // path. Confirmed empirically (see file header "SECOND DEFECT DISCOVERED").
  // This assertion encodes the REQUIRED post-fix behavior per WBS AC2; it is
  // currently RED for this second, independent reason and must be fixed
  // alongside the promotion removal for AC2 to hold.
  test(
    'a valid opaque SSE token authenticates the SSE connection (200), and a ' +
    'SECOND use of the SAME opaque token is rejected (401) — one-time consume',
    requireDB(async () => {
      const opaque = await fetchOpaqueToken();

      const first = await request(app)
        .get('/api/events')
        .query({ token: opaque });

      expect(first.status).toBe(200);
      expect(addClientSpy).toHaveBeenCalledTimes(1);

      // Re-use the SAME opaque token — it was consumed (deleted) on first use,
      // so this must now fail. Not a JWT, so it does NOT fall into the
      // promote-to-Bearer path either (opaque tokens are UUIDs, not JWTs) —
      // it is simply "not found" and, on the FIXED code, returns 401.
      const second = await request(app)
        .get('/api/events')
        .query({ token: opaque });

      expect(second.status).toBe(401);
    }, harnessProbe)
  );

  // ── Opaque token: TTL-expired (distinct from reuse) ──────────────────────
  // The reuse test above proves the "deleted on consume" branch of the miss
  // check; it does NOT exercise the `sseToken.expiresAt > Date.now()` TTL
  // guard on its own — a token could be *unconsumed* (never used) and still
  // need to be rejected once its 60s window has elapsed. This test isolates
  // that guard: mint a token, advance ONLY the wall-clock the route reads
  // (Date.now) past its expiresAt, and confirm it is rejected WITHOUT ever
  // being consumed — i.e. this is a genuine expiry rejection, not a reuse
  // rejection. (Finding #4, telly TEST-REVIEW.md — added at --re-review.)
  test(
    'an EXPIRED opaque SSE token (60s TTL elapsed, never consumed) is rejected ' +
    '(401), not silently treated as valid',
    requireDB(async () => {
      const opaque = await fetchOpaqueToken();

      // Force the route's live `sseToken.expiresAt > Date.now()` comparison
      // to observe a time 61s past mint, without a real 60s wait and without
      // touching any other code path (the query-token branch never calls
      // authenticateJWT/jwtVerify, so no JWT signing/verification logic is
      // affected by this Date.now override). Restored synchronously in
      // `finally` so no other test observes the mocked clock.
      const realNow = Date.now;
      const frozenAt = realNow();
      Date.now = () => frozenAt + 61000; // 60_000 TTL + 1s margin
      let res;
      try {
        res = await request(app).get('/api/events').query({ token: opaque });
      } finally {
        Date.now = realNow;
      }

      expect(res.status).toBe(401);
      expect(addClientSpy).not.toHaveBeenCalled();
    }, harnessProbe)
  );

  // ── Authorization header JWT — unaffected by the fix ─────────────────────
  test(
    'Authorization HEADER JWT (no query token) still authenticates the SSE ' +
    'connection (200) — the header path is unaffected by the opaque-miss fix',
    requireDB(async () => {
      const res = await request(app)
        .get('/api/events')
        .set('Authorization', `Bearer ${validJwt}`);
        // No ?token= query param at all.

      expect(res.status).toBe(200);
      expect(addClientSpy).toHaveBeenCalledTimes(1);
    }, harnessProbe)
  );
});

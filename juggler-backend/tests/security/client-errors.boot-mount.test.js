/**
 * client-errors.boot-mount.test.js — 999.452
 *
 * BOOT-LEVEL integration test for the LIVE /api/client-errors mount.
 *
 * The existing tests/client-errors.routes.test.js exercises a test-local
 * makeApp() that MIRRORS the app.js mount (its own express() + an inline
 * limiter). That proves the shared @raike/lib-error-ingest router behaves, but it
 * does NOT prove the production wiring in src/app.js is correct — a regression
 * that drops the limiter, raises the 16kb cap, or omits bodyErrorGuard on the
 * real mount would stay green there.
 *
 * This suite closes that gap: it loads the ACTUAL application (src/app.js) and
 * hits the REAL /api/client-errors mount to verify the three production-mount
 * guards are wired:
 *
 *   1. SIZE CAP    — express.json({ limit: '16kb' }) on the mount → oversized
 *                    body produces a PayloadTooLarge that bodyErrorGuard maps to
 *                    413 {error:'payload too large'}, and nothing is logged.
 *   2. bodyErrorGuard — the trailing 4-arg guard catches express.json's
 *                    malformed-JSON (400 {error:'malformed body'}) and the 413
 *                    above; a happy payload returns 204.
 *   3. RATE LIMITER — clientErrorLimiter (express-rate-limit, max:30/60s) on the
 *                    mount → requests past the cap return 429 and are NOT logged.
 *
 * Infra is mocked the same way the other real-app supertest suites do:
 *   - src/db + lib/db → mockChainDb (app.js requires ./db at load).
 *   - src/lib/redis getClient()→null so maybeRedisStore('jugrl-cerr:') falls
 *     back to express-rate-limit's in-memory MemoryStore — making the 30/min cap
 *     deterministic and instance-local for the test (verified: 429 after cap).
 *
 * NOTE: the clientErrorLimiter is a single MemoryStore shared by the app
 * singleton. The contract tests (204/413/400) run inside the 30-request budget;
 * the rate-limit test runs LAST and intentionally drives the counter past 30.
 *
 * Run (test-bed ritual):
 *   DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass \
 *   DB_NAME=juggler_test REDIS_URL=redis://localhost:6479 \
 *   npx jest tests/security/client-errors.boot-mount.test.js
 */

'use strict';

process.env.NODE_ENV = 'test';

const path = require('path');
const os = require('os');
const fs = require('fs');

// Point the live mount's log at a fresh temp file BEFORE requiring the app
// (app.js reads BROWSER_ERRORS_LOG at module-load when it builds the router).
const TMP = path.join(os.tmpdir(), 'be-clienterr-boot-' + process.pid + '.log');
process.env.BROWSER_ERRORS_LOG = TMP;

// ── DB mocks (app.js requires ./db on load) ────────────────────────────────────
const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb } = createMockChainDb();
jest.mock('../../src/db', () => mockDb);
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

// ── Redis mock — getClient()→null forces maybeRedisStore to MemoryStore ─────────
// so the live clientErrorLimiter's 30/min cap is deterministic for this test.
jest.mock('../../src/lib/redis', () => ({
  getClient: () => null,
  get: async () => null,
  set: async () => {},
  del: async () => {},
  invalidateTasks: async () => {},
  invalidateConfig: async () => {}
}));

const request = require('supertest');

function readLog() {
  try { return fs.readFileSync(TMP, 'utf8'); } catch (e) { return ''; }
}

let app;
beforeAll(() => {
  // The REAL application — this is the whole point of the suite.
  app = require('../../src/app');
});
beforeEach(() => { try { fs.unlinkSync(TMP); } catch (e) {} });
afterAll(() => { try { fs.unlinkSync(TMP); } catch (e) {} });

describe('999.452 — LIVE /api/client-errors mount (src/app.js boot)', () => {

  test('happy payload on the real mount → 204 and exactly one log line written', async () => {
    const res = await request(app)
      .post('/api/client-errors')
      .send({ message: 'TypeError: boot-mount is wired', source: 'app.js', lineno: 1, kind: 'error' });

    expect(res.status).toBe(204);
    const lines = readLog().trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    // The live mount passes app:'juggler' to the router → [juggler] token present.
    expect(lines[0]).toMatch(/^ERROR \[browser\] \[juggler\] /);
  });

  test('SIZE CAP — oversized body (>16kb) → exactly 413 {error:"payload too large"}, nothing logged', async () => {
    const huge = 'x'.repeat(20 * 1024); // exceeds the 16kb express.json cap on the mount
    const res = await request(app)
      .post('/api/client-errors')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ message: huge }));

    // Proves BOTH the 16kb cap AND bodyErrorGuard's 413 branch are on the real mount.
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'payload too large' });
    expect(readLog()).toBe('');
  });

  test('bodyErrorGuard — malformed JSON → exactly 400 {error:"malformed body"}, nothing logged', async () => {
    const res = await request(app)
      .post('/api/client-errors')
      .set('Content-Type', 'application/json')
      .send('{ not valid json }');

    // Proves bodyErrorGuard's malformed-body (400) branch is the trailing handler
    // on the live mount (a router-internal guard would never see this parse error).
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'malformed body' });
    expect(readLog()).toBe('');
  });

  test('bodyErrorGuard — missing message → 400 {error:"invalid payload: message required"}, nothing logged', async () => {
    const res = await request(app)
      .post('/api/client-errors')
      .send({ source: 'x.js' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid payload: message required' });
    expect(readLog()).toBe('');
  });

  // MUST run last: it drives the shared MemoryStore counter past the live cap.
  test('RATE LIMITER — requests past the live 30/min cap → 429, not logged', async () => {
    // Send well past the cap. Early requests (under the cap) are accepted (204);
    // once the live clientErrorLimiter's 30/min quota is exhausted, subsequent
    // requests are rejected with 429 BEFORE the router/log step.
    let sawAccepted = false;
    let sawLimited = false;
    let limitedStatus = null;

    for (let i = 0; i < 40; i++) {
      // fresh log each iteration so we can assert a 429 does not append a line
      try { fs.unlinkSync(TMP); } catch (e) {}
      const res = await request(app)
        .post('/api/client-errors')
        .send({ message: 'rl-' + i });

      if (res.status === 204) {
        sawAccepted = true;
      } else if (res.status === 429) {
        sawLimited = true;
        limitedStatus = res.status;
        // A rate-limited request must NOT have written a log line.
        expect(readLog()).toBe('');
        break;
      }
    }

    // The live mount must both accept under-cap traffic AND enforce the cap.
    expect(sawAccepted).toBe(true);
    expect(sawLimited).toBe(true);
    expect(limitedStatus).toBe(429);
  }, 30000);
});

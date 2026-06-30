/**
 * Characterization tests for gcal.controller.js — jugh7gcal step 0.
 *
 * PURPOSE: pin the observable HTTP behavior of every gcal handler BEFORE the
 * delegation refactor (bert step 1).  After bert migrates the controller to
 * delegate to src/slices/calendar/facade.js, these tests must remain GREEN
 * (same status codes + response shapes).
 *
 * SEAM CHOICE (per telly retro 2026-06-14 guidance):
 *   Pin at the outermost observable HTTP boundary (status code + response body
 *   shape), NOT at internal DB-spy or direct-knex call sites.  Those internal
 *   seams are deleted by the refactor and produce false-RED.
 *
 * DB MOCK STRATEGY — dual-path, stable across the refactor:
 *   Current controller code: `getDb()` → `require('../db')` → `src/db.js`
 *   Post-refactor code:       facade uses `require('../../lib/db').getDefaultDb()`
 *                             i.e. `src/lib/db/index.js`
 *   Both are mocked here so the same mockDb / resolveQueue drives BOTH the
 *   before and after states.  This avoids the broken-mock drift seen in the
 *   already-refactored MSFT/Apple sections of oauth-providers.test.js (where
 *   only `src/db` was mocked but the facade uses `src/lib/db`).
 *
 * COVERAGE GAP FILLED:
 *   The callback SUCCESS path (valid code + valid state JWT → 302 redirect) was
 *   NOT exercised by any existing test.  The error paths (missing/tampered state)
 *   are already covered by tests/security/probes.test.js.
 *
 * HANDLERS COVERED:
 *   getStatus  — covered by tests/api/oauth-providers.test.js (see coverage table)
 *   connect    — covered by tests/api/oauth-providers.test.js
 *   callback   — SUCCESS PATH added here; error paths in probes.test.js
 *   disconnect — covered by tests/api/oauth-providers.test.js
 *   setAutoSync — covered by tests/api/oauth-providers.test.js
 */

process.env.NODE_ENV = 'test';

const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();

// Mock src/db (current controller path: `const getDb = () => require('../db')`)
jest.mock('../../src/db', () => mockDb);
// Mock src/lib/db (facade path post-refactor: `require('../../lib/db').getDefaultDb()`)
// Same mockDb so the resolveQueue drives both code paths.
jest.mock('../../src/lib/db', () => ({ getDefaultDb: () => mockDb }));

// JWT auth mock — same pattern as oauth-providers.test.js
const TEST_USER = {
  id: 'user-123',
  email: 'test@test.com',
  name: 'Test',
  timezone: 'America/New_York',
  gcal_refresh_token: null,
  gcal_access_token: null,
  gcal_token_expiry: null,
  gcal_last_synced_at: null
};

jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer '))
      return res.status(401).json({ error: 'Authentication required' });
    if (req.headers['x-test-user']) {
      try { req.user = JSON.parse(req.headers['x-test-user']); }
      catch (e) { req.user = { ...TEST_USER }; }
    } else {
      req.user = { ...TEST_USER };
    }
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn()
}));

jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = {
      limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1, schedule_templates: -1, ai_commands_per_month: -1 },
      ai: { natural_language_commands: true },
      calendar: { max_providers: -1, auto_sync: true },
      scheduling: { dependencies: true, travel_time: true },
      tasks: { rigid: true },
      data: { export: true, import: true, mcp_access: true }
    };
    next();
  },
  PRODUCT_ID: 'juggler',
  refreshPlanFeatures: jest.fn(),
  getCachedPlanFeatures: jest.fn()
}));

jest.mock('../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve()),
  del: jest.fn(() => Promise.resolve())
}));

jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn()
}));

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

jest.mock('../../src/lib/sync-lock', () => ({
  withSyncLock: (fn) => fn,
  acquireLock: jest.fn(() => Promise.resolve(true)),
  releaseLock: jest.fn(() => Promise.resolve()),
  refreshLock: jest.fn(() => Promise.resolve())
}));

// gcal-api mock — no real Google OAuth calls
jest.mock('../../src/lib/gcal-api', () => ({
  createOAuth2Client: jest.fn(() => ({ generateAuthUrl: jest.fn(() => 'https://accounts.google.com/mock-auth') })),
  getAuthUrl: jest.fn(() => 'https://accounts.google.com/mock-auth?scope=calendar'),
  getTokensFromCode: jest.fn(() => Promise.resolve({
    access_token: 'mock-at',
    refresh_token: 'mock-rt',
    expiry_date: Date.now() + 3600000
  })),
  refreshAccessToken: jest.fn(() => Promise.resolve({ access_token: 'refreshed-at', expiry_date: Date.now() + 3600000 }))
}));

const VALID_TOKEN = 'valid-test-token';
// The default test JWT secret when JWT_SECRET env var is not set in non-production
const TEST_JWT_SECRET_KEY = new TextEncoder().encode('local-dev-jwt-secret-juggler');

let app, request;

beforeAll(async () => {
  app = require('../../src/app');
  request = require('supertest');
});

beforeEach(() => {
  resolveQueue.length = 0;
  jest.clearAllMocks();
  // 999.992 (jug992 re-review fix): the shared mockChainDb's `chain.raw` returns a
  // plain string (`(s) => s`), fine for the embedded-SQL-fragment usage every other
  // consumer of this file exercises, but NOT thenable/catchable. The new
  // gcalMarkCodeUsed()/msftMarkCodeUsed() guard (facade.js) does
  // `await db.raw(...).catch(fn)` — matching real Knex's `.raw()`, which IS
  // thenable+catchable — so against the plain-string mock it threw
  // "db.raw(...).catch is not a function", turning the callback success/tampered-state
  // paths into 500s (was 302/400). No other facade.js gcal* function calls db.raw()
  // (confirmed via grep), so this override is scoped to the callback tests in THIS
  // file only — it does not touch the shared helper (tests/helpers/mockChainDb.js,
  // 25 other consumers) or production code. Resolves to a generic successful
  // INSERT-IGNORE result shape so gcalMarkCodeUsed/msftMarkCodeUsed treat every test
  // code as "first use" (not a duplicate), which is the correct behavior for these
  // success/error-path characterization tests (they are not testing the dedup
  // contract itself — that's gcalCalDedup.test.js/msftCalDedup.test.js).
  mockDb.raw = jest.fn(() => Promise.resolve([{ affectedRows: 1 }]));
});

// ═══════════════════════════════════════════════════════════════════════════════
// GCal callback — SUCCESS PATH (gap filled; error paths in probes.test.js)
// ═══════════════════════════════════════════════════════════════════════════════

describe('GCal — GET /api/gcal/callback — success path (characterization)', () => {
  /**
   * Callback success path: valid `code` + valid signed state JWT
   * → 302 redirect to frontend URL with `?gcal=connected`.
   *
   * This is the primary behavior the refactor must preserve.
   * The state JWT is generated with the same secret the handler verifies
   * (deterministic default: 'local-dev-jwt-secret-juggler' when JWT_SECRET
   * is not set in non-production).
   *
   * Seam: outermost HTTP boundary — status 302 + Location header.
   * Stable before and after the delegation refactor.
   *
   * Self-mutation verification: removing the `res.redirect(...)` call from
   * the controller changes the HTTP response (no 302 / different Location),
   * which flips this test RED.  Changing the redirect path from
   * `/?gcal=connected` to something else also flips it RED.
   */
  test('returns 302 redirect to frontend URL with gcal=connected', async () => {
    const { SignJWT } = require('jose');
    // Build a valid state JWT signed with the known test secret.
    // userId matches TEST_USER.id so the optional IDOR guard passes.
    const validState = await new SignJWT({ userId: TEST_USER.id })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(TEST_JWT_SECRET_KEY);

    // No resolveQueue item needed: the controller's DB update
    // (getDb()('users').where().update()) resolves to [] by default
    // when the queue is empty — the return value is unused by the controller.

    const res = await request(app)
      .get(`/api/gcal/callback?code=testcode&state=${validState}`);
    // Supertest does not follow redirects by default — we get the raw 302.

    expect(res.status).toBe(302);
    // The redirect URL includes the frontend base + '/?gcal=connected'
    expect(res.headers.location).toMatch(/\?gcal=connected/);
  });

  /**
   * Callback with missing `code` → 400 (existing behavior, covered by probes
   * but pinned here explicitly for the gcal-scope characterization record).
   */
  test('returns 400 when code is missing', async () => {
    const { SignJWT } = require('jose');
    const validState = await new SignJWT({ userId: TEST_USER.id })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(TEST_JWT_SECRET_KEY);

    const res = await request(app)
      .get(`/api/gcal/callback?state=${validState}`);

    expect(res.status).toBe(400);
  });

  /**
   * Callback with missing `state` → 400.
   * (Also covered by probes.test.js; included here for complete gcal coverage record.)
   */
  test('returns 400 when state is missing', async () => {
    const res = await request(app)
      .get('/api/gcal/callback?code=testcode');

    expect(res.status).toBe(400);
  });

  /**
   * Callback with tampered state JWT → 400 (invalid or expired state).
   * (Also covered by probes.test.js; included for gcal-scope completeness.)
   */
  test('returns 400 when state JWT is tampered', async () => {
    const res = await request(app)
      .get('/api/gcal/callback?code=testcode&state=tampered-jwt-value');

    expect(res.status).toBe(400);
  });
});

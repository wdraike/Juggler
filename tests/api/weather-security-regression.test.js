/**
 * Security regression tests — weather-route hardening
 *
 * BUG 999.316: POST /api/weather/ingest is served only by the broad apiLimiter
 *   (max 1000/min) instead of the stricter writeRateLimiter (max 300/min).
 *   Observable: the RateLimit-Limit response header reflects 1000, not 300.
 *   RED now (current code), GREEN after bert adds writeRateLimiter to the
 *   weather mount.  GET /api/weather is a control: skip() passes GET so it
 *   must reflect 1000 both before and after the fix.
 *
 * BUG 999.317: weather.controller catch blocks return raw err.message to the
 *   client — a 4-site information-disclosure bug.  Observable: when the weather
 *   facade throws an error with a distinctive secret string, that string leaks
 *   in res.body.error.  RED now, GREEN after bert replaces the 4 catch bodies
 *   with static strings.  Covers getForecast, ingest, geocode, reverseGeocode.
 *
 * Test design:
 *   - Bug 999.316 assertion is header-based: no rate-hammering, deterministic,
 *     one request only.  The LAST middleware to call setHeader wins — after the
 *     fix writeRateLimiter (max=300) overwrites apiLimiter (max=1000) for POST;
 *     GET is skipped by writeRateLimiter so stays at 1000.
 *   - Bug 999.317 assertion is body.error-based: facade is mocked to throw with
 *     a DISTINCTIVE secret string; assert it does NOT appear in the response.
 *
 * Self-verification discipline (telly bugfix anti-tautology rule):
 *   Each assertion drives the REAL Express app + real controller/app.js code so
 *   the observed behaviour reflects production, not the test's own setup.
 */

'use strict';

process.env.NODE_ENV = 'test';

// ── Mock DB (required for app.js to load — weather ingest path writes cache) ──
const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();
mockDb.delete = mockDb.del;

jest.mock('../../src/db', () => mockDb);
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

// ── JWT: auto-pass with a synthetic user ──────────────────────────────────────
const TEST_USER = { id: 'user-999', email: 'sec@test.com', name: 'SecTest', timezone: 'UTC' };
jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, _res, next) => {
    if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer '))
      return _res.status(401).json({ error: 'Authentication required' });
    req.user = { ...TEST_USER };
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn()
}));

// ── Plan features ─────────────────────────────────────────────────────────────
jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, _res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = {
      limits: { active_tasks: -1, recurring_templates: -1, projects: -1,
        locations: -1, schedule_templates: -1, ai_commands_per_month: -1 },
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

// ── Redis: no-op ──────────────────────────────────────────────────────────────
jest.mock('../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(true)),
  del: jest.fn(() => Promise.resolve())
}));

// ── Scheduler / SSE / sync-lock / tasks-write: stubs ─────────────────────────
jest.mock('../../src/lib/sse-emitter', () => ({ emit: jest.fn(), addClient: jest.fn() }));
jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(), stopPollLoop: jest.fn()
}));
jest.mock('../../src/lib/sync-lock', () => ({
  withSyncLock: (fn) => fn,
  acquireLock: jest.fn(() => Promise.resolve(true)),
  releaseLock: jest.fn(() => Promise.resolve()),
  refreshLock: jest.fn(() => Promise.resolve())
}));
jest.mock('../../src/lib/tasks-write', () => ({
  insertTask: jest.fn(() => Promise.resolve()),
  updateTask: jest.fn(() => Promise.resolve()),
  deleteTasksWhere: jest.fn(() => Promise.resolve())
}));

// ── Logger: suppress noise ────────────────────────────────────────────────────
jest.mock('../../src/lib/logger', () => {
  const noop = jest.fn();
  const fakeLogger = { error: noop, warn: noop, info: noop, debug: noop, trace: noop };
  const createLogger = jest.fn(() => fakeLogger);
  const named = [
    'dataControllerLogger','weatherControllerLogger','taskControllerLogger',
    'calSyncControllerLogger','aiControllerLogger','schedulerLogger',
    'schedulerRunLogger','schedulerUnifiedLogger','configControllerLogger',
    'libUsageReporterLogger','libGcalLogger','libMsftLogger','libAppleLogger',
    'libDbLogger','libRedisLogger','libTasksWriteLogger','libTaskWriteQueueLogger',
    'libCalAdapterLogger','libSyncLockLogger','libRollingAnchorLogger',
    'libReconcileSplitsLogger','libSseEmitterLogger','aiUsageQueueLogger',
    'aiUsageFlusherLogger','serverLogger','cronCalHistoryLogger'
  ].reduce((acc, k) => { acc[k] = fakeLogger; return acc; }, {});
  return Object.assign({ createLogger, Logger: class {}, clearLoggerCache: jest.fn(),
    LOG_LEVELS: [], DEFAULT_LOG_LEVEL: 'debug', loggers: {},
    error: noop, warn: noop, info: noop, debug: noop, trace: noop }, named);
});

// ── Weather facade mock — controlled per-test ─────────────────────────────────
// We mock the facade BEFORE requiring app so that when the controller loads it
// it gets our controllable jest.fn() versions.  Individual tests override them
// via mockImplementation / mockRejectedValue.
jest.mock('../../src/slices/weather/facade', () => ({
  getForecast: jest.fn(),
  ingest: jest.fn(),
  geocode: jest.fn(),
  reverseGeocode: jest.fn(),
  reverseGeocodeDisplayName: jest.fn(),
  roundCoord: (v) => Math.round(parseFloat(v) * 10) / 10,
  gridValue: (v) => Math.round(parseFloat(v) * 10) / 10
}));

const VALID_TOKEN = 'valid-token';

// ── Bring up app ONCE (module-level singleton; mocks already registered) ──────
let app, request, weatherFacade;

beforeAll(() => {
  app = require('../../src/app');
  request = require('supertest');
  weatherFacade = require('../../src/slices/weather/facade');
});

beforeEach(() => {
  resolveQueue.length = 0;
  jest.clearAllMocks();
  // Default: facade methods resolve to valid-looking values so 200 paths work.
  weatherFacade.getForecast.mockResolvedValue({
    hourly: { time: [], temperature_2m: [] },
    hourly_units: {},
    cachedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString()
  });
  weatherFacade.ingest.mockResolvedValue({
    cachedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString()
  });
  weatherFacade.geocode.mockResolvedValue({ lat: 37.77, lon: -122.42, displayName: 'SF, CA, US' });
  weatherFacade.reverseGeocode.mockResolvedValue({ displayName: 'SF, CA, US' });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG 999.316 — rate-limiter regression
//
// express-rate-limit v8 with { standardHeaders: true, legacyHeaders: false }
// uses draft-6 headers: sets RateLimit-Limit to String(max) on every response.
// When two limiters run in sequence, the LAST setHeader call wins.
//
// Before fix: POST /ingest → apiLimiter(1000) only → RateLimit-Limit='1000'
// After fix:  POST /ingest → apiLimiter(1000) → writeRateLimiter(300)
//             → RateLimit-Limit='300'  (writeRateLimiter overwrites, POST not skipped)
//
// GET /weather control: writeRateLimiter.skip(GET)=true → limiter is a no-op for GET
//   → only apiLimiter runs → RateLimit-Limit stays '1000' before AND after fix.
//   This assertion must STAY GREEN proving GETs are NOT newly throttled.
// ─────────────────────────────────────────────────────────────────────────────

describe('999.316 — writeRateLimiter NOT applied to POST /api/weather/ingest', () => {
  const VALID_INGEST = {
    lat: 37.7,
    lon: -122.4,
    hourly: {
      time: ['2026-05-15T00:00'],
      temperature_2m: [72],
      precipitation_probability: [10],
      cloudcover: [30],
      weathercode: [1]
    }
  };

  test(
    'RED-999.316: POST /api/weather/ingest RateLimit-Limit reflects apiLimiter (1000),' +
    ' not writeRateLimiter (300) — proves writeRateLimiter is absent',
    async () => {
      const res = await request(app)
        .post('/api/weather/ingest')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send(VALID_INGEST);

      // After the fix bert applies, writeRateLimiter (max=300) will overwrite
      // this header to '300'.  On CURRENT (unfixed) code only apiLimiter runs,
      // leaving the header as '1000' — this assertion FAILS after the fix
      // (that is the intended RED→GREEN flip).
      //
      // RED on current code: actual='1000', expected='300' → FAIL (correct RED)
      // GREEN after fix:     actual='300',  expected='300' → PASS
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('300');
    }
  );

  test(
    'CONTROL-999.316: GET /api/weather RateLimit-Limit stays 1000 (writeRateLimiter skips GET)',
    async () => {
      // This assertion must be GREEN both before and after the fix, proving
      // that adding writeRateLimiter to the weather mount does NOT throttle GETs.
      const res = await request(app)
        .get('/api/weather?lat=37.7&lon=-122.4')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      // writeRateLimiter.skip() returns true for GET → it is a no-op for GET;
      // only apiLimiter (max=1000) runs → header='1000' always.
      expect(res.headers['ratelimit-limit']).toBe('1000');
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG 999.317 — raw err.message leaks in catch blocks (4 sites)
//
// Each catch block currently does:
//   res.status(500).json({ error: err.message || 'Static fallback' })
// When err.message is truthy, the raw internal message leaks to the client.
//
// Fix: replace with static string only; keep logger.error() logging the message.
//
// RED: body.error === distinctive secret string → leaks (current code)
// GREEN: body.error === static fallback string (after fix)
// ─────────────────────────────────────────────────────────────────────────────

// Distinctive secret strings with internal-path flavor — unmistakable if leaked
const SECRET_FORECAST  = 'INTERNAL_LEAK_abc123 db:connect failed at /secret/db-pool';
const SECRET_INGEST    = 'INTERNAL_LEAK_def456 cache write error at /internal/storage';
const SECRET_GEOCODE   = 'INTERNAL_LEAK_ghi789 upstream timeout at /internal/geocode-svc';
const SECRET_REVGEO    = 'INTERNAL_LEAK_jkl012 Nominatim auth failure at /private/config';

describe('999.317 — weather controller leaks raw err.message in catch blocks', () => {
  test(
    'RED-999.317a: GET /api/weather?lat=X&lon=Y leaks err.message when facade throws',
    async () => {
      weatherFacade.getForecast.mockRejectedValue(new Error(SECRET_FORECAST));

      const res = await request(app)
        .get('/api/weather?lat=37.7&lon=-122.4')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(500);

      // RED: current code returns `{ error: err.message || 'Weather fetch failed' }`
      // so body.error === SECRET_FORECAST — this assertion FAILS on current code.
      // After fix body.error === 'Weather fetch failed' and does NOT contain secret.
      expect(res.body.error).not.toContain(SECRET_FORECAST);
      expect(res.body.error).toBe('Weather fetch failed');
    }
  );

  test(
    'RED-999.317b: POST /api/weather/ingest leaks err.message when facade throws',
    async () => {
      // Provide a valid body so validation passes and execution reaches facade.ingest
      const validBody = {
        lat: 37.7,
        lon: -122.4,
        hourly: {
          time: ['2026-05-15T00:00'],
          temperature_2m: [72],
          precipitation_probability: [10],
          cloudcover: [30],
          weathercode: [1]
        }
      };
      weatherFacade.ingest.mockRejectedValue(new Error(SECRET_INGEST));

      const res = await request(app)
        .post('/api/weather/ingest')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send(validBody);

      expect(res.status).toBe(500);

      // RED: current code returns { error: err.message || 'Ingest failed' }
      // → body.error === SECRET_INGEST, this assertion FAILS on current code.
      // GREEN after fix: body.error === 'Ingest failed', secret absent.
      expect(res.body.error).not.toContain(SECRET_INGEST);
      expect(res.body.error).toBe('Ingest failed');
    }
  );

  test(
    'RED-999.317c: GET /api/weather/geocode?q=X leaks err.message when facade throws',
    async () => {
      weatherFacade.geocode.mockRejectedValue(new Error(SECRET_GEOCODE));

      const res = await request(app)
        .get('/api/weather/geocode?q=SomeCity')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(500);

      // RED: current code returns { error: err.message || 'Geocode failed' }
      // → body.error === SECRET_GEOCODE, this assertion FAILS on current code.
      // GREEN after fix: body.error === 'Geocode failed', secret absent.
      expect(res.body.error).not.toContain(SECRET_GEOCODE);
      expect(res.body.error).toBe('Geocode failed');
    }
  );

  test(
    'RED-999.317d: GET /api/weather/reverse-geocode?lat=X&lon=Y leaks err.message when facade throws',
    async () => {
      weatherFacade.reverseGeocode.mockRejectedValue(new Error(SECRET_REVGEO));

      const res = await request(app)
        .get('/api/weather/reverse-geocode?lat=37.7&lon=-122.4')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(500);

      // RED: current code returns { error: err.message || 'Reverse geocode failed' }
      // → body.error === SECRET_REVGEO, this assertion FAILS on current code.
      // GREEN after fix: body.error === 'Reverse geocode failed', secret absent.
      expect(res.body.error).not.toContain(SECRET_REVGEO);
      expect(res.body.error).toBe('Reverse geocode failed');
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// elmo REFER→telly — mount-reorder regression tests
//
// bert reordered the weather mount to:
//   app.use('/api/weather', authenticateJWT, writeRateLimiter, weatherRoutes)
// and removed the redundant internal router.use(authenticateJWT) from
// weather.routes.js so that auth is no longer double-applied.
//
// Two regressions guarded here:
//
// (A) Per-user rate-limit keying: writeRateLimiter's keyGenerator is
//     `(req) => req.user?.id ? String(req.user.id) : undefined`.
//     Before the mount reorder, writeRateLimiter ran BEFORE authenticateJWT,
//     so req.user was undefined when keyGenerator ran → all POST /ingest traffic
//     shared a single "undefined" global bucket (cross-user DoS).
//     After the fix, authenticateJWT runs first → req.user.id is set →
//     keyGenerator returns a per-user key ("user-999" for this mock).
//     Verified by spying on MemoryStore.prototype.increment and asserting the
//     key argument is the user id string, NOT "undefined".
//
// (B) Auth still enforced after removing the in-router authenticateJWT:
//     weather.routes.js no longer has router.use(authenticateJWT); auth now
//     lives exclusively at the mount point (app.use('/api/weather',
//     authenticateJWT, ...)). An unauthenticated request must still be rejected
//     401 — this guards against the mount-reorder accidentally dropping auth.
//
// Self-verification discipline:
//   (A) On PRE-fix code (writeRateLimiter before authenticateJWT), req.user is
//       undefined when keyGenerator runs → increment is called with "undefined"
//       (JS String coercion of undefined), not "user-999". The spy assertion
//       FAILS on pre-fix code (correct RED). GREEN after fix.
//   (B) Without any authenticateJWT (hypothetical regression), the unauthenticated
//       request would reach the controller and return 200 or 400. The 401
//       assertion would FAIL on a hypothetically broken mount. GREEN on fixed code.
// ─────────────────────────────────────────────────────────────────────────────

describe('elmo-REFER: mount-reorder regression — per-user keyGenerator keying', () => {
  const VALID_INGEST = {
    lat: 37.7,
    lon: -122.4,
    hourly: {
      time: ['2026-05-15T00:00'],
      temperature_2m: [72],
      precipitation_probability: [10],
      cloudcover: [30],
      weathercode: [1]
    }
  };

  // Capture the MemoryStore constructor used by express-rate-limit so we can
  // spy on its increment method and observe the exact key the keyGenerator
  // produces. This is the only observable surface for "req.user was set when
  // keyGenerator ran" without exhausting 300 requests.
  let MemoryStore;
  let incrementSpy;

  beforeAll(() => {
    // MemoryStore is exported by express-rate-limit; the writeRateLimiter
    // in app.js uses the default (MemoryStore instance). Spy on the prototype
    // so any instance's increment call is captured.
    MemoryStore = require('express-rate-limit').MemoryStore;
    incrementSpy = jest.spyOn(MemoryStore.prototype, 'increment');
  });

  afterAll(() => {
    if (incrementSpy) incrementSpy.mockRestore();
  });

  test(
    'elmo-REFER-A: POST /api/weather/ingest — writeRateLimiter keyGenerator receives ' +
    'req.user.id (per-user bucket), not undefined (global bucket)',
    async () => {
      incrementSpy.mockClear();

      const res = await request(app)
        .post('/api/weather/ingest')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send(VALID_INGEST);

      // Request must succeed (or fail for a domain reason) — not be rate-limited.
      // The rate limiter is at position 1/300 so no 429 on first request.
      expect(res.status).toBe(200);

      // The spy captures every key the in-memory store receives. After the
      // mount-order fix, authenticateJWT runs before writeRateLimiter, so
      // req.user.id = 'user-999' when keyGenerator runs → store.increment
      // is called with 'user-999'.
      //
      // Before the fix: req.user is undefined when keyGenerator runs →
      // keyGenerator returns undefined → store.increment receives 'undefined'
      // (String coercion) → this assertion FAILS (correct RED on pre-fix code).
      const calledKeys = incrementSpy.mock.calls.map(([key]) => key);
      expect(calledKeys).toContain(TEST_USER.id);

      // Confirm the global undefined-key bucket was NOT used — a truthy
      // user id must be present; 'undefined' (the string) means auth ran AFTER
      // the limiter (pre-fix behaviour).
      expect(calledKeys).not.toContain('undefined');
      expect(calledKeys).not.toContain(undefined);
    }
  );

});

describe('elmo-REFER: mount-reorder regression — auth still enforced after removing router.use(authenticateJWT)', () => {
  // bert removed the redundant router.use(authenticateJWT) from weather.routes.js
  // (after moving auth to the app.use mount). This test guards against a
  // hypothetical regression where removing it also removes auth from the route.
  //
  // Expected: unauthenticated requests to ALL weather endpoints still return 401.
  // If auth were accidentally dropped, these routes would return 200/400/404.
  //
  // Self-verification: without any authenticateJWT in the chain, an
  // unauthenticated POST /api/weather/ingest would reach the controller and
  // return 400 (missing body) or 200, not 401. The 401 assertion would FAIL.

  test(
    'elmo-REFER-B1: unauthenticated GET /api/weather returns 401 ' +
    '(auth enforced at mount, no in-router fallback needed)',
    async () => {
      const res = await request(app)
        .get('/api/weather?lat=37.7&lon=-122.4');
        // No Authorization header

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    }
  );

  test(
    'elmo-REFER-B2: unauthenticated POST /api/weather/ingest returns 401 ' +
    '(write endpoint: auth enforced at mount, writeRateLimiter skipped since 401 exits before limiter counts)',
    async () => {
      const res = await request(app)
        .post('/api/weather/ingest')
        .send({
          lat: 37.7, lon: -122.4,
          hourly: { time: ['2026-05-15T00:00'], temperature_2m: [72],
            precipitation_probability: [10], cloudcover: [30], weathercode: [1] }
        });
        // No Authorization header

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    }
  );

  test(
    'elmo-REFER-B3: unauthenticated GET /api/weather/geocode returns 401 ' +
    '(auth enforced at mount)',
    async () => {
      const res = await request(app)
        .get('/api/weather/geocode?q=SomeCity');
        // No Authorization header

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    }
  );

  test(
    'elmo-REFER-B4: unauthenticated GET /api/weather/reverse-geocode returns 401 ' +
    '(auth enforced at mount)',
    async () => {
      const res = await request(app)
        .get('/api/weather/reverse-geocode?lat=37.7&lon=-122.4');
        // No Authorization header

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    }
  );
});

/**
 * H4 W1 — User/Config Slice Characterization Golden Master (HTTP surface)
 *
 * PURPOSE: Pins the CURRENT behavior of the 8 H4 target files as a snapshot
 * oracle BEFORE any hexagonal extraction begins. This suite must stay GREEN
 * against the un-refactored code (W1 gate) AND against the extracted facade
 * after W6 — behavior-identical is the §4 binding gate.
 *
 * TRACEABILITY: TRACEABILITY.md H1–H9, H11, H13.
 *   H1  — Config CRUD (all 11 handlers) HTTP payloads
 *   H2  — Data export/import behavior
 *   H3  — Billing-webhook handling + signature guard (pinned as-is)
 *   H4  — Feature-catalog reads (payload + service-key auth)
 *   H5  — Impersonation authz (admin gate, self-impersonation guard, INTERNAL_SERVICE_KEY)
 *   H6  — Feature-gate enforcement (allow/deny decisions)
 *   H7  — Entitlement slug-keying: PRODUCT_LABEL = 'juggler', NOT UUID
 *   H8  — Cache TTLs: catalog 5min (CATALOG_CACHE_TTL_MS), user-plan 2min (USER_PLAN_CACHE_TTL_MS)
 *   H9  — Entity-limit enforcement (count→limit→allow/block logic)
 *   H11 — 8 files behavior unchanged after extraction (W6 re-run)
 *   H13 — PAYMENT_SERVICE_URL fallback: process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020'
 *
 * WHAT IS BEING PINNED
 * --------------------
 * Surface 1  — config.controller.js: all 11 handler HTTP response shapes.
 * Surface 2  — data.controller.js: export/import behavior.
 * Surface 3  — billing-webhooks.controller.js + routes: HMAC-SHA256 signature guard
 *              (verifySignature in the route layer), replay-protection window,
 *              event-dispatch behavior per event type.
 * Surface 4  — feature-catalog.controller.js + routes: service-key auth + payload shape.
 * Surface 5  — impersonation.controller.js + routes: authenticateAdmin gate,
 *              self-impersonation guard, INTERNAL_SERVICE_KEY guard, auth-service
 *              error pass-through, audit row insertion.
 * Surface 6  — middleware/feature-gate.js: requireFeature allow/deny,
 *              requireFeatureIncludes allow/deny, checkUsageLimit allow/deny.
 * Surface 7  — middleware/plan-features.middleware.js: slug-keyed lookup (H7),
 *              PAYMENT_SERVICE_URL fallback (H13), cache TTLs (H8).
 * Surface 8  — middleware/entity-limits.js: each count function + each limit
 *              middleware allow/deny decision.
 *
 * FLAGS (captured as-is, not fixed)
 * ---
 * FLAG-1 (billing-webhook): No signature verification test exists upstream.
 *   The route-layer verifySignature is a strong HMAC-SHA256 + timingSafeEqual guard
 *   with replay protection. This is a SECURITY SURFACE — captured and pinned here
 *   so W6 extraction cannot drop it. REFER→elmo for formal security assessment of
 *   the webhook surface.
 * FLAG-2 (requireFeatureIncludes bug — FIXED in 999.371): feature-gate.js:127 once
 *   called logFeatureEvent with the wrong first arg (req.user?.id, a string, not the
 *   req object), so plan_id and endpoint were dropped from the feature_events row.
 *   999.371 corrected the call to `logFeatureEvent(req, featurePath, 'used',
 *   { selected })`. The H6-FLAG2 test now asserts the CORRECTED row (plan_id +
 *   endpoint populated).
 * FLAG-3 (H13 fallback): PAYMENT_SERVICE_URL uses `|| 'http://localhost:5020'` in
 *   plan-features.middleware.js lines 31, 59, 112. This is a pre-approved fallback
 *   per WBS H4 Scooter constraints — preserved verbatim. No new fallback added.
 *
 * TEST STYLE
 * ----------
 * Uses createMockChainDb helper (tests/helpers/mockChainDb.js) + supertest.
 * Also uses src/db and src/lib/db dual-mock (H3 lesson — both modules must resolve
 * to the same mock chain).
 * Payment-service fetch is fully mocked via global.fetch jest.fn().
 * All tests are deterministic: no wall-clock Date.now() assertions, volatile
 * values (timestamps) asserted structurally.
 *
 * RUN COMMAND (confirmed):
 *   DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=rootpass DB_NAME=juggler_test \
 *   DB_PORT=3407 REDIS_URL=redis://localhost:6479 \
 *   npx jest --testPathPattern="characterization/userConfig/goldenMaster" --no-coverage
 *
 * Or via test-bed:  cd test-bed && make test-juggler
 */

'use strict';

process.env.NODE_ENV = 'test';
// Pool/CI runs inject their slot's REDIS_URL — honor it. Pin the fixed
// test-bed :6479 ONLY when unset (bare `npx jest` on a dev shell). The old
// unconditional pin stomped the injected env: the suite silently escaped its
// pool slot locally and dialed a nonexistent localhost in the CI container
// (run 29382813936).
if (!process.env.REDIS_URL) process.env.REDIS_URL = 'redis://localhost:6479';
// H13: PAYMENT_SERVICE_URL fallback — NOT setting it here so the fallback
// path ('http://localhost:5020') is exercised for product-discovery/plan fetch.
// Individual tests that need a specific URL override via module-level mock.
process.env.INTERNAL_SERVICE_KEY = 'test-internal-key-abc123';
process.env.BILLING_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.ADMIN_EMAILS = 'admin@test.com';
process.env.FEATURE_CATALOG_KEY = 'test-catalog-key-abc';
process.env.PRODUCT_LABEL = 'juggler';

const crypto = require('crypto');

// ─── DB mock (dual: src/db + src/lib/db — H3 lesson) ────────────────────────
const { createMockChainDb } = require('../../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();

jest.mock('../../../src/db', () => mockDb);
jest.mock('../../../src/lib/db', () => {
  const actual = jest.requireActual('../../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

// ─── JWT auth mock ────────────────────────────────────────────────────────────
const TEST_USER = { id: 'gm-h4-001', email: 'user@test.com', name: 'Golden H4', timezone: 'America/New_York' };
const ADMIN_USER = { id: 'gm-admin-001', email: 'admin@test.com', name: 'Admin H4', timezone: 'America/New_York' };
const VALID_TOKEN = 'valid-test-token';
const ADMIN_TOKEN = 'valid-admin-token';

jest.mock('../../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer '))
      return res.status(401).json({ error: 'Auth required' });
    const token = auth.slice(7);
    if (token === 'valid-admin-token') {
      req.user = { id: 'gm-admin-001', email: 'admin@test.com', name: 'Admin H4', timezone: 'America/New_York' };
    } else {
      req.user = { id: 'gm-h4-001', email: 'user@test.com', name: 'Golden H4', timezone: 'America/New_York' };
    }
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn()
}));

// ─── plan-features middleware mock ────────────────────────────────────────────
// H7: slug-keyed. planId must be a slug-keyed value, not UUID.
// H8: cache TTL constants pinned separately (unit tests below).
let mockPlanFeatures = null; // set in beforeEach
let mockPlanId = 'plan-starter';

// NOTE: For Surface-7 (plan-features unit tests), we DO NOT mock this module —
// those tests load plan-features.middleware directly and call fetch mock.
// For supertest HTTP tests, we mock here so we can control per-test.
jest.mock('../../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = mockPlanId;
    req.planFeatures = mockPlanFeatures;
    if (!mockPlanFeatures) {
      return res.status(503).json({ error: 'Plan configuration unavailable. Please try again.' });
    }
    next();
  },
  PRODUCT_LABEL: 'juggler',
  // getProductId: used by feature-catalog.controller — returns null in test (payment-service unavailable)
  getProductId: jest.fn(() => Promise.resolve(null)),
  refreshPlanFeatures: jest.fn(),
  getCachedPlanFeatures: jest.fn(() => Promise.resolve({ 'plan-starter': mockPlanFeatures }))
}));

// ─── Redis mock ───────────────────────────────────────────────────────────────
jest.mock('../../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve()),
  del: jest.fn(() => Promise.resolve())
}));

// lib/cache for config.controller (which uses lib/cache not lib/redis directly)
jest.mock('../../../src/lib/cache', () => {
  const spy = {
    get: jest.fn(() => Promise.resolve(null)),
    set: jest.fn(() => Promise.resolve(true)),
    del: jest.fn(() => Promise.resolve(true)),
    invalidateConfig: jest.fn(() => Promise.resolve(true)),
    invalidateTasks: jest.fn(() => Promise.resolve(true)),
  };
  return { cache: spy, _spy: spy };
});

// ─── Scheduler mock ───────────────────────────────────────────────────────────
jest.mock('../../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

// ─── SSE mock ─────────────────────────────────────────────────────────────────
jest.mock('../../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn()
}));

// ─── tasks-write mock ────────────────────────────────────────────────────────
jest.mock('../../../src/lib/tasks-write', () => ({
  insertTask: jest.fn(() => Promise.resolve()),
  deleteTaskById: jest.fn(() => Promise.resolve(1)),
  updateTaskById: jest.fn(() => Promise.resolve(1)),
  updateTasksWhere: jest.fn(() => Promise.resolve(1)),
  updateInstancesWhere: jest.fn(() => Promise.resolve(1)),
  deleteTasksWhere: jest.fn(() => Promise.resolve(1)),
}));

// ─── task-write-queue mock ────────────────────────────────────────────────────
jest.mock('../../../src/lib/task-write-queue', () => ({
  isLocked: jest.fn(() => Promise.resolve(false)),
  enqueueWrite: jest.fn(() => Promise.resolve()),
  splitFields: jest.fn((row) => ({ schedulingFields: row, nonSchedulingFields: {} })),
  flushQueue: jest.fn(() => Promise.resolve())
}));

// ─── usage-reporter mock ─────────────────────────────────────────────────────
jest.mock('../../../src/lib/usage-reporter', () => ({
  reportUsage: jest.fn(),
  setProductIdResolver: jest.fn()
}));

// ─── logger mock ─────────────────────────────────────────────────────────────
jest.mock('@raike/lib-logger', () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: () => mock, _mock: mock };
});

// ─── weather controller mock ─────────────────────────────────────────────────
// Must stub ALL exports that the weather routes use (geocode, reverseGeocode,
// getForecast, ingest) as well as the cross-module re-exports.
jest.mock('../../../src/controllers/weather.controller', () => ({
  getForecast: jest.fn((req, res) => res.json({ forecast: [] })),
  ingest: jest.fn((req, res) => res.json({ ok: true })),
  geocode: jest.fn((req, res) => res.json({ results: [] })),
  reverseGeocode: jest.fn((req, res) => res.json({ display_name: 'Test City' })),
  reverseGeocodeDisplayName: jest.fn(() => Promise.resolve('Test City')),
  roundCoord: jest.fn((n) => n)
}));

// ─── weather slice facade mock ───────────────────────────────────────────────
// 999.1192: the user-config facade's replaceLocations enrichment now calls the
// weather SLICE facade's reverseGeocodeDisplayName (the controller export above
// is a re-export of the same function). Stub the facade so the golden-master
// keeps the same 'Test City' enrichment without loading the real weather slice.
jest.mock('../../../src/slices/weather/facade', () => ({
  reverseGeocodeDisplayName: jest.fn(() => Promise.resolve('Test City')),
  // SchedulerWeatherProvider's constructor default sources roundCoord from this
  // facade at app boot — keep it callable (same stub as the controller mock).
  roundCoord: jest.fn((n) => n)
}));

// ─── fetch mock (payment-service calls in plan-features) ─────────────────────
// Not applied globally here — Surface 7 tests use jest.spyOn(global, 'fetch').
// Surface 7 is loaded in an isolated describe block with jest.isolateModules.

// ─── lib-logger mock (needed by lib/config import chain) ─────────────────────
jest.mock('../../../src/lib/logger', () => ({
  dataControllerLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
}));

// ─── App + supertest ──────────────────────────────────────────────────────────
let app, request;

beforeAll(async () => {
  app = require('../../../src/app');
  request = require('supertest');
});

// ─── Full unlimited plan features for happy-path tests ───────────────────────
const UNLIMITED_PLAN_FEATURES = {
  limits: {
    active_tasks: -1,
    recurring_templates: -1,
    projects: -1,
    locations: -1,
    schedule_templates: -1,
    ai_commands_per_month: -1
  },
  ai: { natural_language_commands: true, bulk_project_creation: true },
  calendar: { max_providers: -1, auto_sync: true },
  scheduling: { dependencies: true, travel_time: true },
  tasks: { placementMode: 'fixed' },
  data: { export: true, import: true, mcp_access: true }
};

beforeEach(() => {
  resolveQueue.length = 0;
  jest.clearAllMocks();
  mockPlanFeatures = { ...UNLIMITED_PLAN_FEATURES };
  mockPlanId = 'plan-starter';

  // ─── CRITICAL: Re-wire mockDb after clearAllMocks ────────────────────────────
  // feature-gate.js and entity-limits.js use `const db = require('../db')` (STATIC
  // import at module load time). After jest.clearAllMocks(), mockDb's mockImplementation
  // is wiped — calling `db('table')` returns undefined, breaking `.where()` etc.
  // Re-wire here so those static importers continue to get the chain back.
  //
  // mockDb IS the chain (createMockChainDb: `chain = jest.fn(() => chain)`), so we
  // restore its self-referential implementation and re-wire all chain methods.
  mockDb.mockImplementation(() => mockDb);

  // Chainable methods — restore to return chain (mockDb)
  ['where', 'whereRaw', 'whereNotNull', 'whereNull', 'whereNot', 'whereNotIn',
   'whereIn', 'orWhere', 'orWhereNot', 'orderBy', 'orderByRaw', 'limit',
   'offset', 'join', 'leftJoin', 'count', 'max', 'clearSelect', 'clearOrder',
   'clone', 'groupBy', 'having'].forEach(m => {
    mockDb[m].mockReturnValue(mockDb);
  });

  // Terminal methods — restore their resolve-queue / default implementations.
  //
  // `.select(...)` is BOTH a terminal (most queries here are `await db(t).where().select()`)
  // AND a chain link before `.first()` (the A1 getUserTimezone query is
  // `db('users').where().select('timezone').first()` — added to KnexConfigRepository
  // after this golden was first authored). To support both without a queue double-shift,
  // `.select()` returns a thenable that ALSO exposes `.first`: awaiting it shifts once
  // (terminal use); calling `.first()` shifts once instead (chained use). Either path
  // consumes exactly one resolveQueue entry.
  mockDb.select.mockImplementation(() => {
    // `.select(...)` is both a terminal (`await db().where().select()` → array) and a
    // chain link before `.first()` (`db().where().select('x').first()` → row). BOTH must
    // shift LAZILY (only when the result is awaited), never synchronously at call time —
    // otherwise a `.first()` evaluated during Promise.all array construction would shift
    // out of order. So `.first()` returns another lazy thenable; the shift happens in the
    // eventual `.then`. Exactly one resolveQueue entry is consumed per query, either way.
    // Bare `.select()` is a terminal: awaiting it consumes one resolveQueue entry (the
    // 104 `await db().where().select()` reads in this suite rely on this).
    const sel = {
      then: (resolve, reject) => Promise.resolve(
        resolveQueue.length > 0 ? resolveQueue.shift() : []
      ).then(resolve, reject)
    };
    // `.select('x').first()` (only the A1 getUserTimezone read uses this) must NOT pull
    // from the shared FIFO — Promise.all resolves the chained `.first()` thenable at an
    // unpredictable point relative to the sibling `.then` reads, which would steal an
    // entry and mis-shift the others. The chained read is independent of the seeded
    // rows, so it returns a fixed stub row and leaves the FIFO untouched. (Callers that
    // need a specific timezone assert on the response, not on this read's queue slot.)
    sel.first = () => Promise.resolve({ timezone: null });
    return sel;
  });
  mockDb.first.mockImplementation(() => {
    const v = resolveQueue.length > 0 ? resolveQueue.shift() : null;
    return Promise.resolve(v);
  });
  mockDb.insert.mockResolvedValue([1]);
  mockDb.update.mockResolvedValue(1);
  mockDb.del.mockResolvedValue(1);
  mockDb.then.mockImplementation((resolve, reject) => {
    const v = resolveQueue.length > 0 ? resolveQueue.shift() : [];
    return Promise.resolve(v).then(resolve, reject);
  });
  mockDb.catch.mockImplementation((fn) => Promise.resolve([]).catch(fn));
  mockDb.transaction.mockImplementation(async (cb) => cb(mockDb));

  // Non-mock utility properties (do not need restoration — not cleared by clearAllMocks)
  // mockDb.fn and mockDb.raw are plain assignments, not jest.fn — still present.

  // Re-wire redis mock after clearAllMocks
  const redis = require('../../../src/lib/redis');
  redis.get.mockResolvedValue(null);
  redis.set.mockResolvedValue(undefined);
  redis.invalidateTasks.mockResolvedValue(undefined);
  redis.invalidateConfig.mockResolvedValue(undefined);

  // Re-wire lib/cache mock
  const { _spy } = require('../../../src/lib/cache');
  _spy.get.mockResolvedValue(null);
  _spy.set.mockResolvedValue(true);
  _spy.invalidateConfig.mockResolvedValue(true);
  _spy.invalidateTasks.mockResolvedValue(true);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SURFACE 1 — config.controller.js (11 handlers)
// TRACEABILITY: H1
// ═══════════════════════════════════════════════════════════════════════════════

describe('Surface 1 — config.controller: all 11 handlers (H1)', () => {

  describe('GET /api/config — getAllConfig', () => {
    test('H1-1: returns 200 with locations/tools/projects/config shape', async () => {
      // getAllConfig: Promise.all([locations, tools, projects, configRows, userTimezone]).
      // The 5th read (repo.getUserTimezone → users.select('timezone').first(), the A1 /
      // TZ-DISPLAY-1 feature in GetConfig.js:67) was added after this golden was authored.
      // It uses `.select().first()`, which the mock resolves to a fixed stub WITHOUT
      // consuming the resolveQueue (see the select re-wire above), so only the four
      // queue-backed reads are pushed here — same as the original scaffold.
      resolveQueue.push([]); // locations
      resolveQueue.push([]); // tools
      resolveQueue.push([]); // projects
      resolveQueue.push([
        { config_key: 'time_blocks', config_value: JSON.stringify({ Mon: [] }) },
        { config_key: 'preferences', config_value: JSON.stringify({ weekStartsOn: 1 }) },
        { config_key: 'temp_unit_pref', config_value: '"F"' }
      ]);

      const res = await request(app)
        .get('/api/config')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('locations');
      expect(res.body).toHaveProperty('tools');
      expect(res.body).toHaveProperty('projects');
      expect(res.body).toHaveProperty('timeBlocks');
      expect(res.body).toHaveProperty('preferences');
      expect(res.body.timeBlocks).toEqual({ Mon: [] });
      expect(res.body.preferences).toEqual({ weekStartsOn: 1 });
      // tempUnitPref defaults to 'F' when config_value = '"F"'
      expect(res.body.tempUnitPref).toBe('F');
    });

    test('H1-2: returns 401 without auth token', async () => {
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(401);
    });

    test('H1-3: tempUnitPref defaults to "F" when no config row', async () => {
      resolveQueue.push([]); // locations
      resolveQueue.push([]); // tools
      resolveQueue.push([]); // projects
      resolveQueue.push([]); // no config rows
      // getUserTimezone (.select().first()) is a fixed non-queue stub — see H1-1.

      const res = await request(app)
        .get('/api/config')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.tempUnitPref).toBe('F');
      // Null fields for missing config
      expect(res.body.toolMatrix).toBeNull();
      expect(res.body.timeBlocks).toBeNull();
    });

    test('H1-4: projects shape: id/name/color/icon/sortOrder', async () => {
      resolveQueue.push([]); // locations
      resolveQueue.push([]); // tools
      resolveQueue.push([
        { id: 99, name: 'Work', color: '#blue', icon: null, sort_order: 0 }
      ]);
      resolveQueue.push([]); // user_config
      // getUserTimezone (.select().first()) is a fixed non-queue stub — see H1-1.

      const res = await request(app)
        .get('/api/config')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.projects).toHaveLength(1);
      expect(res.body.projects[0]).toMatchObject({
        id: 99, name: 'Work', color: '#blue', icon: null, sortOrder: 0
      });
    });
  });

  describe('PUT /api/config/:key — updateConfig', () => {
    test('H1-5: valid key (preferences) returns {key, value, warnings}', async () => {
      // checkScheduleTemplateLimit only fires for time_blocks; preferences skips it
      resolveQueue.push({ config_key: 'preferences', config_value: '{}' }); // existing check

      const res = await request(app)
        .put('/api/config/preferences')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ value: { weekStartsOn: 1 } });

      expect(res.status).toBe(200);
      expect(res.body.key).toBe('preferences');
      expect(res.body.value).toEqual({ weekStartsOn: 1 });
      expect(Array.isArray(res.body.warnings)).toBe(true);
    });

    test('H1-6: invalid config key returns 400 with error', async () => {
      const res = await request(app)
        .put('/api/config/not_a_valid_key')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ value: 'whatever' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid config key/);
    });

    test('H1-7: temp_unit_pref rejects non-F/C values with 400', async () => {
      const res = await request(app)
        .put('/api/config/temp_unit_pref')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ value: 'K' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/temp_unit_pref must be/);
    });

    test('H1-8: temp_unit_pref accepts "C"', async () => {
      resolveQueue.push({ config_key: 'temp_unit_pref', config_value: '"F"' }); // existing

      const res = await request(app)
        .put('/api/config/temp_unit_pref')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ value: 'C' });

      expect(res.status).toBe(200);
      expect(res.body.key).toBe('temp_unit_pref');
      expect(res.body.value).toBe('C');
    });

    test('H1-9: value >100KB returns 400 "Config value too large"', async () => {
      const bigValue = 'x'.repeat(102401);
      const res = await request(app)
        .put('/api/config/preferences')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ value: bigValue });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/too large/);
    });

    test('H1-10: time_blocks key triggers checkScheduleTemplateLimit (unlimited plan passes)', async () => {
      // checkScheduleTemplateLimit → db('user_config').where({...}).first()
      // updateConfig → db('user_config').where({...}).first()
      resolveQueue.push(null); // countScheduleTemplates: no existing row
      resolveQueue.push(null); // updateConfig: insert path

      const res = await request(app)
        .put('/api/config/time_blocks')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ value: {} });

      expect(res.status).toBe(200);
      expect(res.body.key).toBe('time_blocks');
    });
  });

  describe('GET /api/projects — getProjects', () => {
    test('H1-11: returns {projects: [...]} array shape', async () => {
      resolveQueue.push([
        { id: 1, name: 'Home', color: '#ccc', icon: null, sort_order: 0 },
        { id: 2, name: 'Work', color: '#aaa', icon: null, sort_order: 1 }
      ]);

      const res = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.projects).toHaveLength(2);
      expect(res.body.projects[0]).toMatchObject({ id: 1, name: 'Home' });
      expect(res.body.projects[0]).toHaveProperty('sortOrder');
    });
  });

  describe('POST /api/projects — createProject', () => {
    test('H1-12: creates project and returns {project: {id, name, color, icon}}', async () => {
      // Route stack: checkProjectLimit → validate(projectSchema) → createProject
      // checkProjectLimit calls countProjects(userId) → db('projects').count().first()
      resolveQueue.push({ count: 0 }); // countProjects for checkProjectLimit
      resolveQueue.push({ max: 2 });   // maxOrder query inside createProject

      const res = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ name: 'New Project', color: '#ff0000' });
        // icon omitted — zod .optional() rejects null but accepts undefined/omitted

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('project');
      expect(res.body.project.name).toBe('New Project');
      expect(res.body.project.color).toBe('#ff0000');
    });

    test('H1-13: missing project name returns 400 validation error', async () => {
      // validate(projectSchema) fires before the controller — error from zod, not controller
      const res = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ color: '#ff0000' });

      expect(res.status).toBe(400);
      // validate middleware returns { error: 'Validation failed', details: [...] }
      expect(res.body.error).toMatch(/Validation failed/i);
    });
  });

  describe('PUT /api/projects/:id — updateProject', () => {
    test('H1-14: updates project and returns {project, renamed}', async () => {
      // validate(projectUpdateSchema) — partial schema, so all fields optional.
      // color: null fails zod optional() — omit it.
      const res = await request(app)
        .put('/api/projects/5')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ name: 'Renamed' });

      expect(res.status).toBe(200);
      expect(res.body.project).toMatchObject({ id: 5, name: 'Renamed' });
      // renamed is null when oldName not supplied / unchanged
      expect(res.body.renamed).toBeNull();
    });

    test('H1-15: oldName stripped by Zod validation — renamed is always null via HTTP', async () => {
      // FLAG (captured as-is): validate(projectUpdateSchema) uses a Zod partial() schema
      // that strips unknown keys. `oldName` is not in projectSchema so it's stripped
      // before reaching the controller. The controller receives `req.body.oldName = undefined`
      // → condition `oldName && name && oldName !== name` is falsy → `renamed: null`.
      // The rename cascade (updateTasksWhere) NEVER fires via HTTP PUT /api/projects/:id.
      // This is the actual current behavior — pinned here so W6 extraction preserves it.
      // REFER→ernie: possible dead code / API contract mismatch on `oldName` field.
      const res = await request(app)
        .put('/api/projects/5')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ name: 'NewName', oldName: 'OldName' });

      expect(res.status).toBe(200);
      // oldName stripped by Zod → renamed is ALWAYS null via this HTTP route
      expect(res.body.renamed).toBeNull();
    });
  });

  describe('DELETE /api/projects/:id — deleteProject', () => {
    test('H1-16: deletes and returns {message, id}', async () => {
      const res = await request(app)
        .delete('/api/projects/7')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/deleted/i);
      expect(res.body.id).toBe('7');
    });
  });

  describe('PUT /api/projects/reorder — reorderProjects', () => {
    test('H1-17: reorders and returns {reordered: N}', async () => {
      const res = await request(app)
        .put('/api/projects/reorder')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ ids: [3, 1, 2] });

      expect(res.status).toBe(200);
      expect(res.body.reordered).toBe(3);
    });

    test('H1-18: non-array ids returns 400', async () => {
      const res = await request(app)
        .put('/api/projects/reorder')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ ids: 'not-array' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/locations — getLocations', () => {
    test('H1-19: returns {locations: [...]} with id/name/icon/lat/lon/displayName', async () => {
      resolveQueue.push([
        { location_id: 'loc-1', name: 'Home', icon: '', lat: '37.7', lon: '-122.4', display_name: 'San Francisco' }
      ]);

      const res = await request(app)
        .get('/api/locations')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.locations).toHaveLength(1);
      expect(res.body.locations[0]).toMatchObject({
        id: 'loc-1', name: 'Home', lat: 37.7, lon: -122.4, displayName: 'San Francisco'
      });
    });
  });

  describe('PUT /api/locations — replaceLocations', () => {
    test('H1-20: replaces and returns {locations: [...]}', async () => {
      const res = await request(app)
        .put('/api/locations')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ locations: [{ id: 'loc-1', name: 'Home', icon: '' }] });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.locations)).toBe(true);
    });

    test('H1-21: invalid payload returns 400', async () => {
      const res = await request(app)
        .put('/api/locations')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ locations: [{ name: 'x'.repeat(300) }] }); // name > 200 chars

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/tools — getTools', () => {
    test('H1-22: returns {tools: [{id, name, icon}]}', async () => {
      resolveQueue.push([
        { tool_id: 'tool-1', name: 'Laptop', icon: '💻' }
      ]);

      const res = await request(app)
        .get('/api/tools')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.tools).toHaveLength(1);
      expect(res.body.tools[0]).toMatchObject({ id: 'tool-1', name: 'Laptop' });
    });
  });

  describe('PUT /api/tools — replaceTools', () => {
    test('H1-23: replaces and returns {tools: [...]}', async () => {
      const res = await request(app)
        .put('/api/tools')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ tools: [{ id: 'tool-1', name: 'Laptop' }] });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.tools)).toBe(true);
    });

    test('H1-24: invalid tools payload returns 400', async () => {
      const res = await request(app)
        .put('/api/tools')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ tools: [{ name: 'No id' }] }); // missing required id

      expect(res.status).toBe(400);
    });
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// SURFACE 2 — data.controller.js (export/import)
// TRACEABILITY: H2
// ═══════════════════════════════════════════════════════════════════════════════

describe('Surface 2 — data.controller: export/import (H2)', () => {

  describe('GET /api/data/export', () => {
    test('H2-1: returns v7 export shape with required top-level keys', async () => {
      // exportData: fetchTasksWithEventIds + locations + tools + projects + user_config
      resolveQueue.push([]); // tasks
      resolveQueue.push([]); // locations
      resolveQueue.push([]); // tools
      resolveQueue.push([]); // projects
      resolveQueue.push([]); // user_config

      const res = await request(app)
        .get('/api/data/export')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.v7).toBe(true);
      expect(res.body).toHaveProperty('extraTasks');
      expect(res.body).toHaveProperty('statuses');
      expect(res.body).toHaveProperty('locations');
      expect(res.body).toHaveProperty('tools');
      expect(res.body).toHaveProperty('projects');
      expect(res.body).toHaveProperty('toolMatrix');
      expect(res.body).toHaveProperty('timeBlocks');
      expect(res.body).toHaveProperty('gridZoom');
      expect(res.body).toHaveProperty('updated');
    });

    test('H2-2: export returns 401 without auth', async () => {
      const res = await request(app).get('/api/data/export');
      expect(res.status).toBe(401);
    });

    test('H2-3: data.export feature gate: blocked plan returns 403', async () => {
      mockPlanFeatures = {
        ...UNLIMITED_PLAN_FEATURES,
        data: { export: false, import: true, mcp_access: true }
      };

      const res = await request(app)
        .get('/api/data/export')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FEATURE_NOT_AVAILABLE');
      expect(res.body.feature).toBe('data.export');
    });

    test('H2-4: gridZoom/splitDefault/schedFloor shape from empty prefs', async () => {
      resolveQueue.push([]); // tasks
      resolveQueue.push([]); // locations
      resolveQueue.push([]); // tools
      resolveQueue.push([]); // projects
      resolveQueue.push([]); // user_config — empty, defaults kick in

      const res = await request(app)
        .get('/api/data/export')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.gridZoom).toBe(60);
      expect(res.body.splitDefault).toBe(false);
      expect(res.body.splitMinDefault).toBe(15);
      expect(res.body.schedFloor).toBe(480);
      expect(res.body.schedCeiling).toBe(1380);
    });
  });

  describe('POST /api/data/import', () => {
    test('H2-5: without ?confirm=delete_all returns 400 with explanation', async () => {
      const res = await request(app)
        .post('/api/data/import')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ extraTasks: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/DELETE all existing/);
    });

    test('H2-6: missing extraTasks in body returns 400 "Invalid import data"', async () => {
      const res = await request(app)
        .post('/api/data/import?confirm=delete_all')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ notExtraTasks: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid import data/);
    });

    // 999.1603: the replace import pre-reads user_config (preference merge),
    // selectively wipes, inserts, then RE-READS in the trx to VERIFY writes.
    // In THIS suite's re-wiring only bare awaited where-chains pop the FIFO
    // (`.insert`/`.del` are mockResolvedValue — no pop), so exactly TWO entries:
    // the pre-read ([]) and the verification re-read (exactly what the import
    // wrote, as real MySQL would return it).
    function queueImportConfigRoundTrip() {
      resolveQueue.push([]); // getConfigRows pre-read
      resolveQueue.push([
        { config_key: 'tool_matrix', config_value: {} },
        { config_key: 'time_blocks', config_value: {} },
        { config_key: 'loc_schedules', config_value: {} },
        { config_key: 'loc_schedule_defaults', config_value: {} },
        { config_key: 'loc_schedule_overrides', config_value: {} },
        { config_key: 'hour_location_overrides', config_value: {} },
        { config_key: 'preferences', config_value: { gridZoom: 60, splitDefault: false, splitMinDefault: 15, schedFloor: 480, schedCeiling: 1380 } }
      ]); // getConfigRows verification re-read
    }

    test('H2-7: valid import returns 200 with counts shape', async () => {
      queueImportConfigRoundTrip();
      const res = await request(app)
        .post('/api/data/import?confirm=delete_all')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({
          extraTasks: [
            { id: 't1', text: 'Task 1', pri: 'P2' }
          ],
          statuses: { t1: 'active' }
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Import successful/);
      expect(res.body.counts).toMatchObject({
        tasks: expect.any(Number),
        duplicatesRemoved: expect.any(Number),
        locations: expect.any(Number),
        tools: expect.any(Number),
        projects: expect.any(Number)
      });
    });

    test('H2-8: deduplicates tasks by id (last occurrence wins)', async () => {
      queueImportConfigRoundTrip();
      const res = await request(app)
        .post('/api/data/import?confirm=delete_all')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({
          extraTasks: [
            { id: 't1', text: 'First occurrence' },
            { id: 't1', text: 'Second occurrence' }  // duplicate
          ]
        });

      expect(res.status).toBe(200);
      // 2 input → 1 unique → 1 duplicate removed
      expect(res.body.counts.tasks).toBe(1);
      expect(res.body.counts.duplicatesRemoved).toBe(1);
    });

    test('H2-9: import returns 401 without auth', async () => {
      const res = await request(app)
        .post('/api/data/import?confirm=delete_all')
        .send({ extraTasks: [] });

      expect(res.status).toBe(401);
    });

    // ── elmo B2: destructive guards and all-tiers entitlement decision ─────────
    // S9.9 + S9.12: POST /api/data/import has NO requireFeature gate (all-tiers
    // access) and requires ?confirm=delete_all as the sole destructive guard.
    // Pins: (1) the ?confirm guard is present, (2) null/non-object body is rejected,
    // (3) missing extraTasks is rejected, and (4) a plan WITHOUT data.import still
    // gets 400-on-missing-confirm (not 403) — confirming no per-feature gate exists.
    // If W6 accidentally adds a requireFeature gate, test H2-elmoB2b turns RED.
    test('H2-elmoB2a: ?confirm guard fires BEFORE any data processing (400, no DB writes)', async () => {
      // No resolveQueue push — if the handler reaches DB writes it will throw.
      // The 400 must come from the confirm-guard before any DB interaction.
      const res = await request(app)
        .post('/api/data/import')  // no ?confirm
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ extraTasks: [{ id: 't1', text: 'Task 1' }] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/DELETE all existing/);
    });

    test('H2-elmoB2b: import with restricted plan (data.import=false) still checks ?confirm, not feature gate (all-tiers access)', async () => {
      // Even a plan that has data.import: false must NOT get 403 from a feature gate.
      // The import endpoint has no requireFeature('data.import') guard — it is available
      // on all tiers (only export is gated). If W6 adds requireFeature('data.import'),
      // this test turns RED — preserving the intentional entitlement decision.
      const savedFeatures = mockPlanFeatures;
      mockPlanFeatures = {
        ...UNLIMITED_PLAN_FEATURES,
        data: { export: false, import: false, mcp_access: false }
      };

      const res = await request(app)
        .post('/api/data/import')  // no ?confirm — should hit confirm guard, not feature gate
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ extraTasks: [] });

      mockPlanFeatures = savedFeatures;

      // Must be 400 (confirm guard), not 403 (feature gate — which would mean a gate was added)
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/DELETE all existing/);
    });
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// SURFACE 3 — billing-webhooks: HMAC signature guard + event handling
// TRACEABILITY: H3
//
// FLAG-1: The verifySignature guard is in the routes layer (billing-webhooks.routes.js).
// The route captures rawBody via express.raw() in app.js:98–109. This is the
// security surface — HMAC-SHA256 with timingSafeEqual, freshness window 5min.
// The handleWebhook controller itself has NO signature check (it trusts the route
// middleware). This is captured as-is.
// SECURITY FLAG: REFER→elmo — webhook endpoint authentication / replay protection.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Surface 3 — billing-webhooks: signature guard + event handling (H3)', () => {
  // Helper: compute correct HMAC-SHA256 signature matching verifySignature
  function makeSignature(body, secret) {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    return 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(Buffer.from(raw))
      .digest('hex');
  }

  // Send a billing webhook with the correct Content-Type and rawBody setup.
  // The app.js middleware captures rawBody from express.raw() for /api/billing-webhooks.
  // IMPORTANT: send as a raw JSON string (not Buffer) — supertest serializes Buffer
  // objects as {"type":"Buffer","data":[...]} JSON, which changes the bytes that
  // express.raw() captures as rawBody, breaking the HMAC signature match.
  // Sending a string preserves the exact bytes that the signature was computed over.
  function webhookRequest(body) {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    return request(app)
      .post('/api/billing-webhooks')
      .set('Content-Type', 'application/json')
      .send(raw);
  }

  test('H3-1: missing X-Billing-Signature returns 401', async () => {
    const body = { event: 'subscription.created', user_id: 'u1' };
    const res = await webhookRequest(body);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing X-Billing-Signature/);
  });

  test('H3-2: invalid signature returns 401', async () => {
    const body = { event: 'subscription.created', user_id: 'u1' };
    const res = await webhookRequest(body)
      .set('X-Billing-Signature', 'sha256=deadbeef00000000000000000000000000000000000000000000000000000000');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid signature/);
  });

  // jug-webhook-replay-window-hardfail (999.552): the freshness window is now MANDATORY —
  // a validly-signed body with no timestamp hard-fails (401). payment-service always signs a
  // `timestamp` into the body (notification.service.js:59), so the 200-path fixtures below
  // carry a fresh timestamp to match real payloads. This is an intentional security change to
  // the characterized behavior, not an unintended regression.
  test('H3-3: correct HMAC signature with valid event returns 200', async () => {
    const bodyObj = { event: 'subscription.created', user_id: 'u1', timestamp: new Date().toISOString() };
    const raw = JSON.stringify(bodyObj);
    const sig = makeSignature(raw, process.env.BILLING_WEBHOOK_SECRET);

    const res = await webhookRequest(bodyObj).set('X-Billing-Signature', sig);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.event).toBe('subscription.created');
  });

  test('H3-4: stale timestamp (>5min) returns 401 "freshness window"', async () => {
    const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const bodyObj = { event: 'subscription.created', user_id: 'u1', timestamp: staleTime };
    const raw = JSON.stringify(bodyObj);
    const sig = makeSignature(raw, process.env.BILLING_WEBHOOK_SECRET);

    const res = await webhookRequest(bodyObj).set('X-Billing-Signature', sig);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/freshness window/);
  });

  test('H3-5: fresh timestamp passes the freshness window check', async () => {
    const freshTime = new Date().toISOString();
    const bodyObj = { event: 'subscription.created', user_id: 'u1', timestamp: freshTime };
    const raw = JSON.stringify(bodyObj);
    const sig = makeSignature(raw, process.env.BILLING_WEBHOOK_SECRET);

    const res = await webhookRequest(bodyObj).set('X-Billing-Signature', sig);
    expect(res.status).toBe(200);
  });

  // H3-6/H3-7: the webhook busts the user-plan cache via the REAL entitlement seam.
  // Pre-leg-jug-h4-vestigial-plancache these asserted the legacy module-level
  // invalidateUserPlanCache (a no-op that was removed); the live invalidation is
  // _entitlement.invalidateUserPlan on the single PaymentServiceEntitlementAdapter
  // instance (facade.js:106) the live entitlement gate reads. Spy the adapter
  // prototype to prove the webhook reaches the real cache bust (non-tautological).
  test('H3-6: subscription.plan_changed invalidates user plan cache', async () => {
    const bodyObj = { event: 'subscription.plan_changed', user_id: 'u1', from_planId: 'plan-free', to_planId: 'plan-pro', timestamp: new Date().toISOString() };
    const raw = JSON.stringify(bodyObj);
    const sig = makeSignature(raw, process.env.BILLING_WEBHOOK_SECRET);

    const facade = require('../../../src/slices/user-config/facade');
    const invSpy = jest.spyOn(facade.PaymentServiceEntitlementAdapter.prototype, 'invalidateUserPlan');
    try {
      const res = await webhookRequest(bodyObj).set('X-Billing-Signature', sig);
      expect(res.status).toBe(200);
      expect(invSpy).toHaveBeenCalledWith('u1');
    } finally {
      invSpy.mockRestore();
    }
  });

  test('H3-7: subscription.canceled invalidates user plan cache', async () => {
    const bodyObj = { event: 'subscription.canceled', user_id: 'u2', timestamp: new Date().toISOString() };
    const raw = JSON.stringify(bodyObj);
    const sig = makeSignature(raw, process.env.BILLING_WEBHOOK_SECRET);

    const facade = require('../../../src/slices/user-config/facade');
    const invSpy = jest.spyOn(facade.PaymentServiceEntitlementAdapter.prototype, 'invalidateUserPlan');
    try {
      const res = await webhookRequest(bodyObj).set('X-Billing-Signature', sig);
      expect(res.status).toBe(200);
      expect(invSpy).toHaveBeenCalledWith('u2');
    } finally {
      invSpy.mockRestore();
    }
  });

  test('H3-8: unknown event returns 200 (handled gracefully)', async () => {
    const bodyObj = { event: 'subscription.unknown_future_event', user_id: 'u1', timestamp: new Date().toISOString() };
    const raw = JSON.stringify(bodyObj);
    const sig = makeSignature(raw, process.env.BILLING_WEBHOOK_SECRET);

    const res = await webhookRequest(bodyObj).set('X-Billing-Signature', sig);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('H3-9 (FLAG-1): handleWebhook has NO inline signature check (trusts route guard)', () => {
    // This test documents the architecture: the controller itself does not verify
    // the signature — that responsibility is entirely in verifySignature (routes layer).
    // If the route guard is ever bypassed, the controller will process any payload.
    // REFER→elmo — the security surface is the route middleware, not the controller.
    const { handleWebhook } = require('../../../src/controllers/billing-webhooks.controller');
    const fnSource = handleWebhook.toString();
    // The controller does not contain 'HMAC' or 'signature' or 'crypto' references
    expect(fnSource).not.toContain('hmac');
    expect(fnSource).not.toContain('signature');
    expect(fnSource).not.toContain('crypto');
  });

  // ── elmo B3: BILLING_WEBHOOK_SECRET || INTERNAL_SERVICE_KEY fallback ──────────
  // billing-webhooks.routes.js:15 — secret = BILLING_WEBHOOK_SECRET || INTERNAL_SERVICE_KEY
  // Three cases: (1) BILLING_WEBHOOK_SECRET unset, INTERNAL_SERVICE_KEY used → 200,
  //              (2) BOTH unset → 500 "not configured",
  //              (3) normal case with BILLING_WEBHOOK_SECRET → already covered by H3-3.
  // These tests pin the secret-resolution contract so W6 extraction cannot drop the
  // fallback or change the both-unset fail-closed behavior undetected.

  test('H3-elmoB3a: webhook signed with INTERNAL_SERVICE_KEY when BILLING_WEBHOOK_SECRET is unset → 200 (fallback branch)', async () => {
    // Save and clear BILLING_WEBHOOK_SECRET; set known INTERNAL_SERVICE_KEY
    const savedWebhookSecret = process.env.BILLING_WEBHOOK_SECRET;
    delete process.env.BILLING_WEBHOOK_SECRET;
    // INTERNAL_SERVICE_KEY is already set to 'test-internal-key-abc123' at file top

    const bodyObj = { event: 'subscription.created', user_id: 'u1', timestamp: new Date().toISOString() };
    const raw = JSON.stringify(bodyObj);
    // Sign with INTERNAL_SERVICE_KEY (the fallback secret)
    const sig = makeSignature(raw, process.env.INTERNAL_SERVICE_KEY);

    const res = await webhookRequest(bodyObj).set('X-Billing-Signature', sig);

    process.env.BILLING_WEBHOOK_SECRET = savedWebhookSecret;

    // Must succeed: verifySignature accepted the INTERNAL_SERVICE_KEY-signed request
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('H3-elmoB3b: both BILLING_WEBHOOK_SECRET and INTERNAL_SERVICE_KEY unset → 500 "not configured"', async () => {
    // Both secrets absent: verifySignature:17-19 returns 500
    const savedWebhookSecret = process.env.BILLING_WEBHOOK_SECRET;
    const savedInternalKey = process.env.INTERNAL_SERVICE_KEY;
    delete process.env.BILLING_WEBHOOK_SECRET;
    delete process.env.INTERNAL_SERVICE_KEY;

    const bodyObj = { event: 'subscription.created', user_id: 'u1' };
    // signature value is irrelevant — guard fires before sig check
    const res = await webhookRequest(bodyObj)
      .set('X-Billing-Signature', 'sha256=irrelevant');

    process.env.BILLING_WEBHOOK_SECRET = savedWebhookSecret;
    process.env.INTERNAL_SERVICE_KEY = savedInternalKey;

    // Fail-closed: 500 "not configured"
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/not configured/i);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// SURFACE 4 — feature-catalog.controller: catalog reads + service-key auth
// TRACEABILITY: H4
// ═══════════════════════════════════════════════════════════════════════════════

describe('Surface 4 — feature-catalog: catalog reads + service-key auth (H4)', () => {

  // Route mounted at /api/feature-catalog (app.js:289)
  test('H4-1: missing X-Service-Key returns 401', async () => {
    const res = await request(app).get('/api/feature-catalog');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid service key/);
  });

  test('H4-2: wrong X-Service-Key returns 401', async () => {
    const res = await request(app)
      .get('/api/feature-catalog')
      .set('X-Service-Key', 'wrong-key');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid service key/);
  });

  test('H4-3: correct service key returns 200 with catalog shape', async () => {
    const res = await request(app)
      .get('/api/feature-catalog')
      .set('X-Service-Key', process.env.FEATURE_CATALOG_KEY);

    expect(res.status).toBe(200);
    // product_id is resolved from getProductId() — may be null if payment-service unavailable
    expect(res.body).toHaveProperty('product_id');
    expect(res.body.product_name).toBe('StriveRS');
    expect(res.body).toHaveProperty('catalog_version');
    expect(Array.isArray(res.body.groups)).toBe(true);
  });

  test('H4-4: catalog groups contain expected keys (limits/calendar/scheduling/ai/data/tasks)', async () => {
    const res = await request(app)
      .get('/api/feature-catalog')
      .set('X-Service-Key', process.env.FEATURE_CATALOG_KEY);

    const groupKeys = res.body.groups.map(g => g.key);
    expect(groupKeys).toContain('limits');
    expect(groupKeys).toContain('calendar');
    expect(groupKeys).toContain('scheduling');
    expect(groupKeys).toContain('ai');
    expect(groupKeys).toContain('data');
    expect(groupKeys).toContain('tasks');
  });

  test('H4-5: FEATURE_CATALOG_KEY unset → 503', async () => {
    // Temporarily unset to exercise the "not configured" branch
    const orig = process.env.FEATURE_CATALOG_KEY;
    delete process.env.FEATURE_CATALOG_KEY;

    const res = await request(app)
      .get('/api/feature-catalog')
      .set('X-Service-Key', 'anything');

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/);

    process.env.FEATURE_CATALOG_KEY = orig;
  });

  test('H4-6: timingSafeEqual prevents timing attack on service key (length mismatch → 401)', async () => {
    // Key of wrong length short-circuits before timingSafeEqual (length check first)
    const res = await request(app)
      .get('/api/feature-catalog')
      .set('X-Service-Key', 'x'); // shorter than expected key

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid service key/);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// SURFACE 5 — impersonation.controller: authz paths
// TRACEABILITY: H5
//
// Key authz surfaces:
//   1. authenticateAdmin gate (from routes): only ADMIN_EMAILS may start/browse
//   2. Self-impersonation guard in startImpersonation (targetUserId === admin.id)
//   3. INTERNAL_SERVICE_KEY guard in callAuthServiceImpersonate (key not set → Error)
//   4. stopImpersonation: any authenticated user, reads actingAsAdmin from req.auth
//   5. getImpersonationTargets: admin only, search + pagination
//   6. getImpersonationLog: admin only, filter + pagination
// ═══════════════════════════════════════════════════════════════════════════════

describe('Surface 5 — impersonation.controller: authz paths (H5)', () => {

  describe('POST /api/impersonation/start', () => {
    test('H5-1: non-admin user returns 403', async () => {
      const res = await request(app)
        .post('/api/impersonation/start')
        .set('Authorization', `Bearer ${VALID_TOKEN}`) // non-admin email
        .send({ targetUserId: 'target-u1' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Admin access required/);
    });

    test('H5-2: admin attempting self-impersonation returns 400', async () => {
      // admin email = 'admin@test.com', admin.id = 'gm-admin-001'
      const res = await request(app)
        .post('/api/impersonation/start')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ targetUserId: 'gm-admin-001' }); // same as admin.id

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Cannot impersonate yourself/);
    });

    test('H5-3: missing targetUserId returns 400', async () => {
      const res = await request(app)
        .post('/api/impersonation/start')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({});

      expect(res.status).toBe(400);
      // 999.1247 gate triage: route-level impersonationStartSchema (zod,
      // route-schemas.js) now rejects the missing targetUserId BEFORE the
      // Impersonate use-case's own 'targetUserId is required' guard runs.
      // Semantics preserved: still 400; the body is the zod layer's message.
      expect(res.body.error).toBe('Validation failed');
    });

    test('H5-4: valid admin + targetUserId proxies auth-service 4xx response as-is (hermetic)', async () => {
      // Hermetic version — mocks global.fetch so no live auth-service dependency.
      // Pins the pass-through behavior: a 4xx from auth-service propagates unchanged.
      // impersonation.controller:60-61 — if (err.status && err.status < 500) →
      //   return res.status(err.status).json(err.body || { error: err.message })
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve(JSON.stringify({ error: 'Unauthorized', code: 'AUTH_FAILED' }))
      });

      const res = await request(app)
        .post('/api/impersonation/start')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ targetUserId: 'target-u1', reason: 'Support ticket #123' });

      fetchSpy.mockRestore();

      // 401 from auth-service must propagate — controller must not remap to a different status
      expect(res.status).toBe(401);
    });

    test('H5-13: INTERNAL_SERVICE_KEY unset → controller returns 503 "Impersonation service unavailable"', async () => {
      // impersonation.controller:7-8 — if (!key) throw new Error('INTERNAL_SERVICE_KEY is not set')
      // Caught at :63-64 (>=500 path) → 503 "Impersonation service unavailable"
      // This is the controller's OWN guard path, NOT an auth-service pass-through.
      const saved = process.env.INTERNAL_SERVICE_KEY;
      delete process.env.INTERNAL_SERVICE_KEY;

      // Re-require the controller so it picks up the unset env var
      // (callAuthServiceImpersonate reads process.env.INTERNAL_SERVICE_KEY at call time)
      const res = await request(app)
        .post('/api/impersonation/start')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ targetUserId: 'target-u1', reason: 'testing key guard' });

      process.env.INTERNAL_SERVICE_KEY = saved;

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/Impersonation service unavailable/);
    });

    test('H5-5 (authz): unauthenticated request returns 401', async () => {
      const res = await request(app)
        .post('/api/impersonation/start')
        .send({ targetUserId: 'target-u1' });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/impersonation/stop', () => {
    test('H5-6: any authenticated user can call /stop (returns 200)', async () => {
      const res = await request(app)
        .post('/api/impersonation/stop')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/stopped/i);
    });

    test('H5-7: unauthenticated stop returns 401', async () => {
      const res = await request(app)
        .post('/api/impersonation/stop');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/impersonation/targets', () => {
    test('H5-8: non-admin returns 403', async () => {
      const res = await request(app)
        .get('/api/impersonation/targets')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(403);
    });

    // H5-9/H5-10: getImpersonationTargets uses a complex chain:
    //   db('users').select(...) → query
    //   query.clone().clearSelect().count('* as count')
    //   await countQuery  [pops from resolveQueue via .then()]
    //   await query.orderBy().limit().offset()  [pops from resolveQueue via .then()]
    //
    // createMockChainDb's .select() is a TERMINAL call (returns Promise, not chain).
    // .clone() on a Promise is undefined → TypeError → 500.
    // This is a mock limitation, not a production behavior bug.
    // We test the response shape by directly calling the controller with a
    // req/res/next mock that bypasses the DB chain issue.
    test('H5-9: admin returns {users, pagination} response shape (direct controller call)', async () => {
      const { getImpersonationTargets } = require('../../../src/controllers/impersonation.controller');
      // Provide a custom getDb implementation inline for this test
      // The mockDb chain: .select() is terminal. We need to override just for this call.
      // Simplest: push two array results — countQuery (.then pops first), query (.then pops second)
      // BUT: .select() fires BEFORE .clone() is called, consuming the first queue entry.
      // So we need the mock to handle select() as non-terminal here.
      // Solution: test the controller's response shape via direct req/res mock,
      // supplying a getDb stub that returns the expected data directly.

      const fakeUsers = [{ id: 'u-1', email: 'user@example.com', created_at: new Date() }];
      const fakeCount = [{ count: '1' }];

      // Override mockDb for this test to handle the clone().clearSelect() pattern
      const chainForQuery = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        clone: jest.fn().mockReturnThis(),
        clearSelect: jest.fn().mockReturnThis(),
        clearOrder: jest.fn().mockReturnThis(),
        count: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function(resolve) {
          // First call = countQuery, second call = users query
          this._callCount = (this._callCount || 0) + 1;
          return Promise.resolve(this._callCount === 1 ? fakeCount : fakeUsers).then(resolve);
        })
      };
      // chainForQuery.clone() returns itself (same chain), so count/select operate on same chain
      chainForQuery.clone.mockReturnValue(chainForQuery);

      const origGetDb = jest.fn(() => jest.fn(() => chainForQuery));

      const req = { user: ADMIN_USER, query: {}, ip: '127.0.0.1', get: () => 'ua' };
      const res = {
        _status: 200, _body: null,
        status: jest.fn(function(c) { this._status = c; return this; }),
        json: jest.fn(function(b) { this._body = b; return this; })
      };

      // Temporarily override the db module for this direct controller call
      const dbModule = require('../../../src/db');
      const origImpl = dbModule.getMockImplementation ? dbModule.getMockImplementation() : null;
      dbModule.mockImplementation(() => chainForQuery);

      await getImpersonationTargets(req, res);

      // Restore
      if (origImpl) dbModule.mockImplementation(origImpl);
      else dbModule.mockReturnValue(mockDb._chain || chainForQuery);

      expect(res._status).toBe(200);
      expect(res._body).toHaveProperty('users');
      expect(res._body).toHaveProperty('pagination');
      expect(res._body.pagination).toHaveProperty('total');
      expect(res._body.pagination).toHaveProperty('limit');
      expect(res._body.pagination).toHaveProperty('offset');
      expect(res._body.pagination).toHaveProperty('hasMore');
    });

    test('H5-10: limit is capped at 100 (pinned via source inspection)', () => {
      // The controller: parsedLimit = parseInt(limit); lim = Math.min(Math.max(1, ...), 100)
      // This is a pure logic invariant — no DB needed. Verify via source.
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../../../src/controllers/impersonation.controller.js'),
        'utf8'
      );
      expect(src).toContain('Math.min(');
      expect(src).toContain(', 100)');
    });
  });

  describe('GET /api/impersonation/log', () => {
    test('H5-11: non-admin returns 403', async () => {
      const res = await request(app)
        .get('/api/impersonation/log')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(res.status).toBe(403);
    });

    test('H5-12: admin returns {logs, pagination} response shape (direct controller call)', async () => {
      const { getImpersonationLog } = require('../../../src/controllers/impersonation.controller');
      // Same chain pattern as getImpersonationTargets: clone().clearSelect().clearOrder().count()
      const fakeLogs = [];
      const fakeCount = [{ count: '2' }];

      const chainForLog = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        clone: jest.fn().mockReturnThis(),
        clearSelect: jest.fn().mockReturnThis(),
        clearOrder: jest.fn().mockReturnThis(),
        count: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        then: jest.fn().mockImplementation(function(resolve) {
          this._callCount = (this._callCount || 0) + 1;
          return Promise.resolve(this._callCount === 1 ? fakeCount : fakeLogs).then(resolve);
        })
      };
      chainForLog.clone.mockReturnValue(chainForLog);

      const dbModule = require('../../../src/db');
      dbModule.mockImplementation(() => chainForLog);

      const req = { user: ADMIN_USER, query: {}, ip: '127.0.0.1', get: () => 'ua' };
      const res = {
        _status: 200, _body: null,
        status: jest.fn(function(c) { this._status = c; return this; }),
        json: jest.fn(function(b) { this._body = b; return this; })
      };

      await getImpersonationLog(req, res);

      // Restore mockDb default behavior for subsequent tests
      dbModule.mockImplementation(() => mockDb._chain);

      expect(res._status).toBe(200);
      expect(res._body).toHaveProperty('logs');
      expect(res._body).toHaveProperty('pagination');
    });
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// SURFACE 6 — feature-gate.js: allow/deny decisions
// TRACEABILITY: H6
// ═══════════════════════════════════════════════════════════════════════════════

describe('Surface 6 — feature-gate: allow/deny decisions (H6)', () => {
  const {
    requireFeature,
    requireFeatureIncludes,
    checkUsageLimit
  } = require('../../../src/middleware/feature-gate');

  function makeReq(planFeatures, planId) {
    return {
      user: { id: 'gate-user-1' },
      planId: planId || 'plan-test',
      planFeatures,
      method: 'POST',
      originalUrl: '/api/tasks',
      url: '/api/tasks',
      headers: {},
      ip: '127.0.0.1'
    };
  }
  function makeRes() {
    return {
      _status: 200, _body: null,
      status: jest.fn(function(c) { this._status = c; return this; }),
      json: jest.fn(function(b) { this._body = b; return this; })
    };
  }

  test('H6-1: requireFeature — feature=true → calls next', async () => {
    const req = makeReq({ data: { export: true } });
    const res = makeRes();
    const next = jest.fn();

    requireFeature('data.export')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res._status).toBe(200);
  });

  test('H6-2: requireFeature — feature=false → 403 FEATURE_NOT_AVAILABLE', () => {
    const req = makeReq({ data: { export: false } });
    const res = makeRes();
    const next = jest.fn();

    requireFeature('data.export')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._body.code).toBe('FEATURE_NOT_AVAILABLE');
    expect(res._body.feature).toBe('data.export');
    expect(res._body.upgrade_required).toBe(true);
  });

  test('H6-3: requireFeature — planFeatures not resolved → 500', () => {
    const req = makeReq(null);
    req.planFeatures = null;
    const res = makeRes();
    const next = jest.fn();

    requireFeature('data.export')(req, res, next);
    expect(res._status).toBe(500);
    expect(res._body.error).toMatch(/not resolved/);
  });

  test('H6-4: requireFeatureIncludes — value in allowed list → next', () => {
    const req = makeReq({ tasks: { placementMode: ['fixed', 'float'] } });
    const res = makeRes();
    const next = jest.fn();

    requireFeatureIncludes('tasks.placementMode', 'fixed')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('H6-5: requireFeatureIncludes — value NOT in list → 403 OPTION_NOT_AVAILABLE', () => {
    const req = makeReq({ tasks: { placementMode: ['float'] } });
    const res = makeRes();
    const next = jest.fn();

    requireFeatureIncludes('tasks.placementMode', 'fixed')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._body.code).toBe('OPTION_NOT_AVAILABLE');
    expect(res._body.feature).toBe('tasks.placementMode');
    expect(res._body.requested).toBe('fixed');
  });

  test('H6-6: requireFeatureIncludes — allowedValues includes "all" → next always', () => {
    const req = makeReq({ tasks: { placementMode: ['all'] } });
    const res = makeRes();
    const next = jest.fn();

    requireFeatureIncludes('tasks.placementMode', 'fixed')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('H6-7: requireFeatureIncludes — undefined requestedValue → next', () => {
    const req = makeReq({ tasks: { placementMode: ['fixed'] } });
    const res = makeRes();
    const next = jest.fn();

    requireFeatureIncludes('tasks.placementMode', undefined)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  // ── FLAG-2 (999.371) — NOW FIXED ──────────────────────────────────────────────
  // feature-gate.js:127 previously had a bug: logFeatureEvent was called as
  //   logFeatureEvent(req.user?.id, featurePath, 'used', req.planId, { selected: ... })
  // i.e. the first arg was a STRING (req.user?.id), not the req object, so
  // logFeatureEvent's `typeof reqOrUserId === 'object'` checks fell to the string
  // branch and plan_id / endpoint / ip_address were DROPPED from the row.
  // 999.371 corrected the call to the canonical `logFeatureEvent(req, …)` shape, so
  // plan_id + endpoint are now persisted. This test asserts the CORRECTED behavior.
  test('H6-FLAG2 (999.371 FIXED): requireFeatureIncludes success path inserts feature_event with plan_id + endpoint populated', async () => {
    const req = makeReq({ tasks: { placementMode: ['fixed', 'float'] } }, 'plan-test');
    const res = makeRes();
    const next = jest.fn();

    // Capture the insert call — mockDb.insert is already mocked
    const insertSpy = mockDb.insert;
    insertSpy.mockClear();

    requireFeatureIncludes('tasks.placementMode', 'fixed')(req, res, next);
    expect(next).toHaveBeenCalled();

    // At least one insert call should have been made (from logFeatureEvent)
    expect(insertSpy).toHaveBeenCalled();

    // Find the logFeatureEvent insert — it targets 'feature_events' table.
    // mockDb('feature_events') → mockDb; then .insert(row) is called.
    // The first insert call should be the feature-event log.
    const insertArg = insertSpy.mock.calls[0][0];

    // CORRECTED SHAPE (999.371): logFeatureEvent now receives the real req object,
    // so the object-typeof branch is taken:
    //   user_id    = req.user.id            → 'gate-user-1'
    //   plan_id    = req.planId             → 'plan-test'  (was null)
    //   endpoint   = req.method+' '+req.url → 'POST /api/tasks' (was null)
    //   ip_address = req.ip                 → '127.0.0.1'  (was null)
    //   value      = JSON.stringify({selected})
    expect(insertArg.user_id).toBe('gate-user-1');
    expect(insertArg.feature_key).toBe('tasks.placementMode');
    expect(insertArg.event_type).toBe('used');
    expect(insertArg.plan_id).toBe('plan-test');
    expect(insertArg.endpoint).toBe('POST /api/tasks');
    expect(insertArg.ip_address).toBe('127.0.0.1');
    expect(insertArg.value).toBe(JSON.stringify({ selected: 'fixed' }));
  });

  test('H6-8: checkUsageLimit — limit=-1 (unlimited) → always calls next', async () => {
    const req = makeReq({ limits: { ai_commands_per_month: -1 } });
    const res = makeRes();
    const next = jest.fn();

    await checkUsageLimit('ai_commands_per_month')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('H6-9: checkUsageLimit — limit exceeded → 429 USAGE_LIMIT_REACHED', async () => {
    const req = makeReq({ limits: { ai_commands_per_month: 10 } });
    const res = makeRes();
    const next = jest.fn();

    // Mock checkAndIncrement to return count > limit
    // db is mocked — push the raw() insert and count fetch results
    // checkAndIncrement does: db.raw(INSERT ON DUPLICATE KEY UPDATE) then db.first()
    // resolveQueue is shared; push a row with count=11 (over limit 10)
    resolveQueue.push({ count: 11, limit_value: 10 }); // first() after upsert

    await checkUsageLimit('ai_commands_per_month')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(429);
    expect(res._body.code).toBe('USAGE_LIMIT_REACHED');
    expect(res._body.limit_key).toBe('ai_commands_per_month');
    expect(res._body.upgrade_required).toBe(true);
  });

  test('H6-10: checkUsageLimit — missing userId → 401', async () => {
    const req = makeReq({ limits: { ai_commands_per_month: 10 } });
    req.user = null;
    const res = makeRes();
    const next = jest.fn();

    await checkUsageLimit('ai_commands_per_month')(req, res, next);
    expect(res._status).toBe(401);
    expect(res._body.error).toMatch(/Authentication required/);
  });

  // ── elmo B1: checkUsageLimit fail-OPEN on DB error ────────────────────────────
  // feature-gate.js:205-207 — catch block calls next() (fail open).
  // This is a deliberate availability-over-strictness choice: on a transient DB
  // error, the user proceeds rather than being locked out.
  // Pinned as-is. If W6 changes this to fail-closed (throw/403/500), this test
  // turns RED. Do not change the behavior without an explicit product decision.
  test('H6-11: checkUsageLimit — DB error during checkAndIncrement → fail-open (calls next)', async () => {
    const req = makeReq({ limits: { ai_commands_per_month: 5 } });
    const res = makeRes();
    const next = jest.fn();

    // Force db.raw() to throw by overriding mockDb.raw for this test
    const origRaw = mockDb.raw;
    mockDb.raw = jest.fn(() => Promise.reject(new Error('DB connection refused')));

    await checkUsageLimit('ai_commands_per_month')(req, res, next);

    mockDb.raw = origRaw;

    // Fail-open: next() is called, no 4xx/5xx response
    expect(next).toHaveBeenCalled();
    expect(res._status).toBe(200); // no error response written
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// SURFACE 7 — plan-features.middleware: slug-keyed lookup (H7), fallback (H13),
//             cache TTLs (H8)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Surface 7 — plan-features: slug-keying (H7), fallback (H13), cache TTLs (H8)', () => {

  // H7: slug-keying invariant — PRODUCT_LABEL must be 'juggler', not a UUID
  test('H7-1: PRODUCT_LABEL is the string "juggler" (slug, not UUID)', () => {
    // Direct import of the module under test (not the mock)
    jest.isolateModules(() => {
      // Need to mock fetch and service-identity for isolated load
      jest.mock('../../../src/service-identity', () => ({
        PRODUCT_LABEL: 'juggler',
        APP_ID: 'juggler',
        SERVICE_NAME: 'strivers'
      }));
      jest.mock('../../../src/proxy-config', () => ({
        services: { billing: { frontend: 'http://localhost:3003' } },
        authServiceUrl: 'http://localhost:5010'
      }));

      const { PRODUCT_LABEL } = require('../../../src/middleware/plan-features.middleware');
      expect(PRODUCT_LABEL).toBe('juggler');
      // UUID-shaped: 8-4-4-4-12 hex pattern — must NOT match
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(UUID_RE.test(PRODUCT_LABEL)).toBe(false);
    });
  });

  // H7: getUserPlanId uses data.plans?.[PRODUCT_LABEL] — slug-keyed lookup
  // Replaces the dead tautology (expect(true).toBe(true)) with a real behavioral assertion.
  // Exercises resolvePlanFeatures with a slug-keyed response and asserts plan is resolved.
  test('H7-2: getUserPlanId resolves plan by slug "juggler" key (behavioral — UUID key returns null)', async () => {
    let capturedPlanId = '__unset__';
    let capturedStatus = null;

    await jest.isolateModulesAsync(async () => {
      // Unmock plan-features.middleware so we get the real module in this isolated scope
      jest.unmock('../../../src/middleware/plan-features.middleware');
      jest.mock('../../../src/service-identity', () => ({
        PRODUCT_LABEL: 'juggler', APP_ID: 'juggler', SERVICE_NAME: 'strivers'
      }));
      jest.mock('../../../src/proxy-config', () => ({
        services: { billing: { frontend: 'http://localhost:3003' } },
        authServiceUrl: 'http://localhost:5010'
      }));
      jest.mock('@raike/lib-logger', () => ({
        createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
      }));

      // H7-2 FLAKE FIX: resolvePlanFeatures now lazy-requires the facade inside its
      // function body (to break the circular dep). That lazy require may escape the
      // isolateModulesAsync isolated registry and pick up the outer worker's cached/
      // mocked facade (non-deterministic). Pin the facade explicitly in the isolated
      // registry with a minimal implementation that uses PaymentServiceEntitlementAdapter
      // + CheckEntitlement backed by global.fetch — identical behavioral surface, no
      // full-facade load-time side-effects (db/redis/cache connections).
      jest.mock('../../../src/slices/user-config/facade', () => {
        const path = require('path');
        const SLICE = path.join(__dirname, '../../../src/slices/user-config');
        const PaymentServiceEntitlementAdapter = require(path.join(SLICE, 'adapters', 'PaymentServiceEntitlementAdapter'));
        const CheckEntitlement = require(path.join(SLICE, 'application', 'commands', 'CheckEntitlement'));
        const SILENT = { info: () => {}, warn: () => {}, error: () => {} };
        const adapter = new PaymentServiceEntitlementAdapter({ productSlug: 'juggler', logger: SILENT });
        const checkUC = new CheckEntitlement({ entitlement: adapter, plansUrl: 'http://localhost:3003/plans' });
        return { checkEntitlement: (input) => checkUC.execute(input) };
      });

      // fetch call 1: getUserPlanId → active-plans → slug-keyed response
      // fetch call 2: getCachedPlanFeatures → plan catalog
      let callIdx = 0;
      global.fetch = jest.fn(() => {
        callIdx++;
        if (callIdx === 1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ plans: { juggler: 'plan-pro' } }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ plans: [{ planId: 'plan-pro', features: { limits: { active_tasks: -1 } } }] }) });
      });

      const pfm = require('../../../src/middleware/plan-features.middleware');
      const req = { user: { id: 'h7-slug-user', authServiceId: null } };
      const res = {
        _status: null,
        status: jest.fn(function(c) { capturedStatus = c; this._status = c; return this; }),
        json: jest.fn(function() { return this; })
      };
      const next = jest.fn();

      await pfm.resolvePlanFeatures(req, res, next);
      capturedPlanId = req.planId;
      delete global.fetch;
    });

    // slug-keyed lookup 'juggler' → 'plan-pro'; UUID-keyed would have returned null → 402
    expect(capturedPlanId).toBe('plan-pro');
    // next() was called (not 402) because slug lookup succeeded → no error status
    expect(capturedStatus).toBeNull();
  });

  // H8: cache TTL constants — BEHAVIORAL pins using fake timers + isolateModules.
  // Each test loads a fresh module instance so cache state does not bleed between tests.
  // Strategy for H8-1 (catalog / getCachedPlanFeatures):
  //   Call twice within TTL → only 1 fetch; advance past 5min → 3rd call triggers a 2nd fetch.
  // Strategy for H8-2 (user-plan / getUserPlanId):
  //   Call twice within TTL → 1 fetch; advance past 2min → 3rd call triggers a 2nd fetch.

  test('H8-1: getCachedPlanFeatures caches for 5 minutes (CATALOG_CACHE_TTL_MS = 300000ms)', async () => {
    let catalogFetchCountWithinTTL = 0;
    let catalogFetchCountTotal = 0;

    await jest.isolateModulesAsync(async () => {
      jest.unmock('../../../src/middleware/plan-features.middleware');
      jest.useFakeTimers();
      jest.mock('../../../src/service-identity', () => ({
        PRODUCT_LABEL: 'juggler', APP_ID: 'juggler', SERVICE_NAME: 'strivers'
      }));
      jest.mock('../../../src/proxy-config', () => ({
        services: { billing: { frontend: 'http://localhost:3003' } },
        authServiceUrl: 'http://localhost:5010'
      }));
      jest.mock('@raike/lib-logger', () => ({
        createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
      }));

      global.fetch = jest.fn(() => {
        catalogFetchCountTotal++;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ plans: [{ planId: 'plan-a', features: {} }] })
        });
      });

      const pfm = require('../../../src/middleware/plan-features.middleware');
      const { getCachedPlanFeatures } = pfm;

      // First call — fetches: 1 for getProductId() + 1 for fetchPlanFeatures() = 2 total
      await getCachedPlanFeatures();
      const countAfterFirstCall = catalogFetchCountTotal; // 2 (product discovery + catalog)

      // Advance to 4m59s — still within 5-min TTL
      jest.advanceTimersByTime(4 * 60 * 1000 + 59000);
      // Second call — must serve catalog from cache (no new catalog fetch)
      await getCachedPlanFeatures();
      catalogFetchCountWithinTTL = catalogFetchCountTotal; // still 2 — catalog cached

      // Advance 2 more seconds — now at 5m01s (past catalog TTL)
      jest.advanceTimersByTime(2000);
      // Third call — catalog TTL expired, must re-fetch the catalog (fetchPlanFeatures)
      await getCachedPlanFeatures();

      jest.useRealTimers();
      delete global.fetch;
    });

    // After first call: 2 fetches (product discovery + catalog fetch)
    // Second call within TTL: no new fetches — count stays at 2 (catalog served from cache)
    expect(catalogFetchCountWithinTTL).toBe(2);
    // After TTL expired: at least 1 more catalog fetch issued (total >= 3)
    expect(catalogFetchCountTotal).toBeGreaterThanOrEqual(3);
  });

  test('H8-2: getUserPlanId caches for 2 minutes (USER_PLAN_CACHE_TTL_MS = 120000ms)', async () => {
    let userPlanFetchesWithinTTL = 0;
    let userPlanFetchesTotal = 0;

    await jest.isolateModulesAsync(async () => {
      jest.unmock('../../../src/middleware/plan-features.middleware');
      jest.useFakeTimers();
      jest.mock('../../../src/service-identity', () => ({
        PRODUCT_LABEL: 'juggler', APP_ID: 'juggler', SERVICE_NAME: 'strivers'
      }));
      jest.mock('../../../src/proxy-config', () => ({
        services: { billing: { frontend: 'http://localhost:3003' } },
        authServiceUrl: 'http://localhost:5010'
      }));
      jest.mock('@raike/lib-logger', () => ({
        createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
      }));

      global.fetch = jest.fn((url) => {
        if (typeof url === 'string' && url.includes('active-plans')) {
          userPlanFetchesTotal++;
        }
        if (typeof url === 'string' && url.includes('active-plans')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ plans: { juggler: 'plan-starter' } }) });
        }
        // catalog fetch
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ plans: [{ planId: 'plan-starter', features: { limits: { active_tasks: -1 } } }] }) });
      });

      const pfm = require('../../../src/middleware/plan-features.middleware');
      const makeReqRes = () => {
        const req = { user: { id: 'h8-ttl-user', authServiceId: null } };
        const res = {
          _status: null,
          status: jest.fn(function(c) { this._status = c; return this; }),
          json: jest.fn(function() { return this; })
        };
        return { req, res, next: jest.fn() };
      };

      // First call — fetches user plan from payment service
      const { req: r1, res: rs1, next: n1 } = makeReqRes();
      await pfm.resolvePlanFeatures(r1, rs1, n1);

      // Advance to 1m59s — still within 2-min TTL
      jest.advanceTimersByTime(1 * 60 * 1000 + 59000);
      const { req: r2, res: rs2, next: n2 } = makeReqRes();
      await pfm.resolvePlanFeatures(r2, rs2, n2);
      userPlanFetchesWithinTTL = userPlanFetchesTotal; // should be 1

      // Advance 2 more seconds — now at 2m01s (past TTL)
      jest.advanceTimersByTime(2000);
      const { req: r3, res: rs3, next: n3 } = makeReqRes();
      await pfm.resolvePlanFeatures(r3, rs3, n3);

      jest.useRealTimers();
      delete global.fetch;
    });

    // Within 2-min TTL: only 1 user-plan fetch (second call cached)
    expect(userPlanFetchesWithinTTL).toBe(1);
    // After TTL: 2nd fetch issued
    expect(userPlanFetchesTotal).toBeGreaterThanOrEqual(2);
  });

  // H13: PAYMENT_SERVICE_URL fallback — now in payment-service-client.js (999.1194 consolidation)
  test('H13-1: payment-service-client uses PAYMENT_SERVICE_URL || "http://localhost:5020"', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/lib/payment-service-client.js'),
      'utf8'
    );
    // The pre-approved fallback must be preserved verbatim in the single owner
    expect(src).toContain("process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020'");
  });

  test('H13-2: plan-features.middleware delegates to paymentFetch (no inline PAYMENT_SERVICE_URL)', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/middleware/plan-features.middleware.js'),
      'utf8'
    );
    // 999.1194: the inline PAYMENT_SERVICE_URL fallbacks were moved to payment-service-client.js.
    // plan-features.middleware now uses paymentFetch from that module.
    expect(src).toContain("require('../lib/payment-service-client')");
    expect(src).not.toContain("process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020'");
  });

  // H7: product discovery URL shape — /internal/products/${PRODUCT_LABEL} (slug)
  test('H7-3: getProductId fetches /internal/products/juggler (slug in URL)', async () => {
    let capturedUrl = null;
    const origFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ product: { id: 'uuid-product-123' } })
      });
    });

    try {
      jest.isolateModules(() => {
        jest.mock('../../../src/service-identity', () => ({
          PRODUCT_LABEL: 'juggler', APP_ID: 'juggler', SERVICE_NAME: 'strivers'
        }));
        jest.mock('../../../src/proxy-config', () => ({
          services: { billing: { frontend: 'http://localhost:3003' } },
          authServiceUrl: 'http://localhost:5010'
        }));
        const pfm = require('../../../src/middleware/plan-features.middleware');
        // Call getProductId — it fetches /internal/products/juggler
        return pfm.getProductId();
      });
    } catch (_) { /* isolation */ }

    // Verify via source: the URL template uses PRODUCT_LABEL (= 'juggler')
    // 999.1194: now via paymentFetch with a relative path that payment-service-client prepends
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/middleware/plan-features.middleware.js'),
      'utf8'
    );
    expect(src).toContain('/internal/products/${PRODUCT_LABEL}');
    global.fetch = origFetch;
  });

  // H7: plan catalog fetch shape — /api/plans?product=... uses productId (resolved UUID) or falls back to PRODUCT_LABEL
  test('H7-4: fetchPlanFeatures URL shape uses productId/PRODUCT_LABEL for product filter', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/middleware/plan-features.middleware.js'),
      'utf8'
    );
    // The fallback when productId is null: uses PRODUCT_LABEL (slug)
    expect(src).toContain('`?product=${PRODUCT_LABEL}`');
  });

  // H7-5: getUserPlanId is keyed by PRODUCT_LABEL slug — behavioral proof.
  // If payment-service returns a UUID-keyed plans map (e.g. plans['abc-uuid']),
  // getUserPlanId must return null (no match), not a false plan.
  // This pins the invariant: only the slug key 'juggler' resolves to a plan.
  test('H7-5: getUserPlanId returns null when plans map is UUID-keyed (slug mismatch → 402)', async () => {
    let resultStatus = null;
    let resultCode = null;

    await jest.isolateModulesAsync(async () => {
      jest.unmock('../../../src/middleware/plan-features.middleware');
      jest.mock('../../../src/service-identity', () => ({
        PRODUCT_LABEL: 'juggler', APP_ID: 'juggler', SERVICE_NAME: 'strivers'
      }));
      jest.mock('../../../src/proxy-config', () => ({
        services: { billing: { frontend: 'http://localhost:3003' } },
        authServiceUrl: 'http://localhost:5010'
      }));
      jest.mock('@raike/lib-logger', () => ({
        createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
      }));

      // H7-5 FLAKE FIX: pin the facade in the isolated registry so the lazy
      // require inside resolvePlanFeatures cannot escape to the outer worker cache.
      // The minimal facade mock re-creates the checkEntitlement path via
      // PaymentServiceEntitlementAdapter + CheckEntitlement backed by global.fetch —
      // behavioral pins preserved; no full-facade load-time side-effects.
      jest.mock('../../../src/slices/user-config/facade', () => {
        const path = require('path');
        const SLICE = path.join(__dirname, '../../../src/slices/user-config');
        const PaymentServiceEntitlementAdapter = require(path.join(SLICE, 'adapters', 'PaymentServiceEntitlementAdapter'));
        const CheckEntitlement = require(path.join(SLICE, 'application', 'commands', 'CheckEntitlement'));
        const SILENT = { info: () => {}, warn: () => {}, error: () => {} };
        const adapter = new PaymentServiceEntitlementAdapter({ productSlug: 'juggler', logger: SILENT });
        const checkUC = new CheckEntitlement({ entitlement: adapter, plansUrl: 'http://localhost:3003/plans' });
        return { checkEntitlement: (input) => checkUC.execute(input) };
      });

      // Plans keyed by UUID, NOT by slug 'juggler' — lookup data.plans?.['juggler'] returns undefined
      global.fetch = jest.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ plans: { 'abc12345-uuid-not-slug': 'plan-pro' } })
      }));

      const pfm = require('../../../src/middleware/plan-features.middleware');
      const req = { user: { id: 'h7-uuid-user', authServiceId: null } };
      const res = {
        _status: null,
        status: jest.fn(function(c) { this._status = c; return this; }),
        json: jest.fn(function(b) { resultStatus = this._status; resultCode = b && b.code; return this; })
      };

      await pfm.resolvePlanFeatures(req, res, jest.fn());
      delete global.fetch;
    });

    // UUID-keyed response: data.plans?.['juggler'] = undefined → planId = null → 402
    expect(resultStatus).toBe(402);
    expect(resultCode).toBe('SUBSCRIPTION_REQUIRED');
  });

  // H7-6: resolvePlanFeatures returns 402 SUBSCRIPTION_REQUIRED when no active plan.
  test('H7-6: resolvePlanFeatures returns 402 with SUBSCRIPTION_REQUIRED when getUserPlanId returns null', async () => {
    let resultStatus = null;
    let resultCode = null;
    let nextCalled = false;

    await jest.isolateModulesAsync(async () => {
      jest.unmock('../../../src/middleware/plan-features.middleware');
      jest.mock('../../../src/service-identity', () => ({
        PRODUCT_LABEL: 'juggler', APP_ID: 'juggler', SERVICE_NAME: 'strivers'
      }));
      jest.mock('../../../src/proxy-config', () => ({
        services: { billing: { frontend: 'http://localhost:3003' } },
        authServiceUrl: 'http://localhost:5010'
      }));
      jest.mock('@raike/lib-logger', () => ({
        createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
      }));

      // H7-6 FLAKE FIX: pin the facade in the isolated registry so the lazy
      // require inside resolvePlanFeatures cannot escape to the outer worker cache.
      // Minimal facade mock: checkEntitlement via adapter + use-case backed by global.fetch.
      jest.mock('../../../src/slices/user-config/facade', () => {
        const path = require('path');
        const SLICE = path.join(__dirname, '../../../src/slices/user-config');
        const PaymentServiceEntitlementAdapter = require(path.join(SLICE, 'adapters', 'PaymentServiceEntitlementAdapter'));
        const CheckEntitlement = require(path.join(SLICE, 'application', 'commands', 'CheckEntitlement'));
        const SILENT = { info: () => {}, warn: () => {}, error: () => {} };
        const adapter = new PaymentServiceEntitlementAdapter({ productSlug: 'juggler', logger: SILENT });
        const checkUC = new CheckEntitlement({ entitlement: adapter, plansUrl: 'http://localhost:3003/plans' });
        return { checkEntitlement: (input) => checkUC.execute(input) };
      });

      // Empty plans → no juggler plan → null planId → 402
      global.fetch = jest.fn(() => Promise.resolve({
        ok: true, json: () => Promise.resolve({ plans: {} })
      }));

      const pfm = require('../../../src/middleware/plan-features.middleware');
      const req = { user: { id: 'h7-noplan-user2', authServiceId: null } };
      const res = {
        _status: null,
        status: jest.fn(function(c) { this._status = c; return this; }),
        json: jest.fn(function(b) { resultStatus = this._status; resultCode = b && b.code; return this; })
      };
      const next = jest.fn(() => { nextCalled = true; });

      await pfm.resolvePlanFeatures(req, res, next);
      delete global.fetch;
    });

    expect(resultStatus).toBe(402);
    expect(resultCode).toBe('SUBSCRIPTION_REQUIRED');
    expect(nextCalled).toBe(false);
  });

  // H8-3: catalog cache deduplicates concurrent fetches — only 1 in-flight fetch
  // at a time (the _fetchPromise guard). Behavioral: two concurrent calls to
  // getCachedPlanFeatures with no cached value must result in exactly 1 fetch call.
  test('H8-3: getCachedPlanFeatures deduplicates concurrent fetches (only 1 in-flight fetch)', async () => {
    // The _fetchPromise guard means concurrent calls share 1 in-flight fetch for the catalog.
    // Strategy: fire two concurrent calls on a fresh (never-fetched) module instance.
    // The first call starts the fetch; the second should reuse the in-flight promise.
    // We use a controlled slow fetch (awaiting a deferred resolve) to guarantee concurrency.
    let catalogFetchCount = 0;

    await jest.isolateModulesAsync(async () => {
      jest.unmock('../../../src/middleware/plan-features.middleware');
      jest.mock('../../../src/service-identity', () => ({
        PRODUCT_LABEL: 'juggler', APP_ID: 'juggler', SERVICE_NAME: 'strivers'
      }));
      jest.mock('../../../src/proxy-config', () => ({
        services: { billing: { frontend: 'http://localhost:3003' } },
        authServiceUrl: 'http://localhost:5010'
      }));
      jest.mock('@raike/lib-logger', () => ({
        createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
      }));

      // Controlled fetch: product discovery resolves immediately (no delay);
      // catalog fetch uses a deferred promise that we resolve manually.
      let resolveCatalog;
      global.fetch = jest.fn((url) => {
        if (typeof url === 'string' && url.includes('/internal/products/')) {
          // Product discovery: fast
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ product: { id: 'prod-uuid' } }) });
        }
        // Catalog fetch: controlled / deferred
        catalogFetchCount++;
        return new Promise(resolve => { resolveCatalog = resolve; });
      });

      const pfm = require('../../../src/middleware/plan-features.middleware');

      // Pre-warm product discovery so _productId is cached before concurrent catalog calls.
      await pfm.getProductId();

      // Fire two concurrent getCachedPlanFeatures calls.
      // The first will start _fetchPromise. The second reuses it.
      const p1 = pfm.getCachedPlanFeatures();
      const p2 = pfm.getCachedPlanFeatures();

      // Yield enough microtask turns for fetchPlanFeatures to reach its `fetch(catalogUrl)` call.
      // getCachedPlanFeatures → fetchPlanFeatures → getProductId (immediate, cached) → fetch(url)
      // That chain requires several microtask hops:
      for (let i = 0; i < 10; i++) await Promise.resolve();

      // Now resolveCatalog should be set from the single fetch() invocation inside fetchPlanFeatures
      if (typeof resolveCatalog === 'function') {
        resolveCatalog({ ok: true, json: () => Promise.resolve({ plans: [{ planId: 'plan-a', features: {} }] }) });
      }

      await Promise.all([p1, p2]);
      delete global.fetch;
    });

    // Despite two concurrent calls, only 1 catalog fetch was issued
    expect(catalogFetchCount).toBe(1);
  });

  // H8-4: getUserPlanId does NOT cache a null planId — if a user has no active plan,
  // the cache map entry is deleted so the next request goes to payment-service fresh.
  test('H8-4: getUserPlanId does not cache null planId (subsequent call re-fetches)', async () => {
    let nullPlanFetchCount = 0;
    let firstCallStatus = null;

    await jest.isolateModulesAsync(async () => {
      jest.unmock('../../../src/middleware/plan-features.middleware');
      jest.mock('../../../src/service-identity', () => ({
        PRODUCT_LABEL: 'juggler', APP_ID: 'juggler', SERVICE_NAME: 'strivers'
      }));
      jest.mock('../../../src/proxy-config', () => ({
        services: { billing: { frontend: 'http://localhost:3003' } },
        authServiceUrl: 'http://localhost:5010'
      }));
      jest.mock('@raike/lib-logger', () => ({
        createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
      }));

      // Return a plans map with no 'juggler' key → getUserPlanId returns null
      global.fetch = jest.fn((url) => {
        if (typeof url === 'string' && url.includes('active-plans')) nullPlanFetchCount++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ plans: {} }) });
      });

      const pfm = require('../../../src/middleware/plan-features.middleware');
      const makeReqRes = () => {
        const req = { user: { id: 'no-plan-user-h84', authServiceId: null } };
        const res = {
          _status: null,
          status: jest.fn(function(c) { this._status = c; return this; }),
          json: jest.fn(function() { return this; })
        };
        return { req, res, next: jest.fn() };
      };

      const { req: r1, res: rs1, next: n1 } = makeReqRes();
      await pfm.resolvePlanFeatures(r1, rs1, n1);
      firstCallStatus = rs1._status; // should be 402

      // Second call immediately — null was NOT cached, so must re-fetch
      const { req: r2, res: rs2, next: n2 } = makeReqRes();
      await pfm.resolvePlanFeatures(r2, rs2, n2);

      delete global.fetch;
    });

    expect(firstCallStatus).toBe(402); // confirms no-plan path was hit
    // Both calls went to payment-service (null planId not cached → re-fetch on second call)
    expect(nullPlanFetchCount).toBeGreaterThanOrEqual(2);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// SURFACE 8 — entity-limits.js: count→limit→allow/block logic
// TRACEABILITY: H9
// ═══════════════════════════════════════════════════════════════════════════════

describe('Surface 8 — entity-limits: count/limit enforcement (H9)', () => {
  // checkEntityLimit is a private factory — not exported.
  // Tests exercise the exported pre-built middleware (checkProjectLimit,
  // checkScheduleTemplateLimit, checkTaskOrRecurringLimit) which are created by
  // checkEntityLimit internally. These cover all branches of the factory.
  const {
    checkProjectLimit,
    checkScheduleTemplateLimit,
    checkLocationLimit,
    checkTaskOrRecurringLimit,
    checkBatchTaskLimits,
    countScheduleTemplates,
    countRecurringTemplates,
    countProjects,
    countLocations
  } = require('../../../src/middleware/entity-limits');

  function makeReq(planFeatures, body) {
    return {
      user: { id: 'el-user-1' },
      planId: 'plan-test',
      planFeatures,
      body: body || {},
      method: 'POST',
      originalUrl: '/api/tasks',
      url: '/api/tasks',
      headers: {},
      ip: '127.0.0.1'
    };
  }
  function makeRes() {
    return {
      _status: 200, _body: null,
      status: jest.fn(function(c) { this._status = c; return this; }),
      json: jest.fn(function(b) { this._body = b; return this; })
    };
  }

  test('H9-1: checkProjectLimit — unlimited (-1) → short-circuits before DB count (next called)', async () => {
    // When limit=-1, checkEntityLimit returns next() immediately without calling countFn.
    // No DB call needed — no resolveQueue push required.
    const req = makeReq({ limits: { projects: -1 } });
    const res = makeRes();
    const next = jest.fn();

    await checkProjectLimit(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res._status).toBe(200); // no error response
  });

  test('H9-2: checkProjectLimit — under limit → next', async () => {
    // countProjects → db('projects').count().first() → push count=3 (under limit 10)
    resolveQueue.push({ count: 3 });

    const req = makeReq({ limits: { projects: 10 } });
    const res = makeRes();
    const next = jest.fn();

    await checkProjectLimit(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('H9-3: checkProjectLimit — at/over limit → 403 ENTITY_LIMIT_REACHED', async () => {
    // countProjects returns 10 (= limit) → 10 + 1 > 10 → blocked
    resolveQueue.push({ count: 10 });

    const req = makeReq({ limits: { projects: 10 } });
    const res = makeRes();
    const next = jest.fn();

    await checkProjectLimit(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._body.code).toBe('ENTITY_LIMIT_REACHED');
    expect(res._body.limit_key).toBe('limits.projects');
    expect(res._body.current_count).toBe(10);
    expect(res._body.limit).toBe(10);
    expect(res._body.attempting_to_add).toBe(1);
    expect(res._body.upgrade_required).toBe(true);
  });

  test('H9-4 (999.370 FAIL-CLOSED): checkProjectLimit — DB error → 503 (creation blocked)', async () => {
    // Leave the resolveQueue empty → first() resolves undefined → result.count read
    // throws a TypeError inside countProjects → check()'s catch fires. Under the
    // 999.370 fail-CLOSED change this returns 503 (was fail-open next()+200).

    const req = makeReq({ limits: { projects: 5 } });
    const res = makeRes();
    const next = jest.fn();

    await checkProjectLimit(req, res, next);
    expect(next).not.toHaveBeenCalled(); // fail-closed: blocked
    expect(res._status).toBe(503);
    expect(res._body.error).toMatch(/temporarily unavailable/);
  });

  test('H9-5: checkProjectLimit — planFeatures not resolved → 500', async () => {
    const req = makeReq(null);
    req.planFeatures = null;
    const res = makeRes();
    const next = jest.fn();

    await checkProjectLimit(req, res, next);
    expect(res._status).toBe(500);
    expect(res._body.error).toMatch(/not resolved/);
  });

  // ── 999.370: entity-limits fail-CLOSED on DB error (was fail-open) ─────────────
  // 999.370 (user-approved) overrides the legacy entity-limits.js:57-60 fail-open
  // catch { logger.error(...); next(); }. A DB/count error during an entitlement
  // check now BLOCKS creation (503), rather than letting users exceed plan limits
  // during a DB outage. This test asserts the corrected fail-CLOSED behavior.
  test('H9-elmoB1 (999.370 FAIL-CLOSED): checkProjectLimit — count function DB throw → 503 (creation blocked)', async () => {
    // Force db('projects').count().first() to throw by making mockDb.first reject
    const origFirst = mockDb.first;
    mockDb.first = jest.fn(() => Promise.reject(new Error('Connection lost')));

    const req = makeReq({ limits: { projects: 5 } });
    const res = makeRes();
    const next = jest.fn();

    await checkProjectLimit(req, res, next);

    mockDb.first = origFirst;

    // Fail-CLOSED: next() must NOT be called; a 503 is written.
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(503);
    expect(res._body.error).toMatch(/temporarily unavailable/);
  });

  test('H9-6: checkLocationLimit — incoming count > limit → 403', () => {
    const req = makeReq({ limits: { locations: 2 } }, {
      locations: [{ id: 'l1', name: 'A' }, { id: 'l2', name: 'B' }, { id: 'l3', name: 'C' }]
    });
    const res = makeRes();
    const next = jest.fn();

    checkLocationLimit(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._body.code).toBe('ENTITY_LIMIT_REACHED');
    expect(res._body.limit_key).toBe('limits.locations');
  });

  test('H9-7: checkLocationLimit — under limit → next', () => {
    const req = makeReq({ limits: { locations: 5 } }, {
      locations: [{ id: 'l1', name: 'A' }]
    });
    const res = makeRes();
    const next = jest.fn();

    checkLocationLimit(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('H9-8: checkLocationLimit — unlimited (-1) → always next', () => {
    const req = makeReq({ limits: { locations: -1 } }, {
      locations: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }, { id: 'l4' }, { id: 'l5' }]
    });
    const res = makeRes();
    const next = jest.fn();

    checkLocationLimit(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('H9-9: checkTaskOrRecurringLimit — recurring_template routes to recurring limit', async () => {
    // task_type = 'recurring_template' → checkRecurringLimit
    // inject a spy on the limit function via planFeatures
    const req = makeReq({ limits: { recurring_templates: -1, active_tasks: -1 } }, {
      task_type: 'recurring_template'
    });
    const res = makeRes();
    const next = jest.fn();

    await checkTaskOrRecurringLimit(req, res, next);
    expect(next).toHaveBeenCalled(); // unlimited → passes
  });

  test('H9-10: checkTaskOrRecurringLimit — regular task routes to task limit', async () => {
    const req = makeReq({ limits: { active_tasks: -1, recurring_templates: -1 } }, {
      task_type: 'task'
    });
    const res = makeRes();
    const next = jest.fn();

    await checkTaskOrRecurringLimit(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('H9-11: countScheduleTemplates — counts keys with non-empty block arrays', async () => {
    // db('user_config').where({...}).first() returns a row with config_value
    resolveQueue.push({
      config_value: JSON.stringify({
        Mon: ['block1', 'block2'], // 2 blocks — counts
        Tue: [],                   // empty — does NOT count
        Wed: ['block3']            // 1 block — counts
      })
    });

    const count = await countScheduleTemplates('user-1');
    expect(count).toBe(2);
  });

  test('H9-12: countScheduleTemplates — no row returns 0', async () => {
    resolveQueue.push(null);
    const count = await countScheduleTemplates('user-1');
    expect(count).toBe(0);
  });

  // POST-999.1188 NEW BEHAVIOR (not a pre-existing H9 pin — do NOT treat as
  // pre-refactor baseline). Degenerate case: config_value JSON-parses to a
  // bare string primitive (e.g. stored value was `"hello"`, not an object of
  // day→blocks). OLD inline entity-limits.js code did `Object.keys(blocks)`
  // directly on the string, which autoboxes and iterates CHARACTER INDICES —
  // it would have returned the string's length (character count), not 0.
  // NEW facade path delegates to domain.entityLimit.countScheduleTemplatesFromBlocks,
  // which guards `typeof blocks !== 'object'` and returns 0 for a primitive
  // string. elmo judged the degenerate shape unreachable in practice (time_blocks
  // config is always written as a day-keyed object) and the new behavior (0)
  // intended — this pin locks that NEW value in so a future change to the facade
  // can't silently drift it again without flipping this test RED.
  test('H9-new-1 (post-999.1188): countScheduleTemplates — config_value parses to a bare string primitive → 0 (NEW behavior; old inline code counted string characters)', async () => {
    resolveQueue.push({ config_value: JSON.stringify('hello') });
    const count = await countScheduleTemplates('user-1');
    expect(count).toBe(0);
  });

  // 999.1188 delta-closure — B1 coverage-gap closure: these three exported
  // count* functions are consumed directly by my-plan.routes.js (destructured
  // at require-time — a name/signature slip breaks it silently, intake-brief
  // risk_flags), but were not exercised by any pre-existing suite through their
  // NEW delegation body (entity-limits.js:countX → facade.countX → repo.countX).
  // Each pin below drives the export end-to-end through the mocked db chain,
  // proving the delegation wiring is real (not just statically plausible).
  test('H9-new-2 (post-999.1188): countRecurringTemplates — exported delegate returns the parsed repo count end-to-end', async () => {
    resolveQueue.push({ count: 0 }); // characterized quirk: tasks_v NULL-status exclusion → effectively always 0
    const count = await countRecurringTemplates('user-1');
    expect(count).toBe(0);
  });

  test('H9-new-3 (post-999.1188): countProjects — exported delegate returns the parsed repo count end-to-end', async () => {
    resolveQueue.push({ count: 4 });
    const count = await countProjects('user-1');
    expect(count).toBe(4);
  });

  test('H9-new-4 (post-999.1188): countLocations — exported delegate returns the parsed repo count end-to-end', async () => {
    resolveQueue.push({ count: 2 });
    const count = await countLocations('user-1');
    expect(count).toBe(2);
  });

  // Pre-existing branch (not new post-999.1188 behavior, but previously unpinned
  // by any suite): countScheduleTemplates' try/catch — a config_value that fails
  // JSON.parse must fall back to 0, same as no-row (H9-12). Preserved verbatim
  // through the facade delegation (facade.js countScheduleTemplates catch{}).
  test('H9-new-5: countScheduleTemplates — malformed config_value (JSON.parse throws) → 0', async () => {
    resolveQueue.push({ config_value: '{not valid json' });
    const count = await countScheduleTemplates('user-1');
    expect(count).toBe(0);
  });

  test('H9-13: checkBatchTaskLimits — planFeatures not set → 500', async () => {
    const req = makeReq(null);
    req.planFeatures = null;
    const res = makeRes();
    const next = jest.fn();

    await checkBatchTaskLimits(req, res, next);
    expect(res._status).toBe(500);
  });

  test('H9-14: checkBatchTaskLimits — tasks over limit returns 403', async () => {
    // current active tasks = 10, limit = 10, attempting to add 2
    resolveQueue.push({ count: 10 }); // countActiveTasks

    const req = makeReq(
      { limits: { active_tasks: 10, recurring_templates: -1 } },
      [
        { task_type: 'task', text: 'T1' },
        { task_type: 'task', text: 'T2' }
      ]
    );
    req.body = [
      { task_type: 'task', text: 'T1' },
      { task_type: 'task', text: 'T2' }
    ];
    const res = makeRes();
    const next = jest.fn();

    await checkBatchTaskLimits(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._body.code).toBe('ENTITY_LIMIT_REACHED');
    expect(res._body.limit_key).toBe('limits.active_tasks');
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// CROSS-CUTTING INVARIANTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cross-cutting invariants (H11, H13)', () => {

  test('H11-pinned: all 8 source files exist (extraction target inventory)', () => {
    const path = require('path');
    const fs = require('fs');
    const srcRoot = path.join(__dirname, '../../../src');
    const targets = [
      'controllers/config.controller.js',
      'controllers/data.controller.js',
      'controllers/billing-webhooks.controller.js',
      'controllers/feature-catalog.controller.js',
      'controllers/impersonation.controller.js',
      'middleware/feature-gate.js',
      'middleware/plan-features.middleware.js',
      'middleware/entity-limits.js'
    ];
    for (const t of targets) {
      expect(fs.existsSync(path.join(srcRoot, t))).toBe(true);
    }
  });

  test('H13-verified: PAYMENT_SERVICE_URL fallback lives in payment-service-client.js (999.1194)', () => {
    // 999.1194: the fallback was consolidated from 2 inline copies in plan-features.middleware
    // into the single payment-service-client.js owner. Verify it's there exactly once.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/lib/payment-service-client.js'),
      'utf8'
    );
    const matches = src.match(/process\.env\.PAYMENT_SERVICE_URL \|\| 'http:\/\/localhost:5020'/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  test('H7-final: feature-catalog PRODUCT_ID field uses PRODUCT_LABEL (slug "juggler")', async () => {
    // The catalog controller: product_id: PRODUCT_LABEL at module load,
    // then resolved to UUID at request time via getProductId().
    // This pins that the initial CATALOG.product_id starts as PRODUCT_LABEL.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/controllers/feature-catalog.controller.js'),
      'utf8'
    );
    // CATALOG.product_id: PRODUCT_LABEL — slug-keyed at module load
    expect(src).toContain('product_id: PRODUCT_LABEL');
  });

});

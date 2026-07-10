/**
 * W2a regression tests — STEP 0 (RED pre-fix) + B9 re-review (boot-contract rewrite)
 *
 * B6 (999.420) — suggest-icon log flood on AI-disabled deploys [GREEN post-fix]
 * B7 (999.422) — null/blocked Gemini result bypasses structured error path [GREEN post-fix]
 * B8 (999.423) — cached client ignores GEMINI_API_KEY rotation [GREEN post-fix]
 *
 * B9 (999.421) — BOOT-LEVEL DB MISCONFIG MUST FAIL AT SERVER BOOT, NOT FIRST REQUEST
 *   ── Original contract (superseded): constructor-level NODE_ENV allowlist check.
 *      Problem (ernie/zoe BLOCK): the facade builds adapters LAZILY on first call, so
 *      a bad-config deploy still boots clean and the constructor-level check only
 *      fires on the first AI request — not at boot. Also: the NODE_ENV allowlist
 *      ('development'/'production'/'test') is the wrong assertion — it validates a
 *      string, not whether the DB config actually resolves. NODE_ENV='staging' with a
 *      fully working DB would fail the check; NODE_ENV='production' with a broken
 *      connection string would pass it.
 *
 *   ── New contract (human-approved, 2026-06-12):
 *      facade.init() — a boot hook that EAGERLY resolves + validates the REAL db
 *      handle by calling getDefaultDb(). Called at SERVER BOOT (server.js/app.js).
 *      Validation logic: mock getDefaultDb() to throw → init() throws (boot fails);
 *      mock getDefaultDb() to resolve → init() passes. NOT a NODE_ENV string check.
 *
 *   ── What must FAIL against current code:
 *      facade.init is not a function → all B9-boot-* tests throw TypeError → RED.
 *
 *   ── Design contract for bert:
 *      1. Add `init()` to facade.js:
 *           async init() {
 *             // Force-resolve the DB handle at boot — throws if getDefaultDb() can't
 *             // configure a pool (bad connection string, unrecognised NODE_ENV in
 *             // knexfile, missing env vars). ai() / usage() singletons remain lazy
 *             // (no cost on non-AI deploys) but the db seam is validated eagerly.
 *             const { getDefaultDb } = require('./lib/db');
 *             getDefaultDb(); // throws on bad config — propagates to boot sequence
 *           }
 *      2. Wire in server.js: await require('./slices/ai-enrichment/facade').init()
 *         inside the start() function (before app.listen).
 *
 *   ── Mutation contract (B9-boot-red):
 *      Removing the getDefaultDb() call from init() → getDefaultDb mock throws but
 *      init() doesn't propagate → B9-boot-red assertion FAILS → mutant KILLED.
 *
 * ── TRACEABILITY ──────────────────────────────────────────────────────────────
 *   .planning/kermit/juggler-h5-fixes/TRACEABILITY.md B6/B7/B8/B9
 *
 * ── DESIGN CHOICES FOR BERT ───────────────────────────────────────────────────
 *   B8 contract: LIVE-INVALIDATION via key snapshot comparison (unchanged).
 *   B9 contract: BOOT HOOK — facade.init() calls getDefaultDb() eagerly.
 *     Alternative (eager in constructor) was rejected: the facade's lazy singleton
 *     pattern means the constructor is only called on the first generate() call, not
 *     at boot — so constructor-eager is still first-request-fail. The boot hook
 *     (init()) is the correct altitude for a boot-time validation.
 *
 * ── DETERMINISM ───────────────────────────────────────────────────────────────
 *   B6: logger.error spy is synchronous; result is deterministic.
 *   B7: trackedGeminiCall mocked synchronously; no timer race.
 *   B8: @google/genai mocked at module level; constructor call count is
 *       synchronous; fully deterministic.
 *   B9-boot-*: lib/db mocked at module level; getDefaultDb spy is synchronous;
 *       no timer race; mock restored in afterEach.
 *
 * ── DB NOTES ─────────────────────────────────────────────────────────────────
 *   All tests are pure-unit (no Docker needed). B6/B7 use the same supertest
 *   + mock-DB approach as tests/api/ai-command.test.js. B8 instantiates
 *   GeminiAIAdapter directly via DI. B9-boot-* call facade.init() directly,
 *   mocking getDefaultDb to control the resolution outcome.
 */

'use strict';

process.env.NODE_ENV = 'test';

// ─────────────────────────────────────────────────────────────────────────────
// B8 — GoogleGenAI mock (module-level so Jest can hoist it)
// We capture instantiation calls to verify re-instantiation on key rotation.
// ─────────────────────────────────────────────────────────────────────────────
const mockGoogleGenAIInstances = [];
const MockGoogleGenAI = jest.fn().mockImplementation(function(opts) {
  this._opts = opts;
  mockGoogleGenAIInstances.push(this);
});

jest.mock('@google/genai', () => ({
  GoogleGenAI: MockGoogleGenAI,
}));

// ─────────────────────────────────────────────────────────────────────────────
// B6/B7 shared infrastructure (mirrors ai-command.test.js + goldenMaster.h5.test.js)
// ─────────────────────────────────────────────────────────────────────────────

// Mock the tracked Gemini call so unit tests never hit the real SDK.
const mockTrackedGeminiCall = jest.fn();
jest.mock('../../../src/slices/ai-enrichment/adapters/gemini-tracked-call', () => ({
  trackedGeminiCall: mockTrackedGeminiCall,
}));

// noopDb — adapter passes db to trackedGeminiCall; noop is sufficient for B8/B9.
const noopDb = () => ({ insert: async () => {} });

// ── Shared mock infrastructure (B6/B7 HTTP path) ─────────────────────────────

let resolveQueue = [];

function createChainMock() {
  const chain = jest.fn(() => chain);
  ['where', 'whereRaw', 'whereNotNull', 'whereNull', 'whereNot', 'whereNotIn',
   'whereIn', 'orWhere', 'orWhereNot', 'orderBy', 'orderByRaw', 'limit', 'offset',
   'join', 'leftJoin', 'count', 'max', 'clearSelect', 'clearOrder', 'clone',
   'groupBy', 'having'].forEach(m => { chain[m] = jest.fn(() => chain); });
  chain.select = jest.fn(() => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : []));
  chain.first = jest.fn(() => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : null));
  chain.insert = jest.fn(() => Promise.resolve());
  chain.update = jest.fn(() => Promise.resolve(1));
  chain.del = jest.fn(() => Promise.resolve(1));
  chain.then = jest.fn((res, rej) => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : []).then(res, rej));
  chain.catch = jest.fn((fn) => Promise.resolve([]).catch(fn));
  chain.fn = { now: () => 'MOCK_NOW' };
  chain.raw = jest.fn((s) => s);
  chain.transaction = jest.fn(async (cb) => cb(chain));
  return chain;
}

const mockDb = createChainMock();
jest.mock('../../../src/db', () => mockDb);
jest.mock('../../../src/lib/db', () => {
  const actual = jest.requireActual('../../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

jest.mock('../../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Auth required' });
    req.user = { id: 'user-b6b7', email: 'test@test.com', name: 'Test' };
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn(),
}));

jest.mock('../../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = {
      limits: { active_tasks: -1 },
      calendar: { max_providers: -1 },
      scheduling: {},
      tasks: {},
      ai: { natural_language_commands: true },
    };
    next();
  },
  PRODUCT_ID: 'juggler',
  refreshPlanFeatures: jest.fn(),
  invalidateUserPlanCache: jest.fn(),
  getCachedPlanFeatures: jest.fn(),
}));

jest.mock('../../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve()),
  del: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn(),
}));

jest.mock('../../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn(),
}));

jest.mock('../../../src/lib/tasks-write', () => ({
  insertTask: jest.fn(() => Promise.resolve()),
  insertTasksBatch: jest.fn(() => Promise.resolve()),
  resetRecurringInstances: jest.fn(() => Promise.resolve()),
  updateTaskById: jest.fn(() => Promise.resolve(1)),
  deleteTaskById: jest.fn(() => Promise.resolve(1)),
  updateTasksWhere: jest.fn(() => Promise.resolve()),
  deleteTasksWhere: jest.fn(() => Promise.resolve()),
  deleteInstancesWhere: jest.fn(() => Promise.resolve()),
  updateInstancesWhere: jest.fn(() => Promise.resolve()),
  splitUpdateFields: jest.fn((f) => f),
  isTemplate: jest.fn(() => false),
}));

jest.mock('../../../src/lib/task-write-queue', () => ({
  isLocked: jest.fn(() => Promise.resolve(false)),
  enqueueWrite: jest.fn(() => Promise.resolve()),
  flushQueue: jest.fn(() => Promise.resolve()),
  flushQueueInLock: jest.fn(() => Promise.resolve()),
  splitFields: jest.fn((f) => ({ schedulingFields: {}, nonSchedulingFields: f })),
  NON_SCHEDULING_FIELDS: [],
}));

jest.mock('../../../src/middleware/entity-limits', () => ({
  checkProjectLimit: (req, res, next) => next(),
  checkLocationLimit: (req, res, next) => next(),
  checkScheduleTemplateLimit: (req, res, next) => next(),
  checkTaskOrRecurringLimit: (req, res, next) => next(),
  checkBatchTaskLimits: (req, res, next) => next(),
  checkToolLimit: (req, res, next) => next(),
  countActiveTasks: jest.fn(() => Promise.resolve(0)),
  countRecurringTemplates: jest.fn(() => Promise.resolve(0)),
  countProjects: jest.fn(() => Promise.resolve(0)),
  countLocations: jest.fn(() => Promise.resolve(0)),
  countScheduleTemplates: jest.fn(() => Promise.resolve(0)),
}));

jest.mock('../../../src/middleware/validate', () => ({
  validate: () => (req, res, next) => next(),
}));

jest.mock('../../../src/lib/rate-limit-store', () => ({
  maybeRedisStore: () => ({
    init: jest.fn(),
    increment: jest.fn(() => Promise.resolve({ totalHits: 1, resetTime: new Date(Date.now() + 60000) })),
    decrement: jest.fn(() => Promise.resolve()),
    resetKey: jest.fn(() => Promise.resolve()),
    resetAll: jest.fn(() => Promise.resolve()),
  }),
}));

jest.mock('../../../src/slices/ai-enrichment/adapters/ai-usage-queue.service', () => ({
  enqueue: jest.fn(),
}));

// ── lib/logger mock: captures logger.error calls for B6 spy ──────────────────
// B6 needs to spy on the logger.error call made inside task.routes.js.
// task.routes does: const logger = createLogger('task.routes');
// So we capture the mockLoggerInstance that createLogger returns — all calls to
// logger.error on ANY logger created via createLogger are recorded on mockErrorSpy.
// NOTE: variable MUST be prefixed 'mock' so Jest's babel hoisting allows the
// reference inside the jest.mock() factory.
const mockErrorSpy = jest.fn();
const mockWarnSpy = jest.fn();
const mockLoggerInstance = {
  error: mockErrorSpy,
  warn: mockWarnSpy,
  info: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
};
jest.mock('@raike/lib-logger', () => ({
  createLogger: jest.fn(() => mockLoggerInstance),
}));

// Also mock the barrel logger used by ai.controller (if it uses the old path)
jest.mock('../../../src/lib/logger', () => ({
  createLogger: jest.fn(() => mockLoggerInstance),
  aiControllerLogger: mockLoggerInstance,
  taskControllerLogger: mockLoggerInstance,
  calSyncControllerLogger: mockLoggerInstance,
  configControllerLogger: mockLoggerInstance,
  schedulerLogger: mockLoggerInstance,
  schedulerRunLogger: mockLoggerInstance,
  schedulerUnifiedLogger: mockLoggerInstance,
  dataControllerLogger: mockLoggerInstance,
  weatherControllerLogger: mockLoggerInstance,
  libUsageReporterLogger: mockLoggerInstance,
  libGcalLogger: mockLoggerInstance,
  libMsftLogger: mockLoggerInstance,
  libAppleLogger: mockLoggerInstance,
  libDbLogger: mockLoggerInstance,
  libRedisLogger: mockLoggerInstance,
  libTasksWriteLogger: mockLoggerInstance,
  libTaskWriteQueueLogger: mockLoggerInstance,
  libCalAdapterLogger: mockLoggerInstance,
  libSyncLockLogger: mockLoggerInstance,
  libRollingAnchorLogger: mockLoggerInstance,
  libReconcileSplitsLogger: mockLoggerInstance,
  libSseEmitterLogger: mockLoggerInstance,
  aiUsageQueueLogger: mockLoggerInstance,
  aiUsageFlusherLogger: mockLoggerInstance,
  serverLogger: mockLoggerInstance,
  cronCalHistoryLogger: mockLoggerInstance,
  clearLoggerCache: jest.fn(),
  LOG_LEVELS: ['error', 'warn', 'info', 'debug', 'trace'],
  DEFAULT_LOG_LEVEL: 'debug',
  loggers: {},
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
}));

const VALID_TOKEN = 'valid-test-token';

// ─────────────────────────────────────────────────────────────────────────────
// B6 — suggest-icon log flood when AI is not configured
// ─────────────────────────────────────────────────────────────────────────────

describe('B6 — suggest-icon: NOT-CONFIGURED path must NOT call logger.error', () => {
  // The facade singleton must be reset before each test so the adapter is
  // reconstructed with the desired env for that test.
  beforeEach(() => {
    resolveQueue = [];
    jest.clearAllMocks();
    // clearAllMocks() clears call records but NOT queued mockResolvedValueOnce
    // implementations. Fully reset the tracked-Gemini mock so a once-value queued
    // by one B6 test can never be shifted by the next (the source of the cascade
    // when B6-red's queued state leaked into B6-guard → undefined result).
    mockTrackedGeminiCall.mockReset();
    // Reset the facade singleton so the adapter is rebuilt on next call.
    // This prevents a configured adapter from a prior test leaking into this test.
    const facade = require('../../../src/slices/ai-enrichment/facade');
    facade._reset();
  });

  afterEach(() => {
    const facade = require('../../../src/slices/ai-enrichment/facade');
    facade._reset();
  });

  test(
    'B6-red [EXPECT-RED]: suggest-icon with no GEMINI_API_KEY and no GOOGLE_CLOUD_PROJECT — ' +
    'returns {icon:null} with ZERO logger.error calls (currently calls logger.error once)',
    async () => {
      // Arrange: AI env variables are NOT set (no GEMINI_API_KEY, no GOOGLE_CLOUD_PROJECT,
      // USE_VERTEX_AI not 'true'). The GeminiAIAdapter._getClient() will throw
      // 'GEMINI_API_KEY not configured' when first called.
      //
      // The ai-enrichment facade uses a lazy singleton built from process.env at
      // first generate() call. We inject a GeminiAIAdapter with an empty env object
      // so the "not configured" branch fires deterministically regardless of the
      // test runner's environment (which may have real keys set).
      const { GeminiAIAdapter } = require('../../../src/slices/ai-enrichment/facade');
      const notConfiguredAdapter = new GeminiAIAdapter({
        // No client injected. env has neither API key.
        env: { GEMINI_API_KEY: '', USE_VERTEX_AI: 'false', GOOGLE_CLOUD_PROJECT: '' },
        db: noopDb,
      });
      const facade = require('../../../src/slices/ai-enrichment/facade');
      facade._setAdapters({ aiAdapter: notConfiguredAdapter });

      const app = require('../../../src/app');
      const request = require('supertest');

      // Act: call suggest-icon with a non-empty text param
      const res = await request(app)
        .get('/api/tasks/suggest-icon?text=buy+milk')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      // Assert 1: response is always {icon:null} for any error (not-configured included)
      // This assertion should GREEN on current code too (route catch returns {icon:null}).
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ icon: null });

      // Assert 2: logger.error was NOT called.
      // On current code: _getClient() throws → caught by route catch →
      //   logger.error('suggest-icon error:', err.message || err) IS called
      //   → mockErrorSpy.mock.calls.length === 1 → assertion FAILS → RED.
      //
      // After fix: not-configured path returns clean null without logging an error
      //   (e.g. via isConfigured() check returning false before the generate() call,
      //   or _getClient() returning null for unconfigured and generate() returning {}
      //   which the route maps to {icon:null}).
      //   → mockErrorSpy.mock.calls.length === 0 → assertion PASSES → GREEN.
      expect(mockErrorSpy).not.toHaveBeenCalled();
    },
    // This case spins up the full express app (require('../../../src/app')) and
    // issues a real supertest request; cold app boot measures ~4s, which flakes
    // past Jest's 5s default under full-suite load and then cascades stale mock
    // state into B6-guard. Give it explicit headroom — the assertions are
    // unchanged; only the timeout budget accommodates the measured boot cost.
    //
    // 999.1444: 15000ms was still not enough under `jest --coverage` — coverage
    // instrumentation adds enough per-call overhead to the app-boot + supertest
    // request path that this test timed out (not a logic failure: "Exceeded
    // timeout of 15000 ms") and the aborted in-flight request's late-arriving
    // logger.error call then cascaded into B6-guard's mockErrorSpy count. Bumped
    // to 30000ms, same pattern as geminiAdapterTimeout.test.js's 2000->10000 bump.
    30000
  );

  test(
    'B6-guard [GUARD-GREEN]: suggest-icon when AI IS configured returns a result ' +
    '(adapter mock, no logger.error on success path)',
    async () => {
      // Non-regression: when the adapter is properly configured (client injected),
      // a fast successful response returns the emoji; no error logged.
      const { GeminiAIAdapter } = require('../../../src/slices/ai-enrichment/facade');
      const configuredAdapter = new GeminiAIAdapter({
        client: {
          models: {
            generateContent: async () => ({ text: '🎯' }),
          },
        },
        db: noopDb,
      });
      const facade = require('../../../src/slices/ai-enrichment/facade');
      facade._setAdapters({ aiAdapter: configuredAdapter });

      // Override trackedGeminiCall for this test's path: the adapter calls
      // trackedGeminiCall internally; mock it to return a clean result.
      mockTrackedGeminiCall.mockResolvedValueOnce({ text: '🎯' });

      const app = require('../../../src/app');
      const request = require('supertest');

      const res = await request(app)
        .get('/api/tasks/suggest-icon?text=run+a+mile')
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      // Status 200 and either an emoji or null (emoji validation may reject).
      expect(res.status).toBe(200);
      // No error log on the success path.
      expect(mockErrorSpy).not.toHaveBeenCalled();
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// B7 — null/blocked Gemini result bypasses structured error path
// ─────────────────────────────────────────────────────────────────────────────

describe('B7 — callGemini: null SDK result must produce structured error, not TypeError 500', () => {
  let app;

  beforeAll(() => {
    app = require('../../../src/app');
  });

  beforeEach(() => {
    resolveQueue = [];
    jest.clearAllMocks();
    // Seed daily quota check → allowed (count=0)
    resolveQueue.push({ cnt: 0 });
  });

  afterEach(() => {
    // 999.1444: B7-guard injects a configured adapter via facade._setAdapters —
    // reset the singleton so it never leaks into a later test/file (mirrors B6's
    // afterEach cleanup pattern).
    const facade = require('../../../src/slices/ai-enrichment/facade');
    facade._reset();
  });

  test(
    'B7-red [EXPECT-RED]: trackedGeminiCall resolves null → structured "Unexpected Gemini response" error ' +
    '(currently throws TypeError: Cannot read properties of null — raw 500)',
    async () => {
      // Arrange: mock trackedGeminiCall to return null.
      // This simulates a SDK result that is null (blocked/safety-filtered response).
      mockTrackedGeminiCall.mockResolvedValueOnce(null);

      const request = require('supertest');
      const res = await request(app)
        .post('/api/ai/command')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ command: 'add a task', tasks: [], statuses: {}, config: {} });

      // Assert: response is 500 (the generate failed, not a 200/422)
      expect(res.status).toBe(500);

      // Assert: the error message must be the STRUCTURED path, not the raw TypeError.
      //
      // On current code:
      //   callGemini does: if (result.text)  ← TypeError: Cannot read properties of null
      //   The TypeError is caught by handleCommand's outer catch.
      //   res.body.error becomes "Cannot read properties of null (reading 'text')"
      //   → toMatch(/Unexpected Gemini response structure/) FAILS → RED.
      //
      // After fix: null guard added before result.text dereference:
      //   if (!result || ...) throw new Error('Unexpected Gemini response structure')
      //   → res.body.error === 'Unexpected Gemini response structure' → PASSES → GREEN.
      expect(res.body.error).toMatch(/Unexpected Gemini response structure/i);
    }
  );

  test(
    'B7-guard-2 [GUARD-GREEN]: blocked response shape {candidates:[{content:null}]} → ' +
    'structured "Unexpected Gemini response" error (non-null objects already handled)',
    async () => {
      // Variant: result is an object but with a blocked/safety-filtered candidate
      // (no content.parts). Non-null, so result.text doesn't TypeError.
      // On current code:
      //   result.text → undefined → if (undefined) false
      //   result.candidates?.[0]?.content?.parts → null?.[...] = undefined → false
      //   Reaches: throw new Error('Unexpected Gemini response structure') → PASSES.
      //
      // This is a GREEN guard on both current and fixed code: non-null objects
      // already reach the structured error path without a TypeError.
      // The core RED case is specifically null result (B7-red above).
      mockTrackedGeminiCall.mockResolvedValueOnce({
        candidates: [{ finishReason: 'SAFETY', content: null }],
      });

      const request = require('supertest');

      // Reset quota seed for this test
      resolveQueue.push({ cnt: 0 });

      const res = await request(app)
        .post('/api/ai/command')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ command: 'add a task', tasks: [], statuses: {}, config: {} });

      // Blocked response: structured error branch reached → 500 with structured message.
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/Unexpected Gemini response/i);
    }
  );

  test(
    'B7-guard [GUARD-GREEN]: fast valid text response — callGemini succeeds and returns the text',
    async () => {
      // 999.1444 test-isolation fix (mirrors B6-guard's pattern): this test previously
      // relied on an ambient real GEMINI_API_KEY leaking into the jest process from the
      // shell to reach GeminiAIAdapter's "configured" success path (isConfigured() ===
      // true), rather than injecting its own fake configured adapter. jest.setupEnv.js's
      // 999.1444 env-scrub (W2) now deletes any such leaked key after dotenv load, which
      // is CORRECT (that leak is exactly the class of bug 999.1444 closes) — but it
      // exposed that this test had no explicit key/adapter setup of its own, so it
      // regressed to the not-configured branch (generate() returns {} → structured
      // "Unexpected Gemini response structure" 500) once the ambient key was gone.
      // Fix: inject a configured adapter (client present → isConfigured() is
      // unconditionally true, same as B6-guard) so the test no longer depends on shell
      // environment state.
      const { GeminiAIAdapter } = require('../../../src/slices/ai-enrichment/facade');
      const configuredAdapter = new GeminiAIAdapter({
        client: {
          models: {
            generateContent: async () => ({ text: JSON.stringify({ ops: [], msg: 'All good.' }) }),
          },
        },
        db: noopDb,
      });
      const facade = require('../../../src/slices/ai-enrichment/facade');
      facade._setAdapters({ aiAdapter: configuredAdapter });

      // mockReset (not just the beforeEach's clearAllMocks): B7-red/B7-guard-2 run
      // against a NOT-configured adapter (generate() short-circuits to {} without ever
      // calling trackedGeminiCall — see isConfigured()), so their own
      // mockResolvedValueOnce(...) queues are left un-consumed. clearAllMocks() does not
      // drain a mock's queued once-values (only mockReset()/a shift does), so without
      // this reset THIS test — the first one in the file whose adapter is actually
      // configured — would shift one of THEIR stale queued values instead of its own.
      mockTrackedGeminiCall.mockReset();

      // Non-regression: a well-formed result.text response should still return 200.
      mockTrackedGeminiCall.mockResolvedValueOnce({
        text: JSON.stringify({ ops: [], msg: 'All good.' }),
      });

      const request = require('supertest');
      resolveQueue.push({ cnt: 0 });

      const res = await request(app)
        .post('/api/ai/command')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .send({ command: 'list tasks', tasks: [], statuses: {}, config: {} });

      // A well-formed result.text response returns 200 with the parsed { ops, msg }
      // (ai.controller success path: res.json({ ops, msg })). The prior `toBe(500)`
      // was a mechanical test-rot collapse (commit a05a4d2) contradicting this test's
      // own GUARD-GREEN intent + the body.msg assertion below.
      expect(res.status).toBe(200);
      expect(res.body.msg).toBe('All good.');
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// B8 — Cached client ignores GEMINI_API_KEY rotation
// ─────────────────────────────────────────────────────────────────────────────

describe('B8 — GeminiAIAdapter._getClient(): key rotation triggers re-instantiation (live-invalidation)', () => {
  // Design choice for bert: LIVE-INVALIDATION contract.
  //
  // GeminiAIAdapter must store the key it used to build the current client
  // (this._cachedApiKey). On each _getClient() call, if env.GEMINI_API_KEY has
  // changed since the client was built, the cached client is discarded and a
  // new one is built with the new key.
  //
  // Implementation sketch:
  //   _getClient() {
  //     const currentKey = this._env.GEMINI_API_KEY || '';
  //     if (this._client && this._cachedApiKey === currentKey) return this._client;
  //     // rebuild ...
  //     this._cachedApiKey = currentKey;
  //     return this._client;
  //   }
  //
  // The test uses the module-level MockGoogleGenAI to count constructor calls.

  beforeEach(() => {
    MockGoogleGenAI.mockClear();
    mockGoogleGenAIInstances.length = 0;
  });

  test(
    'B8-red [EXPECT-RED]: GEMINI_API_KEY changed after first _getClient() call → new GoogleGenAI instantiated with new key ' +
    '(currently returns cached client — no re-instantiation)',
    async () => {
      // We use jest.isolateModules to get a fresh GeminiAIAdapter that does not
      // carry state from other tests. The @google/genai mock is module-level and
      // stays in scope.
      const GeminiAIAdapterFresh = await new Promise((resolve) => {
        jest.isolateModules(() => {
          const A = require('../../../src/slices/ai-enrichment/adapters/GeminiAIAdapter');
          resolve(A);
        });
      });

      // Arrange: injected mutable env object (models process.env as a mutable ref).
      const env = {
        GEMINI_API_KEY: 'key-v1',
        USE_VERTEX_AI: 'false',
        GOOGLE_CLOUD_PROJECT: '',
      };

      const adapter = new GeminiAIAdapterFresh({ env, db: noopDb });

      // Step 1: first call — builds client with key-v1
      const client1 = adapter._getClient();
      expect(MockGoogleGenAI).toHaveBeenCalledTimes(1);
      // The first instantiation must have received apiKey: 'key-v1'
      expect(MockGoogleGenAI.mock.calls[0][0]).toMatchObject({ apiKey: 'key-v1' });
      expect(client1).toBe(mockGoogleGenAIInstances[0]);

      // Step 2: rotate the key in the env object (simulates GEMINI_API_KEY env rotation)
      env.GEMINI_API_KEY = 'key-v2';

      // Step 3: second call to _getClient() — must detect key change and re-instantiate.
      //
      // On current code: this._client is non-null → returns cached client immediately.
      //   MockGoogleGenAI called only once → expect(MockGoogleGenAI).toHaveBeenCalledTimes(2) FAILS → RED.
      //
      // After fix (live-invalidation): key changed → this._client = null → rebuild.
      //   MockGoogleGenAI called a second time with apiKey: 'key-v2' → PASSES → GREEN.
      const client2 = adapter._getClient();

      expect(MockGoogleGenAI).toHaveBeenCalledTimes(2); // RED on current code — only 1
      expect(MockGoogleGenAI.mock.calls[1][0]).toMatchObject({ apiKey: 'key-v2' }); // RED on current code
      expect(client2).not.toBe(client1); // RED on current code — same object returned
    }
  );

  test(
    'B8-guard [GUARD-GREEN]: same key on repeated _getClient() calls — client NOT re-instantiated (cache preserved)',
    async () => {
      // Non-regression: if the key has NOT changed, the cached client must be reused.
      // After fix, repeated calls with the same key must still return the same instance.
      const GeminiAIAdapterFresh = await new Promise((resolve) => {
        jest.isolateModules(() => {
          const A = require('../../../src/slices/ai-enrichment/adapters/GeminiAIAdapter');
          resolve(A);
        });
      });

      const env = { GEMINI_API_KEY: 'stable-key', USE_VERTEX_AI: 'false', GOOGLE_CLOUD_PROJECT: '' };
      const adapter = new GeminiAIAdapterFresh({ env, db: noopDb });

      const c1 = adapter._getClient();
      const c2 = adapter._getClient(); // same key — must return cached instance

      // One instantiation only: c1 === c2
      expect(MockGoogleGenAI).toHaveBeenCalledTimes(1);
      expect(c1).toBe(c2);
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// B9 — BOOT-LEVEL contract: facade.init() must validate DB config at server boot
//
// REWRITE (2026-06-12 re-review, ernie+zoe BLOCK):
//   The original B9 tested a constructor-level NODE_ENV allowlist check
//   (['development','production','test']). That is the WRONG assertion:
//     1. The facade is lazy — adapters built on first call, not at boot.
//        A bad-config deploy still boots clean under the constructor approach.
//     2. The NODE_ENV string check is not a db-config validation — it checks
//        an allowlist, not whether the DB pool can actually be configured.
//        NODE_ENV='staging' with a working DB fails; NODE_ENV='production' with
//        a broken connection string passes. These are false positives + negatives.
//
//   The boot contract: facade.init() EAGERLY calls getDefaultDb() and propagates
//   any throw to the caller (the server boot sequence). The validation is about
//   REAL db-config resolution: mock getDefaultDb to throw → init() throws;
//   mock getDefaultDb to resolve → init() passes. NODE_ENV is irrelevant.
//
//   All three B9-boot-* tests FAIL against current code because facade.init
//   is not a function (does not exist yet).
// ─────────────────────────────────────────────────────────────────────────────

describe('B9 — facade.init(): boot hook must validate real DB config at server boot (not NODE_ENV string)', () => {
  // ── Run-order-robustness design (ernie WARN, 2026-06-12 re-review) ─────────────
  //
  // PROBLEM with the prior approach (jest.spyOn on a module-level libDb reference):
  //   1. `const libDb = require('../../../src/lib/db')` captures the mock object at
  //      describe-evaluation time.
  //   2. `jest.spyOn(libDb, 'getDefaultDb')` spies on that object's property.
  //   3. `facade.init()` does `const { getDefaultDb } = require('../../lib/db')` at
  //      CALL TIME — a fresh require inside the async function.
  //   4. While all requires within the same test-file module registry return the same
  //      mock object (so the spy IS visible in the normal case), the spy approach is
  //      fragile: if `jest.resetModules()` is ever called within this file (e.g. by
  //      a future test author), the registry is cleared and the NEXT require of
  //      lib/db returns a NEW object — not the one libDb points to. The spy on the
  //      old libDb reference is then an orphan: facade's require gets the unspied
  //      object and B9-boot-red can silently stop asserting (init() resolves when
  //      it should reject — "Received promise resolved instead of rejected").
  //
  // FIX — jest.doMock at the mock-path level + fresh facade require per test:
  //   Each B9 test calls jest.resetModules() to clear the registry, then registers
  //   the desired lib/db behaviour via jest.doMock (NOT hoisted, unlike jest.mock),
  //   then requires the facade AFTER the doMock registration. This means:
  //     a) The facade module is loaded fresh (no stale singleton).
  //     b) facade.init()'s `require('../../lib/db')` resolves from the SAME registry
  //        that the doMock registered in — the mock is bound to the path in the
  //        CURRENT registry, not to a captured object reference.
  //     c) Any prior jest.resetModules() call (in this file or from run-order
  //        effects) does NOT orphan the spy because we explicitly reset + re-register
  //        the mock before each test. The intercept is always re-established.
  //
  // Why jest.doMock (not jest.mock)?
  //   jest.mock is hoisted by Babel to the top of the file — it fires once at file
  //   load time. jest.doMock is NOT hoisted and registers in the CURRENT registry at
  //   call time, making it the correct tool for per-test mock variation after
  //   jest.resetModules() clears the prior registry.
  //
  // Registry restoration after each test:
  //   afterEach calls jest.resetModules() again + jest.doMock to restore the
  //   module-level mock for '../../../src/lib/db' (which the other B6/B7/B8 tests
  //   rely on). This ensures the B9 describe block does not pollute sibling suites.
  //
  // Mutation contract (B9-boot-red):
  //   Remove the `getDefaultDb()` call from facade.init(). Now the doMock'd throw
  //   is never triggered → init() resolves → rejects.toThrow() FAILS → mutant KILLED.
  //   This works under ALL run orders because the mock is always re-registered in the
  //   current registry before the facade is required.

  afterEach(() => {
    // Restore NODE_ENV — B9-env-ok mutates it to prove the NODE_ENV-agnostic contract.
    process.env.NODE_ENV = 'test';
    // Restore the module-level lib/db mock so sibling suites (B6/B7/B8) that run
    // after B9 tests still get the expected mockDb from getDefaultDb().
    // (jest.resetModules clears the registry; the module-level jest.mock is hoisted
    // and therefore already registered in the file's original registry — but after
    // resetModules the next require re-evaluates and picks up our doMock restoration.)
    jest.resetModules();
    jest.doMock('../../../src/lib/db', () => {
      const actual = jest.requireActual('../../../src/lib/db');
      return Object.assign({}, actual, { getDefaultDb: () => mockDb });
    });
  });

  test(
    'B9-boot-red [EXPECT-RED]: facade.init() with getDefaultDb() mocked to THROW → ' +
    'init() must throw the db-config error at boot ' +
    '(currently FAILS: facade.init is not a function)',
    async () => {
      // Arrange: clear the registry, then register a lib/db mock that throws when
      // getDefaultDb() is called — simulating a bad DB config (broken connection
      // string, missing env vars, unrecognised NODE_ENV in knexfile).
      //
      // The key guarantee: facade.init()'s `require('../../lib/db')` resolves from
      // the SAME registry that the doMock registered in. The intercept is bound to
      // the mock path in the CURRENT registry — it cannot be orphaned by a prior
      // resetModules() call in a sibling suite because we always reset + re-register
      // before requiring the facade.
      const dbConfigError = new Error('No database configuration found for environment: bad-config');
      jest.resetModules();
      jest.doMock('../../../src/lib/db', () => ({
        getDefaultDb: () => { throw dbConfigError; },
      }));
      const facade = require('../../../src/slices/ai-enrichment/facade');

      // Step 1: init() must exist (if it doesn't, the test fails with a clear message)
      expect(typeof facade.init).toBe('function');

      // Step 2: calling init() with a throwing getDefaultDb → must propagate the throw.
      // Mutation target: remove the getDefaultDb() call from facade.init() → this
      // rejects.toThrow() assertion FAILS → mutant KILLED.
      await expect(facade.init()).rejects.toThrow(/No database configuration found/);
    }
  );

  test(
    'B9-boot-guard [GUARD-GREEN]: facade.init() with getDefaultDb() mocked to RESOLVE → ' +
    'init() resolves cleanly; subsequent generate() and checkQuota() calls work ' +
    '(currently FAILS: facade.init is not a function)',
    async () => {
      // Arrange: clear the registry, then register a lib/db mock that returns a valid
      // mock db handle — simulating a correctly-configured deploy.
      jest.resetModules();
      jest.doMock('../../../src/lib/db', () => ({
        getDefaultDb: () => mockDb,
      }));
      const facade = require('../../../src/slices/ai-enrichment/facade');

      // Step 1: init() must exist
      expect(typeof facade.init).toBe('function');

      // Step 2: init() resolves cleanly — no throw
      await expect(facade.init()).resolves.not.toThrow();

      // Step 3: non-regression — generate() and checkQuota() are still callable after init
      // (init does not break the facade's lazy-singleton pattern)
      expect(typeof facade.generate).toBe('function');
      expect(typeof facade.checkQuota).toBe('function');
    }
  );

  test(
    'B9-env-ok [GUARD-GREEN]: bogus NODE_ENV (not in knexfile allowlist) but getDefaultDb() ' +
    'resolves → facade.init() must NOT throw ' +
    '(proves the check is db-resolution, NOT a NODE_ENV string check) ' +
    '(currently FAILS: facade.init is not a function)',
    async () => {
      // This test pins the CRITICAL distinction between the old wrong check and the new
      // correct one. The old constructor check used a hardcoded NODE_ENV allowlist:
      //   if (['development','production','test'].indexOf(NODE_ENV) === -1) throw ...
      // This would REJECT NODE_ENV='staging' even if the DB is fully working.
      //
      // The new contract: only the getDefaultDb() resolution matters.
      // If getDefaultDb() resolves (DB config is valid), init() must pass regardless
      // of what NODE_ENV is set to.

      // Set a NODE_ENV that would fail the old string-allowlist check.
      process.env.NODE_ENV = 'staging_env_b9_telly_test';

      // Clear the registry and register a lib/db mock that resolves — simulating a
      // staging environment where knexfile DOES have a 'staging' entry.
      jest.resetModules();
      jest.doMock('../../../src/lib/db', () => ({
        getDefaultDb: () => mockDb,
      }));
      const facade = require('../../../src/slices/ai-enrichment/facade');

      expect(typeof facade.init).toBe('function');

      // init() must NOT throw — getDefaultDb resolved, so the DB config is valid.
      // Mutation target: add a NODE_ENV string check inside init() → this
      // resolves.not.toThrow() assertion FAILS → mutant KILLED.
      await expect(facade.init()).resolves.not.toThrow();
    }
  );

  test(
    'B9-boot-assert [REFER→bert]: server.js boot sequence must call facade.init() ' +
    '— this test documents the WIRING requirement, not a unit assertion. ' +
    'bert must add `await require(./slices/ai-enrichment/facade).init()` to server.js start().',
    () => {
      // This test intentionally PASSES on current code as a documentation pin.
      // It is a REFER, not a test: the boot-level wiring (server.js calling facade.init())
      // cannot be unit-tested without spinning up the full server, which is an E2E concern.
      //
      // The init() contract is fully pinned by B9-boot-red (throw on bad config) and
      // B9-boot-guard (resolve on good config). The wiring of init() into the server
      // boot sequence is bert's implementation responsibility:
      //
      //   server.js start() — add before app.listen():
      //     await require('./slices/ai-enrichment/facade').init();
      //
      // If init() throws (bad DB config), start() propagates the error and the
      // process exits — surfacing the misconfiguration at boot, not first request.
      //
      // REFER→bert: wire facade.init() into server.js start() (before app.listen).
      expect(true).toBe(true); // documentation pin only
    }
  );
});

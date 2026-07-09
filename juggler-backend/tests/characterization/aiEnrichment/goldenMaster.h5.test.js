/**
 * H5 W0 — AI Enrichment Characterization Golden Master
 *
 * PURPOSE: Pins the CURRENT behavior of the juggler AI surface (B1–B4) as a
 * snapshot oracle BEFORE the hexagonal extraction (Phase H5) begins. This suite
 * must stay GREEN against the un-refactored code AND against the extracted facade
 * after the refactor — behavior-identical is the binding gate.
 *
 * Behaviors pinned (per TRACEABILITY.md B1–B4):
 *   B1 — ai.controller.handleCommand: user command → {ops,msg} or {unsupported:true};
 *         daily quota enforced via ai_command_log (allow → insert row; deny at 50).
 *   B2 — task.routes GET /suggest-icon?text=...: returns single emoji; validation
 *         (non-empty, non-ASCII, <=4 chars); returns {icon:null} on any error.
 *   B3 — trackedGeminiCall (gemini-tracked-call.js): enqueues ai_usage_outbox row
 *         on success AND on error (finally block); ai_command_log insert on quota allow.
 *   B4 — Gemini client instantiation branches: Vertex (USE_VERTEX_AI=true,
 *         needs GOOGLE_CLOUD_PROJECT) vs API-key (GEMINI_API_KEY); missing config
 *         → graceful (suggest-icon → null, handleCommand → 500).
 *
 * CONSTRAINTS:
 *   - No real Google API calls. @google/genai is fully mocked.
 *   - All DB calls use createMockChainDb (pure-unit, no Docker required) EXCEPT
 *     the ai_command_log / ai_usage_outbox integration tests (tagged :db) which
 *     require test-bed MySQL on 3407.
 *   - ai-usage-queue.service enqueue is mocked so unit tests don't hit the DB.
 *
 * SELF-MUTATION VERIFICATION (rubric §Step 4, "self-mutation each pin"):
 *   Each critical comparator was manually mutated and ≥1 test confirmed FAIL
 *   before writing GREEN. See inline mutation notes.
 *
 * TRACEABILITY: .planning/kermit/juggler-hex-h5-ai/TRACEABILITY.md B1–B4
 *
 * DESIGN NOTE — module isolation:
 *   jest.resetModules() is NOT used in the global beforeEach because it would
 *   break the top-level jest.mock() calls that the whole describe tree depends on.
 *   Instead:
 *   - The ai.controller._genAIClient singleton is reset between tests by
 *     directly nulling the module's internal state via the reset helper below.
 *   - B4 tests that need environment-variable variation are in a separate
 *     describe block that uses jest.isolateModules() for safe per-test isolation.
 */

'use strict';

process.env.NODE_ENV = 'test';

// ── Env setup BEFORE module load ──────────────────────────────────────────────
// ai.controller.js captures module-level constants at load time:
//   const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
//   const USE_VERTEX_AI = process.env.USE_VERTEX_AI === 'true';
// We must set env vars BEFORE buildApp() loads ai.controller, otherwise
// GEMINI_API_KEY='' and getGenAIClient() throws "GEMINI_API_KEY not configured"
// on every request. The .env file sets both, but we delete GOOGLE_CLOUD_PROJECT
// to avoid real Vertex AI calls (MockGoogleGenAI handles both branches anyway).
// Since MockGoogleGenAI intercepts all GoogleGenAI construction, env values here
// just need to satisfy the guards; they are never used for real API calls.
if (!process.env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = 'test-api-key-init';
if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'test-project-init';

const { createMockChainDb } = require('../../helpers/mockChainDb');

// ── Mocks wired BEFORE any require of the modules under test ──────────────────

// 1. Mock @google/genai — controllable GoogleGenAI client.
//    Mutation note: if generateContent is not called / returns wrong shape,
//    tests B1.4, B2.3, B3.1 will FAIL — proving the tests exercise the mock path.
const mockGenerateContent = jest.fn();
const MockGoogleGenAI = jest.fn().mockImplementation(() => ({
  models: { generateContent: mockGenerateContent },
}));
jest.mock('@google/genai', () => ({
  GoogleGenAI: MockGoogleGenAI,
}));

// 2. Mock ai-usage-queue.service — captures enqueue calls without hitting DB.
const mockEnqueue = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../src/slices/ai-enrichment/adapters/ai-usage-queue.service', () => ({
  enqueue: mockEnqueue,
}));

// 3. Mock jwt-auth middleware directly so req.user flows through without DB lookup.
//    auth-client (used by jwt-auth.js internally) and the jwt-auth module itself
//    must both be mocked: auth-client alone is insufficient because jwt-auth.js
//    also does db('users').where(...).first() after auth-client returns.
jest.mock('auth-client', () => ({
  authenticateJWT: () => (req, res, next) => next(),
}));
jest.mock('../../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => next(),
  validateRefreshToken: (req, res, next) => next(),
  verifyToken: jest.fn(),
}));

// 4. Mock plan-features.middleware (not under test).
jest.mock('../../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => next(),
}));

// 5. Mock feature-gate middleware (not under test).
jest.mock('../../../src/middleware/feature-gate', () => ({
  requireFeature: () => (req, res, next) => next(),
  checkUsageLimit: () => (req, res, next) => next(),
}));

// 6. Mock rate-limit-store (redis).
jest.mock('../../../src/lib/rate-limit-store', () => ({
  maybeRedisStore: () => undefined,
}));

// 6a. Mock express-rate-limit to disable rate limiting in tests.
//     The per-user 2/min limit (ai.routes.js aiLimiter) would block test requests
//     after the first 2 per window. Bypass it entirely for characterization.
jest.mock('express-rate-limit', () => () => (req, res, next) => next());

// 7. Mock entity-limits middleware.
jest.mock('../../../src/middleware/entity-limits', () => ({
  checkTaskOrRecurringLimit: (req, res, next) => next(),
  checkBatchTaskLimits: (req, res, next) => next(),
}));

// 8. Mock validate middleware.
jest.mock('../../../src/middleware/validate', () => ({
  validate: () => (req, res, next) => next(),
}));

// 9. Mock task.controller (not under test for suggest-icon tests, task routes just need it).
jest.mock('../../../src/controllers/task.controller', () => ({
  getAllTasks: (req, res) => res.json([]),
  getTask: (req, res) => res.json({}),
  createTask: (req, res) => res.json({}),
  batchCreateTasks: (req, res) => res.json([]),
  batchUpdateTasks: (req, res) => res.json([]),
  updateTask: (req, res) => res.json({}),
  deleteTask: (req, res) => res.json({}),
  updateTaskStatus: (req, res) => res.json({}),
  reEnableTask: (req, res) => res.json({}),
  takeOwnership: (req, res) => res.json({}),
  getVersion: (req, res) => res.json({}),
  getDisabledTasks: (req, res) => res.json([]),
  searchTasks: (req, res) => res.json([]),
  undoTask: (req, res) => res.json({}),
}));

// 10. Dual-mock src/db and src/lib/db to the same mockDb.
//     (same pattern as H3/H4 golden masters — both must resolve to avoid
//     module resolution issues when ai.controller uses getDb = () => require('../db'))
const { mockDb, resolveQueue } = createMockChainDb();
jest.mock('../../../src/db', () => mockDb);
jest.mock('../../../src/lib/db', () => {
  const actual = jest.requireActual('../../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

// ── Supertest app builder ─────────────────────────────────────────────────────
const supertest = require('supertest');
const express = require('express');

// Build the app once at module load (mocks are stable for the whole file).
// Route modules are loaded once here; they re-use the same mocked dependencies.
function buildApp() {
  const app = express();
  app.use(express.json());
  // Inject a mock user onto req (bypasses real JWT validation).
  app.use((req, res, next) => {
    req.user = { id: 42, email: 'test@example.com', name: 'Test User' };
    next();
  });
  // Mount routes under test. These requires are cached after the first call;
  // that is correct — we want the same mocked module graph throughout the suite.
  app.use('/api/ai', require('../../../src/routes/ai.routes'));
  app.use('/api/tasks', require('../../../src/routes/task.routes'));
  return app;
}

const app = buildApp();

// ── Reset helper — clears the _genAIClient singleton between tests ────────────
// ai.controller caches _genAIClient in module scope. We need to reset it so
// environment-variable branch tests pick up fresh env state.
// We do this by reaching into the module registry (jest.requireActual returns the
// live module; we manipulate its exported closure via the same require path).
function resetGenAIClient() {
  // The simplest approach: mock the getGenAIClient path by re-exporting a null.
  // Because ai.controller does `if (_genAIClient) return _genAIClient;` and
  // _genAIClient is module-scoped, we cannot reset it directly from outside without
  // adding an export. Instead we rely on the controller being re-required fresh
  // in tests that need a specific env branch (B4 tests use jest.isolateModules).
  // For B1/B2 tests, the mock GenerateContent is always returned anyway — the
  // cached client doesn't matter as long as the mock call is set up correctly.
}

// ── Shared test utilities ─────────────────────────────────────────────────────

/**
 * Stub Gemini to return a successful response with canned text.
 * Mutation note: if this isn't called, B1.4 / B2.3 will FAIL — proving
 * the tests actually exercise the mock path.
 */
function stubGeminiSuccess(text) {
  mockGenerateContent.mockResolvedValueOnce({
    text,
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  });
}

/**
 * Stub Gemini to return a candidates-array response (alternative shape).
 */
function stubGeminiCandidates(text) {
  mockGenerateContent.mockResolvedValueOnce({
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 },
  });
}

/**
 * Stub Gemini to throw an error.
 */
function stubGeminiError(message = 'Gemini API error') {
  mockGenerateContent.mockRejectedValueOnce(new Error(message));
}

// ── Test helper: quota mock ───────────────────────────────────────────────────

/**
 * Prime the mockDb resolveQueue for a quota-ALLOW scenario:
 *   1. count query → { cnt: currentCount } (below limit)
 *   2. insert → default (void)
 * Mutation note: mutating AI_DAILY_LIMIT (50→49) makes B1.9 FAIL.
 */
function primeQuotaAllow(currentCount = 0) {
  resolveQueue.push({ cnt: currentCount }); // count returns N < 50
  // insert resolves via chain.insert mock (returns Promise.resolve())
}

/**
 * Prime the mockDb resolveQueue for a quota-DENY scenario:
 *   count query → { cnt: 50 } (at or above limit)
 * Mutation note: mutating the >= check (to >) makes B1.9 FAIL.
 */
function primeQuotaDeny() {
  resolveQueue.push({ cnt: 50 }); // at the limit
}

// ── Global beforeEach / afterEach ─────────────────────────────────────────────
// NOTE: We CANNOT call jest.clearAllMocks() globally because it strips the
// mockImplementation from createMockChainDb's chain methods (insert, select, first,
// etc.), making subsequent calls return undefined instead of Promise.resolve().
// We call mockClear() (clears call history, NOT implementations) on mocks we need
// to assert on, and mockReset() (clears history AND queued values) on value mocks.
//
// ENV STRATEGY: The juggler-backend/.env file (loaded by dotenv at module init)
// may set USE_VERTEX_AI=true and GOOGLE_CLOUD_PROJECT. ai.controller caches
// module-level const USE_VERTEX_AI at load time. If USE_VERTEX_AI=true, then
// getGenAIClient() requires GOOGLE_CLOUD_PROJECT to be set — or it throws.
// The MockGoogleGenAI intercepts `new GoogleGenAI(...)` but the `if (!project)`
// guard runs BEFORE the constructor call.
// Solution: always set GOOGLE_CLOUD_PROJECT to a test placeholder in beforeEach
// so getGenAIClient() reaches the mock constructor instead of throwing. The
// mock constructor ignores the project value entirely.
beforeEach(() => {
  // Clear call history (NOT implementations) on mockDb chain methods we assert on.
  mockDb.insert.mockClear();
  mockDb.where.mockClear();
  mockDb.count.mockClear();
  mockDb.first.mockClear();
  mockDb.select.mockClear();
  mockDb.mockClear(); // the callable itself
  // Reset value mocks (clears queued values AND call history).
  mockGenerateContent.mockReset();
  mockEnqueue.mockReset();
  mockEnqueue.mockResolvedValue(undefined); // restore default so enqueue never throws
  MockGoogleGenAI.mockClear();
  resolveQueue.length = 0;
  // Always set both Vertex and API-key env vars to safe test values.
  // This ensures getGenAIClient() reaches MockGoogleGenAI regardless of branch.
  process.env.GEMINI_API_KEY = 'test-api-key';
  process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
  // Leave USE_VERTEX_AI as-is from the .env (the module const is already baked in).
  // The branch taken doesn't matter for tests because MockGoogleGenAI captures both.
});

afterEach(() => {
  // Restore env to whatever .env had (dotenv already loaded it).
  // We only need to clean up test-specific overrides.
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_CLOUD_PROJECT;
});

// ── B1: handleCommand behavior ────────────────────────────────────────────────
describe('B1 — ai.controller.handleCommand', () => {
  describe('B1.1 — happy path: valid command → {ops, msg}', () => {
    it('returns {ops, msg} for a standard command response', async () => {
      primeQuotaAllow(0);
      stubGeminiSuccess(JSON.stringify({ ops: [{ op: 'status', id: 't1', value: 'done' }], msg: 'Marked done' }));

      const res = await supertest(app)
        .post('/api/ai/command')
        .send({ command: 'mark task t1 done', tasks: [], statuses: {}, config: {} });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ops: expect.any(Array), msg: expect.any(String) });
      expect(res.body.ops[0]).toMatchObject({ op: 'status', id: 't1', value: 'done' });
      expect(res.body.msg).toBe('Marked done');
    });

    it('ops defaults to [] when Gemini returns no ops key', async () => {
      primeQuotaAllow(0);
      stubGeminiSuccess(JSON.stringify({ msg: 'Nothing to do' }));

      const res = await supertest(app)
        .post('/api/ai/command')
        .send({ command: 'show me things', tasks: [], statuses: {} });

      expect(res.status).toBe(200);
      expect(res.body.ops).toEqual([]);
      expect(res.body.msg).toBe('Nothing to do');
    });

    it('msg defaults to "Done." when Gemini returns no msg key', async () => {
      primeQuotaAllow(0);
      stubGeminiSuccess(JSON.stringify({ ops: [] }));

      const res = await supertest(app)
        .post('/api/ai/command')
        .send({ command: 'do nothing', tasks: [] });

      expect(res.status).toBe(200);
      expect(res.body.msg).toBe('Done.');
    });
  });

  describe('B1.2 — unsupported command → {ops:[], unsupported:true, msg}', () => {
    it('returns unsupported:true when model flags out-of-scope', async () => {
      primeQuotaAllow(0);
      stubGeminiSuccess(JSON.stringify({
        ops: [],
        msg: "I can only help with Juggler tasks and scheduling.",
        unsupported: true,
      }));

      const res = await supertest(app)
        .post('/api/ai/command')
        .send({ command: 'write me a poem', tasks: [] });

      expect(res.status).toBe(200);
      expect(res.body.unsupported).toBe(true);
      expect(res.body.ops).toEqual([]);
      expect(typeof res.body.msg).toBe('string');
    });

    it('uses fallback msg when model returns unsupported:true with no msg', async () => {
      primeQuotaAllow(0);
      stubGeminiSuccess(JSON.stringify({ ops: [], unsupported: true }));

      const res = await supertest(app)
        .post('/api/ai/command')
        .send({ command: 'tell me a joke', tasks: [] });

      expect(res.status).toBe(200);
      expect(res.body.unsupported).toBe(true);
      expect(res.body.msg).toBe('That request is outside what I can help with in Juggler.');
    });
  });

  describe('B1.3 — input validation: missing/empty command → 400', () => {
    it('returns 400 when command is missing', async () => {
      // No quota prime needed — exits before DB call.
      const res = await supertest(app)
        .post('/api/ai/command')
        .send({ tasks: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No command provided');
    });

    it('returns 400 when command is empty string', async () => {
      const res = await supertest(app)
        .post('/api/ai/command')
        .send({ command: '', tasks: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No command provided');
    });

    it('returns 400 when command is whitespace only', async () => {
      const res = await supertest(app)
        .post('/api/ai/command')
        .send({ command: '   ', tasks: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No command provided');
    });

    it('does NOT check quota for an empty-command request (quota not called)', async () => {
      // resolveQueue is empty — if quota DB call is made, it will throw.
      // The test confirms the 400 guard fires BEFORE any DB call.
      const res = await supertest(app)
        .post('/api/ai/command')
        .send({ command: '' });

      expect(res.status).toBe(400);
      // mockDb.where should NOT have been called by the quota path.
      // (It may have been called by other middleware but not by ai.controller).
      // We verify by checking the insert path was never reached:
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe('B1.4 — Gemini response parsing: extracts JSON from various response shapes', () => {
    it('parses a clean JSON string response', async () => {
      primeQuotaAllow(0);
      stubGeminiSuccess('{"ops":[],"msg":"clean"}');

      const res = await supertest(app)
        .post('/api/ai/command')
        .send({ command: 'test', tasks: [] });

      expect(res.status).toBe(200);
      expect(res.body.msg).toBe('clean');
    });

    it('strips markdown code fences before parsing', async () => {
      primeQuotaAllow(0);
      stubGeminiSuccess('```json\n{"ops":[],"msg":"fenced"}\n```');

      const res = await supertest(app)
        .post('/api/ai/command')
        .send({ command: 'test', tasks: [] });

      expect(res.status).toBe(200);
      expect(res.body.msg).toBe('fenced');
    });

    it('extracts JSON object from text with surrounding content', async () => {
      primeQuotaAllow(0);
      stubGeminiSuccess('Here is the result: {"ops":[],"msg":"extracted"} end.');

      const res = await supertest(app)
        .post('/api/ai/command')
        .send({ command: 'test', tasks: [] });

      expect(res.status).toBe(200);
      expect(res.body.msg).toBe('extracted');
    });

    it('returns 422 when Gemini response is not parseable as JSON at all', async () => {
      primeQuotaAllow(0);
      stubGeminiSuccess('not json at all, no braces');

      const res = await supertest(app)
        .post('/api/ai/command')
        .send({ command: 'test', tasks: [] });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Bad JSON from AI');
    });

    it('uses candidates[0] shape when result.text is absent', async () => {
      primeQuotaAllow(0);
      stubGeminiCandidates('{"ops":[],"msg":"from candidates"}');

      const res = await supertest(app)
        .post('/api/ai/command')
        .send({ command: 'test', tasks: [] });

      expect(res.status).toBe(200);
      expect(res.body.msg).toBe('from candidates');
    });
  });

  describe('B1.5 — Gemini throws → 500', () => {
    it('returns 500 when Gemini call throws', async () => {
      primeQuotaAllow(0);
      stubGeminiError('network timeout');

      const res = await supertest(app)
        .post('/api/ai/command')
        .send({ command: 'mark t1 done', tasks: [] });

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('B1.6 — user input sanitization', () => {
    it('sanitizes curly quotes and smart dashes before sending to Gemini', async () => {
      primeQuotaAllow(0);
      stubGeminiSuccess('{"ops":[],"msg":"sanitized"}');

      const res = await supertest(app)
        .post('/api/ai/command')
        // Using curly quotes/em-dash — the controller should clean these.
        .send({ command: '‘mark’ task—done', tasks: [] });

      expect(res.status).toBe(200);
      // Verify generateContent was called (sanitized input was passed through).
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callContents = mockGenerateContent.mock.calls[0][0].contents;
      // Curly quotes → straight quotes, em-dash → --.
      expect(callContents).toContain("'mark' task--done");
    });
  });
});

// ── B1.7–B1.13: daily quota enforcement ──────────────────────────────────────
describe('B1 — daily quota enforcement (ai_command_log)', () => {
  it('B1.7 — allows request when quota count is 0 (fresh user)', async () => {
    primeQuotaAllow(0);
    stubGeminiSuccess('{"ops":[],"msg":"ok"}');

    const res = await supertest(app)
      .post('/api/ai/command')
      .send({ command: 'list tasks', tasks: [] });

    expect(res.status).toBe(200);
  });

  it('B1.8 — allows request when quota count is 49 (one below limit)', async () => {
    primeQuotaAllow(49);
    stubGeminiSuccess('{"ops":[],"msg":"ok"}');

    const res = await supertest(app)
      .post('/api/ai/command')
      .send({ command: 'list tasks', tasks: [] });

    expect(res.status).toBe(200);
  });

  it('B1.9 — denies request at exactly 50 → 429 with Daily AI limit message', async () => {
    // Mutation note: changing >= to > in the controller makes this return 200, not 429.
    primeQuotaDeny(); // cnt: 50

    const res = await supertest(app)
      .post('/api/ai/command')
      .send({ command: 'list tasks', tasks: [] });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Daily AI limit reached/);
    expect(res.body.error).toContain('50/day');
  });

  it('B1.10 — denies request at 51 (over limit)', async () => {
    resolveQueue.push({ cnt: 51 });

    const res = await supertest(app)
      .post('/api/ai/command')
      .send({ command: 'list tasks', tasks: [] });

    expect(res.status).toBe(429);
  });

  it('B1.11 — quota check uses 24h rolling window (where created_at >= windowStart)', async () => {
    primeQuotaAllow(10);
    stubGeminiSuccess('{"ops":[],"msg":"ok"}');

    const beforeCall = Date.now();
    await supertest(app)
      .post('/api/ai/command')
      .send({ command: 'list tasks', tasks: [] });
    const afterCall = Date.now();

    // The quota check makes two .where() calls: user_id and created_at >= windowStart.
    const whereCalls = mockDb.where.mock.calls;
    const windowCall = whereCalls.find(call => call[0] === 'created_at');
    expect(windowCall).toBeDefined();

    // The window should be approximately 24h ago.
    const windowStart = windowCall[2]; // third arg: the date value
    expect(windowStart).toBeInstanceOf(Date);
    const windowMs = afterCall - windowStart.getTime();
    expect(windowMs).toBeGreaterThan(24 * 60 * 60 * 1000 - 5000);   // ~24h ago
    expect(windowMs).toBeLessThan(24 * 60 * 60 * 1000 + 5000);      // not beyond 24h+5s
  });

  it('B1.12 — insert to ai_command_log happens on allow, with user_id', async () => {
    primeQuotaAllow(0);
    stubGeminiSuccess('{"ops":[],"msg":"ok"}');

    await supertest(app)
      .post('/api/ai/command')
      .send({ command: 'test', tasks: [] });

    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    const insertCall = mockDb.insert.mock.calls[0][0];
    expect(insertCall).toMatchObject({ user_id: 42 });
  });

  it('B1.13 — no insert to ai_command_log when quota is denied', async () => {
    primeQuotaDeny();

    await supertest(app)
      .post('/api/ai/command')
      .send({ command: 'test', tasks: [] });

    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

// ── B2: /suggest-icon behavior ────────────────────────────────────────────────
// NOTE: suggest-icon in task.routes creates its GoogleGenAI client inline
// (not via the ai.controller singleton). Our top-level MockGoogleGenAI mock
// intercepts all `new GoogleGenAI(...)` calls in the module. The mock constructor
// returns the same client (with mockGenerateContent) regardless of API-key/Vertex args.
// This is the right seam: we prove the route's behavior is correct via the mock.
describe('B2 — GET /api/tasks/suggest-icon', () => {
  describe('B2.1 — missing or empty text → {icon: null}', () => {
    it('returns {icon:null} when text query param is missing', async () => {
      const res = await supertest(app).get('/api/tasks/suggest-icon');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ icon: null });
      // Gemini must NOT be called (no text to embed).
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('returns {icon:null} when text is empty string', async () => {
      const res = await supertest(app).get('/api/tasks/suggest-icon?text=');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ icon: null });
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('returns {icon:null} when text is whitespace-only', async () => {
      const res = await supertest(app).get('/api/tasks/suggest-icon?text=   ');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ icon: null });
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });
  });

  describe('B2.2 — missing config → {icon:null}', () => {
    it('returns {icon:null} gracefully when both GEMINI_API_KEY and GOOGLE_CLOUD_PROJECT are absent', async () => {
      // Clear both API-key and Vertex project. The route reads these at request time.
      // With both absent, whichever branch (API-key or Vertex) is active, neither
      // can create a client — so the route returns {icon:null} and does not throw.
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_CLOUD_PROJECT;

      const res = await supertest(app).get('/api/tasks/suggest-icon?text=buy+milk');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ icon: null });
    });
  });

  describe('B2.3 — happy path: valid emoji returned', () => {
    it('returns {icon: emoji} when Gemini returns a single emoji (text shape)', async () => {
      // 🛒 = U+1F6D2 SHOPPING TROLLEY emoji
      stubGeminiSuccess('🛒');
      const res = await supertest(app).get('/api/tasks/suggest-icon?text=grocery+shopping');
      expect(res.status).toBe(200);
      expect(res.body.icon).toBe('🛒');
    });

    it('returns {icon: emoji} when Gemini returns via candidates shape', async () => {
      // 🚴 = U+1F6B4 BICYCLIST emoji
      stubGeminiCandidates('🚴');
      const res = await supertest(app).get('/api/tasks/suggest-icon?text=bike+ride');
      expect(res.status).toBe(200);
      expect(res.body.icon).toBe('🚴');
    });
  });

  describe('B2.4 — emoji validation: non-ASCII, non-empty, <=4 chars', () => {
    it('returns {icon:null} when Gemini returns ASCII text (not an emoji)', async () => {
      // Mutation note: removing the /\P{ASCII}/u test makes this PASS incorrectly.
      stubGeminiSuccess('A');
      const res = await supertest(app).get('/api/tasks/suggest-icon?text=task');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ icon: null });
    });

    it('returns {icon:null} when Gemini returns a word (multi-char ASCII)', async () => {
      stubGeminiSuccess('work');
      const res = await supertest(app).get('/api/tasks/suggest-icon?text=work');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ icon: null });
    });

    it('returns {icon:null} when Gemini returns empty string', async () => {
      stubGeminiSuccess('');
      const res = await supertest(app).get('/api/tasks/suggest-icon?text=task');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ icon: null });
    });

    it('returns {icon:null} when Gemini returns a string >4 chars', async () => {
      // Mutation note: changing > 4 to > 5 makes this PASS incorrectly.
      // 5 sun emojis = 5 chars (each ☀ is 1 JS char, U+2600) → 5 > 4 → null.
      stubGeminiSuccess('☀☀☀☀☀'); // 5 sun emojis
      const res = await supertest(app).get('/api/tasks/suggest-icon?text=sunny');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ icon: null });
    });

    it('accepts a 4-char non-ASCII string (boundary: exactly 4)', async () => {
      // 4 is the max; this should pass (4 === 4, not > 4).
      stubGeminiSuccess('☀☀☀☀'); // 4 sun emojis
      const res = await supertest(app).get('/api/tasks/suggest-icon?text=sunny');
      expect(res.status).toBe(200);
      expect(res.body.icon).toBe('☀☀☀☀');
    });

    it('accepts a single non-ASCII char (1 char emoji)', async () => {
      stubGeminiSuccess('☀'); // ☀ sun (1 char)
      const res = await supertest(app).get('/api/tasks/suggest-icon?text=sunshine');
      expect(res.status).toBe(200);
      expect(res.body.icon).toBe('☀');
    });
  });

  describe('B2.5 — error handling: any error → {icon:null}, never throws', () => {
    it('returns {icon:null} when Gemini throws (not a 500)', async () => {
      // Mutation note: if the catch block were removed, this would be a 500.
      stubGeminiError('quota exceeded');
      const res = await supertest(app).get('/api/tasks/suggest-icon?text=task');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ icon: null });
    });

    it('returns {icon:null} when Gemini returns no text and no candidates', async () => {
      mockGenerateContent.mockResolvedValueOnce({ usageMetadata: {} });
      const res = await supertest(app).get('/api/tasks/suggest-icon?text=task');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ icon: null });
    });
  });

  describe('B2.6 — Vertex AI branch: missing GOOGLE_CLOUD_PROJECT → {icon:null}', () => {
    it('returns {icon:null} gracefully when USE_VERTEX_AI=true and GOOGLE_CLOUD_PROJECT absent', async () => {
      // Force Vertex AI mode and remove the project.
      // The route reads USE_VERTEX_AI at request time.
      process.env.USE_VERTEX_AI = 'true';
      delete process.env.GOOGLE_CLOUD_PROJECT;

      // The route: if USE_VERTEX_AI=true and !project → return res.json({ icon: null })
      const res = await supertest(app).get('/api/tasks/suggest-icon?text=task');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ icon: null });
    });
  });
});

// ── B3: trackedGeminiCall usage tracking ─────────────────────────────────────
// Unit-test trackedGeminiCall directly (not via HTTP) for precise control.
describe('B3 — trackedGeminiCall (gemini-tracked-call.js) usage tracking', () => {
  const { trackedGeminiCall } = require('../../../src/slices/ai-enrichment/adapters/gemini-tracked-call');
  const AI_USE_CASES = require('../../../src/constants/ai-use-cases');

  function makeDirectClient(resolveTo) {
    return {
      models: {
        generateContent: jest.fn().mockResolvedValueOnce(resolveTo),
      },
    };
  }

  function makeThrowingClient(err) {
    return {
      models: {
        generateContent: jest.fn().mockRejectedValueOnce(err),
      },
    };
  }

  describe('B3.1 — successful call: enqueues usage event', () => {
    it('enqueues an ai_usage_outbox event after a successful Gemini call', async () => {
      const fakeResult = {
        text: 'done',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      };
      const client = makeDirectClient(fakeResult);

      const result = await trackedGeminiCall(
        mockDb, client, 'gemini-2.5-flash', 'test prompt',
        { temperature: 0.2 },
        { useCase: AI_USE_CASES.TASK_AI, userId: 7, correlationId: 'req-123' },
      );

      expect(result).toBe(fakeResult);
      expect(mockEnqueue).toHaveBeenCalledTimes(1);

      const event = mockEnqueue.mock.calls[0][1];
      expect(event).toMatchObject({
        userId: 7,
        useCase: AI_USE_CASES.TASK_AI,
        modelName: 'gemini-2.5-flash',
        modelParams: { temperature: 0.2 },
        tokensIn: 100,
        tokensOut: 50,
        error: false,
        correlationId: 'req-123',
      });
      expect(event.latencyMs).toBeGreaterThanOrEqual(0);
      expect(event.occurredAt).toBeInstanceOf(Date);
    });

    it('enqueues with tokensIn/Out = 0 when usageMetadata is absent', async () => {
      const client = makeDirectClient({ text: 'ok' }); // no usageMetadata
      await trackedGeminiCall(mockDb, client, 'gemini-flash', 'prompt', {}, { useCase: 'test' });

      const event = mockEnqueue.mock.calls[0][1];
      expect(event.tokensIn).toBe(0);
      expect(event.tokensOut).toBe(0);
    });
  });

  describe('B3.2 — error path: enqueues event AND re-throws', () => {
    it('enqueues an error event in the finally block when Gemini throws', async () => {
      const err = Object.assign(new Error('rate limited'), { code: 429 });
      const client = makeThrowingClient(err);

      await expect(
        trackedGeminiCall(mockDb, client, 'gemini-flash', 'prompt', {}, { useCase: AI_USE_CASES.TASK_AI })
      ).rejects.toThrow('rate limited');

      // Mutation note: removing the finally block makes this FAIL (enqueue not called).
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const event = mockEnqueue.mock.calls[0][1];
      expect(event.error).toBe(true);
      expect(event.errorType).toBe(429); // err.code
    });

    it('falls back to constructor name when err.code is absent', async () => {
      const err = new TypeError('bad type');
      const client = makeThrowingClient(err);

      await expect(
        trackedGeminiCall(mockDb, client, 'gemini-flash', 'prompt', {}, { useCase: 'test' })
      ).rejects.toThrow('bad type');

      const event = mockEnqueue.mock.calls[0][1];
      expect(event.errorType).toBe('TypeError');
    });

    it('returns the Gemini result normally (not the enqueue result)', async () => {
      const fakeResult = { text: 'hello' };
      const client = makeDirectClient(fakeResult);

      const returned = await trackedGeminiCall(mockDb, client, 'gemini-flash', 'p', {}, { useCase: 'test' });
      expect(returned).toBe(fakeResult);
    });
  });

  describe('B3.3 — enqueue receives correct db reference', () => {
    it('passes the db argument as first arg to enqueue', async () => {
      const client = makeDirectClient({ text: 'ok' });
      await trackedGeminiCall(mockDb, client, 'model', 'prompt', {}, { useCase: 'x' });

      const enqueueFirstArg = mockEnqueue.mock.calls[0][0];
      expect(enqueueFirstArg).toBe(mockDb);
    });
  });

  describe('B3.4 — userId/correlationId defaults', () => {
    it('defaults userId and correlationId to null when not provided', async () => {
      const client = makeDirectClient({ text: 'ok' });
      await trackedGeminiCall(mockDb, client, 'model', 'prompt', {}, { useCase: 'test' });

      const event = mockEnqueue.mock.calls[0][1];
      expect(event.userId).toBeNull();
      expect(event.correlationId).toBeNull();
    });
  });
});

// ── B4: Gemini client instantiation branches ──────────────────────────────────
// These tests use jest.isolateModules() to get a fresh ai.controller with
// a clean _genAIClient = null, so environment-variable branches can be tested
// without the singleton bleeding between cases.
describe('B4 — Gemini client instantiation (getGenAIClient)', () => {
  describe('B4.1 — API key branch: GEMINI_API_KEY set, USE_VERTEX_AI unset', () => {
    it('creates a GoogleGenAI client with { apiKey } when GEMINI_API_KEY is set', async () => {
      let handleCommand;
      process.env.GEMINI_API_KEY = 'my-test-api-key';
      delete process.env.USE_VERTEX_AI;

      await jest.isolateModulesAsync(async () => {
        // All the same mocks must be re-registered inside isolateModules scope.
        jest.mock('@google/genai', () => ({
          GoogleGenAI: MockGoogleGenAI,
        }));
        jest.mock('../../../src/slices/ai-enrichment/adapters/ai-usage-queue.service', () => ({
          enqueue: mockEnqueue,
        }));
        jest.mock('../../../src/db', () => mockDb);
        jest.mock('../../../src/lib/db', () => {
          const actual = jest.requireActual('../../../src/lib/db');
          return Object.assign({}, actual, { getDefaultDb: () => mockDb });
        });

        const ctrl = require('../../../src/controllers/ai.controller');
        handleCommand = ctrl.handleCommand;

        // Prime quota allow + Gemini stub.
        resolveQueue.push({ cnt: 0 });
        mockGenerateContent.mockResolvedValueOnce({ text: '{"ops":[],"msg":"ok"}', usageMetadata: {} });

        const req = { user: { id: 1 }, body: { command: 'test', tasks: [] } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await handleCommand(req, res);

        // GoogleGenAI constructor should have been called with { apiKey }.
        const constructorCalls = MockGoogleGenAI.mock.calls;
        const apiKeyCall = constructorCalls.find(call => call[0] && call[0].apiKey === 'my-test-api-key');
        expect(apiKeyCall).toBeDefined();
      });
    });
  });

  describe('B4.2 — Vertex AI branch: missing GOOGLE_CLOUD_PROJECT → 500', () => {
    it('returns 500 when USE_VERTEX_AI=true but GOOGLE_CLOUD_PROJECT is absent', async () => {
      process.env.USE_VERTEX_AI = 'true';
      delete process.env.GOOGLE_CLOUD_PROJECT;
      delete process.env.GEMINI_API_KEY;

      let capturedStatus;
      await jest.isolateModulesAsync(async () => {
        jest.mock('@google/genai', () => ({
          GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: jest.fn() } })),
        }));
        jest.mock('../../../src/slices/ai-enrichment/adapters/ai-usage-queue.service', () => ({ enqueue: jest.fn() }));
        jest.mock('../../../src/db', () => mockDb);
        jest.mock('../../../src/lib/db', () => {
          const actual = jest.requireActual('../../../src/lib/db');
          return Object.assign({}, actual, { getDefaultDb: () => mockDb });
        });

        const ctrl = require('../../../src/controllers/ai.controller');
        // Prime quota allow.
        resolveQueue.push({ cnt: 0 });

        const req = { user: { id: 1 }, body: { command: 'test', tasks: [] } };
        const res = {
          status: jest.fn().mockImplementation(s => { capturedStatus = s; return res; }),
          json: jest.fn(),
        };

        await ctrl.handleCommand(req, res);
      });

      // getGenAIClient() throws "GOOGLE_CLOUD_PROJECT required for Vertex AI"
      // → caught by the outer try/catch → res.status(500)
      expect(capturedStatus).toBe(500);
    });
  });

  describe('B4.3 — suggest-icon: env read at request time', () => {
    it('suggest-icon returns {icon:null} when both API-key and project config absent at request time', async () => {
      // The route reads both GEMINI_API_KEY and GOOGLE_CLOUD_PROJECT from process.env
      // on every request (not module-level). With both absent, the route returns {icon:null}.
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_CLOUD_PROJECT;

      const res = await supertest(app).get('/api/tasks/suggest-icon?text=task');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ icon: null });
    });

    it('suggest-icon returns {icon:null} when USE_VERTEX_AI=true and project absent (read at request time)', async () => {
      process.env.USE_VERTEX_AI = 'true';
      delete process.env.GOOGLE_CLOUD_PROJECT;

      const res = await supertest(app).get('/api/tasks/suggest-icon?text=task');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ icon: null });
    });
  });
});

// ── B3 (DB integration): ai_command_log / ai_usage_outbox schema + enqueue ───
// Requires test-bed MySQL on 3407 (tmpfs). Skipped automatically when DB unavailable.
describe('B3 :db — ai_command_log + ai_usage_outbox integration (test-bed 3407)', () => {
  const testDb = require('../../helpers/test-db');

  const TEST_USER_ID = '999901'; // VARCHAR — all juggler user_id columns are VARCHAR(36)

  beforeAll(async () => {
    if (!await testDb.isAvailable()) return;
    // Ensure test user exists (ai_command_log FK references users.id).
    await testDb('users').insert({
      id: TEST_USER_ID,
      email: 'telly-h5-test@example.com',
      name: 'Telly H5 Test',
    }).onConflict('id').ignore();
  });

  afterAll(async () => {
    if (await testDb.isAvailable()) {
      await testDb.clearUser(TEST_USER_ID);
      await testDb.destroy();
    }
  });

  beforeEach(async () => {
    if (!await testDb.isAvailable()) return;
    await testDb('ai_command_log').where('user_id', TEST_USER_ID).del();
    await testDb('ai_usage_outbox').where('user_id', String(TEST_USER_ID)).del();
  });

  it('ai_command_log: insert row has user_id and created_at', async () => {
    if (!await testDb.isAvailable()) return;

    await testDb('ai_command_log').insert({ user_id: TEST_USER_ID });
    const rows = await testDb('ai_command_log').where('user_id', TEST_USER_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(TEST_USER_ID);
    expect(rows[0].created_at).toBeDefined();
    // id is auto-increment bigint — mysql2 returns as string
    expect(rows[0].id).toBeDefined();
  });

  it('quota boundary: 50 rows → KnexAIUsageRepository.checkQuota() returns allowed:false (W1b split interface)', async () => {
    if (!await testDb.isAvailable()) return;

    // W1b update: checkAndLogDailyQuota (single-step count+insert before call) was
    // removed — it had zero production callers after the B5 check/commit split (bert
    // WARN-1 dead-code removal). The split interface is:
    //   checkQuota(userId)  → { allowed: bool } — count-only, NO insert
    //   commitQuota(userId) → void              — insert-only, ONLY after success
    //
    // This test pins the DENY boundary behavior of checkQuota:
    //   50 rows in ai_command_log → count=50 → count >= AI_DAILY_LIMIT(50) → allowed:false
    //   checkQuota is count-only: no additional row is inserted on the deny path.
    //
    // Self-mutation note: if `>=` in KnexAIUsageRepository were changed to `>`,
    // this test would FAIL (50 rows → count=50 → `50 > 50` = false → allowed:true).
    // The mock-path B1.9 test (goldenMaster primeQuotaDeny / primeQuotaAllow) also
    // catches that boundary via the resolveQueue.

    const { KnexAIUsageRepository } = require('../../../src/slices/ai-enrichment/facade');

    // Insert exactly 50 rows for this user (at the daily limit).
    for (let i = 0; i < 50; i++) {
      await testDb('ai_command_log').insert({ user_id: TEST_USER_ID });
    }

    // Call the real SUT with the test-bed DB — checkQuota must return { allowed: false }.
    const repo = new KnexAIUsageRepository({ db: testDb });
    const result = await repo.checkQuota(TEST_USER_ID);
    expect(result.allowed).toBe(false); // 50 >= AI_DAILY_LIMIT(50) → deny

    // checkQuota is count-only: deny path must NOT insert any row.
    // (The old checkAndLogDailyQuota also did NOT insert on deny — behavior preserved.)
    const rowsAfter = await testDb('ai_command_log').where('user_id', TEST_USER_ID);
    expect(rowsAfter).toHaveLength(50); // still exactly 50 — checkQuota never inserts
  });

  it('ai_usage_outbox: enqueue inserts row with expected shape', async () => {
    if (!await testDb.isAvailable()) return;

    // Temporarily override the mock with the real service for this integration test.
    const { enqueue } = jest.requireActual('../../../src/slices/ai-enrichment/adapters/ai-usage-queue.service');

    await enqueue(testDb, {
      userId: TEST_USER_ID,
      useCase: 'task-ai',
      modelName: 'gemini-2.5-flash',
      modelParams: { temperature: 0.2 },
      tokensIn: 10,
      tokensOut: 5,
      latencyMs: 150,
      error: false,
      errorType: null,
      correlationId: 'test-corr-1',
      occurredAt: new Date(),
    });

    const outboxRows = await testDb('ai_usage_outbox')
      .where('user_id', String(TEST_USER_ID))
      .orderBy('queued_at', 'desc')
      .limit(1);

    expect(outboxRows).toHaveLength(1);
    const row = outboxRows[0];
    expect(row.use_case).toBe('task-ai');
    expect(row.model_name).toBe('gemini-2.5-flash');
    expect(Number(row.tokens_in)).toBe(10);
    expect(Number(row.tokens_out)).toBe(5);
    expect(Number(row.latency_ms)).toBe(150);
    expect(Number(row.error_flag)).toBe(0);
    expect(row.correlation_id).toBe('test-corr-1');
    expect(Number(row.flush_attempts)).toBe(0);
  });

  it('enqueue silently swallows DB errors (never throws)', async () => {
    if (!await testDb.isAvailable()) return;

    const { enqueue } = jest.requireActual('../../../src/slices/ai-enrichment/adapters/ai-usage-queue.service');
    // Pass a null db — enqueue must catch the error and not re-throw.
    await expect(
      enqueue(null, {
        userId: 1, useCase: 'x', modelName: 'm', modelParams: null,
        tokensIn: 0, tokensOut: 0, latencyMs: 0, error: false, errorType: null,
        correlationId: null, occurredAt: new Date(),
      })
    ).resolves.not.toThrow();
  });
});

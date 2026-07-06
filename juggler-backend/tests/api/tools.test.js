/**
 * Mock-DB integration tests for /api/tools routes.
 *
 * BUG-999.1221: PUT /api/tools always 400s because route-schemas.js's
 * toolReplaceSchema is `z.array(...)` while every other layer of the contract
 * (facade.js:110 toolsBodySchema, FE useConfig.js:350, and this test file)
 * uses the object-wrapper shape `{ tools: [...] }`. No PUT /api/tools
 * regression test existed anywhere in tests/ before this file (telly, step 0).
 *
 * Pattern: supertest against the real Express app with mocked DB + JWT,
 * mirroring tests/api/locations.test.js exactly (same mock-DB/JWT/plan-features
 * scaffolding — tool.routes.js has NO checkToolLimit / resolvePlanFeatures
 * middleware, just authenticateJWT → validate(toolReplaceSchema) →
 * configController.replaceTools → facade.replaceTools).
 */

process.env.NODE_ENV = 'test';

const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();
jest.mock('../../src/db', () => mockDb);
// H4/W6: config controller is a THIN adapter over the user-config slice facade,
// whose KnexConfigRepository reaches the DB via lib/db.getDefaultDb() (ADR-0002),
// NOT src/db.js. Point lib/db's default at the SAME mockDb so the resolveQueue
// still serves the slice's reads/writes (the H3 dual-mock lesson).
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

// JWT mock
const TEST_USER = { id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York' };
jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer '))
      return res.status(401).json({ error: 'Authentication required' });
    req.user = { ...TEST_USER };
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn()
}));

// Plan features mock — tool.routes.js doesn't mount resolvePlanFeatures, but the
// shared Express app (src/app.js) wires every route module, so this must be
// present (same as locations.test.js) to avoid an unmocked payment-service reach.
let mockPlanFeatures = {
  limits: {
    active_tasks: -1, recurring_templates: -1, projects: -1,
    locations: -1, schedule_templates: -1, ai_commands_per_month: -1
  },
  ai: { natural_language_commands: true },
  calendar: { max_providers: -1, auto_sync: true },
  scheduling: { dependencies: true, travel_time: true },
  tasks: { rigid: true },
  data: { export: true, import: true, mcp_access: true }
};
let mockPlanId = 'enterprise';

jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = mockPlanId;
    req.planFeatures = mockPlanFeatures;
    next();
  },
  PRODUCT_ID: 'juggler',
  refreshPlanFeatures: jest.fn(),
  getCachedPlanFeatures: jest.fn()
}));

// Redis cache mock
jest.mock('../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve()),
  del: jest.fn(() => Promise.resolve())
}));

// Scheduler queue mock
jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

// SSE emitter mock
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn()
}));

const VALID_TOKEN = 'valid-test-token';
let app, request;

beforeAll(async () => {
  app = require('../../src/app');
  request = require('supertest');
});

beforeEach(() => {
  resolveQueue.length = 0;
  jest.clearAllMocks();
  mockPlanFeatures = {
    limits: {
      active_tasks: -1, recurring_templates: -1, projects: -1,
      locations: -1, schedule_templates: -1, ai_commands_per_month: -1
    },
    ai: { natural_language_commands: true },
    calendar: { max_providers: -1, auto_sync: true },
    scheduling: { dependencies: true, travel_time: true },
    tasks: { rigid: true },
    data: { export: true, import: true, mcp_access: true }
  };
  mockPlanId = 'enterprise';
});

// ─── PUT /api/tools ───────────────────────────────────────────────────────────

describe('PUT /api/tools', () => {
  // BUG-999.1221 repro: the facade/FE contract is the object wrapper
  // { tools: [...] } (facade.js:110 toolsBodySchema, useConfig.js:350). At HEAD
  // (route-schemas.js:57-59 toolReplaceSchema = z.array(...)) this wrapper body
  // fails the ROUTE-level schema (which expects a bare array) and 400s before
  // ever reaching the facade — RED at HEAD, must be 200 post-fix.
  test('replaces all tools (wrapper payload, happy path)', async () => {
    const tools = [
      { id: 'tool-a', name: 'Laptop', icon: 'laptop' },
      { id: 'tool-b', name: 'Notebook', icon: 'book' }
    ];

    const res = await request(app)
      .put('/api/tools')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ tools });

    expect(res.status).toBe(200);
    expect(res.body.tools).toHaveLength(2);
    expect(res.body.tools[0].name).toBe('Laptop');
    expect(res.body.tools[1].name).toBe('Notebook');
  });

  // Same RED-at-HEAD mechanism as above, empty-array edge of the wrapper shape.
  test('replaces with empty array (wrapper payload, deletes all tools)', async () => {
    const res = await request(app)
      .put('/api/tools')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ tools: [] });

    expect(res.status).toBe(200);
    expect(res.body.tools).toEqual([]);
  });

  // Garbage/non-wrapper body — a BARE array (the shape the PRE-FIX route schema
  // used to expect). At the OLD HEAD this passed the route-level z.array(...)
  // schema (200-at-that-layer) but was then rejected 400 by the facade's
  // toolsBodySchema ({ tools: [...] } expected, plain array received) — via
  // the facade's "Invalid tools payload" 400. POST-FIX (current), the route
  // schema itself is now the object-wrapper shape, so a bare array is rejected
  // at the ROUTE layer instead, via validate.js's generic "Validation failed"
  // 400. zoe WARN-2 (999-1221 fix-loop): the original status-only assertion
  // could not distinguish these two layers even though the catalog narrative
  // claimed "rejected at the route layer" post-fix — asserting the actual
  // route-layer error body below makes that claim true, not just plausible.
  test('rejects a bare (non-wrapper) array body', async () => {
    const res = await request(app)
      .put('/api/tools')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send([{ id: 'tool-a', name: 'Laptop' }]);

    expect(res.status).toBe(400);
    // Pins the ROUTE-layer (validate.js) rejection specifically — the facade's
    // distinct "Invalid tools payload" message would indicate the reject-layer
    // regressed back to pre-fix behavior.
    expect(res.body.error).toBe('Validation failed');
  });

  // zoe WARN-1 (999-1221 fix-loop): toolReplaceSchema's `.max(500)` upper bound
  // (route-schemas.js) was a changed line with no test exercising the
  // reject-when-over-500 branch — a mutation dropping `.max(500)` survived all
  // prior tests, because facade.js's own toolsBodySchema max(50) cap ALSO
  // rejects 501 items (200-at-route, 400-at-facade), masking the route-level
  // regression under a status-only assertion. Asserting the route-layer
  // message ('Validation failed', from validate.js) instead of the facade's
  // distinct 'Invalid tools payload' proves THIS schema's own bound rejects
  // the request before the facade is ever reached — self-verified: reverting
  // toolReplaceSchema's `.max(500)` (leaving the wrapper shape intact) flips
  // this assertion RED (message becomes 'Invalid tools payload'), confirming
  // it is not tautological with the facade's redundant lower cap.
  test('rejects tools array exceeding 500 items', async () => {
    const tools = Array.from({ length: 501 }, (_, i) => ({ id: `tool-${i}`, name: `Tool ${i}` }));

    const res = await request(app)
      .put('/api/tools')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ tools });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app)
      .put('/api/tools')
      .send({ tools: [] });
    expect(res.status).toBe(401);
  });
});

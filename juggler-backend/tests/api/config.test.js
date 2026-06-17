/**
 * Mock-DB integration tests for /api/config routes.
 *
 * Pattern: supertest against the real Express app with mocked DB + JWT.
 * DB calls are served from a resolveQueue (FIFO). Push values in the exact
 * order the controller/middleware makes DB calls before each request.
 */

process.env.NODE_ENV = 'test';

const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();
jest.mock('../../src/db', () => mockDb);
// H4/W6: config controller is now a THIN adapter over the user-config slice facade,
// whose KnexConfigRepository reaches the DB via lib/db.getDefaultDb() (ADR-0002),
// NOT src/db.js. Point lib/db's default at the SAME mockDb so the resolveQueue still
// serves the slice's reads/writes (the H3 dual-mock lesson).
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

// JWT mock — injects test user for Bearer tokens, 401 for missing/invalid
const TEST_USER = { id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York' };
jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer '))
      return res.status(401).json({ error: 'Authentication required' });
    req.user = { ...TEST_USER };
    req.auth = { plans: {} };
    next();
  },
  verifyToken: jest.fn()
}));

// Plan features mock — unlimited plan by default; override per test for limit cases
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

// Redis cache mock — always miss so getAllConfig always hits DB
jest.mock('../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve()),
  del: jest.fn(() => Promise.resolve())
}));

// Scheduler queue mock — prevents real queue operations
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
  // Drain any leftover queue entries so tests don't bleed into each other
  resolveQueue.length = 0;
  jest.clearAllMocks();
  // Reset to unlimited plan
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

// ─── GET /api/config ──────────────────────────────────────────────────────────

describe('GET /api/config', () => {
  test('returns config for authenticated user', async () => {
    // getAllConfig: Promise.all([locations, tools, projects, configRows])
    // Each is an orderBy().select() — 4 pops in order
    resolveQueue.push([]); // locations rows
    resolveQueue.push([]); // tools rows
    resolveQueue.push([]); // projects rows
    resolveQueue.push([
      { config_key: 'time_blocks', config_value: '[]' },
      { config_key: 'tool_matrix', config_value: '{}' }
    ]); // user_config rows

    const res = await request(app)
      .get('/api/config')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('locations');
    expect(res.body).toHaveProperty('tools');
    expect(res.body).toHaveProperty('projects');
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(401);
  });

  test('returns structured config with parsed timeBlocks and toolMatrix', async () => {
    const timeBlocks = { Mon: [] };
    const toolMatrix = { home: ['phone'] };
    resolveQueue.push([]); // locations
    resolveQueue.push([]); // tools
    resolveQueue.push([{ id: 'p1', name: 'Home', color: '#abc', icon: null, sort_order: 0 }]); // projects
    resolveQueue.push([
      { config_key: 'time_blocks', config_value: JSON.stringify(timeBlocks) },
      { config_key: 'tool_matrix', config_value: JSON.stringify(toolMatrix) },
      { config_key: 'preferences', config_value: JSON.stringify({ splitDefault: true }) }
    ]); // user_config

    const res = await request(app)
      .get('/api/config')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.timeBlocks).toEqual(timeBlocks);
    expect(res.body.toolMatrix).toEqual(toolMatrix);
    expect(res.body.preferences).toEqual({ splitDefault: true });
    expect(Array.isArray(res.body.projects)).toBe(true);
    expect(res.body.projects[0].name).toBe('Home');
  });
});

// ─── PUT /api/config/:key ─────────────────────────────────────────────────────

describe('PUT /api/config/:key', () => {
  test('updates time_blocks config when existing row present', async () => {
    // PUT /api/config/time_blocks goes through checkScheduleTemplateLimit first:
    //   countScheduleTemplates → db('user_config').where({config_key:'time_blocks'}).first() [pop 1]
    // Then updateConfig:
    //   db('user_config').where({...}).first() [pop 2]
    //   db('user_config').where({...}).update() [no queue pop — update returns 1]
    resolveQueue.push({ config_key: 'time_blocks', config_value: '[]' }); // countScheduleTemplates
    resolveQueue.push({ config_key: 'time_blocks', config_value: '[]' }); // updateConfig existing check

    const timeBlocksValue = [{ id: 'tb1', day: 'Mon', start: '09:00', end: '17:00' }];
    const res = await request(app)
      .put('/api/config/time_blocks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ value: timeBlocksValue });

    expect(res.status).toBe(200);
    expect(res.body.key).toBe('time_blocks');
  });

  test('inserts time_blocks config when no existing row', async () => {
    // checkScheduleTemplateLimit → first() = null (no existing blocks)
    // updateConfig → first() = null → insert
    resolveQueue.push(null); // countScheduleTemplates: no existing
    resolveQueue.push(null); // updateConfig: no existing row

    const res = await request(app)
      .put('/api/config/time_blocks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ value: [] });

    expect(res.status).toBe(200);
    expect(res.body.key).toBe('time_blocks');
  });

  test('updates preferences config (no schedule template limit check)', async () => {
    // PUT /api/config/preferences: validate(preferencesSchema) → updateConfig
    // updateConfig: db('user_config').where({...}).first() [pop 1]
    resolveQueue.push({ config_key: 'preferences', config_value: '{}' });

    const res = await request(app)
      .put('/api/config/preferences')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ value: { splitDefault: true, splitMinDefault: 15 } });

    expect(res.status).toBe(200);
    expect(res.body.key).toBe('preferences');
    expect(res.body.value).toEqual({ splitDefault: true, splitMinDefault: 15 });
  });

  test('rejects invalid config key', async () => {
    const res = await request(app)
      .put('/api/config/not_a_real_key')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ value: 'anything' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid config key/);
  });

  test('rejects preferences when body top-level field fails Zod type (splitDefault as string)', async () => {
    // The route calls validate(preferencesSchema) on req.body directly.
    // splitDefault at the TOP level of req.body must be a boolean — sending a string fails.
    // (This is distinct from { value: { splitDefault } } — the schema validates the wrapper.)
    const res = await request(app)
      .put('/api/config/preferences')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ splitDefault: 'not-a-boolean' }); // top-level: fails z.boolean()

    expect(res.status).toBe(400);
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app)
      .put('/api/config/preferences')
      .send({ value: {} });

    expect(res.status).toBe(401);
  });
});

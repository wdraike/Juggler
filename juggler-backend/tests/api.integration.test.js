/**
 * Integration tests for critical API routes
 *
 * Mocks the DB and JWT middleware to test route handling in isolation.
 */

process.env.NODE_ENV = 'test';

// Sequence-based mock: each call to a terminal method pops from a queue
let resolveQueue = [];

function createChainMock() {
  const chain = jest.fn(() => chain);
  ['where', 'whereRaw', 'whereNotNull', 'whereNull', 'whereNot', 'whereNotIn', 'whereIn', 'orWhere', 'orWhereNot', 'orderBy', 'limit', 'offset', 'join', 'leftJoin', 'count', 'max', 'clearSelect', 'clearOrder', 'clone', 'groupBy', 'having'].forEach(m => {
    chain[m] = jest.fn(() => chain);
  });

  function nextResolve(fallback) {
    return resolveQueue.length > 0 ? resolveQueue.shift() : fallback;
  }

  chain.select = jest.fn(() => Promise.resolve(nextResolve([])));
  chain.first = jest.fn(() => Promise.resolve(nextResolve(null)));
  chain.insert = jest.fn(() => Promise.resolve());
  chain.update = jest.fn(() => Promise.resolve(1));
  chain.del = jest.fn(() => Promise.resolve(1));
  chain.then = jest.fn((resolve, reject) => {
    return Promise.resolve(nextResolve([])).then(resolve, reject);
  });
  chain.catch = jest.fn((fn) => Promise.resolve([]).catch(fn));
  chain.fn = { now: () => 'MOCK_NOW' };
  chain.raw = (s) => s;
  chain.transaction = jest.fn(async (cb) => cb(chain));
  return chain;
}

const mockDb = createChainMock();
jest.mock('../src/db', () => mockDb);

// Mock JWT middleware to inject a test user without real JWKS verification
const TEST_USER = { id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York' };

jest.mock('../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const token = auth.split(' ')[1];
    if (token === 'invalid') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = { ...TEST_USER };
    req.auth = { plans: {} };
    next();
  },
  validateRefreshToken: (req, res) => res.status(410).json({ error: 'Use auth-service' }),
  verifyToken: jest.fn()
}));

// Mock plan features middleware
jest.mock('../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = {
      limits: { active_tasks: -1, habit_templates: -1, projects: -1, locations: -1, schedule_templates: -1, ai_commands_per_month: -1 },
      ai: { natural_language_commands: true, bulk_project_creation: true },
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

const VALID_TOKEN = 'valid-test-token';

let app, request;

beforeAll(async () => {
  app = require('../src/app');
  request = require('supertest');
});

beforeEach(() => {
  resolveQueue = [];
});

describe('API routes', () => {
  test('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  test('rejects requests without token', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });

  test('rejects invalid token', async () => {
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', 'Bearer invalid');
    expect(res.status).toBe(401);
  });

  test('GET /api/tasks returns tasks for auth user', async () => {
    // Mock: db('tasks').where(user_id).orderBy().select() returns empty
    resolveQueue.push([]); // tasks rows
    resolveQueue.push({ max_updated: null, cnt: 0 }); // version query (max+count+first)

    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
  });

  test('POST /api/tasks requires authentication', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ id: 't01', text: 'New', date: '3/15' });

    expect(res.status).toBe(401);
  });

  test('POST /api/tasks/batch rejects empty', async () => {
    const res = await request(app)
      .post('/api/tasks/batch')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send([]);

    expect(res.status).toBe(400);
  });

  test('POST /api/tasks/batch rejects >500', async () => {
    const tasks = Array.from({ length: 501 }, (_, i) => ({ id: `t${i}`, text: `T${i}` }));
    const res = await request(app)
      .post('/api/tasks/batch')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send(tasks);

    expect(res.status).toBe(400);
  });

  test('PUT /api/tasks/batch rejects >2000', async () => {
    const updates = Array.from({ length: 2001 }, (_, i) => ({ id: `t${i}`, text: `T${i}` }));
    const res = await request(app)
      .put('/api/tasks/batch')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send(updates);

    expect(res.status).toBe(400);
  });

  test('DELETE /api/tasks/:id returns 404 for missing', async () => {
    resolveQueue.push(null); // task not found

    const res = await request(app)
      .delete('/api/tasks/missing')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(404);
  });

  test('404 for unknown routes', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
  });
});

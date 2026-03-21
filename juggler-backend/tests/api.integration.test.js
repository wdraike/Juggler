/**
 * Integration tests for critical API routes
 */

const { SignJWT } = require('jose');

const TEST_SECRET = 'test-jwt-secret';
const TEST_SECRET_KEY = new TextEncoder().encode(TEST_SECRET);
process.env.JWT_SECRET = TEST_SECRET;
process.env.NODE_ENV = 'test';

// Sequence-based mock: each call to a terminal method pops from a queue
let resolveQueue = [];

function createChainMock() {
  const chain = jest.fn(() => chain);
  ['where', 'whereRaw', 'whereNotNull', 'whereNull', 'orderBy'].forEach(m => {
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

const { loadJWTSecrets } = require('../src/middleware/jwt-auth');
let app, request;

beforeAll(async () => {
  await loadJWTSecrets();
  app = require('../src/app');
  request = require('supertest');
});

const TEST_USER = { id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York' };

async function makeToken() {
  return new SignJWT({ userId: TEST_USER.id, email: TEST_USER.email, type: 'access', jti: 'jti' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .setIssuer('juggler')
    .setSubject(TEST_USER.id)
    .sign(TEST_SECRET_KEY);
}

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
      .set('Authorization', 'Bearer bad-token');
    expect(res.status).toBe(401);
  });

  test('GET /api/tasks returns tasks for auth user', async () => {
    // Queue: 1) auth .first() → user, 2) getAllTasks .orderBy() (thenable) → []
    resolveQueue = [TEST_USER, []];

    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${await makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
  });

  test('POST /api/tasks creates a task', async () => {
    const createdRow = { id: 't01', text: 'New', date: '3/15', dur: 30, status: '', pri: 'P3' };
    // Queue: 1) auth .first() → user, 2) fetch created .first() → row (no project = ensureProject skipped)
    resolveQueue = [TEST_USER, createdRow];

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ id: 't01', text: 'New', date: '3/15' });

    expect(res.status).toBe(201);
    expect(res.body.task.id).toBe('t01');
  });

  test('POST /api/tasks/batch rejects empty', async () => {
    resolveQueue = [TEST_USER];
    const res = await request(app)
      .post('/api/tasks/batch')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ tasks: [] });
    expect(res.status).toBe(400);
  });

  test('POST /api/tasks/batch rejects >500', async () => {
    resolveQueue = [TEST_USER];
    const tasks = Array.from({ length: 501 }, (_, i) => ({ id: `t${i}`, text: `T${i}` }));
    const res = await request(app)
      .post('/api/tasks/batch')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ tasks });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('500');
  });

  test('PUT /api/tasks/batch rejects >500', async () => {
    resolveQueue = [TEST_USER];
    const updates = Array.from({ length: 501 }, (_, i) => ({ id: `t${i}`, status: 'done' }));
    const res = await request(app)
      .put('/api/tasks/batch')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ updates });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('500');
  });

  test('DELETE /api/tasks/:id returns 404 for missing', async () => {
    resolveQueue = [TEST_USER, null]; // auth → user, task lookup → null
    const res = await request(app)
      .delete('/api/tasks/missing')
      .set('Authorization', `Bearer ${await makeToken()}`);
    expect(res.status).toBe(404);
  });

  test('404 for unknown routes', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
  });
});

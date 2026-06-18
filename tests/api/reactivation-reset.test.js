/**
 * juggler-cal-history Plan C — reactivation reset extension.
 *
 * Asserts: when a task transitions from ANY terminal status (done/skip/cancel/pause/missed)
 * back to '' (reopen), the cal_sync_ledger 'done_frozen' rows for that task become 'active'.
 * Previously this only fired on done → '' transitions; Plan C generalizes via isTerminalStatus.
 */

process.env.NODE_ENV = 'test';

let resolveQueue = [];
let updateCalls = [];

function createChainMock() {
  const chain = jest.fn(() => chain);
  ['where', 'whereRaw', 'whereNotNull', 'whereNull', 'whereNot', 'whereNotIn',
   'whereIn', 'orWhere', 'orWhereNot', 'orderBy', 'orderByRaw', 'limit', 'offset',
   'join', 'leftJoin', 'count', 'max', 'clearSelect', 'clearOrder', 'clone',
   'groupBy', 'having'].forEach(m => { chain[m] = jest.fn(() => chain); });

  chain.select = jest.fn(() => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : []));
  chain.first = jest.fn(() => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : null));
  chain.insert = jest.fn(() => Promise.resolve());
  chain.update = jest.fn((fields) => {
    updateCalls.push(fields);
    return Promise.resolve(1);
  });
  chain.del = jest.fn(() => Promise.resolve(1));
  chain.then = jest.fn((resolve, reject) => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : []).then(resolve, reject));
  chain.catch = jest.fn((fn) => Promise.resolve([]).catch(fn));
  chain.fn = { now: () => 'MOCK_NOW' };
  chain.raw = (s) => s;
  chain.transaction = jest.fn(async (cb) => cb(chain));
  return chain;
}

const mockDb = createChainMock();
jest.mock('../../src/db', () => mockDb);

// ADR-0002 / H3-W6: the task slice's KnexTaskRepository obtains knex via lib/db
// (getDefaultDb()), NOT src/db.js. Point lib/db's default at the SAME mockDb so the
// thin controller → facade → repo path resolves the same chain mock + resolveQueue
// the legacy controller's src/db usage did. (Mirrors the W1 golden-master scaffold.)
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

const TEST_USER = { id: 'user-456', email: 'test@test.com', name: 'T', timezone: 'America/New_York' };
jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    req.user = { ...TEST_USER };
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn()
}));

jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = { limits: { active_tasks: -1 }, calendar: {}, scheduling: {}, tasks: {} };
    next();
  },
  PRODUCT_ID: 'juggler',
  refreshPlanFeatures: jest.fn(),
  invalidateUserPlanCache: jest.fn(),
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

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

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
  resolveQueue = [];
  updateCalls = [];
  jest.clearAllMocks();
});

describe('Reactivation reset — juggler-cal-history Plan C', () => {
  test('done → reopen clears done_frozen ledger entries', async () => {
    resolveQueue.push({ id: 'r-1', user_id: TEST_USER.id, task_type: 'task', status: 'done', scheduled_at: '2026-05-01T12:00:00Z' });
    await request(app)
      .put('/api/tasks/r-1/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: '' });
    const reset = updateCalls.find(u => u && u.status === 'active');
    expect(reset).toBeTruthy();
  });

  test('skip → reopen clears done_frozen ledger entries (NEW)', async () => {
    resolveQueue.push({ id: 'r-2', user_id: TEST_USER.id, task_type: 'task', status: 'skip', scheduled_at: '2026-05-01T12:00:00Z' });
    await request(app)
      .put('/api/tasks/r-2/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: '' });
    const reset = updateCalls.find(u => u && u.status === 'active');
    expect(reset).toBeTruthy();
  });

  test('cancel → reopen clears done_frozen ledger entries (NEW)', async () => {
    resolveQueue.push({ id: 'r-3', user_id: TEST_USER.id, task_type: 'task', status: 'cancel', scheduled_at: '2026-05-01T12:00:00Z' });
    await request(app)
      .put('/api/tasks/r-3/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: '' });
    const reset = updateCalls.find(u => u && u.status === 'active');
    expect(reset).toBeTruthy();
  });

  test('missed → reopen clears done_frozen ledger entries (NEW)', async () => {
    // missed is system-applied; reopen via direct DB test in real environment.
    // Here we simulate the controller path: existing.status='missed' → status=''.
    resolveQueue.push({ id: 'r-4', user_id: TEST_USER.id, task_type: 'task', status: 'missed', scheduled_at: '2026-05-01T12:00:00Z' });
    await request(app)
      .put('/api/tasks/r-4/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: '' });
    const reset = updateCalls.find(u => u && u.status === 'active');
    expect(reset).toBeTruthy();
  });
});

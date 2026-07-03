/**
 * juggler-cal-history Plan C — scheduled_at-required guard for terminal transitions.
 *
 * Asserts:
 *   - PUT /api/tasks/:id/status with status='done'/'skip'/'cancel' on an unscheduled
 *     task SUCCEEDS (200) with scheduled_at snapped to ~now (revised leg sched-audit
 *     2026-07-02: reject-400 superseded by D-B resolve-in-place ruling (snap-then-write))
 *   - 'wip' (non-terminal) on unscheduled task is allowed (no guard)
 *   - User-supplied 'missed' rejected with 400 (invalid status — 'missed' is no longer a valid status)
 *   - Recurring template + 'pause' is allowed regardless of scheduled_at
 *   - completed_at is written when status flips to a terminal value
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
  chain.update = jest.fn((fields) => { updateCalls.push(fields); return Promise.resolve(1); });
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

const TEST_USER = { id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York' };
jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Auth required' });
    req.user = { ...TEST_USER };
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn()
}));

jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = { limits: { active_tasks: -1 }, calendar: { max_providers: -1 }, scheduling: {}, tasks: {} };
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

function seedExisting(task) {
  // Controller calls fetchTaskWithEventIds → first(); then the recurring-template
  // branch, then update flow. Stack the queue accordingly.
  resolveQueue.push(task); // first() → existing
  resolveQueue.push(task); // optional second fetchTaskWithEventIds for buildSourceMap path
  // additional select() for srcMap returns []
}

// revised leg sched-audit 2026-07-02: the D-B snap-then-write contract means the
// unscheduled-terminal-status write no longer short-circuits at the guard — it
// runs the FULL success path, which calls fetchTaskWithEventIds TWICE (initial
// `existing` read, then the post-write `updated` re-read at UpdateTaskStatus.js:268).
// Each fetchTaskWithEventIds call itself pops TWO queue entries (tasks_v .first()
// + cal_sync_ledger .select()) — so a full round-trip needs 4 queued entries, not 2.
function seedExistingFullRoundtrip(task) {
  resolveQueue.push(task); // 1st fetchTaskWithEventIds → tasks_v.first() → existing
  resolveQueue.push(task); // 1st fetchTaskWithEventIds → cal_sync_ledger.select()
  resolveQueue.push(task); // 2nd fetchTaskWithEventIds (post-write re-read) → tasks_v.first()
  resolveQueue.push(task); // 2nd fetchTaskWithEventIds (post-write re-read) → cal_sync_ledger.select()
}

describe('PUT /api/tasks/:id/status — juggler-cal-history Plan C scheduled_at guard', () => {
  // revised leg sched-audit 2026-07-02: reject-400 superseded by D-B resolve-in-place
  // ruling (snap-then-write) — an unscheduled one-off/non-rolling terminal write now
  // SUCCEEDS with scheduled_at snapped to ~now, instead of being rejected with 400.
  // See bert REFER db-guard-4 (DB-GUARD-bert-REVIEW.json) + UpdateTaskStatus.js:154-171.
  test('snaps scheduled_at + succeeds (200) for done when scheduled_at is null (was: rejects with 400)', async () => {
    seedExistingFullRoundtrip({ id: 'task-1', user_id: TEST_USER.id, task_type: 'task', status: '', scheduled_at: null });
    const before = Date.now();
    const res = await request(app)
      .put('/api/tasks/task-1/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'done' });
    const after = Date.now();
    expect(res.status).toBe(200);
    const snapWrite = updateCalls.find(u => u && u.scheduled_at !== undefined);
    expect(snapWrite).toBeTruthy();
    expect(snapWrite.scheduled_at.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(snapWrite.scheduled_at.getTime()).toBeLessThanOrEqual(after + 5000);
  });

  test('snaps scheduled_at + succeeds (200) for skip when scheduled_at is null (was: rejects with 400)', async () => {
    seedExistingFullRoundtrip({ id: 'task-2', user_id: TEST_USER.id, task_type: 'task', status: '', scheduled_at: null });
    const before = Date.now();
    const res = await request(app)
      .put('/api/tasks/task-2/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'skip' });
    const after = Date.now();
    expect(res.status).toBe(200);
    const snapWrite = updateCalls.find(u => u && u.scheduled_at !== undefined);
    expect(snapWrite).toBeTruthy();
    expect(snapWrite.scheduled_at.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(snapWrite.scheduled_at.getTime()).toBeLessThanOrEqual(after + 5000);
  });

  test('snaps scheduled_at + succeeds (200) for cancel when scheduled_at is null (was: rejects with 400)', async () => {
    seedExistingFullRoundtrip({ id: 'task-3', user_id: TEST_USER.id, task_type: 'task', status: '', scheduled_at: null });
    const before = Date.now();
    const res = await request(app)
      .put('/api/tasks/task-3/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'cancel' });
    const after = Date.now();
    expect(res.status).toBe(200);
    const snapWrite = updateCalls.find(u => u && u.scheduled_at !== undefined);
    expect(snapWrite).toBeTruthy();
    expect(snapWrite.scheduled_at.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(snapWrite.scheduled_at.getTime()).toBeLessThanOrEqual(after + 5000);
  });

  test('allows wip on unscheduled task (non-terminal not gated)', async () => {
    seedExisting({ id: 'task-4', user_id: TEST_USER.id, task_type: 'task', status: '', scheduled_at: null });
    const res = await request(app)
      .put('/api/tasks/task-4/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'wip' });
    expect(res.status).not.toBe(400);
  });

  test('rejects user-supplied missed with 400', async () => {
    seedExisting({ id: 'task-5', user_id: TEST_USER.id, task_type: 'task', status: '', scheduled_at: '2026-05-08T12:00:00Z' });
    const res = await request(app)
      .put('/api/tasks/task-5/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'missed' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid status/);
  });

  test('allows recurring_template pause regardless of scheduled_at', async () => {
    seedExisting({ id: 'tpl-1', user_id: TEST_USER.id, task_type: 'recurring_template', status: '', scheduled_at: null });
    const res = await request(app)
      .put('/api/tasks/tpl-1/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'pause' });
    expect(res.status).not.toBe(400);
  });

  test('writes completed_at when transitioning to terminal status', async () => {
    seedExisting({ id: 'task-6', user_id: TEST_USER.id, task_type: 'task', status: '', scheduled_at: '2026-05-08T12:00:00Z' });
    await request(app)
      .put('/api/tasks/task-6/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'done' });

    const completedAtWrite = updateCalls.find(u => u && u.completed_at !== undefined);
    expect(completedAtWrite).toBeTruthy();
  });
});

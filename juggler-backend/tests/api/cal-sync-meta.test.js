/**
 * Mock-DB integration tests for /api/cal metadata routes.
 *
 * Covers: GET /has-changes, GET /sync-history, GET /audit
 * Skips POST /sync (covered by 99-sync-e2e.test.js).
 *
 * Key: hasChanges calls getConnectedAdapters(req.user). Since our TEST_USER has
 * no gcal_refresh_token / msft tokens / apple credentials, getConnectedAdapters
 * returns [] — so hasChanges immediately returns { hasChanges: false, providers: {} }.
 * That makes the happy-path test simple: no adapters = no external calls.
 */

process.env.NODE_ENV = 'test';

const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();
jest.mock('../../src/db', () => mockDb);

// JWT mock — injects test user for Bearer tokens
const TEST_USER = {
  id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York',
  gcal_refresh_token: null, msft_cal_refresh_token: null,
  gcal_last_synced_at: null, msft_cal_last_synced_at: null, apple_cal_last_synced_at: null,
  apple_cal_username: null, apple_cal_password: null, apple_cal_calendar_url: null
};
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

// Plan features mock
jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = {
      limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1, schedule_templates: -1, ai_commands_per_month: -1 },
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

// Redis mock
jest.mock('../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve()),
  del: jest.fn(() => Promise.resolve())
}));

// SSE emitter mock
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn()
}));

// scheduleQueue mock
jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

// sync-lock mock
jest.mock('../../src/lib/sync-lock', () => ({
  withSyncLock: (fn) => fn,
  acquireLock: jest.fn(() => Promise.resolve(true)),
  releaseLock: jest.fn(() => Promise.resolve()),
  refreshLock: jest.fn(() => Promise.resolve())
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
});

// ─── GET /api/cal/has-changes ─────────────────────────────────────────────────

describe('GET /api/cal/has-changes', () => {
  test('returns { hasChanges: false } when no providers connected', async () => {
    // No adapters connected (TEST_USER has no tokens) so controller returns immediately
    const res = await request(app)
      .get('/api/cal/has-changes')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('hasChanges');
    expect(res.body.hasChanges).toBe(false);
    expect(res.body.providers).toEqual({});
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/cal/has-changes');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/cal/sync-history ────────────────────────────────────────────────
//
// getSyncHistory uses db('sync_history').where().select('col').max('col as alias')
// .groupBy().orderBy().limit() — this chains .max() after .select(), which the
// standard mockChainDb cannot handle (select() is terminal).
//
// Fix: temporarily override mockDb.select to return the chain (chainable mode) so
// the aggregate query builder works, then restore it after each test. The terminal
// resolution falls through to chain.then which pops from resolveQueue.

describe('GET /api/cal/sync-history', () => {
  let originalSelect;

  beforeEach(() => {
    // Save the terminal select and swap in a chainable version so queries that
    // chain .max()/.groupBy()... after .select('col') work correctly via .then
    originalSelect = mockDb.select;
    mockDb.select = jest.fn(() => mockDb);
  });

  afterEach(() => {
    mockDb.select = originalSelect;
  });

  test('returns { runs: [] } when no sync history exists', async () => {
    // The chained query resolves via chain.then — pop from resolveQueue
    resolveQueue.push([]);

    const res = await request(app)
      .get('/api/cal/sync-history')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('runs');
    expect(Array.isArray(res.body.runs)).toBe(true);
    expect(res.body.runs).toHaveLength(0);
  });

  test('returns grouped runs when sync history exists', async () => {
    const syncRunId = 'run-abc-123';
    // First pop: recentRuns query (groupBy/max)
    resolveQueue.push([{ sync_run_id: syncRunId, run_time: new Date().toISOString() }]);
    // Second pop: all rows for those run IDs (whereIn query)
    resolveQueue.push([{
      id: 1,
      sync_run_id: syncRunId,
      user_id: 'user-123',
      provider: 'gcal',
      action: 'push',
      task_id: 't1',
      task_text: 'My task',
      event_id: 'event-1',
      old_values: null,
      new_values: null,
      error_detail: null,
      calendar_name: 'My Calendar',
      trigger_type: 'manual',
      created_at: new Date().toISOString()
    }]);

    const res = await request(app)
      .get('/api/cal/sync-history')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].sync_run_id).toBe(syncRunId);
    expect(res.body.runs[0].providers).toContain('gcal');
    expect(res.body.runs[0].items).toHaveLength(1);
  });

  test('respects ?runs query param', async () => {
    resolveQueue.push([]);

    const res = await request(app)
      .get('/api/cal/sync-history?runs=5')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('runs');
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/cal/sync-history');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/cal/audit ───────────────────────────────────────────────────────

describe('GET /api/cal/audit', () => {
  test('returns audit summary with no providers connected', async () => {
    // audit loads user row first
    resolveQueue.push({ id: 'user-123', timezone: 'America/New_York' });

    const res = await request(app)
      .get('/api/cal/audit')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    // No adapters connected — audit should still return 200
    expect(res.status).toBe(200);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/cal/audit');
    expect(res.status).toBe(401);
  });
});

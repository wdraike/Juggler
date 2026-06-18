/**
 * Mock-DB integration tests for /api/schedule/* routes.
 *
 * Pattern: supertest against the real Express app with mocked DB + JWT.
 * Additional mocks: scheduleQueue, schedulerSession, runSchedule, syncLock.
 *
 * Admin gate: authenticateAdmin reads ADMIN_EMAILS env var and checks req.user.email.
 * We set process.env.ADMIN_EMAILS = 'admin@test.com' and send x-test-admin header to
 * trigger the admin code path via the JWT mock.
 */

process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@test.com';

const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();
jest.mock('../../src/db', () => mockDb);

// JWT mock — regular user by default; sets email to admin email when x-test-admin header present
const TEST_USER = { id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York' };
const ADMIN_USER = { id: 'admin-456', email: 'admin@test.com', name: 'Admin', timezone: 'America/New_York' };
jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer '))
      return res.status(401).json({ error: 'Authentication required' });
    if (req.headers['x-test-admin'] === 'true') {
      req.user = { ...ADMIN_USER };
    } else {
      req.user = { ...TEST_USER };
    }
    req.auth = { plans: {}, apps: ['juggler'] };
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

// scheduleQueue mock — prevents real queue/worker work
jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(() => Promise.resolve({ queued: true })),
  stopPollLoop: jest.fn()
}));

// runSchedule mock — prevents actual DB-heavy scheduler execution
jest.mock('../../src/scheduler/runSchedule', () => ({
  runScheduleAndPersist: jest.fn(() => Promise.resolve({
    dayPlacements: {},
    unplaced: [],
    score: { total: 100 },
    warnings: []
  })),
  getSchedulePlacements: jest.fn(() => Promise.resolve({
    dayPlacements: {},
    unplaced: [],
    score: { total: 100 },
    warnings: []
  }))
}));

// schedulerSession mock — prevents heavy session setup
jest.mock('../../src/scheduler/schedulerSession', () => ({
  startSession: jest.fn(() => Promise.resolve({
    sessionId: 'mock-session-id',
    totalSteps: 3,
    todayKey: '2026-05-15',
    nowMins: 600,
    timezone: 'America/New_York',
    summary: { taskCount: 5, placedCount: 4, unplacedCount: 1, score: {} }
  })),
  getSession: jest.fn(() => Promise.resolve({
    sessionId: 'mock-session-id',
    userId: 'admin-456',
    todayKey: '2026-05-15',
    nowMins: 600,
    timezone: 'America/New_York',
    snapshots: [
      { stepIndex: 0, phase: 'V2: Immovable', taskId: 't1', taskText: 'Task 1', orderingSlack: 0, placement: { dateKey: '2026-05-15', start: 540, dur: 30 } }
    ],
    tasksById: { t1: { id: 't1', text: 'Task 1', project: null, pri: 'P2', dur: 30, when: null, deadline: null, earliestStart: null, recurring: false, split: false, splitMin: null, location: [], tools: [] } },
    unplaced: [],
    score: {},
    warnings: [],
    slackByTaskId: {}
  })),
  stopSession: jest.fn(() => Promise.resolve(true)),
  _computeStep: jest.fn((s, idx) => ({
    stepIndex: idx,
    phase: 'V2: Immovable',
    taskId: 't1',
    taskText: 'Task 1',
    totalSteps: 1,
    task: null,
    upcoming: []
  })),
  _computeSummary: jest.fn((s) => ({
    sessionId: s.sessionId,
    totalSteps: 1,
    todayKey: s.todayKey,
    nowMins: s.nowMins,
    timezone: s.timezone,
    unplaced: [],
    score: {},
    warnings: [],
    queue: []
  }))
}));

// sync-lock mock — passes through to handler immediately
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

// ─── POST /api/schedule/run ───────────────────────────────────────────────────

describe('POST /api/schedule/run', () => {
  test('valid user — calls runScheduleAndPersist, returns 200 with result', async () => {
    const res = await request(app)
      .post('/api/schedule/run')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dayPlacements');
  });

  // Z1 FORWARDING CONTRACT — guards facade arg forwarding.
  // The route calls: runScheduleAndPersist(req.user.id, undefined, { timezone })
  // A facade that drops args, mutates them, or short-circuits never reaches this
  // fn — so WITHOUT this assertion a broken facade stays green (zoe W4 Z1).
  test('Z1: forwards correct args — userId, undefined ids, timezone opts — to runScheduleAndPersist', async () => {
    const { runScheduleAndPersist: mockFn } = require('../../src/scheduler/runSchedule');

    await request(app)
      .post('/api/schedule/run')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledWith(
      'user-123',          // req.user.id (TEST_USER)
      undefined,           // ids — route passes undefined
      { timezone: 'America/New_York' } // opts — default when no x-timezone header
    );
  });

  test('Z1: forwards custom x-timezone header correctly to runScheduleAndPersist', async () => {
    const { runScheduleAndPersist: mockFn } = require('../../src/scheduler/runSchedule');

    await request(app)
      .post('/api/schedule/run')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('x-timezone', 'Europe/London');

    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledWith(
      'user-123',
      undefined,
      { timezone: 'Europe/London' }
    );
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/schedule/run');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/schedule/placements ────────────────────────────────────────────

describe('GET /api/schedule/placements', () => {
  test('returns placements for authenticated user', async () => {
    const res = await request(app)
      .get('/api/schedule/placements')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dayPlacements');
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/schedule/placements');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/schedule/nudge ─────────────────────────────────────────────────

describe('POST /api/schedule/nudge', () => {
  test('queues a nudge and returns { queued: true }', async () => {
    const { enqueueScheduleRun } = require('../../src/scheduler/scheduleQueue');

    const res = await request(app)
      .post('/api/schedule/nudge')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ queued: true });
    expect(enqueueScheduleRun).toHaveBeenCalledWith('user-123', 'frontend:task-end-nudge');
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/schedule/nudge');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/schedule/debug (admin-gated) ───────────────────────────────────

describe('POST /api/schedule/debug', () => {
  test('non-admin user — returns 403', async () => {
    const res = await request(app)
      .post('/api/schedule/debug')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(403);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/schedule/debug');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/schedule/step/start (admin-gated) ─────────────────────────────

describe('POST /api/schedule/step/start', () => {
  test('admin user — starts session, returns sessionId', async () => {
    const res = await request(app)
      .post('/api/schedule/step/start')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('x-test-admin', 'true');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sessionId');
    expect(res.body.sessionId).toBe('mock-session-id');
  });

  test('non-admin user — returns 403', async () => {
    const res = await request(app)
      .post('/api/schedule/step/start')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(403);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/schedule/step/start');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/schedule/step/:sessionId/:stepIndex (admin-gated) ──────────────

describe('GET /api/schedule/step/:sessionId/:stepIndex', () => {
  test('admin — returns step record for valid index', async () => {
    const res = await request(app)
      .get('/api/schedule/step/mock-session-id/0')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('x-test-admin', 'true');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stepIndex');
  });

  test('admin — returns 400 for non-numeric stepIndex', async () => {
    const res = await request(app)
      .get('/api/schedule/step/mock-session-id/abc')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('x-test-admin', 'true');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/integer/);
  });

  test('admin — returns 404 when getSession returns null', async () => {
    const schedulerSession = require('../../src/scheduler/schedulerSession');
    schedulerSession.getSession.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/schedule/step/no-such-session/0')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('x-test-admin', 'true');

    expect(res.status).toBe(404);
  });

  test('non-admin — returns 403', async () => {
    const res = await request(app)
      .get('/api/schedule/step/mock-session-id/0')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/schedule/step/:sessionId/summary (admin-gated) ─────────────────

describe('GET /api/schedule/step/:sessionId/summary', () => {
  test('admin — returns summary for valid session', async () => {
    const res = await request(app)
      .get('/api/schedule/step/mock-session-id/summary')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('x-test-admin', 'true');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sessionId');
    expect(res.body).toHaveProperty('totalSteps');
  });

  test('admin — returns 404 when session not found', async () => {
    const schedulerSession = require('../../src/scheduler/schedulerSession');
    schedulerSession.getSession.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/schedule/step/no-such/summary')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('x-test-admin', 'true');

    expect(res.status).toBe(404);
  });

  test('non-admin — returns 403', async () => {
    const res = await request(app)
      .get('/api/schedule/step/mock-session-id/summary')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/schedule/step/:sessionId/stop (admin-gated) ───────────────────

describe('POST /api/schedule/step/:sessionId/stop', () => {
  test('admin — stops session, returns { ok: true }', async () => {
    const res = await request(app)
      .post('/api/schedule/step/mock-session-id/stop')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('x-test-admin', 'true');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('admin — session already gone returns { ok: true } (idempotent)', async () => {
    const schedulerSession = require('../../src/scheduler/schedulerSession');
    schedulerSession.getSession.mockResolvedValueOnce(null);
    // DB check for ownership: returns null row (no ownership record)
    resolveQueue.push(null);

    const res = await request(app)
      .post('/api/schedule/step/expired-session/stop')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('x-test-admin', 'true');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('non-admin — returns 403', async () => {
    const res = await request(app)
      .post('/api/schedule/step/mock-session-id/stop')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(403);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/schedule/step/mock-session-id/stop');
    expect(res.status).toBe(401);
  });
});

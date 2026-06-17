/**
 * FULLTEXT search endpoint tests — 999.253
 *
 * Tests for GET /api/tasks/search?q=... which uses MySQL MATCH…AGAINST
 * on the `ft_tasks_search` FULLTEXT index (task_masters.text, task_masters.notes).
 *
 * Pattern: unit tests for the SearchTasks use-case + API integration test
 * against the real Express app with mocked DB (following the established
 * task-data-endpoints.test.js pattern).
 */
process.env.NODE_ENV = 'test';

const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();
mockDb.delete = mockDb.del;

jest.mock('../../src/db', () => mockDb);
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

// ── Middleware mocks ─────────────────────────────────────────────────────────

const TEST_USER = { id: 'user-42', email: 'test@test.com', name: 'Test', timezone: 'America/New_York' };

jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Auth required' });
    req.user = { ...TEST_USER };
    req.auth = { plans: {} };
    next();
  },
  verifyToken: jest.fn(),
}));

jest.mock('../../src/middleware/plan-features.middleware', () => ({
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
  PRODUCT_LABEL: 'juggler',
  getProductId: jest.fn(() => Promise.resolve('juggler')),
  refreshPlanFeatures: jest.fn(),
  invalidateUserPlanCache: jest.fn(),
  getCachedPlanFeatures: jest.fn(),
}));

jest.mock('../../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve()),
  del: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn(),
  getLastError: jest.fn(() => null),
}));

jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn(),
  getStats: jest.fn(() => ({ activeConnections: 0 })),
}));

jest.mock('../../src/lib/task-write-queue', () => ({
  isLocked: jest.fn(() => Promise.resolve(false)),
  enqueueWrite: jest.fn(() => Promise.resolve()),
  splitFields: jest.fn((row) => ({ schedulingFields: row, nonSchedulingFields: {} })),
  flushQueue: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../src/lib/tasks-write', () => ({
  insertTask: jest.fn(() => Promise.resolve()),
  deleteTaskById: jest.fn(() => Promise.resolve(1)),
  deleteTasksWhere: jest.fn(() => Promise.resolve()),
  updateTaskById: jest.fn(() => Promise.resolve(1)),
  updateTasksWhere: jest.fn(() => Promise.resolve()),
  updateInstancesWhere: jest.fn(() => Promise.resolve()),
  insertTasksBatch: jest.fn(() => Promise.resolve()),
  archiveInstances: jest.fn(() => Promise.resolve()),
  getOrCreateArchivedMasterId: jest.fn(() => Promise.resolve('archive-master-id')),
  resetRecurringInstances: jest.fn(() => Promise.resolve()),
  archiveCompletedInstances: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../src/middleware/entity-limits', () => ({
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

jest.mock('../../src/middleware/validate', () => ({
  validate: () => (req, res, next) => next(),
}));

jest.mock('../../src/lib/rate-limit-store', () => ({
  maybeRedisStore: () => ({
    init: jest.fn(),
    increment: jest.fn(() => Promise.resolve({ totalHits: 1, resetTime: new Date(Date.now() + 60000) })),
    decrement: jest.fn(() => Promise.resolve()),
    resetKey: jest.fn(() => Promise.resolve()),
    resetAll: jest.fn(() => Promise.resolve()),
  }),
}));

jest.mock('../../src/services/gemini-tracked-call', () => ({
  trackedGeminiCall: jest.fn(),
}));

jest.mock('../../src/services/ai-usage-queue.service', () => ({
  enqueue: jest.fn(),
}));

jest.mock('../../src/lib/logger', () => {
  const noop = jest.fn();
  const fakeLogger = { error: noop, warn: noop, info: noop, debug: noop, trace: noop };
  return {
    createLogger: jest.fn(() => fakeLogger),
    Logger: class {},
    clearLoggerCache: jest.fn(),
    LOG_LEVELS: ['error', 'warn', 'info', 'debug', 'trace'],
    DEFAULT_LOG_LEVEL: 'debug',
    loggers: {},
  };
});

// ── Facade mock ──────────────────────────────────────────────────────────────

const mockSearchTasks = jest.fn();

jest.mock('../../src/slices/task/facade', () => ({
  getAllTasks: jest.fn(() => Promise.resolve({ status: 200, body: { tasks: [] } })),
  getTask: jest.fn(() => Promise.resolve({ status: 200, body: {} })),
  getVersion: jest.fn(() => Promise.resolve({ status: 200, body: { version: '0:0' } })),
  getDisabledTasks: jest.fn(() => Promise.resolve({ status: 200, body: { tasks: [] } })),
  searchTasks: (...args) => mockSearchTasks(...args),
  createTask: jest.fn(() => Promise.resolve({ status: 201, body: {} })),
  updateTask: jest.fn(() => Promise.resolve({ status: 200, body: {} })),
  deleteTask: jest.fn(() => Promise.resolve({ status: 200, body: {} })),
  updateTaskStatus: jest.fn(() => Promise.resolve({ status: 200, body: {} })),
  batchCreateTasks: jest.fn(() => Promise.resolve({ status: 201, body: {} })),
  batchUpdateTasks: jest.fn(() => Promise.resolve({ status: 200, body: {} })),
  reEnableTask: jest.fn(() => Promise.resolve({ status: 200, body: {} })),
  takeOwnership: jest.fn(() => Promise.resolve({ status: 200, body: {} })),
  rowToTask: jest.fn((r) => r),
  taskToRow: jest.fn((t) => t),
  checkCalSyncEditGuard: jest.fn(),
  guardFixedCalendarWhen: jest.fn(),
  buildSourceMap: jest.fn(() => ({})),
  fetchTasksWithEventIds: jest.fn(() => Promise.resolve([])),
  ensureProject: jest.fn(() => Promise.resolve()),
  applySplitDefault: jest.fn((t) => t),
  TEMPLATE_FIELDS: [],
  validateTaskInput: jest.fn(() => ({ valid: true })),
  expandToAllInstanceIds: jest.fn(() => []),
  safeParseJSON: jest.fn((s) => { try { return JSON.parse(s); } catch { return s; } }),
}));

let app, supertest;

beforeAll(() => {
  app = require('../../src/app');
  supertest = require('supertest');
});

// ── SearchTasks use-case unit tests ─────────────────────────────────────────

describe('SearchTasks use-case', () => {
  const SearchTasks = require('../../src/slices/task/application/queries/SearchTasks');
  const mappers = require('../../src/slices/task/domain/mappers/taskMappers');

  it('returns empty array for empty/whitespace query', async () => {
    const repo = { searchTasks: jest.fn(() => Promise.resolve([])) };
    const uc = new SearchTasks({ repo, mappers });
    const result = await uc.execute({ userId: 'u1', q: '   ' });
    expect(result.tasks).toEqual([]);
    expect(repo.searchTasks).not.toHaveBeenCalled();
  });

  it('returns empty array for missing query', async () => {
    const repo = { searchTasks: jest.fn(() => Promise.resolve([])) };
    const uc = new SearchTasks({ repo, mappers });
    const result = await uc.execute({ userId: 'u1' });
    expect(result.tasks).toEqual([]);
    expect(repo.searchTasks).not.toHaveBeenCalled();
  });

  it('calls repo.searchTasks with trimmed query and maps results', async () => {
    const mockRows = [
      { id: 't1', user_id: 'u1', text: 'Buy groceries', notes: 'From supermarket', task_type: 'task' },
      { id: 't2', user_id: 'u1', text: 'Buy flowers', notes: 'For the garden', task_type: 'task' },
    ];
    const repo = { searchTasks: jest.fn(() => Promise.resolve(mockRows)) };
    const uc = new SearchTasks({ repo, mappers });
    const result = await uc.execute({ userId: 'u1', q: '  buy  ' });
    expect(repo.searchTasks).toHaveBeenCalledWith('u1', 'buy');
    expect(result.tasks).toBeDefined();
    expect(result.tasks.length).toBe(2);
  });

  it('truncates queries over 200 characters', async () => {
    const repo = { searchTasks: jest.fn(() => Promise.resolve([])) };
    const uc = new SearchTasks({ repo, mappers });
    const longQuery = 'a'.repeat(250);
    await uc.execute({ userId: 'u1', q: longQuery });
    expect(repo.searchTasks).toHaveBeenCalledWith('u1', 'a'.repeat(200));
  });

  it('throws if deps are missing', () => {
    expect(() => new SearchTasks()).toThrow('SearchTasks: { repo, mappers } are required');
    expect(() => new SearchTasks({ repo: {} })).toThrow('SearchTasks: { repo, mappers } are required');
  });
});

// ── API integration tests ───────────────────────────────────────────────────

describe('GET /api/tasks/search', () => {
  beforeEach(() => {
    mockSearchTasks.mockReset();
  });

  it('returns 400 when q parameter is missing', async () => {
    const res = await supertest(app)
      .get('/api/tasks/search')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 400 when q parameter is empty/whitespace', async () => {
    const res = await supertest(app)
      .get('/api/tasks/search?q=')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 401 without authentication', async () => {
    const res = await supertest(app)
      .get('/api/tasks/search?q=groceries');

    expect(res.status).toBe(401);
  });

  it('calls facade.searchTasks and returns results', async () => {
    const searchResults = {
      tasks: [
        { id: 't1', text: 'Buy groceries', notes: 'From supermarket' },
        { id: 't2', text: 'Buy flowers', notes: 'For the garden' },
      ],
    };
    mockSearchTasks.mockResolvedValue({ status: 200, body: searchResults });

    const res = await supertest(app)
      .get('/api/tasks/search?q=groceries')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(res.body.tasks).toBeDefined();
    expect(res.body.tasks.length).toBe(2);
    expect(mockSearchTasks).toHaveBeenCalledWith({ userId: 'user-42', q: 'groceries' });
  });

  it('trims whitespace from the q parameter', async () => {
    mockSearchTasks.mockResolvedValue({ status: 200, body: { tasks: [] } });

    await supertest(app)
      .get('/api/tasks/search?q=%20%20hello%20%20')
      .set('Authorization', 'Bearer test-token');

    expect(mockSearchTasks).toHaveBeenCalledWith({ userId: 'user-42', q: 'hello' });
  });

  it('truncates queries over 200 characters', async () => {
    mockSearchTasks.mockResolvedValue({ status: 200, body: { tasks: [] } });

    const longQuery = 'x'.repeat(250);
    await supertest(app)
      .get('/api/tasks/search?q=' + longQuery)
      .set('Authorization', 'Bearer test-token');

    const calledWith = mockSearchTasks.mock.calls[0][0];
    expect(calledWith.q.length).toBeLessThanOrEqual(200);
  });

  it('returns 500 on facade error', async () => {
    mockSearchTasks.mockRejectedValue(new Error('DB FULLTEXT not available'));

    const res = await supertest(app)
      .get('/api/tasks/search?q=test')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed/i);
  });
});

// ── SearchTasks use-case unit test with real mappers ─────────────────────────

describe('SearchTasks with real mappers', () => {
  const SearchTasks = require('../../src/slices/task/application/queries/SearchTasks');
  const mappers = require('../../src/slices/task/domain/mappers/taskMappers');

  it('maps search results through rowToTask', async () => {
    // Simulate a minimal task_masters row shape returned by searchTasks
    const mockRow = {
      id: 'task-001',
      user_id: 'u1',
      text: 'Buy groceries',
      notes: 'From supermarket',
      dur: 30,
      pri: 'P2',
      project: null,
      section: null,
      url: null,
      location: null,
      tools: null,
      when: null,
      day_req: null,
      recurring: 0,
      time_flex: null,
      flex_when: 0,
      split: null,
      split_min: null,
      recur: null,
      recur_start: null,
      recur_end: null,
      marker: 0,
      preferred_time_mins: null,
      placement_mode: null,
      travel_before: null,
      travel_after: null,
      depends_on: null,
      desired_at: null,
      disabled_at: null,
      disabled_reason: null,
      deadline: null,
      start_after_at: null,
      tz: null,
      weather_precip: null,
      weather_cloud: null,
      weather_temp_min: null,
      weather_temp_max: null,
      weather_temp_unit: null,
      weather_humidity_min: null,
      weather_humidity_max: null,
      source_id: null,
      scheduled_at: null,
      date: null,
      day: null,
      time: null,
      status: '',
      time_remaining: null,
      unscheduled: null,
      overdue: null,
      slack_mins: null,
      occurrence_ordinal: null,
      split_ordinal: null,
      split_total: null,
      split_group: null,
      generated: 0,
      gcal_event_id: null,
      msft_event_id: null,
      apple_event_id: null,
      cal_sync_origin: null,
      cal_event_url: null,
      apple_calendar_name: null,
      master_id: null,
      completed_at: null,
      created_at: '2026-06-17T00:00:00.000Z',
      updated_at: '2026-06-17T00:00:00.000Z',
    };

    const repo = { searchTasks: jest.fn(() => Promise.resolve([mockRow])) };
    const uc = new SearchTasks({ repo, mappers });
    const result = await uc.execute({ userId: 'u1', q: 'groceries' });

    expect(repo.searchTasks).toHaveBeenCalledWith('u1', 'groceries');
    expect(result.tasks).toBeDefined();
    expect(result.tasks.length).toBe(1);
    // rowToTask should have mapped the row to an API task shape
    expect(result.tasks[0].id).toBe('task-001');
    expect(result.tasks[0].text).toBe('Buy groceries');
  });
});
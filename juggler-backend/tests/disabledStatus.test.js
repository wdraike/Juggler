/**
 * Tests for the "disabled" status feature — downgrade enforcement,
 * re-enable logic, and mutation guards.
 */

process.env.NODE_ENV = 'test';

// ── DB mock with resolve queue ──────────────────────────────────────────
let resolveQueue = [];

function createChainMock() {
  const chain = jest.fn(() => chain);
  ['where', 'whereRaw', 'whereNotNull', 'whereNull', 'whereNot', 'whereNotIn',
   'whereIn', 'orWhere', 'orWhereNot', 'orderBy', 'limit', 'offset', 'join',
   'leftJoin', 'count', 'max', 'clearSelect', 'clearOrder', 'clone', 'groupBy',
   'having'
  ].forEach(m => {
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

// Mock JWT
const TEST_USER = { id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York' };
jest.mock('../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Auth required' });
    req.user = { ...TEST_USER };
    req.auth = { plans: {} };
    next();
  },
  verifyToken: jest.fn()
}));

// Mock plan features — configurable per test
let mockPlanFeatures = {
  limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1, schedule_templates: -1 },
  calendar: { max_providers: -1 },
  scheduling: { dependencies: true, travel_time: true },
  tasks: { rigid: true }
};
let mockPlanId = 'enterprise';

jest.mock('../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = mockPlanId;
    req.planFeatures = mockPlanFeatures;
    next();
  },
  PRODUCT_ID: 'juggler',
  refreshPlanFeatures: jest.fn(),
  invalidateUserPlanCache: jest.fn(),
  getCachedPlanFeatures: jest.fn()
}));

// Mock redis cache
jest.mock('../src/lib/redis', () => ({
  invalidateTasks: jest.fn(() => Promise.resolve()),
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve()),
  del: jest.fn(() => Promise.resolve())
}));

const VALID_TOKEN = 'valid-test-token';
let app, request;

beforeAll(async () => {
  app = require('../src/app');
  request = require('supertest');
});

beforeEach(() => {
  resolveQueue = [];
  jest.clearAllMocks();
  // Reset to unlimited plan
  mockPlanFeatures = {
    limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1, schedule_templates: -1 },
    calendar: { max_providers: -1 },
    scheduling: { dependencies: true, travel_time: true },
    tasks: { rigid: true }
  };
  mockPlanId = 'enterprise';
});


// ═══════════════════════════════════════════════════════════════════════
// Mutation guards — disabled items block updates and status changes
// ═══════════════════════════════════════════════════════════════════════

describe('Mutation guards for disabled items', () => {

  test('PUT /api/tasks/:id rejects update on disabled task', async () => {
    resolveQueue.push({ id: 't01', user_id: 'user-123', status: 'disabled', task_type: 'task' });

    const res = await request(app)
      .put('/api/tasks/t01')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ text: 'Updated text' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TASK_DISABLED');
  });

  test('PUT /api/tasks/:id/status rejects status change on disabled task', async () => {
    // First resolve: task lookup
    resolveQueue.push({ id: 't01', user_id: 'user-123', status: 'disabled', task_type: 'task' });

    const res = await request(app)
      .put('/api/tasks/t01/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'done' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TASK_DISABLED');
  });

  test('PUT /api/tasks/:id/status rejects status change on disabled recurring template', async () => {
    resolveQueue.push({ id: 'ht01', user_id: 'user-123', status: 'disabled', task_type: 'recurring_template' });

    const res = await request(app)
      .put('/api/tasks/ht01/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ status: 'pause' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TASK_DISABLED');
  });

  test('DELETE /api/tasks/:id still works on disabled task', async () => {
    resolveQueue.push({ id: 't01', user_id: 'user-123', status: 'disabled', task_type: 'task' });
    // No affected deps
    resolveQueue.push([]);

    const res = await request(app)
      .delete('/api/tasks/t01')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Task deleted');
  });

  test('DELETE /api/tasks/:id?cascade=recurring works on disabled recurring', async () => {
    // Task lookup
    resolveQueue.push({ id: 'ht01', user_id: 'user-123', status: 'disabled', task_type: 'recurring_template' });
    // Instances query
    resolveQueue.push([
      { id: 'hi01', status: 'disabled', gcal_event_id: null, msft_event_id: null },
      { id: 'hi02', status: 'done', gcal_event_id: null, msft_event_id: null }
    ]);
    // Template lookup for cal sync cleanup
    resolveQueue.push({ id: 'ht01', gcal_event_id: null, msft_event_id: null });

    const res = await request(app)
      .delete('/api/tasks/ht01?cascade=recurring')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Recurring deleted');
  });
});


// ═══════════════════════════════════════════════════════════════════════
// GET /api/tasks/disabled — list disabled items
// ═══════════════════════════════════════════════════════════════════════

describe('GET /api/tasks/disabled', () => {

  test('returns empty array when no disabled items', async () => {
    resolveQueue.push([]); // disabled query returns nothing
    // srcMap query
    resolveQueue.push([]);

    const res = await request(app)
      .get('/api/tasks/disabled')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
  });

  test('returns disabled tasks and recurringTasks', async () => {
    resolveQueue.push([
      { id: 'ht01', user_id: 'user-123', text: 'Morning run', status: 'disabled', task_type: 'recurring_template', disabled_at: '2026-04-01T12:00:00Z', disabled_reason: 'downgrade' },
      { id: 't05', user_id: 'user-123', text: 'Write report', status: 'disabled', task_type: 'task', disabled_at: '2026-04-01T12:00:00Z', disabled_reason: 'downgrade' }
    ]);
    // srcMap query (templates for instance inheritance)
    resolveQueue.push([]);

    const res = await request(app)
      .get('/api/tasks/disabled')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(2);
    expect(res.body.tasks[0].disabledReason).toBe('downgrade');
    expect(res.body.tasks[1].disabledReason).toBe('downgrade');
  });
});


// ═══════════════════════════════════════════════════════════════════════
// PUT /api/tasks/:id/re-enable
// ═══════════════════════════════════════════════════════════════════════

describe('PUT /api/tasks/:id/re-enable', () => {

  test('rejects re-enable on non-disabled task', async () => {
    resolveQueue.push({ id: 't01', user_id: 'user-123', status: '', task_type: 'task' });

    const res = await request(app)
      .put('/api/tasks/t01/re-enable')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not disabled/);
  });

  test('re-enables a disabled task when under limit (unlimited plan)', async () => {
    // Task lookup
    resolveQueue.push({ id: 't05', user_id: 'user-123', status: 'disabled', task_type: 'task', disabled_at: '2026-04-01T12:00:00Z', disabled_reason: 'downgrade' });
    // srcMap for response
    resolveQueue.push([]);
    // Updated row for response
    resolveQueue.push({ id: 't05', user_id: 'user-123', status: '', task_type: 'task', text: 'Write report', disabled_at: null, disabled_reason: null });

    const res = await request(app)
      .put('/api/tasks/t05/re-enable')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.task.status).toBe('');
    expect(res.body.task.disabledAt).toBeNull();
  });

  test('rejects re-enable when at plan limit', async () => {
    // Set plan to free with 5 task limit
    mockPlanFeatures = {
      ...mockPlanFeatures,
      limits: { ...mockPlanFeatures.limits, active_tasks: 5, recurring_templates: 3 }
    };
    mockPlanId = 'free';

    // Task lookup
    resolveQueue.push({ id: 't10', user_id: 'user-123', status: 'disabled', task_type: 'task', disabled_at: '2026-04-01T12:00:00Z' });
    // countActiveTasks result (already at limit)
    resolveQueue.push({ count: 5 });

    const res = await request(app)
      .put('/api/tasks/t10/re-enable')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ENTITY_LIMIT_REACHED');
    expect(res.body.limit).toBe(5);
  });

  test('re-enables a disabled recurring template and its instances', async () => {
    // Task lookup — recurring template
    resolveQueue.push({ id: 'ht01', user_id: 'user-123', status: 'disabled', task_type: 'recurring_template', disabled_at: '2026-04-01T12:00:00Z' });
    // countRecurringTemplates (under limit)
    resolveQueue.push({ count: 2 });
    // Count disabled instances for task limit check
    resolveQueue.push({ count: 3 });
    // countActiveTasks (under limit with room for 3 instances)
    resolveQueue.push({ count: 10 });
    // srcMap for response
    resolveQueue.push([]);
    // Updated row for response
    resolveQueue.push({ id: 'ht01', user_id: 'user-123', status: '', task_type: 'recurring_template', text: 'Morning run', disabled_at: null, disabled_reason: null });

    mockPlanFeatures = {
      ...mockPlanFeatures,
      limits: { ...mockPlanFeatures.limits, active_tasks: 50, recurring_templates: 5 }
    };
    mockPlanId = 'pro';

    const res = await request(app)
      .put('/api/tasks/ht01/re-enable')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.task.status).toBe('');
  });

  test('rejects recurring re-enable when instances would exceed task limit', async () => {
    mockPlanFeatures = {
      ...mockPlanFeatures,
      limits: { ...mockPlanFeatures.limits, active_tasks: 50, recurring_templates: 25 }
    };
    mockPlanId = 'pro';

    // Task lookup — recurring template
    resolveQueue.push({ id: 'ht01', user_id: 'user-123', status: 'disabled', task_type: 'recurring_template', disabled_at: '2026-04-01T12:00:00Z' });
    // countRecurringTemplates (under limit)
    resolveQueue.push({ count: 10 });
    // Count disabled instances — 15 instances
    resolveQueue.push({ count: 15 });
    // countActiveTasks — 40 active + 15 instances = 55 > 50 limit
    resolveQueue.push({ count: 40 });

    const res = await request(app)
      .put('/api/tasks/ht01/re-enable')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ENTITY_LIMIT_REACHED');
    expect(res.body.limit_key).toBe('limits.active_tasks');
    expect(res.body.attempting_to_add).toBe(15);
  });

  test('returns 404 for non-existent task', async () => {
    resolveQueue.push(null);

    const res = await request(app)
      .put('/api/tasks/nonexistent/re-enable')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(404);
  });
});


// ═══════════════════════════════════════════════════════════════════════
// enforceDowngradeLimits — unit tests
// ═══════════════════════════════════════════════════════════════════════

describe('enforceDowngradeLimits', () => {
  let enforceDowngradeLimits;

  beforeAll(() => {
    ({ enforceDowngradeLimits } = require('../src/controllers/billing-webhooks.controller'));
  });

  test('does nothing when under limits', async () => {
    const planFeatures = { limits: { recurring_templates: 5, active_tasks: 50 } };

    // countRecurringTemplates
    resolveQueue.push({ count: 3 });
    // countActiveTasks
    resolveQueue.push({ count: 20 });

    const result = await enforceDowngradeLimits('user-123', planFeatures);
    expect(result.disabledRecurrings).toBe(0);
    expect(result.disabledTasks).toBe(0);
  });

  test('does nothing when limits are unlimited (-1)', async () => {
    const planFeatures = { limits: { recurring_templates: -1, active_tasks: -1 } };

    const result = await enforceDowngradeLimits('user-123', planFeatures);
    expect(result.disabledRecurrings).toBe(0);
    expect(result.disabledTasks).toBe(0);
  });

  test('does nothing when planFeatures is null', async () => {
    const result = await enforceDowngradeLimits('user-123', null);
    expect(result.disabledRecurrings).toBe(0);
    expect(result.disabledTasks).toBe(0);
  });

  test('disables excess recurringTasks (newest first)', async () => {
    const planFeatures = { limits: { recurring_templates: 3, active_tasks: 50 } };

    // Phase 1: count recurring templates = 5 (2 over limit of 3)
    resolveQueue.push({ count: 5 });
    // Newest 2 recurring templates to disable
    resolveQueue.push([
      { id: 'ht05' },
      { id: 'ht04' }
    ]);
    // Disabled instances of those templates (select for cal cleanup)
    resolveQueue.push([
      { id: 'hi10' },
      { id: 'hi11' }
    ]);
    // Phase 2: count active tasks (after disabling recurring instances)
    resolveQueue.push({ count: 30 });

    const result = await enforceDowngradeLimits('user-123', planFeatures);
    expect(result.disabledRecurrings).toBe(2);
    expect(result.disabledTasks).toBe(0);
  });

  test('disables excess tasks after recurringTasks', async () => {
    const planFeatures = { limits: { recurring_templates: 5, active_tasks: 10 } };

    // Phase 1: recurringTasks under limit
    resolveQueue.push({ count: 3 });
    // Phase 2: count active tasks = 15 (5 over limit of 10)
    resolveQueue.push({ count: 15 });
    // Newest 5 tasks to disable
    resolveQueue.push([
      { id: 't20', depends_on: null },
      { id: 't19', depends_on: null },
      { id: 't18', depends_on: null },
      { id: 't17', depends_on: null },
      { id: 't16', depends_on: null }
    ]);
    // Dep re-link queries (one per task — no affected deps)
    resolveQueue.push([]);
    resolveQueue.push([]);
    resolveQueue.push([]);
    resolveQueue.push([]);
    resolveQueue.push([]);

    const result = await enforceDowngradeLimits('user-123', planFeatures);
    expect(result.disabledRecurrings).toBe(0);
    expect(result.disabledTasks).toBe(5);
  });

  test('disables both recurringTasks and tasks when both over limit', async () => {
    const planFeatures = { limits: { recurring_templates: 2, active_tasks: 5 } };

    // Phase 1: count recurringTasks = 4 (2 over)
    resolveQueue.push({ count: 4 });
    // Newest 2 recurring templates
    resolveQueue.push([{ id: 'ht04' }, { id: 'ht03' }]);
    // Disabled instances (select for cal cleanup)
    resolveQueue.push([{ id: 'hi08' }]);
    // Phase 2: count active tasks = 8 (3 over limit of 5, after recurring instance disabled)
    resolveQueue.push({ count: 8 });
    // Newest 3 tasks
    resolveQueue.push([
      { id: 't10', depends_on: null },
      { id: 't09', depends_on: null },
      { id: 't08', depends_on: null }
    ]);
    // Dep re-link queries
    resolveQueue.push([]);
    resolveQueue.push([]);
    resolveQueue.push([]);

    const result = await enforceDowngradeLimits('user-123', planFeatures);
    expect(result.disabledRecurrings).toBe(2);
    expect(result.disabledTasks).toBe(3);
  });

  test('is idempotent — running twice does not disable more', async () => {
    const planFeatures = { limits: { recurring_templates: 5, active_tasks: 50 } };

    // First run: already at limits (all excess already disabled from prior run)
    resolveQueue.push({ count: 5 }); // recurringTasks exactly at limit
    resolveQueue.push({ count: 50 }); // tasks exactly at limit

    const result = await enforceDowngradeLimits('user-123', planFeatures);
    expect(result.disabledRecurrings).toBe(0);
    expect(result.disabledTasks).toBe(0);
  });
});


// ═══════════════════════════════════════════════════════════════════════
// Template inheritance frozen for disabled instances
// ═══════════════════════════════════════════════════════════════════════

describe('rowToTask template inheritance', () => {
  let rowToTask, buildSourceMap;

  beforeAll(() => {
    ({ rowToTask, buildSourceMap } = require('../src/controllers/task.controller'));
  });

  test('active instance inherits template fields', () => {
    const template = { id: 'ht01', task_type: 'recurring_template', text: 'Updated title', dur: 45, pri: 'P1', status: '' };
    const instance = { id: 'hi01', task_type: 'recurring_instance', source_id: 'ht01', text: null, dur: null, pri: null, status: '' };
    const srcMap = { ht01: template };

    const result = rowToTask(instance, null, srcMap);
    expect(result.text).toBe('Updated title');
    expect(result.dur).toBe(45);
    expect(result.pri).toBe('P1');
  });

  test('disabled instance does NOT inherit template fields', () => {
    const template = { id: 'ht01', task_type: 'recurring_template', text: 'Updated title', dur: 45, pri: 'P1', status: '' };
    const instance = { id: 'hi01', task_type: 'recurring_instance', source_id: 'ht01', text: 'Old title', dur: 30, pri: 'P2', status: 'disabled', disabled_at: '2026-04-01T12:00:00Z', disabled_reason: 'downgrade' };
    const srcMap = { ht01: template };

    const result = rowToTask(instance, null, srcMap);
    // Should keep its own values, not inherit from template
    expect(result.text).toBe('Old title');
    expect(result.dur).toBe(30);
    expect(result.pri).toBe('P2');
    expect(result.disabledReason).toBe('downgrade');
  });
});


// ═══════════════════════════════════════════════════════════════════════
// expandRecurring skips disabled templates
// ═══════════════════════════════════════════════════════════════════════

describe('expandRecurring with disabled status', () => {
  let expandRecurring;

  beforeAll(() => {
    ({ expandRecurring } = require('../../shared/scheduler/expandRecurring'));
  });

  test('skips disabled templates', () => {
    const src = {
      id: 'ht_1', text: 'Daily workout', date: '2026-03-20', dur: 30, pri: 'P1',
      recurring: true, rigid: false, recur: { type: 'daily' }, dayReq: 'any',
      status: 'disabled'
    };
    const result = expandRecurring([src], new Date(2026, 2, 20), new Date(2026, 2, 25), {
      statuses: { ht_1: 'disabled' }
    });
    expect(result).toHaveLength(0);
  });

  test('still expands active templates alongside disabled ones', () => {
    const active = {
      id: 'ht_1', text: 'Active recurring', date: '2026-03-20', dur: 30, pri: 'P1',
      recurring: true, rigid: false, recur: { type: 'daily' }, dayReq: 'any'
    };
    const disabled = {
      id: 'ht_2', text: 'Disabled recurring', date: '2026-03-20', dur: 30, pri: 'P1',
      recurring: true, rigid: false, recur: { type: 'daily' }, dayReq: 'any',
      status: 'disabled'
    };
    const result = expandRecurring([active, disabled], new Date(2026, 2, 20), new Date(2026, 2, 25), {
      statuses: { ht_1: '', ht_2: 'disabled' }
    });
    // Only active template produces instances
    const sourceIds = [...new Set(result.map(t => t.sourceId))];
    expect(sourceIds).toEqual(['ht_1']);
    expect(result.length).toBeGreaterThan(0);
  });
});

/**
 * Mock-DB integration tests for /api/projects routes.
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

// JWT mock
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

// Plan features mock — unlimited by default; override per test for limit cases
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
  // Default insert resolves with undefined (as per mockChainDb spec)
  // Tests that need an insert to return a row id must override this per-test
  mockDb.insert.mockImplementation(() => Promise.resolve());
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

// ─── GET /api/projects ────────────────────────────────────────────────────────

describe('GET /api/projects', () => {
  test('returns user projects', async () => {
    // getProjects: db('projects').where(user_id).orderBy('sort_order') → select() [1 pop]
    resolveQueue.push([
      { id: 1, name: 'Home Renovation', color: '#3B82F6', icon: null, sort_order: 0 },
      { id: 2, name: 'Work Tasks', color: '#10B981', icon: '💼', sort_order: 1 }
    ]);

    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.projects)).toBe(true);
    expect(res.body.projects).toHaveLength(2);
    expect(res.body.projects[0].name).toBe('Home Renovation');
    expect(res.body.projects[1].name).toBe('Work Tasks');
  });

  test('returns empty array when user has no projects', async () => {
    resolveQueue.push([]); // no projects

    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.projects).toEqual([]);
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/projects ───────────────────────────────────────────────────────

describe('POST /api/projects', () => {
  test('creates a project (unlimited plan)', async () => {
    // checkProjectLimit: plan limit = -1 → skip (no DB call)
    // validate(projectSchema): pure validation, no DB
    // createProject:
    //   db('projects').where(user_id).max('sort_order as max').first() [pop 1]
    //   db('projects').insert({...}) → must return [id]; override insert mock
    resolveQueue.push({ max: 5 }); // max sort_order
    mockDb.insert.mockImplementationOnce(() => Promise.resolve([42])); // returns new row id

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ name: 'New Project', color: '#3B82F6' });

    expect(res.status).toBe(201);
    expect(res.body.project.name).toBe('New Project');
    expect(res.body.project.color).toBe('#3B82F6');
  });

  test('creates a project with null max sort_order (first project)', async () => {
    // max returns null when table is empty — controller defaults to (null || 0) + 1 = 1
    resolveQueue.push({ max: null }); // no projects yet
    mockDb.insert.mockImplementationOnce(() => Promise.resolve([1])); // returns new row id

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ name: 'First Project' });

    expect(res.status).toBe(201);
    expect(res.body.project.name).toBe('First Project');
  });

  test('rejects project with empty name (Zod validation)', async () => {
    // validate(projectSchema) rejects name: '' (min(1))
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ name: '' });

    expect(res.status).toBe(400);
  });

  test('rejects project with missing name (Zod validation)', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ color: '#fff' });

    expect(res.status).toBe(400);
  });

  test('rejects project when plan project limit is reached', async () => {
    // Set plan to allow only 2 projects; countProjects returns 2
    mockPlanFeatures = {
      limits: {
        active_tasks: -1, recurring_templates: -1, projects: 2,
        locations: -1, schedule_templates: -1, ai_commands_per_month: -1
      },
      ai: {}, calendar: {}, scheduling: {}, tasks: {}, data: {}
    };

    // checkProjectLimit → countProjects → db('projects').where(user_id).count('* as count').first()
    resolveQueue.push({ count: '2' }); // already at limit

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ name: 'Over Limit Project' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ENTITY_LIMIT_REACHED');
    expect(res.body.limit_key).toBe('limits.projects');
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'No Auth' });
    expect(res.status).toBe(401);
  });
});

// ─── PUT /api/projects/reorder ────────────────────────────────────────────────

describe('PUT /api/projects/reorder', () => {
  test('reorders projects by id array', async () => {
    // reorderProjects: db.transaction → trx('projects').where...whereIn...update()
    // update() does not pop from queue (returns 1 always)
    const res = await request(app)
      .put('/api/projects/reorder')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ ids: [3, 1, 2] });

    expect(res.status).toBe(200);
    expect(res.body.reordered).toBe(3);
  });

  test('accepts empty ids array (no-op)', async () => {
    const res = await request(app)
      .put('/api/projects/reorder')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ ids: [] });

    expect(res.status).toBe(200);
    expect(res.body.reordered).toBe(0);
  });

  test('rejects non-array ids', async () => {
    const res = await request(app)
      .put('/api/projects/reorder')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ ids: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ids array required/);
  });

  test('rejects ids array exceeding 500 items', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    const res = await request(app)
      .put('/api/projects/reorder')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ ids });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Too many ids/);
  });
});

// ─── PUT /api/projects/:id ────────────────────────────────────────────────────

describe('PUT /api/projects/:id', () => {
  test('updates project name and color', async () => {
    // validate(projectUpdateSchema): pure Zod, no DB
    // updateProject: db.transaction → trx('projects').where({id, user_id}).update()
    // No oldName → no task cascade → no additional DB calls
    // transaction update does not pop from queue

    const res = await request(app)
      .put('/api/projects/1')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ name: 'Renamed Project', color: '#000000' });

    expect(res.status).toBe(200);
    expect(res.body.project.name).toBe('Renamed Project');
    expect(res.body.project.color).toBe('#000000');
  });

  test('handles rename without oldName (renamed is null)', async () => {
    // Note: projectUpdateSchema uses Zod strict parsing (no .passthrough()),
    // so `oldName` is stripped before reaching the controller. The rename cascade
    // (renamed != null) cannot be triggered through the API route as-is.
    const res = await request(app)
      .put('/api/projects/2')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ name: 'New Name', color: '#FF5733' });

    expect(res.status).toBe(200);
    expect(res.body.project.name).toBe('New Name');
    expect(res.body.renamed).toBeNull();
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app)
      .put('/api/projects/1')
      .send({ name: 'No Auth' });
    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/projects/:id ─────────────────────────────────────────────────

describe('DELETE /api/projects/:id', () => {
  test('deletes a project', async () => {
    // deleteProject: db('projects').where({id, user_id}).del()
    // del() does not pop from queue (always resolves with 1)

    const res = await request(app)
      .delete('/api/projects/1')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Project deleted');
    expect(res.body.id).toBe('1');
  });

  test('returns 200 even for non-existent id (delete is idempotent)', async () => {
    // The controller does not check if the project exists before deleting —
    // deleteProject just calls .del() which returns 0 rows affected but still 200.
    const res = await request(app)
      .delete('/api/projects/nonexistent')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app)
      .delete('/api/projects/1');
    expect(res.status).toBe(401);
  });
});

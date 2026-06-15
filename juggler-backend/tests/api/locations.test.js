/**
 * Mock-DB integration tests for /api/locations routes.
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

// Plan features mock — unlimited by default; set mockPlanFeatures to override
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

// ─── GET /api/locations ───────────────────────────────────────────────────────

describe('GET /api/locations', () => {
  test('returns user locations', async () => {
    // getLocations: db('locations').where(user_id).orderBy().select() [1 pop]
    resolveQueue.push([
      { location_id: 'loc-1', name: 'Home', icon: 'home', lat: 40.71, lon: -74.00, display_name: 'New York, NY' },
      { location_id: 'loc-2', name: 'Work', icon: 'work', lat: null, lon: null, display_name: null }
    ]);

    const res = await request(app)
      .get('/api/locations')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.locations)).toBe(true);
    expect(res.body.locations).toHaveLength(2);
    expect(res.body.locations[0].id).toBe('loc-1');
    expect(res.body.locations[0].name).toBe('Home');
    expect(res.body.locations[1].id).toBe('loc-2');
  });

  test('returns empty array when user has no locations', async () => {
    resolveQueue.push([]); // no locations

    const res = await request(app)
      .get('/api/locations')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.locations).toEqual([]);
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/locations');
    expect(res.status).toBe(401);
  });
});

// ─── PUT /api/locations ───────────────────────────────────────────────────────

describe('PUT /api/locations', () => {
  test('replaces all locations (happy path, no lat/lon so no geocode call)', async () => {
    // checkLocationLimit: plan limits.locations = -1 → skip (no DB call)
    // replaceLocations: transaction → del() + insert() — these don't pop queue

    const locations = [
      { id: 'loc-a', name: 'Home', icon: 'house' },
      { id: 'loc-b', name: 'Office', icon: 'briefcase' }
    ];

    const res = await request(app)
      .put('/api/locations')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ locations });

    expect(res.status).toBe(200);
    expect(res.body.locations).toHaveLength(2);
    expect(res.body.locations[0].name).toBe('Home');
    expect(res.body.locations[1].name).toBe('Office');
  });

  test('replaces with empty array (deletes all locations)', async () => {
    const res = await request(app)
      .put('/api/locations')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ locations: [] });

    expect(res.status).toBe(200);
    expect(res.body.locations).toEqual([]);
  });

  test('rejects when location count exceeds plan limit', async () => {
    // checkLocationLimit checks incoming count vs plan limit directly (no DB)
    // Set plan to allow only 1 location; send 2
    mockPlanFeatures = {
      limits: {
        active_tasks: -1, recurring_templates: -1, projects: -1,
        locations: 1, schedule_templates: -1, ai_commands_per_month: -1
      },
      ai: { natural_language_commands: true },
      calendar: { max_providers: -1 },
      scheduling: {},
      tasks: {},
      data: {}
    };

    const res = await request(app)
      .put('/api/locations')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ locations: [
        { id: 'loc-x', name: 'Home' },
        { id: 'loc-y', name: 'Work' }
      ]});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ENTITY_LIMIT_REACHED');
    expect(res.body.limit_key).toBe('limits.locations');
  });

  test('rejects malformed locations payload (missing required name field)', async () => {
    // replaceLocations validates via locationsBodySchema (Zod) — name is required
    const res = await request(app)
      .put('/api/locations')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ locations: [{ id: 'bad', icon: 'nope' }] }); // missing name

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid locations/);
  });

  // jug-geopoint-coord-validation (999.557): coordinates must be range-validated.
  // Real payloads use the `lat`/`lon` pair (DB columns, frontend `loc.lon`); the
  // legacy schema validated a dead `lng` field while `lon` passed through unvalidated.
  test('rejects latitude above +90', async () => {
    const res = await request(app)
      .put('/api/locations')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ locations: [{ id: 'loc-a', name: 'Home', lat: 91, lon: 10 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid locations/);
  });

  test('rejects latitude below -90', async () => {
    const res = await request(app)
      .put('/api/locations')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ locations: [{ id: 'loc-a', name: 'Home', lat: -90.5, lon: 10 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid locations/);
  });

  test('rejects longitude above +180', async () => {
    const res = await request(app)
      .put('/api/locations')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ locations: [{ id: 'loc-a', name: 'Home', lat: 10, lon: 181 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid locations/);
  });

  test('rejects longitude below -180', async () => {
    const res = await request(app)
      .put('/api/locations')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ locations: [{ id: 'loc-a', name: 'Home', lat: 10, lon: -181 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid locations/);
  });

  test('accepts valid in-range coordinates (displayName set → no geocode)', async () => {
    const res = await request(app)
      .put('/api/locations')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ locations: [{ id: 'loc-a', name: 'Home', lat: 40.71, lon: -74.0, displayName: 'New York, NY' }] });

    expect(res.status).toBe(200);
    expect(res.body.locations).toHaveLength(1);
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app)
      .put('/api/locations')
      .send({ locations: [] });
    expect(res.status).toBe(401);
  });
});

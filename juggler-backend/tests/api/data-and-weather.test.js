/**
 * Mock-DB integration tests for /api/data/* and /api/weather/* routes.
 *
 * Data routes: POST /import, GET /export
 * Weather routes: GET /geocode, GET /reverse-geocode, GET / (forecast), POST /ingest
 *
 * External HTTP (Open-Meteo, Nominatim) is mocked via globalThis.fetch.
 * DB calls are served from resolveQueue in FIFO order.
 */

process.env.NODE_ENV = 'test';

const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();

// The weather controller uses both .del() (Knex canonical) and .delete() (Knex alias).
// mockChainDb only registers .del; add .delete as an alias so fire-and-forget
// cleanup queries don't throw "is not a function".
mockDb.delete = mockDb.del;

jest.mock('../../src/db', () => mockDb);

// W5 (juggler-hex-h2): KnexWeatherCacheRepository now default-wires from
// lib/db.getDefaultDb() (the single pool src/db re-exports), so feed the same
// mockDb through lib/db too. Keeps the weather forecast cache path on the mock.
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

// JWT mock
const TEST_USER = {
  id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York'
};
jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer '))
      return res.status(401).json({ error: 'Authentication required' });
    req.user = { ...TEST_USER };
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn()
}));

// Plan features mock — unlimited plan
let mockPlanFeatures = {
  limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1, schedule_templates: -1, ai_commands_per_month: -1 },
  ai: { natural_language_commands: true },
  calendar: { max_providers: -1, auto_sync: true },
  scheduling: { dependencies: true, travel_time: true },
  tasks: { rigid: true },
  data: { export: true, import: true, mcp_access: true }
};
jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => {
    req.planId = 'enterprise';
    req.planFeatures = mockPlanFeatures;
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
  set: jest.fn(() => Promise.resolve(true)),
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

// tasks-write mock — prevents real multi-table write logic in import
jest.mock('../../src/lib/tasks-write', () => ({
  insertTask: jest.fn(() => Promise.resolve()),
  updateTask: jest.fn(() => Promise.resolve()),
  deleteTasksWhere: jest.fn(() => Promise.resolve())
}));

// Mock lib/logger to cover two src bugs:
//   1. data.controller.js imports { dataControllerLogger } but src/lib/logger/index.js
//      does not export that name — logger is undefined → TypeError on logger.error().
//   2. weather.controller.js and feature-gate use createLogger from @raike/lib-logger;
//      both are real Winston-based loggers in test and work fine, but mocking here
//      keeps the suite hermetic and prevents console noise.
// The actual export-gap and ReferenceError bugs in src are tracked as real product bugs.
jest.mock('../../src/lib/logger', () => {
  const noop = jest.fn();
  const fakeLogger = { error: noop, warn: noop, info: noop, debug: noop, trace: noop };
  const createLogger = jest.fn(() => fakeLogger);
  return {
    createLogger,
    Logger: class {},
    clearLoggerCache: jest.fn(),
    LOG_LEVELS: ['error', 'warn', 'info', 'debug', 'trace'],
    DEFAULT_LOG_LEVEL: 'debug',
    loggers: {},
    // top-level named loggers used via destructuring in src/ controllers
    dataControllerLogger: fakeLogger,
    weatherControllerLogger: fakeLogger,
    taskControllerLogger: fakeLogger,
    calSyncControllerLogger: fakeLogger,
    aiControllerLogger: fakeLogger,
    schedulerLogger: fakeLogger,
    schedulerRunLogger: fakeLogger,
    schedulerUnifiedLogger: fakeLogger,
    configControllerLogger: fakeLogger,
    libUsageReporterLogger: fakeLogger,
    libGcalLogger: fakeLogger,
    libMsftLogger: fakeLogger,
    libAppleLogger: fakeLogger,
    libDbLogger: fakeLogger,
    libRedisLogger: fakeLogger,
    libTasksWriteLogger: fakeLogger,
    libTaskWriteQueueLogger: fakeLogger,
    libCalAdapterLogger: fakeLogger,
    libSyncLockLogger: fakeLogger,
    libRollingAnchorLogger: fakeLogger,
    libReconcileSplitsLogger: fakeLogger,
    libSseEmitterLogger: fakeLogger,
    aiUsageQueueLogger: fakeLogger,
    aiUsageFlusherLogger: fakeLogger,
    serverLogger: fakeLogger,
    cronCalHistoryLogger: fakeLogger,
    // bare module-level .error/.warn/... so that
    //   const logger = require('../lib/logger')
    // does not throw when logger.error() is called
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
  };
});

// Mock global fetch — used by weather controller (Open-Meteo + Nominatim)
const mockFetchResponse = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: () => Promise.resolve(body)
});

let mockFetch;
beforeAll(() => {
  mockFetch = jest.fn();
  global.fetch = mockFetch;
});

const VALID_TOKEN = 'valid-test-token';
let app, request;

beforeAll(async () => {
  app = require('../../src/app');
  request = require('supertest');
});

beforeEach(() => {
  resolveQueue.length = 0;
  jest.clearAllMocks();
  mockFetch = jest.fn();
  global.fetch = mockFetch;
  mockPlanFeatures = {
    limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1, schedule_templates: -1, ai_commands_per_month: -1 },
    ai: { natural_language_commands: true },
    calendar: { max_providers: -1, auto_sync: true },
    scheduling: { dependencies: true, travel_time: true },
    tasks: { rigid: true },
    data: { export: true, import: true, mcp_access: true }
  };
});

// ─── POST /api/data/import ────────────────────────────────────────────────────

describe('POST /api/data/import', () => {
  const validImportBody = {
    extraTasks: [{ id: 'task-1', text: 'Imported task', dur: 30, pri: 'P2' }],
    statuses: {},
    locations: [],
    tools: [],
    projects: []
  };

  test('imports a valid payload with ?confirm=delete_all', async () => {
    // 999.1603: the replace import now (a) pre-reads user_config for the
    // preference merge, (b) selectively wipes, (c) inserts, then (d) RE-READS
    // inside the trx to VERIFY every written key — feed the FIFO mock in that
    // call order: pre-read, 4 wipe dels, config insert, verification re-read
    // (which must return exactly what the import wrote, as real MySQL would).
    resolveQueue.push([]); // getConfigRows pre-read
    resolveQueue.push([]); // user_config selective del
    resolveQueue.push([]); // tools del
    resolveQueue.push([]); // locations del
    resolveQueue.push([]); // projects del
    resolveQueue.push([]); // insertConfigRows
    resolveQueue.push([
      { config_key: 'tool_matrix', config_value: {} },
      { config_key: 'time_blocks', config_value: {} },
      { config_key: 'loc_schedules', config_value: {} },
      { config_key: 'loc_schedule_defaults', config_value: {} },
      { config_key: 'loc_schedule_overrides', config_value: {} },
      { config_key: 'hour_location_overrides', config_value: {} },
      { config_key: 'preferences', config_value: { gridZoom: 60, splitDefault: false, splitMinDefault: 15, schedFloor: 480, schedCeiling: 1380 } }
    ]); // getConfigRows verification re-read

    const res = await request(app)
      .post('/api/data/import?confirm=delete_all')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send(validImportBody);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'Import successful');
    expect(res.body.counts).toHaveProperty('tasks', 1);
  });

  test('rejects import without ?confirm=delete_all', async () => {
    const res = await request(app)
      .post('/api/data/import')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send(validImportBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirm/);
  });

  test('rejects malformed payload (missing extraTasks)', async () => {
    const res = await request(app)
      .post('/api/data/import?confirm=delete_all')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ tasks: [] }); // wrong field name — extraTasks missing

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid import data/);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/data/import')
      .send(validImportBody);

    expect(res.status).toBe(401);
  });
});

// ─── GET /api/data/export ─────────────────────────────────────────────────────

describe('GET /api/data/export', () => {
  test('exports tasks as JSON with v7 flag', async () => {
    // fetchTasksWithEventIds makes 3 parallel queries internally:
    //   1. tasks_v (via then terminal) → []
    //   2. cal_sync_ledger (via select terminal) → []
    //   3. user_calendars (via select terminal) → [] — needed since fetchTasksWithEventIds
    //      was extended to also pull apple calendar display names
    resolveQueue.push([]);
    resolveQueue.push([]);
    resolveQueue.push([]);
    // exportData Promise.all items 2-5:
    // locations query (orderBy → select terminal) → []
    resolveQueue.push([]);
    // tools query (orderBy → select terminal) → []
    resolveQueue.push([]);
    // projects query (orderBy → select terminal) → []
    resolveQueue.push([]);
    // user_config query (via then terminal) → []
    resolveQueue.push([]);

    const res = await request(app)
      .get('/api/data/export')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('v7', true);
    expect(res.body).toHaveProperty('extraTasks');
    expect(Array.isArray(res.body.extraTasks)).toBe(true);
  });

  test('rejects when plan does not allow export', async () => {
    mockPlanFeatures = {
      ...mockPlanFeatures,
      data: { export: false, import: true, mcp_access: true }
    };

    const res = await request(app)
      .get('/api/data/export')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(403);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/data/export');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/weather/geocode ─────────────────────────────────────────────────

describe('GET /api/weather/geocode', () => {
  test('returns lat/lon/displayName for a valid query', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse({
      results: [{ latitude: 37.77, longitude: -122.42, name: 'San Francisco', admin1: 'California', country: 'US' }]
    }));

    const res = await request(app)
      .get('/api/weather/geocode?q=San+Francisco')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('lat', 37.77);
    expect(res.body).toHaveProperty('lon', -122.42);
    expect(res.body).toHaveProperty('displayName');
    expect(res.body.displayName).toContain('San Francisco');
  });

  test('returns 404 when no results from geocoding API', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse({ results: [] }));

    const res = await request(app)
      .get('/api/weather/geocode?q=zzzzunknown')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(404);
  });

  test('returns 400 for empty query param', async () => {
    const res = await request(app)
      .get('/api/weather/geocode?q=')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/q is required/);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/weather/geocode?q=NYC');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/weather/reverse-geocode ────────────────────────────────────────

describe('GET /api/weather/reverse-geocode', () => {
  test('returns displayName for lat/lon coordinates', async () => {
    // Redis mock always returns null (cache miss) so it falls through to fetch
    mockFetch.mockResolvedValueOnce(mockFetchResponse({
      address: { city: 'San Francisco', state: 'California' },
      display_name: 'San Francisco, California, US'
    }));

    const res = await request(app)
      .get('/api/weather/reverse-geocode?lat=37.77&lon=-122.42')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('displayName');
  });

  test('returns 400 when lat/lon are missing', async () => {
    const res = await request(app)
      .get('/api/weather/reverse-geocode')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lat and lon/);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/weather/reverse-geocode?lat=37&lon=-122');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/weather (forecast) ─────────────────────────────────────────────

describe('GET /api/weather', () => {
  const MOCK_FORECAST = {
    hourly: {
      time: ['2026-05-15T00:00'],
      temperature_2m: [72],
      precipitation_probability: [10],
      precipitation: [0],
      cloudcover: [30],
      weathercode: [1],
      relativehumidity_2m: [60]
    },
    hourly_units: { temperature_2m: '°F' }
  };

  test('returns forecast data (cache miss → fetch from Open-Meteo)', async () => {
    // DB cache lookup: first() → null (cache miss)
    resolveQueue.push(null);
    // fetch from Open-Meteo
    mockFetch.mockResolvedValueOnce(mockFetchResponse(MOCK_FORECAST));
    // insert cache row — no queue needed (insert returns Promise.resolve())
    // fire-and-forget delete stale rows — no queue needed

    const res = await request(app)
      .get('/api/weather?lat=37.7&lon=-122.4')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('hourly');
    expect(res.body).toHaveProperty('refreshed', true);
  });

  test('returns cached forecast when cache is hot', async () => {
    const cachedRow = {
      fetched_at: new Date(Date.now() - 1000).toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      forecast_json: JSON.stringify(MOCK_FORECAST)
    };
    // DB cache lookup: first() → cachedRow
    resolveQueue.push(cachedRow);

    const res = await request(app)
      .get('/api/weather?lat=37.7&lon=-122.4')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('hourly');
    // Should NOT have refreshed flag when served from cache
    expect(res.body.refreshed).toBeUndefined();
  });

  test('returns 400 when lat/lon are missing', async () => {
    const res = await request(app)
      .get('/api/weather')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lat and lon/);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/weather?lat=37&lon=-122');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/weather/ingest ─────────────────────────────────────────────────

const makeValidIngestBody = () => ({
  lat: 37.7,
  lon: -122.4,
  hourly: {
    time: ['2026-05-15T00:00'],
    temperature_2m: [72],
    precipitation_probability: [10],
    cloudcover: [30],
    weathercode: [1],
    precipitation: [0],
    relativehumidity_2m: [60]
  }
});

describe('POST /api/weather/ingest', () => {
  test('stores weather payload and returns cachedAt/expiresAt', async () => {
    const res = await request(app)
      .post('/api/weather/ingest')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send(makeValidIngestBody());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('cachedAt');
    expect(res.body).toHaveProperty('expiresAt');
  });

  test('rejects invalid payload (missing hourly)', async () => {
    const res = await request(app)
      .post('/api/weather/ingest')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ lat: 37.7, lon: -122.4 }); // no hourly

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing hourly/);
  });

  test('rejects payload with invalid lat', async () => {
    const body = makeValidIngestBody();
    body.lat = 200; // out of range
    const res = await request(app)
      .post('/api/weather/ingest')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid lat/);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/weather/ingest')
      .send(makeValidIngestBody());

    expect(res.status).toBe(401);
  });
});

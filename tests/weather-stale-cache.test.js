/**
 * Weather stale-cache behaviour tests.
 *
 * 1. Scheduler (unifiedScheduleV2) correctly enforces weather constraints
 *    when weatherByDateHour is provided — even if data came from a stale
 *    cache row.
 *
 * 2. /health/detailed weather service section: operational / degraded / not_configured.
 */

process.env.NODE_ENV = 'test';

// ── Scheduler tests (unifiedScheduleV2 directly) ─────────────────────────────

const unifiedSchedule = require('../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');

const TODAY = '2026-05-20';
const NOW_MINS = 480; // 8 AM

function makeTask(overrides) {
  return {
    id: 'task_' + Math.random().toString(36).slice(2, 6),
    text: 'Cut Grass',
    date: TODAY,
    dur: 120,
    pri: 'P3',
    when: 'morning,lunch,afternoon,evening',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: false,
    split: false,
    datePinned: false,
    generated: false,
    ...overrides
  };
}

function makeCfg(weatherByDateHour) {
  return {
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    preferences: {},
    weatherByDateHour: weatherByDateHour || {}
  };
}

function rainyDay() {
  var byHour = {};
  for (var h = 0; h < 24; h++) {
    byHour[h] = { temp: 65, precipProb: 80, cloudcover: 90, humidity: 70 };
  }
  return { [TODAY]: byHour };
}

function dryDay() {
  var byHour = {};
  for (var h = 0; h < 24; h++) {
    byHour[h] = { temp: 72, precipProb: 5, cloudcover: 10, humidity: 40 };
  }
  return { [TODAY]: byHour };
}

describe('Scheduler weather constraints', () => {
  test('dry_only task is NOT placed on rainy day when weather data present', () => {
    var task = makeTask({
      id: 'cut_grass',
      weatherPrecip: 'dry_only',
      weatherCloud: 'any',
      weatherTempMin: 50,
      weatherTempMax: 86,
      weatherHumidityMin: null,
      weatherHumidityMax: 53
    });
    var result = unifiedSchedule([task], { cut_grass: '' }, TODAY, NOW_MINS, makeCfg(rainyDay()));
    // Weather data only covers TODAY — verify it is NOT placed on the rainy day itself.
    // (Fail-open on future dates without data is expected and tested separately.)
    var placedToday = (result.dayPlacements[TODAY] || []).find(p => p.task && p.task.id === 'cut_grass');
    expect(placedToday).toBeUndefined();
  });

  test('dry_only task IS placed on dry day when weather data present', () => {
    var task = makeTask({
      id: 'cut_grass',
      weatherPrecip: 'dry_only',
      weatherCloud: 'any',
      weatherTempMin: 50,
      weatherTempMax: 86,
      weatherHumidityMin: null,
      weatherHumidityMax: 53
    });
    var result = unifiedSchedule([task], { cut_grass: '' }, TODAY, NOW_MINS, makeCfg(dryDay()));
    var placedToday = (result.dayPlacements[TODAY] || []).find(p => p.task && p.task.id === 'cut_grass');
    expect(placedToday).toBeDefined();
  });

  test('no weather constraint — always placed regardless of weather', () => {
    var task = makeTask({ id: 'no_weather' });
    var result = unifiedSchedule([task], { no_weather: '' }, TODAY, NOW_MINS, makeCfg(rainyDay()));
    var placed = Object.values(result.dayPlacements).flat().find(p => p.task && p.task.id === 'no_weather');
    expect(placed).toBeDefined();
  });

  test('humidity_max blocks task when humidity exceeds limit', () => {
    var task = makeTask({
      id: 'humidity_task',
      weatherPrecip: 'any',
      weatherCloud: 'any',
      weatherTempMin: null,
      weatherTempMax: null,
      weatherHumidityMin: null,
      weatherHumidityMax: 53
    });
    // rainyDay has humidity=70, above the 53 max — task must not land on TODAY.
    var result = unifiedSchedule([task], { humidity_task: '' }, TODAY, NOW_MINS, makeCfg(rainyDay()));
    var placedToday = (result.dayPlacements[TODAY] || []).find(p => p.task && p.task.id === 'humidity_task');
    expect(placedToday).toBeUndefined();
  });

  test('dry_only task IS placed when weatherByDateHour is empty (fail-open — no data = no block)', () => {
    // Regression guard: when weather cache is absent, constraints must NOT block.
    // This was the original bug: stale cache → empty map → task unscheduled.
    var task = makeTask({
      id: 'failopen_task',
      weatherPrecip: 'dry_only',
      weatherCloud: 'any',
      weatherTempMin: 50,
      weatherTempMax: 86,
      weatherHumidityMin: null,
      weatherHumidityMax: 53
    });
    var result = unifiedSchedule([task], { failopen_task: '' }, TODAY, NOW_MINS, makeCfg({}));
    var placed = Object.values(result.dayPlacements).flat().find(p => p.task && p.task.id === 'failopen_task');
    expect(placed).toBeDefined();
  });
});

// ── /health/detailed weather section ─────────────────────────────────────────

const { createMockChainDb } = require('./helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();
mockDb.delete = mockDb.del;
jest.mock('../src/db', () => mockDb);

jest.mock('../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer '))
      return res.status(401).json({ error: 'Authentication required' });
    req.user = { id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York' };
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn()
}));

jest.mock('../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => { req.planId = 'enterprise'; req.planFeatures = {}; next(); },
  PRODUCT_ID: 'juggler',
  refreshPlanFeatures: jest.fn(),
  getCachedPlanFeatures: jest.fn()
}));

jest.mock('../src/scheduler/scheduleQueue', () => ({
  getLastError: jest.fn(() => null),
  enqueue: jest.fn()
}));

jest.mock('../src/lib/redis', () => ({
  getClient: jest.fn(() => ({ get: jest.fn(), set: jest.fn(), del: jest.fn() }))
}));

const request = require('supertest');
const VALID_TOKEN = 'Bearer test-token';

// Push mock DB responses in the order /health/detailed makes calls:
//   1. schedule_queue stuck-claims count
//   2. users row (sync check)
//   3. cal_sync_ledger rows
//   4. locations first() (weather check)
//   5. weather_cache first() (weather check) — only when locRow is non-null
function pushHealthMocks({ locRow, weatherRow }) {
  resolveQueue.push({ cnt: 0 });   // schedule_queue
  resolveQueue.push({});            // users row
  resolveQueue.push([]);            // cal_sync_ledger
  resolveQueue.push(locRow);        // locations
  if (locRow) resolveQueue.push(weatherRow); // weather_cache (skipped when no loc)
}

describe('/health/detailed weather service', () => {
  let app;
  beforeAll(() => { app = require('../src/app'); });
  afterEach(() => { resolveQueue.length = 0; });

  test('operational when cache is fresh (< 2h old)', async () => {
    pushHealthMocks({
      locRow: { lat: '37.6', lon: '-77.6' },
      weatherRow: { fetched_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() }
    });
    const res = await request(app).get('/api/health/detailed').set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.services.weather).toBe('operational');
    expect(typeof res.body.detail.weather).toBe('string');
    expect(res.body.detail.weather).toMatch(/forecast fetched \d+ min ago/);
  });

  test('degraded when cache is stale (> 2h old)', async () => {
    pushHealthMocks({
      locRow: { lat: '37.6', lon: '-77.6' },
      weatherRow: { fetched_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() }
    });
    const res = await request(app).get('/api/health/detailed').set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.services.weather).toBe('degraded');
    expect(res.body.detail.weather).toMatch(/\d+ min old/);
    expect(res.body.status).toBe('DEGRADED');
  });

  test('degraded when no cache row exists', async () => {
    pushHealthMocks({ locRow: { lat: '37.6', lon: '-77.6' }, weatherRow: null });
    const res = await request(app).get('/api/health/detailed').set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.services.weather).toBe('degraded');
    expect(res.body.detail.weather).toMatch(/no forecast/i);
  });

  test('not_configured when user has no location with coords', async () => {
    pushHealthMocks({ locRow: null });
    const res = await request(app).get('/api/health/detailed').set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.services.weather).toBe('not_configured');
  });

  test('operational at 119 min (just under 2h boundary)', async () => {
    pushHealthMocks({
      locRow: { lat: '37.6', lon: '-77.6' },
      weatherRow: { fetched_at: new Date(Date.now() - 119 * 60 * 1000).toISOString() }
    });
    const res = await request(app).get('/api/health/detailed').set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.services.weather).toBe('operational');
    expect(typeof res.body.detail.weather).toBe('string');
    expect(res.body.detail.weather).toMatch(/forecast fetched \d+ min ago/);
  });

  test('degraded at 121 min (just over 2h boundary)', async () => {
    pushHealthMocks({
      locRow: { lat: '37.6', lon: '-77.6' },
      weatherRow: { fetched_at: new Date(Date.now() - 121 * 60 * 1000).toISOString() }
    });
    const res = await request(app).get('/api/health/detailed').set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.services.weather).toBe('degraded');
  });

  test('returns 401 without Authorization header', async () => {
    const res = await request(app).get('/api/health/detailed');
    expect(res.status).toBe(401);
  });
});

/**
 * Mock-DB integration tests for OAuth provider routes:
 *   GCal:  GET /api/gcal/status, POST /disconnect, POST /auto-sync, GET /connect
 *   MSFT:  GET /api/msft-cal/status, POST /disconnect, POST /auto-sync, GET /connect
 *   Apple: GET /api/apple-cal/status, POST /disconnect, POST /auto-sync, GET /calendars, POST /select-calendar
 *
 * Each provider block includes at least one 401 test.
 * External HTTP is fully mocked (google-auth-library, msft-cal-api).
 * DB calls are served from resolveQueue in FIFO order.
 */

process.env.NODE_ENV = 'test';

const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();
jest.mock('../../src/db', () => mockDb);
jest.mock('../../src/lib/db', () => ({ getDefaultDb: () => mockDb }));

// JWT mock
const TEST_USER = {
  id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York',
  // GCal not connected by default
  gcal_refresh_token: null, gcal_access_token: null, gcal_token_expiry: null,
  gcal_last_synced_at: null,
  // MSFT not connected by default
  msft_cal_refresh_token: null, msft_cal_access_token: null, msft_cal_token_expiry: null,
  msft_cal_last_synced_at: null,
  // Apple not connected by default
  apple_cal_username: null, apple_cal_password: null, apple_cal_calendar_url: null,
  apple_cal_last_synced_at: null
};

jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer '))
      return res.status(401).json({ error: 'Authentication required' });
    // Support overriding user via x-test-user header (JSON encoded)
    if (req.headers['x-test-user']) {
      try { req.user = JSON.parse(req.headers['x-test-user']); }
      catch (e) { req.user = { ...TEST_USER }; }
    } else {
      req.user = { ...TEST_USER };
    }
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

// gcal-api mock — no real Google OAuth calls
jest.mock('../../src/lib/gcal-api', () => ({
  createOAuth2Client: jest.fn(() => ({ generateAuthUrl: jest.fn(() => 'https://accounts.google.com/mock-auth') })),
  getAuthUrl: jest.fn(() => 'https://accounts.google.com/mock-auth?scope=calendar'),
  getTokensFromCode: jest.fn(() => Promise.resolve({ access_token: 'mock-at', refresh_token: 'mock-rt', expiry_date: Date.now() + 3600000 })),
  refreshAccessToken: jest.fn(() => Promise.resolve({ access_token: 'refreshed-at', expiry_date: Date.now() + 3600000 }))
}));

// msft-cal-api mock — no real Microsoft OAuth calls
jest.mock('../../src/lib/msft-cal-api', () => ({
  generatePkce: jest.fn(() => ({ codeVerifier: 'mock-verifier', codeChallenge: 'mock-challenge' })),
  getAuthUrl: jest.fn(() => 'https://login.microsoftonline.com/mock-auth'),
  getTokensFromCode: jest.fn(() => Promise.resolve({ accessToken: 'mock-at', refreshToken: 'mock-rt', expiresOn: Date.now() + 3600000 }))
}));

// apple-cal-api mock — no real CalDAV calls
jest.mock('../../src/lib/apple-cal-api', () => ({
  DEFAULT_SERVER_URL: 'https://caldav.icloud.com',
  createClient: jest.fn(() => Promise.resolve({})),
  discoverCalendars: jest.fn(() => Promise.resolve([{ url: '/cal/home/', displayName: 'Home' }]))
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
  mockPlanFeatures = {
    limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1, schedule_templates: -1, ai_commands_per_month: -1 },
    ai: { natural_language_commands: true },
    calendar: { max_providers: -1, auto_sync: true },
    scheduling: { dependencies: true, travel_time: true },
    tasks: { rigid: true },
    data: { export: true, import: true, mcp_access: true }
  };
});

// ═══════════════════════════════════════════════════════════════════════════════
// GCal routes
// ═══════════════════════════════════════════════════════════════════════════════

describe('GCal — GET /api/gcal/status', () => {
  test('not connected when user has no refresh token', async () => {
    // auto-sync check: db('user_config').where({...gcal_auto_sync}).first() → null
    resolveQueue.push(null);

    const res = await request(app)
      .get('/api/gcal/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
    expect(res.body).toHaveProperty('autoSync');
  });

  test('connected when user has a refresh token', async () => {
    const connectedUser = { ...TEST_USER, gcal_refresh_token: 'refresh-token-xyz' };
    // auto-sync row
    resolveQueue.push({ config_key: 'gcal_auto_sync', config_value: 'true' });

    const res = await request(app)
      .get('/api/gcal/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('x-test-user', JSON.stringify(connectedUser));

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.autoSync).toBe(true);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/gcal/status');
    expect(res.status).toBe(401);
  });
});

describe('GCal — POST /api/gcal/disconnect', () => {
  test('clears stored credentials and returns { disconnected: true }', async () => {
    const res = await request(app)
      .post('/api/gcal/disconnect')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ disconnected: true });
    // Pin the user-id delegation: the facade must scope the token-clearing
    // UPDATE to the AUTHENTICATED user's id (a string), not the whole req.user
    // object. Without this, passing req.user instead of req.user.id is a silent
    // no-op disconnect (tokens never cleared) that the response-shape assertion
    // above cannot detect, since gcalDisconnect returns a constant. (zoe)
    expect(mockDb.where).toHaveBeenCalledWith('id', TEST_USER.id);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/gcal/disconnect');
    expect(res.status).toBe(401);
  });
});

describe('GCal — POST /api/gcal/auto-sync', () => {
  test('enables auto-sync when flag does not exist (insert path)', async () => {
    // check existing row
    resolveQueue.push(null); // no existing row → insert
    const res = await request(app)
      .post('/api/gcal/auto-sync')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('autoSync', true);
    // Pin the user-id delegation: the config row must be scoped to the
    // AUTHENTICATED user's id (string), not the whole req.user object. A
    // req.user/req.user.id swap on the first facade arg writes the config
    // under a malformed user_id and is otherwise invisible (the autoSync
    // value above is the SECOND arg). (zoe)
    expect(mockDb.where).toHaveBeenCalledWith({ user_id: TEST_USER.id, config_key: 'gcal_auto_sync' });
  });

  test('toggles auto-sync off when row exists (update path)', async () => {
    resolveQueue.push({ config_key: 'gcal_auto_sync', config_value: 'true' }); // existing
    const res = await request(app)
      .post('/api/gcal/auto-sync')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('autoSync', false);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/gcal/auto-sync');
    expect(res.status).toBe(401);
  });
});

describe('GCal — GET /api/gcal/connect', () => {
  test('returns authUrl for connected user', async () => {
    const res = await request(app)
      .get('/api/gcal/connect')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('authUrl');
    expect(typeof res.body.authUrl).toBe('string');
    // Pin user-object delegation: gcalConnect(user) takes the FULL user object so
    // the signed state JWT encodes { userId: user.id }.  A req.user→req.user.id
    // swap in the controller makes facade receive a string, so user.id===undefined
    // inside the facade — the JWT then encodes { userId: undefined } and the
    // jwtVerify assertion below flips RED.  Verified: mutating gcalConnect arg in
    // gcal.controller.js to `req.user.id` → this test RED; revert → GREEN. (telly WARN-3 closeout)
    const gcalApiMock = require('../../src/lib/gcal-api');
    expect(gcalApiMock.getAuthUrl).toHaveBeenCalledTimes(1);
    const stateJwt = gcalApiMock.getAuthUrl.mock.calls[0][1];
    const { jwtVerify } = require('jose');
    const secretKey = new TextEncoder().encode('local-dev-jwt-secret-juggler');
    const { payload } = await jwtVerify(stateJwt, secretKey);
    expect(payload.userId).toBe(TEST_USER.id);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/gcal/connect');
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MSFT Calendar routes
// ═══════════════════════════════════════════════════════════════════════════════

describe('MSFT — GET /api/msft-cal/status', () => {
  test('not connected when user has no refresh token', async () => {
    resolveQueue.push(null); // no msft_cal_auto_sync row

    const res = await request(app)
      .get('/api/msft-cal/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
    expect(res.body).toHaveProperty('autoSync');
  });

  test('connected when user has a refresh token', async () => {
    const connectedUser = { ...TEST_USER, msft_cal_refresh_token: 'msft-refresh-xyz' };
    resolveQueue.push({ config_key: 'msft_cal_auto_sync', config_value: 'true' });

    const res = await request(app)
      .get('/api/msft-cal/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('x-test-user', JSON.stringify(connectedUser));

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.autoSync).toBe(true);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/msft-cal/status');
    expect(res.status).toBe(401);
  });
});

describe('MSFT — POST /api/msft-cal/disconnect', () => {
  test('clears credentials and returns { disconnected: true }', async () => {
    const res = await request(app)
      .post('/api/msft-cal/disconnect')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ disconnected: true });
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/msft-cal/disconnect');
    expect(res.status).toBe(401);
  });
});

describe('MSFT — POST /api/msft-cal/auto-sync', () => {
  test('enables auto-sync (insert path)', async () => {
    resolveQueue.push(null); // no existing row
    const res = await request(app)
      .post('/api/msft-cal/auto-sync')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('autoSync', true);
  });

  test('toggles off (update path)', async () => {
    resolveQueue.push({ config_key: 'msft_cal_auto_sync', config_value: 'true' });
    const res = await request(app)
      .post('/api/msft-cal/auto-sync')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.autoSync).toBe(false);
  });
});

describe('MSFT — GET /api/msft-cal/connect', () => {
  test('returns authUrl for authenticated user', async () => {
    const res = await request(app)
      .get('/api/msft-cal/connect')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('authUrl');
    expect(typeof res.body.authUrl).toBe('string');
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/msft-cal/connect');
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Apple Calendar routes
// ═══════════════════════════════════════════════════════════════════════════════

describe('Apple — GET /api/apple-cal/status', () => {
  test('not connected when user has no credentials', async () => {
    // user_calendars query for apple calendars
    resolveQueue.push([]); // no calendars
    resolveQueue.push(null); // no auto-sync row

    const res = await request(app)
      .get('/api/apple-cal/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
    expect(res.body).toHaveProperty('autoSync');
  });

  test('connected when user has credentials and a calendar URL', async () => {
    const connectedUser = {
      ...TEST_USER,
      apple_cal_username: 'test@icloud.com',
      apple_cal_password: 'encrypted-password',
      apple_cal_calendar_url: 'https://caldav.icloud.com/123/calendars/'
    };
    resolveQueue.push([]); // user_calendars empty (no multi-cal rows)
    resolveQueue.push({ config_key: 'apple_cal_auto_sync', config_value: 'false' });

    const res = await request(app)
      .get('/api/apple-cal/status')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .set('x-test-user', JSON.stringify(connectedUser));

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/apple-cal/status');
    expect(res.status).toBe(401);
  });
});

describe('Apple — POST /api/apple-cal/disconnect', () => {
  test('clears credentials and returns { disconnected: true }', async () => {
    const res = await request(app)
      .post('/api/apple-cal/disconnect')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ disconnected: true });
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/apple-cal/disconnect');
    expect(res.status).toBe(401);
  });
});

describe('Apple — POST /api/apple-cal/auto-sync', () => {
  test('enables auto-sync (insert path)', async () => {
    resolveQueue.push(null); // no existing row
    const res = await request(app)
      .post('/api/apple-cal/auto-sync')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('autoSync', true);
  });

  test('toggles off (update path)', async () => {
    resolveQueue.push({ config_key: 'apple_cal_auto_sync', config_value: 'true' });
    const res = await request(app)
      .post('/api/apple-cal/auto-sync')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.autoSync).toBe(false);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/apple-cal/auto-sync');
    expect(res.status).toBe(401);
  });
});

describe('Apple — GET /api/apple-cal/calendars', () => {
  // getCalendars returns { calendars: [...] } (an object, not a plain array)
  test('returns calendar list when stored', async () => {
    // user_calendars query (no .select()/.first() — resolved via chain.then)
    resolveQueue.push([
      { calendar_id: 'cal-1', display_name: 'Home', enabled: true, provider: 'apple', user_id: 'user-123' }
    ]);

    const res = await request(app)
      .get('/api/apple-cal/calendars')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('calendars');
    expect(Array.isArray(res.body.calendars)).toBe(true);
    expect(res.body.calendars).toHaveLength(1);
    expect(res.body.calendars[0].calendar_id).toBe('cal-1');
  });

  test('returns empty calendars array when none stored', async () => {
    resolveQueue.push([]);

    const res = await request(app)
      .get('/api/apple-cal/calendars')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('calendars');
    expect(Array.isArray(res.body.calendars)).toBe(true);
    expect(res.body.calendars).toHaveLength(0);
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/apple-cal/calendars');
    expect(res.status).toBe(401);
  });
});

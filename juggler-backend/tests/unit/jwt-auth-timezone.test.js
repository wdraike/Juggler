/**
 * jwt-auth timezone ownership (999.1222 ruling, 2026-07-06)
 *
 * RULING: users.timezone is owned by Settings only.
 *  - Initial value is set ONCE at first-login provisioning, from the REAL
 *    browser IANA zone in the dedicated X-Browser-Timezone header.
 *  - The X-Timezone header is display-only (TZ-DISPLAY-3) and must NEVER be
 *    read for provisioning nor overwrite the stored timezone.
 *  - The former 999.899 silent per-request overwrite is removed.
 *
 * Mock-based unit test — no DB needed (safe outside test-bed).
 */

process.env.NODE_ENV = 'test';

// ── Mocks ────────────────────────────────────────────────────────────────────

// auth-client: pass-through middleware that stamps the token claims set by the test.
let mockTokenClaims = null;
jest.mock('auth-client', () => ({
  authenticateJWT: () => (req, res, cb) => {
    req.user = { ...mockTokenClaims };
    req.auth = { apps: ['juggler'] };
    cb();
  }
}));

// jose: not exercised here (MCP verifyToken path only).
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn()
}));

jest.mock('@raike/lib-logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })
}));

jest.mock('../../src/service-identity', () => ({ APP_ID: 'juggler' }));

// Knex-ish db mock: db('users').where(...).first() pops from mockFirstQueue;
// insert/update are spies.
let mockFirstQueue = [];
const mockInsertSpy = jest.fn(() => Promise.resolve());
const mockUpdateSpy = jest.fn(() => Promise.resolve(1));

function createChain() {
  const chain = {};
  chain.where = jest.fn(() => chain);
  chain.first = jest.fn(() => Promise.resolve(mockFirstQueue.length ? mockFirstQueue.shift() : null));
  chain.insert = mockInsertSpy;
  chain.update = mockUpdateSpy;
  return chain;
}
const mockDb = jest.fn(() => createChain());
jest.mock('../../src/db', () => mockDb);

const { authenticateJWT } = require('../../src/middleware/jwt-auth');

// ── Helpers ──────────────────────────────────────────────────────────────────

function runMiddleware(headers) {
  const req = { headers: headers || {} };
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(() => res)
  };
  return new Promise((resolve, reject) => {
    authenticateJWT(req, res, (err) => (err ? reject(err) : resolve({ req, res })));
  });
}

const CLAIMS = { id: 'auth-user-1', email: 'tz@test.com', name: 'TZ Test', picture: null };

beforeEach(() => {
  mockTokenClaims = { ...CLAIMS };
  mockFirstQueue = [];
  mockInsertSpy.mockClear();
  mockUpdateSpy.mockClear();
  mockDb.mockClear();
});

// ── Provisioning (first login) ───────────────────────────────────────────────

describe('first-login provisioning sets timezone ONCE from X-Browser-Timezone', () => {
  test('uses the X-Browser-Timezone header value', async () => {
    mockFirstQueue = [
      null, // no existing user by email → provision
      { id: 'auth-user-1', email: 'tz@test.com', timezone: 'Europe/Berlin' } // post-insert fetch
    ];
    const { req } = await runMiddleware({
      'x-browser-timezone': 'Europe/Berlin',
      'x-timezone': 'America/Chicago' // display tz — must be ignored for provisioning
    });
    expect(mockInsertSpy).toHaveBeenCalledTimes(1);
    expect(mockInsertSpy.mock.calls[0][0].timezone).toBe('Europe/Berlin');
    expect(req.user.timezone).toBe('Europe/Berlin');
  });

  test('does NOT read X-Timezone: header absent → America/New_York default', async () => {
    mockFirstQueue = [
      null,
      { id: 'auth-user-1', email: 'tz@test.com', timezone: 'America/New_York' }
    ];
    await runMiddleware({ 'x-timezone': 'Asia/Tokyo' }); // no x-browser-timezone
    expect(mockInsertSpy).toHaveBeenCalledTimes(1);
    // X-Timezone (display-only) must not leak into the stored timezone
    expect(mockInsertSpy.mock.calls[0][0].timezone).toBe('America/New_York');
  });

  test('invalid IANA name in X-Browser-Timezone → America/New_York default', async () => {
    mockFirstQueue = [
      null,
      { id: 'auth-user-1', email: 'tz@test.com', timezone: 'America/New_York' }
    ];
    await runMiddleware({ 'x-browser-timezone': 'Not/A_Zone' });
    expect(mockInsertSpy).toHaveBeenCalledTimes(1);
    expect(mockInsertSpy.mock.calls[0][0].timezone).toBe('America/New_York');
  });
});

// ── Existing users: Settings-only ownership ─────────────────────────────────

describe('existing user: users.timezone is never written by jwt-auth', () => {
  const EXISTING = { id: 'local-1', email: 'tz@test.com', name: 'TZ Test', timezone: 'America/New_York' };

  test('differing X-Timezone does NOT update users.timezone (999.899 overwrite removed)', async () => {
    mockFirstQueue = [{ ...EXISTING }];
    const { req } = await runMiddleware({ 'x-timezone': 'Europe/London' });
    expect(mockUpdateSpy).not.toHaveBeenCalled();
    expect(mockInsertSpy).not.toHaveBeenCalled();
    expect(req.user.timezone).toBe('America/New_York');
  });

  test('differing X-Browser-Timezone does NOT update users.timezone (set once at creation)', async () => {
    mockFirstQueue = [{ ...EXISTING }];
    const { req } = await runMiddleware({
      'x-browser-timezone': 'Australia/Sydney',
      'x-timezone': 'Australia/Sydney'
    });
    expect(mockUpdateSpy).not.toHaveBeenCalled();
    expect(req.user.timezone).toBe('America/New_York');
  });
});

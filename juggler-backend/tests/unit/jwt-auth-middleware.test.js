/**
 * jwt-auth middleware — unit tests with the provisioning use-case MOCKED
 * (999.1197). Verifies the middleware's own responsibilities after the
 * extraction: verify JWT (delegated), enforce the app claim, delegate
 * resolve-or-provision to ProvisionUserOnFirstLogin, stamp authServiceId,
 * and surface use-case failures via next(err) + an error log.
 *
 * Mock-based — no DB needed (safe outside test-bed). The use-case itself is
 * covered in tests/slices/user-config/application/provisionUserOnFirstLogin.test.js;
 * the full middleware+use-case+db-mock path stays covered by
 * tests/unit/jwt-auth-timezone.test.js.
 */

'use strict';

process.env.NODE_ENV = 'test';

// auth-client: pass-through middleware that stamps the token claims set by the test.
let mockTokenClaims = null;
let mockApps = ['juggler'];
jest.mock('auth-client', () => ({
  authenticateJWT: () => (req, res, cb) => {
    req.user = { ...mockTokenClaims };
    req.auth = { apps: mockApps };
    cb();
  },
}));

const mockCreateRemoteJWKSet = jest.fn(() => 'JWKS_HANDLE');
jest.mock('jose', () => ({
  createRemoteJWKSet: (...args) => mockCreateRemoteJWKSet(...args),
  jwtVerify: jest.fn(async () => ({ payload: { sub: 'x' } })),
}));

const mockLoggerError = jest.fn();
jest.mock('@raike/lib-logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: mockLoggerError }),
}));

// Full identity shape: the user-config facade graph (loaded via the middleware's
// facade import) constructs PaymentServiceEntitlementAdapter, which reads
// PRODUCT_LABEL from service-identity at module load.
jest.mock('../../src/service-identity', () => ({
  APP_ID: 'juggler', PRODUCT_LABEL: 'juggler', SERVICE_NAME: 'strivers'
}));
jest.mock('../../src/db', () => jest.fn());

// The provisioning use-case is mocked — the middleware must only delegate.
const mockExecute = jest.fn();
jest.mock(
  '../../src/slices/user-config/application/commands/ProvisionUserOnFirstLogin',
  () => jest.fn().mockImplementation(() => ({ execute: mockExecute })),
);

const { authenticateJWT, verifyToken } = require('../../src/middleware/jwt-auth');

const CLAIMS = { id: 'auth-user-1', email: 'mw@test.com', name: 'MW Test', picture: null };

function runMiddleware(headers) {
  const req = { headers: headers || {} };
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  return new Promise((resolve) => {
    // resolve on next() (with or without err) — 403 path resolves via res.json
    res.json.mockImplementation(() => { resolve({ req, res, nextErr: undefined, nexted: false }); return res; });
    authenticateJWT(req, res, (err) => resolve({ req, res, nextErr: err, nexted: true }));
  });
}

beforeEach(() => {
  mockTokenClaims = { ...CLAIMS };
  mockApps = ['juggler'];
  mockExecute.mockReset();
  mockLoggerError.mockClear();
});

describe('authenticateJWT (use-case mocked)', () => {
  test('403 when the token lacks the juggler app claim; use-case never called', async () => {
    mockApps = ['resume-optimizer'];
    const { res } = await runMiddleware();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  test('delegates to the use-case with authUser claims + X-Browser-Timezone, stamps authServiceId', async () => {
    const row = { id: 'auth-user-1', email: CLAIMS.email, timezone: 'Europe/Berlin' };
    mockExecute.mockResolvedValue(row);
    const { req, nextErr } = await runMiddleware({ 'x-browser-timezone': 'Europe/Berlin' });
    expect(nextErr).toBeUndefined();
    expect(mockExecute).toHaveBeenCalledWith({
      authUser: expect.objectContaining({ id: CLAIMS.id, email: CLAIMS.email }),
      browserTimezone: 'Europe/Berlin',
    });
    expect(req.user).toEqual({ ...row, authServiceId: CLAIMS.id });
  });

  test('use-case failure → next(err) + error log (observable, never silent)', async () => {
    const boom = new Error('User provision failed');
    mockExecute.mockRejectedValue(boom);
    const { nextErr } = await runMiddleware();
    expect(nextErr).toBe(boom);
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining('user lookup/provision'),
      { err: boom.message },
    );
  });
});

describe('JWKS URL config wiring (999.1197)', () => {
  test('outside production, getJWKS uses the documented lib/config dev default', async () => {
    delete process.env.AUTH_JWKS_URL;
    await verifyToken('some-token');
    expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1);
    expect(mockCreateRemoteJWKSet.mock.calls[0][0].href)
      .toBe('http://localhost:5010/.well-known/jwks.json');
  });
});

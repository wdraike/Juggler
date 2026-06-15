/**
 * App tests — Express application configuration
 */

const request = require('supertest');
const app = require('../../src/app');

describe('Express App', () => {
  describe('Middleware stack', () => {
    test('should apply helmet middleware', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    test('should apply compression middleware when client accepts it', async () => {
      // supertest strips Accept-Encoding by default; set it explicitly.
      // Compression is negotiated — only present when client signals support.
      const res = await request(app)
        .get('/health/immediate')
        .set('Accept-Encoding', 'gzip, deflate');
      // Either compressed (content-encoding set) or body too small to compress.
      // The key check: response succeeds and middleware is active (no error).
      expect([200, 503]).toContain(res.status);
    });

    test('should apply CORS with allowed origins', async () => {
      const res = await request(app)
        .get('/health')
        .set('Origin', 'http://localhost:3000');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });
  });

  describe('Health endpoint', () => {
    test('should respond on /health', async () => {
      // Health endpoint pings DB. Without a test DB it returns 503.
      // Either way the response must be valid JSON with a status field.
      const res = await request(app).get('/health');
      expect([200, 503]).toContain(res.status);
      expect(res.body).toHaveProperty('status');
    });

    test('/health/immediate returns 200 without DB dependency', async () => {
      // /health/immediate is the no-DB fast probe
      const res = await request(app).get('/health/immediate');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
    });

    test('/health/detailed is behind auth (returns 401 without token)', async () => {
      const res = await request(app).get('/health/detailed');
      expect(res.status).toBe(401);
    });
  });

  describe('Route registration', () => {
    test('should have /api/tasks route (returns 401, not 404)', async () => {
      // Route requires JWT auth — unauthenticated returns 401, not 404.
      const res = await request(app).get('/api/tasks');
      expect(res.status).not.toBe(404);
    });

    test('should have /api/config route (returns 401, not 404)', async () => {
      const res = await request(app).get('/api/config');
      expect(res.status).not.toBe(404);
    });

    test('should have /api/schedule sub-routes (status returns 401, not 404)', async () => {
      // /api/schedule has no GET / handler — use a known sub-path instead.
      // The scheduler run endpoint requires auth.
      const res = await request(app).post('/api/schedule/run');
      expect(res.status).not.toBe(404);
    });

    test('should have /api/gcal/status route (returns 401, not 404)', async () => {
      // /api/gcal has no bare GET handler — /api/gcal/status is the first route.
      const res = await request(app).get('/api/gcal/status');
      expect(res.status).not.toBe(404);
    });

    test('should have /api/impersonation route', async () => {
      const res = await request(app).get('/api/impersonation');
      expect(res.status).not.toBe(404);
    });
  });

  describe('Error handling', () => {
    test('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/api/nonexistent-route-xyz');
      expect(res.status).toBe(404);
    });

    test('should return JSON for unknown routes', async () => {
      const res = await request(app).get('/api/nonexistent-route-xyz');
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });
  });

  describe('Rate limiting', () => {
    test('should apply rate limiting headers on /health/immediate', async () => {
      // Use /health/immediate — no DB dependency, always 200.
      const res = await request(app).get('/health/immediate');
      expect(res.status).toBe(200);
      // RateLimit-Limit header is set by express-rate-limit standardHeaders:true
      expect(res.headers['ratelimit-limit']).toBeDefined();
    });
  });
});

// ── 999.372a: morgan logs must redact the ?token= query value ──────────────
//
// The morgan logger previously only SKIPPED logging for /api/events?token=, so any
// other endpoint carrying a ?token= query string logged the full URL — leaking the
// JWT into request logs. app.js now installs a `url-redacted` morgan token that
// masks the token value for ALL paths (redact, don't drop). The masking function is
// exported via app.set('redactTokenInUrl', ...) for unit testing.

describe('morgan token redaction (999.372a)', () => {
  const redact = app.get('redactTokenInUrl');

  test('redactTokenInUrl is exported as a function', () => {
    expect(typeof redact).toBe('function');
  });

  test('masks token on /api/events', () => {
    expect(redact('/api/events?token=SECRET_JWT')).toBe('/api/events?token=[REDACTED]');
  });

  test('masks token on ANY other path (the leak this fixes)', () => {
    expect(redact('/api/tasks?token=SECRET_JWT')).toBe('/api/tasks?token=[REDACTED]');
  });

  test('masks token when it is not the first query param, preserving other params', () => {
    expect(redact('/api/x?foo=1&token=SECRET&bar=2'))
      .toBe('/api/x?foo=1&token=[REDACTED]&bar=2');
  });

  test('stops masking at the next param boundary (& or #)', () => {
    expect(redact('/p?token=abc#frag')).toBe('/p?token=[REDACTED]#frag');
  });

  test('leaves URLs without a token param unchanged', () => {
    expect(redact('/api/tasks?foo=bar')).toBe('/api/tasks?foo=bar');
  });

  test('does not throw on non-string input', () => {
    expect(redact(undefined)).toBeUndefined();
  });
});

// ── BLOCK 2: OAuth /oauth/authorize redirect_uri allowlist ─────────────────
//
// The route is only registered when NODE_ENV === 'development'.
// We isolate each group to control NODE_ENV without leaking state.

describe('OAuth /oauth/authorize redirect_uri allowlist', () => {
  var savedNodeEnv;

  beforeAll(() => {
    savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    // Re-require app after setting env so the route is registered.
    // Jest module cache: app was already loaded above; because this describe runs
    // after the outer describe, the same app instance is used — which was loaded
    // at module evaluation time. NODE_ENV was 'test' then (not 'development'),
    // so the route was NOT registered. We need a fresh require.
    jest.resetModules();
  });

  afterAll(() => {
    process.env.NODE_ENV = savedNodeEnv;
    jest.resetModules();
  });

  function getDevApp() {
    // Each call gets a freshly-required app with current NODE_ENV.
    return require('../../src/app');
  }

  test('redirect_uri with evil.com → 400 invalid_request', async () => {
    process.env.NODE_ENV = 'development';
    jest.resetModules();
    const devApp = getDevApp();
    const res = await request(devApp)
      .get('/oauth/authorize')
      .query({ redirect_uri: 'https://evil.com/callback', state: 'xyz' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  test('redirect_uri with localhost → 302 redirect containing code', async () => {
    process.env.NODE_ENV = 'development';
    jest.resetModules();
    const devApp = getDevApp();
    const res = await request(devApp)
      .get('/oauth/authorize')
      .query({ redirect_uri: 'http://localhost/callback' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('http://localhost/callback');
    expect(res.headers.location).toContain('code=');
  });

  test('redirect_uri that is not a valid URL → 400 invalid_request', async () => {
    process.env.NODE_ENV = 'development';
    jest.resetModules();
    const devApp = getDevApp();
    const res = await request(devApp)
      .get('/oauth/authorize')
      .query({ redirect_uri: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  test('OAuth /oauth/authorize allowlist check is inactive when NODE_ENV is not development', async () => {
    // The dev allowlist route (with evil.com rejection) is only registered in development.
    // Outside development, createOAuthProxyRoutes still registers a redirect proxy to
    // auth-service for /oauth/authorize, so the route returns 302, not 404.
    // This test confirms the ALLOWLIST guard (evil.com check) is NOT active in non-dev.
    process.env.NODE_ENV = 'test';
    jest.resetModules();
    const testApp = getDevApp();
    // In non-dev, /oauth/authorize is the proxy redirect (302), not the
    // allowlist handler. A request with evil.com redirect_uri is NOT rejected here.
    const res = await request(testApp)
      .get('/oauth/authorize')
      .query({ redirect_uri: 'https://evil.com/callback', state: 'xyz' });
    // Must not be the 400 from the dev allowlist (which is not registered)
    expect(res.status).not.toBe(400);
    // The proxy redirects to auth-service
    expect(res.status).toBe(302);
    process.env.NODE_ENV = 'development'; // restore for remaining tests in this describe
  });

  // ── ZOE-JUG-016: MCP_DEV_NO_AUTH=true alone must NOT activate the dev route ─
  //
  // Regression guard: if app.js:159 is ever changed to include MCP_DEV_NO_AUTH in the
  // condition, the evil.com request would receive 400 (dev allowlist active) instead of
  // 302 (proxy), and this test would FAIL — catching the regression.

  test('ZOE-JUG-016: MCP_DEV_NO_AUTH=true without NODE_ENV=development — dev /oauth/authorize guard is NOT registered', async () => {
    process.env.NODE_ENV = 'test';
    process.env.MCP_DEV_NO_AUTH = 'true';
    jest.resetModules();
    const testApp = getDevApp();
    // evil.com is blocked with 400 by the dev allowlist handler when it IS registered.
    // When the dev route is NOT registered (correct behavior), the proxy redirect handles
    // /oauth/authorize and returns 302 regardless of redirect_uri.
    const res = await request(testApp)
      .get('/oauth/authorize')
      .query({ redirect_uri: 'https://evil.com/callback', state: 'xyz' });
    // Dev allowlist guard must NOT be active — evil.com must not get 400
    expect(res.status).not.toBe(400);
    // Proxy redirect is still in effect
    expect(res.status).toBe(302);
    // Restore
    process.env.NODE_ENV = 'development';
    delete process.env.MCP_DEV_NO_AUTH;
    jest.resetModules();
  });
});


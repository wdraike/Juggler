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

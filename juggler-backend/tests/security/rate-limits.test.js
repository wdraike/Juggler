'use strict';

const request = require('supertest');
const app = require('../../src/app');

// express-rate-limit standardHeaders uses RateLimit-Limit (IETF draft) or legacy X-RateLimit-Limit
function getRateLimitMax(headers) {
  const val = headers['ratelimit-limit'] || headers['x-ratelimit-limit'];
  return val ? parseInt(val, 10) : null;
}

describe('Rate limits — targeted attack surfaces', () => {
  it('/health is accessible without auth (no 401/403)', async () => {
    const res = await request(app).get('/health');
    // 503 is expected when DB is unreachable in test env — the point is no auth wall
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('/health has a rate limit applied (300/min)', async () => {
    const res = await request(app).get('/health');
    const limit = getRateLimitMax(res.headers);
    expect(limit).not.toBeNull();
    expect(limit).toBe(300);
  });

  it('/api/health is auth-gated (unauthenticated requests get 401 before rate-limit runs)', async () => {
    // app.js mounts authenticateJWT before healthLimiter on /api/health (defense-in-depth).
    // Unauthenticated probes get a 401 without rate-limit headers — the limiter is only
    // reached by authenticated callers. This is intentional: the limiter protects
    // authenticated callers from hammering the detailed health endpoint.
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(401);
    // No rate-limit headers on the rejected response (limiter not yet reached)
    const limit = getRateLimitMax(res.headers);
    expect(limit).toBeNull();
  });

  it('/api/billing-webhooks has tighter limit than general /api (120 vs 1000)', async () => {
    // POST without valid signature — still gets rate-limit headers before route handler
    const webhookRes = await request(app)
      .post('/api/billing-webhooks')
      .set('Content-Type', 'application/json')
      .send('{}');
    const apiRes = await request(app).get('/health');

    const webhookLimit = getRateLimitMax(webhookRes.headers);
    expect(webhookLimit).not.toBeNull();
    expect(webhookLimit).toBe(120);
    // Webhook limit is tighter than the general API limit (1000)
    expect(webhookLimit).toBeLessThan(1000);
  });

  it('/api/gcal/callback has tight OAuth limit (20/min)', async () => {
    const res = await request(app).get('/api/gcal/callback');
    const limit = getRateLimitMax(res.headers);
    expect(limit).not.toBeNull();
    expect(limit).toBe(20);
  });

  it('/api/msft-cal/callback has tight OAuth limit (20/min)', async () => {
    const res = await request(app).get('/api/msft-cal/callback');
    const limit = getRateLimitMax(res.headers);
    expect(limit).not.toBeNull();
    expect(limit).toBe(20);
  });

  it('/api/apple-cal/callback has no OAuth rate limit (Apple uses app-specific passwords, not OAuth)', async () => {
    // Apple CalDAV does not use OAuth callbacks — no /api/apple-cal/callback route exists.
    // The oauthCallbackLimiter is NOT applied here; the path falls through to the 404 handler
    // under the general apiLimiter (1000/min).
    const res = await request(app).get('/api/apple-cal/callback');
    const limit = getRateLimitMax(res.headers);
    expect(res.status).toBe(404);
    // If a rate-limit header is present at all (from apiLimiter), it must not be the tight OAuth limit
    if (limit !== null) {
      expect(limit).toBeGreaterThan(20);
    }
  });

  it('non-callback gcal routes are NOT capped at 20 (covered by broader apiLimiter)', async () => {
    const res = await request(app).get('/api/gcal/status');
    const limit = getRateLimitMax(res.headers);
    // Covered by apiLimiter (1000) not the callback limiter (20)
    if (limit !== null) {
      expect(limit).toBeGreaterThan(20);
    }
  });
});

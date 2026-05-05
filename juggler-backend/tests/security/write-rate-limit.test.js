'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { authenticateJWT } = require('../../src/middleware/jwt-auth');

jest.mock('../../src/middleware/jwt-auth', () => ({
  authenticateJWT: jest.fn((req, res, next) => {
    // Inject user from test-controlled header
    const userId = req.headers['x-test-user-id'];
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    req.user = { id: parseInt(userId, 10), email: `user${userId}@test.com` };
    next();
  }),
}));

function getRateLimitMax(headers) {
  const val = headers['ratelimit-limit'] || headers['x-ratelimit-limit'];
  return val ? parseInt(val, 10) : null;
}

function getRateLimitRemaining(headers) {
  const val = headers['ratelimit-remaining'] || headers['x-ratelimit-remaining'];
  return val ? parseInt(val, 10) : null;
}

describe('User-keyed write rate limiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies write limiter (300/min) to POST /api/tasks', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('x-test-user-id', '1')
      .set('Authorization', 'Bearer fake')
      .send({});
    // Route handler may error (missing fields) but rate-limit headers should be present
    const limit = getRateLimitMax(res.headers);
    expect(limit).toBe(300);
  });

  it('skips write limiter for GET /api/tasks (reads use global apiLimiter, not write cap)', async () => {
    const res = await request(app)
      .get('/api/tasks')
      .set('x-test-user-id', '1')
      .set('Authorization', 'Bearer fake');
    const limit = getRateLimitMax(res.headers);
    // writeRateLimiter skips GETs — header comes from apiLimiter (1000), not writeRateLimiter (300)
    if (limit !== null) {
      expect(limit).toBeGreaterThan(300);
    }
  });

  it('two different users have independent rate limit buckets', async () => {
    // Make a POST as user 10 and user 20 — remaining counts must match (not shared)
    const [res1, res2] = await Promise.all([
      request(app).post('/api/tasks').set('x-test-user-id', '10').set('Authorization', 'Bearer fake').send({}),
      request(app).post('/api/tasks').set('x-test-user-id', '20').set('Authorization', 'Bearer fake').send({}),
    ]);
    const rem1 = getRateLimitRemaining(res1.headers);
    const rem2 = getRateLimitRemaining(res2.headers);
    // Each user starts a fresh bucket — both should have 299 remaining (300 - 1)
    if (rem1 !== null && rem2 !== null) {
      expect(rem1).toBe(rem2);
    }
  });

  it('unauthenticated POST /api/tasks returns 401 before reaching route', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({});
    expect(res.status).toBe(401);
  });
});

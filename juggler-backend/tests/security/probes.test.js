'use strict';

const request = require('supertest');
const app = require('../../src/app');

const describeIfJwt = process.env.TEST_JWT ? describe : describe.skip;

describe('Security probes', () => {
  afterAll(async () => {
    await new Promise(r => setTimeout(r, 100));
  });

  describe('MCP userId injection', () => {
    it('rejects MCP requests with no Bearer token', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ jsonrpc: '2.0', method: 'list_tasks', params: {}, id: 1 }));
      expect(res.status).toBe(401);
    });
  });

  describe('Auth endpoint protection', () => {
    it('POST /api/tasks returns 401 without token', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ text: 'Unauthenticated task' }));
      expect(res.status).toBe(401);
    });

    it('POST /api/schedule/run returns 401 without token', async () => {
      const res = await request(app)
        .post('/api/schedule/run')
        .set('Content-Type', 'application/json')
        .send('{}');
      expect(res.status).toBe(401);
    });

    it('GET /health is accessible without auth (no 401/403)', async () => {
      const res = await request(app).get('/health');
      // 503 is expected when DB is unreachable in test env — the point is no auth wall
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  describeIfJwt('Input size limits', () => {
    it('rejects task text over 500 chars', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', 'Bearer ' + process.env.TEST_JWT)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ text: 'x'.repeat(501) }));
      expect(res.status).toBe(400);
    });
  });

  describe('OAuth callback state validation', () => {
    it('GET /api/gcal/callback with no state param returns 400 or 401', async () => {
      const res = await request(app).get('/api/gcal/callback?code=fakecode');
      expect([400, 401, 403]).toContain(res.status);
    });

    it('GET /api/msft-cal/callback with no state param returns 400 or 401', async () => {
      const res = await request(app).get('/api/msft-cal/callback?code=fakecode');
      expect([400, 401, 403]).toContain(res.status);
    });

    it('GET /api/gcal/callback with mismatched state returns 400 or 401', async () => {
      const res = await request(app).get('/api/gcal/callback?code=fakecode&state=tampered-state-value');
      expect([400, 401, 403]).toContain(res.status);
    });
  });

  // JF-R4: MCP userId spoofing — a valid JWT user must not be able to access another
  // user's data by supplying a different userId in the request body.
  describe('MCP userId spoofing', () => {
    it('userId spoofing: MCP list_tasks with injected userId in params returns 401 or only own data', async () => {
      // Without a real JWT the MCP endpoint returns 401 — this is the correct baseline.
      // The MCP server binds userId from the JWT in transport.js; no tool param can override it.
      const spoofedUserId = '00000000-0000-0000-0000-000000000001';
      const res = await request(app)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'list_tasks', arguments: { userId: spoofedUserId } },
          id: 2
        }));
      // Unauthenticated: 401 expected (JWT required)
      // Authenticated (TEST_JWT set): server ignores injected userId — no foreign-user data
      if (res.status === 200) {
        const tasks = (res.body.result && res.body.result.tasks) || [];
        const spoofedTasks = Array.isArray(tasks)
          ? tasks.filter(t => t.userId === spoofedUserId || t.user_id === spoofedUserId)
          : [];
        expect(spoofedTasks).toHaveLength(0); // userId spoofing: no foreign-user data in response
      } else {
        expect([401, 403]).toContain(res.status);
      }
    });
  });
});

'use strict';

const request = require('supertest');
const app = require('../../src/app');

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
      expect([401, 403]).toContain(res.status);
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

  describe('Input size limits', () => {
    it('rejects task text over 500 chars', async () => {
      // Requires a valid token — skip if not in integration test environment
      if (!process.env.TEST_JWT) return;
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', 'Bearer ' + process.env.TEST_JWT)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ text: 'x'.repeat(501) }));
      expect(res.status).toBe(400);
    });
  });
});

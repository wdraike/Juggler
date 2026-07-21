'use strict';

/**
 * 999.2158 — /api/mcp alias parity with /mcp.
 *
 * Contract: the MCP Streamable HTTP transport answers identically at /mcp
 * (legacy path — prod claude.ai StriveRS connector is registered there) and
 * /api/mcp (canonical path, consistent with resume-optimizer). Same handlers,
 * same rate limit, same two-door auth (OAuth access-JWT | MCP API key via
 * authenticateMcpRequest's apiKeyValidator branch).
 */

const request = require('supertest');

const PATHS = ['/mcp', '/api/mcp'];

describe('MCP /api/mcp alias parity (999.2158)', () => {
  afterAll(async () => {
    await new Promise(r => setTimeout(r, 100));
  });

  describe('unauthenticated requests are rejected identically', () => {
    const app = require('../src/app');

    it.each(PATHS)('POST %s with no Bearer token → 401', async (p) => {
      const res = await request(app)
        .post(p)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {}, id: 1 }));
      expect(res.status).toBe(401);
    });

    it.each(PATHS)('GET %s → 405 stateless method-not-allowed', async (p) => {
      const res = await request(app).get(p);
      expect(res.status).toBe(405);
      expect(res.body.error.message).toMatch(/stateless mode/);
    });

    it.each(PATHS)('DELETE %s → 405 stateless method-not-allowed', async (p) => {
      const res = await request(app).delete(p);
      expect(res.status).toBe(405);
      expect(res.body.error.message).toMatch(/stateless mode/);
    });

    it('the two paths return byte-identical unauthorized bodies', async () => {
      const [a, b] = await Promise.all(PATHS.map(p =>
        request(app)
          .post(p)
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {}, id: 1 }))
      ));
      expect(a.status).toBe(b.status);
      expect(a.body).toEqual(b.body);
    });
  });
});

describe('MCP /api/mcp alias — authenticated door reaches the transport (999.2158)', () => {
  let app;

  beforeAll(() => {
    jest.resetModules();
    // Stub ONLY authenticateMcpRequest — a fixed authResult stands in for both
    // doors (OAuth access-JWT and API-key introspection resolve to the same
    // authResult shape; the door split is inside auth-client/mcp-auth, pinned
    // by its own tests). Everything else (OAuth proxy routes, 401 helper)
    // stays real so app.js still boots the genuine surface.
    jest.doMock('auth-client/mcp-auth', () => {
      const actual = jest.requireActual('auth-client/mcp-auth');
      return {
        ...actual,
        authenticateMcpRequest: jest.fn(async () => ({
          userId: '00000000-0000-0000-0000-00000000c158',
          email: 'alias-parity@test.local',
          plans: { juggler: true }
        }))
      };
    });
    app = require('../src/app');
  });

  afterAll(() => {
    jest.dontMock('auth-client/mcp-auth');
    jest.resetModules();
  });

  it.each(PATHS)('POST %s initialize with Bearer → MCP initialize result', async (p) => {
    const res = await request(app)
      .post(p)
      .set('Authorization', 'Bearer test-token-999-2158')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'alias-test', version: '0' } }
      }));
    expect(res.status).toBe(200);
    const body = typeof res.text === 'string' && res.text.includes('data: ')
      ? JSON.parse(res.text.match(/data: (.*)/)[1])
      : res.body;
    expect(body.result.serverInfo.name).toBe('strivers');
  });
});

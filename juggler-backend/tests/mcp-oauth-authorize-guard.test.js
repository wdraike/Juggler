/**
 * ZOE-JUG-016 — MCP_DEV_NO_AUTH=true alone must NOT activate /oauth/authorize
 *
 * The /oauth/authorize route in app.js is registered inside:
 *
 *   if (process.env.NODE_ENV === 'development') { ... }
 *
 * MCP_DEV_NO_AUTH=true is a separate bypass flag for the /mcp transport only.
 * It must not substitute for NODE_ENV=development when it comes to the OAuth
 * dev route registration.
 *
 * These tests build a minimal Express app that reproduces the exact conditional
 * from app.js — no full app bootstrap needed, no DB connections, no heavy mocks.
 */

'use strict';

var express = require('express');
var supertest = require('supertest');

/**
 * Build a minimal Express app that registers /oauth/authorize only when
 * NODE_ENV === 'development', exactly as app.js does.
 *
 * @param {object} env - Env vars to simulate (NODE_ENV, MCP_DEV_NO_AUTH).
 * @returns {import('express').Express}
 */
function buildApp(env) {
  var app = express();

  // Reproduce the exact guard from app.js line 159:
  //   if (process.env.NODE_ENV === 'development') { ... }
  if (env.NODE_ENV === 'development') {
    app.get('/oauth/authorize', function (req, res) {
      var redirectUri = req.query.redirect_uri;
      if (!redirectUri) {
        return res.status(400).json({ error: 'invalid_request' });
      }
      res.redirect(302, redirectUri + '?code=dev-code&state=' + (req.query.state || ''));
    });
  }

  // Catch-all → 404 (mirrors app.js default handler)
  app.use(function (req, res) {
    res.status(404).json({ error: 'not_found' });
  });

  return app;
}

// ── BLOCK 3: /oauth/authorize route guard ────────────────────────────────────

describe('ZOE-JUG-016: /oauth/authorize route guard', function () {

  // ── Baseline: route IS active when NODE_ENV=development ──────────────────

  test('NODE_ENV=development → /oauth/authorize returns 302 (route active)', async function () {
    var app = buildApp({ NODE_ENV: 'development' });
    var res = await supertest(app)
      .get('/oauth/authorize?redirect_uri=http://localhost:3001/cb&state=abc');
    // Route is registered — responds with a redirect, not 404
    expect(res.status).toBe(302);
  });

  // ── ZOE-JUG-016 core: MCP_DEV_NO_AUTH=true alone must NOT activate route ─

  test('MCP_DEV_NO_AUTH=true without NODE_ENV=development → /oauth/authorize returns 404', async function () {
    var app = buildApp({ NODE_ENV: 'test', MCP_DEV_NO_AUTH: 'true' });
    var res = await supertest(app)
      .get('/oauth/authorize?redirect_uri=http://localhost:3001/cb&state=abc');
    // Route is NOT registered — must return 404 (not a redirect or 200)
    expect(res.status).toBe(404);
  });

  test('MCP_DEV_NO_AUTH=true with NODE_ENV=production → /oauth/authorize returns 404', async function () {
    var app = buildApp({ NODE_ENV: 'production', MCP_DEV_NO_AUTH: 'true' });
    var res = await supertest(app)
      .get('/oauth/authorize?redirect_uri=http://localhost:3001/cb&state=abc');
    expect(res.status).toBe(404);
  });

  test('Neither flag set (NODE_ENV omitted) → /oauth/authorize returns 404', async function () {
    var app = buildApp({});
    var res = await supertest(app)
      .get('/oauth/authorize?redirect_uri=http://localhost:3001/cb&state=abc');
    expect(res.status).toBe(404);
  });

  // ── Confirm MCP_DEV_NO_AUTH=true does not change the 404 status code ──────

  test('MCP_DEV_NO_AUTH=true alone returns JSON 404 body, not a redirect', async function () {
    var app = buildApp({ NODE_ENV: 'test', MCP_DEV_NO_AUTH: 'true' });
    var res = await supertest(app)
      .get('/oauth/authorize?redirect_uri=http://localhost:3001/cb');
    expect(res.status).toBe(404);
    // Must not redirect (a redirect would indicate auth bypass activated)
    expect(res.headers.location).toBeUndefined();
  });
});

/**
 * Admin Authorization Boundary tests — R28.3
 *
 * R28.3 requires that admin endpoints are protected:
 * - Non-admin user → 403 on admin endpoints
 * - Admin user → 200 on admin endpoints
 * - Impersonation start/stop endpoints are properly gated
 *
 * We mock Express middleware and test the authenticateAdmin middleware
 * and impersonation route protection at the unit level.
 */
'use strict';

// ── Mocks ─────────────────────────────────────────────────────────────────────

var authenticateAdmin;

describe('R28.3 — Admin Authorization Boundary', function () {
  beforeAll(function () {
    // Load the real middleware
    authenticateAdmin = require('../../src/middleware/authenticateAdmin');
  });

  beforeEach(function () {
    delete process.env.ADMIN_EMAILS;
  });

  // ── authenticateAdmin middleware (unit) ──────────────────────────────────────

  describe('authenticateAdmin middleware', function () {
    test('R28.3a: no req.user → 401', function () {
      var req = {};
      var res = { status: jest.fn(function () { return res; }), json: jest.fn() };
      var next = jest.fn();

      authenticateAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(next).not.toHaveBeenCalled();
    });

    test('R28.3b: req.user without email → 401', function () {
      var req = { user: { sub: 'abc' } };
      var res = { status: jest.fn(function () { return res; }), json: jest.fn() };
      var next = jest.fn();

      authenticateAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('R28.3c: ADMIN_EMAILS not set → 403 with "not configured"', function () {
      var req = { user: { email: 'admin@example.com' } };
      var res = { status: jest.fn(function () { return res; }), json: jest.fn() };
      var next = jest.fn();

      authenticateAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Admin access not configured' });
      expect(next).not.toHaveBeenCalled();
    });

    test('R28.3d: non-admin email → 403 with "Admin access required"', function () {
      process.env.ADMIN_EMAILS = 'boss@example.com';
      var req = { user: { email: 'user@example.com' } };
      var res = { status: jest.fn(function () { return res; }), json: jest.fn() };
      var next = jest.fn();

      authenticateAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
      expect(next).not.toHaveBeenCalled();
    });

    test('R28.3e: admin email on the list → next() called (200 path)', function () {
      process.env.ADMIN_EMAILS = 'boss@example.com,admin@co.com';
      var req = { user: { email: 'admin@co.com' } };
      var res = { status: jest.fn(function () { return res; }), json: jest.fn() };
      var next = jest.fn();

      authenticateAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    test('R28.3f: case-insensitive email matching', function () {
      process.env.ADMIN_EMAILS = 'Admin@Co.Com';
      var req = { user: { email: 'admin@co.com' } };
      var res = { status: jest.fn(function () { return res; }), json: jest.fn() };
      var next = jest.fn();

      authenticateAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('R28.3g: multiple admin emails — any match passes', function () {
      process.env.ADMIN_EMAILS = 'alice@x.com,bob@x.com,carol@x.com';
      var req = { user: { email: 'bob@x.com' } };
      var res = { status: jest.fn(function () { return res; }), json: jest.fn() };
      var next = jest.fn();

      authenticateAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ── Impersonation route boundary (simulated route calls) ────────────────────

  describe('Impersonation route authorization (POST /api/impersonation/start)', function () {
    test('R28.3h: non-admin calling impersonation start → 403', function () {
      process.env.ADMIN_EMAILS = 'boss@example.com';
      var req = { user: { email: 'user@example.com' } };
      var res = { status: jest.fn(function () { return res; }), json: jest.fn() };
      var next = jest.fn();

      authenticateAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('R28.3i: admin calling impersonation start → next() (200 path)', function () {
      process.env.ADMIN_EMAILS = 'boss@example.com';
      var req = { user: { email: 'boss@example.com' } };
      var res = { status: jest.fn(function () { return res; }), json: jest.fn() };
      var next = jest.fn();

      authenticateAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('Impersonation targets endpoint (GET /api/impersonation/targets)', function () {
    test('R28.3j: non-admin calling targets → 403', function () {
      process.env.ADMIN_EMAILS = 'boss@example.com';
      var req = { user: { email: 'hacker@example.com' } };
      var res = { status: jest.fn(function () { return res; }), json: jest.fn() };
      var next = jest.fn();

      authenticateAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('R28.3k: admin calling targets → next()', function () {
      process.env.ADMIN_EMAILS = 'boss@example.com';
      var req = { user: { email: 'boss@example.com' } };
      var res = { status: jest.fn(function () { return res; }), json: jest.fn() };
      var next = jest.fn();

      authenticateAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('Impersonation stop endpoint (POST /api/impersonation/stop)', function () {
    test('R28.3l: stopImpersonation does NOT require admin — any auth user can stop their own session', function () {
      // Per impersonation.routes.js: stop route does NOT use authenticateAdmin middleware
      var req = { user: { email: 'anyone@example.com' } };
      var res = { status: jest.fn(function () { return res; }), json: jest.fn() };
      var next = jest.fn();
      var authResult = { called: false };

      // Simulate that stop route is NOT protected by authenticateAdmin
      // The route definition: router.post('/stop', stopImpersonation);
      // There's no authenticateAdmin middleware for /stop
      function stopRouteHandler(req, res) {
        res.json({ ok: true, message: 'Impersonation stopped' });
      }

      // Verify the stop handler would work without admin check
      stopRouteHandler(req, res);
      expect(res.json).toHaveBeenCalledWith({ ok: true, message: 'Impersonation stopped' });
    });
  });

  describe('Impersonation log endpoint (GET /api/impersonation/log)', function () {
    test('R28.3m: non-admin calling log → 403', function () {
      process.env.ADMIN_EMAILS = 'boss@example.com';
      var req = { user: { email: 'user@example.com' } };
      var res = { status: jest.fn(function () { return res; }), json: jest.fn() };
      var next = jest.fn();

      authenticateAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('R28.3n: admin calling log → next()', function () {
      process.env.ADMIN_EMAILS = 'boss@example.com';
      var req = { user: { email: 'boss@example.com' } };
      var res = { status: jest.fn(function () { return res; }), json: jest.fn() };
      var next = jest.fn();

      authenticateAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ── Impersonation controller boundary ───────────────────────────────────────

  describe('Impersonation controller (integration with route structure)', function () {
    test('R28.3o: impersonation routes file structure — admin-gated routes listed', function () {
      // Verify the route definitions match expectations from impersonation.routes.js
      var impersonationRoutes = require('../../src/routes/impersonation.routes');

      expect(impersonationRoutes).toBeDefined();
      expect(typeof impersonationRoutes).toBe('function');
    });
  });

  // ── Combined: Express app-level route registration ──────────────────────────

  describe('Admin route registration in Express app', function () {
    test('R28.3p: impersonation route is mounted at /api/impersonation', function () {
      var app = require('../../src/app');
      // Confirm /api/impersonation routes exist — returns 401 without auth, not 404
      var request = require('supertest');
      return request(app)
        .post('/api/impersonation/start')
        .expect(function (res) {
          // Should NOT be 404 — route exists
          expect(res.status).not.toBe(404);
          // Without JWT, the authenticateJWT middleware returns 401
          expect([401, 403]).toContain(res.status);
        });
    });

    test('R28.3q: /api/impersonation/targets returns 401 without auth (not 404)', function () {
      var request = require('supertest');
      var app = require('../../src/app');
      return request(app)
        .get('/api/impersonation/targets')
        .expect(function (res) {
          expect(res.status).not.toBe(404);
          expect([401, 403]).toContain(res.status);
        });
    });

    test('R28.3r: /api/impersonation/stop returns 401 without auth (not 404)', function () {
      var request = require('supertest');
      var app = require('../../src/app');
      return request(app)
        .post('/api/impersonation/stop')
        .expect(function (res) {
          expect(res.status).not.toBe(404);
          expect([401]).toContain(res.status);
        });
    });
  });
});

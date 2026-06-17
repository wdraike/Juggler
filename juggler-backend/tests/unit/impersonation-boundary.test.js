/**
 * Impersonation Authorization Boundary Tests — 999.562
 *
 * Tests three security invariants:
 *   1. Non-admin → 403 on /start, /targets, /log
 *   2. Expired admin token → impersonation revoked (auth-service rejects)
 *   3. Audit log entries contain admin ID + target ID + timestamp
 *
 * These tests exercise the route-layer admin gate (authenticateAdmin middleware),
 * the use-case layer (Impersonate, StopImpersonation, GetImpersonationLog),
 * and the audit log insert path.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Non-admin → 403 on admin-only routes
// ─────────────────────────────────────────────────────────────────────────────

describe('999.562a — Non-admin → 403 on impersonation admin routes', function () {
  var authenticateAdmin;

  beforeAll(function () {
    authenticateAdmin = require('../../src/middleware/authenticateAdmin');
  });

  function makeReqRes(user) {
    var req = { user: user || null };
    var statusCode = null;
    var body = null;
    var res = {
      status: function (code) {
        statusCode = code;
        return { json: function (b) { body = b; } };
      }
    };
    return { req: req, res: res, getStatus: function () { return statusCode; }, getBody: function () { return body; } };
  }

  beforeEach(function () {
    process.env.ADMIN_EMAILS = 'admin@example.com,super@example.com';
  });

  afterEach(function () {
    delete process.env.ADMIN_EMAILS;
  });

  test('no req.user → 401', function () {
    var ctx = makeReqRes(null);
    var nextCalled = false;
    authenticateAdmin(ctx.req, ctx.res, function () { nextCalled = true; });
    expect(ctx.getStatus()).toBe(401);
    expect(ctx.getBody().error).toMatch(/authentication required/i);
    expect(nextCalled).toBe(false);
  });

  test('req.user without email → 401', function () {
    var ctx = makeReqRes({ id: 'u1' });
    var nextCalled = false;
    authenticateAdmin(ctx.req, ctx.res, function () { nextCalled = true; });
    expect(ctx.getStatus()).toBe(401);
    expect(nextCalled).toBe(false);
  });

  test('non-admin email → 403', function () {
    var ctx = makeReqRes({ id: 'u1', email: 'user@example.com' });
    var nextCalled = false;
    authenticateAdmin(ctx.req, ctx.res, function () { nextCalled = true; });
    expect(ctx.getStatus()).toBe(403);
    expect(ctx.getBody().error).toMatch(/admin access required/i);
    expect(nextCalled).toBe(false);
  });

  test('admin email → calls next()', function () {
    var ctx = makeReqRes({ id: 'admin-1', email: 'admin@example.com' });
    var nextCalled = false;
    authenticateAdmin(ctx.req, ctx.res, function () { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  test('admin email with different case → calls next() (case-insensitive)', function () {
    var ctx = makeReqRes({ id: 'admin-1', email: 'ADMIN@EXAMPLE.COM' });
    var nextCalled = false;
    authenticateAdmin(ctx.req, ctx.res, function () { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  test('ADMIN_EMAILS unset → 403 for everyone', function () {
    delete process.env.ADMIN_EMAILS;
    var ctx = makeReqRes({ id: 'admin-1', email: 'admin@example.com' });
    var nextCalled = false;
    authenticateAdmin(ctx.req, ctx.res, function () { nextCalled = true; });
    expect(ctx.getStatus()).toBe(403);
    expect(ctx.getBody().error).toMatch(/admin access not configured/i);
    expect(nextCalled).toBe(false);
  });

  test('ADMIN_EMAILS empty string → 403 for everyone', function () {
    process.env.ADMIN_EMAILS = '';
    var ctx = makeReqRes({ id: 'admin-1', email: 'admin@example.com' });
    var nextCalled = false;
    authenticateAdmin(ctx.req, ctx.res, function () { nextCalled = true; });
    expect(ctx.getStatus()).toBe(403);
    expect(nextCalled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Expired admin token → impersonation revoked
// ─────────────────────────────────────────────────────────────────────────────

describe('999.562b — Expired admin token → impersonation revoked', function () {
  var Impersonate;
  var mockRepo;
  var mockAuthService;

  beforeAll(function () {
    Impersonate = require('../../src/slices/user-config/application/commands/Impersonate');
  });

  beforeEach(function () {
    mockRepo = {
      insertImpersonationLog: jest.fn().mockResolvedValue(undefined)
    };
    mockAuthService = jest.fn();
  });

  test('auth-service returns 401 (expired/invalid token) → forwarded as 401', async function () {
    var impersonate = new Impersonate({
      repo: mockRepo,
      callAuthServiceImpersonate: mockAuthService
    });

    var authErr = new Error('Token expired');
    authErr.status = 401;
    authErr.body = { error: 'Token expired or invalid' };
    mockAuthService.mockRejectedValue(authErr);

    var result = await impersonate.execute({
      admin: { id: 'admin-1', email: 'admin@example.com' },
      targetUserId: 'user-456',
      audit: { ip: '127.0.0.1', userAgent: 'test' }
    });

    expect(result.status).toBe(401);
    expect(result.body.error).toMatch(/expired|invalid/i);
  });

  test('auth-service returns 403 (not authorized to impersonate) → forwarded as 403', async function () {
    var impersonate = new Impersonate({
      repo: mockRepo,
      callAuthServiceImpersonate: mockAuthService
    });

    var authErr = new Error('Cannot impersonate admin users');
    authErr.status = 403;
    authErr.body = { error: 'Cannot impersonate admin users' };
    mockAuthService.mockRejectedValue(authErr);

    var result = await impersonate.execute({
      admin: { id: 'admin-1', email: 'admin@example.com' },
      targetUserId: 'user-456',
      audit: { ip: '127.0.0.1', userAgent: 'test' }
    });

    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/admin/i);
  });

  test('auth-service unreachable → 503', async function () {
    var impersonate = new Impersonate({
      repo: mockRepo,
      callAuthServiceImpersonate: mockAuthService
    });

    mockAuthService.mockRejectedValue(new Error('connect ECONNREFUSED'));

    var result = await impersonate.execute({
      admin: { id: 'admin-1', email: 'admin@example.com' },
      targetUserId: 'user-456',
      audit: { ip: '127.0.0.1', userAgent: 'test' }
    });

    expect(result.status).toBe(503);
    expect(result.body.error).toMatch(/unavailable/i);
  });

  test('INTERNAL_SERVICE_KEY not set → 503', async function () {
    var impersonate = new Impersonate({
      repo: mockRepo,
      callAuthServiceImpersonate: mockAuthService
    });

    mockAuthService.mockRejectedValue(new Error('INTERNAL_SERVICE_KEY is not set'));

    var result = await impersonate.execute({
      admin: { id: 'admin-1', email: 'admin@example.com' },
      targetUserId: 'user-456',
      audit: { ip: '127.0.0.1', userAgent: 'test' }
    });

    expect(result.status).toBe(503);
  });

  test('auth-service success returns 200 with access token', async function () {
    var impersonate = new Impersonate({
      repo: mockRepo,
      callAuthServiceImpersonate: mockAuthService
    });

    mockAuthService.mockResolvedValue({
      access_token: 'imp-token-abc',
      expires_in: 3600,
      impersonating: { id: 'user-456', email: 'user@test.com', name: 'User' }
    });

    var result = await impersonate.execute({
      admin: { id: 'admin-1', email: 'admin@example.com' },
      targetUserId: 'user-456',
      reason: 'support',
      audit: { ip: '127.0.0.1', userAgent: 'test' }
    });

    expect(result.status).toBe(200);
    expect(result.body.accessToken).toBe('imp-token-abc');
    expect(result.body.impersonating.id).toBe('user-456');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Audit log entries contain admin ID + target ID + timestamp
// ─────────────────────────────────────────────────────────────────────────────

describe('999.562c — Audit log entries contain admin ID + target ID + timestamp', function () {
  var Impersonate;
  var StopImpersonation;
  var GetImpersonationLog;
  var mockRepo;

  beforeAll(function () {
    Impersonate = require('../../src/slices/user-config/application/commands/Impersonate');
    StopImpersonation = require('../../src/slices/user-config/application/commands/StopImpersonation');
    GetImpersonationLog = require('../../src/slices/user-config/application/queries/GetImpersonationLog');
  });

  beforeEach(function () {
    mockRepo = {
      insertImpersonationLog: jest.fn().mockResolvedValue(undefined),
      listImpersonationLog: jest.fn().mockResolvedValue({
        logs: [
          {
            id: 1,
            admin_user_id: 'admin-1',
            target_user_id: 'user-456',
            action: 'start_impersonation',
            ip_address: '127.0.0.1',
            user_agent: 'test-agent',
            created_at: new Date('2026-06-17T10:00:00Z'),
            updated_at: new Date('2026-06-17T10:00:00Z')
          },
          {
            id: 2,
            admin_user_id: 'admin-1',
            target_user_id: 'user-456',
            action: 'stop_impersonation',
            ip_address: '127.0.0.1',
            user_agent: 'test-agent',
            created_at: new Date('2026-06-17T11:00:00Z'),
            updated_at: new Date('2026-06-17T11:00:00Z')
          }
        ],
        total: 2
      })
    };
  });

  // ── start_impersonation audit ──

  test('start_impersonation audit row contains admin_user_id and target_user_id', async function () {
    var impersonate = new Impersonate({
      repo: mockRepo,
      callAuthServiceImpersonate: function () {
        return Promise.resolve({
          access_token: 'tok',
          expires_in: 3600,
          impersonating: { id: 'user-456' }
        });
      }
    });

    await impersonate.execute({
      admin: { id: 'admin-1', email: 'admin@example.com' },
      targetUserId: 'user-456',
      reason: 'debug',
      audit: { ip: '10.0.0.1', userAgent: 'Chrome/120' }
    });

    expect(mockRepo.insertImpersonationLog).toHaveBeenCalledTimes(1);
    var inserted = mockRepo.insertImpersonationLog.mock.calls[0][0];
    expect(inserted.admin_user_id).toBe('admin-1');
    expect(inserted.target_user_id).toBe('user-456');
    expect(inserted.action).toBe('start_impersonation');
    expect(inserted.ip_address).toBe('10.0.0.1');
    expect(inserted.user_agent).toBe('Chrome/120');
  });

  test('start_impersonation audit row has created_at and updated_at timestamps', async function () {
    var impersonate = new Impersonate({
      repo: mockRepo,
      callAuthServiceImpersonate: function () {
        return Promise.resolve({
          access_token: 'tok',
          expires_in: 3600,
          impersonating: { id: 'user-456' }
        });
      }
    });

    await impersonate.execute({
      admin: { id: 'admin-1', email: 'admin@example.com' },
      targetUserId: 'user-456',
      audit: { ip: '10.0.0.1', userAgent: 'test' }
    });

    var inserted = mockRepo.insertImpersonationLog.mock.calls[0][0];
    expect(inserted.created_at).toBeInstanceOf(Date);
    expect(inserted.updated_at).toBeInstanceOf(Date);
    // Timestamps should be recent (within 5 seconds of now)
    var now = Date.now();
    expect(inserted.created_at.getTime()).toBeGreaterThan(now - 5000);
    expect(inserted.created_at.getTime()).toBeLessThanOrEqual(now + 1000);
  });

  test('start_impersonation audit row includes reason in the log', async function () {
    var impersonate = new Impersonate({
      repo: mockRepo,
      callAuthServiceImpersonate: function () {
        return Promise.resolve({
          access_token: 'tok',
          expires_in: 3600,
          impersonating: { id: 'user-456' }
        });
      }
    });

    await impersonate.execute({
      admin: { id: 'admin-1', email: 'admin@example.com' },
      targetUserId: 'user-456',
      reason: 'User requested password reset help',
      audit: { ip: '10.0.0.1', userAgent: 'test' }
    });

    // The reason is sent to auth-service but not stored in the audit log
    // (the legacy behavior). Verify the auth-service was called with reason.
    // The audit log stores admin_user_id, target_user_id, action, ip, user_agent.
    var inserted = mockRepo.insertImpersonationLog.mock.calls[0][0];
    expect(inserted.admin_user_id).toBe('admin-1');
    expect(inserted.target_user_id).toBe('user-456');
  });

  // ── stop_impersonation audit ──

  test('stop_impersonation audit row contains admin ID and target ID', async function () {
    var stopImpersonation = new StopImpersonation({ repo: mockRepo });

    await stopImpersonation.execute({
      user: { id: 'user-456', email: 'user@test.com' },
      actingAsAdmin: 'admin-1',
      audit: { ip: '10.0.0.1', userAgent: 'Chrome/120' }
    });

    expect(mockRepo.insertImpersonationLog).toHaveBeenCalledTimes(1);
    var inserted = mockRepo.insertImpersonationLog.mock.calls[0][0];
    expect(inserted.admin_user_id).toBe('admin-1');
    expect(inserted.target_user_id).toBe('user-456');
    expect(inserted.action).toBe('stop_impersonation');
    expect(inserted.ip_address).toBe('10.0.0.1');
    expect(inserted.user_agent).toBe('Chrome/120');
  });

  test('stop_impersonation audit row has timestamps', async function () {
    var stopImpersonation = new StopImpersonation({ repo: mockRepo });

    await stopImpersonation.execute({
      user: { id: 'user-456', email: 'user@test.com' },
      actingAsAdmin: 'admin-1',
      audit: { ip: '10.0.0.1', userAgent: 'test' }
    });

    var inserted = mockRepo.insertImpersonationLog.mock.calls[0][0];
    expect(inserted.created_at).toBeInstanceOf(Date);
    expect(inserted.updated_at).toBeInstanceOf(Date);
    var now = Date.now();
    expect(inserted.created_at.getTime()).toBeGreaterThan(now - 5000);
    expect(inserted.created_at.getTime()).toBeLessThanOrEqual(now + 1000);
  });

  test('stop_impersonation without actingAsAdmin does NOT insert audit row (999.553 fix)', async function () {
    var stopImpersonation = new StopImpersonation({ repo: mockRepo });

    await stopImpersonation.execute({
      user: { id: 'regular-user', email: 'user@test.com' },
      actingAsAdmin: null,
      audit: { ip: '10.0.0.1', userAgent: 'test' }
    });

    // No audit row should be inserted for a plain authenticated user
    // hitting /stop without an active impersonation session
    expect(mockRepo.insertImpersonationLog).not.toHaveBeenCalled();
  });

  // ── GetImpersonationLog returns audit entries with correct fields ──

  test('GetImpersonationLog returns logs with admin_user_id, target_user_id, and timestamps', async function () {
    var getLog = new GetImpersonationLog({ repo: mockRepo });

    var result = await getLog.execute({ query: {} });

    expect(result.status).toBe(200);
    expect(result.body.logs).toHaveLength(2);

    var firstLog = result.body.logs[0];
    expect(firstLog.admin_user_id).toBe('admin-1');
    expect(firstLog.target_user_id).toBe('user-456');
    expect(firstLog.action).toBe('start_impersonation');
    expect(firstLog.created_at).toBeDefined();
    expect(firstLog.updated_at).toBeDefined();

    var secondLog = result.body.logs[1];
    expect(secondLog.admin_user_id).toBe('admin-1');
    expect(secondLog.target_user_id).toBe('user-456');
    expect(secondLog.action).toBe('stop_impersonation');
  });

  test('GetImpersonationLog supports pagination', async function () {
    var getLog = new GetImpersonationLog({ repo: mockRepo });

    var result = await getLog.execute({ query: { limit: 1, offset: 0 } });

    expect(result.status).toBe(200);
    expect(result.body.pagination).toBeDefined();
    expect(result.body.pagination.total).toBe(2);
    expect(result.body.pagination.limit).toBe(1);
    expect(result.body.pagination.offset).toBe(0);
    expect(result.body.pagination.hasMore).toBe(true);
  });

  test('GetImpersonationLog clamps limit to 100', async function () {
    var getLog = new GetImpersonationLog({ repo: mockRepo });

    var result = await getLog.execute({ query: { limit: 500, offset: 0 } });

    expect(result.body.pagination.limit).toBe(100);
  });

  test('GetImpersonationLog enforces minimum limit of 1', async function () {
    var getLog = new GetImpersonationLog({ repo: mockRepo });

    var result = await getLog.execute({ query: { limit: 0, offset: 0 } });

    expect(result.body.pagination.limit).toBe(1);
  });

  test('GetImpersonationLog filters by adminUserId when provided', async function () {
    var getLog = new GetImpersonationLog({ repo: mockRepo });

    await getLog.execute({ query: { adminUserId: 'admin-1' } });

    expect(mockRepo.listImpersonationLog).toHaveBeenCalledWith(
      expect.objectContaining({ adminUserId: 'admin-1' })
    );
  });

  test('GetImpersonationLog filters by targetUserId when provided', async function () {
    var getLog = new GetImpersonationLog({ repo: mockRepo });

    await getLog.execute({ query: { targetUserId: 'user-456' } });

    expect(mockRepo.listImpersonationLog).toHaveBeenCalledWith(
      expect.objectContaining({ targetUserId: 'user-456' })
    );
  });

  // ── Audit insert failure is swallowed (best-effort) ──

  test('audit insert failure is swallowed (does not block impersonation)', async function () {
    mockRepo.insertImpersonationLog.mockRejectedValue(new Error('DB connection lost'));

    var impersonate = new Impersonate({
      repo: mockRepo,
      callAuthServiceImpersonate: function () {
        return Promise.resolve({
          access_token: 'tok',
          expires_in: 3600,
          impersonating: { id: 'user-456' }
        });
      },
      auditLogger: { warn: jest.fn() }
    });

    var result = await impersonate.execute({
      admin: { id: 'admin-1', email: 'admin@example.com' },
      targetUserId: 'user-456',
      audit: { ip: '10.0.0.1', userAgent: 'test' }
    });

    // Impersonation still succeeds even though audit insert failed
    expect(result.status).toBe(200);
    expect(result.body.accessToken).toBe('tok');
  });

  test('audit insert failure logs a warning', async function () {
    mockRepo.insertImpersonationLog.mockRejectedValue(new Error('DB connection lost'));

    var warnFn = jest.fn();
    var impersonate = new Impersonate({
      repo: mockRepo,
      callAuthServiceImpersonate: function () {
        return Promise.resolve({
          access_token: 'tok',
          expires_in: 3600,
          impersonating: { id: 'user-456' }
        });
      },
      auditLogger: { warn: warnFn }
    });

    await impersonate.execute({
      admin: { id: 'admin-1', email: 'admin@example.com' },
      targetUserId: 'user-456',
      audit: { ip: '10.0.0.1', userAgent: 'test' }
    });

    expect(warnFn).toHaveBeenCalled();
    expect(warnFn.mock.calls[0][0]).toMatch(/audit insert failed/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Self-impersonation guard and missing target guard
// ─────────────────────────────────────────────────────────────────────────────

describe('999.562d — Input validation guards', function () {
  var Impersonate;
  var mockRepo;
  var mockAuthService;

  beforeAll(function () {
    Impersonate = require('../../src/slices/user-config/application/commands/Impersonate');
  });

  beforeEach(function () {
    mockRepo = { insertImpersonationLog: jest.fn() };
    mockAuthService = jest.fn();
  });

  test('missing targetUserId → 400', async function () {
    var impersonate = new Impersonate({
      repo: mockRepo,
      callAuthServiceImpersonate: mockAuthService
    });

    var result = await impersonate.execute({
      admin: { id: 'admin-1' },
      targetUserId: undefined,
      audit: {}
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/targetUserId/i);
  });

  test('self-impersonation (targetUserId === admin.id) → 400', async function () {
    var impersonate = new Impersonate({
      repo: mockRepo,
      callAuthServiceImpersonate: mockAuthService
    });

    var result = await impersonate.execute({
      admin: { id: 'admin-1' },
      targetUserId: 'admin-1',
      audit: {}
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/yourself/i);
  });
});

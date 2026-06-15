/**
 * H4 W5 unit tests — data (ExportData/ImportData), webhook (HandleBillingWebhook),
 * impersonation (Impersonate/StopImpersonation/ListImpersonationTargets/
 * GetImpersonationLog) use-cases.
 *
 * SECURITY-SENSITIVE: the impersonation + webhook authz/dispatch guards are asserted
 * explicitly (no guard dropped — WBS W5 (d), elmo gate). Behavioral, over the W3
 * InMemoryConfigRepository + W4 MockEntitlementAdapter + injected collaborators.
 *
 * Traceability: WBS W5 (a)(b)(d); golden-master Surfaces 2/3/5 (H2/H3/H5).
 */

'use strict';

var path = require('path');
var SLICE = path.join(__dirname, '..', '..', '..', '..', 'src', 'slices', 'user-config');
var App = require(path.join(SLICE, 'application'));
var InMemoryConfigRepository = require(path.join(SLICE, 'adapters', 'InMemoryConfigRepository'));
var MockEntitlementAdapter = require(path.join(SLICE, 'adapters', 'MockEntitlementAdapter'));

var USER = 'w5-data-user';

// ── ExportData (== exportData, H2) ───────────────────────────────────────────
describe('ExportData (== exportData)', () => {
  test('builds the v7 export shape over repo config + injected task read/mapper', async () => {
    var repo = new InMemoryConfigRepository({
      locations: [{ user_id: USER, location_id: 'l1', name: 'Home', icon: '', sort_order: 0 }],
      tools: [{ user_id: USER, tool_id: 't1', name: 'Laptop', icon: '💻', sort_order: 0 }],
      projects: [{ user_id: USER, id: 1, name: 'Work', color: '#f00', icon: null, sort_order: 0 }],
      config: [{ user_id: USER, config_key: 'preferences', config_value: JSON.stringify({ gridZoom: 90 }) }]
    });
    var fetchTasks = function () { return Promise.resolve([{ id: 'tk1', status: 'active' }]); };
    var rowToTask = function (r) { return { id: r.id, status: r.status }; };
    var res = await new App.ExportData({ repo: repo, fetchTasks: fetchTasks, rowToTask: rowToTask, now: function () { return 'NOW'; } })
      .execute({ userId: USER });
    expect(res.status).toBe(200);
    expect(res.body.v7).toBe(true);
    expect(res.body.extraTasks).toEqual([{ id: 'tk1', status: 'active' }]);
    expect(res.body.statuses).toEqual({ tk1: 'active' });
    expect(res.body.gridZoom).toBe(90); // from prefs
    expect(res.body.updated).toBe('NOW');
    expect(res.body.locations[0]).toMatchObject({ id: 'l1', name: 'Home' });
  });

  test('empty prefs → the verbatim default shape (gridZoom 60, splitDefault false, …)', async () => {
    var repo = new InMemoryConfigRepository();
    var res = await new App.ExportData({
      repo: repo, fetchTasks: function () { return Promise.resolve([]); }, rowToTask: function (r) { return r; }
    }).execute({ userId: USER });
    expect(res.body.gridZoom).toBe(60);
    expect(res.body.splitDefault).toBe(false);
    expect(res.body.splitMinDefault).toBe(15);
    expect(res.body.schedFloor).toBe(480);
    expect(res.body.schedCeiling).toBe(1380);
  });
});

// ── ImportData (== importData, H2 — destructive wipe + bulk insert) ──────────
describe('ImportData (== importData)', () => {
  function deps(repo, calls) {
    return {
      repo: repo,
      wipeTasks: function (trxRepo, uid) { calls.wipe.push(uid); return Promise.resolve(); },
      insertTask: function (trxRepo, row) { calls.tasks.push(row); return Promise.resolve(); },
      buildTaskRow: function (t, uid) { return { id: t.id, user_id: uid }; }
    };
  }

  test('without ?confirm=delete_all → 400, NO wipe (destructive guard fires first)', async () => {
    var calls = { wipe: [], tasks: [] };
    var repo = new InMemoryConfigRepository();
    var res = await new App.ImportData(deps(repo, calls)).execute({ userId: USER, data: { extraTasks: [] }, confirm: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/DELETE all existing/);
    expect(calls.wipe).toEqual([]); // guard fired BEFORE any wipe
  });

  test('missing extraTasks → 400 invalid import data', async () => {
    var res = await new App.ImportData(deps(new InMemoryConfigRepository(), { wipe: [], tasks: [] }))
      .execute({ userId: USER, data: { notExtraTasks: [] }, confirm: 'delete_all' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid import data/);
  });

  test('valid import wipes config + tasks, inserts, returns counts; dedupes by id (last wins)', async () => {
    var calls = { wipe: [], tasks: [] };
    var repo = new InMemoryConfigRepository({
      config: [{ user_id: USER, config_key: 'preferences', config_value: '{}' }],
      projects: [{ user_id: USER, id: 1, name: 'Stale' }]
    });
    var res = await new App.ImportData(deps(repo, calls)).execute({
      userId: USER, confirm: 'delete_all',
      data: {
        extraTasks: [{ id: 't1', text: 'First' }, { id: 't1', text: 'Second' }, { id: 't2', text: 'Other', project: 'NewProj' }],
        locations: [{ id: 'l1', name: 'Home' }]
      }
    });
    expect(res.status).toBe(200);
    expect(res.body.counts.tasks).toBe(2);          // 3 → 2 unique
    expect(res.body.counts.duplicatesRemoved).toBe(1);
    expect(res.body.counts.locations).toBe(1);
    // 1 explicit/extracted project ('NewProj' extracted from t2)
    expect(res.body.counts.projects).toBe(1);
    // wipe ran inside the transaction
    expect(calls.wipe).toEqual([USER]);
    // the stale config/projects were cleared, then re-inserted from the import
    var stale = await repo.getConfigRow(USER, 'preferences');
    expect(stale).not.toBeNull(); // re-inserted from import preferences
    var locs = await repo.getLocations(USER);
    expect(locs).toHaveLength(1);
  });

  test('a thrown insertTask ROLLS BACK the whole import (C-TX)', async () => {
    var repo = new InMemoryConfigRepository({ config: [{ user_id: USER, config_key: 'preferences', config_value: '{"keep":1}' }] });
    var d = {
      repo: repo,
      wipeTasks: function () { return Promise.resolve(); },
      insertTask: function () { return Promise.reject(new Error('insert boom')); },
      buildTaskRow: function (t) { return { id: t.id }; }
    };
    await expect(new App.ImportData(d).execute({ userId: USER, confirm: 'delete_all', data: { extraTasks: [{ id: 't1' }] } }))
      .rejects.toThrow(/insert boom/);
    // rollback: the original preferences row survives (the wipe was rolled back)
    var row = await repo.getConfigRow(USER, 'preferences');
    expect(row).not.toBeNull();
    expect(row.config_value).toBe('{"keep":1}');
  });
});

// ── HandleBillingWebhook (== handleWebhook, H3 — per-event dispatch) ──────────
describe('HandleBillingWebhook (== handleWebhook)', () => {
  function adapter() {
    var a = new MockEntitlementAdapter({ catalogSource: function () { return [{ planId: 'plan-pro', features: { limits: { active_tasks: 1 } } }]; } });
    a.invalidateUserPlan = jest.fn(a.invalidateUserPlan.bind(a));
    return a;
  }

  test('contains NO inline signature/crypto logic (FLAG-1: route guard owns it)', () => {
    // The dispatch use-case must not re-implement the HMAC guard — it trusts the
    // route layer (W6). This pins the security architecture: the guard is at the edge.
    var src = App.HandleBillingWebhook.prototype.execute.toString().toLowerCase();
    expect(src).not.toContain('hmac');
    expect(src).not.toContain('signature');
    expect(src).not.toContain('crypto');
  });

  test('subscription.created invalidates the user plan cache → 200', async () => {
    var ent = adapter();
    var res = await new App.HandleBillingWebhook({ entitlement: ent, enforceDowngradeLimits: jest.fn() })
      .execute({ body: { event: 'subscription.created', user_id: 'u1' } });
    expect(res).toEqual({ status: 200, body: { success: true, event: 'subscription.created' } });
    expect(ent.invalidateUserPlan).toHaveBeenCalledWith('u1');
  });

  test('subscription.plan_changed + canceled both invalidate', async () => {
    var ent = adapter();
    var uc = new App.HandleBillingWebhook({ entitlement: ent, enforceDowngradeLimits: jest.fn() });
    await uc.execute({ body: { event: 'subscription.plan_changed', user_id: 'u2', from_planId: 'a', to_planId: 'b' } });
    await uc.execute({ body: { event: 'subscription.canceled', user_id: 'u3' } });
    expect(ent.invalidateUserPlan).toHaveBeenCalledWith('u2');
    expect(ent.invalidateUserPlan).toHaveBeenCalledWith('u3');
  });

  test('downgrade_applied invalidates THEN enforces limits with the to_plan features', async () => {
    var ent = adapter();
    var enforce = jest.fn(function () { return Promise.resolve(); });
    var res = await new App.HandleBillingWebhook({ entitlement: ent, enforceDowngradeLimits: enforce })
      .execute({ body: { event: 'subscription.downgrade_applied', user_id: 'u4', to_planId: 'plan-pro' } });
    expect(res.status).toBe(200);
    expect(ent.invalidateUserPlan).toHaveBeenCalledWith('u4');
    expect(enforce).toHaveBeenCalledWith('u4', { limits: { active_tasks: 1 } });
  });

  test('downgrade_applied with an enforcement error is SWALLOWED (still 200)', async () => {
    var ent = adapter();
    var res = await new App.HandleBillingWebhook({
      entitlement: ent,
      enforceDowngradeLimits: function () { return Promise.reject(new Error('enforce boom')); }
    }).execute({ body: { event: 'subscription.downgrade_applied', user_id: 'u5', to_planId: 'plan-pro' } });
    expect(res.status).toBe(200); // inner try/catch swallows
  });

  test('unknown event → 200, NO invalidate (default branch)', async () => {
    var ent = adapter();
    var res = await new App.HandleBillingWebhook({ entitlement: ent, enforceDowngradeLimits: jest.fn() })
      .execute({ body: { event: 'subscription.future_unknown', user_id: 'u6' } });
    expect(res).toEqual({ status: 200, body: { success: true, event: 'subscription.future_unknown' } });
    expect(ent.invalidateUserPlan).not.toHaveBeenCalled();
  });

  test('event without user_id → 200, invalidate NOT called (if(userId) guard)', async () => {
    var ent = adapter();
    await new App.HandleBillingWebhook({ entitlement: ent, enforceDowngradeLimits: jest.fn() })
      .execute({ body: { event: 'subscription.created' } });
    expect(ent.invalidateUserPlan).not.toHaveBeenCalled();
  });
});

// ── Impersonate (== startImpersonation, H5 — authz-sensitive) ────────────────
describe('Impersonate (== startImpersonation) — authz guards', () => {
  var ADMIN = { id: 'admin-1' };
  function okCall() { return function () { return Promise.resolve({ access_token: 'tok', expires_in: 900, impersonating: { id: 't1' } }); }; }

  test('missing targetUserId → 400 (GUARD 3) without calling auth-service or auditing', async () => {
    var repo = new InMemoryConfigRepository();
    var called = 0;
    var res = await new App.Impersonate({ repo: repo, callAuthServiceImpersonate: function () { called++; return Promise.resolve({}); } })
      .execute({ admin: ADMIN, targetUserId: undefined, audit: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/targetUserId is required/);
    expect(called).toBe(0);
    expect((await repo.listImpersonationLog({ limit: 10, offset: 0 })).total).toBe(0); // no audit
  });

  test('SELF-impersonation (target === admin.id) → 400 (GUARD 2), no auth-service call', async () => {
    var called = 0;
    var res = await new App.Impersonate({ repo: new InMemoryConfigRepository(), callAuthServiceImpersonate: function () { called++; return Promise.resolve({}); } })
      .execute({ admin: ADMIN, targetUserId: 'admin-1', audit: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cannot impersonate yourself/);
    expect(called).toBe(0);
  });

  test('auth-service 4xx error PASSES THROUGH unchanged (GUARD 5)', async () => {
    var err = new Error('Unauthorized'); err.status = 401; err.body = { error: 'Unauthorized', code: 'AUTH_FAILED' };
    var res = await new App.Impersonate({
      repo: new InMemoryConfigRepository(),
      callAuthServiceImpersonate: function () { return Promise.reject(err); }
    }).execute({ admin: ADMIN, targetUserId: 't1', audit: {} });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized', code: 'AUTH_FAILED' });
  });

  test('INTERNAL_SERVICE_KEY-unset Error (no .status, >=500 class) → 503 unavailable (GUARD 4)', async () => {
    // The legacy callAuthServiceImpersonate throws a plain Error (no .status) when
    // the key is unset → classified as >=500 → 503.
    var res = await new App.Impersonate({
      repo: new InMemoryConfigRepository(),
      callAuthServiceImpersonate: function () { return Promise.reject(new Error('INTERNAL_SERVICE_KEY is not set')); }
    }).execute({ admin: ADMIN, targetUserId: 't1', audit: {} });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Impersonation service unavailable/);
  });

  test('a 5xx auth-service error → 503 unavailable', async () => {
    var err = new Error('boom'); err.status = 502;
    var res = await new App.Impersonate({
      repo: new InMemoryConfigRepository(),
      callAuthServiceImpersonate: function () { return Promise.reject(err); }
    }).execute({ admin: ADMIN, targetUserId: 't1', audit: {} });
    expect(res.status).toBe(503);
  });

  test('success: calls auth-service, INSERTS the audit row (P1 Dates) AFTER, returns tokens', async () => {
    var repo = new InMemoryConfigRepository();
    var res = await new App.Impersonate({ repo: repo, callAuthServiceImpersonate: okCall() })
      .execute({ admin: ADMIN, targetUserId: 't1', reason: 'ticket #1', audit: { ip: '1.2.3.4', userAgent: 'UA' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: 'Impersonation started', accessToken: 'tok', expiresIn: 900 });
    var log = await repo.listImpersonationLog({ limit: 10, offset: 0 });
    expect(log.total).toBe(1);
    expect(log.logs[0]).toMatchObject({ admin_user_id: 'admin-1', target_user_id: 't1', action: 'start_impersonation', ip_address: '1.2.3.4', user_agent: 'UA' });
    expect(log.logs[0].created_at).toBeInstanceOf(Date); // P1
  });

  test('a thrown audit insert is SWALLOWED — impersonation still succeeds (best-effort)', async () => {
    var repo = new InMemoryConfigRepository();
    repo.insertImpersonationLog = function () { return Promise.reject(new Error('audit boom')); };
    var warned = [];
    var res = await new App.Impersonate({
      repo: repo, callAuthServiceImpersonate: okCall(), auditLogger: { warn: function () { warned.push(arguments); } }
    }).execute({ admin: ADMIN, targetUserId: 't1', audit: {} });
    expect(res.status).toBe(200); // audit failure did not block
    expect(warned.length).toBe(1);
  });
});

// ── StopImpersonation (== stopImpersonation, H5-6) ───────────────────────────
describe('StopImpersonation (== stopImpersonation)', () => {
  test('with an impersonation token: admin=actingAsAdmin, target=user.id; audits + 200', async () => {
    var repo = new InMemoryConfigRepository();
    var res = await new App.StopImpersonation({ repo: repo })
      .execute({ user: { id: 'target-1' }, actingAsAdmin: 'admin-9', audit: { ip: 'ip', userAgent: 'ua' } });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/stopped/i);
    var log = await repo.listImpersonationLog({ limit: 10, offset: 0 });
    expect(log.logs[0]).toMatchObject({ admin_user_id: 'admin-9', target_user_id: 'target-1', action: 'stop_impersonation' });
  });

  // jug-impersonation-stop-audit-misattribution (999.553): a plain authenticated user
  // (no impersonation token → no actingAsAdmin) hitting /stop has no active impersonation.
  // The old code recorded admin=user.id, target=null, action=stop_impersonation — falsely
  // attributing a 'stop_impersonation' action to a non-admin. The fix records NO audit row
  // in that case; the response is still 200 (the client just discards any token).
  test('without acting context: NO audit row recorded (no misattribution), still 200', async () => {
    var repo = new InMemoryConfigRepository();
    var res = await new App.StopImpersonation({ repo: repo }).execute({ user: { id: 'self-1' }, audit: {} });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/stopped/i);
    var log = await repo.listImpersonationLog({ limit: 10, offset: 0 });
    expect(log.logs).toHaveLength(0);
  });
});

// ── ListImpersonationTargets / GetImpersonationLog (== reads, H5-9/H5-12) ─────
describe('ListImpersonationTargets / GetImpersonationLog — clamps + pagination', () => {
  test('ListImpersonationTargets clamps limit to 100, builds pagination', async () => {
    var users = {}; for (var i = 0; i < 5; i++) users['u' + i] = 'user' + i + '@x.com';
    var repo = new InMemoryConfigRepository({ users: users });
    var res = await new App.ListImpersonationTargets({ repo: repo }).execute({ query: { limit: '999', offset: '0' } });
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(100); // clamped
    expect(res.body.pagination.total).toBe(5);
    expect(res.body.pagination.hasMore).toBe(false);
  });

  test('ListImpersonationTargets search + hasMore pagination', async () => {
    var users = {}; for (var i = 0; i < 5; i++) users['u' + i] = 'user' + i + '@x.com';
    var repo = new InMemoryConfigRepository({ users: users });
    var res = await new App.ListImpersonationTargets({ repo: repo }).execute({ query: { limit: '2', offset: '0' } });
    expect(res.body.users).toHaveLength(2);
    expect(res.body.pagination.hasMore).toBe(true); // 0+2 < 5
  });

  test('GetImpersonationLog forwards admin/target filters + paginates', async () => {
    var repo = new InMemoryConfigRepository({
      users: { 'admin-1': 'admin@x.com' },
      impersonationLog: [
        { admin_user_id: 'admin-1', target_user_id: 't1', action: 'start_impersonation', created_at: new Date(1000) },
        { admin_user_id: 'admin-2', target_user_id: 't2', action: 'start_impersonation', created_at: new Date(2000) }
      ]
    });
    var res = await new App.GetImpersonationLog({ repo: repo }).execute({ query: { adminUserId: 'admin-1' } });
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].admin_user_id).toBe('admin-1');
    expect(res.body.logs[0].admin_email).toBe('admin@x.com'); // leftJoin shape
    expect(res.body.pagination.total).toBe(1);
  });
});

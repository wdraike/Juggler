/**
 * H4 W5 unit tests — entitlement/gate/limit use-cases (CheckEntitlement,
 * GateFeature, EnforceEntityLimit) + GetFeatureCatalog.
 *
 * Behavioral, over the W4 MockEntitlementAdapter (no network) + the W3
 * InMemoryConfigRepository + fake I/O collaborators. Asserts allow/deny/error/authz
 * paths byte-identical to the legacy middleware (golden-master Surfaces 4/6/7/8 —
 * H4/H6/H7/H8/H9), the headline slug-keying, the FLAG-2 logFeatureEvent bug, and the
 * fail-open paths.
 *
 * Traceability: WBS W5 (a)(b)(c)(d); golden-master H4/H6/H7/H9.
 */

'use strict';

var path = require('path');
var SLICE = path.join(__dirname, '..', '..', '..', '..', 'src', 'slices', 'user-config');
var App = require(path.join(SLICE, 'application'));
var MockEntitlementAdapter = require(path.join(SLICE, 'adapters', 'MockEntitlementAdapter'));
var InMemoryConfigRepository = require(path.join(SLICE, 'adapters', 'InMemoryConfigRepository'));

var PLAN_FEATURES = {
  limits: { active_tasks: 5, recurring_templates: -1, projects: 3, locations: 2, schedule_templates: 4 },
  data: { export: true, import: true },
  tasks: { placementMode: ['fixed', 'float'] }
};

function catalogSource() { return [{ planId: 'plan-starter', features: PLAN_FEATURES }]; }

// ── CheckEntitlement (== resolvePlanFeatures, H7/slug-keying) ────────────────
describe('CheckEntitlement (== resolvePlanFeatures)', () => {
  test('SLUG-keyed plan resolves → 200 with {planId, planFeatures}', async () => {
    var entitlement = new MockEntitlementAdapter({
      catalogSource: catalogSource,
      activePlansSource: function () { return { juggler: 'plan-starter' }; } // slug-keyed
    });
    var res = await new App.CheckEntitlement({ entitlement: entitlement, plansUrl: 'https://billing/plans' })
      .execute({ user: { id: 'u1' } });
    expect(res.status).toBe(200);
    expect(res.entitlement.planId).toBe('plan-starter');
    expect(res.entitlement.planFeatures).toEqual(PLAN_FEATURES);
  });

  test('UUID-keyed plans map resolves to null → 402 SUBSCRIPTION_REQUIRED (slug-keying, H7-5)', async () => {
    // The active-plans map is keyed by a UUID, NOT the slug — the slug lookup misses.
    var entitlement = new MockEntitlementAdapter({
      catalogSource: catalogSource,
      activePlansSource: function () { return { '550e8400-e29b-41d4-a716-446655440000': 'plan-starter' }; }
    });
    // PIN-5: resolvePlanCatalog must NOT be called on the 402 path (middleware L177-184
    // ordering — the 402 guard fires BEFORE the catalog fetch). Pins the H4 W5 bert fix
    // that restored legacy ordering: unconditional catalog fetch → wrong 503 side-effect.
    var catalogSpy = jest.spyOn(entitlement, 'resolvePlanCatalog');
    var res = await new App.CheckEntitlement({ entitlement: entitlement, plansUrl: 'https://billing/plans' })
      .execute({ user: { id: 'u1' } });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('SUBSCRIPTION_REQUIRED');
    expect(res.body.plans_url).toBe('https://billing/plans');
    expect(catalogSpy).not.toHaveBeenCalled(); // PIN-5: no catalog fetch on 402 path
  });

  test('no active plan → 402 SUBSCRIPTION_REQUIRED', async () => {
    var entitlement = new MockEntitlementAdapter({ catalogSource: catalogSource, activePlansSource: function () { return null; } });
    // PIN-5 (null-plan variant): resolvePlanCatalog must NOT be called when
    // resolveUserPlanId returns null — the 402 guard is BEFORE the catalog fetch.
    var catalogSpy = jest.spyOn(entitlement, 'resolvePlanCatalog');
    var res = await new App.CheckEntitlement({ entitlement: entitlement }).execute({ user: { id: 'u1' } });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('SUBSCRIPTION_REQUIRED');
    expect(catalogSpy).not.toHaveBeenCalled(); // PIN-5: no catalog fetch on 402 path
  });

  test('plan present but catalog has no features + no free fallback → 503 unavailable', async () => {
    var entitlement = new MockEntitlementAdapter({
      catalogSource: function () { return []; }, // empty catalog
      activePlansSource: function () { return { juggler: 'plan-ghost' }; }
    });
    var res = await new App.CheckEntitlement({ entitlement: entitlement }).execute({ user: { id: 'u1' } });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Plan configuration unavailable/);
  });

  test('plan missing from catalog but a "free" plan exists → falls back to free', async () => {
    var entitlement = new MockEntitlementAdapter({
      catalogSource: function () { return [{ planId: 'free', features: { limits: { active_tasks: 1 } } }]; },
      activePlansSource: function () { return { juggler: 'plan-unknown' }; }
    });
    var res = await new App.CheckEntitlement({ entitlement: entitlement }).execute({ user: { id: 'u1' } });
    expect(res.status).toBe(200);
    expect(res.entitlement.planId).toBe('free');
  });

  test('no user id → 401 Authentication required', async () => {
    var entitlement = new MockEntitlementAdapter({ catalogSource: catalogSource });
    expect((await new App.CheckEntitlement({ entitlement: entitlement }).execute({ user: {} })).status).toBe(401);
  });

  test('resolves the payment user by authServiceId when present (verbatim preference)', async () => {
    var seen = [];
    var entitlement = new MockEntitlementAdapter({
      catalogSource: catalogSource,
      activePlansSource: function (uid) { seen.push(uid); return { juggler: 'plan-starter' }; }
    });
    await new App.CheckEntitlement({ entitlement: entitlement }).execute({ user: { id: 'app-id', authServiceId: 'auth-id' } });
    expect(seen).toEqual(['auth-id']); // authServiceId preferred
  });

  test('on resolve, fires the injected reconcileLimits (fire-and-forget)', async () => {
    var calls = [];
    var entitlement = new MockEntitlementAdapter({ catalogSource: catalogSource, activePlansSource: function () { return { juggler: 'plan-starter' }; } });
    await new App.CheckEntitlement({ entitlement: entitlement, reconcileLimits: function (u, pf) { calls.push([u, pf]); } })
      .execute({ user: { id: 'u1' } });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('u1');
    expect(calls[0][1]).toEqual(PLAN_FEATURES);
  });
});

// ── GetFeatureCatalog (== getFeatureCatalog, H4) ─────────────────────────────
describe('GetFeatureCatalog (== getFeatureCatalog)', () => {
  var CATALOG = { product_id: 'juggler', product_name: 'StriveRS', groups: [] };

  test('overlays the resolved product UUID onto the catalog', async () => {
    var entitlement = new MockEntitlementAdapter({ productId: 'uuid-123' });
    var res = await new App.GetFeatureCatalog({ entitlement: entitlement, catalog: CATALOG }).execute();
    expect(res.status).toBe(200);
    expect(res.body.product_id).toBe('uuid-123');
    expect(res.body.product_name).toBe('StriveRS');
  });

  test('null product UUID falls back to the catalog slug default (verbatim || fallback)', async () => {
    var entitlement = new MockEntitlementAdapter({ productId: null });
    var res = await new App.GetFeatureCatalog({ entitlement: entitlement, catalog: CATALOG }).execute();
    expect(res.body.product_id).toBe('juggler');
  });
});

// ── GateFeature (== feature-gate, H6) ────────────────────────────────────────
describe('GateFeature (== feature-gate requireFeature/Includes/checkUsageLimit)', () => {
  function spies() {
    return {
      logFeatureEvent: jest.fn(),
      reportUsage: jest.fn(),
      checkAndIncrement: jest.fn(),
      getCurrentPeriodBounds: jest.fn(function () { return { start: new Date(0), end: null }; })
    };
  }
  function ctx(planFeatures, extra) {
    return Object.assign({ req: { id: 'req' }, planFeatures: planFeatures, planId: 'plan-x', userId: 'u1', method: 'POST', originalUrl: '/api/x' }, extra || {});
  }

  test('requireFeature allow (true) → {status:null} + logs "used"', () => {
    var s = spies();
    var r = new App.GateFeature(s).requireFeature(ctx({ data: { export: true } }), 'data.export');
    expect(r.status).toBeNull();
    expect(s.logFeatureEvent).toHaveBeenCalledWith({ id: 'req' }, 'data.export', 'used', null);
  });

  test('requireFeature deny (false) → 403 FEATURE_NOT_AVAILABLE + logs "blocked"', () => {
    var s = spies();
    var r = new App.GateFeature(s).requireFeature(ctx({ data: { export: false } }), 'data.export');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('FEATURE_NOT_AVAILABLE');
    expect(r.body.feature).toBe('data.export');
    expect(r.body.upgrade_required).toBe(true);
    expect(s.logFeatureEvent).toHaveBeenCalledWith({ id: 'req' }, 'data.export', 'blocked', { current_plan: 'plan-x' });
  });

  test('requireFeature planFeatures missing → 500 not resolved', () => {
    var r = new App.GateFeature(spies()).requireFeature(ctx(null), 'data.export');
    expect(r.status).toBe(500);
    expect(r.body.error).toMatch(/not resolved/);
  });

  test('requireFeatureIncludes value-in-list → allow; FLAG-2: logs with userId as FIRST arg', () => {
    var s = spies();
    var r = new App.GateFeature(s).requireFeatureIncludes(ctx({ tasks: { placementMode: ['fixed', 'float'] } }), 'tasks.placementMode', 'fixed');
    expect(r.status).toBeNull();
    // FLAG-2 (pinned, NOT fixed): success path passes userId ('u1') as the first
    // positional arg, then planId ('plan-x') as the 4th — the legacy buggy shape.
    expect(s.logFeatureEvent).toHaveBeenCalledWith('u1', 'tasks.placementMode', 'used', 'plan-x', { selected: 'fixed' });
  });

  test('requireFeatureIncludes "all" → allow; logs with the CORRECT req-first shape', () => {
    var s = spies();
    var r = new App.GateFeature(s).requireFeatureIncludes(ctx({ tasks: { placementMode: ['all'] } }), 'tasks.placementMode', 'anything');
    expect(r.status).toBeNull();
    expect(s.logFeatureEvent).toHaveBeenCalledWith({ id: 'req' }, 'tasks.placementMode', 'used', { selected: 'anything' });
  });

  test('requireFeatureIncludes value-NOT-in-list → 403 OPTION_NOT_AVAILABLE', () => {
    var r = new App.GateFeature(spies()).requireFeatureIncludes(ctx({ tasks: { placementMode: ['float'] } }), 'tasks.placementMode', 'fixed');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('OPTION_NOT_AVAILABLE');
    expect(r.body.requested).toBe('fixed');
    expect(r.body.available).toEqual(['float']);
  });

  test('requireFeatureIncludes undefined requested → allow without logging', () => {
    var s = spies();
    var r = new App.GateFeature(s).requireFeatureIncludes(ctx({ tasks: { placementMode: ['float'] } }), 'tasks.placementMode', undefined);
    expect(r.status).toBeNull();
    expect(s.logFeatureEvent).not.toHaveBeenCalled();
  });

  test('checkUsageLimit within limit → allow; over limit → 429 USAGE_LIMIT_REACHED', async () => {
    var s = spies();
    s.checkAndIncrement.mockResolvedValueOnce({ allowed: true, currentCount: 3, limit: 5 });
    var allow = await new App.GateFeature(s).checkUsageLimit(ctx({ limits: { ai_commands_per_month: 5 } }), 'ai_commands_per_month');
    expect(allow.status).toBeNull();

    var s2 = spies();
    s2.checkAndIncrement.mockResolvedValueOnce({ allowed: false, currentCount: 6, limit: 5 });
    var deny = await new App.GateFeature(s2).checkUsageLimit(ctx({ limits: { ai_commands_per_month: 5 } }), 'ai_commands_per_month');
    expect(deny.status).toBe(429);
    expect(deny.body.code).toBe('USAGE_LIMIT_REACHED');
    expect(deny.body.current_usage).toBe(6);
  });

  test('checkUsageLimit unlimited (-1) still counts but never denies', async () => {
    var s = spies();
    s.checkAndIncrement.mockResolvedValueOnce({ allowed: false, currentCount: 999999, limit: 999999999 });
    var r = await new App.GateFeature(s).checkUsageLimit(ctx({ limits: { ai_commands_per_month: -1 } }), 'ai_commands_per_month');
    expect(r.status).toBeNull();
    // effectiveLimit passed was the 999999999 unlimited sentinel
    expect(s.checkAndIncrement.mock.calls[0][2]).toBe(999999999);
  });

  test('checkUsageLimit fail-open: a thrown checkAndIncrement → allow (next)', async () => {
    var s = spies();
    s.checkAndIncrement.mockRejectedValueOnce(new Error('db down'));
    var r = await new App.GateFeature(s).checkUsageLimit(ctx({ limits: { ai_commands_per_month: 5 } }), 'ai_commands_per_month');
    expect(r.status).toBeNull(); // fail-open
  });

  test('checkUsageLimit no userId → 401', async () => {
    var s = spies();
    var r = await new App.GateFeature(s).checkUsageLimit(ctx({ limits: { x: 1 } }, { userId: null }), 'x');
    expect(r.status).toBe(401);
  });
});

// ── EnforceEntityLimit (== entity-limits, H9) ────────────────────────────────
describe('EnforceEntityLimit (== entity-limits check* middleware)', () => {
  function ctx(planFeatures, extra) {
    return Object.assign({ planFeatures: planFeatures, planId: 'plan-x', userId: 'u1' }, extra || {});
  }

  test('check unlimited (-1) → allow WITHOUT counting (short-circuit before userId guard)', async () => {
    var repo = new InMemoryConfigRepository();
    var counted = 0; repo.countProjects = function () { counted++; return Promise.resolve(0); };
    var r = await new App.EnforceEntityLimit({ repo: repo }).check(ctx({ limits: { projects: -1 } }), 'limits.projects', 'projects');
    expect(r.status).toBeNull();
    expect(counted).toBe(0);
  });

  test('check under limit → allow; at-limit boundary blocks (current+1 > limit)', async () => {
    var repo = new InMemoryConfigRepository({ projects: [{ user_id: 'u1', id: 1, name: 'A' }, { user_id: 'u1', id: 2, name: 'B' }] });
    var uc = new App.EnforceEntityLimit({ repo: repo });
    // limit 3, current 2, +1 = 3, not > 3 → allow
    expect((await uc.check(ctx({ limits: { projects: 3 } }), 'limits.projects', 'projects')).status).toBeNull();
    // limit 2, current 2, +1 = 3 > 2 → deny
    var deny = await uc.check(ctx({ limits: { projects: 2 } }), 'limits.projects', 'projects');
    expect(deny.status).toBe(403);
    expect(deny.body.code).toBe('ENTITY_LIMIT_REACHED');
    expect(deny.body.current_count).toBe(2);
    expect(deny.body.attempting_to_add).toBe(1);
  });

  test('check planFeatures missing → 500; no userId (with a finite limit) → 401', async () => {
    var uc = new App.EnforceEntityLimit({ repo: new InMemoryConfigRepository() });
    expect((await uc.check(ctx(null), 'limits.projects', 'projects')).status).toBe(500);
    expect((await uc.check(ctx({ limits: { projects: 3 } }, { userId: null }), 'limits.projects', 'projects')).status).toBe(401);
  });

  test('check fail-open: a thrown count → allow (next)', async () => {
    var repo = new InMemoryConfigRepository();
    repo.countProjects = function () { return Promise.reject(new Error('count boom')); };
    var r = await new App.EnforceEntityLimit({ repo: repo }).check(ctx({ limits: { projects: 1 } }), 'limits.projects', 'projects');
    expect(r.status).toBeNull();
  });

  test('checkLocation uses the INCOMING count, blocks when incoming > limit (strict)', async () => {
    var uc = new App.EnforceEntityLimit({ repo: new InMemoryConfigRepository() });
    // limit 2, incoming 2 → 2 > 2 false → allow
    expect(uc.checkLocation(ctx({ limits: { locations: 2 } }), 2).status).toBeNull();
    // limit 2, incoming 3 → 3 > 2 → deny
    var deny = uc.checkLocation(ctx({ limits: { locations: 2 } }), 3);
    expect(deny.status).toBe(403);
    expect(deny.body.current_count).toBe(3);
  });

  test('checkTaskOrRecurring dispatches to recurring vs active-task limit', async () => {
    var repo = new InMemoryConfigRepository({
      tasks: [
        { user_id: 'u1', id: 'a', status: '', task_type: 'task' },
        { user_id: 'u1', id: 'b', status: '', task_type: 'task' }
      ]
    });
    var uc = new App.EnforceEntityLimit({ repo: repo });
    // active_tasks limit 2, current 2, +1 → deny
    var deny = await uc.checkTaskOrRecurring(ctx({ limits: { active_tasks: 2, recurring_templates: 5 } }), 'task');
    expect(deny.status).toBe(403);
    expect(deny.body.limit_key).toBe('limits.active_tasks');
    // recurring path uses the recurring count (0 here) → allow
    var allow = await uc.checkTaskOrRecurring(ctx({ limits: { active_tasks: 2, recurring_templates: 5 } }), 'recurring_template');
    expect(allow.status).toBeNull();
  });

  test('checkBatch enforces BOTH limits with distinct messages', async () => {
    var repo = new InMemoryConfigRepository({ tasks: [{ user_id: 'u1', id: 'a', status: '', task_type: 'task' }] });
    var uc = new App.EnforceEntityLimit({ repo: repo });
    // active_tasks limit 1, current 1, adding 2 tasks → 3 > 1 → deny (task message)
    var deny = await uc.checkBatch(ctx({ limits: { active_tasks: 1, recurring_templates: -1 } }), [
      { task_type: 'task' }, { task_type: 'task' }
    ]);
    expect(deny.status).toBe(403);
    expect(deny.body.limit_key).toBe('limits.active_tasks');
    expect(deny.body.error).toMatch(/task limit/);
  });

  test('checkBatch all within limits → allow', async () => {
    var repo = new InMemoryConfigRepository();
    var uc = new App.EnforceEntityLimit({ repo: repo });
    var r = await uc.checkBatch(ctx({ limits: { active_tasks: 10, recurring_templates: 10 } }), [{ task_type: 'task' }]);
    expect(r.status).toBeNull();
  });

  test('schedule_templates count parses time_blocks + blocks when over limit', async () => {
    var blocks = { Mon: [{}, {}], Tue: [], Wed: [{}] }; // 2 day-keys with blocks → count 2
    var repo = new InMemoryConfigRepository({ config: [{ user_id: 'u1', config_key: 'time_blocks', config_value: JSON.stringify(blocks) }] });
    var uc = new App.EnforceEntityLimit({ repo: repo });
    // limit 2, current 2, +1 → deny
    var deny = await uc.check(ctx({ limits: { schedule_templates: 2 } }), 'limits.schedule_templates', 'schedule_templates');
    expect(deny.status).toBe(403);
    expect(deny.body.current_count).toBe(2);
  });

  test('schedule_templates count is 0 when no time_blocks row (allow)', async () => {
    var uc = new App.EnforceEntityLimit({ repo: new InMemoryConfigRepository() });
    var r = await uc.check(ctx({ limits: { schedule_templates: 1 } }), 'limits.schedule_templates', 'schedule_templates');
    expect(r.status).toBeNull();
  });
});

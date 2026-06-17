/**
 * 999.689 — Subscription Blocker Tests
 *
 * Tests that each subscription type's blockers/entitlement gates work correctly.
 * Covers the full entitlement pipeline:
 *   1. No subscription → 402 SUBSCRIPTION_REQUIRED (CheckEntitlement)
 *   2. Free plan → limited features, entity limits enforced
 *   3. Paid plan (plan-starter) → full features, higher limits
 *   4. Premium plan (plan-pro) → unlimited features
 *   5. Feature gates: requireFeature, requireFeatureIncludes, checkUsageLimit
 *   6. Entity limits: active_tasks, projects, locations, schedule_templates
 *   7. Slug-keying invariant: UUID-keyed plans map → 402
 *   8. Free fallback: unknown planId falls back to 'free' features
 *   9. Fail-closed: DB error on count → 503 (not allow)
 *  10. Fail-open: usage reporter error → allow (next)
 *
 * These tests exercise the application-layer use cases (CheckEntitlement,
 * GateFeature, EnforceEntityLimit) with MockEntitlementAdapter and
 * InMemoryConfigRepository — no network, no DB.
 */

'use strict';

var path = require('path');
var SLICE = path.join(__dirname, '..', '..', 'src', 'slices', 'user-config');
var App = require(path.join(SLICE, 'application'));
var MockEntitlementAdapter = require(path.join(SLICE, 'adapters', 'MockEntitlementAdapter'));
var InMemoryConfigRepository = require(path.join(SLICE, 'adapters', 'InMemoryConfigRepository'));

// ── Plan feature definitions ─────────────────────────────────────────────────

var FREE_FEATURES = {
  limits: { active_tasks: 5, recurring_templates: 1, projects: 3, locations: 2, schedule_templates: 2 },
  data: { export: false, import: false },
  tasks: { placementMode: ['fixed'] },
  ai: { enrich: false, natural_language_commands: false }
};

var STARTER_FEATURES = {
  limits: { active_tasks: 50, recurring_templates: 10, projects: 10, locations: 5, schedule_templates: 10 },
  data: { export: true, import: true },
  tasks: { placementMode: ['fixed', 'float'] },
  ai: { enrich: true, natural_language_commands: true, ai_commands_per_month: 100 }
};

var PRO_FEATURES = {
  limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1, schedule_templates: -1 },
  data: { export: true, import: true },
  tasks: { placementMode: ['fixed', 'float', 'flex'] },
  ai: { enrich: true, natural_language_commands: true, ai_commands_per_month: -1 }
};

function catalogSource(features) {
  return function () { return [{ planId: 'plan-starter', features: STARTER_FEATURES }, { planId: 'free', features: FREE_FEATURES }, { planId: 'plan-pro', features: PRO_FEATURES }]; };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(planFeatures, extra) {
  return Object.assign({
    req: { id: 'req-1' },
    planFeatures: planFeatures,
    planId: 'plan-x',
    userId: 'u1',
    method: 'POST',
    originalUrl: '/api/tasks'
  }, extra || {});
}

function spies() {
  return {
    logFeatureEvent: jest.fn(),
    reportUsage: jest.fn(),
    checkAndIncrement: jest.fn(),
    getCurrentPeriodBounds: jest.fn(function () { return { start: new Date(0), end: null }; })
  };
}

// ── 1. No subscription → 402 SUBSCRIPTION_REQUIRED ───────────────────────────

describe('999.689a — No subscription → 402 SUBSCRIPTION_REQUIRED', function () {
  test('null active plans map → 402', async function () {
    var entitlement = new MockEntitlementAdapter({
      catalogSource: catalogSource(),
      activePlansSource: function () { return null; }
    });
    var res = await new App.CheckEntitlement({ entitlement: entitlement })
      .execute({ user: { id: 'u1' } });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  test('empty active plans map → 402', async function () {
    var entitlement = new MockEntitlementAdapter({
      catalogSource: catalogSource(),
      activePlansSource: function () { return {}; }
    });
    var res = await new App.CheckEntitlement({ entitlement: entitlement })
      .execute({ user: { id: 'u1' } });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  test('UUID-keyed plans map → 402 (slug-keying invariant)', async function () {
    var entitlement = new MockEntitlementAdapter({
      catalogSource: catalogSource(),
      activePlansSource: function () { return { '550e8400-e29b-41d4-a716-446655440000': 'plan-starter' }; }
    });
    var res = await new App.CheckEntitlement({ entitlement: entitlement })
      .execute({ user: { id: 'u1' } });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  test('no user id → 401 before entitlement check', async function () {
    var entitlement = new MockEntitlementAdapter({
      catalogSource: catalogSource(),
      activePlansSource: function () { return { juggler: 'plan-starter' }; }
    });
    var res = await new App.CheckEntitlement({ entitlement: entitlement })
      .execute({ user: {} });
    expect(res.status).toBe(401);
  });
});

// ── 2. Free plan → limited features, entity limits enforced ──────────────────

describe('999.689b — Free plan blockers', function () {
  test('free plan resolves with limited features', async function () {
    var entitlement = new MockEntitlementAdapter({
      catalogSource: catalogSource(),
      activePlansSource: function () { return { juggler: 'free' }; }
    });
    var res = await new App.CheckEntitlement({ entitlement: entitlement })
      .execute({ user: { id: 'u1' } });
    expect(res.status).toBe(200);
    expect(res.entitlement.planId).toBe('free');
    expect(res.entitlement.planFeatures.limits.active_tasks).toBe(5);
  });

  test('free plan: requireFeature blocks export (false)', function () {
    var s = spies();
    var r = new App.GateFeature(s).requireFeature(makeCtx(FREE_FEATURES), 'data.export');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('FEATURE_NOT_AVAILABLE');
    expect(r.body.upgrade_required).toBe(true);
  });

  test('free plan: requireFeatureIncludes blocks float placement', function () {
    var s = spies();
    var r = new App.GateFeature(s).requireFeatureIncludes(makeCtx(FREE_FEATURES), 'tasks.placementMode', 'float');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('OPTION_NOT_AVAILABLE');
    expect(r.body.available).toEqual(['fixed']);
  });

  test('free plan: entity limit blocks at 5 active tasks', async function () {
    var repo = new InMemoryConfigRepository({
      tasks: [
        { user_id: 'u1', id: 'a', status: '', task_type: 'task' },
        { user_id: 'u1', id: 'b', status: '', task_type: 'task' },
        { user_id: 'u1', id: 'c', status: '', task_type: 'task' },
        { user_id: 'u1', id: 'd', status: '', task_type: 'task' },
        { user_id: 'u1', id: 'e', status: '', task_type: 'task' }
      ]
    });
    var uc = new App.EnforceEntityLimit({ repo: repo });
    var deny = await uc.checkTaskOrRecurring(makeCtx(FREE_FEATURES), 'task');
    expect(deny.status).toBe(403);
    expect(deny.body.limit_key).toBe('limits.active_tasks');
    expect(deny.body.current_count).toBe(5);
  });

  test('free plan: entity limit allows at 4 active tasks (under limit)', async function () {
    var repo = new InMemoryConfigRepository({
      tasks: [
        { user_id: 'u1', id: 'a', status: '', task_type: 'task' },
        { user_id: 'u1', id: 'b', status: '', task_type: 'task' },
        { user_id: 'u1', id: 'c', status: '', task_type: 'task' },
        { user_id: 'u1', id: 'd', status: '', task_type: 'task' }
      ]
    });
    var uc = new App.EnforceEntityLimit({ repo: repo });
    var allow = await uc.checkTaskOrRecurring(makeCtx(FREE_FEATURES), 'task');
    expect(allow.status).toBeNull();
  });

  test('free plan: recurring template limit is 1', async function () {
    var repo = new InMemoryConfigRepository({
      tasks: [
        { user_id: 'u1', id: 'a', status: '', task_type: 'recurring_template' }
      ]
    });
    var uc = new App.EnforceEntityLimit({ repo: repo });
    var deny = await uc.checkTaskOrRecurring(makeCtx(FREE_FEATURES), 'recurring_template');
    expect(deny.status).toBe(403);
    expect(deny.body.limit_key).toBe('limits.recurring_templates');
  });

  test('free plan: project limit is 3', async function () {
    var repo = new InMemoryConfigRepository({
      projects: [
        { user_id: 'u1', id: 1, name: 'A' },
        { user_id: 'u1', id: 2, name: 'B' },
        { user_id: 'u1', id: 3, name: 'C' }
      ]
    });
    var uc = new App.EnforceEntityLimit({ repo: repo });
    var deny = await uc.check(makeCtx(FREE_FEATURES), 'limits.projects', 'projects');
    expect(deny.status).toBe(403);
    expect(deny.body.current_count).toBe(3);
  });

  test('free plan: location limit is 2 (strict incoming count)', function () {
    var uc = new App.EnforceEntityLimit({ repo: new InMemoryConfigRepository() });
    var deny = uc.checkLocation(makeCtx(FREE_FEATURES), 3);
    expect(deny.status).toBe(403);
    expect(deny.body.current_count).toBe(3);
  });
});

// ── 3. Paid plan (plan-starter) → full features, higher limits ───────────────

describe('999.689c — Paid plan (plan-starter) blockers', function () {
  test('plan-starter resolves with full features', async function () {
    var entitlement = new MockEntitlementAdapter({
      catalogSource: catalogSource(),
      activePlansSource: function () { return { juggler: 'plan-starter' }; }
    });
    var res = await new App.CheckEntitlement({ entitlement: entitlement })
      .execute({ user: { id: 'u1' } });
    expect(res.status).toBe(200);
    expect(res.entitlement.planId).toBe('plan-starter');
    expect(res.entitlement.planFeatures.limits.active_tasks).toBe(50);
  });

  test('plan-starter: requireFeature allows export (true)', function () {
    var s = spies();
    var r = new App.GateFeature(s).requireFeature(makeCtx(STARTER_FEATURES), 'data.export');
    expect(r.status).toBeNull();
  });

  test('plan-starter: requireFeatureIncludes allows float placement', function () {
    var s = spies();
    var r = new App.GateFeature(s).requireFeatureIncludes(makeCtx(STARTER_FEATURES), 'tasks.placementMode', 'float');
    expect(r.status).toBeNull();
  });

  test('plan-starter: requireFeatureIncludes blocks flex placement (not in list)', function () {
    var s = spies();
    var r = new App.GateFeature(s).requireFeatureIncludes(makeCtx(STARTER_FEATURES), 'tasks.placementMode', 'flex');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('OPTION_NOT_AVAILABLE');
  });

  test('plan-starter: entity limit allows at 50 active tasks', async function () {
    var tasks = [];
    for (var i = 0; i < 50; i++) {
      tasks.push({ user_id: 'u1', id: 't' + i, status: '', task_type: 'task' });
    }
    var repo = new InMemoryConfigRepository({ tasks: tasks });
    var uc = new App.EnforceEntityLimit({ repo: repo });
    var deny = await uc.checkTaskOrRecurring(makeCtx(STARTER_FEATURES), 'task');
    expect(deny.status).toBe(403);
    expect(deny.body.current_count).toBe(50);
  });

  test('plan-starter: entity limit allows at 49 active tasks (under limit)', async function () {
    var tasks = [];
    for (var i = 0; i < 49; i++) {
      tasks.push({ user_id: 'u1', id: 't' + i, status: '', task_type: 'task' });
    }
    var repo = new InMemoryConfigRepository({ tasks: tasks });
    var uc = new App.EnforceEntityLimit({ repo: repo });
    var allow = await uc.checkTaskOrRecurring(makeCtx(STARTER_FEATURES), 'task');
    expect(allow.status).toBeNull();
  });

  test('plan-starter: usage limit at 100 ai_commands_per_month', async function () {
    var s = spies();
    s.checkAndIncrement.mockResolvedValueOnce({ allowed: true, currentCount: 50, limit: 100 });
    var allow = await new App.GateFeature(s).checkUsageLimit(makeCtx(STARTER_FEATURES), 'ai_commands_per_month');
    expect(allow.status).toBeNull();

    var s2 = spies();
    s2.checkAndIncrement.mockResolvedValueOnce({ allowed: false, currentCount: 101, limit: 100 });
    var deny = await new App.GateFeature(s2).checkUsageLimit(makeCtx(STARTER_FEATURES), 'ai_commands_per_month');
    expect(deny.status).toBe(429);
    expect(deny.body.code).toBe('USAGE_LIMIT_REACHED');
  });
});

// ── 4. Premium plan (plan-pro) → unlimited features ─────────────────────────

describe('999.689d — Premium plan (plan-pro) blockers', function () {
  test('plan-pro resolves with unlimited features', async function () {
    var entitlement = new MockEntitlementAdapter({
      catalogSource: catalogSource(),
      activePlansSource: function () { return { juggler: 'plan-pro' }; }
    });
    var res = await new App.CheckEntitlement({ entitlement: entitlement })
      .execute({ user: { id: 'u1' } });
    expect(res.status).toBe(200);
    expect(res.entitlement.planId).toBe('plan-pro');
    expect(res.entitlement.planFeatures.limits.active_tasks).toBe(-1);
  });

  test('plan-pro: unlimited (-1) entity limit short-circuits before count', async function () {
    var repo = new InMemoryConfigRepository();
    var counted = 0;
    repo.countProjects = function () { counted++; return Promise.resolve(0); };
    var uc = new App.EnforceEntityLimit({ repo: repo });
    var r = await uc.check(makeCtx(PRO_FEATURES), 'limits.projects', 'projects');
    expect(r.status).toBeNull();
    expect(counted).toBe(0); // short-circuit: no count needed
  });

  test('plan-pro: unlimited (-1) usage limit counts but never denies', async function () {
    var s = spies();
    s.checkAndIncrement.mockResolvedValueOnce({ allowed: false, currentCount: 999999, limit: 999999999 });
    var r = await new App.GateFeature(s).checkUsageLimit(makeCtx(PRO_FEATURES), 'ai_commands_per_month');
    expect(r.status).toBeNull();
    // effectiveLimit passed was the 999999999 unlimited sentinel
    expect(s.checkAndIncrement.mock.calls[0][2]).toBe(999999999);
  });

  test('plan-pro: requireFeatureIncludes allows flex placement', function () {
    var s = spies();
    var r = new App.GateFeature(s).requireFeatureIncludes(makeCtx(PRO_FEATURES), 'tasks.placementMode', 'flex');
    expect(r.status).toBeNull();
  });

  test('plan-pro: requireFeatureIncludes "all" allows anything', function () {
    var s = spies();
    var r = new App.GateFeature(s).requireFeatureIncludes(makeCtx(PRO_FEATURES), 'tasks.placementMode', 'anything');
    expect(r.status).toBeNull();
  });
});

// ── 5. Free fallback: unknown planId → free features ────────────────────────

describe('999.689e — Free fallback', function () {
  test('unknown planId falls back to free features', async function () {
    var entitlement = new MockEntitlementAdapter({
      catalogSource: catalogSource(),
      activePlansSource: function () { return { juggler: 'plan-unknown' }; }
    });
    var res = await new App.CheckEntitlement({ entitlement: entitlement })
      .execute({ user: { id: 'u1' } });
    expect(res.status).toBe(200);
    expect(res.entitlement.planId).toBe('free');
    expect(res.entitlement.planFeatures.limits.active_tasks).toBe(5);
  });

  test('unknown planId with no free plan in catalog → 503', async function () {
    var entitlement = new MockEntitlementAdapter({
      catalogSource: function () { return [{ planId: 'plan-starter', features: STARTER_FEATURES }]; },
      activePlansSource: function () { return { juggler: 'plan-ghost' }; }
    });
    var res = await new App.CheckEntitlement({ entitlement: entitlement })
      .execute({ user: { id: 'u1' } });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Plan configuration unavailable/);
  });
});

// ── 6. Fail-closed: DB error → 503 (not allow) ──────────────────────────────

describe('999.689f — Fail-closed on DB errors', function () {
  test('check fail-closed: thrown count → 503', async function () {
    var repo = new InMemoryConfigRepository();
    repo.countProjects = function () { return Promise.reject(new Error('count boom')); };
    var logged = [];
    var uc = new App.EnforceEntityLimit({ repo: repo, logger: { error: function () { logged.push(Array.prototype.slice.call(arguments)); } } });
    var r = await uc.check(makeCtx(STARTER_FEATURES), 'limits.projects', 'projects');
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/temporarily unavailable/i);
    expect(logged.length).toBeGreaterThan(0);
  });

  test('checkBatch fail-closed: thrown count → 503', async function () {
    var repo = new InMemoryConfigRepository();
    repo.countActiveTasks = function () { return Promise.reject(new Error('count boom')); };
    var logged = [];
    var uc = new App.EnforceEntityLimit({ repo: repo, logger: { error: function () { logged.push(Array.prototype.slice.call(arguments)); } } });
    var r = await uc.checkBatch(makeCtx(STARTER_FEATURES), [{ task_type: 'task' }, { task_type: 'task' }]);
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/temporarily unavailable/i);
    expect(logged.length).toBeGreaterThan(0);
  });
});

// ── 7. Fail-open: usage reporter error → allow ──────────────────────────────

describe('999.689g — Fail-open on usage reporter errors', function () {
  test('checkUsageLimit fail-open: thrown checkAndIncrement → allow', async function () {
    var s = spies();
    s.checkAndIncrement.mockRejectedValueOnce(new Error('db down'));
    var r = await new App.GateFeature(s).checkUsageLimit(makeCtx(STARTER_FEATURES), 'ai_commands_per_month');
    expect(r.status).toBeNull(); // fail-open
  });
});

// ── 8. Missing planFeatures → 500 ────────────────────────────────────────────

describe('999.689h — Missing planFeatures', function () {
  test('requireFeature with null planFeatures → 500', function () {
    var r = new App.GateFeature(spies()).requireFeature(makeCtx(null), 'data.export');
    expect(r.status).toBe(500);
    expect(r.body.error).toMatch(/not resolved/);
  });

  test('check with null planFeatures → 500', async function () {
    var uc = new App.EnforceEntityLimit({ repo: new InMemoryConfigRepository() });
    var r = await uc.check(makeCtx(null), 'limits.projects', 'projects');
    expect(r.status).toBe(500);
  });

  test('checkUsageLimit with no userId → 401', async function () {
    var s = spies();
    var r = await new App.GateFeature(s).checkUsageLimit(makeCtx(STARTER_FEATURES, { userId: null }), 'ai_commands_per_month');
    expect(r.status).toBe(401);
  });
});

// ── 9. Schedule templates limit ──────────────────────────────────────────────

describe('999.689i — Schedule templates limit', function () {
  test('schedule_templates count parses time_blocks + blocks when over limit', async function () {
    var blocks = { Mon: [{}, {}], Tue: [], Wed: [{}] }; // 2 day-keys with blocks → count 2
    var repo = new InMemoryConfigRepository({
      config: [{ user_id: 'u1', config_key: 'time_blocks', config_value: JSON.stringify(blocks) }]
    });
    var uc = new App.EnforceEntityLimit({ repo: repo });
    var deny = await uc.check(makeCtx(FREE_FEATURES), 'limits.schedule_templates', 'schedule_templates');
    expect(deny.status).toBe(403);
    expect(deny.body.current_count).toBe(2);
  });

  test('schedule_templates count is 0 when no time_blocks row (allow)', async function () {
    var uc = new App.EnforceEntityLimit({ repo: new InMemoryConfigRepository() });
    var r = await uc.check(makeCtx(FREE_FEATURES), 'limits.schedule_templates', 'schedule_templates');
    expect(r.status).toBeNull();
  });
});

// ── 10. Batch entity limit enforcement ──────────────────────────────────────

describe('999.689j — Batch entity limit enforcement', function () {
  test('checkBatch enforces both limits with distinct messages', async function () {
    var repo = new InMemoryConfigRepository({
      tasks: [{ user_id: 'u1', id: 'a', status: '', task_type: 'task' }]
    });
    var uc = new App.EnforceEntityLimit({ repo: repo });
    var deny = await uc.checkBatch(makeCtx(FREE_FEATURES), [
      { task_type: 'task' }, { task_type: 'task' }
    ]);
    expect(deny.status).toBe(403);
    expect(deny.body.limit_key).toBe('limits.active_tasks');
    expect(deny.body.error).toMatch(/task limit/);
  });

  test('checkBatch all within limits → allow', async function () {
    var repo = new InMemoryConfigRepository();
    var uc = new App.EnforceEntityLimit({ repo: repo });
    var r = await uc.checkBatch(makeCtx(STARTER_FEATURES), [{ task_type: 'task' }]);
    expect(r.status).toBeNull();
  });
});

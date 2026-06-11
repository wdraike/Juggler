/**
 * H4 W2 unit tests — user-config domain PURE decision logic.
 *
 * Covers WBS W2 acceptance (c) + (d) + (e): the relocated feature-gate decision
 * logic, the entity-limit count→limit→allow/block computation, and the slug-keyed
 * entitlement evaluation produce output BYTE-IDENTICAL to the legacy middleware for
 * representative inputs — allow, deny, boundary, unlimited (-1), and the fail-open /
 * slug-mismatch paths the W1 golden-master pins (Surfaces 6/7/8, H6/H7/H8/H9).
 *
 * These assert against the SAME numeric/string outcomes the golden-master HTTP
 * tests pin (status codes + `code` fields), proving the pure decision matches the
 * legacy middleware's branch behavior. Pure — no DB, no network, no env.
 */

'use strict';

const featureGate = require('../../../../src/slices/user-config/domain/logic/featureGate');
const entityLimit = require('../../../../src/slices/user-config/domain/logic/entityLimit');
const entitlement = require('../../../../src/slices/user-config/domain/logic/entitlement');
const PlanSlug = require('../../../../src/slices/user-config/domain/value-objects/PlanSlug');

// ═════════════════════════════════════════════════════════════════════════════
// feature-gate decision logic (Surface 6 / H6 parity)
// ═════════════════════════════════════════════════════════════════════════════
describe('featureGate.decideRequireFeature (== requireFeature, H6-1..H6-3)', () => {
  test('H6-1 allow: feature=true → allow, no status', () => {
    expect(featureGate.decideRequireFeature({ data: { export: true } }, 'data.export'))
      .toEqual({ outcome: 'allow', status: null, code: null });
  });

  test('H6-2 deny: feature=false → 403 FEATURE_NOT_AVAILABLE', () => {
    const d = featureGate.decideRequireFeature({ data: { export: false } }, 'data.export');
    expect(d.outcome).toBe('deny');
    expect(d.status).toBe(403);
    expect(d.code).toBe('FEATURE_NOT_AVAILABLE');
    expect(d.feature).toBe('data.export');
  });

  test('H6-2 deny: missing feature (undefined) is falsy → 403 (legacy `if (!value)`)', () => {
    const d = featureGate.decideRequireFeature({ data: {} }, 'data.export');
    expect(d.status).toBe(403);
    expect(d.code).toBe('FEATURE_NOT_AVAILABLE');
  });

  test('H6-3 error: planFeatures missing → 500 not resolved', () => {
    const d = featureGate.decideRequireFeature(null, 'data.export');
    expect(d.outcome).toBe('error');
    expect(d.status).toBe(500);
    expect(d.error).toMatch(/not resolved/);
  });
});

describe('featureGate.decideRequireFeatureIncludes (== requireFeatureIncludes, H6-4..H6-7)', () => {
  test('H6-4 allow: value in list → allow', () => {
    expect(featureGate.decideRequireFeatureIncludes({ tasks: { placementMode: ['fixed', 'float'] } }, 'tasks.placementMode', 'fixed').outcome)
      .toBe('allow');
  });

  test('H6-5 deny: value NOT in list → 403 OPTION_NOT_AVAILABLE', () => {
    const d = featureGate.decideRequireFeatureIncludes({ tasks: { placementMode: ['float'] } }, 'tasks.placementMode', 'fixed');
    expect(d.status).toBe(403);
    expect(d.code).toBe('OPTION_NOT_AVAILABLE');
    expect(d.feature).toBe('tasks.placementMode');
    expect(d.requested).toBe('fixed');
    expect(d.available).toEqual(['float']);
  });

  test('H6-6 allow: list includes "all" → allow always', () => {
    expect(featureGate.decideRequireFeatureIncludes({ tasks: { placementMode: ['all'] } }, 'tasks.placementMode', 'anything').outcome)
      .toBe('allow');
  });

  test('H6-7 allow: undefined/null requestedValue → allow', () => {
    expect(featureGate.decideRequireFeatureIncludes({ tasks: { placementMode: ['fixed'] } }, 'tasks.placementMode', undefined).outcome).toBe('allow');
    expect(featureGate.decideRequireFeatureIncludes({ tasks: { placementMode: ['fixed'] } }, 'tasks.placementMode', null).outcome).toBe('allow');
  });

  test('deny: allowedValues not an array → 403 OPTION_NOT_AVAILABLE, available []', () => {
    const d = featureGate.decideRequireFeatureIncludes({ tasks: {} }, 'tasks.placementMode', 'fixed');
    expect(d.status).toBe(403);
    expect(d.available).toEqual([]);
  });

  test('error: planFeatures missing → 500', () => {
    expect(featureGate.decideRequireFeatureIncludes(null, 'x.y', 'z').status).toBe(500);
  });
});

describe('featureGate usage limit (== checkUsageLimit, H6-8/H6-9)', () => {
  test('H6-8 unlimited (-1) → isUnlimited true', () => {
    const r = featureGate.resolveUsageLimit({ limits: { ai_commands_per_month: -1 } }, 'ai_commands_per_month');
    expect(r.isUnlimited).toBe(true);
    // unlimited → decideUsage never denies regardless of count
    expect(featureGate.decideUsage(999, r.limit, r.isUnlimited, 'ai_commands_per_month').outcome).toBe('allow');
  });

  test('H6-9 over limit → 429 USAGE_LIMIT_REACHED', () => {
    const r = featureGate.resolveUsageLimit({ limits: { ai_commands_per_month: 10 } }, 'ai_commands_per_month');
    expect(r.isUnlimited).toBe(false);
    const d = featureGate.decideUsage(11, r.limit, r.isUnlimited, 'ai_commands_per_month');
    expect(d.status).toBe(429);
    expect(d.code).toBe('USAGE_LIMIT_REACHED');
    expect(d.limit_key).toBe('ai_commands_per_month');
    expect(d.current_usage).toBe(11);
    expect(d.limit).toBe(10);
  });

  test('boundary: count == limit → allow (count <= limit)', () => {
    const r = featureGate.resolveUsageLimit({ limits: { ai_commands_per_month: 10 } }, 'ai_commands_per_month');
    expect(featureGate.decideUsage(10, r.limit, r.isUnlimited, 'ai_commands_per_month').outcome).toBe('allow');
  });

  test('resolveUsageLimit: limits.<key> missing falls through to bare key (?? semantics)', () => {
    expect(featureGate.resolveUsageLimit({ ai_commands_per_month: 5 }, 'ai_commands_per_month').limit).toBe(5);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// entity-limit computation (Surface 8 / H9 parity)
// ═════════════════════════════════════════════════════════════════════════════
describe('entityLimit.decideEntityLimit (== checkEntityLimit, H9-1..H9-3)', () => {
  test('H9-1 unlimited (-1) → allow (short-circuit before count)', () => {
    expect(entityLimit.decideEntityLimit(-1, 0, 1, 'limits.projects').outcome).toBe('allow');
  });

  test('H9-1 unlimited variants: undefined / null → allow', () => {
    expect(entityLimit.decideEntityLimit(undefined, 5, 1, 'limits.projects').outcome).toBe('allow');
    expect(entityLimit.decideEntityLimit(null, 5, 1, 'limits.projects').outcome).toBe('allow');
  });

  test('H9-2 under limit → allow', () => {
    expect(entityLimit.decideEntityLimit(10, 3, 1, 'limits.projects').outcome).toBe('allow');
  });

  test('H9-3 at/over limit → 403 ENTITY_LIMIT_REACHED with full body', () => {
    const d = entityLimit.decideEntityLimit(10, 10, 1, 'limits.projects');
    expect(d.status).toBe(403);
    expect(d.code).toBe('ENTITY_LIMIT_REACHED');
    expect(d.limit_key).toBe('limits.projects');
    expect(d.current_count).toBe(10);
    expect(d.limit).toBe(10);
    expect(d.attempting_to_add).toBe(1);
  });

  test('boundary: count + add == limit → allow (not strictly greater)', () => {
    // 9 + 1 = 10, 10 > 10 is false → allow
    expect(entityLimit.decideEntityLimit(10, 9, 1, 'limits.projects').outcome).toBe('allow');
  });

  test('batch (H9-14): 10 + 2 > 10 → 403 attempting_to_add=2', () => {
    const d = entityLimit.decideEntityLimit(10, 10, 2, 'limits.active_tasks');
    expect(d.status).toBe(403);
    expect(d.attempting_to_add).toBe(2);
    expect(d.limit_key).toBe('limits.active_tasks');
  });

  test('default batchSize = 1 when omitted', () => {
    expect(entityLimit.decideEntityLimit(10, 10, undefined, 'limits.projects').status).toBe(403);
  });
});

describe('entityLimit.decideIncomingCountLimit (== checkLocationLimit, H9-6..H9-8)', () => {
  test('H9-6 over limit → 403 ENTITY_LIMIT_REACHED limits.locations', () => {
    const d = entityLimit.decideIncomingCountLimit(2, 3);
    expect(d.status).toBe(403);
    expect(d.code).toBe('ENTITY_LIMIT_REACHED');
    expect(d.limit_key).toBe('limits.locations');
    expect(d.current_count).toBe(3);
    expect(d.limit).toBe(2);
  });

  test('H9-7 under limit → allow', () => {
    expect(entityLimit.decideIncomingCountLimit(5, 1).outcome).toBe('allow');
  });

  test('boundary: incoming == limit → allow (strictly greater blocks)', () => {
    expect(entityLimit.decideIncomingCountLimit(2, 2).outcome).toBe('allow');
  });

  test('H9-8 unlimited (-1) → allow regardless of incoming count', () => {
    expect(entityLimit.decideIncomingCountLimit(-1, 5).outcome).toBe('allow');
  });
});

// [WARN-1] PIN #2: entityLimit.resolveLimit() direct unit tests.
// resolveLimit is a one-line FeatureKey.resolvePath delegate, but it IS exported
// and will be called directly from the W3 KnexConfigRepository. No direct tests
// existed before this pin — only transitive coverage through FeatureKey tests.
describe('entityLimit.resolveLimit (== getNestedValue delegate, WARN-1 fix)', () => {
  test('[PIN-2] resolves a present limits key', () => {
    expect(entityLimit.resolveLimit({ limits: { active_tasks: 10 } }, 'limits.active_tasks'))
      .toBe(10);
  });

  test('[PIN-2] resolves the unlimited sentinel -1', () => {
    expect(entityLimit.resolveLimit({ limits: { projects: -1 } }, 'limits.projects'))
      .toBe(-1);
  });

  test('[PIN-2] missing key → undefined', () => {
    expect(entityLimit.resolveLimit({ limits: {} }, 'limits.active_tasks'))
      .toBeUndefined();
  });

  test('[PIN-2] null planFeatures → undefined (short-circuits via optional chaining)', () => {
    expect(entityLimit.resolveLimit(null, 'limits.active_tasks'))
      .toBeUndefined();
  });

  test('[PIN-2] nested path with intermediate object', () => {
    expect(entityLimit.resolveLimit({ limits: { ai: { commands_per_month: 50 } } }, 'limits.ai.commands_per_month'))
      .toBe(50);
  });
});

describe('entityLimit.countScheduleTemplatesFromBlocks (== countScheduleTemplates inner, H9-11/H9-12)', () => {
  test('H9-11 counts day keys with non-empty block arrays', () => {
    expect(entityLimit.countScheduleTemplatesFromBlocks({
      Mon: ['block1', 'block2'], // counts
      Tue: [],                   // empty — does NOT count
      Wed: ['block3']            // counts
    })).toBe(2);
  });

  test('H9-12 no blocks → 0', () => {
    expect(entityLimit.countScheduleTemplatesFromBlocks(null)).toBe(0);
    expect(entityLimit.countScheduleTemplatesFromBlocks(undefined)).toBe(0);
    expect(entityLimit.countScheduleTemplatesFromBlocks({})).toBe(0);
  });

  test('truthy non-array value counts (legacy `!!v`)', () => {
    expect(entityLimit.countScheduleTemplatesFromBlocks({ Mon: 'x', Tue: '' })).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// entitlement evaluation (Surface 7 / H7 parity — SLUG-KEYING)
// ═════════════════════════════════════════════════════════════════════════════
describe('entitlement.resolvePlanIdBySlug (== getUserPlanId slug lookup, H7-2/H7-5)', () => {
  test('H7-2 slug-keyed map: plans["juggler"] resolves', () => {
    expect(entitlement.resolvePlanIdBySlug({ juggler: 'plan-pro' }, 'juggler')).toBe('plan-pro');
  });

  test('H7-5 UUID-keyed map → null (slug "juggler" not present)', () => {
    // plans keyed by a UUID, not the slug → lookup by 'juggler' misses → null → 402
    expect(entitlement.resolvePlanIdBySlug({ '550e8400-e29b-41d4-a716-446655440000': 'plan-pro' }, 'juggler')).toBeNull();
  });

  test('empty / null plans map → null', () => {
    expect(entitlement.resolvePlanIdBySlug({}, 'juggler')).toBeNull();
    expect(entitlement.resolvePlanIdBySlug(null, 'juggler')).toBeNull();
    expect(entitlement.resolvePlanIdBySlug(undefined, 'juggler')).toBeNull();
  });

  test('SLUG-KEYING GUARD: a UUID passed as the lookup KEY throws (cannot key by UUID)', () => {
    expect(() => entitlement.resolvePlanIdBySlug({ juggler: 'plan-pro' }, '550e8400-e29b-41d4-a716-446655440000'))
      .toThrow(/not a UUID/i);
  });

  test('accepts a PlanSlug VO as the slug arg', () => {
    expect(entitlement.resolvePlanIdBySlug({ juggler: 'plan-x' }, new PlanSlug('juggler'))).toBe('plan-x');
  });
});

describe('entitlement.shouldCacheUserPlan (== getUserPlanId cache rule, H8-4)', () => {
  test('truthy planId → cache', () => {
    expect(entitlement.shouldCacheUserPlan('plan-starter')).toBe(true);
  });
  test('null/empty planId → do NOT cache (H8-4: null not cached → re-fetch)', () => {
    expect(entitlement.shouldCacheUserPlan(null)).toBe(false);
    expect(entitlement.shouldCacheUserPlan('')).toBe(false);
  });
});

describe('entitlement.extractCatalogFeatures (== fetchPlanFeatures loop)', () => {
  test('builds planId→features; JSON-parses string features', () => {
    const cache = entitlement.extractCatalogFeatures([
      { planId: 'plan-a', features: { limits: { active_tasks: -1 } } },
      { planId: 'plan-b', features: '{"limits":{"projects":5}}' },
      { planId: 'plan-c' } // no features — skipped
    ]);
    expect(cache['plan-a']).toEqual({ limits: { active_tasks: -1 } });
    expect(cache['plan-b']).toEqual({ limits: { projects: 5 } });
    expect(cache['plan-c']).toBeUndefined();
  });

  test('empty / null plans → {}', () => {
    expect(entitlement.extractCatalogFeatures([])).toEqual({});
    expect(entitlement.extractCatalogFeatures(null)).toEqual({});
  });

  // [bert-refer + ernie INFO-4] PIN #1: null element in plans array → TypeError.
  // extractCatalogFeatures has NO `plan &&` guard (bert removed the spurious guard
  // restoring byte-identical behavior to plan-features.middleware.js:70-76).
  // A null element causes `plan.features` to throw TypeError — this test pins that
  // legacy behavior so a future change cannot silently re-add the skip.
  test('[PIN-1] null element in plans array → TypeError (pinned legacy byte-identical behavior; no plan && guard)', () => {
    expect(() => entitlement.extractCatalogFeatures([null]))
      .toThrow(TypeError);
  });
});

describe('entitlement.decideResolvePlan (== resolvePlanFeatures branches, H7-6)', () => {
  const CATALOG = { 'plan-pro': { limits: { active_tasks: -1 } }, free: { limits: { active_tasks: 5 } } };

  test('resolve: catalog has the planId → resolve with planId + features', () => {
    const d = entitlement.decideResolvePlan('plan-pro', CATALOG);
    expect(d.outcome).toBe('resolve');
    expect(d.status).toBeNull();
    expect(d.planId).toBe('plan-pro');
    expect(d.planFeatures).toEqual({ limits: { active_tasks: -1 } });
  });

  test('H7-6 subscription_required: null realPlanId → 402 SUBSCRIPTION_REQUIRED', () => {
    const d = entitlement.decideResolvePlan(null, CATALOG);
    expect(d.status).toBe(402);
    expect(d.code).toBe('SUBSCRIPTION_REQUIRED');
    expect(d.planFeatures).toBeNull();
  });

  test('free fallback: planId not in catalog but free exists → planId="free" + free features', () => {
    const d = entitlement.decideResolvePlan('plan-unknown', CATALOG);
    expect(d.outcome).toBe('resolve');
    expect(d.planId).toBe('free');
    expect(d.planFeatures).toEqual({ limits: { active_tasks: 5 } });
  });

  test('unavailable: planId not in catalog AND no free → 503', () => {
    const d = entitlement.decideResolvePlan('plan-unknown', { 'plan-other': {} });
    expect(d.outcome).toBe('unavailable');
    expect(d.status).toBe(503);
    expect(d.planFeatures).toBeNull();
  });

  // [WARN-3] PIN #4: catalog=null (the `|| {}` arm) — decideResolvePlan treats null
  // catalog as an empty object; with no 'free' key the result is unavailable (503).
  // Previously only real catalog objects were passed; the null/undefined guard at
  // line 113 was untested at the pure-logic layer (golden-master only exercises it
  // via HTTP).
  test('[PIN-4] catalog=null → `|| {}` arm → no planId match, no free → 503 unavailable', () => {
    const d = entitlement.decideResolvePlan('plan-pro', null);
    expect(d.outcome).toBe('unavailable');
    expect(d.status).toBe(503);
    expect(d.code).toBeNull();
    expect(d.planFeatures).toBeNull();
  });

  test('[PIN-4] catalog=undefined → same `|| {}` arm → 503 unavailable', () => {
    const d = entitlement.decideResolvePlan('plan-pro', undefined);
    expect(d.outcome).toBe('unavailable');
    expect(d.status).toBe(503);
  });
});

/**
 * H4 W2 unit tests — user-config domain value objects + entities.
 *
 * Covers WBS W2 acceptance (b) + (e):
 *   - PlanSlug is CLOSED to known slugs: REJECTS a UUID-shaped value (the headline
 *     slug-keying invariant) and ACCEPTS 'juggler'.
 *   - FeatureKey resolves dotted paths byte-identical to the legacy getNestedValue.
 *   - EntityLimit reproduces the legacy unlimited / block / usage predicates.
 *   - UserConfig + Entitlement entity invariants.
 *
 * Pure unit — no DB, no network, no env.
 */

'use strict';

const PlanSlug = require('../../../../src/slices/user-config/domain/value-objects/PlanSlug');
const FeatureKey = require('../../../../src/slices/user-config/domain/value-objects/FeatureKey');
const EntityLimit = require('../../../../src/slices/user-config/domain/value-objects/EntityLimit');
const UserConfig = require('../../../../src/slices/user-config/domain/entities/UserConfig');
const Entitlement = require('../../../../src/slices/user-config/domain/entities/Entitlement');

// ─────────────────────────────────────────────────────────────────────────────
describe('PlanSlug — CLOSED slug VO (headline slug-keying invariant)', () => {
  test('accepts the juggler slug', () => {
    expect(new PlanSlug('juggler').value).toBe('juggler');
    expect(PlanSlug.JUGGLER).toBe('juggler');
  });

  test('accepts the sibling product slug resume-optimizer', () => {
    expect(new PlanSlug('resume-optimizer').value).toBe('resume-optimizer');
  });

  test('REJECTS a UUID-shaped value (slug-keying violation)', () => {
    expect(() => new PlanSlug('abc12345-1234-4abc-89ab-1234567890ab'))
      .toThrow(/slug.*not a UUID|not a UUID/i);
  });

  test('REJECTS the canonical UUID example from golden-master H7-5', () => {
    // H7-5 uses 'abc12345-uuid-not-slug' which is NOT a strict UUID; a STRICT
    // UUID must be rejected explicitly. Use a well-formed v4 UUID.
    expect(() => new PlanSlug('550e8400-e29b-41d4-a716-446655440000'))
      .toThrow(/not a UUID/i);
  });

  test('rejects an unknown (non-UUID) slug', () => {
    expect(() => new PlanSlug('not-a-product')).toThrow(/PlanSlug must be one of/);
  });

  test.each([['', 'empty'], [null, 'null'], [undefined, 'undefined'], [123, 'number'], [{}, 'object']])(
    'rejects %s (%s)', (bad) => {
      expect(() => new PlanSlug(bad)).toThrow(/PlanSlug must be a non-empty string/);
    }
  );

  test('isUuidShaped detects UUIDs, not slugs', () => {
    expect(PlanSlug.isUuidShaped('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(PlanSlug.isUuidShaped('juggler')).toBe(false);
  });

  test('isValid is true only for known slugs', () => {
    expect(PlanSlug.isValid('juggler')).toBe(true);
    expect(PlanSlug.isValid('resume-optimizer')).toBe(true);
    expect(PlanSlug.isValid('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    expect(PlanSlug.isValid('whatever')).toBe(false);
  });

  test('from() passes through an existing PlanSlug', () => {
    const s = new PlanSlug('juggler');
    expect(PlanSlug.from(s)).toBe(s);
  });

  test('equals + frozen', () => {
    expect(new PlanSlug('juggler').equals(new PlanSlug('juggler'))).toBe(true);
    expect(new PlanSlug('juggler').equals('juggler')).toBe(false);
    expect(Object.isFrozen(new PlanSlug('juggler'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('FeatureKey — dotted path resolution (== legacy getNestedValue)', () => {
  // The legacy getNestedValue: path.split('.').reduce((o, key) => o?.[key], obj)
  const legacyGetNested = (obj, path) => path.split('.').reduce((o, key) => o?.[key], obj);

  const FEATURES = {
    data: { export: true, import: false },
    tasks: { placementMode: ['fixed', 'float'] },
    limits: { active_tasks: 10, projects: -1 }
  };

  test.each([
    ['data.export'],
    ['data.import'],
    ['tasks.placementMode'],
    ['limits.active_tasks'],
    ['limits.projects'],
    ['missing.path'],        // missing intermediate → undefined
    ['data.missing'],        // missing leaf → undefined
  ])('resolve(%s) matches legacy getNestedValue', (path) => {
    expect(new FeatureKey(path).resolve(FEATURES)).toEqual(legacyGetNested(FEATURES, path));
    expect(FeatureKey.resolvePath(FEATURES, path)).toEqual(legacyGetNested(FEATURES, path));
  });

  test('short-circuits on null intermediate (== o?.[key])', () => {
    expect(FeatureKey.resolvePath({ a: null }, 'a.b.c')).toBeUndefined();
    expect(FeatureKey.resolvePath(undefined, 'a.b')).toBeUndefined();
  });

  test('rejects non-string path; equals + frozen', () => {
    expect(() => new FeatureKey('')).toThrow(/non-empty string/);
    expect(new FeatureKey('a.b').equals(new FeatureKey('a.b'))).toBe(true);
    expect(Object.isFrozen(new FeatureKey('a.b'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('EntityLimit — unlimited / block / usage predicates (legacy parity)', () => {
  test('isEntityUnlimited: -1, undefined, null are unlimited (entity-limits.js:30)', () => {
    expect(EntityLimit.isEntityUnlimited(-1)).toBe(true);
    expect(EntityLimit.isEntityUnlimited(undefined)).toBe(true);
    expect(EntityLimit.isEntityUnlimited(null)).toBe(true);
    expect(EntityLimit.isEntityUnlimited(0)).toBe(false);
    expect(EntityLimit.isEntityUnlimited(10)).toBe(false);
  });

  test('isUsageUnlimited: -1, undefined unlimited; null NOT (feature-gate.js:166 asymmetry)', () => {
    expect(EntityLimit.isUsageUnlimited(-1)).toBe(true);
    expect(EntityLimit.isUsageUnlimited(undefined)).toBe(true);
    // legacy asymmetry — null is NOT usage-unlimited
    expect(EntityLimit.isUsageUnlimited(null)).toBe(false);
    expect(EntityLimit.isUsageUnlimited(10)).toBe(false);
  });

  test('blocksEntity: currentCount + adding > limit (entity-limits.js:43)', () => {
    expect(EntityLimit.blocksEntity(10, 1, 10)).toBe(true);  // 11 > 10 → block (H9-3)
    expect(EntityLimit.blocksEntity(3, 1, 10)).toBe(false);  // 4 > 10? no → allow (H9-2)
    expect(EntityLimit.blocksEntity(9, 1, 10)).toBe(false);  // boundary: 10 > 10? no → allow
    expect(EntityLimit.blocksEntity(10, 2, 10)).toBe(true);  // batch H2-14: 12 > 10 → block
  });

  test('usageAllows: count <= limit (feature-gate.js:149)', () => {
    expect(EntityLimit.usageAllows(11, 10)).toBe(false); // 11 <= 10? no → 429 (H6-9)
    expect(EntityLimit.usageAllows(10, 10)).toBe(true);  // boundary: 10 <= 10 → allow
    expect(EntityLimit.usageAllows(5, 10)).toBe(true);
  });

  test('constructed limit: isUnlimited + valueOf + rejects non-number', () => {
    expect(new EntityLimit(-1).isUnlimited()).toBe(true);
    expect(new EntityLimit(10).isUnlimited()).toBe(false);
    expect(new EntityLimit(10).valueOf()).toBe(10);
    expect(() => new EntityLimit(undefined)).toThrow(/finite number/);
    expect(() => new EntityLimit(null)).toThrow(/finite number/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('UserConfig — config-record entity', () => {
  test('isValidKey mirrors updateConfig validKeys (config.controller.js:97-111)', () => {
    expect(UserConfig.isValidKey('preferences')).toBe(true);
    expect(UserConfig.isValidKey('time_blocks')).toBe(true);
    expect(UserConfig.isValidKey('temp_unit_pref')).toBe(true);
    expect(UserConfig.isValidKey('not_a_valid_key')).toBe(false); // H1-6
  });

  test('parsedValue: JSON.parse a string value (getAllConfig:52-55)', () => {
    const c = UserConfig.fromRow({ user_id: 'u1', config_key: 'preferences', config_value: '{"weekStartsOn":1}' });
    expect(c.parsedValue()).toEqual({ weekStartsOn: 1 });
  });

  test('parsedValue: RAW-string passthrough when JSON.parse throws (legacy try/catch)', () => {
    const c = UserConfig.fromRow({ user_id: 'u1', config_key: 'preferences', config_value: 'not-json{' });
    expect(c.parsedValue()).toBe('not-json{');
  });

  test('parsedValue: non-string value returned as-is', () => {
    const c = new UserConfig({ userId: 'u1', configKey: 'x', configValue: { already: 'parsed' } });
    expect(c.parsedValue()).toEqual({ already: 'parsed' });
  });

  test('rejects missing userId / configKey; equals by (userId, configKey)', () => {
    expect(() => new UserConfig({ userId: '', configKey: 'x' })).toThrow(/userId/);
    expect(() => new UserConfig({ userId: 'u', configKey: '' })).toThrow(/configKey/);
    const a = new UserConfig({ userId: 'u1', configKey: 'k' });
    const b = new UserConfig({ userId: 'u1', configKey: 'k', configValue: 'diff' });
    expect(a.equals(b)).toBe(true);
    expect(Object.isFrozen(a)).toBe(true);
  });

  // [WARN-1] UserConfig.parseConfigValue — static convenience parse (UserConfig.js:108-115).
  // Three branches: non-string (line 109 return as-is), valid JSON (line 111 return parsed),
  // parse failure (line 113 catch-passthrough return raw string).
  test('[WARN-1] parseConfigValue returns raw string when JSON.parse fails (catch-passthrough)', () => {
    expect(UserConfig.parseConfigValue('not{json}')).toBe('not{json}');
  });

  test('[WARN-1] parseConfigValue parses valid JSON string (happy-path branch)', () => {
    expect(UserConfig.parseConfigValue('{"weekStartsOn":1}')).toEqual({ weekStartsOn: 1 });
  });

  test('[WARN-1] parseConfigValue returns non-string value as-is (non-string branch)', () => {
    expect(UserConfig.parseConfigValue(42)).toBe(42);
    expect(UserConfig.parseConfigValue(null)).toBeNull();
    expect(UserConfig.parseConfigValue({ already: 'parsed' })).toEqual({ already: 'parsed' });
  });

  // [WARN-2] PIN #3a: null-props guard branch in UserConfig constructor (lines 52-53).
  // `new UserConfig(null)` and `new UserConfig(undefined)` hit the
  // `!props || typeof props !== 'object'` guard — previously untested.
  test('[PIN-3a] new UserConfig(null) → "requires a props object"', () => {
    expect(() => new UserConfig(null)).toThrow(/requires a props object/);
  });

  test('[PIN-3a] new UserConfig(undefined) → "requires a props object"', () => {
    expect(() => new UserConfig(undefined)).toThrow(/requires a props object/);
  });

  test('[PIN-3a] new UserConfig("string") → "requires a props object" (non-object primitive)', () => {
    expect(() => new UserConfig('oops')).toThrow(/requires a props object/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Entitlement — resolved plan/entitlement entity', () => {
  const FEATURES = { data: { export: true }, limits: { active_tasks: 10, projects: -1 } };

  test('carries planId + planFeatures verbatim', () => {
    const e = Entitlement.of({ planId: 'plan-starter', planFeatures: FEATURES });
    expect(e.planId).toBe('plan-starter');
    expect(e.planFeatures).toBe(FEATURES); // not cloned
  });

  test('feature() + limit() resolve like the gate', () => {
    const e = new Entitlement({ planId: 'plan-pro', planFeatures: FEATURES });
    expect(e.feature('data.export')).toBe(true);
    expect(e.limit('active_tasks')).toBe(10);
    expect(e.limit('projects')).toBe(-1);
  });

  test('optional productSlug enforces slug-keying (rejects UUID)', () => {
    expect(new Entitlement({ planId: 'p', planFeatures: FEATURES, productSlug: 'juggler' }).productSlug.value).toBe('juggler');
    expect(() => new Entitlement({ planId: 'p', planFeatures: FEATURES, productSlug: '550e8400-e29b-41d4-a716-446655440000' }))
      .toThrow(/not a UUID/i);
  });

  test('rejects bad planId / planFeatures; equals by planId; frozen', () => {
    expect(() => new Entitlement({ planId: '', planFeatures: FEATURES })).toThrow(/planId/);
    expect(() => new Entitlement({ planId: 'p', planFeatures: null })).toThrow(/planFeatures/);
    const a = new Entitlement({ planId: 'free', planFeatures: FEATURES });
    expect(a.equals(new Entitlement({ planId: 'free', planFeatures: {} }))).toBe(true);
    expect(Object.isFrozen(a)).toBe(true);
  });

  // [WARN-2] PIN #3b: null-props guard branch in Entitlement constructor (lines 50-51).
  // `new Entitlement(null)` and `new Entitlement(undefined)` hit the
  // `!props || typeof props !== 'object'` guard — previously untested.
  test('[PIN-3b] new Entitlement(null) → "requires a props object"', () => {
    expect(() => new Entitlement(null)).toThrow(/requires a props object/);
  });

  test('[PIN-3b] new Entitlement(undefined) → "requires a props object"', () => {
    expect(() => new Entitlement(undefined)).toThrow(/requires a props object/);
  });

  test('[PIN-3b] new Entitlement("string") → "requires a props object" (non-object primitive)', () => {
    expect(() => new Entitlement('oops')).toThrow(/requires a props object/);
  });
});

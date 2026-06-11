/**
 * User-config domain core — barrel re-export (Phase H4 / W2).
 *
 * PURE layer: entities + value-objects + pure decision logic. Zero infra imports
 * (no knex / src/db / lib/db / fetch / process.env / express) — DESIGN §7. The
 * I/O the legacy 8 files perform (config DB reads/writes, the payment-service
 * fetch, the plan_usage upsert, the feature_events insert) STAYS in the legacy
 * files for now; W3 (config repo) / W4 (entitlement adapter) / W5 (application)
 * relocate it. Consumers import from here; nothing in this tree reaches the DB,
 * the network, or env.
 *
 * Mirrors the flat re-export style of `slices/task/domain/index.js`.
 */

'use strict';

module.exports = {
  // Value objects (closed enums / guards)
  PlanSlug: require('./value-objects/PlanSlug'),     // CLOSED to slugs — rejects UUID (slug-keying)
  FeatureKey: require('./value-objects/FeatureKey'),
  EntityLimit: require('./value-objects/EntityLimit'),
  // Entities
  UserConfig: require('./entities/UserConfig'),
  Entitlement: require('./entities/Entitlement'),
  // Pure decision logic (relocated, byte-identical to the legacy middleware)
  featureGate: require('./logic/featureGate'),
  entityLimit: require('./logic/entityLimit'),
  entitlement: require('./logic/entitlement')
};

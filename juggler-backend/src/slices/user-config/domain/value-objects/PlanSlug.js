/**
 * PlanSlug — CLOSED value object enforcing the headline H4 invariant: the JWT
 * `plans` claim (and every entitlement lookup) is keyed by the product **slug**
 * (`'juggler'`), NEVER by a product UUID.
 *
 * ── BINDING CONSTRAINT (WBS H4 / CLAUDE.md §JWT Plans Claim) ───────────────────
 * "The `plans` claim in auth JWTs is keyed by **product slug** (`'juggler'`,
 * `'resume-optimizer'`), not UUID. All consumers must match on slug."
 *
 * The legacy `plan-features.middleware.js` resolves the user plan with
 * `data.plans?.[PRODUCT_LABEL]` where `PRODUCT_LABEL` is the slug `'juggler'`
 * (see service-identity.js → config.getString('PRODUCT_LABEL')). The golden-master
 * H7-1 pins `PRODUCT_LABEL === 'juggler'` and asserts it does NOT match the
 * UUID regexp; H7-5 pins that a UUID-keyed `plans` map resolves to `null`.
 *
 * This VO makes that invariant a TYPE: a UUID-shaped string is REJECTED at
 * construction, so a UUID can never be threaded through the entitlement domain as
 * a "plan key". The accepted slug set is CLOSED to the known product slugs
 * (`'juggler'` for this service; `'resume-optimizer'` is the sibling product slug
 * from the monorepo CLAUDE.md, included so the closed set documents the full slug
 * namespace the `plans` claim uses).
 *
 * PURE: zero infra imports. Does NOT read process.env / service-identity — the
 * adapter (W4) supplies the resolved slug; the domain only validates its shape.
 *
 * BEHAVIOR-PRESERVING: this VO is a guard for the application/entitlement layers.
 * The legacy lookup `data.plans?.['juggler']` is unchanged — PlanSlug does not
 * alter any payload; it rejects a misuse (UUID-as-key) that the legacy code never
 * intended but never type-enforced.
 */

'use strict';

// The closed slug namespace the JWT `plans` claim is keyed by. 'juggler' is THIS
// service's slug (PRODUCT_LABEL default); 'resume-optimizer' is the sibling
// product slug (monorepo CLAUDE.md §JWT Plans Claim). Frozen — immutable canon.
var SLUGS = Object.freeze(['juggler', 'resume-optimizer']);

// UUID v1–v5 / generic 8-4-4-4-12 hex shape. A value matching this is, by the
// slug-keying invariant, NEVER a valid plan key — reject it explicitly.
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {string} value A known product slug (closed set: see {@link PlanSlug.SLUGS}).
 * @throws {Error} if `value` is UUID-shaped (slug-keying violation) or is not one
 *   of the known product slugs.
 */
function PlanSlug(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('PlanSlug must be a non-empty string, got: ' + JSON.stringify(value));
  }
  // Headline invariant: a UUID is NEVER a slug key. Reject first, with a precise
  // message, so the failure clearly names the slug-keying violation.
  if (UUID_RE.test(value)) {
    throw new Error(
      'PlanSlug must be a product slug, not a UUID (slug-keying invariant — ' +
      'the JWT plans claim is keyed by slug, never UUID), got: ' + JSON.stringify(value)
    );
  }
  if (SLUGS.indexOf(value) === -1) {
    throw new Error(
      'PlanSlug must be one of [' + SLUGS.map(function(s) { return "'" + s + "'"; }).join(', ') +
      '], got: ' + JSON.stringify(value)
    );
  }
  this.value = value;
  Object.freeze(this);
}

/**
 * The closed set of known product slugs the `plans` claim is keyed by.
 * @type {ReadonlyArray<string>}
 */
PlanSlug.SLUGS = SLUGS;

/** The UUID-shape regexp a slug must NOT match. @type {RegExp} */
PlanSlug.UUID_RE = UUID_RE;

/** This service's own slug. @type {'juggler'} */
PlanSlug.JUGGLER = 'juggler';

/**
 * True iff `value` is a UUID-shaped string (i.e. NOT a valid slug key).
 * @param {*} value
 * @returns {boolean}
 */
PlanSlug.isUuidShaped = function isUuidShaped(value) {
  return typeof value === 'string' && UUID_RE.test(value);
};

/**
 * True iff `value` is an accepted product slug (does not throw).
 * @param {*} value
 * @returns {boolean}
 */
PlanSlug.isValid = function isValid(value) {
  return typeof value === 'string' && SLUGS.indexOf(value) !== -1;
};

/** @returns {string} the raw slug string. */
PlanSlug.prototype.toString = function toString() {
  return this.value;
};

/**
 * @param {*} other
 * @returns {boolean}
 */
PlanSlug.prototype.equals = function equals(other) {
  return other instanceof PlanSlug && other.value === this.value;
};

/**
 * Factory. Returns the input unchanged if it is already a PlanSlug.
 * @param {(PlanSlug|string)} value
 * @returns {PlanSlug}
 */
PlanSlug.from = function from(value) {
  if (value instanceof PlanSlug) return value;
  return new PlanSlug(value);
};

module.exports = PlanSlug;

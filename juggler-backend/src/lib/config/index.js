/**
 * lib-config — typed environment-variable access.
 *
 * Single front door for reading configuration from `process.env`. Adapters and
 * infrastructure read config HERE; domain code never touches `process.env`
 * directly (see JUGGLER-HEX-DESIGN §4, lib-config row).
 *
 * Each config key is DECLARED in {@link SCHEMA} with an explicit, documented
 * default. These declared defaults are legitimate configuration — they let the
 * service be renamed without code changes — and are NOT silent data fallbacks.
 * Resolution always goes through the schema: there are no scattered `||` / `??`
 * fallbacks on arbitrary values, and requesting an unknown key throws (fail
 * loud) rather than returning silent `undefined`.
 *
 * Typed getters coerce the raw string from `process.env` to the declared type
 * and substitute the declared default only when the variable is unset.
 *
 * @module lib/config
 */

/**
 * @typedef {Object} ConfigEntry
 * @property {string} key       The environment variable name.
 * @property {'string'|'int'|'bool'} type  Declared type for coercion.
 * @property {string|number|boolean} default  Explicit default when unset.
 * @property {boolean} [requiredInProduction]  When true, the declared default
 *   is a DEV-ONLY convenience: in NODE_ENV=production the env var must be set
 *   explicitly, and reading it while unset throws (fail loud — mirrors
 *   lib/jwt-secret.js). Prevents dev defaults (e.g. localhost URLs) from
 *   silently leaking into production.
 */

/**
 * Declared config schema. Every readable key MUST appear here.
 *
 * @type {Object.<string, ConfigEntry>}
 */
const SCHEMA = {
  // Service-rename overrides: defaults let us rename the product/app/service
  // without touching code. Declared config, not a data fallback.
  APP_ID: { key: 'APP_ID', type: 'string', default: 'juggler' },
  PRODUCT_LABEL: { key: 'PRODUCT_LABEL', type: 'string', default: 'juggler' },
  SERVICE_NAME: { key: 'SERVICE_NAME', type: 'string', default: 'strivers' },

  // Auth-service JWKS endpoint (user-token verification, MCP transport path).
  // The default is the local dev auth-service (port 5010) — a DOCUMENTED dev
  // default (999.1197), not a silent data fallback. requiredInProduction: in
  // NODE_ENV=production the var MUST be set (Cloud Run env), else fail loud.
  AUTH_JWKS_URL: {
    key: 'AUTH_JWKS_URL',
    type: 'string',
    default: 'http://localhost:5010/.well-known/jwks.json',
    requiredInProduction: true,
  },

  // ── 999.1202: OAuth-redirect / CORS / cross-service URL fallbacks ─────────
  // These five were previously inline `process.env.X || 'http://localhost:...'`
  // reads scattered across 4 files — the exact no-unapproved-fallback violation
  // class flagged by 999.1202 (a missing prod env var silently resolves to a
  // dev URL instead of failing loud). All five ARE already set in the Cloud Run
  // deploy config (deploy/juggler-backend.yaml) except BILLING_SERVICE_URL,
  // which is a genuine pre-existing gap surfaced by this migration (see that
  // key's own comment). requiredInProduction mirrors AUTH_JWKS_URL exactly.

  // CORS allowed-origins source (src/app.js). Comma-split list of allowed
  // frontend origins; loopback/*.localdev.test are separately allowed by app.js
  // regardless of this value.
  FRONTEND_URL: {
    key: 'FRONTEND_URL',
    type: 'string',
    default: 'http://localhost:3000',
    requiredInProduction: true,
  },

  // Google Calendar OAuth redirect URI (src/lib/gcal-api.js).
  GCAL_REDIRECT_URI: {
    key: 'GCAL_REDIRECT_URI',
    type: 'string',
    default: 'http://localhost:5002/api/gcal/callback',
    requiredInProduction: true,
  },

  // Microsoft Calendar OAuth redirect URI (src/lib/msft-cal-api.js).
  MSFT_CAL_REDIRECT_URI: {
    key: 'MSFT_CAL_REDIRECT_URI',
    type: 'string',
    default: 'http://localhost:5002/api/msft-cal/callback',
    requiredInProduction: true,
  },

  // payment-service base URL, used by src/lib/payment-service-client.js and
  // src/slices/user-config/adapters/PaymentServiceEntitlementAdapter.js (5
  // call sites total — the "4x PAYMENT_SERVICE_URL" cited in 999.1202, which
  // has shifted to 5 since that count was taken). The PaymentServiceEntitlementAdapter
  // call sites are documented (H13 golden-master) as reproducing this fallback
  // BYTE-IDENTICALLY outside production; requiredInProduction only changes the
  // production branch (fail loud instead of a silent, wrong localhost URL).
  PAYMENT_SERVICE_URL: {
    key: 'PAYMENT_SERVICE_URL',
    type: 'string',
    default: 'http://localhost:5020',
    requiredInProduction: true,
  },

  // Billing/payment URL used ONLY by the AI-usage flusher at server.js boot
  // (a DIFFERENT env var name than PAYMENT_SERVICE_URL, pointing at the same
  // service — pre-existing naming inconsistency, out of scope to unify here).
  // NOT currently set in deploy/juggler-backend.yaml — this migration surfaces
  // that real gap; the read site is wrapped in server.js's existing non-fatal
  // try/catch (flusher startup failure only warns, doesn't crash boot), so
  // requiredInProduction is safe to enable here.
  BILLING_SERVICE_URL: {
    key: 'BILLING_SERVICE_URL',
    type: 'string',
    default: 'http://localhost:5020',
    requiredInProduction: true,
  },

  // ── 999.1202: non-URL operational defaults (lower risk, not requiredInProduction) ──

  // HTTP listen port. Cloud Run always injects PORT itself, so this is a
  // legitimate dev-only convenience default, never required.
  PORT: {
    key: 'PORT',
    type: 'int',
    default: 5002,
  },

  // Cloud Tasks queue region (src/scheduler/cloud-tasks-driver.js). Only read
  // when JUGGLER_QUEUE_DRIVER=cloud-tasks is selected (opt-in); 'us-central1'
  // is a legitimate operational default, not a masked prod requirement.
  GCP_REGION: {
    key: 'GCP_REGION',
    type: 'string',
    default: 'us-central1',
  },

  // Scheduler-run queue backend selector (src/scheduler/queue-backend.js).
  // 'db' is the safe, currently-universal default; cloud-tasks is opt-in.
  JUGGLER_QUEUE_DRIVER: {
    key: 'JUGGLER_QUEUE_DRIVER',
    type: 'string',
    default: 'db',
  },

  // Cloud Tasks queue id for scheduler runs (src/scheduler/queue-backend.js).
  JUGGLER_SCHEDULER_QUEUE: {
    key: 'JUGGLER_SCHEDULER_QUEUE',
    type: 'string',
    default: 'juggler-scheduler-runs',
  },
};

/**
 * Look up a key's schema entry, throwing loudly if it isn't declared.
 *
 * @param {string} key
 * @returns {ConfigEntry}
 */
function entryFor(key) {
  const entry = SCHEMA[key];
  if (!entry) {
    throw new Error(
      `lib/config: unknown config key "${key}". ` +
        `Declare it in the SCHEMA before reading it.`,
    );
  }
  return entry;
}

/**
 * Resolve the raw value for a key: the env var if set to a non-empty string,
 * otherwise the declared default. An empty-string env var is treated as UNSET
 * — this preserves byte-identical behavior with the legacy `process.env.X ||
 * default` reads this lib replaces (`||` treats `''` as falsy → default).
 *
 * @param {string} key
 * @returns {{ raw: (string|undefined), entry: ConfigEntry }}
 */
function resolveRaw(key) {
  const entry = entryFor(key);
  const present = Object.prototype.hasOwnProperty.call(process.env, entry.key)
    ? process.env[entry.key]
    : undefined;
  // Empty string is treated as unset to match the legacy `|| default` semantic.
  const raw = present === undefined || present === '' ? undefined : present;
  if (
    raw === undefined &&
    entry.requiredInProduction &&
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error(
      `lib/config: "${entry.key}" is required in production ` +
        `(its declared default is dev-only). Set the environment variable.`,
    );
  }
  return { raw, entry };
}

/**
 * Read a string config value.
 *
 * @param {string} key  A key declared in the schema.
 * @returns {string} The env value if set, else the declared default.
 */
function getString(key) {
  const { raw, entry } = resolveRaw(key);
  if (entry.type !== 'string') {
    throw new Error(`lib/config: "${key}" is type "${entry.type}", not "string"`);
  }
  return raw === undefined ? entry.default : raw;
}

/**
 * Read an integer config value. Coerces the raw string via base-10 parse.
 *
 * @param {string} key  A key declared in the schema.
 * @returns {number} The parsed env value if set, else the declared default.
 */
function getInt(key) {
  const { raw, entry } = resolveRaw(key);
  if (entry.type !== 'int') {
    throw new Error(`lib/config: "${key}" is type "${entry.type}", not "int"`);
  }
  if (raw === undefined) {
    return entry.default;
  }
  // Strict: reject trailing garbage ("5abc") that Number.parseInt would
  // silently truncate to 5 — the contract is fail-loud on non-integers.
  if (!/^[+-]?\d+$/.test(raw.trim())) {
    throw new Error(
      `lib/config: "${entry.key}" expected an integer but got "${raw}"`,
    );
  }
  return Number.parseInt(raw.trim(), 10);
}

/**
 * Read a boolean config value. Truthy strings: "true", "1" (case-insensitive,
 * trimmed). Falsy strings: "false", "0". Anything else throws (fail loud).
 *
 * @param {string} key  A key declared in the schema.
 * @returns {boolean} The coerced env value if set, else the declared default.
 */
function getBool(key) {
  const { raw, entry } = resolveRaw(key);
  if (entry.type !== 'bool') {
    throw new Error(`lib/config: "${key}" is type "${entry.type}", not "bool"`);
  }
  if (raw === undefined) {
    return entry.default;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  throw new Error(
    `lib/config: "${entry.key}" expected a boolean ("true"/"false"/"1"/"0") ` +
      `but got "${raw}"`,
  );
}

module.exports = {
  SCHEMA,
  getString,
  getInt,
  getBool,
};

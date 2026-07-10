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

  // ── 999.1473: continuation of 999.1202 — remaining direct process.env reads ──
  //
  // NODE_ENV is Node's own runtime-environment var, read pervasively (dev/test/
  // prod branching, test seams). Deliberately NOT requiredInProduction — it is
  // the signal THAT determines "are we in production", so gating its own
  // presence on being in production would be circular. 'development' mirrors
  // Node's own convention when NODE_ENV is unset.
  NODE_ENV: { key: 'NODE_ENV', type: 'string', default: 'development' },

  // Shared inter-service auth secret (Phase 60 consolidation). Real secret in
  // ALL 5 consumer services per deploy/juggler-backend.yaml lines 105-109
  // (`internal-service-key` in Secret Manager) — requiredInProduction so a
  // missing deploy secret fails loud at the read site instead of silently
  // degrading to an empty X-Internal-Key header (confusing downstream 401s).
  // Cross-file consistency (999.1473 follow-up question): ALL read sites that
  // treat this as their OWN required secret (PaymentServiceEntitlementAdapter,
  // plan-features.middleware, user-config/facade, usage-reporter) now read this
  // ONE schema key. The two sites where INTERNAL_SERVICE_KEY is the FALLBACK
  // half of an already-approved `SECRET_A || INTERNAL_SERVICE_KEY` composite
  // (billing-webhooks.routes.js, scheduler-tasks.routes.js) are intentionally
  // NOT migrated to this schema key — see the comments at those call sites for
  // the unhandled-rejection / response-shape risk that blocks it.
  INTERNAL_SERVICE_KEY: {
    key: 'INTERNAL_SERVICE_KEY',
    type: 'string',
    default: '',
    requiredInProduction: true,
  },

  // Microsoft Graph OAuth app credentials (src/lib/msft-cal-api.js). Real
  // secrets in deploy/juggler-backend.yaml lines 46-55.
  MICROSOFT_CLIENT_ID: { key: 'MICROSOFT_CLIENT_ID', type: 'string', default: '', requiredInProduction: true },
  MICROSOFT_CLIENT_SECRET: { key: 'MICROSOFT_CLIENT_SECRET', type: 'string', default: '', requiredInProduction: true },

  // Google OAuth app credentials (src/lib/gcal-api.js). Real secrets in
  // deploy/juggler-backend.yaml lines 31-40.
  GOOGLE_CLIENT_ID: { key: 'GOOGLE_CLIENT_ID', type: 'string', default: '', requiredInProduction: true },
  GOOGLE_CLIENT_SECRET: { key: 'GOOGLE_CLIENT_SECRET', type: 'string', default: '', requiredInProduction: true },

  // AES-256-GCM key for stored-credential encryption (src/lib/credential-encrypt.js).
  // NOT requiredInProduction: the read site already enforces presence + exact
  // length in EVERY environment (`if (!hex || hex.length !== 64) throw`), a
  // stricter, pre-existing guard than the prod-only requiredInProduction check.
  CREDENTIAL_ENCRYPTION_KEY: { key: 'CREDENTIAL_ENCRYPTION_KEY', type: 'string', default: '' },

  // MCP server's own public URL, used as the OAuth issuer / WWW-Authenticate
  // resource metadata base (src/mcp/transport.js). Two legacy env-var names
  // for the same value; both ARE set in deploy/juggler-backend.yaml (lines
  // 85-86, 110-111) as belt-and-suspenders redundancy. Deliberately NOT
  // requiredInProduction — the `||` fallback chain between the two is the
  // existing, intentional redundancy, not a masked-missing-var violation.
  PUBLIC_URL: { key: 'PUBLIC_URL', type: 'string', default: '' },
  MCP_ISSUER_URL: { key: 'MCP_ISSUER_URL', type: 'string', default: '' },

  // Dev-only MCP auth bypass flag (src/mcp/transport.js) — also gated on
  // NODE_ENV !== 'production' at the read site, so this can never open the
  // bypass in prod even if accidentally set. Not requiredInProduction.
  MCP_DEV_NO_AUTH: { key: 'MCP_DEV_NO_AUTH', type: 'string', default: '' },

  // Logger config (src/lib/logger/index.js). LOG_LEVEL default stays '' so the
  // existing `getString('LOG_LEVEL') || (NODE_ENV==='production' ? 'info' :
  // 'debug')` computed-fallback line at the call site is preserved verbatim.
  LOG_LEVEL: { key: 'LOG_LEVEL', type: 'string', default: '' },
  CI: { key: 'CI', type: 'string', default: '' },
  NO_COLOR: { key: 'NO_COLOR', type: 'string', default: '' },
  TERM: { key: 'TERM', type: 'string', default: '' },

  // Web Push (VAPID) keys (src/lib/push-service.js). Documented, approved
  // fail-SOFT: absence is a deploy-time misconfig the module logs loudly and
  // no-ops on (in-app reminders still work) — not requiredInProduction.
  VAPID_PUBLIC_KEY: { key: 'VAPID_PUBLIC_KEY', type: 'string', default: '' },
  VAPID_PRIVATE_KEY: { key: 'VAPID_PRIVATE_KEY', type: 'string', default: '' },
  // Contact URI, not a secret; default matches the pre-existing `||` fallback.
  VAPID_SUBJECT: { key: 'VAPID_SUBJECT', type: 'string', default: 'mailto:support@raikeandsons.com' },

  // Redis connection string, read by 5 files (redis.js, sse-emitter.js,
  // cache/index.js, rate-limit-store.js). Fail-open by design across all of
  // them (in-memory/local-only fallback) except lib/cache/index.js, which
  // itself throws when REDIS_URL is absent AND NODE_ENV==='production' — that
  // check stays in the calling code (createCache), not this schema entry, so
  // REDIS_URL itself is not requiredInProduction.
  REDIS_URL: { key: 'REDIS_URL', type: 'string', default: '' },

  // Build/deploy metadata surfaced by the health-diagnostics endpoint
  // (src/routes/health.diagnostics.js). Purely informational; '' default lets
  // the call site's existing `|| null` produce the same JSON `null` it always
  // has when unset.
  GIT_COMMIT: { key: 'GIT_COMMIT', type: 'string', default: '' },
  BUILD_DATE: { key: 'BUILD_DATE', type: 'string', default: '' },

  // Comma-separated admin allowlist (src/middleware/authenticateAdmin.js).
  // Default '' matches the pre-existing `|| ''` exactly (empty list -> deny all).
  ADMIN_EMAILS: { key: 'ADMIN_EMAILS', type: 'string', default: '' },

  // Shared service key protecting the feature-catalog/feature-events internal
  // routes (src/routes/feature-catalog.routes.js, feature-events.routes.js).
  // NOT requiredInProduction: both call sites already fail soft with an
  // explicit 503 when unset ("Feature catalog not configured") — preserving
  // that deliberate response shape rather than promoting it to a thrown error.
  FEATURE_CATALOG_KEY: { key: 'FEATURE_CATALOG_KEY', type: 'string', default: '' },

  // Per-call Gemini timeout override (src/slices/ai-enrichment/adapters/gemini-tracked-call.js).
  // Read fresh at call time via getInt (not memoized) — same call-time-read
  // contract the file's own comment already documents for test isolation.
  AI_CALL_TIMEOUT_MS: { key: 'AI_CALL_TIMEOUT_MS', type: 'int', default: 45000 },

  // Cloud Tasks driver config (src/scheduler/cloud-tasks-driver.js,
  // src/routes/scheduler-tasks.routes.js) — all opt-in, only consulted when
  // JUGGLER_QUEUE_DRIVER=cloud-tasks. None requiredInProduction: the driver
  // already throws its own clear errors when a required one of these is unset
  // AND the cloud-tasks backend is actually selected (see buildCreateTaskRequest).
  CLOUD_TASKS_EMULATOR_HOST: { key: 'CLOUD_TASKS_EMULATOR_HOST', type: 'string', default: '' },
  GCP_PROJECT: { key: 'GCP_PROJECT', type: 'string', default: '' },
  GOOGLE_CLOUD_PROJECT: { key: 'GOOGLE_CLOUD_PROJECT', type: 'string', default: '' },
  JUGGLER_WORKER_BASE_URL: { key: 'JUGGLER_WORKER_BASE_URL', type: 'string', default: '' },
  CLOUD_TASKS_INVOKER_SA: { key: 'CLOUD_TASKS_INVOKER_SA', type: 'string', default: '' },
  SKIP_SCHEDULER_TASK_AUTH: { key: 'SKIP_SCHEDULER_TASK_AUTH', type: 'string', default: '' },
  JUGGLER_TASK_SECRET: { key: 'JUGGLER_TASK_SECRET', type: 'string', default: '' },

  // Billing-webhook HMAC secret (src/routes/billing-webhooks.routes.js). Not
  // requiredInProduction: INTERNAL_SERVICE_KEY is the guaranteed fallback
  // (Approved Fallback, juggler/CLAUDE.md, 999.368) when a dedicated secret
  // isn't separately provisioned.
  BILLING_WEBHOOK_SECRET: { key: 'BILLING_WEBHOOK_SECRET', type: 'string', default: '' },
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

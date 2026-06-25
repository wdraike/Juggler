/**
 * Real-server harness for E2E tests.
 *
 * Boots juggler-backend's src/app.js against the test DB (test-bed port 3407, juggler_test).
 * Mints RS256 JWTs verifiable by the real jwt-auth middleware via a local JWKS server.
 * Also starts a local payment-service mock so resolvePlanFeatures passes without a
 * live payment service.
 *
 * JWKS intercept mechanism: tiny local Node http server (zero new deps).
 * AUTH_JWKS_URL is set BEFORE any auth-client or app.js module is required, so the
 * module-level _jwks = createRemoteJWKSet(url) picks up our local server.
 *
 * Payment service mock: tiny local Node http server serving:
 *   GET /internal/products/:label  → { product: { id: 'e2e-product-id' } }
 *   GET /api/plans                 → { plans: [{ planId: 'e2e-pro', features: {...} }] }
 *   GET /internal/users/:id/active-plans → { plans: { juggler: 'e2e-pro' } }
 * PAYMENT_SERVICE_URL is set BEFORE app.js is required.
 */

'use strict';

const path = require('path');
const http = require('http');

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_USER_ID = 'e2e-test-user-001';
const TEST_USER_EMAIL = 'e2e@juggler.local';
const TEST_KID = 'e2e-test-key-1';
const TEST_ISSUER = 'raike-auth'; // must match auth-client jwtVerify({ issuer })

const E2E_PRODUCT_ID = 'e2e-product-juggler';
const E2E_PLAN_ID = 'e2e-pro';
const E2E_PLAN_FEATURES = {
  limits: {
    active_tasks: -1,
    recurring_templates: -1,
    projects: -1,
    locations: -1,
    schedule_templates: -1,
    ai_commands_per_month: -1
  },
  ai: { natural_language_commands: true, bulk_project_creation: true },
  calendar: { max_providers: -1, auto_sync: true },
  scheduling: { dependencies: true, travel_time: true },
  tasks: { rigid: true, create: true },
  data: { export: true, import: true, mcp_access: true }
};

// ── State ────────────────────────────────────────────────────────────────────

let _availableCached = null;
let _keyPair = null;        // { publicKey, privateKey }
let _publicJwk = null;     // exported JWK with kid + alg
let _jwksServer = null;    // local http server for JWKS
let _jwksPort = null;
let _paymentServer = null; // local http server for payment service mock
let _paymentPort = null;
let _db = null;            // knex connection for DB assertions
let _appInstance = null;

// Redis client for seeding auth:active:<sub> session keys.
// Kept separate from the app's auth-client Redis so teardown can DEL
// only the keys the harness minted without disturbing production sessions.
let _redis = null;
// Track every sub that has been seeded so destroy() can DEL them all.
const _seededSubs = new Set();

// ── Redis session seeding ─────────────────────────────────────────────────────

/**
 * Lazily open a harness-owned Redis client pointing at the same instance the
 * app's auth-client uses.  Defaults to test-bed Redis (6479); respects an
 * explicit REDIS_URL override exactly as server-setup.js:73 does for DB_PASSWORD.
 */
function _getHarnessRedis() {
  if (_redis) return _redis;
  const Redis = require('ioredis');
  // Test-bed Redis is on 6479 (dev-bed is 6379 — do NOT default to dev port).
  // Respect an explicit REDIS_URL override (e.g. CI sets it via test-bed env).
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6479';
  // lazyConnect: false  → connects immediately on construction (no manual .connect() needed)
  // enableOfflineQueue  → default true: commands queue until 'ready', so setex() issued
  //                       before the 'connect' event still reaches Redis.
  // maxRetriesPerRequest: 1 → fail fast if Redis is actually absent.
  _redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: false,
    retryStrategy(times) { return times > 2 ? null : Math.min(times * 200, 1000); },
  });
  // Suppress unhandled-error crashes if Redis is unavailable; _seedSessionKey
  // catches the resulting rejections and logs a non-fatal warning.
  _redis.on('error', () => {});
  return _redis;
}

/**
 * Seed `auth:active:<sub>` in Redis so isSessionActive() returns true for the
 * given sub.  Mirrors the production pattern in auth-service jwt-auth.js:208:
 *   redis.setex(`auth:active:${userId}`, 3700, '1')
 * TTL 3700 s (~1 h + buffer) matches SESSION_TTL in auth-service.
 * No-ops gracefully if Redis is unavailable (the app will fail-open anyway).
 */
async function _seedSessionKey(sub) {
  if (!sub || _seededSubs.has(sub)) return;
  try {
    const redis = _getHarnessRedis();
    await redis.setex(`auth:active:${sub}`, 3700, '1');
    _seededSubs.add(sub);
  } catch (err) {
    // Non-fatal: if Redis is down the app fail-opens; log so failures are diagnosable.
    console.warn('[e2e-harness] Could not seed auth:active key for sub', sub, '—', err.message);
  }
}

// ── Boot env vars BEFORE any app module is loaded ────────────────────────────
// These must be set here (at require time) so that module-level caches in
// auth-client.js (_jwks) and plan-features.middleware.js pick them up correctly.
// The actual values are filled in by _initKeysAndJwksServer / _initPaymentServer.
process.env.NODE_ENV = 'test'; // picks up juggler_test DB at port 3407 via knexfile
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '3407';
process.env.DB_USER = 'root';
// test-bed MySQL root requires 'rootpass' (MYSQL_ROOT_PASSWORD). Respect an
// explicit override (e.g. make test-juggler) but default to the test-bed value
// — an empty password fails auth against test-bed and silently skips e2e.
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'rootpass';
process.env.DB_NAME = 'juggler_test';
// Encryption key placeholder — required by some modules at load time
process.env.CREDENTIAL_ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY || '0'.repeat(64);
// Suppress scheduler warnings in test output
process.env.DISABLE_REDIS_RECONNECT = 'true';
// Point auth-client's Redis session check (and the app's own Redis clients) at
// test-bed Redis (6479).  auth-client.js defaults to 127.0.0.1:6379 (dev-bed)
// which is wrong in test — without this the harness seeds 6479 but isSessionActive()
// checks 6379, always finding no key and returning SESSION_ENDED 401.
// Respect an explicit override so CI can supply its own REDIS_URL.
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6479';

// ── JWKS server ───────────────────────────────────────────────────────────────

async function _initKeysAndJwksServer() {
  if (_keyPair) return; // idempotent

  // Load jose lazily — it's a prod dependency of juggler-backend
  const jose = require('jose');

  // 1. Generate RS256 key pair (2048-bit, extractable so we can export the public JWK)
  _keyPair = await jose.generateKeyPair('RS256', { modulusLength: 2048, extractable: true });

  // 2. Export public key as JWK and annotate with kid/alg/use
  _publicJwk = await jose.exportJWK(_keyPair.publicKey);
  _publicJwk.kid = TEST_KID;
  _publicJwk.alg = 'RS256';
  _publicJwk.use = 'sig';

  // 3. Start local JWKS server on a random port
  await new Promise((resolve, reject) => {
    _jwksServer = http.createServer((req, res) => {
      if (req.url && req.url.includes('jwks')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ keys: [_publicJwk] }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'not found' }));
      }
    });
    _jwksServer.listen(0, '127.0.0.1', () => {
      _jwksPort = _jwksServer.address().port;
      // 4. Point auth-client + jwt-auth.js at our local JWKS server
      //    Must happen BEFORE app.js is require()d
      process.env.AUTH_JWKS_URL = `http://127.0.0.1:${_jwksPort}/.well-known/jwks.json`;
      resolve();
    });
    _jwksServer.on('error', reject);
  });
}

// ── Payment service mock ───────────────────────────────────────────────────────

async function _initPaymentServer() {
  if (_paymentServer) return; // idempotent

  await new Promise((resolve, reject) => {
    _paymentServer = http.createServer((req, res) => {
      const url = req.url || '';

      // GET /internal/products/:label — product discovery
      if (req.method === 'GET' && url.startsWith('/internal/products/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ product: { id: E2E_PRODUCT_ID } }));
        return;
      }

      // GET /api/plans — plan catalog
      if (req.method === 'GET' && url.startsWith('/api/plans')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          plans: [{ planId: E2E_PLAN_ID, features: E2E_PLAN_FEATURES }]
        }));
        return;
      }

      // GET /internal/users/:id/active-plans — user's active plan
      if (req.method === 'GET' && url.includes('/active-plans')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ plans: { juggler: E2E_PLAN_ID } }));
        return;
      }

      // Fallback
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found', url }));
    });

    _paymentServer.listen(0, '127.0.0.1', () => {
      _paymentPort = _paymentServer.address().port;
      // Point plan-features.middleware.js at our local mock
      process.env.PAYMENT_SERVICE_URL = `http://127.0.0.1:${_paymentPort}`;
      resolve();
    });
    _paymentServer.on('error', reject);
  });
}

// ── DB availability ───────────────────────────────────────────────────────────

/**
 * Returns true if the test DB (test-bed port 3407, juggler_test) is reachable.
 * Caches the result after the first call.
 */
async function isAvailable() {
  if (_availableCached !== null) return _availableCached;
  try {
    const db = _getDb();
    await db.raw('SELECT 1');
    _availableCached = true;
  } catch (e) {
    console.warn('[e2e-harness] Test DB not available (test-bed port 3407):', e.message);
    _availableCached = false;
  }
  return _availableCached;
}

function _getDb() {
  if (!_db) {
    // Use the test knex config directly to avoid polluting the module-singleton db.js
    const knex = require('knex');
    const knexConfig = require('../../knexfile');
    _db = knex(knexConfig.test);
  }
  return _db;
}

// ── Seed / teardown ───────────────────────────────────────────────────────────

async function _seedTestUser(db) {
  const { seedFullUser } = require('../helpers/seedFullUser');
  await seedFullUser(db, TEST_USER_ID, {
    email: TEST_USER_EMAIL,
    name: 'E2E Test User',
    timezone: 'America/New_York'
  });
}

async function _teardownTestUser(db) {
  const { teardownUser } = require('../helpers/seedFullUser');
  await teardownUser(db, TEST_USER_ID);
}

// ── setup / teardown / destroy ────────────────────────────────────────────────

/**
 * Boot the real Express app for E2E tests.
 *
 * Call in beforeAll(). Returns the Express app (suitable for supertest(app))
 * or null when the test DB is unavailable.
 *
 * Order of operations:
 *   1. Start JWKS server → set AUTH_JWKS_URL
 *   2. Start payment mock → set PAYMENT_SERVICE_URL
 *   3. Check DB reachability
 *   4. Seed test user
 *   5. Clear module cache for auth-client + jwt-auth (so _jwks is rebuilt
 *      with the new AUTH_JWKS_URL) then require app.js
 */
async function setup() {
  // Keys + servers must be ready before app.js is require()d
  await _initKeysAndJwksServer();
  await _initPaymentServer();

  if (!(await isAvailable())) {
    return null;
  }

  const db = _getDb();
  // Clean up any leftovers from a previous run, then seed fresh
  await _teardownTestUser(db).catch(() => {}); // ignore errors if user doesn't exist
  await _seedTestUser(db);

  // Seed the default test user's session key so auth-client isSessionActive() returns
  // true.  Any JWT minted with a different sub (User B, etc.) is seeded on demand
  // inside makeJWT() below.
  await _seedSessionKey(TEST_USER_ID);

  // Clear module caches so auth-client + jwt-auth load fresh with our env vars.
  // This is essential: auth-client.js caches _jwks at the module level; if the
  // module was already loaded (e.g. by a previous test in the same jest worker),
  // getJWKS() would return the old URL-bound JWKS fetcher.
  [
    require.resolve('auth-client'),
    require.resolve('../../src/middleware/jwt-auth'),
    require.resolve('../../src/app'),
  ].forEach((mod) => {
    delete require.cache[mod];
  });

  _appInstance = require('../../src/app');
  return _appInstance;
}

/**
 * Remove test user data. Call in afterAll().
 */
async function teardown() {
  if (await isAvailable()) {
    const db = _getDb();
    await _teardownTestUser(db).catch(() => {});
  }
}

/**
 * Close DB connection and shut down local servers. Call in afterAll() after teardown().
 */
async function destroy() {
  if (_db) {
    await _db.destroy().catch(() => {});
    _db = null;
  }
  if (_jwksServer) {
    await new Promise((resolve) => _jwksServer.close(resolve));
    _jwksServer = null;
  }
  if (_paymentServer) {
    await new Promise((resolve) => _paymentServer.close(resolve));
    _paymentServer = null;
  }
  // DEL every auth:active key the harness seeded, then quit the client so Jest
  // exits cleanly (no open handle).  Failures are swallowed — the test-bed Redis
  // is ephemeral (tmpfs) and keys expire anyway after SESSION_TTL.
  if (_redis) {
    try {
      if (_seededSubs.size > 0) {
        const keys = [..._seededSubs].map((sub) => `auth:active:${sub}`);
        await _redis.del(...keys);
        _seededSubs.clear();
      }
    } catch {
      // Ignore — Redis may already be gone if test-bed was torn down
    }
    await _redis.quit().catch(() => {});
    _redis = null;
  }
}

// ── makeJWT ───────────────────────────────────────────────────────────────────

/**
 * Mint an RS256 JWT verifiable by the real jwt-auth middleware.
 *
 * The token is signed with our local private key; the middleware fetches the
 * matching public key from our local JWKS server (AUTH_JWKS_URL).
 *
 * Claim shape:
 *   - sub: the user's auth-service ID (maps to local user via email lookup)
 *   - email: must match a row in the users table (jwt-auth.js resolves local user by email)
 *   - apps: ['juggler'] — auth-client.js checks payload.apps.includes(appId)
 *   - issuer: 'raike-auth' — required by jwtVerify({ issuer: 'raike-auth' })
 *
 * @param {object} opts
 * @param {string}   [opts.sub]    - Subject (auth-service user ID). Defaults to TEST_USER_ID.
 * @param {string}   [opts.email]  - Email claim. Defaults to TEST_USER_EMAIL.
 * @param {string}   [opts.name]   - Name claim.
 * @param {string[]} [opts.apps]   - App access list. Defaults to ['juggler'].
 * @param {object}   [opts.plans]  - Plans claim. Defaults to { juggler: 'e2e-pro' }.
 * @param {string}   [opts.exp]    - Expiration time string (jose format). Defaults to '15m'.
 * @param {boolean}  [opts.expired] - If true, create an already-expired token.
 * @param {object}   [opts.extra]  - Additional claims to merge into payload.
 * @returns {Promise<string>} Signed JWT string
 */
async function makeJWT(opts = {}) {
  if (!_keyPair) {
    await _initKeysAndJwksServer();
  }

  const jose = require('jose');

  const payload = {
    sub: opts.sub || TEST_USER_ID,
    email: opts.email || TEST_USER_EMAIL,
    name: opts.name || 'E2E Test User',
    apps: opts.apps !== undefined ? opts.apps : ['juggler'],
    plans: opts.plans || { juggler: E2E_PLAN_ID },
    ...(opts.extra || {})
  };

  let builder = new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: TEST_KID, typ: 'JWT' })
    .setIssuer(TEST_ISSUER)
    .setIssuedAt();

  if (opts.expired) {
    // Set issued-at in the past and expiration already elapsed
    builder = builder
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800);
  } else {
    builder = builder.setExpirationTime(opts.exp || '15m');
  }

  const token = await builder.sign(_keyPair.privateKey);

  // Seed auth:active:<sub> for every minted token so isSessionActive() returns true.
  // This covers the default user AND any dynamically-minted User B variants (different
  // sub values used in cross-user isolation tests).  _seedSessionKey is idempotent.
  await _seedSessionKey(payload.sub);

  return token;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Constants
  TEST_USER_ID,
  TEST_USER_EMAIL,
  TEST_KID,
  TEST_ISSUER,
  E2E_PLAN_ID,
  E2E_PLAN_FEATURES,

  // Core API
  isAvailable,
  setup,
  teardown,
  destroy,
  makeJWT,

  // DB access for state assertions
  getDb: _getDb
};

// ── Self-test (run directly: node tests/api-e2e/server-setup.js) ─────────────

if (require.main === module) {
  (async () => {
    console.log('Self-test: initializing keys + JWKS server...');
    await _initKeysAndJwksServer();
    console.log(`JWKS server listening on port ${_jwksPort}`);
    console.log(`AUTH_JWKS_URL = ${process.env.AUTH_JWKS_URL}`);

    console.log('Self-test: minting JWT...');
    const token = await makeJWT();
    console.log(`makeJWT OK; token length: ${token.length}, kid: ${TEST_KID}`);

    if (!token || token.length < 100) {
      throw new Error('makeJWT returned suspiciously short token: ' + token);
    }

    console.log('Self-test: verifying JWT with jose (simulates what jwt-auth middleware does)...');
    const jose = require('jose');
    const JWKS = jose.createRemoteJWKSet(new URL(process.env.AUTH_JWKS_URL));
    const { payload } = await jose.jwtVerify(token, JWKS, { issuer: TEST_ISSUER });
    console.log('Verified payload sub:', payload.sub, '| email:', payload.email, '| apps:', payload.apps);

    console.log('Self-test: starting payment mock...');
    await _initPaymentServer();
    console.log(`Payment mock listening on port ${_paymentPort}`);
    console.log(`PAYMENT_SERVICE_URL = ${process.env.PAYMENT_SERVICE_URL}`);

    console.log('Self-test: checking DB availability...');
    const available = await isAvailable();
    console.log(`DB available: ${available}`);

    // Cleanup
    if (_jwksServer) await new Promise((r) => _jwksServer.close(r));
    if (_paymentServer) await new Promise((r) => _paymentServer.close(r));
    if (_db) await _db.destroy();

    console.log('Self-test PASSED');
  })().catch((e) => {
    console.error('SELF-TEST FAILED:', e.message || e);
    process.exit(1);
  });
}

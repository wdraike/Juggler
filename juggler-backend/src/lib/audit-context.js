'use strict';

/**
 * audit-context — AsyncLocalStorage actor context for audit-column
 * attribution (999.1576 inc.2). WHO is writing, available anywhere in the
 * async call chain without threading an actor parameter through 109 write
 * sites.
 *
 * Sources of identity (David spec 2026-07-13):
 *  - request paths: the JWT sub — established app-wide by
 *    expressAuditContext, which stores a LAZY reference to req (route-level
 *    auth middleware sets req.user AFTER this middleware runs; the actor is
 *    read at stamp time, when it is populated).
 *  - system writers: explicit service identity ('scheduler', 'cal-sync',
 *    'mcp', 'migration-backfill') via runWithActor at each entry point.
 *  - jest sandboxes ONLY: an explicitly-armed test-default actor ('jest') —
 *    the APPROVED test-only fallback (David sign-off 2026-07-19, documented
 *    in juggler/CLAUDE.md "Approved Fallbacks"). Armed per test file by
 *    test-helpers/armAuditTestActor.js (setupFilesAfterEnv); resolved
 *    synchronously below with NO AsyncLocalStorage propagation — the three
 *    ALS-propagation designs (enterWith-in-beforeEach, global test-fn
 *    wrapping, testEnvironment event hooks) are disproven under jest's
 *    sequencer (inc.4b) and must not be retried. Arming outside a jest
 *    sandbox throws, so production behavior is unchanged: no actor → throw.
 *
 * getActor() THROWS when no actor is established — no silent NULL
 * attribution, per the item's no-fallback rule. Since inc.4, stampInsert/
 * stampUpdate are STRICT (getActor), so every unwrapped write path fails
 * loudly instead of writing NULL attribution.
 */

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

// inc.4: sandbox-scoped test-default actor. Stored on globalThis (not module
// state) so a suite's jest.resetModules() — which discards this module's
// registry entry mid-file — cannot silently disarm it. globalThis is still
// per-jest-sandbox (per test file), and BOTH the write and the read are
// JEST_WORKER_ID-gated, so production never sees it.
const TEST_DEFAULT_KEY = '__auditTestDefaultActor999_1576__';

function readTestDefault() {
  return process.env.JEST_WORKER_ID ? globalThis[TEST_DEFAULT_KEY] || null : null;
}

/**
 * Run fn inside an actor context. Nested calls: the innermost actor wins
 * (a system writer invoked during a request attributes as itself).
 * @param {string} actor non-empty identity ('scheduler', a user id, ...)
 * @param {Function} fn
 */
function runWithActor(actor, fn) {
  if (!actor || typeof actor !== 'string') {
    throw new Error('audit-context: runWithActor requires a non-empty string actor, got ' + JSON.stringify(actor));
  }
  return als.run({ actor: actor }, fn);
}

/**
 * The current actor. Resolution order: real ALS store → armed test default
 * (jest sandboxes only) → throw. A write path outside any context is a bug
 * (wrap its entry point), never a silent NULL.
 * @returns {string}
 */
function getActor() {
  const store = als.getStore();
  if (store) {
    const actor = typeof store.actor === 'function' ? store.actor() : store.actor;
    if (actor) return String(actor);
    if (store.noActorZone) {
      // _runWithoutActor: production no-context assertions — the armed test
      // default is deliberately suppressed here.
      throw noActorError();
    }
  }
  const testDefault = readTestDefault();
  if (testDefault) return testDefault;
  throw noActorError();
}

function noActorError() {
  return new Error(
    'audit-context: no actor established on this async path — wrap the entry point in runWithActor() or ensure the route runs after JWT auth (999.1576)'
  );
}

/**
 * Non-throwing probe — diagnostics/tests ONLY. Probes the REAL ALS store
 * exclusively (never the armed test default). Stamping code must use
 * getActor(); using this for stamping would be exactly the silent-NULL
 * fallback the spec forbids.
 * @returns {?string}
 */
function peekActor() {
  const store = als.getStore();
  const actor = store && (typeof store.actor === 'function' ? store.actor() : store.actor);
  return actor ? String(actor) : null;
}

/**
 * App-wide express middleware. Mounted BEFORE the routers (auth is
 * route-level in juggler), so it stores a lazy thunk that reads req.user at
 * stamp time instead of a snapshot taken before auth ran.
 */
function expressAuditContext(req, res, next) {
  als.run(
    {
      actor: function readReqUser() {
        const u = req.user;
        return (u && (u.sub || u.id || u.userId)) || null;
      },
    },
    next
  );
}

/**
 * Stamp an INSERT row with who-attribution — STRICT since inc.4: no ambient
 * actor (and no armed test default) throws via getActor(), never a silent
 * NULL. All production timer-spawned writers were wrapped in inc.4a
 * (pollOnce, ai-usage-flusher, crons); the jest-armed default covers test
 * sandboxes.
 * Caller-provided values always win, so import/backfill paths carrying
 * explicit historical attribution are never overwritten.
 */
function stampInsert(row) {
  if (Array.isArray(row)) return row.map(stampInsert);
  const actor = getActor();
  const out = Object.assign({}, row);
  if (out.created_by === undefined || out.created_by === null) out.created_by = actor;
  if (out.updated_by === undefined || out.updated_by === null) out.updated_by = actor;
  return out;
}

/** Stamp an UPDATE change-set with updated_by. Same rules as stampInsert. */
function stampUpdate(changes) {
  const actor = getActor();
  const out = Object.assign({}, changes);
  if (out.updated_by === undefined || out.updated_by === null) out.updated_by = actor;
  return out;
}

/**
 * TEST-ONLY escape: run fn with NO ambient actor AND the armed test default
 * suppressed — for asserting production no-context behavior (throws).
 */
function _runWithoutActor(fn) {
  return als.run({ actor: null, noActorZone: true }, fn);
}

/**
 * Arm the sandbox-scoped test-default actor (inc.4 approved test-only
 * fallback — see module header). Jest sandboxes only; production arming is a
 * hard error.
 * @param {string} actor
 */
function _armTestDefaultActor(actor) {
  if (!process.env.JEST_WORKER_ID) {
    throw new Error('audit-context: the test-default actor may only be armed inside a jest sandbox (999.1576 inc.4)');
  }
  if (!actor || typeof actor !== 'string') {
    throw new Error('audit-context: _armTestDefaultActor requires a non-empty string actor, got ' + JSON.stringify(actor));
  }
  globalThis[TEST_DEFAULT_KEY] = actor;
}

/** Disarm the test-default actor (production-behavior assertions in tests). */
function _disarmTestDefaultActor() {
  delete globalThis[TEST_DEFAULT_KEY];
}

module.exports = {
  runWithActor,
  getActor,
  peekActor,
  expressAuditContext,
  stampInsert,
  stampUpdate,
  _runWithoutActor,
  _armTestDefaultActor,
  _disarmTestDefaultActor,
};

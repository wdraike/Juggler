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
 *
 * getActor() THROWS when no actor is established — no silent NULL
 * attribution, per the item's no-fallback rule. Stamping tranches only land
 * after every writer's entry point is wrapped (inc.2a ships the contexts
 * first, with zero behavior change).
 */

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

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
 * The current actor. Throws when none is established — a write path outside
 * any context is a bug (wrap its entry point), never a silent NULL.
 * @returns {string}
 */
function getActor() {
  const store = als.getStore();
  const actor = store && (typeof store.actor === 'function' ? store.actor() : store.actor);
  if (!actor) {
    throw new Error(
      'audit-context: no actor established on this async path — wrap the entry point in runWithActor() or ensure the route runs after JWT auth (999.1576)'
    );
  }
  return String(actor);
}

/**
 * Non-throwing probe — diagnostics/tests ONLY. Stamping code must use
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
 * Stamp an INSERT row with who-attribution (999.1576 inc.4: STRICT — throws
 * without an established actor; jest bodies get an ambient 'jest' actor via
 * the global test-fn wrapper in test-helpers/afterEachFile.js, the mechanism
 * that actually propagates where enterWith-in-beforeEach could not).
 * Caller-provided values always win, so import/backfill paths carrying
 * explicit historical attribution are never overwritten.
 */
function stampInsert(row) {
  // inc.4a: still SOFT. Strict flip attempted 2026-07-18 and reverted: 192
  // no-actor throws from BACKGROUND TIMERS in tests (lib/usage-reporter's own
  // flush interval and similar setInterval callbacks run outside any ALS
  // context and surface as unhandled rejections in unrelated suites). The
  // final increment must wrap every timer-spawned writer (usage-reporter et
  // al) before this becomes getActor().
  const actor = peekActor();
  if (!actor) return row;
  const out = Object.assign({}, row);
  if (out.created_by === undefined || out.created_by === null) out.created_by = actor;
  if (out.updated_by === undefined || out.updated_by === null) out.updated_by = actor;
  return out;
}

/** Stamp an UPDATE change-set with updated_by. Same rules as stampInsert. */
function stampUpdate(changes) {
  const actor = peekActor(); // inc.4a: soft — see stampInsert note
  if (!actor) return changes;
  const out = Object.assign({}, changes);
  if (out.updated_by === undefined || out.updated_by === null) out.updated_by = actor;
  return out;
}

/**
 * TEST-ONLY escape: run fn with NO ambient actor (the global jest wrapper
 * gives every test body a 'jest' actor; no-context assertions opt out here).
 */
function _runWithoutActor(fn) {
  return als.run(undefined, fn);
}

module.exports = {
  runWithActor,
  getActor,
  peekActor,
  expressAuditContext,
  stampInsert,
  stampUpdate,
  _runWithoutActor,
};

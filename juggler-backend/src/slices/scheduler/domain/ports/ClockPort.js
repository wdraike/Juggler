/**
 * ClockPort — driven-port contract for the scheduler's time source (Phase H6 / W2).
 *
 * The scheduler reads "now" in two distinct senses:
 *   - the wall-clock used to derive `todayKey` / `nowMins` for placement (the
 *     pure core takes these as arguments — they are computed by the caller); and
 *   - the DB clock (`SELECT NOW(3)`) the persist path reads for the placement
 *     cache `generatedAt`, so the cache timestamp is consistent with MySQL's
 *     `updated_at` rather than Node's `Date.now()` (which can lag Cloud SQL —
 *     runSchedule.js ~1679-1684).
 *
 * This port models BOTH. The `MysqlClockAdapter` returns the DB clock for
 * `dbNow()` (preserving the legacy "use MySQL's clock" rationale) and the process
 * clock for `now()`. A fixed/in-memory clock can be injected for deterministic
 * tests. P1 applies: every Date this port returns is a JS Date, never a
 * `db.fn.now()` builder.
 *
 * Contract only (W2) — JSDoc `@typedef` + throw-not-implemented base.
 *
 * @typedef {Object} ClockPort
 *
 * @property {() => Date} now
 *   The process wall-clock as a JS Date (`new Date()`). Used where the legacy
 *   code used `new Date()` (NOT `db.fn.now()`).
 *
 * @property {(db?: Function) => Promise<Date>} dbNow
 *   The DB clock as a JS Date (legacy `SELECT NOW(3)` → parsed Date). Used for
 *   the placement-cache `generatedAt` so it matches MySQL `updated_at`. `db` may
 *   be a trx handle.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function ClockPort() {}

ClockPort.prototype.now = function now() {
  throw new Error('ClockPort.now not implemented');
};

ClockPort.prototype.dbNow = function dbNow(_db) {
  throw new Error('ClockPort.dbNow not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy ClockPort.
 * @type {ReadonlyArray<string>}
 */
var CLOCK_PORT_METHODS = Object.freeze([
  'now',
  'dbNow'
]);

module.exports = ClockPort;
module.exports.ClockPort = ClockPort;
module.exports.CLOCK_PORT_METHODS = CLOCK_PORT_METHODS;

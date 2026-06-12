/**
 * MysqlClockAdapter — concrete ClockPort. Phase H6 / W2.
 *
 * `now()` → the process wall-clock as a JS Date (`new Date()`), used wherever the
 * legacy scheduler used a plain JS new Date() (NOT the Knex now-builder — P1).
 * `dbNow(db)` → the MySQL clock (`SELECT NOW(3)`) parsed to a JS Date, preserving
 * the legacy "use MySQL's clock for generatedAt so it's consistent with
 * tasks.updated_at" rationale (runSchedule.js ~1679-1684).
 *
 * Connection via the injected `db` (a trx handle in the orchestrated path) —
 * ADR-0002, never src/db.js.
 */

'use strict';

var CLOCK_PORT_METHODS = require('../domain/ports/ClockPort').CLOCK_PORT_METHODS;

/**
 * @param {Object} [deps]
 * @param {Function} [deps.db] default knex when a per-call db is not passed to dbNow.
 */
function MysqlClockAdapter(deps) {
  var d = deps || {};
  this._db = d.db || null;
}

MysqlClockAdapter.prototype.now = function now() {
  return new Date();
};

MysqlClockAdapter.prototype.dbNow = async function dbNow(db) {
  var conn = db || this._db || require('../../../lib/db').getDefaultDb();
  var _nowRow = await conn.raw('SELECT NOW(3) as ts');
  var _dbNow = _nowRow[0][0].ts;
  return new Date(String(_dbNow).replace(' ', 'T') + 'Z');
};

module.exports = MysqlClockAdapter;
module.exports.MysqlClockAdapter = MysqlClockAdapter;
module.exports.CLOCK_PORT_METHODS = CLOCK_PORT_METHODS;

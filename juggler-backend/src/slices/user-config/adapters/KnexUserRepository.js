/**
 * KnexUserRepository — concrete UserRepositoryPort over the `users` table
 * (999.1197). Every method is a VERBATIM relocation of the query the jwt-auth
 * middleware ran inline (behavior-identical; no timestamp writes here, the
 * table's column defaults apply exactly as before).
 *
 * Connection: injectable via `opts.db` — the jwt-auth middleware passes the
 * shared pool (`src/db`) it always used, tests pass a mock/test-bed handle.
 * When not injected, falls back to `lib/db.getDefaultDb()` (the same shared
 * pool `src/db.js` re-exports — ADR-0002 declared wiring, not a data fallback).
 */

'use strict';
var { stampInsert, stampUpdate } = require('../../../lib/audit-context'); // 999.1576 inc.3b.3

function KnexUserRepository(opts) {
  this._db = (opts && opts.db)
    ? opts.db
    : require('../../../lib/db').getDefaultDb();
}

KnexUserRepository.prototype.findByEmail = function (email) {
  return this._db('users').where('email', email).first();
};

KnexUserRepository.prototype.findById = function (id) {
  return this._db('users').where('id', id).first();
};

KnexUserRepository.prototype.insertUser = function (row) {
  return this._db('users').insert(row);
};

KnexUserRepository.prototype.updateTimezone = function (id, timezone) {
  return this._db('users').where('id', id).update(stampUpdate({ timezone: timezone }));
};

module.exports = KnexUserRepository;

/**
 * UserRepositoryPort — driven-port contract for the `users` table (999.1197).
 *
 * The seam behind ProvisionUserOnFirstLogin: the jwt-auth middleware's inline
 * `db('users')` lookup/insert moves behind this contract so any authenticated
 * route can be tested without a real users table (InMemory adapter).
 *
 * Rows are DB-shape (snake_case: id, email, name, picture_url, timezone, …) —
 * exactly what the legacy middleware read/wrote. Contract only — a
 * throw-not-implemented base, mirroring ConfigRepositoryPort/TaskRepositoryPort.
 *
 * Implementations:
 *   - adapters/KnexUserRepository.js     (live — verbatim relocation of the
 *     middleware's queries)
 *   - adapters/InMemoryUserRepository.js (test double — ER_DUP_ENTRY parity)
 */

'use strict';

var USER_REPOSITORY_PORT_METHODS = Object.freeze([
  'findByEmail',     // (email)  → user row | undefined
  'findById',        // (id)     → user row | undefined
  'insertUser',      // (row)    → resolves; rejects with 'Duplicate…' on PK/unique-email collision
  'updateTimezone'   // (id, timezone) → resolves once users.timezone is updated (999.1447)
]);

function UserRepositoryPort() {}

USER_REPOSITORY_PORT_METHODS.forEach(function (m) {
  UserRepositoryPort.prototype[m] = function () {
    throw new Error('UserRepositoryPort.' + m + ' not implemented');
  };
});

module.exports = UserRepositoryPort;
module.exports.UserRepositoryPort = UserRepositoryPort;
module.exports.USER_REPOSITORY_PORT_METHODS = USER_REPOSITORY_PORT_METHODS;

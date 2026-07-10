/**
 * InMemoryUserRepository — UserRepositoryPort test double (999.1197).
 *
 * Mirrors the MySQL behavior the provisioning use-case depends on:
 * inserting a row whose id (PK) or email (unique) collides rejects with an
 * error whose message contains 'Duplicate' (ER_DUP_ENTRY parity — the
 * duplicate-race handling in ProvisionUserOnFirstLogin keys on that substring).
 */

'use strict';

function InMemoryUserRepository() {
  this._rows = []; // DB-shape user rows
}

InMemoryUserRepository.prototype.findByEmail = async function (email) {
  return this._rows.find(function (r) { return r.email === email; });
};

InMemoryUserRepository.prototype.findById = async function (id) {
  return this._rows.find(function (r) { return r.id === id; });
};

InMemoryUserRepository.prototype.insertUser = async function (row) {
  var collision = this._rows.some(function (r) {
    return r.id === row.id || r.email === row.email;
  });
  if (collision) {
    // ER_DUP_ENTRY message shape — the use-case matches on 'Duplicate'
    throw new Error("Duplicate entry '" + row.email + "' for key 'users.email'");
  }
  this._rows.push(Object.assign({}, row));
};

InMemoryUserRepository.prototype.updateTimezone = async function (id, timezone) {
  var row = this._rows.find(function (r) { return r.id === id; });
  if (row) row.timezone = timezone;
};

module.exports = InMemoryUserRepository;

/**
 * ProvisionUserOnFirstLogin — application command use-case (999.1197).
 *
 * Extracted VERBATIM from the jwt-auth middleware's inline lookup/provision
 * block: resolves the local user row for a verified auth-service identity,
 * provisioning it on first login. The middleware verifies the JWT and then
 * delegates here; DB access goes through the injected UserRepositoryPort.
 *
 * Behavior (identical to the legacy middleware block):
 *   1. findByEmail(authUser.email) — an existing row wins, NO write happens
 *      (999.1222 RULING: users.timezone is owned by Settings only; the former
 *      per-request silent overwrite is removed and must never come back).
 *   2. First login: INSERT with id = authUser.id — the provisioning INVARIANT
 *      (auth-service user id == local user id) is enforced here and only here.
 *   3. timezone is seeded ONCE from `browserTimezone` (the X-Browser-Timezone
 *      header — the REAL browser IANA zone; X-Timezone is display-only and is
 *      deliberately never read) when it is a valid IANA name; otherwise
 *      'America/New_York' — the schema-approved default (999.1222).
 *   4. Duplicate race: a concurrent first-login request may INSERT first; the
 *      loser's insert rejects with an ER_DUP_ENTRY ('Duplicate…') error →
 *      warn (observable, with email context) and fall through to the re-fetch.
 *      Any other insert error is rethrown (fail loud).
 *   5. Post-insert fetch by id; a still-missing row throws 'User provision
 *      failed' (fail loud — no silent unauthenticated fall-through).
 *
 * @typedef {Object} ProvisionUserOnFirstLoginDeps
 * @property {import('../../domain/ports/UserRepositoryPort')} userRepository
 * @property {{warn: Function}} logger
 */

'use strict';

function ProvisionUserOnFirstLogin(deps) {
  this._users = deps.userRepository;
  this._logger = deps.logger;
}

/**
 * @param {Object} input
 * @param {{id: *, email: string, name: string, picture: ?string}} input.authUser
 *   Verified auth-service token claims.
 * @param {string} [input.browserTimezone]  Raw X-Browser-Timezone header value.
 * @returns {Promise<Object>} the local user row (DB shape)
 */
ProvisionUserOnFirstLogin.prototype.execute = async function execute(input) {
  var authUser = input.authUser;
  var existing = await this._users.findByEmail(authUser.email);
  if (existing) return existing;

  // First login — provision user in local DB using auth-service claims
  var newId = authUser.id; // INVARIANT: use auth-service ID as local ID
  var detectedTz = input.browserTimezone;
  if (detectedTz && typeof detectedTz === 'string') {
    try { Intl.DateTimeFormat(undefined, { timeZone: detectedTz }); }
    catch (_e) { detectedTz = null; } // invalid IANA name → skip
  }
  try {
    await this._users.insertUser({
      id: newId,
      email: authUser.email,
      name: authUser.name,
      picture_url: authUser.picture || null, // nullable column; claim may be absent (pre-existing)
      timezone: detectedTz || 'America/New_York', // schema-approved default (999.1222)
    });
  } catch (insertErr) {
    // Concurrent request raced us — duplicate email insert; ignore and fetch below
    if (!insertErr.message?.includes('Duplicate')) throw insertErr;
    this._logger.warn('jwt-auth: concurrent first-login insert race, fetching existing row', { email: authUser.email });
  }
  var provisioned = await this._users.findById(newId);
  if (!provisioned) throw new Error('User provision failed');
  return provisioned;
};

module.exports = ProvisionUserOnFirstLogin;

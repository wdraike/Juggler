/**
 * UpdateUserTimezone — application command use-case (999.1447).
 *
 * Settings writer for `users.timezone`. Before 999.1447 the column was
 * write-once at first-login provisioning (ProvisionUserOnFirstLogin, seeded
 * from the X-Browser-Timezone header) with no correction path. Per the
 * 2026-07-06 ruling (999.1222), timezone is Settings-owned — this is the
 * writer that ruling implied but that provisioning alone doesn't provide.
 *
 * Validation mirrors ProvisionUserOnFirstLogin's IANA check exactly
 * (Intl.DateTimeFormat throws on an unrecognized zone name) so both paths
 * agree on what counts as a valid timezone.
 *
 * @typedef {Object} UpdateUserTimezoneDeps
 * @property {import('../../domain/ports/UserRepositoryPort')} userRepository
 */

'use strict';

function UpdateUserTimezone(deps) {
  if (!deps || !deps.userRepository) {
    throw new Error('UpdateUserTimezone: { userRepository } is required');
  }
  this._users = deps.userRepository;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {*} input.timezone  candidate IANA zone name (any type — validated here).
 * @returns {Promise<{ status: number, body: Object }>}
 */
UpdateUserTimezone.prototype.execute = async function execute(input) {
  var userId = input.userId;
  var timezone = input.timezone;

  if (typeof timezone !== 'string' || timezone.length === 0) {
    return { status: 400, body: { error: 'timezone must be a non-empty string' } };
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch (_e) {
    return { status: 400, body: { error: 'Invalid IANA timezone: ' + timezone } };
  }

  await this._users.updateTimezone(userId, timezone);
  return { status: 200, body: { timezone: timezone } };
};

module.exports = UpdateUserTimezone;

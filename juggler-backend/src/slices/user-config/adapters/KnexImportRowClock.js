/**
 * KnexImportRowClock — the v7-import task-row builder's server-clock timestamp
 * source, moved VERBATIM out of user-config/facade.js's importBuildTaskRow
 * (JUG-FACADE-DB-VIOLATIONS stage 2b) so the facade carries no direct db access.
 *
 * Deliberately NOT KnexConfigRepository: that repository's own docblock (P1 /
 * ADR-0003) states "there is intentionally ZERO fn.now() reference in any
 * ConfigRepositoryPort implementation" — the import task-row created_at/updated_at
 * is a pre-existing, un-corrected legacy quirk (facade.js's importBuildTaskRow
 * comment: "the import insert is a task-table write outside the config repo, so
 * its timestamps are NOT in KnexConfigRepository's P1 scope — it stays as the
 * legacy did"). Reproduced as-is here, not fixed.
 */

'use strict';

var libDb = require('../../../lib/db');
function getDb() { return libDb.getDefaultDb(); }

/**
 * The MySQL server-clock NOW() raw expression (knex `fn.now()`) — verbatim
 * relocation of importBuildTaskRow's `getDb().fn.now()` (used for both
 * created_at and updated_at on the import insert path).
 * @returns {*} knex raw expression
 */
function now() {
  return getDb().fn.now();
}

module.exports = { now: now };

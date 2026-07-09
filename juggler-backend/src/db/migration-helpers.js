'use strict';

/**
 * migration-helpers.js — shared helpers for VIEW-recreating migrations.
 *
 * Traceability: 999.1189 (single-source the copy-pasted helper trio) and
 * 999.1096 (portableViewSql dropped the view's SQL SECURITY clause).
 *
 * Background: tasks_v / tasks_with_sync_v are recreated by many migrations.
 * The safe pattern (established by 20260624120000) is to read the LIVE view
 * definition via SHOW CREATE VIEW, strip the non-portable preamble with
 * portableViewSql(), string-patch the projected columns, then DROP + CREATE.
 * That trio of helpers (portableViewSql / replaceAll / countOccurrences) was
 * copy-pasted byte-identically into 5 migrations (20260624120000,
 * 20260703190000, 20260703210000, 20260703220000, 20260709120000). Those
 * copies are APPLIED migrations and stay untouched per the immutability
 * policy in juggler/CLAUDE.md (999.733) — they will never run again in any
 * environment that has them recorded. All FUTURE view migrations must
 * require this module instead of pasting a 6th copy:
 *
 *   var { portableViewSql, replaceAll, countOccurrences } =
 *     require('../migration-helpers');
 *
 * Precedent for migrations requiring shared modules: 20260527213906 already
 * requires lib/task-status.
 *
 * See also src/db/views/ — the canonical SSOT for the CURRENT shape of
 * tasks_v / tasks_with_sync_v, enforced by
 * tests/migrations/view-column-contract.test.js. After any migration that
 * changes either view's shape, regenerate the SSOT with
 * scripts/regenerate-canonical-views.js (the contract test fails until you
 * do).
 */

/**
 * Strip the non-portable ALGORITHM/DEFINER preamble from a SHOW CREATE VIEW
 * statement so the definition can be re-created cleanly in any environment,
 * while PRESERVING the view's original SQL SECURITY clause.
 *
 * 999.1096 fix: the legacy copies of this helper (inlined in the five
 * applied migrations listed above) collapsed the whole preamble to a bare
 * 'CREATE VIEW', silently normalizing every recreated view to MySQL's
 * default SQL SECURITY DEFINER — an INVOKER view came back DEFINER after
 * its first recreation. This version captures and re-emits the original
 * 'SQL SECURITY <type>' (same approach as the canonical-views regeneration
 * in scripts/regenerate-canonical-views.js). DEFINER itself is still
 * intentionally dropped: it embeds an environment-specific user@host that
 * must not be replayed across environments.
 *
 * @param {string} createViewStmt  Raw 'Create View' column from SHOW CREATE VIEW.
 * @returns {string} 'CREATE SQL SECURITY <type> VIEW `name` AS ...'
 */
function portableViewSql(createViewStmt) {
  return String(createViewStmt).replace(
    /^CREATE\s+ALGORITHM=\S+\s+DEFINER=`[^`]+`@`[^`]+`\s+SQL SECURITY (\w+)\s+VIEW/i,
    'CREATE SQL SECURITY $1 VIEW'
  );
}

/**
 * Replace every occurrence of `needle` in `haystack` (literal, no regex).
 */
function replaceAll(haystack, needle, replacement) {
  return haystack.split(needle).join(replacement);
}

/**
 * Count literal occurrences of `needle` in `haystack`.
 */
function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

module.exports = { portableViewSql, replaceAll, countOccurrences };

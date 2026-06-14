/**
 * assertDeps — shared dependency-presence guard for the task application
 * command constructors (Phase H3 / W5).
 *
 * BEHAVIOR-IDENTICAL extraction of the loop each command constructor ran inline.
 * Throws on the FIRST missing/null/undefined required dep, with the EXACT same
 * message the inline loop produced: `'<ctorName>: missing dependency "<dep>"'`.
 * The `!deps ||` short-circuit is preserved so a falsy `deps` throws on the
 * first required key (matching the original per-constructor behavior).
 *
 * @param {string} ctorName  The constructor name used as the message prefix.
 * @param {Object} deps      The injected dependency bag (may be falsy).
 * @param {string[]} required The required dependency keys, in order.
 * @throws {Error} on the first missing/null/undefined required dep.
 */
'use strict';

function assertDeps(ctorName, deps, required) {
  for (var i = 0; i < required.length; i++) {
    if (!deps || deps[required[i]] === undefined || deps[required[i]] === null) {
      throw new Error(ctorName + ': missing dependency "' + required[i] + '"');
    }
  }
}

module.exports = assertDeps;

/**
 * KnexReferenceValidator — DB-backed existence validation for task_masters'
 * three reference-array JSON columns, moved VERBATIM from task/facade.js's
 * validateTaskReferences (JUG-FACADE-DB-VIOLATIONS stage 4) so the facade
 * carries no direct db access (adapters are the slice's only DB layer — see
 * eslint.boundaries.config.js DB_DIRECT_SELECTORS).
 *
 * ── validateReferences (999.586) ─────────────────────────────────────────────
 * The pure validateTaskInput() already rejected malformed SHAPES (non-array /
 * non-string elements); this checks that referenced IDs actually EXIST and
 * belong to the user:
 *   - depends_on → every id must be one of the user's task_masters.id values.
 *     (Cycle detection is OUT of scope — that is backlog item 999.587.)
 *   - location   → every id must be one of the user's locations.location_id values.
 *   - tools      → every id must be one of the user's tools.tool_id values.
 * Returns an array of human-readable error strings (empty = valid), matching the
 * validateTaskInput() contract so the use-case can merge + 400 uniformly.
 * Only fields PRESENT in `body` are checked (partial updates don't re-validate
 * untouched fields). Empty arrays are valid (they clear the field).
 */

'use strict';

var libDb = require('../../../lib/db');
function getDb() { return libDb.getDefaultDb(); }

async function validateReferences(userId, body) {
  var errors = [];
  var db = getDb();

  if (Array.isArray(body.dependsOn) && body.dependsOn.length > 0) {
    var depIds = body.dependsOn.slice();
    var foundDeps = await db('task_masters')
      .where('user_id', userId)
      .whereIn('id', depIds)
      .select('id');
    var foundDepSet = {};
    foundDeps.forEach(function (r) { foundDepSet[r.id] = true; });
    var missingDeps = depIds.filter(function (id) { return !foundDepSet[id]; });
    if (missingDeps.length > 0) {
      errors.push('dependsOn references unknown task ID(s): ' + missingDeps.join(', '));
    }
  }

  if (Array.isArray(body.location) && body.location.length > 0) {
    var locIds = body.location.slice();
    var foundLocs = await db('locations')
      .where('user_id', userId)
      .whereIn('location_id', locIds)
      .select('location_id');
    var foundLocSet = {};
    foundLocs.forEach(function (r) { foundLocSet[r.location_id] = true; });
    var missingLocs = locIds.filter(function (id) { return !foundLocSet[id]; });
    if (missingLocs.length > 0) {
      errors.push('location references unknown location ID(s): ' + missingLocs.join(', '));
    }
  }

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    var toolIds = body.tools.slice();
    var foundTools = await db('tools')
      .where('user_id', userId)
      .whereIn('tool_id', toolIds)
      .select('tool_id');
    var foundToolSet = {};
    foundTools.forEach(function (r) { foundToolSet[r.tool_id] = true; });
    var missingTools = toolIds.filter(function (id) { return !foundToolSet[id]; });
    if (missingTools.length > 0) {
      errors.push('tools references unknown tool ID(s): ' + missingTools.join(', '));
    }
  }

  return errors;
}

module.exports = { validateReferences: validateReferences };

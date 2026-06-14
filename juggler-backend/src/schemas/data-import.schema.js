/**
 * data-import.schema — Zod validation for the v7 data-import body
 * (two-mode import, Wave 1 / W1).
 *
 * The v7 import body is the mirror of the ExportData query's output shape
 * (queries/ExportData.js): `extraTasks` (the tasks array) plus the config
 * singletons (statuses/toolMatrix/timeBlocks/locSchedules.../hourLocationOverrides),
 * the entity lists (locations/tools/projects) and the scalar preferences
 * (gridZoom/splitDefault/splitMinDefault/schedFloor/schedCeiling).
 *
 * ── WHERE THIS RUNS (BINDING) ─────────────────────────────────────────────────
 * This schema is consumed by the APPLICATION layer (a later wave), NOT mounted as
 * route middleware. The legacy `!data || !data.extraTasks` shape guard
 * (commands/ImportData.js:70) still owns the "Invalid import data" 400 message that
 * the golden-master (H2-6) pins. Mounting this as `validate(...)` route middleware
 * would change that error message + body and break the golden-master — so it is NOT
 * mounted on the route. The application layer calls `validateImportBody()` AFTER the
 * legacy shape + destructive-confirm guards and returns 400 with ZERO DB writes on a
 * schema failure.
 *
 * ── PASSTHROUGH (BINDING) ─────────────────────────────────────────────────────
 * `.passthrough()` at the object level keeps UNKNOWN top-level keys (the export /
 * golden-master valid-import bodies carry extra keys such as `v7`, `updated`, …),
 * matching the existing config.schema.js / facade.js `.passthrough()` idiom. Use
 * `.passthrough()`, NEVER `.strict()`.
 *
 * ── NO NEW FALLBACKS ──────────────────────────────────────────────────────────
 * The schema validates shape only; it supplies NO `.default(...)` values. The
 * application layer keeps the legacy `|| <default>` extraction verbatim — the schema
 * never silently substitutes a missing value.
 */

'use strict';

var { z } = require('zod');

// Entity-list item shapes: objects, permissive on their own fields (the import
// body carries id/name/icon/color and may carry export-only extras). passthrough
// so unknown per-item keys survive — mirrors config.schema.js item schemas.
var objectItemSchema = z.object({}).passthrough();

/**
 * The v7 import body schema.
 *
 * `extraTasks` is REQUIRED and MUST be an array — a non-array (string/number/object)
 * is rejected as invalid. Every other field is optional. The object-level
 * `.passthrough()` ALLOWS unknown top-level keys.
 */
var dataImportSchema = z.object({
  // REQUIRED array — the one field the import cannot proceed without.
  extraTasks: z.array(objectItemSchema),

  // entity lists — arrays of objects, optional.
  locations: z.array(objectItemSchema).optional(),
  tools: z.array(objectItemSchema).optional(),
  projects: z.array(objectItemSchema).optional(),

  // config singletons — objects, optional.
  statuses: z.object({}).passthrough().optional(),
  toolMatrix: z.object({}).passthrough().optional(),
  timeBlocks: z.object({}).passthrough().optional(),
  locSchedules: z.object({}).passthrough().optional(),
  locScheduleDefaults: z.object({}).passthrough().optional(),
  locScheduleOverrides: z.object({}).passthrough().optional(),
  hourLocationOverrides: z.object({}).passthrough().optional(),

  // scalar preferences — numbers, optional.
  gridZoom: z.number().optional(),
  splitMinDefault: z.number().optional(),
  schedFloor: z.number().optional(),
  schedCeiling: z.number().optional(),

  // scalar preference — boolean, optional.
  splitDefault: z.boolean().optional(),
}).passthrough();

/**
 * Validate an import body against the v7 schema.
 *
 * Mirrors middleware/validate.js semantics (flattens `error.issues` into
 * `'path: message'` strings) but returns a plain result object the application
 * layer maps to a 400 — it does NOT touch req/res, so the use-case stays
 * express-free and the legacy error message/body is preserved by the caller.
 *
 * @param {*} body  the request body to validate.
 * @returns {{ ok: boolean, data: ?Object, errors: ?string[] }}
 *   ok=true  → { ok: true, data: <parsed body>, errors: null }
 *   ok=false → { ok: false, data: null, errors: ['path: message', …] }
 */
function validateImportBody(body) {
  var result = dataImportSchema.safeParse(body);
  if (!result.success) {
    var errors = result.error.issues.map(function (e) {
      return e.path.join('.') + ': ' + e.message;
    });
    return { ok: false, data: null, errors: errors };
  }
  return { ok: true, data: result.data, errors: null };
}

module.exports = {
  dataImportSchema: dataImportSchema,
  validateImportBody: validateImportBody,
};

/**
 * config.schema — Zod validation for config keys that require server-side
 * shape checks before write.
 *
 * ── AUDIT (999.687) ──────────────────────────────────────────────────────────
 * The previous schema validated `temperatureUnit`, `weekStartsOn`,
 * `defaultDuration`, and `timezone` — none of which are used by the frontend
 * or backend. The real preferences object stores:
 *   splitDefault, splitMinDefault, gridZoom, schedFloor, schedCeiling,
 *   fontSize, pullForwardDampening, calCompletedBehavior, timezoneOverride
 * The schema has been updated to validate these actual fields.
 * `temp_unit_pref` is a separate config key (not inside `preferences`) and
 * has its own F/C guard in UpdateConfig.
 */

'use strict';

const { z } = require('zod');

const preferencesSchema = z.object({
  splitDefault: z.boolean().optional(),
  splitMinDefault: z.number().int().min(5).max(480).optional(),
  gridZoom: z.number().int().min(10).max(300).optional(),
  schedFloor: z.number().int().min(0).max(1380).optional(),
  schedCeiling: z.number().int().min(60).max(1440).optional(),
  fontSize: z.number().int().min(50).max(200).optional(),
  pullForwardDampening: z.boolean().optional(),
  calCompletedBehavior: z.enum(['update', 'keep', 'delete']).optional(),
  timezoneOverride: z.string().max(100).optional(),
}).passthrough();

module.exports = { preferencesSchema };
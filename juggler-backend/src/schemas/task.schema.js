'use strict';

const { z } = require('zod');

const VALID_PRI = ['P1', 'P2', 'P3', 'P4'];
// 'missed' is a valid terminal status (ruling 2026-07-06, resolves 999.844:
// cancelled AND missed are both terminal). The DB CHECK constraints include it
// (migration 20260703000000) and shared/task-status.js lists it in
// TERMINAL_STATUSES — the update schema must not reject it (999.1418).
const VALID_STATUS = ['', 'done', 'cancel', 'skip', 'pause', 'missed'];
const VALID_PRECIP = ['any', 'wet_ok', 'light_ok', 'dry_only'];
const VALID_CLOUD = ['any', 'overcast_ok', 'partly_ok', 'clear'];
const VALID_TEMP_UNIT = ['F', 'C'];

// Schema uses camelCase to match frontend field names. .passthrough() preserves
// any fields not yet listed here (e.g. timeFlex, recurring) so they reach the
// controller intact.
const taskCreateSchema = z.object({
  text: z.string().min(1).max(500),
  pri: z.enum(VALID_PRI).optional().default('P3'),
  dur: z.number().int().min(5).max(480).optional(),
  project: z.string().max(100).optional(),
  location: z.array(z.any()).optional(),
  tools: z.array(z.string()).optional(),
  recur: z.union([z.string().max(200), z.object({}).passthrough()]).optional().nullable(),
  split: z.boolean().optional(),
  dependsOn: z.array(z.string().uuid()).optional(),
  url: z.string().url().max(2048).optional().nullable(),
  when: z.string().max(200).optional(),
  travelBefore: z.number().int().min(0).max(120).optional(),
  travelAfter: z.number().int().min(0).max(120).optional(),
  weatherPrecip: z.enum(VALID_PRECIP).optional(),
  weatherCloud: z.enum(VALID_CLOUD).optional(),
  weatherTempMin: z.number().min(-60).max(150).optional().nullable(),
  weatherTempMax: z.number().min(-60).max(150).optional().nullable(),
  weatherTempUnit: z.enum(VALID_TEMP_UNIT).optional(),
  weatherHumidityMin: z.number().int().min(0).max(100).optional().nullable(),
  weatherHumidityMax: z.number().int().min(0).max(100).optional().nullable(),
}).passthrough();

const taskUpdateSchema = taskCreateSchema.partial().extend({
  status: z.enum(VALID_STATUS).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
}).passthrough();

module.exports = { taskCreateSchema, taskUpdateSchema };

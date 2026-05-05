'use strict';

const { z } = require('zod');

const VALID_PRI = ['P1', 'P2', 'P3', 'P4'];
const VALID_STATUS = ['', 'wip', 'done', 'cancel', 'skip', 'pause'];
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
  location: z.string().max(100).optional(),
  tools: z.string().max(500).optional(),
  recur: z.string().max(200).optional().nullable(),
  split: z.boolean().optional(),
  dependsOn: z.string().uuid().optional().nullable(),
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

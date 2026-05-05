'use strict';

const { z } = require('zod');

const VALID_PRI = ['P1', 'P2', 'P3', 'P4'];
const VALID_STATUS = ['', 'wip', 'done', 'cancel', 'skip', 'pause'];
const VALID_PRECIP = ['any', 'wet_ok', 'light_ok', 'dry_only'];
const VALID_CLOUD = ['any', 'overcast_ok', 'partly_ok', 'clear'];
const VALID_TEMP_UNIT = ['F', 'C'];

const taskCreateSchema = z.object({
  text: z.string().min(1).max(500),
  pri: z.enum(VALID_PRI).optional().default('P3'),
  dur: z.number().int().min(5).max(480).optional(),
  project: z.string().max(100).optional(),
  location: z.string().max(100).optional(),
  tools: z.string().max(500).optional(),
  desired_at: z.string().datetime({ offset: true }).optional().nullable(),
  recur: z.string().max(200).optional().nullable(),
  split: z.boolean().optional(),
  depends_on: z.string().uuid().optional().nullable(),
  url: z.string().url().max(2048).optional().nullable(),
  when: z.string().max(200).optional(),
  travel_before: z.number().int().min(0).max(120).optional(),
  travel_after: z.number().int().min(0).max(120).optional(),
  weather_precip: z.enum(VALID_PRECIP).optional(),
  weather_cloud: z.enum(VALID_CLOUD).optional(),
  weather_temp_min: z.number().min(-60).max(150).optional().nullable(),
  weather_temp_max: z.number().min(-60).max(150).optional().nullable(),
  weather_temp_unit: z.enum(VALID_TEMP_UNIT).optional(),
  weather_humidity_min: z.number().int().min(0).max(100).optional().nullable(),
  weather_humidity_max: z.number().int().min(0).max(100).optional().nullable(),
});

const taskUpdateSchema = taskCreateSchema.partial().extend({
  status: z.enum(VALID_STATUS).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional().nullable(),
});

module.exports = { taskCreateSchema, taskUpdateSchema };

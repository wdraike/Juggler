'use strict';

const { z } = require('zod');

const preferencesSchema = z.object({
  temperatureUnit: z.enum(['F', 'C']).optional(),
  weekStartsOn: z.number().int().min(0).max(6).optional(),
  defaultDuration: z.number().int().min(5).max(480).optional(),
  timezone: z.string().max(50).optional(),
}).passthrough();

module.exports = { preferencesSchema };

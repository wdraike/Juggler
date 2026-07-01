'use strict';

/**
 * scheduler-task.schema — Zod validation for the Cloud Tasks push-handler
 * body (999.996, residual of 999.950's route-validation sweep).
 *
 * Body shape written by the enqueue side (scheduler/queue-backend.js:65):
 *   { userId, source, enqueuedAt }
 */

const { z } = require('zod');

const pushTaskSchema = z.object({
  userId: z.string().min(1).max(255),
  source: z.string().min(1).max(255).optional(),
  enqueuedAt: z.number().optional(),
}).passthrough();

module.exports = { pushTaskSchema };

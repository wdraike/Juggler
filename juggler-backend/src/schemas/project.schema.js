'use strict';

const { z } = require('zod');

const projectSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  icon: z.string().max(10).optional(),
});

const projectUpdateSchema = projectSchema.partial();

module.exports = { projectSchema, projectUpdateSchema };

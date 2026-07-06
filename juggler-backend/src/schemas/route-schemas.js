/**
 * route-schemas — Zod validation schemas for write routes that lacked
 * route-level validation (999.1039). Schemas mirror the body shapes the
 * facade/application use-cases already validate internally — this is
 * defense-in-depth at the route edge, following the 999.950 pattern.
 *
 * ponytail: one file for all new schemas rather than one-per-route —
 * these are small permissive shape guards, not domain models.
 */

'use strict';

const { z } = require('zod');

// ── task.routes.js: batch + status ──────────────────────────────────────────
// These mirror the facade's internal schemas (facade.js:105-126) but as
// route-level shape guards. The facade schemas remain the authoritative
// validation; these catch grossly malformed bodies early.

const taskPatchShape = z.object({
  id: z.string().optional(),
  text: z.string().max(500).optional(),
  dur: z.number().int().min(1).max(480).optional(),
  pri: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  status: z.string().optional(),
  notes: z.string().max(10000).optional(),
  project: z.string().max(100).optional(),
  deadline: z.string().nullable().optional(),
  recurring: z.boolean().optional(),
}).passthrough();

const batchCreateRouteSchema = z.object({
  tasks: z.array(taskPatchShape).min(1).max(100),
}).passthrough();

const batchUpdateRouteSchema = z.object({
  updates: z.array(taskPatchShape.extend({ id: z.string().min(1) })).min(1).max(2000),
}).passthrough();

const taskStatusRouteSchema = z.object({
  status: z.enum(['', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled']),
  completedAt: z.string().optional(),
  direction: z.string().optional(),
}).passthrough();

// ── project.routes.js: reorder ──────────────────────────────────────────────
const projectReorderSchema = z.object({
  ids: z.array(z.union([z.number(), z.string()])).max(500),
}).passthrough();

// ── location.routes.js: replace all ─────────────────────────────────────────
// Body is an object wrapper ({ locations: [...] }), mirroring facade.js:103
// (locationsBodySchema) — not a bare array. See BUG-999.1221.
const locationReplaceSchema = z.object({
  locations: z.array(z.object({}).passthrough()).max(500),
}).passthrough();

// ── tool.routes.js: replace all ─────────────────────────────────────────────
// Body is an object wrapper ({ tools: [...] }), mirroring facade.js:110
// (toolsBodySchema) — not a bare array. See BUG-999.1221.
const toolReplaceSchema = z.object({
  tools: z.array(z.object({}).passthrough()).max(500),
}).passthrough();

// ── impersonation.routes.js: start (sensitive — admin-only) ─────────────────
const impersonationStartSchema = z.object({
  targetUserId: z.string().min(1),
  reason: z.string().max(500).optional(),
}).passthrough();

// ── apple-cal.routes.js ─────────────────────────────────────────────────────
const appleCalConnectSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
  serverUrl: z.string().url().max(500).optional(),
}).passthrough();

const appleCalSelectSchema = z.object({
  calendarUrl: z.string().min(1).max(2000),
}).passthrough();

const appleCalSelectCalendarsSchema = z.object({
  calendars: z.array(z.object({}).passthrough()).min(1),
}).passthrough();

const appleCalAutoSyncSchema = z.object({
  enabled: z.boolean(),
}).passthrough();

module.exports = {
  batchCreateRouteSchema,
  batchUpdateRouteSchema,
  taskStatusRouteSchema,
  projectReorderSchema,
  locationReplaceSchema,
  toolReplaceSchema,
  impersonationStartSchema,
  appleCalConnectSchema,
  appleCalSelectSchema,
  appleCalSelectCalendarsSchema,
  appleCalAutoSyncSchema,
};
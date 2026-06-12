/**
 * Scheduler domain core — barrel re-export (Phase H6 / W1).
 *
 * PURE layer: solvers (logic) + entities + value-objects. ZERO infra imports
 * (no knex / src/db / lib/db / redis / fs / controllers) — the H6 design contract
 * for the extractable pure core. Verified by the W1 pure-core grep gate.
 *
 * The three solvers compose into the scheduling pipeline:
 *   ConstraintSolver — most-constrained → least ordering (S1) + severity (S2) +
 *                      recurrence/day-of-week classification (S3 inputs).
 *   ConflictResolver — occupancy primitives + calendar-busy collision detection.
 *   ScoreEngine      — schedule quality scoring (houses scoreSchedule.js logic).
 *
 * `unifiedScheduleV2.js` (the legacy pure entry point) delegates its ordering and
 * occupancy primitives here; `scoreSchedule.js` delegates scoring to ScoreEngine.
 * The H6 golden-master runs through the legacy entry point and pins every output
 * bit-for-bit, so this tree is a structural reorganization — not a behavior change.
 *
 * PlacementMode is REUSED from the task slice (S7 closed-enum) rather than
 * duplicated — there is one canonical placement-mode VO in the codebase.
 *
 * Mirrors the flat re-export style of `slices/task/domain/index.js`.
 */

'use strict';

module.exports = {
  // Solvers (pure logic core)
  ConstraintSolver: require('./logic/ConstraintSolver'),
  ConflictResolver: require('./logic/ConflictResolver'),
  ScoreEngine: require('./logic/ScoreEngine'),
  // Entities
  Schedule: require('./entities/Schedule'),
  ScheduledTask: require('./entities/ScheduledTask'),
  ScoredSchedule: require('./entities/ScoredSchedule'),
  Constraint: require('./entities/Constraint'),
  // Value objects (closed enums / typed primitives)
  Priority: require('./value-objects/Priority'),
  TimeWindow: require('./value-objects/TimeWindow'),
  Deadline: require('./value-objects/Deadline'),
  // Reused from the task slice — the one canonical placement-mode VO (S7).
  PlacementMode: require('../../task/domain/value-objects/PlacementMode')
};

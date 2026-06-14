/**
 * Task domain core — barrel re-export (Phase H3 / W2).
 *
 * PURE layer: value-objects + mappers + validation. Zero infra
 * imports (no knex / src/db / lib/db / express / SDK) — DESIGN §7. Consumers
 * (W3 repository, W5 application) import from here; nothing in this tree reaches
 * the DB.
 *
 * Mirrors the flat re-export style of `slices/weather/index.js`.
 */

'use strict';

module.exports = {
  // Value objects (closed enums)
  TaskId: require('./value-objects/TaskId'),
  TaskStatus: require('./value-objects/TaskStatus'),
  PlacementMode: require('./value-objects/PlacementMode'),
  // Pure mappers (relocated, byte-identical to the legacy controller helpers)
  mappers: require('./mappers/taskMappers'),
  // Pure validation + edit guards (relocated)
  validation: require('./validation/taskValidation')
};

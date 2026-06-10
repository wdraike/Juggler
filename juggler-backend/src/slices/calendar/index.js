/**
 * Calendar slice — module exports (Wave 4 / W4).
 *
 * Re-exports the facade so consumers/tests can use either README shape:
 *
 *   // namespaced (README "Basic Usage" / "Facade Operations")
 *   const { calendar } = require('./slices/calendar');
 *   const facade = calendar.initialize();
 *   const gcal = calendar.getAdapter('gcal');
 *
 *   // direct named (README "Using the In-Memory Adapter for Tests")
 *   const { InMemoryCalendarAdapter } = require('./slices/calendar');
 *
 * No logic lives here — it is a flat re-export of facade.js.
 */

var facade = require('./facade');

module.exports = Object.assign({ calendar: facade }, facade);

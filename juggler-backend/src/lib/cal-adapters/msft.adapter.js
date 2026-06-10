/**
 * Microsoft Calendar adapter — BACK-COMPAT RE-EXPORT SHIM (Wave 5 / W5).
 *
 * The real logic now lives in the calendar hexagonal slice and is exposed via
 * the slice facade:
 *   src/slices/calendar/adapters/MicrosoftCalendarAdapter.js
 *   src/slices/calendar/facade.js (MicrosoftCalendarAdapter export)
 *
 * This shim re-exports the SAME adapter object FROM the facade (boundary-
 * allowed), so the export surface is byte-identical for remaining importers:
 *   - frozen migration history that references cal-adapters
 *
 * The live controllers now import directly from the facade (W5); this shim is
 * retained only for the frozen migration require graph.
 *
 * Do NOT add logic here — edit the slice adapter instead.
 */

module.exports = require('../../slices/calendar/facade').MicrosoftCalendarAdapter;

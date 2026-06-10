/**
 * Calendar adapter registry — BACK-COMPAT RE-EXPORT SHIM (Wave 5 / W5).
 *
 * The registry now lives in the calendar slice facade
 * (src/slices/calendar/facade.js), which owns the {gcal, msft, apple} adapter
 * map directly. This shim re-exports the SAME four registry functions FROM the
 * facade (boundary-allowed — importing the facade, not slice internals), so the
 * export surface is byte-identical for the frozen migration require graph.
 *
 * Do NOT add logic here — edit the facade registry instead.
 */

var facade = require('../../slices/calendar/facade');

module.exports = {
  getAllAdapters: facade.getAllAdapters,
  getConnectedAdapters: facade.getConnectedAdapters,
  getAdapter: facade.getAdapter,
  registerAdapter: facade.registerAdapter
};

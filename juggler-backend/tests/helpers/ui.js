/**
 * test-helpers/ui.js
 *
 * mockUIValidation — a self-contained model of the FRONTEND form-validation rule
 * that fixed placement and recurring are mutually exclusive ("Fixed mode not
 * available for recurring tasks"). The real enforcement lives in the React
 * frontend (juggler-frontend WhenSection.jsx / TaskEditForm.jsx); there is NO
 * backend code path for it. These backend tests (TS-301, TELLY-17a) document the
 * client-side contract — the gap they exercise is that the BACKEND/API does NOT
 * enforce it (TS-302/303). This helper therefore SIMULATES the UI rule so the
 * documentation tests can assert it; it is not a wrapper over backend product
 * code. See report note: these belong in the frontend suite.
 *
 * Rule modelled:
 *   - placementMode 'fixed' and recurring=true cannot both be active.
 *   - Whichever conflicting value is set SECOND is rejected: an error is raised,
 *     submit is disabled, and the offending field rebounds to its prior value.
 */

var FIXED_RECURRING_ERROR = 'Fixed mode not available for recurring tasks';

function mockUIValidation(initialId) {
  var state = {
    id: initialId || null,
    placementMode: 'anytime',
    recurring: false,
    recurPattern: null,
    time: null,
    error: null
  };

  function conflicts(placementMode, recurring) {
    return placementMode === 'fixed' && recurring === true;
  }

  return {
    setPlacementMode: function (mode) {
      if (conflicts(mode, state.recurring)) {
        // Reject the change — rebound to prior placement mode.
        state.error = FIXED_RECURRING_ERROR;
        return;
      }
      state.placementMode = mode;
      state.error = null;
    },
    setRecurring: function (val) {
      if (conflicts(state.placementMode, val)) {
        // Reject the toggle — rebound recurring to false.
        state.error = FIXED_RECURRING_ERROR;
        state.recurring = false;
        return;
      }
      state.recurring = val;
      state.error = null;
    },
    setRecurPattern: function (pattern) {
      state.recurPattern = pattern;
    },
    setTime: function (t) {
      state.time = t;
    },
    getPlacementMode: function () { return state.placementMode; },
    getRecurring: function () { return state.recurring; },
    getRecurPattern: function () { return state.recurPattern; },
    getTime: function () { return state.time; },
    hasError: function () { return state.error !== null; },
    getErrorMessage: function () { return state.error || ''; },
    isSubmitDisabled: function () { return state.error !== null; }
  };
}

module.exports = { mockUIValidation };

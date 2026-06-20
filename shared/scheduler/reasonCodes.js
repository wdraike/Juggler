/**
 * Canonical unplaced-reason codes for the Juggler scheduler.
 *
 * Single source of truth for the reason-code taxonomy defined in the
 * juggler-recur-nextcycle-unplaced SPEC (Reason-code taxonomy section).
 * Pattern mirrors payment-backend/src/utils/reason-codes.js.
 *
 * Rules:
 *   - NEVER change the string VALUES — they are pinned by tests.
 *   - Import this module everywhere a reason code is set or compared.
 *   - Do not add new codes here without updating REQUIREMENTS.md (R11.16 taxonomy).
 */

'use strict';

var REASON_CODES = Object.freeze({
  // NEW codes added by juggler-recur-nextcycle-unplaced leg (R11.16 gap fill)
  TOOL_CONFLICT:             'tool_conflict',
  LOCATION_MISMATCH:         'location_mismatch',
  NO_SLOT:                   'no_slot',

  // Pre-existing codes (R37.2, R38.2, R19.7, R35.6)
  IMPOSSIBLE_WINDOW:         'impossible_window',
  WEATHER_UNAVAILABLE:       'weather_unavailable',
  WEATHER:                   'weather',          // emitted while AC2.6 rename is deferred (SPEC open-decision #1)
  PARTIAL_SPLIT:             'partial_split',
  RECURRING_SPLIT_OVERFLOW:  'recurring_split_overflow',
  MISSED:                    'missed',
  TPC_BUDGET:                'tpc_budget',
});

var REASON_LABELS = Object.freeze({
  [REASON_CODES.TOOL_CONFLICT]:            'Tool unavailable',
  [REASON_CODES.LOCATION_MISMATCH]:        'Location mismatch',
  [REASON_CODES.NO_SLOT]:                  'No free slot',
  [REASON_CODES.IMPOSSIBLE_WINDOW]:        'Impossible time window',
  [REASON_CODES.WEATHER_UNAVAILABLE]:      'Weather',
  [REASON_CODES.WEATHER]:                  'Weather',
  [REASON_CODES.PARTIAL_SPLIT]:            'Partially placed',
  [REASON_CODES.RECURRING_SPLIT_OVERFLOW]: 'Recurrence overflow',
  [REASON_CODES.MISSED]:                   'Preferred time passed',
  [REASON_CODES.TPC_BUDGET]:               'Not enough cycle time',
});

/**
 * Return a friendly human label for a reason code.
 * Falls back to a humanized version of an unknown code (never crashes).
 *
 * @param {string} code  - snake_case reason code
 * @returns {string}     - friendly label
 */
function labelFor(code) {
  if (!code) return 'Unknown';
  if (REASON_LABELS[code]) return REASON_LABELS[code];
  // Humanize unknown code: replace underscores with spaces, title-case first word
  return code.replace(/_/g, ' ').replace(/^\w/, function(c) { return c.toUpperCase(); });
}

module.exports = {
  REASON_CODES: REASON_CODES,
  REASON_LABELS: REASON_LABELS,
  labelFor: labelFor,
};

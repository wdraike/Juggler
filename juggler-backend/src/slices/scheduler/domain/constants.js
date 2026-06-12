/**
 * Pure domain constants for the scheduler domain core (H6 W1).
 *
 * ZERO side effects: no require('fs'), no crypto, no I/O — safe to require
 * from the pure domain barrel without triggering any filesystem reads.
 *
 * This is the SINGLE SOURCE OF TRUTH for PRI_RANK.
 * `src/scheduler/constants.js` re-exports PRI_RANK FROM this module so there
 * is no duplication — the literal lives here only.
 *
 * Values characterized from the legacy scheduler (unifiedScheduleV2 /
 * scoreSchedule) and pinned by the H6 golden-master (43 scenarios).
 * Do NOT change numeric weights without updating the golden-master.
 */

'use strict';

/**
 * Priority numeric weights. Higher = more important.
 * Characterized from legacy PRI_RANK: { P1: 100, P2: 80, P3: 50, P4: 20 }.
 * Frozen so callers cannot mutate the canonical set.
 */
var PRI_RANK = Object.freeze({ P1: 100, P2: 80, P3: 50, P4: 20 });

module.exports = {
  PRI_RANK: PRI_RANK
};

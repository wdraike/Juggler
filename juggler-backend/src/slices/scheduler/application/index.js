/**
 * Scheduler application layer — barrel re-export (Phase H6 / W3).
 *
 * The I/O orchestrator that wires the W2 ports/adapters to the persist path:
 *   RunScheduleCommand — the SOLE delta-write seam. `runSchedule.js`'s
 *   `runScheduleAndPersist` delegates every DB write here (writeChanged /
 *   deleteTasksWhere / backfillRollingAnchorIfNull / now), removing the inline
 *   knex flush and the 19 inline db.fn.now() (P1). Never imports scheduleQueue
 *   (S4/S6); deadlock-retry + sync-lock stay in the caller (T-TX).
 */

'use strict';

module.exports = {
  RunScheduleCommand: require('./RunScheduleCommand')
};

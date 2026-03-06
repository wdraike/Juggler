/**
 * Location helpers — re-exports from shared/scheduler/locationHelpers.js
 */

const shared = require('juggler-shared/scheduler/locationHelpers');

export const {
  migrateTask,
  resolveLocationId,
  getLocObj,
  resolveDayLocation,
  canTaskRun,
  canTaskRunAtMin,
  getLocationForDatePure,
  getLocationForHourPure,
  isTaskBlockedPure
} = shared;

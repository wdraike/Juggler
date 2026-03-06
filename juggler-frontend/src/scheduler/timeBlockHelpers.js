/**
 * Time block helpers — re-exports from shared/scheduler/timeBlockHelpers.js
 */

const shared = require('juggler-shared/scheduler/timeBlockHelpers');

export const {
  cloneBlocks,
  getBlocksForDate,
  getBlocksForDay,
  buildWindowsFromBlocks,
  getUniqueTags,
  getBlockAtMinute,
  isBizHour,
  parseWhen,
  hasWhen,
  getWhenWindows
} = shared;

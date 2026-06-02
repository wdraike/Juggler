var CalHistoryStatus = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  COMPLETED: 'COMPLETED',
  SKIPPED: 'SKIPPED',
  MISSED: 'MISSED',
  CANCELLED: 'CANCELLED'
});

var CAL_HISTORY_STATUSES = Object.freeze([
  CalHistoryStatus.SCHEDULED,
  CalHistoryStatus.COMPLETED,
  CalHistoryStatus.SKIPPED,
  CalHistoryStatus.MISSED,
  CalHistoryStatus.CANCELLED
]);

var CAL_HISTORY_TERMINAL_STATUSES = Object.freeze([
  CalHistoryStatus.COMPLETED,
  CalHistoryStatus.SKIPPED,
  CalHistoryStatus.MISSED,
  CalHistoryStatus.CANCELLED
]);

function isValidCalHistoryStatus(status) {
  if (status == null) return false;
  return CAL_HISTORY_STATUSES.indexOf(status) !== -1;
}

function isTerminalCalHistoryStatus(status) {
  if (status == null) return false;
  return CAL_HISTORY_TERMINAL_STATUSES.indexOf(status) !== -1;
}

function getCalHistoryStatusDisplayName(status) {
  switch (status) {
    case CalHistoryStatus.SCHEDULED:
      return 'Scheduled';
    case CalHistoryStatus.COMPLETED:
      return 'Completed';
    case CalHistoryStatus.SKIPPED:
      return 'Skipped';
    case CalHistoryStatus.MISSED:
      return 'Missed';
    case CalHistoryStatus.CANCELLED:
      return 'Cancelled';
    default:
      return 'Unknown';
  }
}

module.exports = {
  CalHistoryStatus: CalHistoryStatus,
  CAL_HISTORY_STATUSES: CAL_HISTORY_STATUSES,
  CAL_HISTORY_TERMINAL_STATUSES: CAL_HISTORY_TERMINAL_STATUSES,
  isValidCalHistoryStatus: isValidCalHistoryStatus,
  isTerminalCalHistoryStatus: isTerminalCalHistoryStatus,
  getCalHistoryStatusDisplayName: getCalHistoryStatusDisplayName
};

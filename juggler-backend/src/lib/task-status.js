const STATUS_OPTIONS = Object.freeze(['', 'done', 'cancel', 'skip', 'pause']);
const TERMINAL_STATUSES = Object.freeze(['done', 'cancel', 'skip', 'pause']);

function isTerminalStatus(s) {
  return TERMINAL_STATUSES.indexOf(s) !== -1;
}

module.exports = {
  STATUS_OPTIONS,
  TERMINAL_STATUSES,
  isTerminalStatus
};

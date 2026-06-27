const STATUS_OPTIONS = Object.freeze(['', 'done', 'cancel', 'skip', 'pause', 'missed']);
const TERMINAL_STATUSES = Object.freeze(['done', 'cancel', 'skip', 'pause', 'missed']);

function isTerminalStatus(s) {
  return TERMINAL_STATUSES.indexOf(s) !== -1;
}

module.exports = {
  STATUS_OPTIONS,
  TERMINAL_STATUSES,
  isTerminalStatus
};

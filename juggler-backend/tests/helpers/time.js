let currentClock = null;
let currentTimezone = null;

function mockClock(timeString) {
  currentClock = timeString;
}

function mockTimezone(timezoneString) {
  currentTimezone = timezoneString;
}

function getCurrentClock() {
  return currentClock;
}

function getCurrentTimezone() {
  return currentTimezone;
}

module.exports = { mockClock, mockTimezone, getCurrentClock, getCurrentTimezone };
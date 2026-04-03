/**
 * Time Control for Scheduler Tests
 *
 * Allows tests to simulate any time-of-day by providing controlled
 * todayKey and nowMins values to the scheduler. Also supports running
 * the scheduler repeatedly across simulated days/weeks/months.
 *
 * Usage:
 *   const tc = timeControl('4/3/2026', 'America/New_York');
 *   tc.setTime('8:00 AM');    // nowMins = 480
 *   tc.setTime('2:30 PM');    // nowMins = 870
 *   tc.advanceDay();          // move to 4/4/2026
 *   tc.advanceDays(7);        // jump forward a week
 *
 *   // Run scheduler with controlled time:
 *   const result = unifiedSchedule(tasks, statuses, tc.todayKey, tc.nowMins, cfg);
 */

function parseTimeStr(timeStr) {
  var match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) throw new Error('Invalid time: ' + timeStr);
  var h = parseInt(match[1], 10);
  var m = parseInt(match[2], 10);
  var ampm = (match[3] || '').toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

function parseDateStr(dateStr) {
  // Accept "M/D/YYYY" or "M/D" (assumes 2026)
  var parts = dateStr.split('/');
  var month = parseInt(parts[0], 10);
  var day = parseInt(parts[1], 10);
  var year = parts[2] ? parseInt(parts[2], 10) : 2026;
  return new Date(year, month - 1, day);
}

function formatDateKey(date) {
  return (date.getMonth() + 1) + '/' + date.getDate();
}

var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function timeControl(startDate, timezone) {
  var currentDate = parseDateStr(startDate);
  var currentNowMins = 480; // Default 8:00 AM

  return {
    get todayKey() { return formatDateKey(currentDate); },
    get nowMins() { return currentNowMins; },
    get date() { return new Date(currentDate); },
    get dayName() { return DAY_NAMES[currentDate.getDay()]; },
    get year() { return currentDate.getFullYear(); },
    get timezone() { return timezone || 'America/New_York'; },

    /** Set time of day (e.g., '2:30 PM' or '14:30') */
    setTime: function(timeStr) {
      currentNowMins = parseTimeStr(timeStr);
      return this;
    },

    /** Set time in minutes directly */
    setTimeMins: function(mins) {
      currentNowMins = mins;
      return this;
    },

    /** Advance to the next day, optionally setting time */
    advanceDay: function(time) {
      currentDate.setDate(currentDate.getDate() + 1);
      if (time) this.setTime(time);
      return this;
    },

    /** Advance N days */
    advanceDays: function(n, time) {
      currentDate.setDate(currentDate.getDate() + n);
      if (time) this.setTime(time);
      return this;
    },

    /** Set to a specific date */
    setDate: function(dateStr) {
      currentDate = parseDateStr(dateStr);
      return this;
    },

    /** Generate dateKey for N days from current date */
    dateKey: function(daysFromNow) {
      var d = new Date(currentDate);
      d.setDate(d.getDate() + (daysFromNow || 0));
      return formatDateKey(d);
    },

    /** Run the scheduler with current time context */
    runScheduler: function(tasks, statuses, cfg, schedulerFn) {
      return schedulerFn(tasks, statuses, this.todayKey, this.nowMins, cfg);
    },

    /** Simulate running the scheduler at multiple times throughout a day */
    simulateDay: function(tasks, statuses, cfg, schedulerFn, times) {
      var results = [];
      var timesToRun = times || ['6:00 AM', '8:00 AM', '10:00 AM', '12:00 PM', '2:00 PM', '4:00 PM', '6:00 PM', '8:00 PM', '10:00 PM'];
      for (var i = 0; i < timesToRun.length; i++) {
        this.setTime(timesToRun[i]);
        results.push({
          time: timesToRun[i],
          nowMins: this.nowMins,
          result: schedulerFn(tasks, statuses, this.todayKey, this.nowMins, cfg)
        });
      }
      return results;
    },

    /** Simulate a full week: run scheduler at 8am each day for 7 days */
    simulateWeek: function(tasks, statuses, cfg, schedulerFn, startTime) {
      var results = [];
      var time = startTime || '8:00 AM';
      for (var i = 0; i < 7; i++) {
        this.setTime(time);
        results.push({
          day: this.dayName,
          dateKey: this.todayKey,
          nowMins: this.nowMins,
          result: schedulerFn(tasks, statuses, this.todayKey, this.nowMins, cfg)
        });
        this.advanceDay();
      }
      return results;
    },

    /** Simulate a full month: run scheduler at 8am each day for 30 days */
    simulateMonth: function(tasks, statuses, cfg, schedulerFn, startTime) {
      var results = [];
      var time = startTime || '8:00 AM';
      for (var i = 0; i < 30; i++) {
        this.setTime(time);
        results.push({
          dayIndex: i,
          day: this.dayName,
          dateKey: this.todayKey,
          nowMins: this.nowMins,
          result: schedulerFn(tasks, statuses, this.todayKey, this.nowMins, cfg)
        });
        this.advanceDay();
      }
      return results;
    }
  };
}

module.exports = { timeControl, parseTimeStr, parseDateStr, formatDateKey };

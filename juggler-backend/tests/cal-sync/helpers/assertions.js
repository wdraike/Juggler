/**
 * Field-level assertion helpers for calendar sync tests.
 * Each function verifies that a calendar event exactly matches the
 * corresponding juggler task across EVERY synced dimension — not just
 * that the event was created, but that each field value is correct.
 */

var { jugglerDateToISO, computeDurationMinutes } = require('../../../src/controllers/cal-sync-helpers');

// Strip timezone offset so wall-clock times can be compared.
// '2026-04-26T10:00:00-04:00' -> '2026-04-26T10:00:00'
// '2026-04-26T10:00:00Z'      -> '2026-04-26T10:00:00'
function stripTzOffset(str) {
  return str ? str.replace(/([+-]\d{2}:\d{2}|Z)$/, '') : str;
}

// Parse a scheduled_at value to UTC milliseconds.
// Knex returns DATETIME columns as "YYYY-MM-DD HH:MM:SS" (dateStrings:true,
// timezone:'+00:00') — no tz marker, but always stored/returned in UTC.
// new Date("YYYY-MM-DD HH:MM:SS") parses as local time, so we must append Z.
function scheduledAtToUTC(val) {
  if (!val) return NaN;
  if (val instanceof Date) return val.getTime();
  var s = String(val);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  return new Date(s).getTime();
}

// Compute expected end ISO using the same Date math as buildEventBody.
// Both sides use no-TZ local-time arithmetic so the comparison is symmetric.
function computeEndISO(startISO, durMinutes) {
  var startDate = new Date(startISO);
  var endDate = new Date(startDate.getTime() + durMinutes * 60000);
  return (
    endDate.getFullYear() + '-' +
    String(endDate.getMonth() + 1).padStart(2, '0') + '-' +
    String(endDate.getDate()).padStart(2, '0') + 'T' +
    String(endDate.getHours()).padStart(2, '0') + ':' +
    String(endDate.getMinutes()).padStart(2, '0') + ':00'
  );
}

/**
 * Assert that a raw GCal event exactly matches the juggler task on every
 * dimension that buildEventBody sets.
 *
 * Covers: summary, start dateTime, end dateTime, duration, timeZone,
 *         description (project/notes/url/footer), and transparency.
 *
 * @param {object} event  Raw GCal event from getGCalEvent()
 * @param {object} task   Row from tasks_v — must include .date, .time, .dur,
 *                        .text, .status, .when, .project, .notes, .url, .marker
 * @param {string} tz     User timezone, e.g. 'America/New_York'
 */
function assertGCalEventMatchesTask(event, task, tz) {
  var year = new Date().getFullYear();
  var dur = task.dur || 30;
  var isDone = task.status === 'done';

  // ── Title ────────────────────────────────────────────────────────────────
  expect(event.summary).toBe(isDone ? '✓ ' + task.text : task.text);

  // ── Time ─────────────────────────────────────────────────────────────────
  if (task.when === 'allday') {
    expect(event.start.date).toBeTruthy();
    expect(event.start.dateTime).toBeUndefined();
    expect(event.end.date).toBeTruthy();
    expect(event.end.dateTime).toBeUndefined();
  } else if (task.scheduled_at) {
    // Validate against scheduled_at UTC — this is what the sync controller
    // uses (via rowToTask) to build the event, so it's the ground truth.
    // Comparing raw task.date/task.time is unreliable because tasks_v returns
    // the stored column value which may differ in format or date from what
    // rowToTask derives via utcToLocal(scheduled_at, tz).
    var expectedStartUTC = scheduledAtToUTC(task.scheduled_at);
    var actualStartUTC = new Date(event.start.dateTime).getTime();
    expect(Math.abs(actualStartUTC - expectedStartUTC)).toBeLessThan(60000);

    // Duration via raw UTC offset arithmetic — unambiguous
    var actualDurMs =
      new Date(event.end.dateTime).getTime() -
      new Date(event.start.dateTime).getTime();
    expect(actualDurMs / 60000).toBe(dur);

    // Timezone
    expect(event.start.timeZone).toBe(tz);
    expect(event.end.timeZone).toBe(tz);
  }

  // ── Description ──────────────────────────────────────────────────────────
  var desc = event.description || '';

  if (task.project) {
    expect(desc).toContain('Project: ' + task.project);
  } else {
    expect(desc).not.toContain('Project:');
  }

  if (task.notes) {
    expect(desc).toContain('Notes: ' + task.notes);
  } else {
    expect(desc).not.toContain('Notes:');
  }

  if (task.url) {
    expect(desc).toContain('Link: ' + task.url);
  } else {
    expect(desc).not.toContain('Link:');
  }

  expect(desc).toContain('Synced from Raike & Sons');

  // ── Transparency ─────────────────────────────────────────────────────────
  if (task.marker || isDone) {
    expect(event.transparency).toBe('transparent');
  } else {
    expect(event.transparency == null || event.transparency === 'opaque').toBe(true);
  }
}

/**
 * Assert that a pulled juggler task exactly matches the source GCal event
 * on every dimension the pull path sets:
 *   text, scheduled_at (UTC), dur, when, marker.
 *
 * @param {object} task   Row from tasks_v (the created juggler task)
 * @param {object} event  Raw GCal event from getGCalEvent()
 * @param {string} tz     User timezone
 */
function assertPulledTaskMatchesGCalEvent(task, event, tz) {
  expect(task).toBeTruthy();

  // Title
  expect(task.text).toBe(event.summary || '(No title)');

  if (event.start.dateTime) {
    // Timed event
    expect(task.when).toBe('fixed');

    // scheduled_at must represent the same moment as event start (UTC)
    var expectedUTC = new Date(event.start.dateTime).getTime();
    var actualUTC = scheduledAtToUTC(task.scheduled_at);
    expect(Math.abs(actualUTC - expectedUTC)).toBeLessThan(60000);

    // Duration
    var expectedDur = computeDurationMinutes(event.start.dateTime, event.end.dateTime);
    expect(task.dur).toBe(expectedDur);
  } else if (event.start.date) {
    expect(task.when).toBe('allday');
  }

  // Transparent event -> marker
  if (event.transparency === 'transparent') {
    expect(task.marker).toBeTruthy();
  }
}

module.exports = { assertGCalEventMatchesTask, assertPulledTaskMatchesGCalEvent, stripTzOffset, scheduledAtToUTC };

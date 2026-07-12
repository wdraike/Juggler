/**
 * Shared helpers for unified calendar sync engine.
 * Extracted from gcal.controller.js — pure functions, no DB dependency.
 */

var crypto = require('crypto');
var { libCalAdapterLogger } = require('../lib/logger');

var DEFAULT_TIMEZONE = require('../scheduler/constants').DEFAULT_TIMEZONE;

// 999.1192 (JUG-HEX-SLICES-CALL-CONTROLLERS): the three pure date transforms
// (jugglerDateToISO / isoToJugglerDate / computeDurationMinutes) moved VERBATIM
// into the calendar slice — slices/calendar/domain/dateTransforms.js — so the
// slice adapters no longer require an HTTP-layer controllers/* module. This
// module re-exports them under the same names as a back-compat shim for
// cal-sync.controller and the 20260402200000 migration.
var dateTransforms = require('../slices/calendar/domain/dateTransforms');
var jugglerDateToISO = dateTransforms.jugglerDateToISO;
var isoToJugglerDate = dateTransforms.isoToJugglerDate;
var computeDurationMinutes = dateTransforms.computeDurationMinutes;

/**
 * Hash of user-editable task fields only — excludes scheduler-controlled fields
 * (date, time, dur, status). Used in the miss-count path to distinguish genuine
 * user edits (task renamed, notes changed) from scheduler rescheduling. Stored
 * as last_user_hash on cal_sync_ledger; NULL on legacy rows suppresses the
 * tasksNeedingReCreate path until a fresh push populates it.
 *
 * MD5 is intentional here — this is a change-detection hash, not a security
 * primitive. MD5 is ~2x faster than SHA-256 and the 32-char output fits the
 * cal_sync_ledger VARCHAR column with room to spare. Collision resistance beyond
 * 2^64 is irrelevant for calendar-diff purposes.
 */
function userHash(task) {
  var str = [
    task.text || '',
    task.when || '',
    task.project || '',
    task.notes || '',
    task.url || '',
    task.pri || '',
    Array.isArray(task.location) ? task.location.slice().sort().join(',') : '',
    Array.isArray(task.tools) ? task.tools.slice().sort().join(',') : ''
  ].join('|');
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Hash the task fields we sync to calendars.
 */
function taskHash(task) {
  // Covers every task field that buildEventBody reads to construct the
  // calendar event payload — if any of these change, the next sync must
  // push the update, so they belong in the change-detection hash. Adding
  // a field here: include it in the `str` array AND add a corresponding
  // field to whichever adapter's buildEventBody uses it. Dropping a field:
  // same, in reverse. The stored last_pushed_hash is opaque to the DB,
  // so expansion doesn't need a migration — existing rows' hashes will
  // simply all miss on the first sync after deploy, causing one extra
  // push per ledger row (harmless catch-up).
  var str = [
    task.text || '',
    task.date || '',
    task.time || '',
    String(task.dur || 0),
    task.status || '',
    task.when || '',
    task.project || '',
    task.marker ? 'marker' : '',
    task.notes || '',
    task.url || '',
    task.pri || '',
    Array.isArray(task.location) ? task.location.slice().sort().join(',') : '',
    Array.isArray(task.tools) ? task.tools.slice().sort().join(',') : ''
  ].join('|');
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Convert an ISO 8601 string (e.g. from Microsoft Graph) to a Date object
 * that Knex/mysql2 can serialize. Raw ISO strings with 'Z' or microseconds
 * cause ER_TRUNCATED_WRONG_VALUE in MySQL DATETIME columns.
 */
function toMySQLDate(isoString) {
  if (!isoString) return null;
  var d = new Date(isoString);
  return isNaN(d.getTime()) ? null : d;
}

// Retries fn() up to 3 times (1s, 2s, 4s backoff) on GCal rate-limit (429) errors.
async function withGCalRateLimit(fn) {
  var delays = [1000, 2000, 4000];
  var attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      var msg = err.message || '';
      var isRateLimit = msg.includes('429') || msg.toLowerCase().includes('ratelimitexceeded');
      if (isRateLimit && attempt < delays.length) {
      libCalAdapterLogger.warn('GCal rate limit hit, retrying', { 
        attempt: attempt + 1,
        maxAttempts: delays.length,
        delayMs: delays[attempt]
      });
        await new Promise(function(r) { setTimeout(r, delays[attempt]); });
        attempt++;
      } else {
        throw err;
      }
    }
  }
}

// Calls fn(), wrapping in withGCalRateLimit only for gcal.
function callWithRateLimit(pid, fn) {
  return pid === 'gcal' ? withGCalRateLimit(fn) : fn();
}

module.exports = {
  DEFAULT_TIMEZONE,
  jugglerDateToISO,
  isoToJugglerDate,
  computeDurationMinutes,
  userHash,
  taskHash,
  toMySQLDate,
  withGCalRateLimit,
  callWithRateLimit
};

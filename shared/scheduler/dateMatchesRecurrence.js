/**
 * Check if a given date matches a recurrence rule.
 *
 * 999.1184: thin wrapper over expandRecurring's `matchesRecurrenceDay` — the
 * predicate extracted in 999.1091 C1 so all recurrence matchers share ONE
 * implementation of "what counts as a match" and can never drift apart.
 * A previous standalone copy here had drifted: it only iterated string `days`
 * specs ('MTWRF'), so an object-form days spec (e.g. {M:'required',W:'optional'},
 * handled by doesDayMatch/DOW_TO_CODE in the expansion) matched NOTHING.
 *
 * Anchor derivation stays with the CALLER (e.g. slices/task/facade.js derives
 * srcDateStr from the master's recur_start) — `srcDate` is passed straight
 * through to matchesRecurrenceDay as the phase/parity anchor, exactly as the
 * expansion loop passes its own anchor.
 *
 * @param {string} dateStr - Date to check (date-key format, e.g. "2026-03-31" or "3/31")
 * @param {object} recur - Recurrence config { type, days, every, unit, monthDays }
 * @param {string} srcDateStr - Source/anchor date for phase/parity + interval calculations
 * @param {function} parseDate - Date parser function
 * @returns {boolean} true if the date matches the recurrence pattern
 */

var expandRecurring = require('./expandRecurring');

var DAY_MAP = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };

function dateMatchesRecurrence(dateStr, recur, srcDateStr, parseDate) {
  if (!recur || !recur.type || recur.type === 'none') return false;
  if (!dateStr) return false;

  var cursor = parseDate(dateStr);
  if (!cursor) return false;
  var srcDate = srcDateStr ? parseDate(srcDateStr) : null;
  if (!srcDate) return false;
  if (cursor < srcDate) return false;

  return expandRecurring.matchesRecurrenceDay(cursor, recur, srcDate, DAY_MAP);
}

module.exports = { dateMatchesRecurrence: dateMatchesRecurrence };

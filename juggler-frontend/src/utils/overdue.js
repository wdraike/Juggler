import { getNowInTimezone, getActiveTimezone } from './timezone';

/**
 * getNowInTimezone builds a fresh Intl.DateTimeFormat per call (~100µs vs ~7µs
 * with a hoisted one, measured on this repo's V8/ICU), and this predicate runs
 * in the render body of six components — a month CalendarView with ~150
 * commitment-bearing rows would add ~15ms to EVERY render pass, including the
 * ones drag-tracking fires. The answer only changes once a minute, so cache it
 * per (timezone, minute). Skipped entirely when a caller injects `now` (tests).
 */
var _nowCache = { key: null, value: null };
function nowInZone(tz) {
  var key = tz + '@' + Math.floor(Date.now() / 60000);
  if (_nowCache.key !== key) {
    _nowCache = { key: key, value: getNowInTimezone(tz) };
  }
  return _nowCache.value;
}

/**
 * Single source of truth for the "is this task overdue?" display decision.
 *
 * Overdue is a property of the TASK (R50.6 computed-on-read `task.overdue`:
 * stored DB flag OR computed predicate, gated by a real hard commitment —
 * deadline / implied_deadline / placement_mode=fixed). It is NOT the scheduler's
 * per-placement `_overdue` flag, which is a slack-relaxation artifact (set only
 * when a task couldn't fit without ignoring its deadline) and wrongly marks
 * floating tasks overdue (violates 999.671).
 *
 * Every view (Issues/Conflicts, Calendar, Day) MUST decide overdue through this
 * helper so the three never disagree. By taking the task — not a placement entry —
 * the divergence is structurally impossible.
 *
 * 999.5116: In addition to the DB overdue flag, this helper derives past-due from
 * the task's own schedule when the task has a hard commitment, so the badge
 * survives a scheduler cycle that has cleared the DB flag. Floating tasks (no
 * hard commitment) are still excluded per 999.671.
 *
 * 999.15604 — three defects made a task due TODAY read overdue during the day:
 *
 *   1. The intra-day threshold was applied to ANY hard commitment. A DATE-ONLY
 *      deadline is a commitment to the DAY, not to the slot the scheduler
 *      happened to pick, so a task placed at 08:00 read overdue from 08:01. The
 *      backend SSOT (taskMappers.computeOverdueForRow) computes an intra-day
 *      threshold ONLY for placement_mode=fixed and placed daily-recurring
 *      instances; a deadline-driven task is compared day-to-day. Display now
 *      mirrors that: the deadline is the commitment when there is one, and a
 *      date-only deadline is due at end of day.
 *   2. `todayKey` came from toISOString() (UTC) while `nowMins` came from
 *      getHours() (LOCAL). West of UTC the UTC date rolls first, so from 20:00
 *      EDT every today-dated task compared against TOMORROW's key. Both halves
 *      now come from getNowInTimezone — the same shared contract the backend
 *      uses (R50.8 parity), in the user's timezone.
 *   3. Hydrated `task.time` is 12-hour text ("6:00 PM", convertTimeForDisplay),
 *      but it was parsed with split(':') — so 6 PM read as 6 AM and an evening
 *      task looked long past. Parsed with the AM/PM-aware reader below, which
 *      mirrors the backend's own regex.
 *
 * @param {{overdue?: boolean|number, date?: string, time?: string, deadline?: string,
 *          placementMode?: string, _displayTz?: string}} task  hydrated task object
 * @param {boolean} isDone  whether the task is in a terminal status
 * @param {Date} [now]  optional override for "now" (testing); defaults to real now
 * @param {string} [timezone]  IANA tz for the day boundary. Falls back to the tz
 *   hydration stamped on the task, then to the shared contract default
 *   (America/New_York) via getNowInTimezone — the documented R50.8 value both
 *   sides already agree on, not a silent substitution.
 * @returns {boolean}
 */
export function isTaskOverdue(task, isDone, now, timezone) {
  if (!task || isDone) return false;

  // A frozen (disabled) instance is never overdue. Checked BEFORE the DB flag,
  // matching computeOverdueForRow's order (terminal, then disabled, then
  // everything else) — `disabled` is deliberately absent from TERMINAL_STATUSES,
  // so the isDone check above does not cover it, and a client-side writer that
  // ever set `overdue` optimistically must not out-vote the freeze.
  if (task.status === 'disabled') return false;

  // DB flag is otherwise the primary source — if it says overdue, we trust it.
  if (task.overdue) return true;

  var isFixed = task.placementMode === 'fixed' || task.placement_mode === 'fixed';

  // all_day rows: the DAY ITSELF is a hard commitment (computeOverdueForRow's
  // `_isAllDayWithResolvableDate`), so it must be resolved BEFORE the gate —
  // an all-day event normally carries no separate deadline, and gating on
  // deadline-or-fixed alone made this branch unreachable for the common shape.
  // Multiday priority mirrors the backend: end_date > scheduled date > date.
  // Gated on placement_mode alone, exactly like the backend — NOT isAllDayTask,
  // which also matches a legacy `isAllDay === true` the backend never consults.
  // No production writer sets that field on a task today, but honouring it here
  // would silently outrank the FIXED branch below and fork the two predicates.
  var allDayKey = null;
  if (task.placementMode === 'all_day' || task.placement_mode === 'all_day') {
    var rawAllDay = task.endDate || task.end_date || task.date;
    if (rawAllDay && rawAllDay !== 'TBD') { allDayKey = String(rawAllDay).slice(0, 10); }
  }

  var hasHardCommitment = !!(task.deadline || isFixed || allDayKey);
  if (!hasHardCommitment) return false;

  var tz = timezone || task._displayTz || getActiveTimezone();
  var nowInfo = now ? getNowInTimezone(tz, { now: function() { return now; } }) : nowInZone(tz);

  // The all-day DAY is its own threshold — midnight only, no intra-day check,
  // and the deadline is deliberately NOT part of the formula (backend does the
  // same). A row whose day cannot be resolved falls through to its deadline
  // rather than being declared not-overdue.
  if (allDayKey) return allDayKey < nowInfo.todayKey;

  // FIXED placement: the slot IS the commitment, so the slot time is the
  // threshold (matches computeOverdueForRow's FIXED branch). Checked before the
  // deadline for the same reason the backend does: a fixed task's dueKey comes
  // from its scheduled slot and never falls back to the deadline while it has one.
  if (isFixed && task.date && task.date !== 'TBD' && task.time) {
    var slotMins = parseClockMins(task.time);
    // An unreadable time leaves the DAY comparison intact rather than clearing
    // the commitment — the backend keeps dueKey and simply skips the intra-day
    // threshold when its own regex misses.
    if (slotMins === null) return task.date < nowInfo.todayKey;
    if (task.date < nowInfo.todayKey) return true;
    return task.date === nowInfo.todayKey && slotMins < nowInfo.nowMins;
  }

  if (!task.deadline) return false;

  // 999.15816: deadline is now a DATETIME column. A non-midnight time
  // component means the deadline is due at that specific time, not end of
  // day. Midnight (including all legacy DATE values coerced to DATETIME)
  // keeps end-of-day semantics.
  var deadlineStr = String(task.deadline);
  var deadlineKey = deadlineStr.slice(0, 10);
  // Extract time if present (ISO 'T' or space separator)
  var dlTimeMatch = deadlineStr.match(/[T ](\d{2}):(\d{2})/);
  var dlMins = null;
  if (dlTimeMatch && !(dlTimeMatch[1] === '00' && dlTimeMatch[2] === '00')) {
    dlMins = parseInt(dlTimeMatch[1], 10) * 60 + parseInt(dlTimeMatch[2], 10);
  }

  if (deadlineKey < nowInfo.todayKey) return true;
  if (deadlineKey === nowInfo.todayKey && dlMins !== null) {
    return nowInfo.nowMins >= dlMins;
  }
  // Date-only deadline: end-of-day (not overdue during the day)
  return false;
}

/**
 * Minutes-since-midnight from either 24-hour ("18:00", "18:00:00") or 12-hour
 * ("6:00 PM") clock text — hydration produces the latter, the DB and ISO
 * deadlines the former. Returns null when there is no parsable time, which
 * callers read as "no time component", never as midnight.
 */
function parseClockMins(text) {
  if (!text) return null;
  var m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i.exec(String(text));
  if (!m) return null;
  var h = parseInt(m[1], 10);
  var mins = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(mins)) return null;
  var ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + mins;
}

/**
 * unifiedScheduleV2 — constraint-first scheduler (spec: docs/SCHEDULER-V2-SPEC.md)
 *
 * Single-pass placement driven by slack: `(slack asc, pri asc, dur desc, id)`.
 * Replaces v1's six-phase model with one ordered queue.
 *
 * **Status (step 4.2):** basic single-pass placement.
 *   - Classifies tasks into items (earliest / deadline / duration / when / pri).
 *   - Places pinned / fixed / rigid-recurring at their exact times first.
 *   - Computes initial slack for remaining items.
 *   - Sorts by (slack asc, pri asc, dur desc, id).
 *   - Places each at the earliest eligible slot in its when-windows.
 *
 * Known gaps vs v1 (surfaced as diffs in shadow mode; closed in 4.3/4.4):
 *   - Slack recompute after commit (4.3): IMPLEMENTED — incremental capacity subtraction at
 *     lines 1138–1159; queue re-sorted every iteration (queue.sort at line 1109).
 *   - Chain deadline backprop: OPEN — user-provided deadline only; predecessor tasks in a dep
 *     chain are not given an earlier deadline derived from their successor's deadline. The
 *     comment at line 262 flags this for 4.4. See docs/SCHEDULER-V2-STATUS.md.
 *   - Location/tool constraint enforcement: IMPLEMENTED — checkLoc initialized at line 732;
 *     canTaskRunAtMin() called in findEarliestSlot (line 805) and findLatestSlot (line 869).
 *   - Dependency-met check: IMPLEMENTED — checkDeps initialized at line 725; depsSatisfied()
 *     called in findEarliestSlot (line 804) and findLatestSlot (line 868).
 *   - Split chunks: pre-inserted as distinct DB rows (Phase 1); scheduler treats each as a
 *     regular task (design intent, not a gap).
 *   - timesPerCycle / recurring_rigid nuances: OPEN — held for UX review (see MASTER-PLAN).
 *     No work-budget awareness; occurrence-count only.
 *   - Marker handling: OPEN (partial) — markers WITH anchorDate + anchorMin are placed via
 *     the immovable path (tryPlaceAtTime, line 1039). Markers WITHOUT anchorMin fall through
 *     to the slack-sorted queue with dur=0; they land at the earliest eligible window slot
 *     but there is no dedicated all-day marker rendering path for time-unset markers.
 *     See docs/SCHEDULER-V2-STATUS.md for severity and recommended action.
 *
 * Imports shared helpers that v1 also uses — no v1 code touched.
 */

var constants = require('./constants');
var scoreSchedule = require('./scoreSchedule');
var GRID_START = constants.GRID_START;
var GRID_END = constants.GRID_END;
var RECUR_EXPAND_DAYS = constants.RECUR_EXPAND_DAYS;
var PRI_RANK = constants.PRI_RANK;

var dateHelpers = require('./dateHelpers');
var parseDate = dateHelpers.parseDate;
var formatDateKey = dateHelpers.formatDateKey;
var parseTimeToMinutes = dateHelpers.parseTimeToMinutes;

var timeBlockHelpers = require('./timeBlockHelpers');
var getBlocksForDate = timeBlockHelpers.getBlocksForDate;
var buildWindowsFromBlocks = timeBlockHelpers.buildWindowsFromBlocks;
var getWhenWindows = timeBlockHelpers.getWhenWindows;
var parseWhen = timeBlockHelpers.parseWhen;
var hasWhen = timeBlockHelpers.hasWhen;

var expandRecurringMod = require('../../../shared/scheduler/expandRecurring');
var expandRecurring = expandRecurringMod.expandRecurring;

var locationHelpers = require('./locationHelpers');
var canTaskRunAtMin = locationHelpers.canTaskRunAtMin;
var resolveLocationId = locationHelpers.resolveLocationId;

var { PLACEMENT_MODES } = require('../lib/placementModes');

var DAY_START = GRID_START * 60;
var DAY_END = GRID_END * 60 + 59;

function effectiveDuration(t) {
  var rd = t.timeRemaining != null ? t.timeRemaining
         : t.time_remaining != null ? t.time_remaining
         : t.dur;
  return Math.min(rd > 0 ? rd : (rd === 0 ? 0 : 30), 720);
}

// ── Placement reason ──────────────────────────────────────────
// Look up the display name of the when-block matching this item on a given date.
// Returns null when not found (caller falls back to item.when tag string).
function getBlockNameForItem(item, dateKey, dayBlocks) {
  if (!item.when || !dayBlocks || !dayBlocks[dateKey]) return null;
  var blocks = dayBlocks[dateKey];
  var whenParts = item.when.split(',').map(function(w) { return w.trim().toLowerCase(); });
  for (var bi = 0; bi < blocks.length; bi++) {
    if (whenParts.indexOf(blocks[bi].tag) >= 0) return blocks[bi].name;
  }
  return null;
}

// Builds a human-readable _placementReason string for each entry.
// `item` is the scheduler item object (not the raw task).
// `isConflict` = true when the placement overrides occupancy (rigid recurring overflow).
// `blockName` = the display name of the when-block (e.g. "Lunch", "Morning").
function buildPlacementReason(item, isConflict, blockName) {
  if (isConflict) return 'Rigid recurring: ' + (blockName || item.when || 'block') + ' (overlap)';
  if (item.isFixedWhen) return 'Fixed calendar event';
  if (item.isRecurring && item.isRigid) return 'Rigid recurring: ' + (blockName || item.when || 'block');
  if (item.deadlineDate) {
    var dl = item.task && item.task.deadline ? item.task.deadline : item.deadlineDate;
    return (item.pri || 'P3') + ' deadline due ' + dl;
  }
  if (item.dependsOn && item.dependsOn.length > 0) {
    return 'After ' + (item.depNames && item.depNames[0] ? "'" + item.depNames[0] + "'" : 'dependency');
  }
  if (item.task && item.task.tools && item.task.tools.length > 0) {
    return 'Requires ' + item.task.tools.join(', ');
  }
  return 'Scheduled by priority';
}

function normalizePri(p) {
  if (!p) return 'P3';
  var s = String(p).trim().toUpperCase();
  if (/^P[1-4]$/.test(s)) return s;
  if (/^[1-4]$/.test(s)) return 'P' + s;
  return 'P3';
}

// ── Occupancy primitives ────────────────────────────────────────
// Travel buffers (tb/ta) extend the footprint in both directions so adjacent
// tasks can't crowd into commute time. isFreeWithTravel rejects the slot if
// any minute in [start-tb, start+dur+ta) is busy; reserveWithTravel marks
// that whole range occupied.
function reserve(occ, start, dur) {
  var end = Math.min(start + dur, 1440);
  for (var i = Math.max(0, start); i < end; i++) occ[i] = true;
}
function reserveWithTravel(occ, start, dur, tb, ta) {
  var s = Math.max(0, start - (tb || 0));
  var e = Math.min(start + dur + (ta || 0), 1440);
  for (var i = s; i < e; i++) occ[i] = true;
}
function rebuildPrefix(occ, psum) {
  psum[0] = 0;
  for (var i = 0; i < 1440; i++) {
    psum[i + 1] = psum[i] + (occ[i] ? 1 : 0);
  }
}
function isFree(occ, start, dur) {
  var end = Math.min(start + dur, 1440);
  for (var i = start; i < end; i++) if (occ[i]) return false;
  return true;
}
function isFreeWithTravel(occ, start, dur, tb, ta) {
  var s = Math.max(0, start - (tb || 0));
  var e = Math.min(start + dur + (ta || 0), 1440);
  for (var i = s; i < e; i++) if (occ[i]) return false;
  return true;
}

// Hard safety cap. Any task that can't find a slot within a year is almost
// certainly misconfigured; preventing infinite search here keeps v2 from
// hanging if a user has a pathological recurrence pattern.
var MAX_SEARCH_DAYS = 365;

// ── Date list ──────────────────────────────────────────────────
// Two horizons:
//   - `planning` (default 14, extensible per task dates): the window where
//     day-to-day scheduling decisions live. Recurring expansion, slack
//     computation, and most placements happen here.
//   - `search` (up to MAX_SEARCH_DAYS): a larger horizon used only when a
//     free (no-deadline) task can't find a slot within planning. Extends
//     day-by-day as needed, avoiding the cost of pre-building 365 days of
//     windows for every run.
function buildDates(todayKey, cfg, allTasks) {
  var horizon = (cfg && cfg.recurExpandDays) || RECUR_EXPAND_DAYS;
  var dates = [];
  var base = parseDate(todayKey);
  if (!base) return dates;
  var endDate = new Date(base); endDate.setDate(endDate.getDate() + horizon);
  if (Array.isArray(allTasks)) {
    allTasks.forEach(function(t) {
      if (!t) return;
      var d = parseDate(t.date);
      if (d && d > endDate) { endDate = new Date(d); endDate.setDate(endDate.getDate() + 7); }
      var dd = parseDate(t.deadline);
      if (dd && dd > endDate) { endDate = new Date(dd); endDate.setDate(endDate.getDate() + 3); }
    });
  }
  var cursor = new Date(base);
  while (cursor <= endDate && dates.length < MAX_SEARCH_DAYS) {
    dates.push({
      key: formatDateKey(cursor),
      date: new Date(cursor),
      isoDow: cursor.getDay(),
      isToday: dates.length === 0
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

// Extend `dates` incrementally when an infinite-slack task's search walks
// past the current horizon. Only called on-demand so the common fast path
// doesn't pay for 365 days of window computation upfront.
function extendDatesTo(targetIdx, dates, dayWindows, dayBlocks, dayOcc, dayOccPrefix, dayPlaced, dayPlacements, timeBlocks, cfg) {
  if (dates.length === 0) return;
  var last = dates[dates.length - 1].date;
  while (dates.length <= targetIdx && dates.length < MAX_SEARCH_DAYS) {
    var next = new Date(last);
    next.setDate(next.getDate() + 1);
    var key = formatDateKey(next);
    dates.push({
      key: key,
      date: new Date(next),
      isoDow: next.getDay(),
      isToday: false
    });
    dayOcc[key] = {};
    dayOccPrefix[key] = new Int32Array(1441);
    dayPlaced[key] = [];
    dayPlacements[key] = [];
    dayBlocks[key] = getBlocksForDate(key, timeBlocks, cfg);
    dayWindows[key] = buildWindowsFromBlocks(dayBlocks[key]);
    last = next;
  }
}

// Parse task.dayReq into a set of allowed day-of-week indices (Sun=0..Sat=6).
// Returns null when all days are allowed (undefined/empty/'any'), so the caller
// can treat a null result as "no dow filter" — cheaper than storing the full
// 7-day set.
var DOW_CODE_TO_IDX = { U: 0, Su: 0, M: 1, T: 2, W: 3, R: 4, F: 5, Sa: 6, S: 6 };
function parseDayReq(dayReq) {
  if (!dayReq || dayReq === 'any') return null;
  if (dayReq === 'weekday') return { 1: true, 2: true, 3: true, 4: true, 5: true };
  if (dayReq === 'weekend') return { 0: true, 6: true };
  var parts = String(dayReq).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  if (parts.length === 0) return null;
  var set = {};
  var count = 0;
  parts.forEach(function(p) {
    if (DOW_CODE_TO_IDX[p] != null) { set[DOW_CODE_TO_IDX[p]] = true; count++; }
  });
  if (count === 0 || count >= 7) return null; // no parses recognized or all days → unconstrained
  return set;
}

// Recurrence cycle length in days. Used to cap the placement-search window for
// flexible recurring instances (tpc picks a specific date but the instance can
// land on any of its allowed days within the cycle). Returns 0 when the
// recurrence has no natural cycle (e.g. none) so the caller can skip the cap.
function recurringCycleDays(recur) {
  if (!recur) return 0;
  var r = recur;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return 0; } }
  var type = r && r.type;
  if (type === 'weekly') return 7;
  if (type === 'biweekly') return 14;
  if (type === 'monthly') return 30;
  if (type === 'daily') return 1;
  if (type === 'interval') {
    var every = Number(r.every) || 1;
    var unit = r.unit || 'days';
    if (unit === 'days') return every;
    if (unit === 'weeks') return every * 7;
    if (unit === 'months') return every * 30;
    if (unit === 'years') return every * 365;
  }
  return 0;
}

// ── Placement item classification ──────────────────────────────
// Normalizes each task into a compact item with the fields the
// placement loop needs.
//
// v1's runSchedule.js pre-expands recurring instances + reconciles split
// chunks before calling unifiedSchedule. v2 is invoked (shadow mode) at
// the same point in the flow, so `allTasks` already contains every
// instance and chunk that needs placement. Calling expandRecurring here
// produced duplicates: its dedup key `sourceId + date` excludes unplaced
// pending instances (they lack a date), so it regenerated them as fresh
// items.
function buildItems(allTasks, statuses, dates, todayKey, nowMins, cfg) {
  // Normalize todayKey to ISO form for consistent comparisons — it may arrive
  // as legacy M/D format from test helpers (e.g. '4/3' instead of '2026-04-03').
  var todayIsoKey = dates.length > 0 ? dates[0].key : toKey(todayKey);
  // Drop recurring templates (sources); their instances carry placement.
  var pool = allTasks.filter(function(t) { return t.taskType !== 'recurring_template'; });

  var items = [];
  pool.forEach(function(t) {
    if (!t || !t.id) return;
    // Skip done/cancel/skip/pause/disabled — they don't need placement.
    var st = statuses[t.id] || t.status || '';
    if (st === 'done' || st === 'cancel' || st === 'skip' || st === 'pause' || st === 'disabled') return;

    var pm = t.placementMode || PLACEMENT_MODES.ANYTIME;
    var isMarker = pm === PLACEMENT_MODES.REMINDER;
    // Markers are calendar indicators — they coexist with other placements at
    // the same minute, so dur=0 means they never consume occupancy.
    var dur = isMarker ? 0 : effectiveDuration(t);
    // Skip non-marker tasks with zero duration — they have nothing to schedule.
    // Also skip tasks with date='TBD' (user explicitly deferred placement).
    if (!isMarker && dur === 0) return;
    if (t.date && String(t.date).toUpperCase() === 'TBD') return;
    // All-day events have no time-grid presence — they appear in the calendar
    // UI via a separate rendering path, not as time-grid placements.
    // After the placement_mode enum redesign, all_day mode is carried in
    // placement_mode directly — never in the when column.
    if (pm === PLACEMENT_MODES.ALL_DAY) return;
    var when = t.when || '';
    // Past ANYTIME recurring instances (recurring=true, date in past, no time anchor)
    // are dropped — they already passed and should not be rescheduled to today.
    // TIME_WINDOW tasks from prior days still go through the missed-window path
    // so they can be force-placed with _overdue on their original day.
    // FIXED tasks from prior days still go through the force-placement pass.
    if (t.recurring && pm === PLACEMENT_MODES.ANYTIME && t.date && toKey(t.date) < todayIsoKey) return;
    var pri = normalizePri(t.pri);
    var priRank = PRI_RANK[pri] || 50;
    // fixed = true only for non-recurring calendar events in FIXED mode.
    // Recurring FIXED tasks (rigid recurrings) use isRigid instead — they can
    // be displaced from their anchor when the slot is occupied, whereas truly
    // fixed calendar events cannot be moved.
    var fixed = pm === PLACEMENT_MODES.FIXED && !t.recurring;
    var pinned = !!t.datePinned;
    var recurring = !!t.recurring;
    var flexWhen = !!t.flexWhen;

    // Derive earliest placement minute-of-day and date.
    // For pinned/fixed/rigid-recurring we also have a specific target
    // datetime, captured in item.anchor. Normalize all date-ish fields to
    // canonical ISO so downstream lookups against dates[].key always match.
    var anchorDate = toKey(t.date);
    // For FIXED with a when-tag, the when-block is authoritative —
    // do NOT use t.time (it may be a stale/feedback-loop value from a prior run).
    // Only use t.time for immovable anchor if there is no when-tag (time-only fixed).
    // ANYTIME tasks never anchor on bare t.time: t.time is a derived/cached value
    // (sync drift, leftover placement) and must not lock an "anytime" task to a
    // missed instant. ANYTIME tasks may still anchor on preferredTimeMins below —
    // that's the explicit user-intent "around X o'clock, but flexible" signal.
    var anchorMin = (t.time && pm !== PLACEMENT_MODES.ANYTIME && !(pm === PLACEMENT_MODES.FIXED && t.when))
      ? parseTimeToMinutes(t.time) : null;
    if (anchorMin == null && pm === PLACEMENT_MODES.ANYTIME && t.preferredTimeMins != null) {
      anchorMin = t.preferredTimeMins;
    }
    if ((pm === PLACEMENT_MODES.FIXED || pm === PLACEMENT_MODES.TIME_WINDOW) && t.preferredTimeMins != null && anchorMin == null) {
      anchorMin = t.preferredTimeMins;
    }

    // Deadline: user deadline; recurring instances use their scheduled day
    // as the implicit deadline end (4.4 will refine chain backprop + cycle
    // window computation for timesPerCycle).
    var deadlineDate = toKey(t.deadline) || null;
    if (recurring && anchorDate) deadlineDate = deadlineDate || anchorDate;

    // Dependencies: list of task IDs this item must follow. Recurring
    // templates forbid deps (they're stripped at write time) so instances
    // inherit nothing here. For one-offs and chain members this drives the
    // deps-met gate in findEarliestSlot.
    var depsOn = [];
    if (Array.isArray(t.dependsOn)) depsOn = t.dependsOn.slice();
    else if (t.dependsOn && typeof t.dependsOn === 'string') {
      try { depsOn = JSON.parse(t.dependsOn) || []; } catch (e) { depsOn = []; }
    }
    // Dep names for placement reason annotations (E4).
    var depNames = depsOn.map(function(depId) {
      var depTask = pool.find(function(pt) { return pt.id === depId; });
      return depTask ? (depTask.text || depId) : depId;
    });

    // Travel buffers. For split chunks, only the first carries travelBefore
    // and only the last carries travelAfter — matches v1's recordPlace logic
    // so commute time isn't double-booked around every chunk of a split task.
    var rawTb = Number(t.travelBefore) > 0 ? Number(t.travelBefore) : 0;
    var rawTa = Number(t.travelAfter) > 0 ? Number(t.travelAfter) : 0;
    var splitOrd = t.splitOrdinal != null ? Number(t.splitOrdinal) : 1;
    var splitTot = t.splitTotal != null ? Number(t.splitTotal) : 1;
    var travelBefore = (splitOrd === 1) ? rawTb : 0;
    var travelAfter = (splitOrd === splitTot) ? rawTa : 0;

    // Time-window mode: placement_mode 'time_window' means preferred_time_mins
    // ± timeFlex. In window mode the `when` tags are ignored.
    var DEFAULT_TIME_FLEX = 60;
    var isWindowMode = pm === PLACEMENT_MODES.TIME_WINDOW;
    var windowLo = null, windowHi = null;
    var isMissedWindow = false; // true when the flex window is entirely past (TIME_WINDOW mode)
    if (isWindowMode) {
      var flex = t.timeFlex != null ? t.timeFlex : DEFAULT_TIME_FLEX;
      if (flex > 0 && flex <= 480) {
        windowLo = Math.max(DAY_START, t.preferredTimeMins - flex);
        windowHi = Math.min(DAY_END, t.preferredTimeMins + flex);
        // Preferred time is entirely outside the schedulable day (before DAY_START
        // or after DAY_END) — the clamped window is inverted (Lo > Hi).
        // Fall back to when-tag placement so the task isn't silently unplaced.
        if (windowHi <= windowLo) isWindowMode = false;
        // Window entirely past on today → mark as missed; dual-placed in unplaced + grid.
        else if (anchorDate === todayIsoKey && nowMins != null && windowHi <= nowMins) {
          isMissedWindow = true;
        }
      } else {
        isWindowMode = false; // degenerate flex — fall back to when tags
      }
    }

    // Missed preferred-time detection for non-window recurring tasks.
    // An ANYTIME recurring (or any recurring without TIME_WINDOW mode) that
    // has a preferredTimeMins set should be marked missed — not normally placed —
    // when its preferred-time window [preferredTimeMins, preferredTimeMins+timeFlex]
    // has entirely passed. This prevents stale instances from being placed far
    // outside their intended time when the user has explicitly set a preferred time.
    var isMissedPreferredTime = false;
    if (t.recurring && !isWindowMode && !isMissedWindow &&
        t.preferredTimeMins != null && anchorDate === todayIsoKey && nowMins != null) {
      var flex2 = t.timeFlex != null ? t.timeFlex : DEFAULT_TIME_FLEX;
      if (flex2 > 0 && nowMins >= t.preferredTimeMins + flex2) {
        isMissedPreferredTime = true;
      }
    }

    // Day-of-week eligibility. A tpc recurring instance (expandRecurring sets
    // dayReq to the union of selected days when tpc < selectedDays) should be
    // placeable on any of its allowed days — day-locking to the picked date
    // defeats the whole point of the windowed pick. Parse dayReq into a set
    // of allowed day-of-week indexes (Sun=0..Sat=6). Null => any day.
    var allowedDows = parseDayReq(t.dayReq);

    // Recurring cycle length (days) + roaming eligibility. A recurring
    // instance may roam across its cycle (within dayReq) only when the
    // recurrence uses timesPerCycle to PICK a subset of the selected days:
    // in that mode the picked date is a hint, not a hard anchor, and the
    // instance represents "one session in this cycle on any allowed day".
    // Non-tpc recurring (each selected day has its own instance, e.g. M/W/F
    // every week) must day-lock — otherwise the Mon instance could roam onto
    // Wed and collide with the Wed instance.
    var cycleDays = recurringCycleDays(t.recur);
    var isFlexibleTpc = (function() {
      if (!recurring) return false;
      var r = t.recur;
      if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return false; } }
      if (!r || !r.timesPerCycle || r.timesPerCycle <= 0) return false;
      // Need to know how many days are selected in the cycle to decide if tpc
      // is actually filtering. If tpc >= selectedDays, every selected day gets
      // an instance and roaming doesn't apply.
      var selectedDays;
      if (r.type === 'daily') selectedDays = 7;
      else if (r.type === 'weekly' || r.type === 'biweekly') {
        var days = r.days || 'MTWRF';
        selectedDays = typeof days === 'object' && !Array.isArray(days)
          ? Object.keys(days).length
          : (typeof days === 'string' ? days.length : 0);
      } else if (r.type === 'monthly') {
        selectedDays = (r.monthDays || [1, 15]).length;
      } else {
        selectedDays = 1;
      }
      return r.timesPerCycle < selectedDays;
    })();
    // Day-lock applies when:
    //   - rigid recurring (user pinned the day + time)
    //   - non-tpc recurring (instance is day-specific — daily tasks lock to their
    //     day, non-tpc weekly tasks must stay on their picked day to avoid colliding
    //     with other occurrences)
    // Split chunks of tpc recurring tasks are NOT day-locked. Their deadline is
    // capped to the day before the next occurrence fires (set in runSchedule.js),
    // so chunks spread across the interval window naturally without competing with
    // the next occurrence. Daily tpc splits self-cap via cycleDays=1 in the
    // placement window (ai + cycleDays - 1 = ai → same day regardless).
    var isDayLocked = recurring && (pm === PLACEMENT_MODES.FIXED || !isFlexibleTpc);

    items.push({
      task: t,
      id: t.id,
      dur: dur,
      pri: pri,
      priRank: priRank,
      when: when,
      whenParts: parseWhen(when),
      isFixedWhen: fixed,
      isAllDay: pm === PLACEMENT_MODES.ALL_DAY,
      isPinned: pinned,
      // Generated instances without an explicit anchorMin are day-locked via
      // isGenerated — see findEarliestSlot for the clamping logic.
      isGenerated: !!t.generated && !recurring,
      isRigid: pm === PLACEMENT_MODES.FIXED,
      isRecurring: recurring,
      isMarker: isMarker,
      flexWhen: flexWhen,
      anchorDate: anchorDate,
      anchorMin: anchorMin,
      deadlineDate: deadlineDate,
      startAfterDate: toKey(t.startAfter),
      dependsOn: depsOn,
      isWindowMode: isWindowMode,
      isMissedWindow: isMissedWindow,
      isMissedPreferredTime: isMissedPreferredTime,
      windowLo: windowLo,
      windowHi: windowHi,
      preferredTimeMins: t.preferredTimeMins != null ? t.preferredTimeMins : null,
      travelBefore: travelBefore,
      travelAfter: travelAfter,
      allowedDows: allowedDows,
      cycleDays: cycleDays,
      isDayLocked: isDayLocked,
      isFlexibleTpc: isFlexibleTpc,
      masterId: t.sourceId || t.master_id || null,
      splitOrdinal: splitOrd,
      splitTotal: splitTot,
      depNames: depNames,
      slack: null, // filled later
      // ANYTIME recurring tasks whose scheduled time has already passed today
      // get pushed to the latest available slot so they stay visible on the
      // day grid and the user can still mark them done before end of day.
      // TIME_WINDOW tasks are intentionally excluded — when their preferred
      // time window is past they should go to unplaced with reason 'missed'.
      // The `recurring &&` guard is required: without it, any non-recurring
      // ANYTIME task whose anchorMin < nowMins would incorrectly get
      // preferLatestSlot = true.
      preferLatestSlot: (
        pm === PLACEMENT_MODES.ANYTIME &&
        recurring &&
        anchorDate === todayIsoKey &&
        anchorMin != null && nowMins != null && anchorMin < nowMins
      )
    });
  });

  return items;
}

// ── Slot eligibility ──────────────────────────────────────────
// Returns an array of [start, end] windows this item can occupy on the
// given date, taking when-tags into account. Empty when the date isn't
// eligible at all (e.g., task's when doesn't match any block).
function eligibleWindows(item, dateKey, dayWindows, dayBlocks, relaxWhen) {
  var wins = dayWindows[dateKey] || {};
  if (item.isFixedWhen && item.anchorMin != null) {
    return [[item.anchorMin, item.anchorMin + item.dur]];
  }
  if (item.isAllDay) {
    return [[DAY_START, DAY_END]];
  }
  // Time-window mode: preferred time ± flex. Overrides the `when` tag unions
  // because the user chose a narrow target window instead of named blocks.
  // relaxWhen (flex_when retry) ignores this and falls through to anytime.
  if (item.isWindowMode && !relaxWhen) {
    return [[item.windowLo, item.windowHi]];
  }
  // flex_when retry: treat this task as 'anytime' for window selection.
  // Only called when a constrained slot search already failed.
  var whenExpr = relaxWhen ? 'anytime' : (item.when || '');
  // Leverage v1's getWhenWindows for parity on window selection.
  var matched = getWhenWindows(whenExpr, wins);
  return matched || [];
}

// Sum free minutes across eligible windows in a date range, clamped by
// occupancy. Used for slack = capacity − duration.
function capacityInRange(item, dates, startIdx, endIdx, dayWindows, dayBlocks, dayOcc, dayOccPrefix) {
  if (startIdx > endIdx) return 0;
  var total = 0;
  for (var i = startIdx; i <= endIdx && i < dates.length; i++) {
    var d = dates[i];
    var wins = eligibleWindows(item, d.key, dayWindows, dayBlocks);
    var psum = dayOccPrefix[d.key];
    if (psum) {
      wins.forEach(function(w) {
        var s = w[0], e = w[1];
        total += (e - s) - (psum[e] - psum[s]);
      });
    } else {
      var occ = dayOcc[d.key] || {};
      wins.forEach(function(w) {
        var s = w[0], e = w[1];
        for (var m = s; m < e; m++) if (!occ[m]) total++;
      });
    }
  }
  return total;
}

// Normalize a date-ish input (ISO, M/D, or Date) to the canonical ISO key
// used for dates[].key. Returns null if parse fails.
function toKey(val) {
  if (!val) return null;
  var d = parseDate(val);
  return d ? formatDateKey(d) : null;
}

function indexOfDate(dates, dateLike) {
  var target = toKey(dateLike);
  if (!target) return -1;
  for (var i = 0; i < dates.length; i++) if (dates[i].key === target) return i;
  return -1;
}

function computeSlack(item, dates, dayWindows, dayBlocks, dayOcc, dayOccPrefix) {
  // No deadline → unconstrained. Free tasks sort to the end of the queue.
  if (!item.deadlineDate) return Infinity;

  var earliestIdx = 0;
  if (item.startAfterDate) {
    var si = indexOfDate(dates, item.startAfterDate);
    if (si > 0) earliestIdx = si;
  }
  var deadlineIdx = indexOfDate(dates, item.deadlineDate);
  if (deadlineIdx < 0) deadlineIdx = dates.length - 1;

  var cap = capacityInRange(item, dates, earliestIdx, deadlineIdx, dayWindows, dayBlocks, dayOcc, dayOccPrefix);
  return cap - item.dur;
}

// How many minutes of the committed slot [start, start+dur] on dateKey fall
// within `item`'s eligible windows on that same date? Used for incremental
// capacity subtraction — dramatically cheaper than recomputing slack from
// scratch after every placement.
function overlapWithEligibleWindows(item, slotDateKey, slotStart, slotDur, dayWindows, dayBlocks) {
  var wins = eligibleWindows(item, slotDateKey, dayWindows, dayBlocks);
  if (!wins.length) return 0;
  var slotEnd = slotStart + slotDur;
  var total = 0;
  for (var i = 0; i < wins.length; i++) {
    var wStart = wins[i][0];
    var wEnd = wins[i][1];
    var oStart = Math.max(wStart, slotStart);
    var oEnd = Math.min(wEnd, slotEnd);
    if (oEnd > oStart) total += (oEnd - oStart);
  }
  return total;
}

// ── Stepper recorder ──────────────────────────────────────────
// When cfg._stepRecorder is an Array, each successful placement appends a
// per-placement snapshot mirroring v1's emitStepRecord shape. Consumed by
// the admin Stepper UI (schedulerSession.js). Zero-cost when disabled.
// Phase strings use the v2 vocabulary:
//   'V2: Immovable'    — pinned/fixed/marker/rigid-recurring (tryPlaceAtTime)
//   'V2: Constrained'  — slack-sorted main loop, item has finite slack
//   'V2: Unconstrained'— slack-sorted main loop, item has Infinity slack
//   'V2: Retry'        — dep-deferred items placed in the retry pass
// Placement flags set on the returned entry (overdue/relaxed) are copied
// onto the step so the UI can annotate "overdue" or "flex-relaxed" pills.
function emitStepRecord(cfg, phase, item, start, dur, dateKey, locked, dayPlaced, extras) {
  var rec = cfg && cfg._stepRecorder;
  if (!Array.isArray(rec)) return;
  var t = item.task;
  // Snapshot cumulative placements across all days so the UI can paint the
  // calendar state "at this step".
  var daySnap = {};
  Object.keys(dayPlaced).forEach(function(ddk) {
    daySnap[ddk] = (dayPlaced[ddk] || []).map(function(p) {
      return {
        taskId: p.task ? p.task.id : null,
        taskText: p.task ? p.task.text : null,
        start: p.start, dur: p.dur,
        locked: !!p.locked, marker: !!(p.task && p.task.placementMode === PLACEMENT_MODES.REMINDER)
      };
    });
  });
  var locAtStart = null;
  try { locAtStart = resolveLocationId(dateKey, start, cfg, null); } catch (e) { /* ignore */ }
  var slackVal = (item.slack != null && isFinite(item.slack)) ? Math.round(item.slack) : null;
  rec.push({
    stepIndex: rec.length,
    phase: phase,
    taskId: t.id,
    taskText: t.text || '',
    project: t.project || null,
    pri: t.pri || null,
    recurring: !!t.recurring,
    when: t.when || null,
    deadline: t.deadline || null,
    preferredTimeMins: t.preferredTimeMins != null ? t.preferredTimeMins : null,
    timeFlex: t.timeFlex != null ? t.timeFlex : null,
    rigid: t.placementMode === PLACEMENT_MODES.FIXED,
    travelBefore: item.travelBefore || 0,
    travelAfter: item.travelAfter || 0,
    locationRequirement: t.location || null,
    toolRequirement: t.tools || null,
    locationAtPlacement: locAtStart,
    flexWindow: (item.isWindowMode && item.windowLo != null)
      ? { start: item.windowLo, end: item.windowHi } : null,
    placement: { dateKey: dateKey, start: start, dur: dur, locked: !!locked },
    splitOrdinal: item.splitOrdinal != null ? item.splitOrdinal : null,
    splitTotal: item.splitTotal != null ? item.splitTotal : null,
    orderingSlack: slackVal,
    overdue: !!(extras && extras.overdue),
    whenRelaxed: !!(extras && extras.relaxed),
    dayPlacementsSnapshot: daySnap
  });
}

// ── Placement loop ────────────────────────────────────────────
function tryPlaceAtTime(item, dates, dayOcc, dayPlaced, dayPlacements, cfg, env) {
  if (!item.anchorDate || item.anchorMin == null) return false;
  var occ = dayOcc[item.anchorDate];
  if (!occ) return false;
  var start = item.anchorMin;

  // Fixed/pinned overlap warning: detect conflict with already-placed locked entries.
  var warnings = env && env.warnings;
  if ((item.isFixedWhen || item.isPinned) && warnings) {
    var existingFixed = (dayPlaced[item.anchorDate] || []).filter(function(p) {
      return p.locked && p.start < start + item.dur && p.start + p.dur > start;
    });
    if (existingFixed.length > 0) {
      warnings.push({ type: 'fixedOverlap', taskIds: [item.id].concat(existingFixed.map(function(p) { return p.task && p.task.id; })) });
    }
  }

  // Fixed/pinned placements reserve their slot regardless of conflict —
  // user intent wins. Later-placed items must route around. Travel buffer
  // extends the footprint so adjacent tasks can't overlap commute time.
  reserveWithTravel(occ, start, item.dur, item.travelBefore, item.travelAfter);

  // Look up block name for rigid recurring placement reason.
  var blockName = null;
  if (item.isRecurring && item.isRigid && item.when) {
    var imBlocks = env && env.dayBlocks && env.dayBlocks[item.anchorDate];
    if (imBlocks) {
      var wp = item.when.split(',').map(function(w) { return w.trim().toLowerCase(); });
      for (var bi = 0; bi < imBlocks.length; bi++) {
        if (wp.indexOf(imBlocks[bi].tag) >= 0) {
          blockName = imBlocks[bi].name; break;
        }
      }
    }
  }

  // _conflict: rigid recurring overlapping an already-occupied slot.
  var isConflict = false;
  if (item.isRigid) {
    var occupied = (dayPlaced[item.anchorDate] || []).some(function(p) {
      return p.start < start + item.dur && p.start + p.dur > start;
    });
    if (occupied) isConflict = true;
  }

  var entry = { task: item.task, start: start, dur: item.dur, locked: true,
    travelBefore: item.travelBefore || 0, travelAfter: item.travelAfter || 0,
    _placementReason: buildPlacementReason(item, isConflict, blockName) };
  if (isConflict) {
    entry._conflict = true;
    if (warnings) warnings.push({ type: 'recurringConflict', taskId: item.id });
  }
  if (!dayPlaced[item.anchorDate]) dayPlaced[item.anchorDate] = [];
  dayPlaced[item.anchorDate].push(entry);
  if (!dayPlacements[item.anchorDate]) dayPlacements[item.anchorDate] = [];
  dayPlacements[item.anchorDate].push(entry);
  noteMasterPlacement(env, item, item.anchorDate);
  emitStepRecord(cfg, 'V2: Immovable', item, start, item.dur, item.anchorDate, true, dayPlaced, null);
  return true;
}

// Track the latest placement date per recurring master so the next cycle's
// flexible tpc instance can enforce minimum spacing. Cross-run seed comes
// from cfg.recurringHistoryByMaster (via env.lastByMaster); within-run
// updates happen here on every placement commit.
function noteMasterPlacement(env, item, dateKey) {
  if (!env || !env.lastByMaster || !item.isRecurring || !item.masterId) return;
  var prev = env.lastByMaster[item.masterId];
  if (!prev || dateKey > prev) env.lastByMaster[item.masterId] = dateKey;
}

// Absolute "minutes from horizon start" for a placement. Lets us compare
// dep completion to candidate start across day boundaries without faffing
// with per-day math.
function absoluteMin(dateIdx, startMin) {
  return dateIdx * 1440 + startMin;
}

// Are all `item.dependsOn` entries satisfied at the given (dateIdx, startMin)?
// A dep is satisfied when:
//   - its status is a terminal non-placement (done/cancel/skip/disabled/pause), or
//   - it was placed and its end time ≤ candidate start time.
// Unknown-status deps (referenced ID not in the task list) are treated as
// satisfied — same as v1's behavior, avoids deadlocking on stale refs.
function depsSatisfied(item, candidateDateIdx, candidateStartMin, placedById, statuses, dates) {
  if (!item.dependsOn || item.dependsOn.length === 0) return true;
  var candidateAbs = absoluteMin(candidateDateIdx, candidateStartMin);
  for (var i = 0; i < item.dependsOn.length; i++) {
    var depId = item.dependsOn[i];
    var st = statuses[depId];
    // Deps not loaded into the scheduling pool (terminal statuses like done/
    // skip/cancel, or deleted) return `undefined` here — treat as satisfied.
    // runSchedule.js filters them out of tasks_v at the SQL layer, matching
    // v1's poolIds-based "is this dep active?" check.
    if (st === undefined) continue;
    if (st === 'done' || st === 'cancel' || st === 'skip' || st === 'disabled' || st === 'pause') continue;
    var placed = placedById[depId];
    if (!placed) return false; // unplaced live dep — not yet satisfied
    var depDateIdx = indexOfDate(dates, placed.dateKey);
    if (depDateIdx < 0) continue; // placed off-horizon — treat as satisfied
    var depAbsEnd = absoluteMin(depDateIdx, placed.start + placed.dur);
    if (depAbsEnd > candidateAbs) return false;
  }
  return true;
}

function hasWeatherConstraint(task) {
  if (!task) return false;
  return (task.weatherPrecip && task.weatherPrecip !== 'any') ||
         (task.weatherCloud  && task.weatherCloud  !== 'any') ||
         task.weatherTempMin != null || task.weatherTempMax != null ||
         task.weatherHumidityMin != null || task.weatherHumidityMax != null;
}

function weatherOk(task, dateKey, startMin, weatherByDateHour) {
  if (!hasWeatherConstraint(task)) return true;
  if (!weatherByDateHour || !weatherByDateHour[dateKey]) return true; // fail-open
  var hour = Math.floor(startMin / 60);
  var w = weatherByDateHour[dateKey][hour];
  if (!w) return true; // fail-open: no data for this hour

  // Precipitation check
  var precip = task.weatherPrecip || 'any';
  if (precip === 'dry_only'  && w.precipProb > 20) return false;
  if (precip === 'light_ok'  && w.precipProb > 50) return false;
  // 'wet_ok' and 'any' always pass

  // Sky cover check
  var cloud = task.weatherCloud || 'any';
  if (cloud === 'clear'      && w.cloudcover > 25) return false;
  if (cloud === 'partly_ok'  && w.cloudcover > 60) return false;
  // 'overcast_ok' and 'any' always pass

  // Temperature check
  var temp = w.temp;
  if (temp != null) {
    if (task.weatherTempMin != null && temp < task.weatherTempMin) return false;
    if (task.weatherTempMax != null && temp > task.weatherTempMax) return false;
  }

  // Humidity check
  var humidity = w.humidity;
  if (humidity != null) {
    if (task.weatherHumidityMin != null && humidity < task.weatherHumidityMin) return false;
    if (task.weatherHumidityMax != null && humidity > task.weatherHumidityMax) return false;
  }

  return true;
}

// Walk eligible windows on each date from earliest..latest looking for
// the first `dur`-minute free slot. Returns { dateKey, start } or null.
// opts.ignoreDeadline=true extends the search through the full horizon —
// used for overdue items (slack < 0) where we know the deadline can't be
// met and want to place at the first available slot anyway.
// opts.placedById / opts.statuses enable dependency gating — candidate
// slots that start before a dep completes are rejected.
function findEarliestSlot(item, dates, dayWindows, dayBlocks, dayOcc, opts) {
  var earliestIdx = 0;
  if (item.startAfterDate) {
    var si = indexOfDate(dates, item.startAfterDate);
    if (si > 0) earliestIdx = si;
  }
  var latestIdx = dates.length - 1;
  if (item.deadlineDate && !(opts && opts.ignoreDeadline)) {
    var di = indexOfDate(dates, item.deadlineDate);
    if (di >= 0) latestIdx = di;
  }
  // Date-pinned non-recurring tasks are locked to their anchorDate — they must
  // not be pulled forward to today or pushed to another day.
  // Also applies to generated instances (recurring instances without explicit
  // placement modes) that have no anchorMin — they represent occurrences assigned
  // to a specific day by expandRecurring.
  if ((item.isPinned && !item.isRecurring) || (item.isGenerated && item.anchorMin == null)) {
    if (item.anchorDate) {
      var pi = indexOfDate(dates, item.anchorDate);
      if (pi >= 0) { earliestIdx = pi; latestIdx = pi; }
    }
  }
  // Recurring-instance placement windows. Three cases:
  //   1. Strictly day-locked (rigid recurring, or split-chunk-2+ that must
  //      join its already-placed chunk 1): clamp earliest=latest=anchor.
  //   2. Flexible recurring (tpc windowed pick, non-rigid, non-split-chunk-2+):
  //      search from anchor forward up to the cycle length so the instance
  //      can land on any of its allowed days without overflowing into the
  //      next cycle (which would double-book that cycle against its own pick).
  //      dayReq filtering inside the loop limits to allowed day-of-week.
  //   3. Every other recurring (anchor present but neither rigid nor tpc):
  //      keep the v1 "no roll forward" semantics — day-locked to anchor.
  //
  // Note: ignoreDeadline is intentionally ignored here for recurrings —
  // an overdue recurring goes to unplaced, never to a later day.
  if (item.isRecurring && item.anchorDate) {
    var ai = indexOfDate(dates, item.anchorDate);
    if (ai >= 0) {
      earliestIdx = ai;
      if (item.isDayLocked) {
        latestIdx = ai;
      } else if (item.cycleDays > 0) {
        // Cap the search at the end of the current cycle (inclusive), so a
        // flexible recurring doesn't bleed into the next cycle and compete
        // with that cycle's own pick.
        var capIdx = ai + item.cycleDays - 1;
        if (capIdx < latestIdx) latestIdx = capIdx;
      } else {
        // Unknown cycle (shouldn't happen for a recurring with anchorDate) —
        // fall back to day-locked to preserve v1's no-roll-forward rule.
        latestIdx = ai;
      }
    }
  }

  var placedById = opts && opts.placedById;
  var statuses = (opts && opts.statuses) || {};
  var relaxDeps = !!(opts && opts.relaxDeps);
  var checkDeps = !relaxDeps && placedById && item.dependsOn && item.dependsOn.length > 0;
  var relaxWhen = !!(opts && opts.relaxWhen);
  var cfg = (opts && opts.cfg) || null;
  var toolMatrix = cfg && cfg.toolMatrix;
  // Location/tool gating: skip candidate slots where the task can't run due
  // to missing location or tools. Pinned/fixed/marker items bypass this
  // (they came through the immovable path, not findEarliestSlot).
  var checkLoc = cfg && item.task && (
    (Array.isArray(item.task.location) && item.task.location.length > 0) ||
    (Array.isArray(item.task.tools) && item.task.tools.length > 0)
  );
  var weatherByDateHour = cfg && cfg.weatherByDateHour;
  var checkWeather = weatherByDateHour && item.task && hasWeatherConstraint(item.task);

  // Infinite-slack tasks (no deadline, no recurring anchor) are allowed to
  // extend the search past the initial date list — up to MAX_SEARCH_DAYS.
  // `env` carries the maps extendDatesTo needs to build new day entries
  // lazily rather than pre-computing 365 days of windows on every run.
  var env = opts && opts.env;
  var canExtend = env && !item.isRecurring && !item.deadlineDate && !(opts && opts.ignoreDeadline);

  var allowedDows = item.allowedDows;
  // Cross-cycle spacing guard for flexible tpc recurring. Skip any candidate
  // day whose date is within `minGap` days of this master's most recent
  // placement (from DB history seeded at entry, updated as this run commits).
  // Prevents the "placed Sat 4/25, next week places Fri 5/1 → 6-day gap"
  // drift, and the worst-case "Thu 4/30, Fri 5/1 → 1-day gap" cluster.
  // See docs/RECURRING-SPACING-DESIGN.md.
  var spacingMinKey = null;
  if (item.isFlexibleTpc && item.masterId && env && env.lastByMaster) {
    var lastKey = env.lastByMaster[item.masterId];
    if (lastKey && item.cycleDays > 1) {
      var minGap = Math.max(1, Math.floor(item.cycleDays * 0.5));
      var lastDate = parseDate(lastKey);
      if (lastDate) {
        var minAllowed = new Date(lastDate);
        minAllowed.setDate(minAllowed.getDate() + minGap);
        spacingMinKey = formatDateKey(minAllowed);
      }
    }
  }

  // Safety valve: if the spacing guard would block the entire search window
  // (prior occurrence displaced forward past this occurrence's anchor dates),
  // ignore the guard. Prevents permanently unplaceable occurrences when
  // out-of-order future placements corrupt lastByMaster.
  if (spacingMinKey && latestIdx >= earliestIdx && latestIdx < dates.length) {
    var lastSearchDay = dates[latestIdx];
    if (lastSearchDay && lastSearchDay.key < spacingMinKey) {
      spacingMinKey = null;
    }
  }

  var i = earliestIdx;
  while (i <= latestIdx || canExtend) {
    if (i >= dates.length) {
      if (!canExtend) break;
      extendDatesTo(i, dates, dayWindows, dayBlocks, dayOcc, env.dayOccPrefix,
        env.dayPlaced, env.dayPlacements, env.timeBlocks, cfg);
      if (i >= dates.length) break; // MAX_SEARCH_DAYS reached
      latestIdx = dates.length - 1;
    }
    var d = dates[i];
    // dayReq filter: skip days not in the task's allowed day-of-week set.
    // null means unconstrained (any day). This applies to all tasks, not just
    // recurring — a one-off task with dayReq=weekend should never land on
    // weekdays either.
    if (allowedDows && !allowedDows[d.isoDow]) { i++; continue; }
    // Cross-cycle spacing filter: reject days before minAllowed.
    if (spacingMinKey && d.key < spacingMinKey) { i++; continue; }
    var wins = eligibleWindows(item, d.key, dayWindows, dayBlocks, relaxWhen);
    if (wins.length) {
      var occ = dayOcc[d.key] || {};
      var blocks = dayBlocks[d.key];
      for (var w = 0; w < wins.length; w++) {
        var winStart = wins[w][0];
        var winEnd = wins[w][1];
        for (var s = winStart; s + item.dur <= winEnd; s += 15) {
          if (!isFreeWithTravel(occ, s, item.dur, item.travelBefore, item.travelAfter)) continue;
          if (checkDeps && !depsSatisfied(item, i, s, placedById, statuses, dates)) continue;
          if (checkLoc && !canTaskRunAtMin(item.task, d.key, s, cfg, toolMatrix, blocks)) continue;
          if (checkWeather && !weatherOk(item.task, d.key, s, weatherByDateHour)) continue;
          return { dateKey: d.key, start: s };
        }
      }
    }
    i++;
  }
  return null;
}

// Mirror of findEarliestSlot that searches from the end of the day backwards,
// returning the latest free slot. Used for scheduler-managed recurring tasks
// whose original time has passed — keeps them visible at end-of-day so the
// user can still mark them done.
function findLatestSlot(item, dates, dayWindows, dayBlocks, dayOcc, opts) {
  var earliestIdx = 0;
  var latestIdx = dates.length - 1;
  if (item.deadlineDate && !(opts && opts.ignoreDeadline)) {
    var di = indexOfDate(dates, item.deadlineDate);
    if (di >= 0) latestIdx = di;
  }
  if (item.isRecurring && item.anchorDate) {
    var ai = indexOfDate(dates, item.anchorDate);
    if (ai >= 0) {
      earliestIdx = ai;
      if (item.isDayLocked) {
        latestIdx = ai;
      } else if (item.cycleDays > 0) {
        var capIdx = ai + item.cycleDays - 1;
        if (capIdx < latestIdx) latestIdx = capIdx;
      } else {
        latestIdx = ai;
      }
    }
  }

  var placedById = opts && opts.placedById;
  var statuses = (opts && opts.statuses) || {};
  var relaxDepsL = !!(opts && opts.relaxDeps);
  var checkDeps = !relaxDepsL && placedById && item.dependsOn && item.dependsOn.length > 0;
  var relaxWhen = !!(opts && opts.relaxWhen);
  var cfg = (opts && opts.cfg) || null;
  var toolMatrix = cfg && cfg.toolMatrix;
  var checkLoc = cfg && item.task && (
    (Array.isArray(item.task.location) && item.task.location.length > 0) ||
    (Array.isArray(item.task.tools) && item.task.tools.length > 0)
  );
  var weatherByDateHour = cfg && cfg.weatherByDateHour;
  var checkWeather = weatherByDateHour && item.task && hasWeatherConstraint(item.task);

  for (var i = latestIdx; i >= earliestIdx; i--) {
    var d = dates[i];
    if (item.allowedDows && !item.allowedDows[d.isoDow]) continue;
    var wins = eligibleWindows(item, d.key, dayWindows, dayBlocks, relaxWhen);
    if (!wins.length) continue;
    var occ = dayOcc[d.key] || {};
    var blocks = dayBlocks[d.key];
    for (var w = wins.length - 1; w >= 0; w--) {
      var winStart = wins[w][0];
      var winEnd = wins[w][1];
      var startMax = Math.floor((winEnd - item.dur) / 15) * 15;
      for (var s = startMax; s >= winStart; s -= 15) {
        if (!isFreeWithTravel(occ, s, item.dur, item.travelBefore, item.travelAfter)) continue;
        if (checkDeps && !depsSatisfied(item, i, s, placedById, statuses, dates)) continue;
        if (checkLoc && !canTaskRunAtMin(item.task, d.key, s, cfg, toolMatrix, blocks)) continue;
        if (checkWeather && !weatherOk(item.task, d.key, s, weatherByDateHour)) continue;
        return { dateKey: d.key, start: s };
      }
    }
  }
  return null;
}

// Central placement attempt with fallback ladder. Returns:
//   { slot, overdue, relaxed } on success (any field may be unset/false)
//   { slot: null } on failure
// Attempts in order:
//   1. Normal: respect deadline + declared when
//   2. If slack < 0: drop deadline ceiling → place as overdue
//   3. If flex_when: relax when to 'anytime'
//   4. If both: drop deadline AND relax when (last resort)
function tryPlaceQueued(item, dates, dayWindows, dayBlocks, dayOcc, placedById, statuses, cfg, env) {
  var relaxDepsFlag = !!(env && env.relaxDeps);
  var base = { placedById: placedById, statuses: statuses, cfg: cfg, env: env, relaxDeps: relaxDepsFlag };
  var overdueApplicable = item.slack != null && isFinite(item.slack) && item.slack < 0;
  var flexApplicable = !!item.flexWhen;
  var findSlot = item.preferLatestSlot ? findLatestSlot : findEarliestSlot;

  var slot = findSlot(item, dates, dayWindows, dayBlocks, dayOcc, base);
  if (slot) return { slot: slot };

  if (overdueApplicable) {
    slot = findSlot(item, dates, dayWindows, dayBlocks, dayOcc,
      Object.assign({}, base, { ignoreDeadline: true }));
    if (slot) return { slot: slot, overdue: true };
  }

  if (flexApplicable) {
    slot = findSlot(item, dates, dayWindows, dayBlocks, dayOcc,
      Object.assign({}, base, { relaxWhen: true }));
    if (slot) return { slot: slot, relaxed: true };
  }

  if (overdueApplicable && flexApplicable) {
    slot = findSlot(item, dates, dayWindows, dayBlocks, dayOcc,
      Object.assign({}, base, { ignoreDeadline: true, relaxWhen: true }));
    if (slot) return { slot: slot, overdue: true, relaxed: true };
  }

  // Today's overdue recurring flexible tasks: if the designated when-window has
  // passed and the normal retries all failed, force a latest-slot relaxed-when
  // placement so the task stays visible and the user can still complete it.
  if (item.preferLatestSlot) {
    slot = findLatestSlot(item, dates, dayWindows, dayBlocks, dayOcc,
      Object.assign({}, base, { relaxWhen: true }));
    if (slot) return { slot: slot, relaxed: true };
  }

  return { slot: null };
}

function compareItems(a, b) {
  // Slack asc (Infinity to end).
  var sa = a.slack == null ? 0 : a.slack;
  var sb = b.slack == null ? 0 : b.slack;
  if (sa !== sb) {
    if (!isFinite(sa) && isFinite(sb)) return 1;
    if (isFinite(sa) && !isFinite(sb)) return -1;
    if (sa < sb) return -1;
    if (sa > sb) return 1;
  }
  // Priority asc (P1 < P2 < P3 < P4).
  if (a.pri < b.pri) return -1;
  if (a.pri > b.pri) return 1;
  // Duration desc (longer first).
  if (a.dur !== b.dur) return b.dur - a.dur;
  // Deterministic id tiebreak.
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

// ── Inline split placement ────────────────────────────────────
// Greedy placement for tasks with t.split===true that don't have pre-split
// ordinals. Places chunks of at least splitMin minutes in free slots, consuming
// available capacity until the full duration is covered or no more slots exist.
//
// Returns: { placed: [{dateKey, start, dur}], remaining: number }
//
// For recurring split tasks: restricted to the anchorDate only (isDayLocked).
// For non-recurring: searches across the eligible date range.
function placeSplitInline(item, remaining, splitMin, dates, dayWindows, dayBlocks, dayOcc, cfg) {
  var placed = [];
  var STEP = 15; // placement granularity

  // Build search index range.
  var earliestIdx = 0;
  var latestIdx = dates.length - 1;

  if (item.startAfterDate) {
    var sai = indexOfDate(dates, item.startAfterDate);
    if (sai > 0) earliestIdx = sai;
  }
  if (item.deadlineDate) {
    var di = indexOfDate(dates, item.deadlineDate);
    if (di >= 0 && di < latestIdx) latestIdx = di;
  }

  // Recurring split: restrict to anchor day only (must not spill into the
  // next occurrence's window).
  if (item.isRecurring && item.anchorDate) {
    var ai = indexOfDate(dates, item.anchorDate);
    if (ai >= 0) {
      earliestIdx = ai;
      if (item.isDayLocked) {
        latestIdx = ai;
      } else if (item.cycleDays > 0) {
        var capIdx = ai + item.cycleDays - 1;
        if (capIdx < latestIdx) latestIdx = capIdx;
      } else {
        latestIdx = ai;
      }
    }
  }

  for (var i = earliestIdx; i <= latestIdx && remaining > 0; i++) {
    if (i >= dates.length) break;
    var d = dates[i];
    // Day-of-week filter
    if (item.allowedDows && !item.allowedDows[d.isoDow]) continue;
    var wins = eligibleWindows(item, d.key, dayWindows, dayBlocks);
    if (!wins.length) continue;
    var occ = dayOcc[d.key];
    if (!occ) continue;

    for (var w = 0; w < wins.length && remaining > 0; w++) {
      var winStart = wins[w][0];
      var winEnd = wins[w][1];
      // Walk the window looking for free runs of >= splitMin minutes.
      var s = winStart;
      while (s < winEnd && remaining > 0) {
        if (occ[s]) { s++; continue; }
        // Count the free run from s.
        var freeEnd = s;
        while (freeEnd < winEnd && !occ[freeEnd]) freeEnd++;
        var freeLen = freeEnd - s;
        if (freeLen < splitMin) { s = freeEnd + 1; continue; }
        // Clamp chunk to remaining and floor to STEP granularity.
        var chunk = Math.min(freeLen, remaining);
        chunk = Math.floor(chunk / STEP) * STEP;
        if (chunk < splitMin) {
          // After flooring, chunk may be too small — try without flooring.
          chunk = Math.min(freeLen, remaining);
          if (chunk < splitMin) { s = freeEnd + 1; continue; }
        }
        // Place this chunk.
        reserve(occ, s, chunk);
        placed.push({ dateKey: d.key, start: s, dur: chunk });
        remaining -= chunk;
        s += chunk;
      }
    }
  }

  return { placed: placed, remaining: remaining };
}

// ── Main ──────────────────────────────────────────────────────
function unifiedScheduleV2(allTasks, statuses, effectiveTodayKey, nowMins, cfg) {
  cfg = cfg || {};

  // Build effective statuses: tasks in allTasks that have no explicit status
  // are live (pending). This ensures depsSatisfied correctly identifies
  // in-pool deps as live even when callers pass a sparse statuses map.
  // Without this, statuses[depId]===undefined is treated as "dep not in pool"
  // (satisfied), causing the scheduler to place a dep-dependent task before
  // its predecessor when the caller omits status entries.
  var effectiveStatuses = Object.assign({}, statuses);
  allTasks.forEach(function(t) {
    if (t && t.id && effectiveStatuses[t.id] === undefined) {
      effectiveStatuses[t.id] = t.status || '';
    }
  });

  var dates = buildDates(effectiveTodayKey, cfg, allTasks);
  if (dates.length === 0) {
    return {
      dayPlacements: {}, newStatuses: Object.assign({}, statuses),
      unplaced: [], deadlineMisses: [], placedCount: 0, score: scoreSchedule({}, [], allTasks),
      warnings: [{ type: 'v2_no_dates' }], timezone: cfg.timezone || null,
      spacingStats: {}, slackByTaskId: {}
    };
  }

  // Fall back to default blocks when cfg.timeBlocks is missing — keeps v2
  // resilient against test scenarios and partial cfg inputs. Production runs
  // always pass a populated timeBlocks, so this only matters for smoke tests.
  var timeBlocks = cfg.timeBlocks || constants.DEFAULT_TIME_BLOCKS;

  var dayOcc = {};
  var dayOccPrefix = {};
  var dayWindows = {};
  var dayBlocks = {};
  var dayPlaced = {};
  var dayPlacements = {};
  dates.forEach(function(d) {
    dayOcc[d.key] = {};
    dayOccPrefix[d.key] = new Int32Array(1441);
    dayPlaced[d.key] = [];
    dayPlacements[d.key] = [];
    dayBlocks[d.key] = getBlocksForDate(d.key, timeBlocks, cfg);
    dayWindows[d.key] = buildWindowsFromBlocks(dayBlocks[d.key]);
    if (d.isToday && nowMins != null) {
      var nowSlot = Math.ceil(nowMins / 15) * 15;
      for (var pm = 0; pm < nowSlot; pm++) dayOcc[d.key][pm] = true;
    }
  });

  // Cross-cycle spacing guard for flexible tpc recurring tasks. Seed with
  // DB history (latest placement date per master across all statuses from
  // cfg.recurringHistoryByMaster — see docs/RECURRING-SPACING-DESIGN.md)
  // and update on every recurring placement below so successive cycles in
  // this run see their predecessor's actual placement.
  var lastByMaster = Object.assign({}, cfg.recurringHistoryByMaster || {});

  // env carries everything findEarliestSlot needs to extend the dates list
  // on the fly for infinite-slack tasks. Declared once so we can thread the
  // same object through tryPlaceQueued in both the main loop and retry pass.
  var warnings = [];
  var env = {
    dayPlaced: dayPlaced,
    dayPlacements: dayPlacements,
    dayOccPrefix: dayOccPrefix,
    lastByMaster: lastByMaster,
    timeBlocks: timeBlocks,
    dayBlocks: dayBlocks,
    warnings: warnings
  };

  // Phase snapshots (debug mode only). captureSnapshot records the current
  // dayPlacements state at each named phase so the admin UI and tests can
  // inspect scheduling progress step-by-step.
  var phaseSnapshots = cfg._debug ? [] : null;
  function captureSnapshot(phaseName) {
    if (!phaseSnapshots) return;
    var days = {};
    Object.keys(dayPlacements).forEach(function(dk) {
      days[dk] = (dayPlacements[dk] || []).map(function(p) {
        return {
          taskId: p.task && p.task.id,
          text: p.task && p.task.text,
          start: p.start,
          dur: p.dur,
          type: p.locked ? 'fixed' : (p._conflict ? 'conflict' : 'flexible'),
        };
      });
    });
    phaseSnapshots.push({ phase: phaseName, timestamp: Date.now(), days: days });
  }

  var items = buildItems(allTasks, effectiveStatuses, dates, effectiveTodayKey, nowMins, cfg);

  // Chain deadline backpropagation. Walk dependsOn edges backward from
  // every tail (item with deadlineDate set from user input) and tighten
  // each predecessor's deadlineDate to the minimum it encounters along
  // any chain. Simplified vs v1 — we inherit the consumer's deadline
  // date directly rather than subtracting a capacity-aware offset.
  // Diff-mode will surface cases where this imprecision matters.
  (function backpropagateChainDeadlines() {
    var itemsById = {};
    items.forEach(function(i) { itemsById[i.id] = i; });
    var q = items.filter(function(i) { return i.deadlineDate; }).slice();
    var MAX_ITERS = items.length * items.length; // safety against pathological DAGs
    var iters = 0;
    while (q.length > 0 && iters < MAX_ITERS) {
      iters++;
      var consumer = q.shift();
      var predIds = consumer.dependsOn || [];
      for (var i = 0; i < predIds.length; i++) {
        var pred = itemsById[predIds[i]];
        if (!pred) continue;
        var propagated = consumer.deadlineDate;
        if (!pred.deadlineDate || propagated < pred.deadlineDate) {
          pred.deadlineDate = propagated;
          q.push(pred); // re-visit: a tighter deadline may need to flow further back
        }
      }
    }
  })();

  // Backwards dependency detection: warn when a task is pinned/anchored to a date
  // that is BEFORE its dependency's anchor date (A depends on B, but A is before B).
  // These deps can never be satisfied — surface as warnings so the UI can flag them.
  (function detectBackwardsDeps() {
    var itemsById = {};
    items.forEach(function(item) { itemsById[item.id] = item; });
    items.forEach(function(item) {
      if (!item.anchorDate || !item.dependsOn || item.dependsOn.length === 0) return;
      item.dependsOn.forEach(function(depId) {
        var dep = itemsById[depId];
        if (!dep || !dep.anchorDate) return;
        // Backwards: item must be after dep but item's date ≤ dep's date.
        if (item.anchorDate < dep.anchorDate) {
          warnings.push({ type: 'backwardsDep', taskId: item.id, depId: depId });
        }
      });
    });
  })();

  // Pre-classify past-anchored recurring items (date before today) — these
  // never enter the queue. They'll be force-placed by the past-anchored pass
  // after the retry pass. Placing them through the queue would allow them to
  // drift to a future day (wrong behavior — they should appear on their original date).
  var pastAnchoredPreQueue = [];

  // Phase 0 analog: immovables (pinned, fixed-when, rigid-recurring with
  // preferred time, markers at their specified time). They claim their slots
  // before the slack-sorted queue is built, so other items' slack reflects
  // actual occupancy. Markers have dur=0 so `reserve` is a no-op for them —
  // they appear on the calendar without blocking time.
  var queue = [];
  var todayIsoKey = dates.length > 0 ? dates[0].key : toKey(effectiveTodayKey);
  // Items flagged isMissedPreferredTime are collected here; handled after the
  // retry pass (below) without entering the placement queue or the dual-place path.
  var missedPreferredTimeItems = [];
  items.forEach(function(item) {
    // Past-anchored recurring: skip the queue entirely — handled by a dedicated pass later.
    if (item.isRecurring && item.anchorDate && item.anchorDate < todayIsoKey) {
      pastAnchoredPreQueue.push(item);
      return;
    }
    // Missed preferred-time: recurring task whose preferred-time window has
    // entirely passed but is not in TIME_WINDOW mode (which has its own
    // dual-place path). Skip the queue entirely — mark missed below.
    if (item.isMissedPreferredTime) {
      missedPreferredTimeItems.push(item);
      return;
    }
    var isRigidWithAnchor = item.isRecurring && item.isRigid && item.anchorMin != null;
    var isImmovable =
      (item.isMarker && item.anchorDate && item.anchorMin != null) ||
      item.isPinned ||
      (item.isFixedWhen && item.anchorMin != null) ||
      isRigidWithAnchor;
    if (isImmovable) {
      // For rigid recurrings: check whether the anchor slot is already occupied
      // by a previously placed task (not merely by the nowMins time-boundary).
      // If occupied by a task, displace to the next available slot via the queue
      // so that all rigid recurrings at the same anchor time don't overlap.
      // If the slot is clear (or only blocked by nowMins), place immovably at
      // the anchor time — rigid means "user pinned this time", and it must
      // remain visible even if the time has already passed.
      if (isRigidWithAnchor) {
        var rigidAnchorDate = item.anchorDate;
        var rigidAnchorMin = item.anchorMin;
        var rigidDur = item.dur;
        var hasTaskConflict = (dayPlaced[rigidAnchorDate] || []).some(function(p) {
          return p.start < rigidAnchorMin + rigidDur && p.start + p.dur > rigidAnchorMin;
        });
        if (!hasTaskConflict && tryPlaceAtTime(item, dates, dayOcc, dayPlaced, dayPlacements, cfg, env)) {
          return;
        }
        // Task conflict at anchor — queue for next available non-overlapping slot.
        queue.push(item);
        return;
      }
      if (tryPlaceAtTime(item, dates, dayOcc, dayPlaced, dayPlacements, cfg, env)) {
        return;
      }
    }
    queue.push(item);
  });

  // Rebuild all prefix sums once after immovables are placed so the slack
  // computation below sees correct occupancy for every day.
  dates.forEach(function(d) { rebuildPrefix(dayOcc[d.key], dayOccPrefix[d.key]); });
  captureSnapshot('immovables');

  // Compute initial slack AND cache capacity for each queued item.
  // Capacity is the total free minutes in the item's eligible windows
  // across its earliest..deadline range (just slack + duration). After
  // each placement we subtract the consumed overlap from capacity and
  // re-derive slack — avoids the O(days × windows × minutes) recompute.
  queue.forEach(function(item) {
    item.slack = computeSlack(item, dates, dayWindows, dayBlocks, dayOcc, dayOccPrefix);
    // Capacity only meaningful for finite-slack items — free tasks
    // (slack=Infinity) never need re-sort.
    if (item.slack != null && isFinite(item.slack)) {
      item.capacity = item.slack + item.dur;
    }
  });
  captureSnapshot('slack_computed');

  // Dynamic-slack placement loop (4.3).
  //
  // After each commit, any remaining item whose eligible date range included
  // the consumed slot's date had its capacity reduced — recompute its slack
  // so the next iteration's sort reflects reality. Items that couldn't have
  // used the slot (earliest > slot date, or deadline < slot date) keep their
  // existing slack.
  //
  // Sort is re-run every iteration. For N ≈ 300 tasks that's ~N² log N
  // operations (~600k) — well under our scheduler latency budget. A
  // min-heap would reduce this to N² log N vs N log N, but correctness
  // takes priority over micro-optimization at this stage.
  var unplaced = [];
  var slackByTaskId = {};
  var queuePlacedCount = 0; // for periodic snapshots in debug mode
  // placedById tracks every placement — immovables from Phase 0 plus every
  // queue commit. findEarliestSlot consults it to gate candidate slots on
  // dependency completion. Immovables are seeded below; queue items are
  // added as they commit.
  var placedById = {};
  Object.keys(dayPlacements).forEach(function(dk) {
    (dayPlacements[dk] || []).forEach(function(p) {
      if (p && p.task && p.task.id) {
        placedById[p.task.id] = { dateKey: dk, start: p.start, dur: p.dur };
      }
    });
  });

  function rangeIncludesDate(item, dateIdx) {
    var start = 0;
    if (item.startAfterDate) {
      var si = indexOfDate(dates, item.startAfterDate);
      if (si > 0) start = si;
    }
    var end = dates.length - 1;
    if (item.deadlineDate) {
      var di = indexOfDate(dates, item.deadlineDate);
      if (di >= 0) end = di;
    }
    return dateIdx >= start && dateIdx <= end;
  }

  while (queue.length > 0) {
    queue.sort(compareItems);
    var item = queue.shift();
    slackByTaskId[item.id] = item.slack == null || !isFinite(item.slack) ? null : Math.round(item.slack);

    var placement = tryPlaceQueued(item, dates, dayWindows, dayBlocks, dayOcc, placedById, effectiveStatuses, cfg, env);
    if (!placement.slot) {
      // Inline split expansion: tasks with split===true that can't fit as a
      // single contiguous block are placed greedily in chunks of >= splitMin.
      // Each chunk is a separate placement entry sharing the same task object.
      // Recurring split chunks stay day-locked (isDayLocked drives the search);
      // non-recurring splits may span days up to the deadline.
      if (item.task && item.task.split && item.splitOrdinal <= 1 && item.splitTotal <= 1) {
        var splitMin = (item.task.splitMin != null ? item.task.splitMin : null) ||
                       (cfg && cfg.splitMinDefault) || 15;
        var splitResult = placeSplitInline(item, item.dur, splitMin, dates, dayWindows, dayBlocks, dayOcc, cfg);
        if (splitResult.placed.length > 0) {
          var splitPlacedFirst = splitResult.placed[0];
          splitResult.placed.forEach(function(chunk) {
            var chunkEntry = { task: item.task, start: chunk.start, dur: chunk.dur, locked: false,
              travelBefore: 0, travelAfter: 0,
              _placementReason: buildPlacementReason(item, false, getBlockNameForItem(item, chunk.dateKey, dayBlocks)) };
            if (!dayPlaced[chunk.dateKey]) dayPlaced[chunk.dateKey] = [];
            if (!dayPlacements[chunk.dateKey]) dayPlacements[chunk.dateKey] = [];
            dayPlaced[chunk.dateKey].push(chunkEntry);
            dayPlacements[chunk.dateKey].push(chunkEntry);
          });
          // Record placement as the first chunk's slot for dep-ordering.
          placedById[item.id] = { dateKey: splitPlacedFirst.dateKey, start: splitPlacedFirst.start, dur: item.dur };
          noteMasterPlacement(env, item, splitPlacedFirst.dateKey);
          queuePlacedCount += splitResult.placed.length;
          if (splitResult.remaining > 0) {
            // Partial placement: mark as partial_split in unplaced.
            item.task._unplacedReason = 'partial_split';
            unplaced.push(item);
          }
          // Recompute slack for affected items (use first chunk's date).
          var splitSlotIdx = indexOfDate(dates, splitPlacedFirst.dateKey);
          if (splitSlotIdx >= 0) {
            splitResult.placed.forEach(function(chunk) {
              var chunkIdx = indexOfDate(dates, chunk.dateKey);
              if (chunkIdx < 0) return;
              queue.forEach(function(other) {
                if (other.slack == null || !isFinite(other.slack)) return;
                if (!rangeIncludesDate(other, chunkIdx)) return;
                var ov = overlapWithEligibleWindows(other, chunk.dateKey, chunk.start, chunk.dur, dayWindows, dayBlocks);
                if (ov > 0) { other.capacity -= ov; other.slack = other.capacity - other.dur; }
              });
            });
          }
          continue;
        }
      }
      // Might be dep-blocked; retry pass below will give it another chance
      // once deps settle. Tag so the retry can identify what was deferred.
      item._deferred = true;
      // Heuristic: attribute to weather if task has weather constraints; may be capacity failure
      if (hasWeatherConstraint(item.task)) item.task._unplacedReason = 'weather';
      unplaced.push(item);
      continue;
    }
    var slot = placement.slot;
    reserveWithTravel(dayOcc[slot.dateKey], slot.start, item.dur, item.travelBefore, item.travelAfter);
    var entry = { task: item.task, start: slot.start, dur: item.dur, locked: false,
      travelBefore: item.travelBefore || 0, travelAfter: item.travelAfter || 0,
      _placementReason: buildPlacementReason(item, false, getBlockNameForItem(item, slot.dateKey, dayBlocks)) };
    if (placement.overdue) entry._overdue = true;
    if (placement.relaxed) entry._flexWhenRelaxed = true;
    dayPlaced[slot.dateKey].push(entry);
    dayPlacements[slot.dateKey].push(entry);
    placedById[item.id] = { dateKey: slot.dateKey, start: slot.start, dur: item.dur };
    noteMasterPlacement(env, item, slot.dateKey);
    emitStepRecord(cfg,
      (item.slack != null && isFinite(item.slack)) ? 'V2: Constrained' : 'V2: Unconstrained',
      item, slot.start, item.dur, slot.dateKey, false, dayPlaced,
      { overdue: placement.overdue, relaxed: placement.relaxed });
    queuePlacedCount++;
    if (phaseSnapshots && queuePlacedCount % 5 === 0) captureSnapshot('queue_step_' + queuePlacedCount);

    // Recompute slack for affected remaining items. An item is affected
    // only if the committed slot's date falls within its eligible range
    // *and* it has a finite slack to begin with (Infinity-slack items are
    // free tasks — their "slack" is a sentinel, not a real budget, so
    // capacity changes don't move them).
    var slotIdx = indexOfDate(dates, slot.dateKey);
    if (slotIdx >= 0) {
      // Incremental capacity subtraction. For every finite-slack item whose
      // eligible range includes the committed slot's date, subtract the
      // overlap between the committed slot and that item's eligible windows
      // on that date. Derive new slack from capacity. This replaces a full
      // computeSlack() per affected item — profile showed ~10x faster loop.
      queue.forEach(function(other) {
        if (other.slack == null || !isFinite(other.slack)) return;
        if (!rangeIncludesDate(other, slotIdx)) return;
        var ov = overlapWithEligibleWindows(other, slot.dateKey, slot.start, item.dur, dayWindows, dayBlocks);
        if (ov > 0) {
          other.capacity -= ov;
          other.slack = other.capacity - other.dur;
        }
      });
    }
  }

  captureSnapshot('queue_done');

  // Retry pass: items that deferred because of unmet deps may now be
  // placeable — their deps could have landed later in the main pass (e.g.
  // a diamond DAG where the slack sort didn't match topological order).
  // One pass is enough; additional rounds would only matter for pathological
  // multi-level chains that broke deterministic ordering, which v1 also
  // doesn't fully handle.
  var retryQueue = unplaced.filter(function(u) { return u && u._deferred; });
  var stillUnplaced = unplaced.filter(function(u) { return !(u && u._deferred); });
  retryQueue.forEach(function(item) {
    delete item._deferred;
    var placement = tryPlaceQueued(item, dates, dayWindows, dayBlocks, dayOcc, placedById, effectiveStatuses, cfg, env);
    if (!placement.slot) {
      // Heuristic: attribute to weather if task has weather constraints; may be capacity failure
      if (hasWeatherConstraint(item.task)) item.task._unplacedReason = 'weather';
      stillUnplaced.push(item);
      return;
    }
    var slot = placement.slot;
    reserveWithTravel(dayOcc[slot.dateKey], slot.start, item.dur, item.travelBefore, item.travelAfter);
    var entry = { task: item.task, start: slot.start, dur: item.dur, locked: false,
      travelBefore: item.travelBefore || 0, travelAfter: item.travelAfter || 0,
      _placementReason: buildPlacementReason(item, false, getBlockNameForItem(item, slot.dateKey, dayBlocks)) };
    if (placement.overdue) entry._overdue = true;
    if (placement.relaxed) entry._flexWhenRelaxed = true;
    dayPlaced[slot.dateKey].push(entry);
    dayPlacements[slot.dateKey].push(entry);
    placedById[item.id] = { dateKey: slot.dateKey, start: slot.start, dur: item.dur };
    noteMasterPlacement(env, item, slot.dateKey);
    emitStepRecord(cfg, 'V2: Retry', item, slot.start, item.dur, slot.dateKey, false, dayPlaced,
      { overdue: placement.overdue, relaxed: placement.relaxed });
  });
  captureSnapshot('retry_done');

  // Merge pre-queue past-anchored recurring items into stillUnplaced so the
  // past-anchored pass below can handle them. They were never put into the queue
  // to prevent drifting to future dates.
  pastAnchoredPreQueue.forEach(function(item) { stillUnplaced.push(item); });

  // Missed-preferred-time pass: recurring tasks (non-TIME_WINDOW) whose
  // preferred-time window has entirely passed. They are marked missed and go
  // to unplaced only — no dual grid placement (they don't have a time window
  // to anchor a visible calendar slot).
  missedPreferredTimeItems.forEach(function(item) {
    item.task._unplacedReason = 'missed';
    item.task._unplacedDetail = 'Preferred-time window has passed';
    stillUnplaced.push(item);
  });

  // Missed-window pass: TIME_WINDOW tasks whose flex window is entirely past.
  // They appear in unplaced (with 'missed' reason). When the task has a `when`
  // block (e.g. 'morning'), they are also dual-placed on the grid with _overdue
  // so the user can mark them done without leaving the day view. Tasks with no
  // `when` block have no obvious calendar anchor and are unplaced-only.
  var missedWindowItems = stillUnplaced.filter(function(u) {
    return u && u.isMissedWindow;
  });
  stillUnplaced = stillUnplaced.filter(function(u) {
    return !(u && u.isMissedWindow);
  });
  missedWindowItems.forEach(function(item) {
    var task = item.task;
    // Mark missed on the task object for unplaced output.
    task._unplacedReason = 'missed';
    task._unplacedDetail = 'Flex window has passed';
    // Also push to unplaced list for ConflictsView / pastDue pickup.
    stillUnplaced.push(item);
    // Dual-place on the grid only when the task has a when-block anchor.
    // Tasks with no when-tag have no obvious calendar slot to anchor the
    // overdue entry, so they stay unplaced-only.
    if (item.when && item.when.trim() !== '') {
      var overdueDateKey = item.anchorDate || dates[0].key;
      if (!dayPlacements[overdueDateKey]) dayPlacements[overdueDateKey] = [];
      dayPlacements[overdueDateKey].push({
        task: task,
        start: item.preferredTimeMins != null ? item.preferredTimeMins : (item.anchorMin || 0),
        dur: item.dur,
        locked: false,
        _overdue: true,
        travelBefore: 0,
        travelAfter: 0,
        _placementReason: 'Recurring window missed — placed for completion',
      });
    }
  });

  captureSnapshot('missed_window_done');

  // Past-anchored recurring pass: recurring items whose anchorDate is before today
  // couldn't be found in the dates array by findEarliestSlot. Force-place them on
  // their original anchor date so they appear for the user to mark done/skip.
  var pastAnchoredRecurrings = stillUnplaced.filter(function(u) {
    return u && u.isRecurring && u.anchorDate && u.anchorDate < todayIsoKey;
  });
  stillUnplaced = stillUnplaced.filter(function(u) {
    return !(u && u.isRecurring && u.anchorDate && u.anchorDate < todayIsoKey);
  });
  pastAnchoredRecurrings.forEach(function(item) {
    var pastTask = item.task;
    var paDate = item.anchorDate;
    var paStart = item.preferredTimeMins != null ? item.preferredTimeMins :
                  (item.anchorMin != null ? item.anchorMin : 0);
    if (!dayPlacements[paDate]) dayPlacements[paDate] = [];
    dayPlacements[paDate].push({
      task: pastTask,
      start: paStart,
      dur: item.dur,
      locked: false,
      _overdue: true,
      travelBefore: 0,
      travelAfter: 0,
      _placementReason: 'Recurring window missed — placed for completion',
    });
  });

  // Force-placement pass: fixed tasks must always appear even when their
  // when-block is full or in the past. Place at block start with _conflict=true.
  var rigidUnplaced = stillUnplaced.filter(function(u) {
    var task = u && u.task ? u.task : u;
    return task && (task.placementMode === PLACEMENT_MODES.FIXED || (u && u.isRigid));
  });
  var remainingUnplaced = stillUnplaced.filter(function(u) {
    var task = u && u.task ? u.task : u;
    return !(task && (task.placementMode === PLACEMENT_MODES.FIXED || (u && u.isRigid)));
  });

  rigidUnplaced.forEach(function(u) {
    var item = u;
    var task = item.task || item;

    // Determine force-placement date and start minute.
    var forceDate = (item.anchorDate) || (task.date ? toKey(task.date) : dates[0].key);
    var forceStart = item.anchorMin || null;

    if (forceStart == null && task.when) {
      var fBlocks = dayBlocks[forceDate] || [];
      var whenParts = task.when.split(',').map(function(w) { return w.trim().toLowerCase(); });
      for (var bi = 0; bi < fBlocks.length; bi++) {
        if (whenParts.indexOf(fBlocks[bi].tag) >= 0) {
          forceStart = fBlocks[bi].start;
          break;
        }
      }
    }
    if (forceStart == null) forceStart = nowMins || 0;

    var forceDur = item.dur != null ? item.dur : (task.dur || 30);
    var fBlockName = null;
    if (task.when) {
      var fBlocks2 = dayBlocks[forceDate] || [];
      var wp2 = task.when.split(',').map(function(w) { return w.trim().toLowerCase(); });
      for (var bi2 = 0; bi2 < fBlocks2.length; bi2++) {
        if (wp2.indexOf(fBlocks2[bi2].tag) >= 0) { fBlockName = fBlocks2[bi2].name; break; }
      }
    }

    // Mark task overdue if its forced time is in the past on today.
    var forceIsOverdue = forceDate === todayIsoKey && nowMins != null && forceStart < nowMins;
    if (forceIsOverdue) task._overdue = true;

    if (!dayPlacements[forceDate]) dayPlacements[forceDate] = [];
    var forceEntry = {
      task: task,
      start: forceStart,
      dur: forceDur,
      locked: true,
      _conflict: true,
      travelBefore: 0,
      travelAfter: 0,
      _placementReason: 'Rigid recurring: ' + (fBlockName || task.when || 'block') + ' (overlap)',
    };
    if (forceIsOverdue) forceEntry._overdue = true;
    dayPlacements[forceDate].push(forceEntry);
    // Emit a recurringConflict warning so callers can surface UI feedback.
    warnings.push({ type: 'recurringConflict', taskId: task.id });
  });
  stillUnplaced = remainingUnplaced;
  captureSnapshot('rigid_forced');

  // Dep-relaxation pass: deadline tasks (deadline ≤ today) that are still unplaced
  // because their dep chain couldn't fully land. Place them ignoring dep constraints
  // as a last resort — something is better than missing a hard deadline entirely.
  var deadlineRelaxed = stillUnplaced.filter(function(u) {
    return u && u.task && u.deadlineDate && u.deadlineDate <= todayIsoKey &&
           u.dependsOn && u.dependsOn.length > 0;
  });
  stillUnplaced = stillUnplaced.filter(function(u) {
    return !(u && u.task && u.deadlineDate && u.deadlineDate <= todayIsoKey &&
             u.dependsOn && u.dependsOn.length > 0);
  });
  deadlineRelaxed.forEach(function(item) {
    // Try with dep-relaxation first. If still can't place, also ignore deadline
    // (last resort: place on any future day rather than miss the deadline entirely).
    var relaxedEnv = Object.assign({}, env, { relaxDeps: true });
    var slot = findEarliestSlot(item, dates, dayWindows, dayBlocks, dayOcc,
      { placedById: placedById, statuses: effectiveStatuses, cfg: cfg, env: relaxedEnv,
        relaxDeps: true, ignoreDeadline: true });
    var placement = slot ? { slot: slot, overdue: true } : { slot: null };
    if (!placement.slot) {
      // Still can't place — return to unplaced
      stillUnplaced.push(item);
      return;
    }
    var slot = placement.slot;
    reserveWithTravel(dayOcc[slot.dateKey], slot.start, item.dur, item.travelBefore, item.travelAfter);
    var rEntry = { task: item.task, start: slot.start, dur: item.dur, locked: false,
      travelBefore: item.travelBefore || 0, travelAfter: item.travelAfter || 0,
      _placementReason: buildPlacementReason(item, false, null) };
    if (placement.overdue) rEntry._overdue = true;
    dayPlaced[slot.dateKey].push(rEntry);
    dayPlacements[slot.dateKey].push(rEntry);
    placedById[item.id] = { dateKey: slot.dateKey, start: slot.start, dur: item.dur };
  });

  // Convert deferred items back to task-object shape for the output contract.
  var unplacedTasks = stillUnplaced.map(function(entry) {
    return entry && entry.task ? entry.task : entry;
  });

  var placedCount = 0;
  Object.keys(dayPlacements).forEach(function(k) { placedCount += dayPlacements[k].length; });

  return Object.assign({
    dayPlacements: dayPlacements,
    newStatuses: Object.assign({}, statuses),
    unplaced: unplacedTasks,
    deadlineMisses: [],
    placedCount: placedCount,
    score: scoreSchedule(dayPlacements, unplacedTasks, allTasks),
    warnings: warnings,
    timezone: cfg.timezone || null,
    spacingStats: {},
    slackByTaskId: slackByTaskId
  }, phaseSnapshots ? { phaseSnapshots: phaseSnapshots } : {});
}

module.exports = unifiedScheduleV2;

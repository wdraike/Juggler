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
 *   - Dependency-met check: IMPLEMENTED — checkDeps gate + computeDepReadyAbs() hoisted
 *     once per scan (A-001); depReadyAbs compared per slot in findEarliestSlot / findLatestSlot.
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
// var hasWhen = timeBlockHelpers.hasWhen; // unused

// var expandRecurringMod = require('../../../shared/scheduler/expandRecurring');
// var expandRecurring = expandRecurringMod.expandRecurring; // unused

var locationHelpers = require('./locationHelpers');
var _canTaskRunAtMin = locationHelpers.canTaskRunAtMin;
var canTaskRunAtMinCached = locationHelpers.canTaskRunAtMinCached;
var resolveLocationId = locationHelpers.resolveLocationId;
var whyCannotRun = locationHelpers.whyCannotRun;

var { PLACEMENT_MODES } = require('../lib/placementModes');

// Canonical reason-code enum — eliminates magic strings at every _unplacedReason
// assignment site. String VALUES are byte-identical to what tests pin; only the
// call sites are updated. See shared/scheduler/reasonCodes.js for the full taxonomy.
var { REASON_CODES } = require('../../../shared/scheduler/reasonCodes');

// H6 W1: the pure ordering/occupancy primitives now live in the scheduler domain
// core. unifiedScheduleV2 DELEGATES to them so the algorithm has a single source
// of truth in src/slices/scheduler/domain/. These are byte-identical moves — the
// golden-master (S1 ordering, occupancy-driven placements) runs through this entry
// point and pins the behavior. ScoreEngine is reached via scoreSchedule.js (which
// already delegates), so no second import is needed here.
var ConstraintSolver = require('../slices/scheduler/domain/logic/ConstraintSolver');
var ConflictResolver = require('../slices/scheduler/domain/logic/ConflictResolver');

var DAY_START = GRID_START * 60;
var DAY_END = GRID_END * 60 + 59;

// effectiveDuration — MOVED to ConstraintSolver (H6 W1). Local binding preserves
// every call site unchanged; behavior is byte-identical.
var effectiveDuration = ConstraintSolver.effectiveDuration;

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

// normalizePri — MOVED to ConstraintSolver (→ Priority.normalize) in H6 W1.
// Local binding preserves call sites; behavior is byte-identical.
var normalizePri = ConstraintSolver.normalizePri;

// ── Occupancy primitives ────────────────────────────────────────
// Travel buffers (tb/ta) extend the footprint in both directions so adjacent
// tasks can't crowd into commute time. isFreeWithTravel rejects the slot if
// any minute in [start-tb, start+dur+ta) is busy; reserveWithTravel marks
// that whole range occupied.
// Occupancy primitives — MOVED to ConflictResolver (H6 W1). Local bindings keep
// every call site unchanged; the minute-grid representation is identical, so
// placements stay bit-for-bit. (`isFree` is currently unused but preserved as a
// binding to keep the public surface of this module stable.)
var reserve = ConflictResolver.reserve;
var reserveWithTravel = ConflictResolver.reserveWithTravel;
var rebuildPrefix = ConflictResolver.rebuildPrefix;
var _isFree = ConflictResolver.isFree;
var isFreeWithTravel = ConflictResolver.isFreeWithTravel;

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
// parseDayReq (and its DOW_CODE_TO_IDX map) — MOVED to ConstraintSolver (H6 W1).
// Local binding preserves call sites; behavior is byte-identical.
var parseDayReq = ConstraintSolver.parseDayReq;

// Recurrence cycle length in days. Used to cap the placement-search window for
// flexible recurring instances (tpc picks a specific date but the instance can
// land on any of its allowed days within the cycle). Returns 0 when the
// recurrence has no natural cycle (e.g. none) so the caller can skip the cap.
// recurringCycleDays — MOVED to ConstraintSolver (H6 W1). Local binding preserves
// call sites; behavior is byte-identical.
var recurringCycleDays = ConstraintSolver.recurringCycleDays;

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
function buildItems(allTasks, statuses, dates, todayKey, nowMins, _cfg) {
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
    if (st === 'done' || st === 'cancel' || st === 'skip' || st === 'pause' || st === 'disabled' || st === 'cancelled') return;

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
    // Phase 15: Removed legacy 'allday'/'fixed' strip logic — only placement_mode is used now.
    // Past ANYTIME recurring instances (recurring=true, date in past, no time anchor)
    // are dropped — they already passed and should not be rescheduled to today.
    // TIME_WINDOW tasks from prior days still go through the missed-window path
    // so they can be force-placed with _overdue on their original day.
    // FIXED tasks from prior days still go through the force-placement pass.
    // EXCEPTION (R50.0): flexible-TPC ANYTIME recurring instances whose recurrence
    // period has NOT yet ended must NOT be dropped here — they will be forward-rolled
    // by the pastAnchoredPreQueue bypass below. Day-locked instances still drop.
    if (t.recurring && pm === PLACEMENT_MODES.ANYTIME && t.date && toKey(t.date) < todayIsoKey) {
      // Compute flexible-TPC inline (mirrors isFlexibleTpc at line 496).
      var _isFlexTpcCheck = (function() {
        var _r = t.recur;
        if (typeof _r === 'string') { try { _r = JSON.parse(_r); } catch (_e) { return false; } }
        if (!_r || !_r.timesPerCycle || _r.timesPerCycle <= 0) return false;
        var _sel;
        if (_r.type === 'daily') _sel = 7;
        else if (_r.type === 'weekly' || _r.type === 'biweekly') {
          var _days = _r.days || 'MTWRF';
          _sel = (typeof _days === 'object' && !Array.isArray(_days)) ? Object.keys(_days).length
            : (typeof _days === 'string' ? _days.length : 0);
        } else if (_r.type === 'monthly') { _sel = (_r.monthDays || [1, 15]).length; }
        else { _sel = 1; }
        return _r.timesPerCycle < _sel;
      })();
      if (_isFlexTpcCheck) {
        // Flexible-TPC: check if the recurrence period has ended.
        var _cycleLen = recurringCycleDays(t.recur) || 1;
        var _anchor = parseDate(toKey(t.date));
        if (_anchor) {
          var _periodEnd = new Date(_anchor.getTime());
          _periodEnd.setDate(_periodEnd.getDate() + _cycleLen);
          var _todayDate = parseDate(todayIsoKey);
          if (_todayDate && _todayDate < _periodEnd) {
            // Within period — do NOT drop; let it flow through to build its item
            // so the pastAnchoredPreQueue bypass can forward-roll it.
          } else {
            return; // Period ended — drop as before
          }
        } else {
          return; // Cannot parse anchor date — drop as before
        }
      } else {
        return; // Day-locked — drop as before
      }
    }
    var pri = normalizePri(t.pri);
    var priRank = PRI_RANK[pri] || 50;
    // fixed = true only for non-recurring calendar events in FIXED mode.
    // Recurring FIXED tasks (rigid recurrings) use isRigid instead — they can
    // be displaced from their anchor when the slot is occupied, whereas truly
    // fixed calendar events cannot be moved.
    var fixed = pm === PLACEMENT_MODES.FIXED && !t.recurring;
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
    // R52 frozen invariant: a STARTED (wip) instance pins to its LIVE placement
    // regardless of placement mode. Its t.time was derived from the current
    // scheduled_at (the user is actively working it) — authoritative, NOT the
    // stale-cache case the ANYTIME exclusion above guards against. Anchor it so it
    // routes through the immovable path and is never re-placed.
    if (anchorMin == null && st === 'wip' && t.time) {
      anchorMin = parseTimeToMinutes(t.time);
    }
    // Defensive guard: if anchorMin is STILL null for a wip with a live
    // scheduled_at (t.time was unparseable — e.g. unexpected format), derive
    // anchorMin from scheduled_at via tz-aware utcToLocal so the item is never
    // silently de-anchored. Do NOT use a || fallback — only attempt this when
    // the wip + scheduled_at condition is confirmed.
    if (anchorMin == null && st === 'wip' && t.scheduledAt && t.tz) {
      var saLocal = dateHelpers.utcToLocal(new Date(t.scheduledAt), t.tz);
      if (saLocal && saLocal.time) {
        var saMin = parseTimeToMinutes(saLocal.time);
        if (saMin != null) {
          anchorMin = saMin;
        } else {
          console.warn('[unifiedScheduleV2] wip anchor: could not parse scheduled_at local time for task', t.id, 'saLocal.time=', saLocal.time);
        }
      } else {
        console.warn('[unifiedScheduleV2] wip anchor: utcToLocal returned no time for task', t.id, 'scheduledAt=', t.scheduledAt, 'tz=', t.tz);
      }
    }
    // DB-single-source (W2 / Odin): a non-recurring FIXED calendar event whose
    // anchorMin is STILL null — t.time was distrusted (when-tag present, line 294)
    // and there is no preferred_time_mins — must anchor at its PERSISTED placement.
    // scheduled_at is the authoritative fixed time the user/calendar-sync set;
    // without this the event gets no anchor and the scheduler drops it at the next
    // free slot (Odin showed 7:15 PM instead of its 8:00 AM scheduled_at).
    // Derive the local time in _cfg.timezone (buildItems' cfg param, = the request
    // display tz = TIMEZONE) — the SAME tz rowToTask used for t.time/anchorDate AND
    // the persist writeback
    // (localToUtc(..., TIMEZONE)). Using row.tz here would desync from the writeback
    // and silently drift scheduled_at by the tz offset on the next run (ernie BLOCK-1).
    // NOT a || fallback — only when fixed + scheduled_at + a display tz are confirmed.
    if (anchorMin == null && fixed && t.scheduledAt && _cfg && _cfg.timezone) {
      var fxLocal = dateHelpers.utcToLocal(new Date(t.scheduledAt), _cfg.timezone);
      if (fxLocal && fxLocal.time) {
        var fxMin = parseTimeToMinutes(fxLocal.time);
        if (fxMin != null) {
          anchorMin = fxMin;
        } else {
          console.warn('[unifiedScheduleV2] fixed anchor: could not parse scheduled_at local time for task', t.id, 'fxLocal.time=', fxLocal.time);
        }
      } else {
        console.warn('[unifiedScheduleV2] fixed anchor: utcToLocal returned no time for task', t.id, 'scheduledAt=', t.scheduledAt, 'tz=', _cfg.timezone);
      }
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
      try { depsOn = JSON.parse(t.dependsOn) || []; } catch (_e) { depsOn = []; }
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

    // RC-B (BUG-143-B): for recurring tasks, derive a weekday constraint from
    // recur.days and COMBINE it with allowedDows via null-aware intersection:
    //   intersect(null, X) = X   (null means unconstrained)
    //   intersect(X, null) = X
    //   intersect(X, Y)   = X ∩ Y  (may be empty — no valid placement day)
    // This ensures flexible-TPC instances (isFlexibleTpc=true, isDayLocked=false)
    // that roam within their cycleDays window are still gated to the days their
    // recurrence pattern allows (e.g. recur.days='MTWRF' forbids Sat/Sun).
    // Non-recurring tasks skip this block entirely (AC4 golden-master).
    // Types that carry no weekday pattern (daily, monthly, interval without days)
    // produce no recurDows constraint and leave allowedDows unchanged.
    if (recurring && t.recur) {
      var recurObj = t.recur;
      if (typeof recurObj === 'string') {
        try { recurObj = JSON.parse(recurObj); } catch (_e) { recurObj = null; }
      }
      if (recurObj && recurObj.days != null) {
        var recurType = recurObj.type;
        // Only weekly/biweekly carry a meaningful days pattern (DOW codes).
        // daily/monthly/interval have no DOW-code day-set → no constraint.
        if (recurType === 'weekly' || recurType === 'biweekly') {
          var recurDows = null;
          var rd = recurObj.days;
          if (typeof rd === 'string') {
            // String format: 'MTWRF' or 'M,W,F' — run through parseDayReq
            recurDows = parseDayReq(rd);
          } else if (rd && typeof rd === 'object' && !Array.isArray(rd)) {
            // Object-map format: { M: true, W: true, F: true }
            var rdSet = {};
            var rdCount = 0;
            var DOW_IDX = ConstraintSolver.DOW_CODE_TO_IDX;
            Object.keys(rd).forEach(function(k) {
              if (rd[k] && DOW_IDX[k] != null) {
                rdSet[DOW_IDX[k]] = true;
                rdCount++;
              }
            });
            recurDows = (rdCount === 0 || rdCount >= 7) ? null : rdSet;
          }
          // Null-aware intersection: intersect(null,X)=X, intersect(X,null)=X, intersect(X,Y)=X∩Y
          if (recurDows !== null) {
            if (allowedDows === null) {
              allowedDows = recurDows;
            } else {
              // True set intersection — may result in empty object (no valid day)
              var intersected = {};
              Object.keys(allowedDows).forEach(function(idx) {
                if (recurDows[idx]) intersected[idx] = true;
              });
              allowedDows = intersected; // empty object enforces "no valid day" → unplaced
            }
          }
        }
      }
    }

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
      if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_e) { return false; } }
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
    // Recurring split chunks (splitTotal > 1) are NOT day-locked — they can
    // span multiple days within their cycle window (999.098). The cycle cap
    // (anchor + cycleDays - 1) in findEarliestSlot / placeSplitInline prevents
    // them from overflowing into the next cycle (999.547). Non-split recurring
    // tasks remain day-locked as before.
    var isDayLocked = recurring && (pm === PLACEMENT_MODES.FIXED || !isFlexibleTpc) && !(splitTot > 1);

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
      // Generated instances without an explicit anchorMin are day-locked via
      // isGenerated — see findEarliestSlot for the clamping logic.
      isGenerated: !!t.generated && !recurring,
      isRigid: pm === PLACEMENT_MODES.FIXED,
      // Frozen invariant (R52): a STARTED instance (status 'wip') is immovable —
      // the user began it, so the scheduler must never re-place it. Pinned at its
      // existing slot when it has one (anchorDate+anchorMin are derived from
      // scheduled_at via rowToTask). ponytail: only started-WITH-a-placement is
      // protected here (the confirmed regression); an unanchored wip keeps current
      // behavior — no slot to pin to, out of scope.
      isStarted: st === 'wip',
      isRecurring: recurring,
      isMarker: isMarker,
      flexWhen: flexWhen,
      anchorDate: anchorDate,
      anchorMin: anchorMin,
      deadlineDate: deadlineDate,
      earliestStartDate: toKey(t.earliestStart),
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
  if (item.earliestStartDate) {
    var si = indexOfDate(dates, item.earliestStartDate);
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
  try { locAtStart = resolveLocationId(dateKey, start, cfg, null); } catch (_e) { /* ignore */ }
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

  // Fixed overlap warning: detect conflict with already-placed locked entries.
  var warnings = env && env.warnings;
  if (item.isRigid && warnings) {
    var existingFixed = (dayPlaced[item.anchorDate] || []).filter(function(p) {
      return p.locked && p.start < start + item.dur && p.start + p.dur > start;
    });
    if (existingFixed.length > 0) {
      // ConflictsView (Data Issues) renders the pair "w.taskA and w.taskB on w.dateKey".
      // Emit those fields (not just taskIds) so the row shows names + the day, not blanks (999.792).
      var overlapIds = [item.id].concat(existingFixed.map(function(p) { return p.task && p.task.id; }));
      warnings.push({ type: 'fixedOverlap', taskIds: overlapIds, taskA: item.id, taskB: overlapIds[1], dateKey: item.anchorDate });
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

// A-001: Compute the earliest absolute minute at which all live deps are
// satisfied, for the *current snapshot* of placedById/statuses/dates.
// Called once per findEarliestSlot / findLatestSlot scan (not per slot).
//
// Return semantics:
//   Infinity  → at least one live dep is unplaced; item can never be placed
//               this scan (finite candidateAbs is never >= Infinity).
//   -Infinity → no dep constrains timing (all are terminal/unknown/off-horizon);
//               every candidate passes unconditionally.
//   N (>=0)   → item may be placed at any candidateAbs >= N.
function computeDepReadyAbs(item, placedById, statuses, dates) {
  if (!item.dependsOn || item.dependsOn.length === 0) return -Infinity;
  var depReadyAbs = -Infinity;
  for (var j = 0; j < item.dependsOn.length; j++) {
    var depId = item.dependsOn[j];
    var st = statuses[depId];
    if (st === undefined) continue;
    if (st === 'done' || st === 'cancel' || st === 'skip' || st === 'disabled' || st === 'pause' || st === 'cancelled') continue;
    var placed = placedById[depId];
    if (!placed) return Infinity; // unplaced live dep — item is blocked this scan
    var depDateIdx = indexOfDate(dates, placed.dateKey);
    if (depDateIdx < 0) continue; // off-horizon — non-constraining
    var depAbsEnd = absoluteMin(depDateIdx, placed.start + placed.dur);
    if (depAbsEnd > depReadyAbs) depReadyAbs = depAbsEnd;
  }
  return depReadyAbs;
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
  // FAIL-CLOSED (999.546 / R38 CC6): a weather-constrained task must NOT be
  // placed when the weather data needed to satisfy its constraint is absent.
  // Previously this returned true (fail-open) — see goldenMaster.h6 C-WX delta.
  if (!weatherByDateHour || !weatherByDateHour[dateKey]) return false; // fail-closed: no data for this date
  var hour = Math.floor(startMin / 60);
  var w = weatherByDateHour[dateKey][hour];
  if (!w) return false; // fail-closed: no data for this hour

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
  if (item.earliestStartDate) {
    var si = indexOfDate(dates, item.earliestStartDate);
    if (si > 0) earliestIdx = si;
  }
  var latestIdx = dates.length - 1;
  if (item.deadlineDate && !(opts && opts.ignoreDeadline)) {
    var di = indexOfDate(dates, item.deadlineDate);
    if (di >= 0) latestIdx = di;
  }
  // Fixed non-recurring tasks are locked to their anchorDate — they must
  // not be pulled forward to today or pushed to another day.
  // Also applies to generated instances (recurring instances without explicit
  // placement modes) that have no anchorMin — they represent occurrences assigned
  // to a specific day by expandRecurring.
  if (item.isFixedWhen || (item.isGenerated && item.anchorMin == null)) {
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
  // A-001: compute dep-readiness once per scan (constant within a findEarliestSlot call —
  // placedById and statuses are captured above and only read in the candidate loop; all
  // writes happen in the caller after findEarliestSlot returns). computeDepReadyAbs()
  // returns a depReadyAbs floor; each slot-scan site does an O(1) comparison against it.
  var depReadyAbs = checkDeps ? computeDepReadyAbs(item, placedById, statuses, dates) : -Infinity;
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

  // FR1 / AC1.2 — placement-failure diagnostic accumulator. The caller passes an
  // optional `opts.diag` sink (an object); as the scan rejects candidate slots we
  // record WHY, then on a no-slot return the dominant reason is surfaced so the
  // scheduler can attribute a specific _unplacedReason/_unplacedDetail instead of
  // a bare null. We do NOT change the success return shape ({dateKey,start}) or the
  // null-on-failure contract — the diagnostic rides on the caller-provided sink.
  // Precedence (matches SPEC taxonomy): a real free slot blocked ONLY by
  // tool/location → location_mismatch / tool_conflict (the task can never run in
  // its eligible windows); otherwise, windows existed but capacity/timing left no
  // room → no_slot. location_mismatch beats tool_conflict (whyCannotRun's order).
  var diag = (opts && opts.diag) || null;
  var locToolDiag = null;   // {cause, detail} from the first loc/tool rejection seen
  var locToolIsLocation = false; // a location_mismatch was seen (outranks tool)
  var sawEligibleWindow = false; // at least one eligible window existed on some day
  var sawCapacityBlock = false;  // a slot was free-shaped but full (or dep/weather blocked)
  function recordLocTool(dateKey, startMin, blocksForDay) {
    if (!diag || !checkLoc) return;
    var locId = resolveLocationId(dateKey, startMin, cfg, blocksForDay);
    var why = whyCannotRun(item.task, locId, toolMatrix);
    if (why && why.ok === false) {
      if (why.cause === 'location_mismatch') {
        locToolIsLocation = true;
        locToolDiag = why; // location always wins; keep the latest location detail
      } else if (!locToolIsLocation && !locToolDiag) {
        locToolDiag = why; // first tool_conflict seen (only if no location seen)
      }
    }
  }

  // Infinite-slack tasks (no deadline, no recurring anchor) are allowed to
  // extend the search past the initial date list — up to MAX_SEARCH_DAYS.
  // `env` carries the maps extendDatesTo needs to build new day entries
  // lazily rather than pre-computing 365 days of windows on every run.
  var env = opts && opts.env;
  // A-002: per-run location-availability cache. resolveLocationId at a given (dateKey,
  // minute) is task-independent and pure within a run, so memoizing it on env (one object
  // per run, line ~1223) collapses the per-task recompute to one compute per day-slot.
  // env-absent paths pass null → canTaskRunAtMinCached falls back to the uncached call.
  var locCache = env ? (env._locCache || (env._locCache = Object.create(null))) : null;
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
      sawEligibleWindow = true;
      var occ = dayOcc[d.key] || {};
      var blocks = dayBlocks[d.key];
      for (var w = 0; w < wins.length; w++) {
        var winStart = wins[w][0];
        var winEnd = wins[w][1];
        // time_window tasks: prefer slots at/after preferredTimeMins, fall back to winStart.
        // This prevents DAY_START clamping from pulling tasks earlier than their preferred time.
        var prefStart = (item.isWindowMode && item.preferredTimeMins != null)
          ? Math.max(winStart, item.preferredTimeMins)
          : winStart;
        for (var s = prefStart; s + item.dur <= winEnd; s += 15) {
          if (!isFreeWithTravel(occ, s, item.dur, item.travelBefore, item.travelAfter)) { sawCapacityBlock = true; continue; }
          if (checkDeps && absoluteMin(i, s) < depReadyAbs) { sawCapacityBlock = true; continue; }
          if (checkLoc && !canTaskRunAtMinCached(item.task, d.key, s, cfg, toolMatrix, blocks, locCache)) { recordLocTool(d.key, s, blocks); continue; }
          if (checkWeather && !weatherOk(item.task, d.key, s, weatherByDateHour)) { sawCapacityBlock = true; continue; }
          return { dateKey: d.key, start: s };
        }
        // Fallback: try earlier slots between winStart and prefStart (e.g. window fully booked after preferred).
        for (var sf = winStart; sf < prefStart; sf += 15) {
          if (!isFreeWithTravel(occ, sf, item.dur, item.travelBefore, item.travelAfter)) { sawCapacityBlock = true; continue; }
          if (checkDeps && absoluteMin(i, sf) < depReadyAbs) { sawCapacityBlock = true; continue; }
          if (checkLoc && !canTaskRunAtMinCached(item.task, d.key, sf, cfg, toolMatrix, blocks, locCache)) { recordLocTool(d.key, sf, blocks); continue; }
          if (checkWeather && !weatherOk(item.task, d.key, sf, weatherByDateHour)) { sawCapacityBlock = true; continue; }
          return { dateKey: d.key, start: sf };
        }
      }
    }
    i++;
  }
  if (diag) populateFailDiag(diag, {
    checkLoc: checkLoc,
    locToolDiag: locToolDiag,
    sawEligibleWindow: sawEligibleWindow,
    sawCapacityBlock: sawCapacityBlock
  });
  return null;
}

// FR1 / AC1.2 — translate the accumulated scan signals into a {failReason, failDetail}
// on the caller's diag sink. Precedence:
//   1. A tool/location rejection was the only thing standing between the task and a
//      free slot in its eligible windows → that specific cause (location_mismatch /
//      tool_conflict). This is the "Submit Weekly UI Claim" symptom: personal_pc not
//      available where/when the day resolves.
//   2. Eligible windows existed but were full / dep- / weather-blocked → no_slot.
//   3. No eligible window ever (when-block fully unavailable, search window empty) →
//      no_slot with a window-class detail.
// The sink is only written when not already set, so the FIRST findSlot pass (the
// strictest) owns the reason; later relaxed retries don't overwrite it. R11.16: a
// reason is ALWAYS produced for a real placement failure.
function populateFailDiag(diag, sig) {
  if (diag.failReason) return; // first pass wins
  if (sig.checkLoc && sig.locToolDiag && !sig.sawCapacityBlock) {
    diag.failReason = sig.locToolDiag.cause;     // 'location_mismatch' | 'tool_conflict'
    diag.failDetail = sig.locToolDiag.detail;
    return;
  }
  if (sig.checkLoc && sig.locToolDiag && sig.sawCapacityBlock) {
    // Mixed: some slots full, some loc/tool-blocked. The loc/tool constraint is the
    // structural blocker (capacity may have been incidental), so surface it.
    diag.failReason = sig.locToolDiag.cause;
    diag.failDetail = sig.locToolDiag.detail;
    return;
  }
  if (sig.sawEligibleWindow) {
    diag.failReason = 'no_slot';
    diag.failDetail = 'No free slot in the eligible windows (capacity exhausted)';
    return;
  }
  diag.failReason = 'no_slot';
  diag.failDetail = 'No eligible time window available for this task';
}

// Mirror of findEarliestSlot that searches from the end of the day backwards,
// returning the latest free slot. Used for scheduler-managed recurring tasks
// whose original time has passed — keeps them visible at end-of-day so the
// user can still mark them done.
// TIME_WINDOW tasks never reach this path — preferLatestSlot is set only for ANYTIME
// recurring tasks (see schedulingMode logic above). The prefStart logic therefore
// lives only in findEarliestSlot; adding it here would be dead code today.
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
  // A-001: same per-scan dep-readiness cache as findEarliestSlot (see comment there).
  var depReadyAbs = checkDeps ? computeDepReadyAbs(item, placedById, statuses, dates) : -Infinity;
  var relaxWhen = !!(opts && opts.relaxWhen);
  var cfg = (opts && opts.cfg) || null;
  var toolMatrix = cfg && cfg.toolMatrix;
  var checkLoc = cfg && item.task && (
    (Array.isArray(item.task.location) && item.task.location.length > 0) ||
    (Array.isArray(item.task.tools) && item.task.tools.length > 0)
  );
  var weatherByDateHour = cfg && cfg.weatherByDateHour;
  var checkWeather = weatherByDateHour && item.task && hasWeatherConstraint(item.task);

  // A-002: same per-run location cache as findEarliestSlot (env reused across the run).
  var env = opts && opts.env;
  var locCache = env ? (env._locCache || (env._locCache = Object.create(null))) : null;

  // FR1 / AC1.2 — same diagnostic accumulation as findEarliestSlot (see comments there).
  var diag = (opts && opts.diag) || null;
  var locToolDiag = null;
  var locToolIsLocation = false;
  var sawEligibleWindow = false;
  var sawCapacityBlock = false;
  function recordLocTool(dateKey, startMin, blocksForDay) {
    if (!diag || !checkLoc) return;
    var locId = resolveLocationId(dateKey, startMin, cfg, blocksForDay);
    var why = whyCannotRun(item.task, locId, toolMatrix);
    if (why && why.ok === false) {
      if (why.cause === 'location_mismatch') {
        locToolIsLocation = true;
        locToolDiag = why;
      } else if (!locToolIsLocation && !locToolDiag) {
        locToolDiag = why;
      }
    }
  }

  for (var i = latestIdx; i >= earliestIdx; i--) {
    var d = dates[i];
    if (item.allowedDows && !item.allowedDows[d.isoDow]) continue;
    var wins = eligibleWindows(item, d.key, dayWindows, dayBlocks, relaxWhen);
    if (!wins.length) continue;
    sawEligibleWindow = true;
    var occ = dayOcc[d.key] || {};
    var blocks = dayBlocks[d.key];
    for (var w = wins.length - 1; w >= 0; w--) {
      var winStart = wins[w][0];
      var winEnd = wins[w][1];
      var startMax = Math.floor((winEnd - item.dur) / 15) * 15;
      for (var s = startMax; s >= winStart; s -= 15) {
        if (!isFreeWithTravel(occ, s, item.dur, item.travelBefore, item.travelAfter)) { sawCapacityBlock = true; continue; }
        if (checkDeps && absoluteMin(i, s) < depReadyAbs) { sawCapacityBlock = true; continue; }
        if (checkLoc && !canTaskRunAtMinCached(item.task, d.key, s, cfg, toolMatrix, blocks, locCache)) { recordLocTool(d.key, s, blocks); continue; }
        if (checkWeather && !weatherOk(item.task, d.key, s, weatherByDateHour)) { sawCapacityBlock = true; continue; }
        return { dateKey: d.key, start: s };
      }
    }
  }
  if (diag) populateFailDiag(diag, {
    checkLoc: checkLoc,
    locToolDiag: locToolDiag,
    sawEligibleWindow: sawEligibleWindow,
    sawCapacityBlock: sawCapacityBlock
  });
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
  // FR1 / AC1.2 — single diag sink shared across all fallback-ladder attempts.
  // findEarliestSlot/findLatestSlot write the FIRST (strictest) pass's reason and
  // leave it untouched on later relaxed retries (populateFailDiag is first-pass-wins),
  // so the surfaced reason reflects why the primary placement failed.
  var diag = {};
  var base = { placedById: placedById, statuses: statuses, cfg: cfg, env: env, relaxDeps: relaxDepsFlag, diag: diag };
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

  // AC1.2 — no slot found across all ladder attempts. Surface the accumulated
  // diagnostic (always set by populateFailDiag) so the reject path can attribute a
  // specific _unplacedReason/_unplacedDetail instead of a bare null.
  return { slot: null, failReason: diag.failReason || null, failDetail: diag.failDetail || null };
}

// FR2 — attribute an unplaced task's reason from a tryPlaceQueued failure result.
// Precedence:
//   1. A reason already set upstream (e.g. partial_split) is never clobbered.
//   2. Weather-constrained tasks keep the 'weather' heuristic (SPEC open-decision #1 DEFERRED —
//      the rename to 'weather_unavailable' is deferred; recorded in SPEC §AC2.6). Detail added.
//   3. Otherwise the FR1 diagnostic reason+detail from findEarliestSlot is applied
//      (tool_conflict / location_mismatch / no_slot). This is the AC2.1/AC2.3/AC2.4 fix:
//      the main no-slot path no longer leaves _unplacedReason undefined.
//   4. Defensive floor (should not trigger — populateFailDiag always sets a reason):
//      'no_slot' so R11.16 holds for ALL paths (AC2.7 — never undefined).
function applyPlacementFailReason(task, placement) {
  if (!task) return;
  if (task._unplacedReason) {
    if (!task._unplacedDetail && placement && placement.failDetail) {
      task._unplacedDetail = placement.failDetail;
    }
    return;
  }
  if (hasWeatherConstraint(task)) {
    task._unplacedReason = REASON_CODES.WEATHER;
    if (!task._unplacedDetail) {
      task._unplacedDetail = (placement && placement.failDetail) ||
        'Weather constraint not satisfied (missing or blocking forecast)';
    }
    return;
  }
  if (placement && placement.failReason) {
    task._unplacedReason = placement.failReason;
    task._unplacedDetail = placement.failDetail ||
      'Could not be placed in any eligible window';
    return;
  }
  task._unplacedReason = REASON_CODES.NO_SLOT;
  task._unplacedDetail = 'Could not be placed in any eligible window';
}

// compareItems — the S1 most-constrained→least ordering — MOVED to
// ConstraintSolver (H6 W1). Local binding preserves the `queue.sort(compareItems)`
// call site; the comparator is byte-identical (slack asc, pri asc, dur desc, id).
var compareItems = ConstraintSolver.compareItems;

// ── Inline split placement ────────────────────────────────────
// Greedy placement for tasks with t.split===true that don't have pre-split
// ordinals. Places chunks of at least splitMin minutes in free slots, consuming
// available capacity until the full duration is covered or no more slots exist.
//
// Returns: { placed: [{dateKey, start, dur}], remaining: number }
//
// For recurring split tasks: restricted to the cycle window (anchor + cycleDays - 1)
// so chunks don't overflow into the next occurrence. Split chunks are NOT day-locked
// (999.098) — they can span multiple days within the cycle cap (999.547).
// For non-recurring: searches across the eligible date range up to the deadline.
function placeSplitInline(item, remaining, splitMin, dates, dayWindows, dayBlocks, dayOcc, _cfg) {
  var placed = [];
  var STEP = 15; // placement granularity

  // Build search index range.
  var earliestIdx = 0;
  var latestIdx = dates.length - 1;

  if (item.earliestStartDate) {
    var sai = indexOfDate(dates, item.earliestStartDate);
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
  // are live (pending). This ensures computeDepReadyAbs correctly identifies
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
      unplaced: [], placedCount: 0, score: scoreSchedule({}, [], allTasks),
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
          // ConflictsView renders the dates "(w.taskDate)" and "(w.depDate)"; emit them so
          // the Data Issues row shows the conflicting dates, not blanks (999.792).
          warnings.push({ type: 'backwardsDep', taskId: item.id, depId: depId, taskDate: item.anchorDate, depDate: dep.anchorDate });
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
  // Unplaced accumulator — declared BEFORE this loop because the TPC-budget branch
  // below (item.task._tpcBudgetUnscheduled) pushes to it. Previously `var unplaced`
  // was declared after this loop, so hoisting left it undefined here and the push
  // threw a TypeError, crashing the scheduler on that path (999.801).
  var unplaced = [];
  items.forEach(function(item) {
    // Past-anchored recurring OR fixed/ingested: skip the queue entirely — never
    // re-place a past commitment forward into the future. Routed to the dedicated
    // pass (→ stillUnplaced), where runSchedule's overdue synthesis pins it at its
    // original date/time as overdue (computeIsPastDue treats fixed as a hard due).
    // R50.1 (999.796): a past FIXED/ingested event (e.g. a flight that already
    // departed) must stay at its date as overdue, not jump to the horizon end.
    //
    // EXCEPTION (R50.0 — forward-roll): a flexible-TPC recurring instance (timesPerCycle
    // < selectedDays → roamable) whose anchorDate is in the past but whose recurrence
    // PERIOD has NOT yet ended is NOT pinned — it is re-presented to the normal placement
    // queue as a fresh item so the scheduler can find the next valid slot within the cycle
    // (R32.7 guard: day-locked non-TPC instances are never forward-rolled).
    if (item.anchorDate && item.anchorDate < todayIsoKey &&
        (item.isRecurring || (item.isFixedWhen && item.anchorMin != null) ||
         (item.isStarted && item.anchorMin != null))) {
      // R52 frozen invariant: a past STARTED instance stays pinned at its
      // original date as overdue — never re-placed forward (same as a past
      // fixed/ingested commitment).
      //
      // Forward-roll gate: flexible-TPC recurring within its recurrence period.
      // isStarted and isFixedWhen are never forward-rolled (pinned by R52 / R50.1).
      if (item.isRecurring && item.isFlexibleTpc && !item.isStarted && !item.isFixedWhen) {
        var _cycleLen2 = recurringCycleDays(item.task && item.task.recur != null ? item.task.recur : null) || 1;
        var _anchorParsed = parseDate(item.anchorDate);
        if (_anchorParsed) {
          var _periodEndDate = new Date(_anchorParsed.getTime());
          _periodEndDate.setDate(_periodEndDate.getDate() + _cycleLen2);
          var _todayParsed = parseDate(todayIsoKey);
          if (_todayParsed && _todayParsed < _periodEndDate) {
            // Within period — forward-roll: clear the dead anchor so the instance
            // enters the placement queue as a fresh unanchored item. The queue will
            // find the best available slot on today or a future date within the cycle.
            // The old dead-day slot is abandoned (no longer shown on the dead day).
            item.anchorDate = null;
            item.anchorMin = null;
            // Cap the search window to the recurrence period end so the instance
            // doesn't bleed into the next cycle. deadlineDate drives latestIdx in
            // findEarliestSlot (line 973-975).
            var _periodEndKey = formatDateKey(_periodEndDate);
            if (!item.deadlineDate || item.deadlineDate > _periodEndKey) {
              item.deadlineDate = _periodEndKey;
            }
            // Fall through to the normal queue path below (do NOT push to pastAnchoredPreQueue).
          } else {
            // Period ended — pin as overdue at the dead slot.
            pastAnchoredPreQueue.push(item);
            return;
          }
        } else {
          // Cannot parse anchor — fall back to pin.
          pastAnchoredPreQueue.push(item);
          return;
        }
      } else {
        pastAnchoredPreQueue.push(item);
        return;
      }
    }
    // Missed preferred-time: recurring task whose preferred-time window has
    // entirely passed but is not in TIME_WINDOW mode (which has its own
    // dual-place path). Skip the queue entirely — mark missed below.
    if (item.isMissedPreferredTime) {
      missedPreferredTimeItems.push(item);
      return;
    }
    // Budget-unscheduled TPC instances: the cycle doesn't have enough time
    // to place all requested instances. These go to unplaced with a reason
    // but are NOT placed on the calendar. They still appear in the task list
    // so the user can see "3 of 5 scheduled" and understand why some are off.
    if (item.task && item.task._tpcBudgetUnscheduled) {
      item.task._unplacedReason = REASON_CODES.TPC_BUDGET;
      item.task._unplacedDetail = 'Not enough time in cycle for all instances';
      unplaced.push(item);
      return;
    }
    var isRigidWithAnchor = item.isRecurring && item.isRigid && item.anchorMin != null;
    // R52 frozen invariant: a started (wip) instance with a placement reserves
    // its existing slot via tryPlaceAtTime and is never recomputed/moved.
    var isStartedWithAnchor = item.isStarted && item.anchorDate && item.anchorMin != null;
    var isImmovable =
      (item.isMarker && item.anchorDate && item.anchorMin != null) ||
      item.isRigid ||
      isRigidWithAnchor ||
      isStartedWithAnchor;
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
  // (`unplaced` is declared above the immovables loop — it already collected any
  // TPC-budget-unscheduled items; do NOT re-initialize it here or those are lost.)
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
    if (item.earliestStartDate) {
      var si = indexOfDate(dates, item.earliestStartDate);
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
      // Non-recurring splits may span days up to the deadline.
      // Recurring splits also enter this path — placeSplitInline handles them
      // with a cycle-window cap (anchor + cycleDays - 1) so chunks stay within
      // the current occurrence's window and don't overflow (999.098, 999.547).
      if (item.task && item.task.split && (item.splitOrdinal === 1 || item.splitOrdinal == null)) {
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
            // Remaining unplaced chunks are treated as partial_split for
            // diagnostic visibility — the task was partially scheduled.
            item.task._unplacedReason = REASON_CODES.PARTIAL_SPLIT;
            // R11.16 / AC2.7 — partial placements also carry a human detail.
            item.task._unplacedDetail = 'Placed ' + splitResult.placed.length +
              ' chunk(s); ' + splitResult.remaining + ' min could not be placed';
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
      // FR2 — attribute the failure. Weather-constrained tasks keep the weather
      // heuristic (SPEC open-decision #1 DEFERRED: code emits 'weather'); everything else
      // takes the FR1 diagnostic reason+detail (tool_conflict / location_mismatch /
      // no_slot) so the main no-slot path no longer emits an undefined reason
      // (AC2.1, R11.16). The retry pass may refine this if deps later settle.
      applyPlacementFailReason(item.task, placement);
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

  // ── Recurring split time-boxing pass (999.547) ──────────────────────
  // After all placements, identify recurring split chunks whose placement
  // overflows into the next cycle. All chunks of a recurring split must
  // finish before the next occurrence of the same master starts; any
  // chunk placed past that boundary is removed from dayPlacements and
  // flagged as unplaced with _unplacedReason='recurring_split_overflow'.
  //
  // Also flags chunks that went to unplaced during the main loop (not
  // placed at all) with the same reason when they belong to a recurring
  // split group whose cycle boundary is known.
  (function timeBoxRecurringSplits() {
    // Collect placed recurring split chunks grouped by masterId.
    var splitChunksByMaster = {};
    Object.keys(dayPlacements).forEach(function(dk) {
      (dayPlacements[dk] || []).forEach(function(p) {
        if (!p.task || !p.task.recurring) return;
        var splitTotal = p.task.splitTotal != null ? Number(p.task.splitTotal) : 1;
        if (splitTotal <= 1) return; // not a split chunk
        var mid = p.task.sourceId || p.task.master_id || null;
        if (!mid) return;
        if (!splitChunksByMaster[mid]) splitChunksByMaster[mid] = [];
        splitChunksByMaster[mid].push({ dateKey: dk, start: p.start, dur: p.dur, task: p.task, entry: p });
      });
    });

    // For each master, determine the cycle boundary PER OCCURRENCE and identify
    // overflow chunks. Each occurrence's chunks must finish within cycleLen days
    // of THAT occurrence's own anchor date — not the master's globally-earliest
    // anchor. A chunk sitting on its own occurrence's anchor day (daily) or
    // within its own occurrence's cycle window (weekly etc.) must never be flagged.
    Object.keys(splitChunksByMaster).forEach(function(mid) {
      var chunks = splitChunksByMaster[mid];
      if (chunks.length === 0) return;

      // Determine the cycle length for this master from the first chunk's recur.
      var sampleChunk = chunks[0].task;
      var recur = sampleChunk.recur;
      if (typeof recur === 'string') { try { recur = JSON.parse(recur); } catch (_e) { return; } }
      var cycleLen = recurringCycleDays(recur);
      if (cycleLen <= 0) return; // unknown cycle — can't enforce time-boxing

      // Build a set of known occurrence anchor dates for this master from the
      // items array (buildItems sets anchorDate = toKey(t.date) per occurrence).
      // These are the valid occurrence-start dates within the horizon; used below
      // to resolve a chunk's occurrence anchor when the chunk's own date is not
      // a registered anchor (e.g. a late chunk placed beyond its anchor date).
      var knownOccurrenceAnchors = [];
      items.forEach(function(item) {
        if (!item.isRecurring) return;
        var splitTotal = item.splitTotal != null ? Number(item.splitTotal) : 1;
        if (splitTotal <= 1) return;
        if (item.masterId !== mid) return;
        var ad = item.anchorDate;
        if (ad && knownOccurrenceAnchors.indexOf(ad) === -1) knownOccurrenceAnchors.push(ad);
      });
      knownOccurrenceAnchors.sort(); // ascending so we can binary-search below

      // For each placed chunk, resolve its occurrence anchor and compute a
      // per-occurrence boundary. A chunk overflows only if its dateKey falls
      // on or after (its own occurrence's anchor + cycleLen).
      //
      // Occurrence anchor resolution for a chunk:
      //   1. Use the chunk's own task.date (or _candidateDate) if it matches a
      //      known occurrence anchor exactly — this is the normal case.
      //   2. Otherwise walk knownOccurrenceAnchors to find the latest anchor that
      //      is <= chunk.dateKey — the chunk was placed after its anchor day (only
      //      meaningful for multi-day cycles like weekly).
      //   3. Fall back to the chunk's own date as anchor if no known anchors exist
      //      (e.g. for fixtures that bypass buildItems). This is safe: a chunk on
      //      its own date always has dateKey == occurrenceAnchor < anchor+cycleLen
      //      for any cycleLen >= 1, so it will never be wrongly flagged.
      function resolveOccurrenceAnchor(c) {
        var chunkDate = c.task.date ? toKey(c.task.date) : (c.task._candidateDate || null);
        if (!chunkDate) return null;
        // If chunk date is a registered occurrence anchor, use it directly.
        if (knownOccurrenceAnchors.length === 0 || knownOccurrenceAnchors.indexOf(chunkDate) !== -1) {
          return chunkDate;
        }
        // Find the latest known anchor that is <= chunkDate (for cross-day placement
        // within a multi-day cycle, e.g. a weekly chunk placed the day after its anchor).
        var best = null;
        for (var i = 0; i < knownOccurrenceAnchors.length; i++) {
          if (knownOccurrenceAnchors[i] <= chunkDate) best = knownOccurrenceAnchors[i];
          else break;
        }
        return best || chunkDate; // last resort: treat chunk's own date as anchor
      }

      // Remove overflow chunks from dayPlacements and flag as unplaced.
      var overflowEntries = [];
      chunks.forEach(function(c) {
        var occurrenceAnchor = resolveOccurrenceAnchor(c);
        if (!occurrenceAnchor) return; // cannot determine anchor — skip, do not flag
        var anchorDate = parseDate(occurrenceAnchor);
        if (!anchorDate) return;
        var boundaryDate = new Date(anchorDate);
        boundaryDate.setDate(boundaryDate.getDate() + cycleLen);
        var boundaryKey = formatDateKey(boundaryDate);
        if (c.dateKey >= boundaryKey) {
          // This chunk overflows into the next occurrence's cycle.
          overflowEntries.push(c);
        }
      });

      if (overflowEntries.length > 0) {
        overflowEntries.forEach(function(c) {
          // Remove from dayPlacements
          var dk = c.dateKey;
          if (dayPlacements[dk]) {
            dayPlacements[dk] = dayPlacements[dk].filter(function(p) {
              return p !== c.entry;
            });
          }
          // Remove from dayPlaced
          if (dayPlaced[dk]) {
            dayPlaced[dk] = dayPlaced[dk].filter(function(p) {
              return p !== c.entry;
            });
          }
          // Release occupancy: clear the chunk's time range (including
          // travel buffers) from the occupancy grid so freed slots become
          // available for the retry pass. Only clear minutes that this
          // chunk exclusively held — other overlapping placements keep
          // their occupancy.
          var occ = dayOcc[dk];
          if (occ && c.dur > 0) {
            var tb = c.entry.travelBefore || 0;
            var ta = c.entry.travelAfter || 0;
            var s = Math.max(0, c.start - tb);
            var e = Math.min(c.start + c.dur + ta, 1440);
            var otherPlacements = (dayPlacements[dk] || []).filter(function(p) { return p !== c.entry; });
            for (var m = s; m < e; m++) {
              var isOccupiedByOther = false;
              for (var op = 0; op < otherPlacements.length; op++) {
                var opEntry = otherPlacements[op];
                var opTb = opEntry.travelBefore || 0;
                var opTa = opEntry.travelAfter || 0;
                if (m >= Math.max(0, opEntry.start - opTb) && m < Math.min(opEntry.start + opEntry.dur + opTa, 1440)) {
                  isOccupiedByOther = true;
                  break;
                }
              }
              if (!isOccupiedByOther) delete occ[m];
            }
            rebuildPrefix(occ, dayOccPrefix[dk]);
          }
          // Remove from placedById
          if (c.task && c.task.id && placedById[c.task.id]) {
            delete placedById[c.task.id];
          }
          // Flag as unplaced with reason
          c.task._unplacedReason = REASON_CODES.RECURRING_SPLIT_OVERFLOW;
          // R11.16 / AC2.7 — overflow chunks carry a human detail too.
          if (!c.task._unplacedDetail) c.task._unplacedDetail = 'Split chunk exceeds the recurring time-box for this cycle';
          unplaced.push({ task: c.task, id: c.task.id, _overflowFromTimeBox: true });
          warnings.push({ type: 'recurring_split_overflow', taskId: c.task.id, masterId: mid });
        });
      }
    });

    // Also flag unplaced recurring split chunks that never got placed at all,
    // if they belong to a known recurring master with a cycle boundary.
    // These chunks were correctly prevented from overflowing (the scheduler
    // kept them within bounds), but they should carry the specific reason
    // rather than a generic unplaced tag.
    unplaced.forEach(function(entry) {
      var task = entry && entry.task ? entry.task : entry;
      if (!task) return;
      if (!task.recurring) return;
      // Promote ONLY a generic no_slot tag (or no reason yet) to the specific
      // recurring_split_overflow — an unplaced recurring split chunk is a cycle
      // time-box overflow (R35.6, 999.802). A more-specific reason already set
      // (partial_split, weather, tool_conflict, location_mismatch, …) is correct
      // as-is and must NOT be clobbered by the overflow classification.
      if (task._unplacedReason && task._unplacedReason !== REASON_CODES.NO_SLOT) return;
      var splitTotal = task.splitTotal != null ? Number(task.splitTotal) : 1;
      if (splitTotal <= 1) return; // not a split chunk
      task._unplacedReason = REASON_CODES.RECURRING_SPLIT_OVERFLOW;
      if (!task._unplacedDetail) task._unplacedDetail = 'Split chunk could not be placed within the recurring time-box';
    });
  })();

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
      // FR2 / AC2.2 — same diagnostic-derived attribution as the main reject path.
      applyPlacementFailReason(item.task, placement);
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
    item.task._unplacedReason = REASON_CODES.MISSED;
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
    // Mark missed on the task object.
    task._unplacedReason = REASON_CODES.MISSED;
    task._unplacedDetail = 'Flex window has passed';
    // W2 placed-XOR-unplaced (DESIGN-RULING-overdue-vs-unplaceable, David 2026-06-22):
    // a missed-window task is OVERDUE — pinned on the grid ONLY when it has a when-block
    // anchor; otherwise unplaced-only. It is NEVER both (no dual-place). Display reads the
    // grid entry's _overdue / task.overdue (R50.6/W1), not the unplaced list.
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
    } else {
      // No when-block anchor → no calendar slot to pin → unplaced-only.
      stillUnplaced.push(item);
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

    // Mark task overdue if its forced slot is in the past: any PRIOR day is
    // overdue, and today is overdue once the forced start time has passed.
    // R50.2 (999.796): a force-placed fixed/recurring item anchored to a past day
    // must carry the overdue flag (previously only same-day-passed was flagged).
    var forceIsOverdue = forceDate < todayIsoKey ||
      (forceDate === todayIsoKey && nowMins != null && forceStart < nowMins);
    if (forceIsOverdue) task._overdue = true;

    // R50 (999.796): a past-anchored item force-placed onto its OWN past day is
    // OVERDUE, not an overlap conflict — it didn't collide with anything, its day
    // simply passed. Only a present/future forced placement is a real overlap
    // conflict; suppress the _conflict flag + recurringConflict warning for the
    // overdue case (otherwise a late fixed event shows a bogus "Recurring conflict"
    // in the Issues tab).
    var isOverlapConflict = !forceIsOverdue;
    if (!dayPlacements[forceDate]) dayPlacements[forceDate] = [];
    var forceEntry = {
      task: task,
      start: forceStart,
      dur: forceDur,
      locked: true,
      travelBefore: 0,
      travelAfter: 0,
      _placementReason: forceIsOverdue
        ? 'Fixed/recurring event (overdue — its date has passed)'
        : ('Rigid recurring: ' + (fBlockName || task.when || 'block') + ' (overlap)'),
    };
    if (isOverlapConflict) forceEntry._conflict = true;
    if (forceIsOverdue) forceEntry._overdue = true;
    dayPlacements[forceDate].push(forceEntry);
    // Emit a recurringConflict warning only for a real overlap (not the overdue case).
    if (isOverlapConflict) warnings.push({ type: 'recurringConflict', taskId: task.id });
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
    // eslint-disable-next-line no-redeclare
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
    placedCount: placedCount,
    score: scoreSchedule(dayPlacements, unplacedTasks, allTasks),
    warnings: warnings,
    timezone: cfg.timezone || null,
    spacingStats: {},
    slackByTaskId: slackByTaskId
  }, phaseSnapshots ? { phaseSnapshots: phaseSnapshots } : {});
}

module.exports = unifiedScheduleV2;

// Test-only exports — allow direct unit testing of dep-gating helpers.
// These are pure functions with no side effects; exposing them here lets
// depsGatingCharacterization.test.js verify the off-horizon guard (B6)
// through computeDepReadyAbs directly, which is the ONLY reachable path
// for depDateIdx<0 (past-dateKey deps never appear in placedById via the
// full scheduler because dayPlacements is only built for dates[] = today+).
module.exports._testOnly = {
  computeDepReadyAbs: computeDepReadyAbs,
  indexOfDate: indexOfDate,
  absoluteMin: absoluteMin,
  weatherOk: weatherOk,
  hasWeatherConstraint: hasWeatherConstraint,
};

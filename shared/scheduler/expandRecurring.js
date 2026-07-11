/**
 * Recurring task expansion — shared between frontend, backend, and validator.
 * Generates per-day instances from recurring task templates.
 */

var dateHelpers = require('./dateHelpers');
var parseDate = dateHelpers.parseDate;
var formatDateKey = dateHelpers.formatDateKey;
var DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

var DOW_TO_CODE = ['U', 'M', 'T', 'W', 'R', 'F', 'S'];

// Parse an anchor date from either a Date object, an ISO YYYY-MM-DD string,
// or an M/D string. Returns a Date at local-midnight, or null.
// parseDate (from dateHelpers) only understands M/D, so ISO recur_start values
// silently became Invalid Date before this helper existed.
function parseAnchor(val) {
  if (!val) return null;
  if (val instanceof Date) {
    var d = new Date(val.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  }
  var s = String(val);
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return parseDate(s);
}

// Resolve the recurrence anchor for a source. `next_start` is the single
// unified anchor for ALL recurring types (rolling and pattern). recurStart
// is the static fallback for masters that haven't had a terminal event yet;
// src.date (scheduled_at-derived) and startDate are safety nets so expansion
// still produces output for null anchors.
function getAnchor(src, startDate) {
  if (src.nextStart) {
    var ns = parseAnchor(src.nextStart);
    if (ns) return ns;
  }
  return parseAnchor(src.recurStart) || parseAnchor(src.date) || (function() {
    var d = new Date(startDate); d.setHours(0, 0, 0, 0); return d;
  })();
}

// Stable, non-advancing cycle epoch for TPC (timesPerCycle) fulfillment-accounting
// purposes ONLY (999.1372, jug-weekly-recur-reshow). Unlike getAnchor(), this NEVER
// resolves to src.nextStart — that field advances on every terminal (done/skip)
// event (999.1091 computeNextOccurrenceAnchor / rolling-anchor.js
// computeRollingAnchor, both now writing the single unified next_start column —
// see juggler-anchor-column-cleanup), which would otherwise redefine the TPC
// cycle boundary itself mid-cycle (cycleStart = anchor + k*cycleDays) and
// re-orphan an earlier-in-cycle day's fulfillment the moment a scheduler run
// lands on/after the terminal event (root-cause mechanism 2, INTAKE-BRIEF.json).
// Falls back identically to getAnchor()'s non-anchor chain (recur_start, then
// src.date, then startDate) so behavior for masters with no live anchor advance
// — i.e. every pre-existing test/caller — is byte-identical. Only consumed
// inside expandRecurring's TPC block; getAnchor()/its mutable next_start-aware
// result is untouched everywhere else (candidate-window filtering, day-match
// predicate, target-interval pick positioning, rolling).
function getStableEpoch(src, startDate) {
  return parseAnchor(src.recurStart) || parseAnchor(src.date) || (function() {
    var d = new Date(startDate); d.setHours(0, 0, 0, 0); return d;
  })();
}

function doesDayMatch(dow, daysSpec, dayMap) {
  if (typeof daysSpec === 'object' && !Array.isArray(daysSpec)) {
    return daysSpec[DOW_TO_CODE[dow]] ? { match: true, state: daysSpec[DOW_TO_CODE[dow]] } : { match: false };
  }
  for (var i = 0; i < daysSpec.length; i++) {
    if (dayMap[daysSpec[i]] === dow) return { match: true, state: 'required' };
  }
  return { match: false };
}

// Pure predicate: does `r` (a non-rolling recur config) fire on `cursor` (a Date at
// local midnight), given `anchor` (the phase/parity reference Date — biweekly parity
// and interval counting are computed relative to it)? EXTRACTED verbatim (999.1091 C1)
// from the main expansion loop below so the loop and computeNextOccurrenceAnchor's
// forward-search (juggler-backend/src/lib/next-occurrence-anchor.js, via
// nextMatchingDate) share ONE implementation of "what counts as a match" — they can
// never drift apart. Behavior is byte-identical to the inline block this replaced.
//
// `parityAnchor` (999.1372 candidate-B, zoe-jwrr-biweekly-pick-generation-parity-split):
// OPTIONAL override for the biweekly PARITY computation only (the `anchor` param still
// governs day-of-week matching and interval counting, unchanged). Defaults to `anchor`
// when omitted, so every pre-existing caller (nextMatchingDate's forward search, and any
// generation-gate call for a non-TPC-filtered source) is byte-identical. expandRecurring's
// generation gate passes the SAME `stableEpoch` here that the TPC candidate-pool step
// (below) uses for its own biweekly parity filter, for TPC-filtered biweekly sources ONLY
// — so pool and gate compute parity from the literal same Date value and can never
// structurally disagree, regardless of how far the mutable `anchor` (next_start-aware)
// has advanced. This eliminates the whole deadlock CLASS (not just the probed fixture):
// there is only one epoch value feeding the modulo-14 parity test on either side of the
// pool/gate seam, so no drift between two epochs is possible to reintroduce it.
function matchesRecurrenceDay(cursor, r, anchor, dayMap, parityAnchor) {
  if (!r) return false;
  if (r.type === 'daily') return true;
  if (r.type === 'weekly' || r.type === 'biweekly') {
    var days = r.days || 'MTWRF';
    var dow = cursor.getDay();
    var dayResult = doesDayMatch(dow, days, dayMap);
    if (!dayResult.match) return false;
    if (r.type === 'biweekly') {
      var parityRef = parityAnchor || anchor;
      var daysDiff = Math.round((cursor.getTime() - parityRef.getTime()) / 86400000);
      if (Math.floor(daysDiff / 7) % 2 !== 0) return false;
    }
    return true;
  }
  if (r.type === 'monthly') {
    var md = r.monthDays || [1, 15];
    var dom = cursor.getDate();
    var lastDom = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    for (var mi = 0; mi < md.length; mi++) {
      var v = md[mi];
      if (v === 'first' && dom === 1) return true;
      if (v === 'last' && dom === lastDom) return true;
      if (Number(v) === dom) return true;
    }
    return false;
  }
  if (r.type === 'interval') {
    var every = r.every || 2;
    var unit = r.unit || 'days';
    if (unit === 'days') {
      var between = Math.round((cursor.getTime() - anchor.getTime()) / 86400000);
      return between >= 0 && between % every === 0;
    }
    if (unit === 'weeks') {
      var betweenD = Math.round((cursor.getTime() - anchor.getTime()) / 86400000);
      return betweenD >= 0 && betweenD % (every * 7) === 0;
    }
    if (unit === 'months') {
      if (cursor.getDate() !== anchor.getDate()) return false;
      var monthDiff = (cursor.getFullYear() - anchor.getFullYear()) * 12 + (cursor.getMonth() - anchor.getMonth());
      return monthDiff >= 0 && monthDiff % every === 0;
    }
    if (unit === 'years') {
      if (cursor.getMonth() !== anchor.getMonth() || cursor.getDate() !== anchor.getDate()) return false;
      var yearDiff = cursor.getFullYear() - anchor.getFullYear();
      return yearDiff >= 0 && yearDiff % every === 0;
    }
  }
  return false;
}

// Enumerate the ACTUAL booked/pending instance dates for `sourceId` that fall
// within [cycleStart, cycleEnd) — regardless of any window/startDate
// restriction AND regardless of whether the date matches `r`'s recurrence
// pattern (999.1372 continued — BLOCK zoe-jwrr-roamed-done-invisible). Used
// ONLY for TPC fulfillment-accounting (bookedKeys/existingInCycle/
// fulfilledInCycle/_fulfilledInCycle/_pendingBudget/hasSkipInCycle).
//
// This SUPERSEDES an earlier pattern-day-walk approach (walking every calendar
// day via matchesRecurrenceDay and checking which ones happened to be booked):
// that made an off-pattern booking — a done/pending instance manually moved to
// a day outside the master's configured days/monthDays — invisible to
// fulfillment accounting, since it would never be produced by the pattern walk.
// `datesBySourceAll` (built once in expandRecurring, from existingBySourceDate +
// pendingBookedByDate) already has the full set of ACTUAL dates this source has
// an instance/pending booking on; this just filters that set into the cycle
// range being asked about. The NEW-pick pool (`available`, in expandRecurring's
// TPC block) stays window-bound/pattern-restricted and is NOT built from this
// function.
function enumerateBookedDatesInCycle(sourceId, cycleStart, cycleEnd, datesBySourceAll) {
  var keys = (datesBySourceAll && datesBySourceAll[sourceId]) || [];
  var seen = {};
  var out = [];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (seen[k]) continue;
    seen[k] = true;
    var d = parseAnchor(k);
    if (!d) continue;
    if (d >= cycleStart && d < cycleEnd) out.push({ date: d, key: k });
  }
  return out;
}

// Pure forward search (999.1091 C1): the first date AFTER `afterDateKey` (a
// 'YYYY-MM-DD' string) that matches `recur`'s own pattern, using `phaseAnchorKey`
// ('YYYY-MM-DD', falls back to afterDateKey) as the phase/parity reference. This is
// "the next occurrence in the master's OWN configured recurrence pattern" — reused by
// juggler-backend/src/lib/next-occurrence-anchor.js to advance the generalized anchor
// on a terminal (done/skip) event, per David's ruling (999.1091): daily -> next day;
// weekly single-day -> same weekday next week; weekly multi-day (e.g. Mon/Wed/Fri) ->
// the next day in that list, wrapping to next week's first configured day; monthly
// (e.g. {11,22}) -> next day in the list, wrapping to next month; yearly -> same
// calendar date one year forward. Pure date math — no I/O, no status/terminal logic
// (the caller owns that). Bounded iteration; returns null if no match is found within
// the bound (should not happen for a valid recur config) or the type is unsupported
// (rolling is NOT handled here — rolling-anchor.js owns that anchor, unchanged).
function nextMatchingDate(recur, afterDateKey, phaseAnchorKey) {
  var r = recur;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_e) { return null; } }
  if (!r || r.type === 'rolling') return null;

  var after = parseAnchor(afterDateKey);
  var phaseAnchor = parseAnchor(phaseAnchorKey) || after;
  if (!after || !phaseAnchor) return null;

  var dayMap = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };
  var cursor = new Date(after.getTime());
  cursor.setDate(cursor.getDate() + 1);

  // Bound the walk generously — interval years/months need the widest berth.
  // (ernie WARN, 999.1091: a leap-day anchor (Feb 29, unit='years') only recurs
  // every ~4 calendar years regardless of `every`, since the match requires BOTH
  // month+date AND yearDiff % every === 0 — `every*366+40` under-bounds it for
  // every < 4. Similarly a day-of-month absent from several consecutive
  // applicable months (e.g. every=3 on the 31st: Jan/Apr/Jul/Oct — only Jan+Jul
  // have a 31st) can skip multiple `every`-month cycles before matching — bound
  // generously for several cycles, not just one.)
  var every = r.every != null ? Math.max(1, parseInt(r.every, 10) || 1) : 1;
  var maxDays = 400;
  if (r.type === 'interval' && r.unit === 'years') maxDays = Math.max(every, 4) * 366 + 40;
  else if (r.type === 'interval' && r.unit === 'months') maxDays = Math.max(every, 1) * 31 * 4 + 60;
  else if (r.type === 'interval' && r.unit === 'weeks') maxDays = every * 7 + 40;
  else if (r.type === 'interval' && r.unit === 'days') maxDays = Math.max(400, every + 40);

  for (var i = 0; i < maxDays; i++) {
    if (matchesRecurrenceDay(cursor, r, phaseAnchor, dayMap)) {
      return formatDateKey(cursor);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}

function expandRecurring(allTasks, startDate, endDate, opts) {
  var dayMap = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };
  var existingIds = {};
  allTasks.forEach(function(t) { existingIds[t.id] = true; });
  var existingByDateText = {};
  var existingBySourceDate = {};
  // Status per (sourceId, date) — lets the 'backfill' fill policy distinguish
  // skipped instances (replaceable) from done/cancel/pending (fulfilled).
  var instanceStatusBySourceDate = {};
  // R5 rolling single-active: which masters already have a NON-TERMINAL (active)
  // instance. A rolling master with an active instance must not project the next
  // one — that happens only when the active completes (anchor advances).
  var ROLLING_TERMINAL = { done: 1, cancelled: 1, cancel: 1, skip: 1, skipped: 1, missed: 1, replaced: 1 };
  var existingActiveBySource = {};
  allTasks.forEach(function(t) {
    // Skip recurring templates — they're sources, not placed tasks.
    // Their date is the anchor, not an instance that should block generation.
    if (t.taskType === 'recurring_template') return;
    if (t.date && t.text) existingByDateText[t.date + '|' + t.text] = true;
    if (t.sourceId && t.date) {
      existingBySourceDate[t.sourceId + '|' + t.date] = true;
      instanceStatusBySourceDate[t.sourceId + '|' + t.date] = t.status || '';
    }
    if (t.taskType === 'recurring_instance' && t.sourceId && !ROLLING_TERMINAL[t.status || '']) {
      existingActiveBySource[t.sourceId] = true;
    }
  });

  // Ordinal counter per source — IDs are date-agnostic: <sourceId>-<ordinal>
  var maxOrdBySource = (opts && opts.maxOrdBySource) || {};
  var nextOrdBySource = {};
  Object.keys(maxOrdBySource).forEach(function(k) { nextOrdBySource[k] = maxOrdBySource[k]; });

  var statuses = opts && opts.statuses ? opts.statuses : {};
  var sources = allTasks.filter(function(t) {
    if (!t.recur || t.recur.type === 'none') return false;
    if (t.taskType === 'recurring_instance') return false;
    var st = statuses[t.id] || t.status || '';
    if (st === 'pause' || st === 'disabled' || st === 'cancelled') return false;
    return true;
  });
  if (sources.length === 0) return [];

  var newTasks = [];
  var cursor = new Date(startDate); cursor.setHours(0, 0, 0, 0);
  var end = new Date(endDate); end.setHours(23, 59, 59, 999);
  var maxIter = opts && opts.maxIter ? opts.maxIter : 0; // 0 = unlimited

  // For timesPerCycle sources: pre-compute which dates to generate using
  // target-interval steering (collect candidates, then pick best N per cycle).
  // Key: sourceId → { 'M/D': true }
  var tpcPickedDates = {};
  // Multi-step spacing (999.874): for each picked date, store the assigned
  // _targetDate (ideal placement day) and _deadlineDate (last acceptable day).
  // Key: sourceId → { 'M/D': { target: 'YYYY-MM-DD', deadline: 'YYYY-MM-DD' } }
  var tpcTargetDates = {};
  // 999.1372 candidate-B (zoe-jwrr-biweekly-pick-generation-parity-split): the
  // stableEpoch used below to build the TPC candidate pool's biweekly parity filter,
  // persisted per source so the main generation loop's gate (matchesRecurrenceDay)
  // can be handed the SAME value for its own biweekly parity check — see the
  // matchesRecurrenceDay comment above. Only populated for sources that actually go
  // through TPC filtering (the guarded block below); absent/undefined for every other
  // source, which keeps the generation gate on the mutable `anchor` exactly as before.
  var tpcStableEpochBySource = {};

  // Caller (runSchedule) passes a map of pending recurring_instance dates so
  // the tpc slot accounting can count them as booked. Without this, pending
  // instances were filtered out of `allTasks` (so expandRecurring could emit
  // fresh targets for them via reconciliation). That made tpc oblivious to
  // them and it would pick fresh replacement dates when the user had skipped
  // some of the cycle's picks — leading to the "skip → new pick today →
  // skip → repeat" loop.
  var pendingBookedByDate = (opts && opts.pendingBookedByDate) || {};

  // All ACTUAL instance/pending date keys per source, regardless of whether the
  // date matches the master's recurrence pattern (999.1372 continued — BLOCK
  // zoe-jwrr-roamed-done-invisible). A 'done'/pending instance can sit on a date
  // OFF the recurrence pattern (e.g. the user drags/completes it on a day the
  // master's `days`/`monthDays` config doesn't include — juggler permits this),
  // and it must still count toward its cycle's fulfillment. Built ONCE from
  // existingBySourceDate (real rows above) + pendingBookedByDate (opts-provided
  // pending dates that may have been filtered out of allTasks — see comment
  // above) so enumerateBookedDatesInCycle (below) never needs to walk the
  // pattern to find these dates — it just filters the ACTUAL booked dates for
  // this source into the cycle's [cycleStart, cycleEnd) range.
  var datesBySourceAll = {};
  function _indexSourceDateKey(compositeKey) {
    var idx = compositeKey.indexOf('|');
    if (idx < 0) return;
    var sid = compositeKey.slice(0, idx);
    var dk = compositeKey.slice(idx + 1);
    if (!datesBySourceAll[sid]) datesBySourceAll[sid] = [];
    datesBySourceAll[sid].push(dk);
  }
  Object.keys(existingBySourceDate).forEach(_indexSourceDateKey);
  Object.keys(pendingBookedByDate).forEach(_indexSourceDateKey);

  // Budget-aware TPC (999.013): dayMinutes maps date strings to available
  // minutes on that day. When provided, the TPC picker caps slotsNeeded per
  // cycle so that total instance duration doesn't exceed available time.
  // Instances that exceed the budget are still emitted but marked
  // _tpcBudgetUnscheduled=true so the caller can decide how to handle them
  // (e.g. create DB rows but skip placement).
  var dayMinutes = (opts && opts.dayMinutes) || null;

  // Helper: compute the number of candidate slots per cycle for a recurrence config
  function getSelectedDayCount(r) {
    if (r.type === 'weekly' || r.type === 'biweekly') {
      var days = r.days || 'MTWRF';
      return typeof days === 'object' && !Array.isArray(days)
        ? Object.keys(days).length
        : (typeof days === 'string' ? days.length : 0);
    }
    if (r.type === 'daily') return 7;
    if (r.type === 'monthly') {
      var md = r.monthDays || [1, 15];
      return md.length;
    }
    return 0;
  }

  sources.forEach(function(src) {
    var r = src.recur;
    var tpc = r.timesPerCycle || 0;
    if (tpc <= 0) return;
    if (r.type !== 'weekly' && r.type !== 'biweekly' && r.type !== 'daily' && r.type !== 'monthly') return;
    var selectedDayCount = getSelectedDayCount(r);
    if (tpc >= selectedDayCount) return; // no filtering needed

    var cycleDays;
    if (r.type === 'biweekly') cycleDays = 14;
    else if (r.type === 'monthly') cycleDays = 30;
    else cycleDays = 7; // daily and weekly
    var targetInterval = cycleDays / tpc;
    var anchor = getAnchor(src, startDate);
    // Stable cycle-boundary epoch (999.1372) — decoupled from next_start's
    // terminal-event advancement. Used ONLY for cycleStart/cycleEnd + the widened
    // fulfillment-count enumeration below; `anchor` (mutable) still governs the
    // candidate-window filter just below and target-interval pick positioning.
    var stableEpoch = getStableEpoch(src, startDate);
    // 999.1372 candidate-B: persist so the generation-gate call below (same src.id)
    // can share this exact epoch for biweekly parity — see matchesRecurrenceDay comment.
    tpcStableEpochBySource[src.id] = stableEpoch;

    // 1. Collect all candidate dates in the expansion window
    var candidates = [];
    var c = new Date(startDate); c.setHours(0, 0, 0, 0);
    var e2 = new Date(endDate); e2.setHours(23, 59, 59, 999);
    while (c <= e2) {
      if (c >= anchor) {
        var cStr = formatDateKey(c);
        {
          var cDow = c.getDay();
          var isCandidate = false;
          if (r.type === 'daily') {
            isCandidate = true;
          } else if (r.type === 'weekly' || r.type === 'biweekly') {
            var days = r.days || 'MTWRF';
            if (doesDayMatch(cDow, days, dayMap).match) {
              if (r.type === 'biweekly') {
                // Parity basis single-sourced onto stableEpoch (999.1372
                // continued — WARN cookie-jwrr-biweekly-parity-coupling /
                // ernie-jwrr-biweekly-parity-basis): previously this compared
                // against the mutable `anchor` (next_start-aware)
                // while the fulfillment side's cycle boundaries/parity used
                // `stableEpoch` — two epochs computing the same "which week is
                // the biweekly on-week" concept, safe only via an unenforced
                // cross-module invariant in next-occurrence-anchor.js. Using
                // stableEpoch here too means the pick pool, cycle boundaries,
                // and fulfillment accounting all agree on ONE epoch. The
                // window lower bound (`c >= anchor`, above) and the
                // target-interval pick-positioning (`ref`/`idealDate` in the
                // greedy-pick loop below) are UNCHANGED — only this
                // parity/cycle-membership test moved to stableEpoch.
                var dd = Math.round((c.getTime() - stableEpoch.getTime()) / 86400000);
                isCandidate = Math.floor(dd / 7) % 2 === 0;
              } else {
                isCandidate = true;
              }
            }
          } else if (r.type === 'monthly') {
            var md = r.monthDays || [1, 15];
            var dom = c.getDate();
            var lastDom = new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate();
            for (var mi = 0; mi < md.length; mi++) {
              var v = md[mi];
              if ((v === 'first' && dom === 1) || (v === 'last' && dom === lastDom) || Number(v) === dom) {
                isCandidate = true; break;
              }
            }
          }
          if (isCandidate) {
            candidates.push({ date: new Date(c), key: cStr });
          }
        }
      }
      c.setDate(c.getDate() + 1);
    }

    // 2. Pick best tpc dates per cycle using target-interval steering.
    // Cycle boundaries are anchored to `stableEpoch + k*cycleDays` (999.1372 —
    // previously `anchor + k*cycleDays`, which shifted mid-cycle whenever a
    // terminal event advanced next_start; stableEpoch never shifts) so
    // they are deterministic and independent of window position AND of
    // terminal-event anchor advancement. lastPlaced evolves from picks within
    // this call only — it is not pre-seeded from DB rows.
    var picked = {};
    var lastPlaced = null;

    if (candidates.length > 0) {
      var firstCandMs = candidates[0].date.getTime();
      var stableEpochMs = stableEpoch.getTime();
      var daysFromEpoch = Math.floor((firstCandMs - stableEpochMs) / 86400000);
      var kStart = Math.floor(daysFromEpoch / cycleDays);
      var cycleStart = new Date(stableEpoch);
      cycleStart.setDate(cycleStart.getDate() + kStart * cycleDays);

      var ci = 0;
      while (ci < candidates.length) {
        var cycleEnd = new Date(cycleStart);
        cycleEnd.setDate(cycleEnd.getDate() + cycleDays);
        var cycleCandidates = [];
        while (ci < candidates.length && candidates[ci].date < cycleEnd) {
          cycleCandidates.push(candidates[ci]);
          ci++;
        }

        // Widened fulfillment-count enumeration (999.1372 continued — BLOCK
        // zoe-jwrr-roamed-done-invisible): ALL ACTUAL booked/pending dates for
        // this source in this STABLE [cycleStart, cycleEnd) range, not just the
        // window-bound `cycleCandidates` (which never contains a date earlier
        // than `startDate`/'today') and NOT restricted to pattern-matching days
        // (a done/pending instance manually moved to an off-pattern day must
        // still fulfill its cycle). An earlier-in-cycle done/skip instance must
        // still be consulted here even when the scheduler run lands on/after it,
        // and even when the fulfilling day is off the master's configured
        // days/monthDays — instanceStatusBySourceDate/existingBySourceDate
        // already cover the FULL unwindowed task list, so the data exists;
        // enumerateBookedDatesInCycle just supplies the ACTUAL dates to look it
        // up by (via datesBySourceAll, built once above). The NEW-pick POOL
        // (`available`, below) stays window-bound/pattern-restricted — built
        // from `cycleCandidates`, unchanged.
        var widenedCycleCandidates = enumerateBookedDatesInCycle(src.id, cycleStart, cycleEnd, datesBySourceAll);

        // Cycle bookings: terminal-blocked (done/skip/cancel) + pending.
        // Both count against the tpc budget. Dedup via a Set since a date
        // could theoretically be in both maps.
        var bookedKeys = {};
        var pendingKeys = {};
        widenedCycleCandidates.forEach(function(cd) {
          var key = src.id + '|' + cd.key;
          if (existingBySourceDate[key]) bookedKeys[cd.key] = true;
          if (pendingBookedByDate[key]) { bookedKeys[cd.key] = true; pendingKeys[cd.key] = true; }
        });
        var existingInCycle = Object.keys(bookedKeys).length;

        // Pre-fill `picked` with existing pending dates so the reconcile diff
        // keeps them (doesn't DELETE a date the user still wants) — but CAP to the
        // cycle budget. Terminal occurrences (done/skip/cancel) are history and are
        // counted but never pruned; pending are kept only up to `tpc − terminal`.
        // Surplus pending beyond the budget are NOT re-picked → the reconcile diff
        // prunes them, so a flexible-TPC cycle never over-materializes past
        // timesPerCycle and surfaces phantom "unplaced" days (the roamable task is
        // placed wherever it fits; only the real budget's worth is materialized).
        // Earliest pending kept first (chronological Object.keys order). Only
        // FULFILLED terminal (done/cancel) consume the budget — a `skip` is a
        // declined slot, not a session, so it must NOT shrink the pending budget
        // (else a skipped Fri would wrongly prune a legit Mon-Thu pending).
        var _fulfilledInCycle = Object.keys(bookedKeys).filter(function(k) {
          if (pendingKeys[k]) return false; // pending, not terminal
          return (instanceStatusBySourceDate[src.id + '|' + k] || '') !== 'skip';
        }).length;
        var _pendingBudget = Math.max(0, tpc - _fulfilledInCycle);
        Object.keys(pendingKeys).slice(0, _pendingBudget).forEach(function(k) { picked[k] = true; });

        // Fill policy (#26). Per-task setting on the recurrence:
        //   'keep'     (default) — any skip in the cycle freezes new picks;
        //               remaining budget slots are filled up to tpc when no
        //               skip exists. Prevents "skip → refill → skip → loop"
        //               while still scheduling the remaining target sessions.
        //               needed = skip? 0 : max(0, tpc − all_booked)
        //   'backfill' — aim to hit the tpc target. Count only fulfilled
        //               instances (done/cancel/pending/wip) toward the budget;
        //               skip is treated as replaceable.
        //               needed = tpc − fulfilled (non-skip booked).
        var fillPolicy = (r && r.fillPolicy === 'backfill') ? 'backfill' : 'keep';
        var slotsNeeded;
        if (fillPolicy === 'backfill') {
          var fulfilledInCycle = 0;
          // 999.1372: iterate the WIDENED set (not window-bound cycleCandidates)
          // so an earlier-in-cycle done instance still counts toward the target
          // even when it falls before startDate/'today'.
          widenedCycleCandidates.forEach(function(cd) {
            if (!bookedKeys[cd.key]) return;
            var status = instanceStatusBySourceDate[src.id + '|' + cd.key] || '';
            // Anything other than 'skip' counts toward the target: done/cancel
            // are settled and pending/wip are already scheduled.
            if (status !== 'skip') fulfilledInCycle++;
          });
          slotsNeeded = Math.max(0, tpc - fulfilledInCycle);
        } else {
          // 999.1372: widened set, same reasoning as fulfilledInCycle above.
          var hasSkipInCycle = widenedCycleCandidates.some(function(cd) {
            return bookedKeys[cd.key] &&
                   (instanceStatusBySourceDate[src.id + '|' + cd.key] || '') === 'skip';
          });
          slotsNeeded = hasSkipInCycle ? 0 : Math.max(0, tpc - existingInCycle);
        }

        // Budget-aware TPC (999.013): cap slotsNeeded so that total instance
        // duration doesn't exceed available time across candidate days in this
        // cycle. If dayMinutes is provided, sum available minutes for each
        // candidate day, subtract time already booked by this master's existing
        // instances, then compute how many new instances (each of duration
        // src.dur) can fit. Unfitted instances are tracked so we can emit them
        // as _tpcBudgetUnscheduled.
        var budgetSlotsNeeded = slotsNeeded; // uncapped default
        var budgetExceededCount = 0;
        if (dayMinutes && slotsNeeded > 0 && src.dur > 0) {
          // Total available minutes across candidate days in this cycle.
          var totalCycleMinutes = 0;
          cycleCandidates.forEach(function(cd) {
            var dm = dayMinutes[cd.key];
            if (typeof dm === 'number' && dm > 0) {
              totalCycleMinutes += dm;
            }
          });
          // Already-booked instances consume dur minutes each (approximate —
          // some may be done with a different effective duration, but we use
          // the master dur as a consistent budget unit).
          var bookedMinutes = existingInCycle * src.dur;
          var remainingMinutes = totalCycleMinutes - bookedMinutes;
          if (remainingMinutes < 0) remainingMinutes = 0;
          var maxNewInstances = Math.floor(remainingMinutes / src.dur);
          if (maxNewInstances < slotsNeeded) {
            budgetExceededCount = slotsNeeded - maxNewInstances;
            budgetSlotsNeeded = Math.max(0, maxNewInstances);
          }
        }

        // Pick pool: candidates that are not already booked (neither
        // terminal nor pending). No point picking a date that already has
        // a pending instance — it'd just produce a no-op target.
        var available = cycleCandidates.filter(function(cd) {
          return !bookedKeys[cd.key];
        });

        if (budgetSlotsNeeded > 0 && available.length > 0) {
          // Greedy pick: closest candidate to lastPlaced + targetInterval.
          // First pick (no lastPlaced) targets the cycle start — which equals
          // anchor in cycle 0 — so the first instance lands on/near the anchor.
          var ref = lastPlaced || null;
          for (var pi = 0; pi < budgetSlotsNeeded && available.length > 0; pi++) {
            var idealDate;
            if (ref) {
              idealDate = new Date(ref);
              idealDate.setDate(idealDate.getDate() + Math.round(targetInterval));
            } else {
              idealDate = new Date(cycleStart);
            }
            var bestIdx = 0;
            var bestDist = Infinity;
            for (var ai = 0; ai < available.length; ai++) {
              var dist = Math.abs(Math.round((available[ai].date.getTime() - idealDate.getTime()) / 86400000));
              if (dist < bestDist) { bestDist = dist; bestIdx = ai; }
            }
            picked[available[bestIdx].key] = true;
            ref = available[bestIdx].date;
            lastPlaced = ref;
            available.splice(bestIdx, 1);
          }
        }

        // Budget-aware TPC (999.013): emit unscheduled instances for the
        // portion of slotsNeeded that exceeded the available time budget.
        // These instances get _tpcBudgetUnscheduled=true and _tpcCycleStart
        // so the caller can create DB rows (for UI visibility) but skip
        // placement. We space them using target-interval steering from the
        // last placed date so they appear at natural intervals.
        if (budgetExceededCount > 0 && dayMinutes) {
          // Collect remaining available dates (not already picked/booked).
          // Reuse the `available` array which was spliced during the greedy
          // pick — remaining entries are still unbooked candidates.
          var unscheduledRef = lastPlaced || null;
          for (var uei = 0; uei < budgetExceededCount && available.length > 0; uei++) {
            var unscheduledIdeal;
            if (unscheduledRef) {
              unscheduledIdeal = new Date(unscheduledRef);
              unscheduledIdeal.setDate(unscheduledIdeal.getDate() + Math.round(targetInterval));
            } else {
              unscheduledIdeal = new Date(cycleStart);
            }
            var uBestIdx = 0;
            var uBestDist = Infinity;
            for (var uai = 0; uai < available.length; uai++) {
              var uDist = Math.abs(Math.round((available[uai].date.getTime() - unscheduledIdeal.getTime()) / 86400000));
              if (uDist < uBestDist) { uBestDist = uDist; uBestIdx = uai; }
            }
            // Mark as budget-unscheduled in picked but with the flag so the
            // main iteration loop below can set _tpcBudgetUnscheduled on the
            // generated instance.
            picked[available[uBestIdx].key] = '_tpcBudgetUnscheduled';
            unscheduledRef = available[uBestIdx].date;
            lastPlaced = unscheduledRef;
            available.splice(uBestIdx, 1);
          }
        }

        cycleStart = cycleEnd;
      }
    }

    // Multi-step spacing (999.874): compute _targetDate and _deadlineDate
    // for each picked date. The first instance's target = first eligible day
    // of the cycle. Each subsequent instance's target = previous target + minGap.
    // minGap = max(1, floor(cycleDays * 0.5)).
    var minGap = Math.max(1, Math.floor(cycleDays * 0.5));
    var targetDates = {};
    var sortedPicked = Object.keys(picked).sort();
    var prevTarget = null;
    sortedPicked.forEach(function(pk) {
      var pickedDate = parseDate(pk);
      if (!pickedDate) return;
      var target;
      if (prevTarget) {
        target = new Date(prevTarget);
        target.setDate(target.getDate() + minGap);
      } else {
        // First instance: target = first eligible day of the cycle
        target = new Date(pickedDate);
      }
      var targetKey = formatDateKey(target);
      // Deadline = target + minGap days (or cycle end, whichever is sooner)
      var deadline = new Date(target);
      deadline.setDate(deadline.getDate() + minGap);
      var deadlineKey = formatDateKey(deadline);
      targetDates[pk] = { target: targetKey, deadline: deadlineKey };
      prevTarget = target;
    });
    tpcTargetDates[src.id] = targetDates;

    tpcPickedDates[src.id] = picked;
  });

  // --- Rolling recurrence: arithmetic projection from anchor, no day iteration ---
  sources.forEach(function(src) {
    var r = src.recur;
    if (!r || r.type !== 'rolling') return;
    // R5: only ONE active rolling instance at a time. If the master already has a
    // non-terminal instance, do NOT project the next — it is generated only when the
    // active one completes (which advances next_start → this guard clears).
    if (existingActiveBySource[src.id]) return;
    // 999.1185: SINGLE derivation — module-level rollingIntervalDays (also
    // used by runSchedule.js's period-boundary classifier).
    var rollingInterval = rollingIntervalDays(r);
    var rollingAnchor = getAnchor(src, startDate);
    for (var n = 1; n <= 1000; n++) {
      var offsetDays = Math.round(n * rollingInterval);
      var rollingDate = new Date(rollingAnchor.getTime());
      rollingDate.setDate(rollingDate.getDate() + offsetDays);
      rollingDate.setHours(0, 0, 0, 0);
      if (rollingDate > end) break;
      if (rollingDate < cursor) continue;
      var rollingDateStr = formatDateKey(rollingDate);
      var rollingKey = src.id + '|' + rollingDateStr;
      if (existingBySourceDate[rollingKey]) continue;
      if (existingByDateText[rollingDateStr + '|' + src.text]) continue;
      nextOrdBySource[src.id] = (nextOrdBySource[src.id] || 0) + 1;
      var rollingId = src.id + '-' + nextOrdBySource[src.id];
      existingBySourceDate[rollingKey] = true;
      existingByDateText[rollingDateStr + '|' + src.text] = true;
      var rollingDow = rollingDate.getDay();
      newTasks.push({
        id: rollingId,
        sourceId: src.id,
        taskType: 'recurring_instance',
        text: src.text,
        date: rollingDateStr,
        _candidateDate: rollingDateStr,
        day: DAY_NAMES[rollingDow],
        dur: src.dur,
        pri: src.pri,
        dayReq: 'any',
        when: src.when,
        placement_mode: src.placement_mode,
        occurrence_ordinal: nextOrdBySource[src.id]
      });
      // R5: emit ONLY the single active instance per run. The next is projected on a
      // later run after this one completes (anchor advances, guard above clears).
      existingActiveBySource[src.id] = true;
      break;
    }
  });

  var iter = 0;
  while (cursor <= end && (maxIter === 0 || iter < maxIter)) {
    iter++;
    var dateStr = formatDateKey(cursor);
    var dow = cursor.getDay();
    var dayName = DAY_NAMES[dow];

    sources.forEach(function(src) {
      var r = src.recur;
      if (r.type === 'rolling') return; // handled by rolling section above
      var anchor = getAnchor(src, startDate);
      if (cursor < anchor) return;
      if (src.recurEnd) {
        var he = parseAnchor(src.recurEnd);
        if (he && cursor > he) return;
      }

      // timesPerCycle: pre-computed optimal dates are in tpcPickedDates. Computed
      // BEFORE the match predicate (hoisted from below, 999.1372 candidate-B) so we
      // know whether this source went through TPC-biweekly candidate filtering and,
      // if so, can hand matchesRecurrenceDay the SAME stableEpoch the pool used.
      var selectedDayCount = getSelectedDayCount(r);
      var tpc = r.timesPerCycle || 0;
      var isTpcFiltered = tpc > 0 && tpc < selectedDayCount;

      // Match predicate extracted to matchesRecurrenceDay (999.1091 C1) — byte-identical
      // behavior, now shared with computeNextOccurrenceAnchor's forward search.
      // 999.1372 candidate-B (zoe-jwrr-biweekly-pick-generation-parity-split): for a
      // TPC-filtered biweekly source, pass the persisted stableEpoch as the parity
      // override so this gate's biweekly parity check is computed from the exact same
      // epoch the candidate pool used — pool and gate can then never disagree, closing
      // the deadlock class rather than just this fixture. Every other source (non-TPC,
      // or non-biweekly) is untouched: tpcParityAnchor is undefined and
      // matchesRecurrenceDay falls back to `anchor`, byte-identical to before.
      var tpcParityAnchor = (isTpcFiltered && r.type === 'biweekly') ? tpcStableEpochBySource[src.id] : undefined;
      var match = matchesRecurrenceDay(cursor, r, anchor, dayMap, tpcParityAnchor);
      if (!match) return;

      var isTpcBudgetUnscheduled = false;
      if (isTpcFiltered) {
        if (!tpcPickedDates[src.id] || !tpcPickedDates[src.id][dateStr]) return;
        // Check if this instance is budget-unscheduled (not enough time in cycle)
        if (tpcPickedDates[src.id][dateStr] === '_tpcBudgetUnscheduled') {
          isTpcBudgetUnscheduled = true;
        }
      }

      // Respect day_req: skip days that don't match the constraint
      var dr = src.dayReq;
      if (dr && dr !== 'any') {
        var isWeekday = dow >= 1 && dow <= 5;
        if (dr === 'weekday' && !isWeekday) return;
        if (dr === 'weekend' && isWeekday) return;
        var drMap = { M: 1, T: 2, W: 3, R: 4, F: 5, Sa: 6, Su: 0, S: 6 };
        var drParts = dr.split(',');
        if (drParts.length > 1 || drMap[drParts[0]] !== undefined) {
          var drMatch = drParts.some(function(p) { return drMap[p] !== undefined && drMap[p] === dow; });
          if (!drMatch) return;
        }
      }

      // Dedup: skip if an instance already exists for this source + date
      var sourceDate = src.id + '|' + dateStr;
      if (existingBySourceDate[sourceDate]) return;
      if (existingByDateText[dateStr + '|' + src.text]) return;
      // Additional dupe check (frontend uses taskList.some)
      if (opts && opts.checkDupes) {
        var hasDupe = allTasks.some(function(et) { return et.date === dateStr && et.text === src.text && et.id !== src.id; });
        if (hasDupe) return;
      }
      // Ordinal-based ID: sourceUUID-<ordinal> (date-agnostic, reusable)
      nextOrdBySource[src.id] = (nextOrdBySource[src.id] || 0) + 1;
      var id = src.id + '-' + nextOrdBySource[src.id];
      existingBySourceDate[sourceDate] = true;
      existingByDateText[dateStr + '|' + src.text] = true;
      // When timesPerCycle < selected days, set dayReq to all selected day codes
      // so the scheduler can move the instance to whichever day has best availability.
      var instanceDayReq = src.dayReq || 'any';
      if (tpc > 0 && tpc < selectedDayCount) {
        var dayReqParts = [];
        var codeMap = { M: 'M', T: 'T', W: 'W', R: 'R', F: 'F', S: 'Sa', U: 'Su' };
        var rDays = r.days || 'MTWRF';
        if (r.type === 'daily') rDays = 'MTWRFSU';
        if (typeof rDays === 'string') {
          for (var dri = 0; dri < rDays.length; dri++) {
            if (codeMap[rDays[dri]]) dayReqParts.push(codeMap[rDays[dri]]);
          }
        } else if (typeof rDays === 'object') {
          Object.keys(rDays).forEach(function(k) { if (codeMap[k]) dayReqParts.push(codeMap[k]); });
        }
        if (dayReqParts.length > 0) instanceDayReq = dayReqParts.join(',');
      }

      newTasks.push({
        id: id, date: dateStr, day: dayName, project: src.project, text: src.text,
        pri: src.pri, recurring: src.recurring || false, rigid: src.rigid || false,
        time: src.time, dur: src.dur, where: src.where, when: src.when,
        location: src.location, tools: src.tools, split: src.split, splitMin: src.splitMin,
        timeFlex: src.timeFlex, preferredTimeMins: src.preferredTimeMins,
        marker: src.marker, flexWhen: src.flexWhen,
        dayReq: instanceDayReq, section: '', notes: src.notes || '',
        placement_mode: src.placement_mode,
        taskType: 'generated', sourceId: src.id, generated: true,
        _candidateDate: dateStr,
        _occurrenceOrdinal: nextOrdBySource[src.id],
        _tpcBudgetUnscheduled: isTpcBudgetUnscheduled || false,
        // Multi-step spacing (999.874): target date and deadline for flexible TPC
        _targetDate: (tpc > 0 && tpc < selectedDayCount && tpcTargetDates[src.id] && tpcTargetDates[src.id][dateStr])
          ? tpcTargetDates[src.id][dateStr].target : null,
        _deadlineDate: (tpc > 0 && tpc < selectedDayCount && tpcTargetDates[src.id] && tpcTargetDates[src.id][dateStr])
          ? tpcTargetDates[src.id][dateStr].deadline : null
      });
    });

    cursor.setDate(cursor.getDate() + 1);
  }
  return newTasks;
}

// Whether a recurrence config needs a stored anchor date (recur_start) to
// produce stable output. Anchor-dependent types drift day-to-day when their
// anchor falls back to "today" — biweekly parity flips, interval counting
// slides, timesPerCycle cycle boundaries slide. Self-describing types
// (daily, weekly by day-of-week, monthly by calendar days) do not need an
// anchor because the pattern IS the spec.
function isAnchorDependentRecur(recur) {
  if (!recur || typeof recur !== 'object') return false;
  if (recur.type === 'rolling') return true;
  if (recur.type === 'biweekly') return true;
  if (recur.type === 'interval') return true;
  // timesPerCycle < selected days ⇒ we pick N of M candidates per cycle,
  // which requires stable cycle boundaries anchored from recur_start.
  var tpc = Number(recur.timesPerCycle) || 0;
  if (tpc > 0) {
    var selected;
    if (recur.type === 'weekly' || recur.type === 'biweekly') {
      var days = recur.days || 'MTWRF';
      selected = typeof days === 'object' && !Array.isArray(days)
        ? Object.keys(days).length
        : (typeof days === 'string' ? days.length : 0);
    } else if (recur.type === 'daily') {
      selected = 7;
    } else if (recur.type === 'monthly') {
      selected = (recur.monthDays || [1, 15]).length;
    } else {
      selected = 0;
    }
    if (tpc < selected) return true;
  }
  return false;
}

// Rolling interval in days (999.1185): intervalDays, else every×unit
// (weeks=7d, months=30d, else days), else 7. A rolling instance is NOT
// day-locked (dayReq='any'); its window IS the interval, so its period
// boundary = occurrence + interval. Accepts a parsed recur object or its
// JSON-string form (runSchedule passes raw DB values). SINGLE derivation
// shared by the rolling expansion pass above and runSchedule.js's
// period-boundary classifier (was a mirrored local copy there).
function rollingIntervalDays(recur) {
  var r = recur;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_e) { return 7; } }
  if (!r) return 7;
  if (r.intervalDays != null && Number(r.intervalDays) >= 1) return Math.max(1, Number(r.intervalDays));
  if (r.every != null && r.unit) {
    var everyN = Math.max(1, parseInt(r.every, 10) || 1);
    if (r.unit === 'weeks') return everyN * 7;
    if (r.unit === 'months') return everyN * 30;
    return everyN; // 'days'
  }
  return 7;
}

module.exports = {
  expandRecurring: expandRecurring,
  rollingIntervalDays: rollingIntervalDays,
  isAnchorDependentRecur: isAnchorDependentRecur,
  matchesRecurrenceDay: matchesRecurrenceDay,
  nextMatchingDate: nextMatchingDate,
  getAnchor: getAnchor,
  // FR-4 (juggler-recur-lifecycle-redesign, W5): exported so facade.js's
  // material-edit reconciliation engine can reuse the SAME cycle-boundary +
  // fulfillment-counting primitives the scheduler's own TPC picker uses
  // (999.1372) rather than reimplementing cycle-counting (telly
  // TELLY-W5-REVIEW.md prior-art note #2). Previously internal-only.
  getStableEpoch: getStableEpoch,
  enumerateBookedDatesInCycle: enumerateBookedDatesInCycle
};

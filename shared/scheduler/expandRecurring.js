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

// Resolve the recurrence anchor for a source. recurStart is the canonical
// anchor; src.date (scheduled_at-derived) is a legacy fallback; startDate is
// the final safety net so expansion still produces output for null anchors.
function getAnchor(src, startDate) {
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

function expandRecurring(allTasks, startDate, endDate, opts) {
  var dayMap = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };
  var existingIds = {};
  allTasks.forEach(function(t) { existingIds[t.id] = true; });
  var existingByDateText = {};
  var existingBySourceDate = {};
  // Status per (sourceId, date) — lets the 'backfill' fill policy distinguish
  // skipped instances (replaceable) from done/cancel/pending (fulfilled).
  var instanceStatusBySourceDate = {};
  allTasks.forEach(function(t) {
    // Skip recurring templates — they're sources, not placed tasks.
    // Their date is the anchor, not an instance that should block generation.
    if (t.taskType === 'recurring_template') return;
    if (t.date && t.text) existingByDateText[t.date + '|' + t.text] = true;
    if (t.sourceId && t.date) {
      existingBySourceDate[t.sourceId + '|' + t.date] = true;
      instanceStatusBySourceDate[t.sourceId + '|' + t.date] = t.status || '';
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
    if (st === 'pause' || st === 'disabled') return false;
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

  // Caller (runSchedule) passes a map of pending recurring_instance dates so
  // the tpc slot accounting can count them as booked. Without this, pending
  // instances were filtered out of `allTasks` (so expandRecurring could emit
  // fresh targets for them via reconciliation). That made tpc oblivious to
  // them and it would pick fresh replacement dates when the user had skipped
  // some of the cycle's picks — leading to the "skip → new pick today →
  // skip → repeat" loop.
  var pendingBookedByDate = (opts && opts.pendingBookedByDate) || {};

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
                var dd = Math.round((c.getTime() - anchor.getTime()) / 86400000);
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
    // Cycle boundaries are anchored to `anchor + k*cycleDays` so they are
    // deterministic and independent of window position. lastPlaced evolves
    // from picks within this call only — it is not pre-seeded from DB rows.
    var picked = {};
    var lastPlaced = null;

    if (candidates.length > 0) {
      var firstCandMs = candidates[0].date.getTime();
      var anchorMs = anchor.getTime();
      var daysFromAnchor = Math.floor((firstCandMs - anchorMs) / 86400000);
      var kStart = Math.floor(daysFromAnchor / cycleDays);
      var cycleStart = new Date(anchor);
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

        // Cycle bookings: terminal-blocked (done/skip/cancel) + pending.
        // Both count against the tpc budget. Dedup via a Set since a date
        // could theoretically be in both maps.
        var bookedKeys = {};
        var pendingKeys = {};
        cycleCandidates.forEach(function(cd) {
          var key = src.id + '|' + cd.key;
          if (existingBySourceDate[key]) bookedKeys[cd.key] = true;
          if (pendingBookedByDate[key]) { bookedKeys[cd.key] = true; pendingKeys[cd.key] = true; }
        });
        var existingInCycle = Object.keys(bookedKeys).length;

        // Pre-fill `picked` with existing pending dates so they emit as desired
        // occurrences. Without this the reconcile diff would treat them as
        // "not desired" and DELETE them — even though the user still wants
        // them. Pending are already tpc-budgeted, so they belong in picked
        // regardless of slot math.
        Object.keys(pendingKeys).forEach(function(k) { picked[k] = true; });

        // Fill policy (#26). Per-task setting on the recurrence:
        //   'keep'     (default) — once any instance exists in the cycle,
        //               skipped slots are NOT refilled. The cycle is a
        //               pattern the user already touched; respect it.
        //               Prevents the "skip → new pick → skip → loop" that
        //               makes a habit feel pushy.
        //   'backfill' — aim to hit the tpc target. Count fulfilled
        //               instances (done/cancel/pending/wip) toward the
        //               budget; skip is treated as replaceable.
        //               needed = tpc − fulfilled.
        var fillPolicy = (r && r.fillPolicy === 'backfill') ? 'backfill' : 'keep';
        var slotsNeeded;
        if (fillPolicy === 'backfill') {
          var fulfilledInCycle = 0;
          cycleCandidates.forEach(function(cd) {
            if (!bookedKeys[cd.key]) return;
            var status = instanceStatusBySourceDate[src.id + '|' + cd.key] || '';
            // Anything other than 'skip' counts toward the target: done/cancel
            // are settled and pending/wip are already scheduled.
            if (status !== 'skip') fulfilledInCycle++;
          });
          slotsNeeded = Math.max(0, tpc - fulfilledInCycle);
        } else {
          slotsNeeded = existingInCycle === 0 ? tpc : 0;
        }

        // Pick pool: candidates that are not already booked (neither
        // terminal nor pending). No point picking a date that already has
        // a pending instance — it'd just produce a no-op target.
        var available = cycleCandidates.filter(function(cd) {
          return !bookedKeys[cd.key];
        });

        if (slotsNeeded > 0 && available.length > 0) {
          // Greedy pick: closest candidate to lastPlaced + targetInterval.
          // First pick (no lastPlaced) targets the cycle start — which equals
          // anchor in cycle 0 — so the first instance lands on/near the anchor.
          var ref = lastPlaced || null;
          for (var pi = 0; pi < slotsNeeded && available.length > 0; pi++) {
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

        cycleStart = cycleEnd;
      }
    }

    tpcPickedDates[src.id] = picked;
  });

  var iter = 0;
  while (cursor <= end && (maxIter === 0 || iter < maxIter)) {
    iter++;
    var dateStr = formatDateKey(cursor);
    var dow = cursor.getDay();
    var dayName = DAY_NAMES[dow];

    sources.forEach(function(src) {
      var r = src.recur;
      var anchor = getAnchor(src, startDate);
      if (cursor < anchor) return;
      if (src.recurEnd) {
        var he = parseAnchor(src.recurEnd);
        if (he && cursor > he) return;
      }

      var match = false;
      if (r.type === 'daily') {
        match = true;
      } else if (r.type === 'weekly' || r.type === 'biweekly') {
        var days = r.days || 'MTWRF';
        var dayResult = doesDayMatch(dow, days, dayMap);
        if (!dayResult.match) return;
        var dayState = dayResult.state;
        if (r.type === 'biweekly') {
          var daysDiff = Math.round((cursor.getTime() - anchor.getTime()) / 86400000);
          if (Math.floor(daysDiff / 7) % 2 !== 0) return;
        }
        match = true;
      } else if (r.type === 'monthly') {
        var md = r.monthDays || [1, 15];
        var dom = cursor.getDate();
        var lastDom = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
        for (var mi = 0; mi < md.length; mi++) {
          var v = md[mi];
          if (v === 'first' && dom === 1) { match = true; break; }
          if (v === 'last' && dom === lastDom) { match = true; break; }
          if (Number(v) === dom) { match = true; break; }
        }
      } else if (r.type === 'interval') {
        var every = r.every || 2;
        var unit = r.unit || 'days';
        if (unit === 'days') {
          var between = Math.round((cursor.getTime() - anchor.getTime()) / 86400000);
          if (between >= 0 && between % every === 0) match = true;
        } else if (unit === 'weeks') {
          var betweenD = Math.round((cursor.getTime() - anchor.getTime()) / 86400000);
          if (betweenD >= 0 && betweenD % (every * 7) === 0) match = true;
        } else if (unit === 'months') {
          if (cursor.getDate() === anchor.getDate()) {
            var monthDiff = (cursor.getFullYear() - anchor.getFullYear()) * 12 + (cursor.getMonth() - anchor.getMonth());
            if (monthDiff >= 0 && monthDiff % every === 0) match = true;
          }
        } else if (unit === 'years') {
          if (cursor.getMonth() === anchor.getMonth() && cursor.getDate() === anchor.getDate()) {
            var yearDiff = cursor.getFullYear() - anchor.getFullYear();
            if (yearDiff >= 0 && yearDiff % every === 0) match = true;
          }
        }
      }
      if (!match) return;

      // timesPerCycle: pre-computed optimal dates are in tpcPickedDates.
      // If this source has tpc filtering, only generate on picked dates.
      var selectedDayCount = getSelectedDayCount(r);
      var tpc = r.timesPerCycle || 0;
      if (tpc > 0 && tpc < selectedDayCount) {
        if (!tpcPickedDates[src.id] || !tpcPickedDates[src.id][dateStr]) return;
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
        taskType: 'generated', sourceId: src.id, generated: true,
        _candidateDate: dateStr,
        _occurrenceOrdinal: nextOrdBySource[src.id]
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

module.exports = {
  expandRecurring: expandRecurring,
  isAnchorDependentRecur: isAnchorDependentRecur
};

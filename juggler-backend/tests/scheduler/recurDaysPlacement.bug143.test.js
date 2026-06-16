/**
 * BUG-143 -- recur.days weekday-placement constraint tests: AC2/AC2b/AC3/AC4
 *
 * Traceability: .planning/kermit/jug-recur-days-placement/TRACEABILITY.md BUG-143-B
 *
 * RC-B (BUG-143-B): unifiedScheduleV2.js line 372 only reads t.dayReq for
 * allowedDows. t.recur.days (the recurrence pattern, e.g. 'MTWRF') is never
 * fed into the placement day-filter. For flexible-TPC recurring tasks
 * (isFlexibleTpc=true, isDayLocked=false), the scheduler may roam to any day
 * within cycleDays -- including Sat/Sun -- because allowedDows is null.
 *
 * DECIDED BEHAVIOR (brain #72165):
 *   AC2  -- recur.days string ('MTWRF') constrains placement to {Mon..Fri}. [RED]
 *   AC2b -- recur.days object map ({M:true,W:true,F:true}) does the same.   [RED]
 *   AC3  -- when dayReq AND recur.days are both set, the INTERSECTION applies.[RED]
 *   AC4  -- non-recurring tasks: placement unchanged (dayReq-only, no recur  [GREEN]
 *           path entered). Preserve golden-master.
 *
 * Test strategy:
 *   - Use unifiedScheduleV2 directly (no DB) -- same approach as unifiedSchedule.test.js.
 *   - For AC2/AC2b: anchor the instance on a weekend day. Without the fix the
 *     scheduler places it on the weekend (allowedDows=null). With the fix it is
 *     excluded and roams to the next weekday.
 *   - For AC3: anchor on a day excluded by the recur.days subset (e.g. Tuesday for MWF).
 *   - For AC4: non-recurring weekday task on a weekend day stays excluded via dayReq.
 *
 * Pure unit -- no DB, no network.
 */

'use strict';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');

// ── Test fixtures ─────────────────────────────────────────────────────────────
//
// Key dates (local midnight via new Date(y, m-1, d).getDay()):
//   2026-06-14  DOW=0  Sunday
//   2026-06-15  DOW=1  Monday    <- default TODAY for most tests
//   2026-06-16  DOW=2  Tuesday
//   2026-06-17  DOW=3  Wednesday
//   2026-06-18  DOW=4  Thursday
//   2026-06-19  DOW=5  Friday
//   2026-06-20  DOW=6  Saturday  <- used to trigger the AC2 weekend-placement bug
//   2026-06-21  DOW=0  Sunday

const TODAY = '2026-06-15'; // Monday
const NOW_MINS = 480;       // 8:00 AM

function makeCfg(overrides) {
  return Object.assign({
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15
  }, overrides);
}

const cfg = makeCfg();

function schedule(tasks, statuses, today, nowMins) {
  return unifiedSchedule(
    tasks,
    statuses || {},
    today  || TODAY,
    nowMins != null ? nowMins : NOW_MINS,
    cfg
  );
}

/** Returns all task placements across all dates, filtering out marker entries. */
function allPlacements(result) {
  const placements = [];
  Object.entries(result.dayPlacements).forEach(function(entry) {
    const dateKey = entry[0];
    const dayList = entry[1];
    (dayList || []).forEach(function(p) {
      if (p && p.task) {
        placements.push({ dateKey: dateKey, start: p.start, dur: p.dur, task: p.task });
      }
    });
  });
  return placements;
}

/**
 * DOW from an ISO date key using the same local-midnight construction that
 * unifiedScheduleV2 uses (new Date(year, month-1, day).getDay()).
 */
function isoDow(dateKey) {
  const parts = dateKey.split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getDay();
}

// ── AC4 (GREEN golden-master): non-recurring task respects dayReq only ────────
// Must pass on current code AND remain passing after the fix.

describe('BUG-143 AC4 -- non-recurring dayReq placement [GREEN golden-master]', () => {
  /**
   * A non-recurring task with dayReq='weekday' on a Sunday must not be placed
   * on Sunday. The scheduler must defer to the next weekday.
   * This is the EXISTING correct behaviour (dayReq works for non-recurring tasks).
   */
  test('AC4a: non-recurring weekday-only task anchored on Sunday is not placed on Sunday', () => {
    const task = {
      id: 'non-recur-wd',
      text: 'Weekday only',
      date: '2026-03-22', // 2026-03-22 = Sunday (DOW=0)
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: 'weekday',
      recurring: 0
    };
    const result = schedule([task], {}, '2026-03-22');
    const onSunday = (result.dayPlacements['2026-03-22'] || [])
      .filter(function(p) { return p.task && p.task.id === 'non-recur-wd'; });
    expect(onSunday).toHaveLength(0);
  });

  /**
   * Non-recurring task WITHOUT dayReq IS placed on its Sunday anchor.
   * Confirms dayReq is the only constraint for non-recurring tasks.
   */
  test('AC4b: non-recurring task WITHOUT dayReq IS placed on Sunday anchor', () => {
    const task = {
      id: 'non-recur-any',
      text: 'Any day',
      date: '2026-03-22', // Sunday
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: 'any',
      recurring: 0
    };
    const result = schedule([task], {}, '2026-03-22');
    const placed = allPlacements(result).filter(function(p) { return p.task.id === 'non-recur-any'; });
    expect(placed.length).toBeGreaterThanOrEqual(1);
    expect(placed[0].dateKey).toBe('2026-03-22');
  });

  /**
   * Non-recurring task with dayReq='M,W,F' on a Tuesday must not land on Tuesday.
   * Existing comma-format dayReq filter works correctly.
   */
  test('AC4c: non-recurring M,W,F task on Tuesday is NOT placed on Tuesday', () => {
    const task = {
      id: 'non-recur-mwf',
      text: 'MWF task',
      date: '2026-06-16', // Tuesday (DOW=2)
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: 'M,W,F',
      recurring: 0
    };
    const result = schedule([task], {}, '2026-06-16');
    const onTuesday = (result.dayPlacements['2026-06-16'] || [])
      .filter(function(p) { return p.task && p.task.id === 'non-recur-mwf'; });
    expect(onTuesday).toHaveLength(0);
  });

  /**
   * Day-locked non-TPC recurring: stays on its anchor date; recur.days not needed.
   * This is already correct today and must stay correct post-fix.
   */
  test('AC4-daylocked: non-tpc recurring task stays on anchor; recur.days placement enforcement not needed', () => {
    const instance = {
      id: 'day-locked-tue',
      text: 'Day-locked weekly',
      date: '2026-06-16', // Tuesday anchor
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: null,
      recurring: 1,
      recur: {
        type: 'weekly',
        days: 'MTWRF'
        // NO timesPerCycle -> isFlexibleTpc=false -> isDayLocked=true -> stays on anchor
      }
    };
    const result = schedule([instance], {}, '2026-06-16');
    const placed = allPlacements(result).filter(function(p) { return p.task.id === 'day-locked-tue'; });
    // Day-locked: must be placed on its anchor Tuesday, or unplaced
    placed.forEach(function(p) {
      expect(p.dateKey).toBe('2026-06-16');
    });
  });
});

// ── AC2 (RED): recur.days STRING constrains placement for flexible-TPC tasks ──

describe('BUG-143 AC2 -- recur.days string constrains weekday placement [RED on current code]', () => {
  /**
   * DEFINITIVE RED test (CertifyNJ Saturday scenario).
   *
   * A flexible-TPC weekly task with recur.days='MTWRF' (5 days) and
   * timesPerCycle=1 has isFlexibleTpc=true -> isDayLocked=false -> can roam
   * within cycleDays=7 from the anchor.
   *
   * Anchor = Saturday (2026-06-20, DOW=6). cycleDays=7 window: Sat..Fri.
   *
   * WITHOUT fix: allowedDows=null -> Saturday is the first eligible day ->
   *   scheduler places on Saturday. WRONG.
   * WITH fix: recur.days='MTWRF' derives allowedDows={1,2,3,4,5} -> Saturday
   *   excluded -> scheduler finds Monday (2026-06-22) as next valid day.
   */
  test('AC2a [RED]: tpc MTWRF instance anchored on Saturday is NOT placed on Saturday', () => {
    const instance = {
      id: 'sat-anchor-bug',
      text: 'MTWRF task anchored on Saturday',
      date: '2026-06-20', // Saturday (DOW=6)
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: null,
      recurring: 1,
      recur: {
        type: 'weekly',
        days: 'MTWRF',  // weekdays only -- ignored today (RC-B)
        timesPerCycle: 1 // isFlexibleTpc=true -> isDayLocked=false
      }
    };

    const result = schedule([instance], {}, '2026-06-15'); // today=Monday

    const placed = allPlacements(result).filter(function(p) { return p.task.id === 'sat-anchor-bug'; });

    // Must NOT land on Saturday (DOW=6)
    // RED on current code: allowedDows=null -> Saturday placed
    const onSaturday = placed.filter(function(p) { return isoDow(p.dateKey) === 6; });
    expect(onSaturday).toHaveLength(0);

    // Must not land on Sunday either
    const onSunday = placed.filter(function(p) { return isoDow(p.dateKey) === 0; });
    expect(onSunday).toHaveLength(0);
  });

  /**
   * The CertifyNJ Sunday scenario: anchor = Sunday (2026-06-14, DOW=0).
   *
   * WITHOUT fix: allowedDows=null -> Sunday eligible -> placed on Sunday.
   * WITH fix: allowedDows={1..5} -> Sunday excluded -> finds Monday.
   */
  test('AC2b [RED]: tpc MTWRF instance anchored on Sunday is NOT placed on Sunday', () => {
    const instance = {
      id: 'sunday-anchor-bug',
      text: 'MTWRF task anchored on Sunday',
      date: '2026-06-14', // Sunday (DOW=0) -- the exact CertifyNJ scenario
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: null,
      recurring: 1,
      recur: {
        type: 'weekly',
        days: 'MTWRF',
        timesPerCycle: 1
      }
    };

    const result = schedule([instance], {}, '2026-06-14');
    const placed = allPlacements(result).filter(function(p) { return p.task.id === 'sunday-anchor-bug'; });

    // RED: allowedDows=null today -> Sunday placed. Fix: Sunday excluded.
    const onSunday = placed.filter(function(p) { return isoDow(p.dateKey) === 0; });
    expect(onSunday).toHaveLength(0);
  });

  /**
   * Characterization (GREEN by coincidence today, load-bearing post-fix):
   * tpc MTWRF instance on Monday anchor must land on a weekday.
   * Today it lands on Monday (first eligible day) by coincidence because
   * allowedDows=null and Monday happens to be the first day in the window.
   * Post-fix it is explicitly constrained.
   */
  test('AC2c-characterization: tpc MTWRF on Monday anchor lands on weekday (green by coincidence, load-bearing post-fix)', () => {
    const instance = {
      id: 'mon-anchor-ok',
      text: 'MTWRF on Monday anchor',
      date: '2026-06-15', // Monday (DOW=1)
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: null,
      recurring: 1,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 1 }
    };
    const result = schedule([instance]);
    const placed = allPlacements(result).filter(function(p) { return p.task.id === 'mon-anchor-ok'; });
    placed.forEach(function(p) {
      const dow = isoDow(p.dateKey);
      expect(dow).toBeGreaterThanOrEqual(1);
      expect(dow).toBeLessThanOrEqual(5);
    });
  });
});

// ── AC2b (RED): recur.days OBJECT MAP constrains placement ───────────────────

describe('BUG-143 AC2b -- recur.days object map constrains placement [RED on current code]', () => {
  /**
   * Same anchor-on-Sunday scenario as AC2b but with recur.days as an
   * object map ({M:true, W:true, F:true}) rather than a concat string.
   *
   * The fix must handle both formats. Without it: object maps are not
   * parsed into allowedDows either -> Sunday placed.
   */
  test('AC2b-a [RED]: tpc {M:true,W:true,F:true} instance on Sunday NOT placed on Sunday', () => {
    const instance = {
      id: 'obj-map-sunday',
      text: 'Object-map recur.days on Sunday',
      date: '2026-06-14', // Sunday (DOW=0)
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: null,
      recurring: 1,
      recur: {
        type: 'weekly',
        days: { M: true, W: true, F: true }, // object map
        timesPerCycle: 1
      }
    };

    const result = schedule([instance], {}, '2026-06-14');
    const placed = allPlacements(result).filter(function(p) { return p.task.id === 'obj-map-sunday'; });

    // Must NOT land on Sunday (DOW=0)
    const onSunday = placed.filter(function(p) { return isoDow(p.dateKey) === 0; });
    expect(onSunday).toHaveLength(0); // RED on current code

    // If placed, must be Mon, Wed, or Fri
    placed.forEach(function(p) {
      expect([1, 3, 5]).toContain(isoDow(p.dateKey));
    });
  });

  /**
   * Object map MWF with Tuesday anchor: must not land on Tuesday (DOW=2).
   * isFlexibleTpc=true (tpc=1 < 3 selected days). cycleDays=7.
   * Without fix: Tue is eligible -> placed on Tuesday. With fix: Tue excluded.
   */
  test('AC2b-b [RED]: tpc {M:true,W:true,F:true} instance on Tuesday NOT placed on Tuesday', () => {
    const instance = {
      id: 'obj-map-tue',
      text: 'MWF object-map on Tuesday',
      date: '2026-06-16', // Tuesday (DOW=2)
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: null,
      recurring: 1,
      recur: {
        type: 'weekly',
        days: { M: true, W: true, F: true },
        timesPerCycle: 1
      }
    };

    const result = schedule([instance], {}, '2026-06-16');
    const placed = allPlacements(result).filter(function(p) { return p.task.id === 'obj-map-tue'; });

    // Must NOT land on Tuesday (DOW=2)
    const onTuesday = placed.filter(function(p) { return isoDow(p.dateKey) === 2; });
    expect(onTuesday).toHaveLength(0); // RED on current code

    // If placed, must be Mon, Wed, or Fri
    placed.forEach(function(p) {
      expect([1, 3, 5]).toContain(isoDow(p.dateKey));
    });
  });
});

// ── AC3 (RED): dayReq AND recur.days intersection ────────────────────────────

describe('BUG-143 AC3 -- dayReq AND recur.days intersection [RED on current code]', () => {
  /**
   * Tightening intersection:
   *   dayReq  = 'weekday' -> {1,2,3,4,5}  (allows Tuesday)
   *   recur.days = 'MWF'  -> {1,3,5}      (EXCLUDES Tuesday)
   *   intersection = {1,3,5}
   *
   * Instance anchored on Tuesday (DOW=2).
   * WITHOUT fix: recur.days ignored -> dayReq='weekday' alone -> Tue allowed -> placed Tue.
   * WITH fix: intersection excludes Tue -> finds next Wed.
   *
   * RED: current code places on Tuesday because recur.days is ignored.
   */
  test('AC3a [RED]: dayReq=weekday + recur.days=MWF -- intersection excludes Tuesday', () => {
    const instance = {
      id: 'ac3-intersect-tue',
      text: 'weekday+MWF on Tuesday anchor',
      date: '2026-06-16', // Tuesday (DOW=2)
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: 'weekday', // {1..5} -- allows Tue
      recurring: 1,
      recur: {
        type: 'weekly',
        days: 'MWF',     // {1,3,5} -- EXCLUDES Tue
        timesPerCycle: 1
      }
    };

    const result = schedule([instance], {}, '2026-06-16');
    const placed = allPlacements(result).filter(function(p) { return p.task.id === 'ac3-intersect-tue'; });

    // Must NOT land on Tuesday
    // RED today: recur.days ignored -> dayReq='weekday' allows Tue -> placed Tue.
    const onTuesday = placed.filter(function(p) { return isoDow(p.dateKey) === 2; });
    expect(onTuesday).toHaveLength(0);

    // If placed, must be Mon, Wed, or Fri (intersection of weekday and MWF)
    placed.forEach(function(p) {
      expect([1, 3, 5]).toContain(isoDow(p.dateKey));
    });
  });

  /**
   * Null-aware: dayReq=null (unconstrained) AND recur.days='MWF'.
   * null intersection {1,3,5} = {1,3,5} (null means no dayReq restriction).
   * Instance on Tuesday (DOW=2): recur.days is the sole gate -> Tue excluded.
   * RED: current code ignores recur.days -> Tue is unfiltered -> placed Tue.
   */
  test('AC3b [RED]: dayReq=null + recur.days=MWF -- recur.days is sole constraint, excludes Tuesday', () => {
    const instance = {
      id: 'ac3-null-dayreq',
      text: 'null dayReq + MWF recur on Tuesday',
      date: '2026-06-16', // Tuesday (DOW=2)
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: null,
      recurring: 1,
      recur: {
        type: 'weekly',
        days: 'MWF',
        timesPerCycle: 1
      }
    };

    const result = schedule([instance], {}, '2026-06-16');
    const placed = allPlacements(result).filter(function(p) { return p.task.id === 'ac3-null-dayreq'; });

    // Must NOT land on Tuesday
    const onTuesday = placed.filter(function(p) { return isoDow(p.dateKey) === 2; });
    expect(onTuesday).toHaveLength(0); // RED on current code

    placed.forEach(function(p) {
      expect([1, 3, 5]).toContain(isoDow(p.dateKey));
    });
  });

  /**
   * Empty intersection test:
   *   dayReq  = 'weekend' -> {0,6}
   *   recur.days = 'MTWRF' -> {1..5}
   *   intersection = {} (empty set)
   *
   * No valid day exists -> task must be UNPLACED.
   * WITHOUT fix: recur.days ignored -> dayReq='weekend' alone -> places on weekend.
   * WITH fix: empty intersection -> unplaced.
   *
   * Anchor = Sunday (in the weekend allowed set).
   * RED: current code places on Sunday (only dayReq='weekend' applies).
   */
  test('AC3c [RED]: dayReq=weekend + recur.days=MTWRF -- empty intersection -- task must be unplaced', () => {
    const instance = {
      id: 'ac3-empty-intersect',
      text: 'weekend dayReq + MTWRF recur',
      date: '2026-06-14', // Sunday (DOW=0, in weekend set)
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: 'weekend', // {0,6}
      recurring: 1,
      recur: {
        type: 'weekly',
        days: 'MTWRF',   // {1..5}
        timesPerCycle: 1
      }
    };

    const result = schedule([instance], {}, '2026-06-14');
    const placed = allPlacements(result).filter(function(p) { return p.task.id === 'ac3-empty-intersect'; });

    // WITH fix: empty intersection -> zero placements.
    // RED today: recur.days ignored -> dayReq='weekend' alone -> placed on Sunday.
    expect(placed).toHaveLength(0);
  });
});

// ── WARN-2: biweekly recur.type is pinned ────────────────────────────────────
//
// zoe (2026-06-16): The RC-B intersection block runs for `weekly OR biweekly`
// (unifiedScheduleV2.js:394), but every placement test uses type:'weekly'.
// A regression dropping 'biweekly' from the type guard re-introduces the
// Saturday/Sunday placement bug for fortnightly tasks with no test to catch it.

describe('BUG-143 WARN-2 -- biweekly recur.type constrains weekday placement', () => {
  /**
   * Covers: BUG-143-B (RC-B intersection block, biweekly branch)
   * Layer: unit (no DB)
   *
   * A flexible-TPC BIWEEKLY task with recur.days='MTWRF' anchored on Saturday.
   * cycleDays=14 (biweekly). isFlexibleTpc=true (timesPerCycle=1 < 5 days).
   * isDayLocked=false -> task roams within the 14-day window.
   *
   * WITHOUT the biweekly type guard: allowedDows stays null -> Saturday eligible.
   * WITH the guard: recur.days='MTWRF' -> {1..5} -> Saturday excluded -> finds weekday.
   */
  test('WARN-2a: tpc biweekly MTWRF instance anchored on Saturday is NOT placed on Saturday', function() {
    var instance = {
      id: 'biweekly-sat-anchor',
      text: 'Biweekly MTWRF on Saturday',
      date: '2026-06-20', // Saturday (DOW=6)
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: null,
      recurring: 1,
      recur: {
        type: 'biweekly',
        days: 'MTWRF',
        timesPerCycle: 1 // isFlexibleTpc=true -> isDayLocked=false
      }
    };

    var result = schedule([instance], {}, '2026-06-15'); // today=Monday
    var placed = allPlacements(result).filter(function(p) { return p.task.id === 'biweekly-sat-anchor'; });

    // Must NOT land on Saturday (DOW=6) or Sunday (DOW=0)
    var onWeekend = placed.filter(function(p) {
      var dow = isoDow(p.dateKey);
      return dow === 0 || dow === 6;
    });
    expect(onWeekend).toHaveLength(0);

    // If placed, must be on a weekday (1..5) — recur.days='MTWRF' gates to Mon-Fri
    placed.forEach(function(p) {
      var dow = isoDow(p.dateKey);
      expect(dow).toBeGreaterThanOrEqual(1);
      expect(dow).toBeLessThanOrEqual(5);
    });
  });

  /**
   * Biweekly with Sunday anchor: same proof, different weekend day.
   * Confirms the biweekly branch handles DOW=0 consistently with DOW=6.
   */
  test('WARN-2b: tpc biweekly MTWRF instance anchored on Sunday is NOT placed on Sunday', function() {
    var instance = {
      id: 'biweekly-sun-anchor',
      text: 'Biweekly MTWRF on Sunday',
      date: '2026-06-14', // Sunday (DOW=0)
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: null,
      recurring: 1,
      recur: {
        type: 'biweekly',
        days: 'MTWRF',
        timesPerCycle: 1
      }
    };

    var result = schedule([instance], {}, '2026-06-14');
    var placed = allPlacements(result).filter(function(p) { return p.task.id === 'biweekly-sun-anchor'; });

    var onSunday = placed.filter(function(p) { return isoDow(p.dateKey) === 0; });
    expect(onSunday).toHaveLength(0);
  });
});

// ── WARN-3: JSON-string recur is pinned (IMPORTANT — production path) ─────────
//
// zoe (2026-06-16): The RC-B block begins with:
//   if (typeof recurObj === 'string') recurObj = JSON.parse(recurObj)
// (unifiedScheduleV2.js:387-388). Every existing test passes recur as a live JS
// object. The DB stores recur as JSON TEXT — production rows arrive as strings.
// This branch has no placement test; a regression removing the JSON.parse step
// would silently break all recurring task weekday-constraint in production while
// the test suite stays green.
//
// If the JSON.parse branch is NOT present (or broken), this test will FAIL because
// the scheduler won't extract recur.days from the string → allowedDows stays null
// → weekend placement occurs → BLOCK (report to bert).

describe('BUG-143 WARN-3 -- JSON-string recur (production DB shape) constrains weekday placement', () => {
  /**
   * Covers: BUG-143-B (RC-B JSON.parse branch, unifiedScheduleV2.js:387-388)
   * Layer: unit (no DB) — but exercises the EXACT production-DB deserialization path
   *
   * recur is passed as a JSON string (the shape DB rows take after JSON.stringify).
   * The RC-B block must JSON.parse it to extract recur.days.
   * Anchor = Saturday (DOW=6) to make the absence of weekday-gating immediately visible.
   *
   * If the code does NOT handle the JSON-string path, this test FAILS → BLOCK → bert.
   */
  test('WARN-3: tpc MTWRF instance with recur as JSON STRING is NOT placed on Saturday', function() {
    var instance = {
      id: 'json-string-recur',
      text: 'MTWRF weekly via JSON-string recur',
      date: '2026-06-20', // Saturday (DOW=6)
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: null,
      recurring: 1,
      // Production shape: recur stored as JSON text in the DB, not a live object
      recur: JSON.stringify({ type: 'weekly', days: 'MTWRF', timesPerCycle: 1 })
    };

    var result = schedule([instance], {}, '2026-06-15'); // today=Monday
    var placed = allPlacements(result).filter(function(p) { return p.task.id === 'json-string-recur'; });

    // recur.days='MTWRF' must constrain to Mon-Fri even when recur is a JSON string.
    // If JSON.parse branch is absent: allowedDows=null -> Saturday placed -> test FAILS.
    var onWeekend = placed.filter(function(p) {
      var dow = isoDow(p.dateKey);
      return dow === 0 || dow === 6;
    });
    expect(onWeekend).toHaveLength(0);

    // Any placement must be on a weekday
    placed.forEach(function(p) {
      var dow = isoDow(p.dateKey);
      expect(dow).toBeGreaterThanOrEqual(1);
      expect(dow).toBeLessThanOrEqual(5);
    });
  });

  /**
   * Negative case: JSON-string recur with object-map days.
   * Confirms that after JSON.parse the object-map branch (rd && typeof rd === 'object')
   * is also reached when recur arrives as a string.
   */
  test('WARN-3b: tpc {M,W,F} instance with recur as JSON STRING (object-map days) is NOT placed on Sunday', function() {
    var instance = {
      id: 'json-string-objmap',
      text: 'MWF weekly via JSON-string recur (object-map days)',
      date: '2026-06-14', // Sunday (DOW=0)
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: null,
      recurring: 1,
      recur: JSON.stringify({ type: 'weekly', days: { M: true, W: true, F: true }, timesPerCycle: 1 })
    };

    var result = schedule([instance], {}, '2026-06-14');
    var placed = allPlacements(result).filter(function(p) { return p.task.id === 'json-string-objmap'; });

    var onSunday = placed.filter(function(p) { return isoDow(p.dateKey) === 0; });
    expect(onSunday).toHaveLength(0);

    placed.forEach(function(p) {
      expect([1, 3, 5]).toContain(isoDow(p.dateKey));
    });
  });
});

// ── WARN-4: daily recur type does NOT over-constrain weekday placement ─────────
//
// zoe (2026-06-16): The RC-B guard correctly limits DOW constraint to weekly/biweekly
// (unifiedScheduleV2.js:394). AC4b already pins that a NON-recurring task with no
// dayReq IS placed on a Sunday anchor. But no test asserts that a RECURRING DAILY
// task is similarly unconstrained — an over-broad edit applying the day-set to daily
// tasks would restrict them with the suite green.

describe('BUG-143 WARN-4 -- daily recur type does NOT over-constrain weekday placement', () => {
  /**
   * Covers: BUG-143-B (RC-B type guard — daily must not enter DOW-constraint block)
   * Layer: unit (no DB)
   *
   * A flexible-TPC daily recurring task with NO weekday set (recur.days absent for
   * daily tasks — they repeat every day). Anchor = Sunday (DOW=0).
   *
   * The RC-B block must NOT apply a DOW constraint when recur.type='daily'.
   * Correct behavior: allowedDows=null (no constraint) -> task CAN land on Sunday.
   *
   * If the type guard is removed (daily enters the constraint block), and recur.days
   * is absent, no constraint is applied anyway (recurObj.days === null guard at :390).
   * We use recur.days=null explicitly to confirm the type + days-absent path is inert.
   */
  test('WARN-4a: daily tpc recurring task (recur.type=daily, no days field) on Sunday IS placed on Sunday', function() {
    var instance = {
      id: 'daily-sun-anchor',
      text: 'Daily tpc task on Sunday',
      date: '2026-06-14', // Sunday (DOW=0)
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: null, // no dayReq constraint either
      recurring: 1,
      recur: {
        type: 'daily',
        timesPerCycle: 1 // isFlexibleTpc=true
        // No 'days' field -- daily tasks don't have a DOW set
      }
    };

    var result = schedule([instance], {}, '2026-06-14');
    var placed = allPlacements(result).filter(function(p) { return p.task.id === 'daily-sun-anchor'; });

    // Daily task with no dayReq must NOT be blocked from Sunday by recur type guard.
    // A regression over-applying DOW constraints to daily would prevent Sunday placement.
    expect(placed.length).toBeGreaterThanOrEqual(1);

    // First placement must be on Sunday (anchor date, no constraint to defer it)
    var onSunday = placed.filter(function(p) { return isoDow(p.dateKey) === 0; });
    expect(onSunday.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Confirms that a daily task WITH an explicit dayReq='weekday' is still constrained
   * by dayReq (not by recur.type). The daily type guard only prevents recur.days from
   * adding a spurious DOW constraint; it does not remove dayReq constraints.
   */
  test('WARN-4b: daily tpc recurring task WITH dayReq=weekday on Sunday is NOT placed on Sunday', function() {
    var instance = {
      id: 'daily-weekday-sun',
      text: 'Daily tpc weekday-only task on Sunday',
      date: '2026-06-14', // Sunday (DOW=0)
      dur: 30,
      pri: 'P3',
      status: '',
      dayReq: 'weekday', // explicit constraint via dayReq (not recur.days)
      recurring: 1,
      recur: {
        type: 'daily',
        timesPerCycle: 1
      }
    };

    var result = schedule([instance], {}, '2026-06-14');
    var placed = allPlacements(result).filter(function(p) { return p.task.id === 'daily-weekday-sun'; });

    // dayReq='weekday' must still gate placement even for daily recur tasks.
    var onSunday = placed.filter(function(p) { return isoDow(p.dateKey) === 0; });
    expect(onSunday).toHaveLength(0);
  });
});

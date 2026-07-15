/**
 * 999.1599 (David ruling 2026-07-15) — ANY-LOCATION tool resolution for
 * location-'anywhere' tasks.
 * Layer: unit — pure functions + scheduler integration, no DB, no wall-clock.
 *
 * Ticket: "Submit Weekly UI Claim" (master t1776649350872m2xp, dev DB user
 * 019f5bc6) — a weekly recurring instance (recur {type:weekly, days:WRFM,
 * timesPerCycle:1, fillPolicy:backfill}, location=[] i.e. 'anywhere',
 * tools:['phone']) sat unscheduled=1 with unplaced_reason=tool_conflict,
 * unplaced_detail='Needs phone; not available at home' for THREE consecutive
 * weekly cycles.
 *
 * Investigation (this session, 2026-07-15) confirmed:
 *   - Day-roam ALREADY WORKS: isFlexibleTpc is true for this recur shape
 *     (timesPerCycle=1 < selectedDays=4 for days='WRFM'), so isDayLocked=false
 *     and findEarliestSlot's window is [anchorDate, anchorDate+cycleDays-1]
 *     (unifiedScheduleV2.js:1135-1163), scanning every recur-eligible day —
 *     confirming the prior 2026-07-14 investigation's day-roam conclusion.
 *   - The reason day-roam didn't help THIS case: for a location-'anywhere'
 *     task (location=[]), whyCannotRun/canTaskRun (shared/scheduler/
 *     locationHelpers.js) checked tool availability ONLY at the single
 *     location the CURRENT slot happened to resolve to (toolMatrix[dayLocId]).
 *     Since 'anywhere' means the task isn't tied to any one location, checking
 *     the arbitrarily-resolved slot location is the actual bug — every day in
 *     the roam window can resolve to a tool-less location while a DIFFERENT
 *     location (never visited by the day/slot resolver for this task) owns
 *     the tool. Day-roam correctly walks the days; it just can't fix a
 *     location-resolution bug.
 *
 * RULING (David, 2026-07-15, binding): tool resolution for location-'anywhere'
 * tasks = ANY-LOCATION semantics — placeable in windows where ANY location
 * owning the required tool applies (union across the tool matrix), not
 * "undefined/always fails", not "always available regardless", not
 * intersection across all locations. A totally empty/unconfigured tool matrix
 * still fails closed (no location owns anything → nothing is available
 * anywhere) — this is NOT "always available", it's a union over whatever IS
 * configured.
 *
 * Location-CONSTRAINED tasks (location.length > 0) are UNCHANGED: the
 * location guard already pins dayLocId to one of the task's allowed
 * locations before the tool check runs, so checking only that location's
 * tools remains correct (goldenMaster.a002-location.test.js pins this).
 *
 * SECOND BUG (harrison review 2026-07-15, applied here): the literal dev-DB row
 * for this ticket has tool_matrix = '{}' (a totally empty object). That was NOT
 * caught by loadSchedulerConfig.js's `config.tool_matrix || DEFAULT_TOOL_MATRIX`
 * fallback (an empty object is truthy in JS, so the default never applied) — a
 * separate, broader-blast-radius defect (affects EVERY tool-gated task for a
 * user whose tool_matrix persisted as `{}`, not just 'anywhere' tasks), now
 * fixed in loadSchedulerConfig.js (`assembleSchedulerCfg`): a present-but-empty
 * tool_matrix now falls back to DEFAULT_TOOL_MATRIX exactly like an absent one.
 * This is the fix that actually resolves the LITERAL dev-DB repro symptom
 * ("Needs phone; not available at home") — DEFAULT_TOOL_MATRIX owns 'phone' at
 * home, so once the empty '{}' correctly defaults, the task places even via the
 * OLD single-resolved-location check. See the 'DEV-DB REPRO SHAPE' describe
 * block below, which drives the real assembly path (parseUserConfigRows +
 * assembleSchedulerCfg), not a hand-built cfg. The tests above this note use a
 * non-empty, hand-built toolMatrix specifically to isolate and prove the
 * ANY-LOCATION union fix in shared/scheduler/locationHelpers.js on its own,
 * independent of the loadSchedulerConfig defaulting fix.
 */
'use strict';

process.env.NODE_ENV = 'test';

const locationHelpers = require('../../../../shared/scheduler/locationHelpers');
const unifiedSchedule = require('../../../src/scheduler/unifiedScheduleV2');
const { parseUserConfigRows, assembleSchedulerCfg } = require('../../../src/scheduler/loadSchedulerConfig');
const DEFAULT_TIME_BLOCKS = require('../../../src/scheduler/constants').DEFAULT_TIME_BLOCKS;

function makeCfg(overrides) {
  return Object.assign({
    timeBlocks: {
      Mon: [{ id: 'morning', tag: 'morning', name: 'Morning', start: 360, end: 480, loc: 'home' },
        { id: 'biz1', tag: 'biz', name: 'Biz', start: 480, end: 720, loc: 'work' },
        { id: 'lunch', tag: 'lunch', name: 'Lunch', start: 720, end: 780, loc: 'work' },
        { id: 'biz2', tag: 'biz', name: 'Biz', start: 780, end: 1020, loc: 'work' },
        { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260, loc: 'home' }],
      Tue: [], Wed: [{ id: 'morning', tag: 'morning', name: 'Morning', start: 360, end: 480, loc: 'home' },
        { id: 'biz1', tag: 'biz', name: 'Biz', start: 480, end: 720, loc: 'work' },
        { id: 'lunch', tag: 'lunch', name: 'Lunch', start: 720, end: 780, loc: 'work' },
        { id: 'biz2', tag: 'biz', name: 'Biz', start: 780, end: 1020, loc: 'work' },
        { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260, loc: 'home' }],
      Thu: [{ id: 'morning', tag: 'morning', name: 'Morning', start: 360, end: 480, loc: 'home' },
        { id: 'biz1', tag: 'biz', name: 'Biz', start: 480, end: 720, loc: 'work' },
        { id: 'lunch', tag: 'lunch', name: 'Lunch', start: 720, end: 780, loc: 'work' },
        { id: 'biz2', tag: 'biz', name: 'Biz', start: 780, end: 1020, loc: 'work' },
        { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260, loc: 'home' }],
      Fri: [{ id: 'morning', tag: 'morning', name: 'Morning', start: 360, end: 480, loc: 'home' },
        { id: 'biz1', tag: 'biz', name: 'Biz', start: 480, end: 720, loc: 'work' },
        { id: 'lunch', tag: 'lunch', name: 'Lunch', start: 720, end: 780, loc: 'work' },
        { id: 'biz2', tag: 'biz', name: 'Biz', start: 780, end: 1020, loc: 'work' },
        { id: 'evening', tag: 'evening', name: 'Evening', start: 1020, end: 1260, loc: 'home' }],
      Sat: [], Sun: []
    },
    // 'phone' owned ONLY by 'transit' — a location the day/slot resolver above
    // NEVER assigns (blocks only ever resolve 'home' or 'work'). Proves the
    // fix is a real union-across-the-matrix check, not day-roam luck.
    toolMatrix: { home: [], work: [], transit: ['phone'] },
    splitMinDefault: 15,
    locSchedules: {}, locScheduleDefaults: {}, locScheduleOverrides: {},
    hourLocationOverrides: {}, scheduleTemplates: null, preferences: {}
  }, overrides);
}

describe('999.1599 unit — canTaskRun/whyCannotRun ANY-LOCATION semantics for anywhere tasks', () => {
  const toolMatrix = { home: [], work: ['phone'] };

  test('RED->GREEN: location=[] (anywhere) task + tool owned by a DIFFERENT location than dayLocId → canTaskRun true', () => {
    // home has no phone; work does. dayLocId is 'home'. Old behavior: false
    // (checked only toolMatrix['home']). Ruled behavior: true (union).
    var result = locationHelpers.canTaskRun(
      { location: [], tools: ['phone'] },
      'home',
      toolMatrix
    );
    expect(result).toBe(true);
  });

  test('whyCannotRun mirrors canTaskRun: {ok:true} for the same anywhere+union case', () => {
    var result = locationHelpers.whyCannotRun(
      { location: [], tools: ['phone'] },
      'home',
      toolMatrix
    );
    expect(result).toEqual({ ok: true });
  });

  test('anywhere task still fails closed when NO location owns the tool anywhere', () => {
    var result = locationHelpers.canTaskRun(
      { location: [], tools: ['phone'] },
      'home',
      { home: [], work: [] }
    );
    expect(result).toBe(false);
    var why = locationHelpers.whyCannotRun(
      { location: [], tools: ['phone'] },
      'home',
      { home: [], work: [] }
    );
    expect(why).toMatchObject({ ok: false, cause: 'tool_conflict' });
  });

  test('location-CONSTRAINED task (location.length>0) is UNCHANGED — still checks only dayLocId', () => {
    // Location-constrained: dayLocId is already guaranteed to be one of the
    // task's allowed locations by the earlier guard, so ANY-LOCATION must NOT
    // apply here — a task pinned to 'home' that needs a work-only tool must
    // still fail, even though 'work' owns the tool.
    var result = locationHelpers.canTaskRun(
      { location: ['home'], tools: ['phone'] },
      'home',
      toolMatrix
    );
    expect(result).toBe(false);
  });
});

describe('999.1599 scheduler integration — weekly WRFM tpc=1 anywhere+phone instance places via ANY-LOCATION', () => {
  test('recurring instance (location=[], tools=["phone"]) places within its cycle window when phone is owned by an unresolved location', () => {
    const TODAY = '2026-07-13'; // Monday — matches the ticket's instance -35 anchor date
    const NOW_MINS = 400;

    var task = {
      id: 't1776649350872m2xp-35', text: 'Submit Weekly UI Claim',
      date: TODAY, status: '', when: 'morning,lunch,biz',
      dayReq: 'any', dependsOn: [], location: [], tools: ['phone'],
      dur: 15, pri: 'P2',
      recurring: true, recur: { type: 'weekly', days: 'WRFM', timesPerCycle: 1, fillPolicy: 'backfill' },
      placementMode: 'time_blocks',
      earliestStart: TODAY, deadline: null,
      split: false, datePinned: false, generated: false, section: '', flexWhen: false
    };
    var statuses = { [task.id]: '' };
    var cfg = makeCfg();
    var result = unifiedSchedule([task], statuses, TODAY, NOW_MINS, cfg);

    var isUnplaced = (result.unplaced || []).some(function(t) { return t && t.id === task.id; });
    var placed = [];
    Object.keys(result.dayPlacements || {}).forEach(function(dk) {
      (result.dayPlacements[dk] || []).forEach(function(p) {
        if (p.task && p.task.id === task.id) placed.push({ dateKey: dk, start: p.start });
      });
    });

    // HARD GUARD: fail loudly (not silently pass an empty assertion) if the
    // fixture itself is broken — the false-green fixture trap
    // (.planning/patriots/TRAPS.md) requires the test to genuinely exercise
    // grid occupancy + tool-matrix state, not accidentally pass either way.
    if (isUnplaced && placed.length === 0) {
      var unplacedItem = (result.unplaced || []).find(function(t) { return t && t.id === task.id; });
      throw new Error('Expected instance to place via ANY-LOCATION tool resolution but it stayed unplaced: '
        + JSON.stringify(unplacedItem && { reason: unplacedItem._unplacedReason, detail: unplacedItem._unplacedDetail }));
    }

    expect(isUnplaced).toBe(false);
    expect(placed.length).toBeGreaterThanOrEqual(1);
    // Must land on one of the recur-eligible days (Mon/Wed/Thu/Fri of the cycle window).
    expect(['2026-07-13', '2026-07-15', '2026-07-16', '2026-07-17']).toContain(placed[0].dateKey);
  });

  test('REGRESSION GUARD: same task with a scheduler cfg.toolMatrix={} passed DIRECTLY (bypassing loadSchedulerConfig) stays unplaced tool_conflict (fail-closed, not "always available")', () => {
    // NOTE: this hand-builds cfg.toolMatrix={} and hands it straight to
    // unifiedSchedule, bypassing assembleSchedulerCfg's empty-tool_matrix→
    // DEFAULT_TOOL_MATRIX fallback (fixed below, harrison review 2026-07-15).
    // This proves the ANY-LOCATION union check ITSELF is fail-closed on a
    // genuinely empty matrix, independent of that separate defaulting fix —
    // see the 'DEV-DB REPRO SHAPE' block below for the REAL pipeline
    // (parseUserConfigRows + assembleSchedulerCfg), which now places instead.
    const TODAY = '2026-07-13';
    const NOW_MINS = 400;
    var task = {
      id: 't1776649350872m2xp-35-empty', text: 'Submit Weekly UI Claim',
      date: TODAY, status: '', when: 'morning,lunch,biz',
      dayReq: 'any', dependsOn: [], location: [], tools: ['phone'],
      dur: 15, pri: 'P2',
      recurring: true, recur: { type: 'weekly', days: 'WRFM', timesPerCycle: 1, fillPolicy: 'backfill' },
      placementMode: 'time_blocks',
      earliestStart: TODAY, deadline: null,
      split: false, datePinned: false, generated: false, section: '', flexWhen: false
    };
    var statuses = { [task.id]: '' };
    var cfg = makeCfg({ toolMatrix: {} });
    var result = unifiedSchedule([task], statuses, TODAY, NOW_MINS, cfg);
    var unplacedItem = (result.unplaced || []).find(function(t) { return t && t.id === task.id; });
    expect(unplacedItem).toBeDefined();
    expect(unplacedItem._unplacedReason).toBe('tool_conflict');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DEV-DB REPRO SHAPE — drives the REAL config-assembly pipeline (harrison
// review 2026-07-15): parseUserConfigRows + assembleSchedulerCfg, exactly as
// runSchedule.js/loadSchedulerConfig.js do in production, seeded with the
// LITERAL dev-DB row shape (tool_matrix config_value = '{}'). This is the
// second bug: an empty-but-present tool_matrix wasn't defaulting to
// DEFAULT_TOOL_MATRIX (loadSchedulerConfig.js:56-73), so the ANY-LOCATION fix
// alone did NOT resolve the reported symptom — the union check correctly
// found nothing in a truly empty matrix. Fixing the defaulting gap resolves
// the literal repro outright: DEFAULT_TOOL_MATRIX owns 'phone' at home, so
// this task places even under the OLD (pre-ANY-LOCATION) single-location
// check, once the empty '{}' correctly falls back to the default.
// ═══════════════════════════════════════════════════════════════════════════
describe('999.1599 DEV-DB REPRO SHAPE — tool_matrix persisted as {} (real assembleSchedulerCfg pipeline)', () => {
  function row(key, value) {
    return { config_key: key, config_value: JSON.stringify(value) };
  }

  test('task with the literal dev-DB row shape (recur WRFM tpc=1, location=[], tools=["phone"], tool_matrix={}) now PLACES, not tool_conflict', () => {
    const TODAY = '2026-07-13'; // Monday — matches instance -35's anchor date
    const NOW_MINS = 400;

    // Real assembly path: rows exactly like the dev-DB user_config table
    // (tool_matrix row PRESENT with value '{}' — not an absent row).
    var cfg = assembleSchedulerCfg(parseUserConfigRows([
      row('time_blocks', DEFAULT_TIME_BLOCKS),
      row('tool_matrix', {})
    ]), []);
    // Sanity: the defaulting fix actually engaged (not silently still {}).
    expect(Object.keys(cfg.toolMatrix).length).toBeGreaterThan(0);
    expect(cfg.toolMatrix.home).toContain('phone');

    var task = {
      id: 't1776649350872m2xp-35', text: 'Submit Weekly UI Claim',
      date: TODAY, status: '', when: 'morning,lunch,afternoon,biz',
      dayReq: 'any', dependsOn: [], location: [], tools: ['phone'],
      dur: 15, pri: 'P2',
      recurring: true, recur: { type: 'weekly', days: 'WRFM', timesPerCycle: 1, fillPolicy: 'backfill' },
      placementMode: 'time_blocks',
      earliestStart: TODAY, deadline: null,
      split: false, datePinned: false, generated: false, section: '', flexWhen: false
    };
    var statuses = { [task.id]: '' };
    var result = unifiedSchedule([task], statuses, TODAY, NOW_MINS, cfg);

    var unplacedItem = (result.unplaced || []).find(function(t) { return t && t.id === task.id; });
    if (unplacedItem) {
      throw new Error('Expected the dev-DB repro shape to PLACE now that tool_matrix={} defaults to '
        + 'DEFAULT_TOOL_MATRIX, but it stayed unplaced: '
        + JSON.stringify({ reason: unplacedItem._unplacedReason, detail: unplacedItem._unplacedDetail }));
    }
    var placed = [];
    Object.keys(result.dayPlacements || {}).forEach(function(dk) {
      (result.dayPlacements[dk] || []).forEach(function(p) {
        if (p.task && p.task.id === task.id) placed.push({ dateKey: dk, start: p.start });
      });
    });
    expect(placed.length).toBeGreaterThanOrEqual(1);
  });
});

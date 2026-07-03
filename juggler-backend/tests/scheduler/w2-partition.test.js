/**
 * W2 partition — OVERDUE | UNPLACEABLE | PLACED are mutually exclusive.
 *
 * Canonical ruling: DESIGN-RULING-overdue-vs-unplaceable.md (David 2026-06-22).
 * SPEC: .planning/kermit/juggler-w2-partition/SPEC.md (AC-W2.1, AC-W2.3).
 *
 * The bug: a TIME_WINDOW task whose flex window is entirely past *today*
 * (`isMissedWindow`, unifiedScheduleV2.js:400-402) is **dual-placed** — it lands
 * on the grid (`_overdue`) AND in `unplaced[]` (missedWindowItems, :2102-2126).
 * That violates the placed-XOR-unplaced invariant.
 *
 * Correct (deadline-based partition):
 *   - past-deadline + can't re-slot that date  -> OVERDUE: on grid, pinned, NOT in unplaced[].
 *   - pre-deadline  + crowded out now          -> UNPLACEABLE: in unplaced[], NOT on grid.
 * Discriminator = the deadline, NOT "window past today".
 *
 * Layer: unit (pure unifiedScheduleV2 in-process; no DB).
 */
'use strict';

process.env.NODE_ENV = 'test';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

const TODAY = '2026-06-22';
const TOMORROW = '2026-06-23';
const TZ = 'America/New_York';

function makeCfg(overrides) {
  return Object.assign({
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    timezone: TZ,
  }, overrides || {});
}

// A TIME_WINDOW task whose window [pref-flex, pref+flex] is entirely BEFORE nowMins today.
// pref=8:00 (480), flex=60 -> window [420,540]; nowMins=600 (10:00) -> windowHi(540) <= now(600)
// => isMissedWindow=true on the current code.
function makeMissedWindowTask(overrides) {
  return Object.assign({
    id: 'mw_task',
    text: 'Missed-window TIME_WINDOW task',
    date: TODAY,
    dur: 30,
    pri: 'P2',
    when: 'work',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: false,
    generated: false,
    split: false,
    section: '',
    placementMode: PLACEMENT_MODES.TIME_WINDOW,
    preferredTimeMins: 480,
    timeFlex: 60,
    time: undefined,
    scheduledAt: undefined,
    tz: TZ,
  }, overrides || {});
}

function run(tasks, nowMins) {
  const statuses = {};
  tasks.forEach((t) => { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, nowMins, makeCfg());
}

function idsOnGrid(result) {
  const ids = new Set();
  Object.keys(result.dayPlacements || {}).forEach((dk) => {
    (result.dayPlacements[dk] || []).forEach((p) => {
      if (p && p.task && p.task.id) ids.add(p.task.id);
    });
  });
  return ids;
}
function idsUnplaced(result) {
  const ids = new Set();
  (result.unplaced || []).forEach((u) => {
    const id = u && (u.id || (u.task && u.task.id));
    if (id) ids.add(id);
  });
  return ids;
}
function gridEntriesForId(result, taskId) {
  const found = [];
  Object.keys(result.dayPlacements || {}).forEach((dk) => {
    (result.dayPlacements[dk] || []).forEach((p) => {
      if (p && p.task && p.task.id === taskId) found.push(Object.assign({ dateKey: dk }, p));
    });
  });
  return found;
}

describe('W2 partition — placed XOR unplaced (AC-W2.3) + deadline-based partition (AC-W2.1)', () => {
  // CHARACTERIZATION (not a regression guard): a NON-recurring TIME_WINDOW missed-window task
  // never entered the recurring dual-place branch, so the partition was already correct for it —
  // these two pass on pre-fix code. The real regression guard is the RECURRING test below
  // ('AC-W2.3 (recurring)'), which IS RED on pre-fix code (zoe WARN-2, 2026-06-23).
  test('AC-W2.3 (non-recurring, characterization): no task in BOTH grid and unplaced[]', () => {
    const result = run([makeMissedWindowTask()], 600); // now = 10:00, window past
    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);
    const both = [...onGrid].filter((id) => unplaced.has(id));
    expect(both).toEqual([]);
  });

  // D-A SCOPE NOTE (leg sched-audit, 2026-07-02, Kermit ruling — recorded here
  // per bert's REFER→telly, DA-DC-BERT-LOG.md finding #23): David's D-A
  // one-off ruling (a one-off past its deadline/missed window routes to
  // unplaced, never rolled forward) is gated in production on
  // `item.deadlineDate` (unifiedScheduleV2.js findEarliestSlot's
  // `capAtOwnDeadline` branch + the `stillUnplaced` date-pin pass both
  // early-return when `!deadlineDate`). `makeMissedWindowTask` above (:42-66)
  // sets NO `deadline` field at all — a pure when-tag/window task, not a
  // deadline-bearing one-off — so neither D-A code path engages here, BY
  // DESIGN, not by accident (confirmed: this test stayed GREEN, unchanged,
  // across the D-A fix). This test pins the DEADLINE-LESS one-off contract:
  // with nothing to be overdue AGAINST (no deadline to violate) the task
  // CANNOT be overdue — it rolls forward to a later, still-open day and lands
  // there un-marked, exactly like any other legally-rescheduled task. Kermit
  // ruling: D-A's scope is strictly the deadline-bearing one-off case (see
  // sched-audit-da-oneoff.test.js D-A1/D-A2 and deadlines.test.js TS-133 for
  // that contract); it does NOT extend to a task with no deadline at all.
  //
  // CORRECTION (zoe DADC-ZOE-REVIEW.md z-2, leg sched-audit): the name and
  // the paragraph above previously claimed this task "reads OVERDUE on grid" —
  // that is factually wrong. Direct probe (makeMissedWindowTask, deadline-less,
  // now=600) shows it lands on 2026-06-23 (TOMORROW, a future day) with
  // `_overdue` undefined/falsy. A task rolled to a future window is on-time
  // for that window, not overdue. The two ORIGINAL assertions below (onGrid
  // true / unplaced false) verified neither the roll-FORWARD direction nor
  // the NOT-overdue state — a task placed TODAY un-marked would also have
  // passed them. Renamed + strengthened with the missing shape assertions so
  // name==assertions.
  test('AC-W2.1 (non-recurring, DEADLINE-LESS one-off, characterization): missed-window task with no deadline is placed on a LATER day, NOT overdue-marked (nothing to be overdue against)', () => {
    const result = run([makeMissedWindowTask()], 600);
    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);
    expect(onGrid.has('mw_task')).toBe(true);     // placed somewhere on the grid
    expect(unplaced.has('mw_task')).toBe(false);  // never in unplaced[] (XOR holds)

    // Shape assertions (z-2): rolled to a FUTURE day (not today, not left in
    // the past), and NOT overdue-marked — the actual probed behavior.
    const entries = gridEntriesForId(result, 'mw_task');
    expect(entries.length).toBe(1);
    expect(entries[0].dateKey).toBe(TOMORROW);
    expect(entries[0].dateKey).not.toBe(TODAY);
    expect(entries[0]._overdue).toBeFalsy();
  });

  // AC-W2.3 (recurring) — the :2098 dual-place path is described for a RECURRING missed-window
  // task with a when-block (appears in unplaced AND grid). Assert disjointness for that case too.
  test('AC-W2.3 (recurring): recurring missed-window task not in BOTH grid and unplaced[]', () => {
    const t = makeMissedWindowTask({ id: 'mw_recur', recurring: true });
    const result = run([t], 600);
    const both = [...idsOnGrid(result)].filter((id) => idsUnplaced(result).has(id));
    expect(both).toEqual([]); // characterizes the recurring dual-place path
  });
});

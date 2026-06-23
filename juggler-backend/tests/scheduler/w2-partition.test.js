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

describe('W2 partition — placed XOR unplaced (AC-W2.3) + deadline-based partition (AC-W2.1)', () => {
  // AC-W2.3 — the disjointness invariant. The dual-place path violates this.
  test('AC-W2.3: no task appears in BOTH dayPlacements and unplaced[]', () => {
    const result = run([makeMissedWindowTask()], 600); // now = 10:00, window past
    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);
    const both = [...onGrid].filter((id) => unplaced.has(id));
    expect(both).toEqual([]); // RED today: 'mw_task' is in both
  });

  // AC-W2.1 — a missed-window (deadline-past, can't re-slot today) task is OVERDUE on the
  // grid only, never also in unplaced[].
  test('AC-W2.1: missed-window task is OVERDUE on grid only, NOT in unplaced[]', () => {
    const result = run([makeMissedWindowTask()], 600);
    const onGrid = idsOnGrid(result);
    const unplaced = idsUnplaced(result);
    expect(onGrid.has('mw_task')).toBe(true);     // pinned on its day
    expect(unplaced.has('mw_task')).toBe(false);  // RED today: it is ALSO unplaced
  });
});

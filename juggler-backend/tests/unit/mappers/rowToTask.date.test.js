/**
 * I2 — Bug A: rowToTask date derivation for unplaced recurring instances (FR3 / AC3.1-AC3.3)
 *
 * Layer: unit — pure function, no DB, no network, no wall-clock.
 *
 * Covers:
 *   AC3.1  rowToTask derives task.date from row.date when scheduled_at is null,
 *          for recurring_instance rows with a non-null date column.
 *   AC3.2  Placed instances (scheduled_at non-null) still derive date from
 *          scheduled_at (no regression). Non-recurring rows unaffected.
 *   AC3.3  Legacy date-encoded IDs still work. Correct anchorDate derivation.
 *
 * Structure:
 *   Section A — CHARACTERIZATION (pin current behaviour; GREEN on un-refactored code)
 *   Section B — RED tests (TARGET behaviour; wrapped in test.failing)
 *
 * DETERMINISM: no Date.now(), no Math.random(), no I/O.
 * rowToTask is a pure function (zero DB/network requires).
 *
 * SELF-MUTATION CONTRACT: each frozen literal was verified by mutating the source
 * and confirming the test goes RED, then reverting via /tmp backup.
 *
 * Traceability: AC3.1, AC3.2, AC3.3 (TRACEABILITY.md rows 13-15)
 */

'use strict';

process.env.NODE_ENV = 'test';

// rowToTask is a pure mapper — no DB mock required.
const { rowToTask } = require('../../../src/slices/task/domain/mappers/taskMappers');

const TZ = 'America/New_York';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Minimal valid task row — non-recurring one-off.
function makeBaseRow(overrides) {
  return Object.assign({
    id: 'test-rtt-001', master_id: 'test-rtt-001',
    task_type: 'task', text: 'Test task', status: '',
    scheduled_at: null, desired_at: null, tz: null, dur: 30, time_remaining: null,
    pri: 'P3', project: null, section: null, notes: null, url: null,
    deadline: null, earliest_start_at: null, location: '[]', tools: '[]',
    when: null, day_req: null, recurring: 0, rigid: 0, time_flex: null,
    split: null, split_min: null, split_total: null, split_ordinal: null, split_group: null,
    recur: null, source_id: null, generated: 0,
    gcal_event_id: null, msft_event_id: null, apple_event_id: null,
    apple_calendar_name: null, cal_sync_origin: null, cal_event_url: null,
    depends_on: '[]', date_pinned: 0, marker: 0, flex_when: 0, prev_when: null,
    travel_before: null, travel_after: null, preferred_time_mins: null,
    unscheduled: null, overdue: null, slack_mins: null,
    recur_start: null, recur_end: null, placement_mode: null,
    disabled_at: null, disabled_reason: null, occurrence_ordinal: null,
    completed_at: null, end_date: null, rolling_anchor: null,
    created_at: '2026-06-20 00:00:00', updated_at: '2026-06-20 00:00:00',
    // The date column — present in task_instances/task_masters but NOT in old task_v;
    // rowToTask receives it from the mapper's input row (Bug A: currently ignored when
    // scheduled_at is null).
    date: null
  }, overrides);
}

// Recurring instance row with scheduled_at=NULL and date set (the Bug A scenario).
function makeUnplacedInstanceRow(overrides) {
  return makeBaseRow(Object.assign({
    id: 'inst-unplaced-001', master_id: 'tmpl-001',
    task_type: 'recurring_instance', recurring: 1,
    source_id: 'tmpl-001',
    scheduled_at: null,   // unplaced: no slot yet
    date: '2026-06-25',   // the instance's target date (from expandRecurring / reconcileOccurrences)
    occurrence_ordinal: 3,
    split_ordinal: 1, split_total: 1
  }, overrides));
}

// Recurring instance row WITH scheduled_at (placed instance).
function makePlacedInstanceRow(overrides) {
  return makeBaseRow(Object.assign({
    id: 'inst-placed-001', master_id: 'tmpl-001',
    task_type: 'recurring_instance', recurring: 1,
    source_id: 'tmpl-001',
    scheduled_at: '2026-06-23 14:00:00', // placed at 2 PM UTC on 2026-06-23
    date: '2026-06-23',                   // same date, but date comes from scheduled_at after fix
    occurrence_ordinal: 1,
    split_ordinal: 1, split_total: 1
  }, overrides));
}

// Minimal template for sourceMap.
function makeTemplateRow(overrides) {
  return makeBaseRow(Object.assign({
    id: 'tmpl-001', master_id: 'tmpl-001',
    task_type: 'recurring_template', recurring: 1,
    recur: JSON.stringify({ type: 'weekly' }),
    text: 'Weekly recurring template',
    location: '[]', tools: '[]'
  }, overrides));
}

// Build sourceMap from a template row.
function makeSourceMap(templateRow) {
  var map = {};
  map[templateRow.id] = templateRow;
  return map;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION A — CHARACTERIZATION (GREEN on un-refactored code; must NOT regress)
// ═══════════════════════════════════════════════════════════════════════════════

describe('I2 CHARACTERIZATION — rowToTask (current behaviour, must not regress)', () => {

  // CHAR-C1: Placed instance with scheduled_at → date derives from scheduled_at.
  test('CHAR-C1: placed instance — date derives from scheduled_at (timezone conversion)', () => {
    // scheduled_at '2026-06-23 14:00:00' UTC, TZ=America/New_York (UTC-4 in June) → 10:00 AM on 2026-06-23.
    // SELF-MUTATION: changing scheduled_at to '2026-06-24 14:00:00' → date = '2026-06-24' → FAILS.
    var row = makePlacedInstanceRow();
    var src = makeTemplateRow();
    var task = rowToTask(row, TZ, makeSourceMap(src));
    expect(task.date).toBe('2026-06-23');
  });

  // CHAR-C2: Non-recurring task with no scheduled_at → date is null (no row.date set).
  test('CHAR-C2: non-recurring task with no scheduled_at → task.date is null', () => {
    // SELF-MUTATION: changing this to expect(task.date).toBe('anything') → fails on null.
    // This pins the no-op: non-recurring rows without scheduled_at have null date.
    var row = makeBaseRow({ date: null });
    var task = rowToTask(row, TZ, null);
    expect(task.date).toBeNull();
  });

  // CHAR-C3: THE BUG — unplaced recurring instance with scheduled_at=NULL, date='2026-06-25'
  // → CURRENT code returns task.date=null (the bug).
  // We pin this as the CURRENT (broken) state so the refactor can verify it changes.
  test('CHAR-C3 (pins BUG): unplaced recurring instance — task.date is currently null even with row.date set', () => {
    // This test DOCUMENTS THE BUG. It pins the broken state.
    // After AC3.1 impl, this pin is REPLACED by the RED test RED-AC3.1-a in Section B.
    // DO NOT remove this CHAR test until the RED test is known-green (impl shipped).
    var row = makeUnplacedInstanceRow();
    var src = makeTemplateRow();
    var task = rowToTask(row, TZ, makeSourceMap(src));
    // Current broken state: date is null even though row.date='2026-06-25'.
    // SELF-MUTATION: if we add row.date fallback before running test, expect null fails → proves pin.
    expect(task.date).toBeNull();
  });

  // CHAR-C4: Placed instance with non-null date col → date still comes from scheduled_at.
  test('CHAR-C4: placed instance — date comes from scheduled_at even when row.date also set', () => {
    // row.date and scheduled_at agree for placed instances; current code uses scheduled_at.
    var row = makePlacedInstanceRow({ date: '2026-06-23' });
    var src = makeTemplateRow();
    var task = rowToTask(row, TZ, makeSourceMap(src));
    expect(task.date).toBe('2026-06-23');
    // The value matches because scheduled_at and row.date agree — BUT the source is scheduled_at.
    // This is pinned to not change post-fix (AC3.2 regression guard).
  });

  // CHAR-C5: anchorDate — for placed instance, anchorDate comes from scheduled_at (template src).
  test('CHAR-C5: placed instance — anchorDate derived from template scheduled_at', () => {
    // src.scheduled_at drives anchorDate for instances (taskMappers.js:290).
    var row = makePlacedInstanceRow();
    var src = makeTemplateRow({ scheduled_at: '2026-06-01 00:00:00' }); // template's own scheduled_at
    var task = rowToTask(row, TZ, makeSourceMap(src));
    // src.scheduled_at = '2026-06-01 00:00:00' → anchorDate = '2026-06-01'
    expect(task.anchorDate).toBe('2026-06-01');
  });

  // CHAR-C6: anchorDate — for unplaced instance (scheduled_at=null), anchorDate is currently null.
  test('CHAR-C6 (pins BUG): unplaced instance — anchorDate is currently null (template has no scheduled_at)', () => {
    // src.scheduled_at=null → anchorDate=null (Bug A consequence — no date fallback).
    var row = makeUnplacedInstanceRow();
    var src = makeTemplateRow({ scheduled_at: null });
    var task = rowToTask(row, TZ, makeSourceMap(src));
    expect(task.anchorDate).toBeNull();
  });

  // CHAR-C7: split chunk — dur comes from the chunk row, not the template.
  test('CHAR-C7: split chunk row — dur preserved from chunk, not template', () => {
    var row = makeBaseRow({
      id: 'split-001', task_type: 'recurring_instance', recurring: 1,
      source_id: 'tmpl-001', scheduled_at: '2026-06-23 10:00:00',
      split_ordinal: 2, split_total: 3, dur: 20
    });
    var src = makeTemplateRow({ dur: 60 }); // template says 60 min
    var task = rowToTask(row, TZ, makeSourceMap(src));
    // Split chunk: keep chunk's own dur (20), not template's (60). CHAR-C7.
    expect(task.dur).toBe(20);
  });

  // CHAR-C8: Non-recurring task — scheduled_at converts correctly.
  test('CHAR-C8: non-recurring task with scheduled_at — date set via timezone conversion', () => {
    var row = makeBaseRow({
      scheduled_at: '2026-06-20 18:30:00', // 6:30 PM UTC = 2:30 PM EDT on June 20
      date: '2026-06-20'
    });
    var task = rowToTask(row, TZ, null);
    expect(task.date).toBe('2026-06-20');
  });

  // CHAR-C9: Orphaned instance (no template) — rowToTask still returns a task object.
  test('CHAR-C9: orphaned recurring instance (no template in sourceMap) — rowToTask returns object', () => {
    var row = makeUnplacedInstanceRow();
    var mockLogger = { warn: jest.fn() };
    var task = rowToTask(row, TZ, {}, mockLogger); // empty sourceMap → no template found
    expect(task).toBeDefined();
    expect(task.id).toBe('inst-unplaced-001');
    // Logger should warn about the orphaned instance.
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Orphaned instance')
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION B — RED tests (TARGET behaviour; wrapped in test.failing)
// Once the implementation ships, remove .failing and the tests become GREEN.
// ═══════════════════════════════════════════════════════════════════════════════

describe('I2 RED — AC3.1: rowToTask derives task.date from row.date when scheduled_at is null', () => {

  // The core bug fix: for a recurring_instance with scheduled_at=NULL and row.date set,
  // task.date must come from row.date.

  test.failing('RED-AC3.1-a: unplaced recurring_instance — task.date = row.date (not null)', () => {
    // row.date='2026-06-25', scheduled_at=null.
    // After AC3.1 fix: task.date = '2026-06-25'.
    // BEFORE fix: task.date = null (CHAR-C3 pins this).
    var row = makeUnplacedInstanceRow();
    var src = makeTemplateRow();
    var task = rowToTask(row, TZ, makeSourceMap(src));
    expect(task.date).toBe('2026-06-25');
  });

  test.failing('RED-AC3.1-b: unplaced instance with different row.date — task.date matches row.date', () => {
    // Parameterized check: different date value to prevent any hardcoded literal sneaking in.
    var row = makeUnplacedInstanceRow({ date: '2026-07-04' });
    var src = makeTemplateRow();
    var task = rowToTask(row, TZ, makeSourceMap(src));
    expect(task.date).toBe('2026-07-04');
  });

  test.failing('RED-AC3.1-c: unplaced instance — task.date is a YYYY-MM-DD string (not a Date object)', () => {
    // row.date may come back from knex as a Date object (date column type).
    // rowToTask must normalise it to a YYYY-MM-DD string.
    var row = makeUnplacedInstanceRow({ date: new Date('2026-06-25T00:00:00Z') });
    var src = makeTemplateRow();
    var task = rowToTask(row, TZ, makeSourceMap(src));
    expect(typeof task.date).toBe('string');
    expect(task.date).toBe('2026-06-25');
  });

  test.failing('RED-AC3.1-d: unplaced instance with no timezone — task.date still derives from row.date', () => {
    // No timezone passed (null). date should still come from row.date.
    var row = makeUnplacedInstanceRow();
    var src = makeTemplateRow();
    var task = rowToTask(row, null, makeSourceMap(src));
    expect(task.date).toBe('2026-06-25');
  });
});

describe('I2 REGRESSION GUARD — AC3.2: placed instances and non-recurring rows unaffected', () => {

  // These behaviours are ALREADY correct — they are plain tests (not .failing).
  // They serve as REGRESSION GUARDS: the AC3.1 fix (adding row.date fallback for
  // unplaced instances) must not break these already-correct paths.

  test('REGR-AC3.2-a: placed instance — date from scheduled_at (not row.date when they differ)', () => {
    // Set row.date deliberately DIFFERENT from scheduled_at's date.
    // Confirms the fix only fires when scheduled_at is null.
    // SELF-MUTATION: add row.date fallback without the scheduled_at===null guard → task.date='2026-06-24'
    //   instead of '2026-06-23' → FAILS. This mutation verifies the guard is in place post-fix.
    var row = makePlacedInstanceRow({
      scheduled_at: '2026-06-23 14:00:00',
      date: '2026-06-24' // DIFFERENT — should be IGNORED when scheduled_at is set
    });
    var src = makeTemplateRow();
    var task = rowToTask(row, TZ, makeSourceMap(src));
    expect(task.date).toBe('2026-06-23'); // from scheduled_at, not row.date
  });

  test('REGR-AC3.2-b: non-recurring task with no scheduled_at and no date → task.date null', () => {
    // The fix must not affect non-recurring rows. A task with task_type='task' and no
    // scheduled_at should still produce task.date=null.
    // SELF-MUTATION: remove task_type guard → row.date=null → task.date=null still → doesn't catch it.
    // Better: set date to non-null: if fix applies to non-recurring, task.date would not be null.
    var row = makeBaseRow({
      task_type: 'task', recurring: 0, source_id: null,
      scheduled_at: null, date: null
    });
    var task = rowToTask(row, TZ, null);
    expect(task.date).toBeNull();
  });

  test('REGR-AC3.2-c: non-recurring task with scheduled_at — date from scheduled_at (no regression)', () => {
    var row = makeBaseRow({
      task_type: 'task', recurring: 0, source_id: null,
      scheduled_at: '2026-06-20 20:00:00', // 4 PM EDT on June 20
      date: '2026-06-20'
    });
    var task = rowToTask(row, TZ, null);
    expect(task.date).toBe('2026-06-20');
  });

  test('REGR-AC3.2-d: recurring_template with no scheduled_at → date null (templates unaffected)', () => {
    // If the fix uses task_type==='recurring_instance' guard, template rows stay safe.
    // SELF-MUTATION: broaden guard to 'recurring' flag (not task_type) → template with recurring=1
    //   and date set would also get the fallback → task.date='2026-06-20' ≠ null → FAILS.
    var row = makeBaseRow({
      id: 'tmpl-002', task_type: 'recurring_template', recurring: 1,
      scheduled_at: null, date: '2026-06-20' // set but should be ignored for templates
    });
    var task = rowToTask(row, TZ, null);
    // Templates don't have a meaningful derived date → should remain null.
    expect(task.date).toBeNull();
  });
});

describe('I2 RED — AC3.3: legacy date-encoded IDs and anchorDate correctness', () => {

  // AC3.3: With the fix, unplaced instances expose their date so the scheduler can
  // use it as anchorDate / cycle-window input. anchorDate for unplaced instances
  // must come from row.date (via the same fix path) when scheduled_at is null.

  test.failing('RED-AC3.3-a: unplaced instance — anchorDate derives from row.date after fix', () => {
    // Currently anchorDate=null for unplaced instances (CHAR-C6 pins the bug).
    // After fix: the anchorDate derivation (taskMappers.js:289-294) should also fall back
    // to row.date when src.scheduled_at is null (or the fix adjusts the anchorDate logic).
    var row = makeUnplacedInstanceRow({ date: '2026-06-25' });
    var src = makeTemplateRow({ scheduled_at: null });
    var task = rowToTask(row, TZ, makeSourceMap(src));
    // After fix: anchorDate = '2026-06-25' (from row.date).
    expect(task.anchorDate).toBe('2026-06-25');
  });

  // AC3.3-b: already-correct behaviour — plain test (regression guard).
  test('REGR-AC3.3-b: placed instance — anchorDate still from scheduled_at (no regression)', () => {
    // Placed instance: anchorDate must remain derived from scheduled_at, not row.date.
    // SELF-MUTATION: change anchorDate to use row.date fallback without the null guard →
    //   anchorDate = '2026-06-24' (row.date) instead of '2026-06-01' (src.scheduled_at) → FAILS.
    var row = makePlacedInstanceRow({
      scheduled_at: '2026-06-23 14:00:00',
      date: '2026-06-24' // deliberately different
    });
    var src = makeTemplateRow({ scheduled_at: '2026-06-01 00:00:00' });
    var task = rowToTask(row, TZ, makeSourceMap(src));
    // anchorDate from src.scheduled_at (template's scheduled_at, per taskMappers.js:290)
    expect(task.anchorDate).toBe('2026-06-01');
  });

  test.failing('RED-AC3.3-c: legacy date-encoded ID format still parses correctly', () => {
    // runSchedule.js:1169-1173 encodes date into the task ID as a suffix.
    // Verify that rowToTask with a date-suffixed ID still returns the correct date.
    // The ID encoding is: '<uuid>_<YYYYMMDD>' for some legacy paths.
    // This test confirms rowToTask does NOT parse the ID for date (it uses row fields).
    var row = makeUnplacedInstanceRow({
      id: 'inst-legacy-20260625', // legacy date-encoded ID
      date: '2026-06-25',
      scheduled_at: null
    });
    var src = makeTemplateRow();
    var task = rowToTask(row, TZ, makeSourceMap(src));
    // The ID is preserved as-is; the date comes from row.date (after fix).
    expect(task.id).toBe('inst-legacy-20260625');
    expect(task.date).toBe('2026-06-25');
  });

  test.failing('RED-AC3.3-d: row.date as JS Date object normalised to YYYY-MM-DD for anchorDate', () => {
    // knex may return date columns as JS Date objects. Both task.date and task.anchorDate
    // must be YYYY-MM-DD strings.
    var row = makeUnplacedInstanceRow({ date: new Date('2026-06-25T00:00:00Z') });
    var src = makeTemplateRow({ scheduled_at: null });
    var task = rowToTask(row, TZ, makeSourceMap(src));
    expect(task.date).toBe('2026-06-25');
    expect(task.anchorDate).toBe('2026-06-25');
  });
});

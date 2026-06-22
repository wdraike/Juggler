/**
 * W1 — DB-single-source: rowToTask maps unplaced_reason/detail from the DB row.
 *
 * Covers TRACEABILITY W1:
 *   taskMappers.rowToTask maps row.unplaced_reason / row.unplaced_detail
 *   → task._unplacedReason / task._unplacedDetail (null when absent).
 *
 * PURE unit — no DB, no I/O. All inputs are plain fake rows.
 *
 * Requirement: W1 DB-single-source — the Unplaced view reads the persisted
 * reason from the DB row rather than the deleted in-memory placements cache.
 * The mapper is the read-model bridge: DB col → domain field.
 */

'use strict';

process.env.NODE_ENV = 'test';

const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb } = createMockChainDb();
jest.mock('../../src/db', () => mockDb);
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

const { rowToTask } = require('../../src/slices/task/domain/mappers/taskMappers');

/**
 * Minimal valid task_instances-shaped row. Matches the shape tasks_v exposes.
 */
function makeRow(overrides) {
  return Object.assign({
    id: 'w1-test-task-001',
    master_id: 'w1-test-task-001',
    user_id: 'w1-test-user',
    task_type: 'task',
    text: 'W1 test task',
    status: '',
    scheduled_at: null,
    desired_at: null,
    tz: null,
    dur: 30,
    time_remaining: null,
    pri: 'P3',
    project: null,
    section: null,
    notes: null,
    url: null,
    deadline: null,
    earliest_start_at: null,
    location: '[]',
    tools: '[]',
    when: null,
    day_req: null,
    recurring: 0,
    rigid: 0,
    time_flex: null,
    split: null,
    split_min: null,
    split_total: null,
    split_ordinal: null,
    split_group: null,
    recur: null,
    source_id: null,
    generated: 0,
    gcal_event_id: null,
    msft_event_id: null,
    apple_event_id: null,
    apple_calendar_name: null,
    cal_sync_origin: null,
    cal_event_url: null,
    depends_on: '[]',
    date_pinned: 0,
    marker: 0,
    flex_when: 0,
    prev_when: null,
    travel_before: null,
    travel_after: null,
    preferred_time_mins: null,
    unscheduled: null,
    overdue: null,
    slack_mins: null,
    recur_start: null,
    recur_end: null,
    placement_mode: null,
    disabled_at: null,
    disabled_reason: null,
    occurrence_ordinal: null,
    completed_at: null,
    end_date: null,
    rolling_anchor: null,
    // W1 new columns:
    unplaced_reason: null,
    unplaced_detail: null,
    created_at: '2026-06-22 00:00:00',
    updated_at: '2026-06-22 00:00:00'
  }, overrides);
}

// ── AC1: null when absent (placed row) ────────────────────────────────────────

describe('W1 — rowToTask unplaced_reason/detail mapping', () => {
  describe('AC1: placed row — both fields null', () => {
    test('AC1-a: row.unplaced_reason=null → task._unplacedReason=null', () => {
      const task = rowToTask(makeRow({ unplaced_reason: null }), null, {});
      expect(task._unplacedReason).toBeNull();
    });

    test('AC1-b: row.unplaced_detail=null → task._unplacedDetail=null', () => {
      const task = rowToTask(makeRow({ unplaced_detail: null }), null, {});
      expect(task._unplacedDetail).toBeNull();
    });

    test('AC1-c: row missing both W1 cols (view not yet migrated shape) → both null', () => {
      // Simulate pre-migration view (tasks_v row has no unplaced_reason col at all).
      const row = makeRow();
      delete row.unplaced_reason;
      delete row.unplaced_detail;
      const task = rowToTask(row, null, {});
      expect(task._unplacedReason).toBeNull();
      expect(task._unplacedDetail).toBeNull();
    });
  });

  // ── AC2: reason present (unplaced row) ─────────────────────────────────────

  describe('AC2: unplaced row — reason mapped through', () => {
    test('AC2-a: tool_conflict reason surfaced', () => {
      const task = rowToTask(makeRow({
        unplaced_reason: 'tool_conflict',
        unplaced_detail: 'needs personal_pc; biz-day context blocks it'
      }), null, {});
      expect(task._unplacedReason).toBe('tool_conflict');
      expect(task._unplacedDetail).toBe('needs personal_pc; biz-day context blocks it');
    });

    test('AC2-b: missed reason surfaced', () => {
      const task = rowToTask(makeRow({
        unplaced_reason: 'missed',
        unplaced_detail: 'window has passed'
      }), null, {});
      expect(task._unplacedReason).toBe('missed');
      expect(task._unplacedDetail).toBe('window has passed');
    });

    test('AC2-c: recurring_split_overflow reason surfaced', () => {
      const task = rowToTask(makeRow({
        unplaced_reason: 'recurring_split_overflow',
        unplaced_detail: null
      }), null, {});
      expect(task._unplacedReason).toBe('recurring_split_overflow');
      expect(task._unplacedDetail).toBeNull();
    });

    test('AC2-d: tpc_budget reason surfaced (full detail string)', () => {
      const task = rowToTask(makeRow({
        unplaced_reason: 'tpc_budget',
        unplaced_detail: 'no remaining capacity in time-preference window'
      }), null, {});
      expect(task._unplacedReason).toBe('tpc_budget');
      expect(task._unplacedDetail).toContain('capacity');
    });
  });

  // ── AC3: empty string coerced to null (|| null guard) ────────────────────

  describe('AC3: empty string in DB → null (the || null guard)', () => {
    test('AC3-a: unplaced_reason="" → _unplacedReason=null', () => {
      // MySQL VARCHAR('') reads as empty string. The `|| null` guard coerces to null.
      const task = rowToTask(makeRow({ unplaced_reason: '' }), null, {});
      expect(task._unplacedReason).toBeNull();
    });

    test('AC3-b: unplaced_detail="" → _unplacedDetail=null', () => {
      const task = rowToTask(makeRow({ unplaced_detail: '' }), null, {});
      expect(task._unplacedDetail).toBeNull();
    });
  });

  // ── AC4: recurring_instance rows carry the fields through ─────────────────

  describe('AC4: recurring_instance row with unplaced reason', () => {
    test('AC4-a: recurring instance unplaced — reason and detail surfaced', () => {
      const task = rowToTask(makeRow({
        id: 'w1-inst-001',
        master_id: 'w1-tmpl-001',
        task_type: 'recurring_instance',
        recurring: 1,
        source_id: 'w1-tmpl-001',
        scheduled_at: null,
        occurrence_ordinal: 1,
        split_ordinal: 1,
        split_total: 1,
        unplaced_reason: 'location_conflict',
        unplaced_detail: 'requires home; context is work'
      }), null, {});
      expect(task._unplacedReason).toBe('location_conflict');
      expect(task._unplacedDetail).toBe('requires home; context is work');
    });

    test('AC4-b: recurring instance placed — both null', () => {
      const task = rowToTask(makeRow({
        id: 'w1-inst-002',
        master_id: 'w1-tmpl-001',
        task_type: 'recurring_instance',
        recurring: 1,
        source_id: 'w1-tmpl-001',
        scheduled_at: '2026-06-22 09:00:00',
        occurrence_ordinal: 2,
        split_ordinal: 1,
        split_total: 1,
        unplaced_reason: null,
        unplaced_detail: null
      }), null, {});
      expect(task._unplacedReason).toBeNull();
      expect(task._unplacedDetail).toBeNull();
    });
  });
});

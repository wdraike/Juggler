/**
 * W1 — DB-single-source: tasks-write INSTANCE_UPDATE_FIELDS routing.
 *
 * Covers TRACEABILITY W1:
 *   A changes object containing unplaced_reason/unplaced_detail must reach
 *   the instance update path (not be silently dropped by the field-routing
 *   allowlist). Before W1 these fields were absent from INSTANCE_UPDATE_FIELDS
 *   and were SILENTLY DROPPED.
 *
 * PURE unit — splitUpdateFields() is a deterministic pure function.
 * No DB, no I/O, no mocks needed.
 *
 * Requirement: W1 DB-single-source — scheduler persist path must be able
 * to write unplaced_reason/detail onto task_instances via updateTaskById.
 */

'use strict';

const { splitUpdateFields } = require('../../src/lib/tasks-write');

describe('W1 — tasks-write INSTANCE_UPDATE_FIELDS routing for unplaced_reason/detail', () => {

  // ── AC1: fields reach instance (not dropped) ───────────────────────────────

  describe('AC1: unplaced_reason/detail routed to instance update', () => {
    test('AC1-a: unplaced_reason routed to instance', () => {
      const { instance } = splitUpdateFields({ unplaced_reason: 'tool_conflict' });
      expect(instance.unplaced_reason).toBe('tool_conflict');
    });

    test('AC1-b: unplaced_detail routed to instance', () => {
      const { instance } = splitUpdateFields({ unplaced_detail: 'needs personal_pc' });
      expect(instance.unplaced_detail).toBe('needs personal_pc');
    });

    test('AC1-c: both fields together routed to instance', () => {
      const { instance } = splitUpdateFields({
        unplaced_reason: 'missed',
        unplaced_detail: 'window has passed'
      });
      expect(instance.unplaced_reason).toBe('missed');
      expect(instance.unplaced_detail).toBe('window has passed');
    });

    test('AC1-d: null values (clearing reason on transition to placed) routed to instance', () => {
      const { instance } = splitUpdateFields({
        unplaced_reason: null,
        unplaced_detail: null
        // `overdue` field removed (sched-drop-overdue-column, M-5): no longer
        // a real INSTANCE_UPDATE_FIELDS entry — see AC3-a below for the fix.
      });
      // null is a valid value — explicit clear by the scheduler for placed/overdue rows.
      expect(Object.prototype.hasOwnProperty.call(instance, 'unplaced_reason')).toBe(true);
      expect(instance.unplaced_reason).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(instance, 'unplaced_detail')).toBe(true);
      expect(instance.unplaced_detail).toBeNull();
    });
  });

  // ── AC2: fields do NOT reach master ────────────────────────────────────────

  describe('AC2: unplaced_reason/detail are instance-only (never go to master)', () => {
    test('AC2-a: unplaced_reason absent from master update', () => {
      const { master } = splitUpdateFields({ unplaced_reason: 'tool_conflict' });
      expect(Object.prototype.hasOwnProperty.call(master, 'unplaced_reason')).toBe(false);
    });

    test('AC2-b: unplaced_detail absent from master update', () => {
      const { master } = splitUpdateFields({ unplaced_detail: 'some detail' });
      expect(Object.prototype.hasOwnProperty.call(master, 'unplaced_detail')).toBe(false);
    });
  });

  // ── AC3: mixed update — reason fields don't interfere with other routing ───

  describe('AC3: mixed update with standard placement fields', () => {
    test('AC3-a: scheduler placed-update shape — reason cleared, status/unscheduled routed', () => {
      // The scheduler Case C (placed) clears unplaced_reason when placing a task.
      // sched-drop-overdue-column (M-5): `overdue` removed from the changes shape
      // and from the assertion below — INSTANCE_UPDATE_FIELDS no longer includes
      // 'overdue' (tasks-write.js), so splitUpdateFields now silently drops it;
      // asserting instance.overdue would fail (instance.overdue is undefined,
      // not 0) since this is no longer a real writable instance field.
      const changes = {
        status: '',
        unscheduled: null,
        unplaced_reason: null,
        unplaced_detail: null
      };
      const { instance, master } = splitUpdateFields(changes);
      // instance gets placement fields + reason
      expect(instance.status).toBe('');
      expect(instance.unscheduled).toBeNull();
      expect(instance.unplaced_reason).toBeNull();
      expect(instance.unplaced_detail).toBeNull();
      // master gets status (template lifecycle) but NOT unplaced fields
      expect(master.status).toBe('');
      expect(Object.prototype.hasOwnProperty.call(master, 'unplaced_reason')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(master, 'unplaced_detail')).toBe(false);
    });

    test('AC3-b: scheduler unplaced-update shape — reason set, unscheduled=1', () => {
      // The scheduler Case C (unplaced) sets unplaced_reason.
      const changes = {
        unscheduled: 1,
        unplaced_reason: 'tpc_budget',
        unplaced_detail: 'no window capacity'
      };
      const { instance } = splitUpdateFields(changes);
      expect(instance.unscheduled).toBe(1);
      expect(instance.unplaced_reason).toBe('tpc_budget');
      expect(instance.unplaced_detail).toBe('no window capacity');
    });
  });
});

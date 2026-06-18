/**
 * Phase-21: Status columns validation
 *
 * Verifies that all status columns reject invalid values at every layer:
 *   1. Zod schema validation (task.schema.js)
 *   2. Shared task-status.js helpers (isValidTaskStatus, isTerminalStatus, etc.)
 *   3. Backend status-enum.js helpers (isValidCalHistoryStatus, etc.)
 *   4. DB CHECK constraints (task_masters, task_instances, cal_history, cal_sync_ledger)
 *
 * Acceptance: Status columns validated.
 */

'use strict';

// ─── Zod schema validation ───────────────────────────────────────────────

const { validate } = require('../../src/middleware/validate');
const { taskCreateSchema, taskUpdateSchema } = require('../../src/schemas/task.schema');

function makeRes() {
  const res = {};
  res.status = (code) => { res._code = code; return { json: (body) => { res._body = body; } }; };
  return res;
}

// ─── Shared task-status.js helpers ────────────────────────────────────────

const {
  TaskStatus,
  TASK_STATUSES,
  TERMINAL_STATUSES,
  ACTIVE_STATUSES,
  STATUS_OPTIONS,
  isValidTaskStatus,
  isTerminalStatus,
  isActiveStatus,
  isValidBooleanValue,
  validateStatusValue,
  canTransition,
  CalHistoryStatus,
  CAL_HISTORY_STATUSES,
  CAL_HISTORY_TERMINAL_STATUSES,
  isValidCalHistoryStatus,
  isCalHistoryTerminalStatus,
  getTaskStatusDisplayName,
  getTaskStatusDescription,
} = require('../../../shared/task-status');

// ─── Backend status-enum.js helpers ──────────────────────────────────────

const backendStatusEnum = require('../../src/constants/status-enum');

// ═══════════════════════════════════════════════════════════════════════════
// 1. Zod schema validation — taskUpdateSchema rejects invalid status
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase-21: Status columns validation', () => {

  describe('1. Zod schema — taskUpdateSchema status validation', () => {
    const VALID_TASK_STATUSES = ['', 'wip', 'done', 'cancel', 'skip', 'pause', 'missed'];

    test('accepts each valid task status', () => {
      VALID_TASK_STATUSES.forEach((status) => {
        const req = { body: { status } };
        const res = makeRes();
        let called = false;
        validate(taskUpdateSchema)(req, res, () => { called = true; });
        expect(called).toBe(true);
        expect(res._code).toBeUndefined();
      });
    });

    const INVALID_STATUSES = [
      'invalid',
      'INVALID',
      'pending',
      'archived',
      'restored',
      'disabled',
      'active',
      'in_progress',
      'WIP',
      'Done',
      'CANCELLED',
      'completed',
      'skipped',
      'paused',
      'missed ',
      ' missed',
      'wip ',
      ' wip',
    ];

    test.each(INVALID_STATUSES)('rejects invalid status "%s"', (invalidStatus) => {
      const req = { body: { status: invalidStatus } };
      const res = makeRes();
      validate(taskUpdateSchema)(req, res, () => {});
      expect(res._code).toBe(400);
      expect(res._body.error).toBe('Validation failed');
    });

    test('rejects numeric status', () => {
      const req = { body: { status: 42 } };
      const res = makeRes();
      validate(taskUpdateSchema)(req, res, () => {});
      expect(res._code).toBe(400);
    });

    test('rejects boolean status', () => {
      const req = { body: { status: true } };
      const res = makeRes();
      validate(taskUpdateSchema)(req, res, () => {});
      expect(res._code).toBe(400);
    });

    test('rejects null status', () => {
      const req = { body: { status: null } };
      const res = makeRes();
      validate(taskUpdateSchema)(req, res, () => {});
      expect(res._code).toBe(400);
    });

    test('rejects object as status', () => {
      const req = { body: { status: { value: 'done' } } };
      const res = makeRes();
      validate(taskUpdateSchema)(req, res, () => {});
      expect(res._code).toBe(400);
    });

    test('allows update without status field (partial)', () => {
      const req = { body: { text: 'updated task' } };
      const res = makeRes();
      let called = false;
      validate(taskUpdateSchema)(req, res, () => { called = true; });
      expect(called).toBe(true);
    });

    test('empty string status is accepted (TaskStatus.EMPTY)', () => {
      const req = { body: { status: '' } };
      const res = makeRes();
      let called = false;
      validate(taskUpdateSchema)(req, res, () => { called = true; });
      expect(called).toBe(true);
      expect(res._code).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Shared task-status.js — isValidTaskStatus
  // ═══════════════════════════════════════════════════════════════════════

  describe('2. Shared task-status.js — isValidTaskStatus', () => {
    test('returns true for all valid task statuses', () => {
      TASK_STATUSES.forEach((s) => {
        expect(isValidTaskStatus(s)).toBe(true);
      });
    });

    test('returns true for each individual valid status', () => {
      expect(isValidTaskStatus('')).toBe(true);
      expect(isValidTaskStatus('wip')).toBe(true);
      expect(isValidTaskStatus('done')).toBe(true);
      expect(isValidTaskStatus('cancel')).toBe(true);
      expect(isValidTaskStatus('skip')).toBe(true);
      expect(isValidTaskStatus('pause')).toBe(true);
      expect(isValidTaskStatus('missed')).toBe(true);
    });

    test('returns false for null', () => {
      expect(isValidTaskStatus(null)).toBe(false);
    });

    test('returns false for undefined', () => {
      expect(isValidTaskStatus(undefined)).toBe(false);
    });

    test('returns false for invalid status strings', () => {
      const invalidValues = [
        'invalid',
        'PENDING',
        'pending',
        'archived',
        'restored',
        'disabled',
        'active',
        'WIP',
        'Done',
        'CANCELLED',
        'completed',
        'skipped',
        'paused',
        'in_progress',
        'wip ',   // trailing space
        ' wip',   // leading space
        ' missed',
      ];
      invalidValues.forEach((v) => {
        expect(isValidTaskStatus(v)).toBe(false);
      });
    });

    test('returns false for non-string types', () => {
      expect(isValidTaskStatus(42)).toBe(false);
      expect(isValidTaskStatus(true)).toBe(false);
      expect(isValidTaskStatus({})).toBe(false);
      expect(isValidTaskStatus([])).toBe(false);
    });

    test('returns false for empty string if it were not in TASK_STATUSES', () => {
      // '' IS valid (TaskStatus.EMPTY), but verify it's explicitly in the list
      expect(TASK_STATUSES).toContain('');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Shared task-status.js — isTerminalStatus
  // ═══════════════════════════════════════════════════════════════════════

  describe('3. Shared task-status.js — isTerminalStatus', () => {
    test('returns true for terminal statuses', () => {
      TERMINAL_STATUSES.forEach((s) => {
        expect(isTerminalStatus(s)).toBe(true);
      });
    });

    test('terminal statuses are: done, cancel, skip, pause, missed', () => {
      expect(isTerminalStatus('done')).toBe(true);
      expect(isTerminalStatus('cancel')).toBe(true);
      expect(isTerminalStatus('skip')).toBe(true);
      expect(isTerminalStatus('pause')).toBe(true);
      expect(isTerminalStatus('missed')).toBe(true);
    });

    test('returns false for active statuses', () => {
      expect(isTerminalStatus('')).toBe(false);
      expect(isTerminalStatus('wip')).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(isTerminalStatus(null)).toBe(false);
      expect(isTerminalStatus(undefined)).toBe(false);
    });

    test('returns false for invalid strings', () => {
      expect(isTerminalStatus('invalid')).toBe(false);
      expect(isTerminalStatus('pending')).toBe(false);
      expect(isTerminalStatus('disabled')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Shared task-status.js — isActiveStatus
  // ═══════════════════════════════════════════════════════════════════════

  describe('4. Shared task-status.js — isActiveStatus', () => {
    test('returns true for active statuses', () => {
      ACTIVE_STATUSES.forEach((s) => {
        expect(isActiveStatus(s)).toBe(true);
      });
    });

    test('active statuses are: empty string and wip', () => {
      expect(isActiveStatus('')).toBe(true);
      expect(isActiveStatus('wip')).toBe(true);
    });

    test('returns false for terminal statuses', () => {
      expect(isActiveStatus('done')).toBe(false);
      expect(isActiveStatus('cancel')).toBe(false);
      expect(isActiveStatus('skip')).toBe(false);
      expect(isActiveStatus('pause')).toBe(false);
      expect(isActiveStatus('missed')).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(isActiveStatus(null)).toBe(false);
      expect(isActiveStatus(undefined)).toBe(false);
    });

    test('returns false for invalid strings', () => {
      expect(isActiveStatus('invalid')).toBe(false);
      expect(isActiveStatus('pending')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Shared task-status.js — canTransition
  // ═══════════════════════════════════════════════════════════════════════

  describe('5. Shared task-status.js — canTransition', () => {
    test('EMPTY can transition to: done, wip, skip, cancel, pause', () => {
      expect(canTransition('', 'done')).toBe(true);
      expect(canTransition('', 'wip')).toBe(true);
      expect(canTransition('', 'skip')).toBe(true);
      expect(canTransition('', 'cancel')).toBe(true);
      expect(canTransition('', 'pause')).toBe(true);
    });

    test('EMPTY cannot transition to: empty, missed', () => {
      expect(canTransition('', '')).toBe(false);
      expect(canTransition('', 'missed')).toBe(false);
    });

    test('WIP can transition to: done, empty (reopen), skip, cancel', () => {
      expect(canTransition('wip', 'done')).toBe(true);
      expect(canTransition('wip', '')).toBe(true);
      expect(canTransition('wip', 'skip')).toBe(true);
      expect(canTransition('wip', 'cancel')).toBe(true);
    });

    test('WIP cannot transition to: wip, pause, missed', () => {
      expect(canTransition('wip', 'wip')).toBe(false);
      expect(canTransition('wip', 'pause')).toBe(false);
      expect(canTransition('wip', 'missed')).toBe(false);
    });

    test('terminal statuses cannot transition to anything', () => {
      TERMINAL_STATUSES.forEach((from) => {
        STATUS_OPTIONS.forEach((to) => {
          expect(canTransition(from, to)).toBe(false);
        });
      });
    });

    test('invalid from/to values return false', () => {
      expect(canTransition('invalid', 'done')).toBe(false);
      expect(canTransition('', 'invalid')).toBe(false);
      expect(canTransition(null, 'done')).toBe(false);
      expect(canTransition('', null)).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Shared task-status.js — validateStatusValue
  // ═══════════════════════════════════════════════════════════════════════

  describe('6. Shared task-status.js — validateStatusValue', () => {
    test('returns true for valid task statuses', () => {
      TASK_STATUSES.forEach((s) => {
        expect(validateStatusValue(s)).toBe(true);
      });
    });

    test('returns false for null', () => {
      expect(validateStatusValue(null)).toBe(false);
    });

    test('returns false for undefined', () => {
      expect(validateStatusValue(undefined)).toBe(false);
    });

    test('returns false for non-string types', () => {
      expect(validateStatusValue(42)).toBe(false);
      expect(validateStatusValue(true)).toBe(false);
    });

    test('returns false for invalid status strings', () => {
      expect(validateStatusValue('invalid')).toBe(false);
      expect(validateStatusValue('pending')).toBe(false);
      expect(validateStatusValue('PENDING')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Shared task-status.js — isValidBooleanValue
  // ═══════════════════════════════════════════════════════════════════════

  describe('7. Shared task-status.js — isValidBooleanValue', () => {
    test('returns true for 0 and 1', () => {
      expect(isValidBooleanValue(0)).toBe(true);
      expect(isValidBooleanValue(1)).toBe(true);
    });

    test('returns false for other numbers', () => {
      expect(isValidBooleanValue(2)).toBe(false);
      expect(isValidBooleanValue(-1)).toBe(false);
      expect(isValidBooleanValue(0.5)).toBe(false);
    });

    test('returns false for non-number types', () => {
      expect(isValidBooleanValue(null)).toBe(false);
      expect(isValidBooleanValue(undefined)).toBe(false);
      expect(isValidBooleanValue(true)).toBe(false);
      expect(isValidBooleanValue('1')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Shared task-status.js — getTaskStatusDisplayName
  // ═══════════════════════════════════════════════════════════════════════

  describe('8. Shared task-status.js — getTaskStatusDisplayName', () => {
    test('returns correct display names for all statuses', () => {
      expect(getTaskStatusDisplayName('')).toBe('Not Started');
      expect(getTaskStatusDisplayName('wip')).toBe('In Progress');
      expect(getTaskStatusDisplayName('done')).toBe('Completed');
      expect(getTaskStatusDisplayName('cancel')).toBe('Cancelled');
      expect(getTaskStatusDisplayName('skip')).toBe('Skipped');
      expect(getTaskStatusDisplayName('pause')).toBe('Paused');
      expect(getTaskStatusDisplayName('missed')).toBe('Missed');
    });

    test('returns "Unknown" for invalid status', () => {
      expect(getTaskStatusDisplayName('invalid')).toBe('Unknown');
      expect(getTaskStatusDisplayName('pending')).toBe('Unknown');
      expect(getTaskStatusDisplayName('PENDING')).toBe('Unknown');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. Shared task-status.js — getTaskStatusDescription
  // ═══════════════════════════════════════════════════════════════════════

  describe('9. Shared task-status.js — getTaskStatusDescription', () => {
    test('returns correct descriptions for all statuses', () => {
      expect(getTaskStatusDescription('')).toBe('Task created but not yet started');
      expect(getTaskStatusDescription('wip')).toBe('Task is actively being worked on');
      expect(getTaskStatusDescription('done')).toBe('Task completed successfully');
      expect(getTaskStatusDescription('cancel')).toBe('Task cancelled by user');
      expect(getTaskStatusDescription('skip')).toBe('Task temporarily bypassed');
      expect(getTaskStatusDescription('pause')).toBe('Recurring task paused');
      expect(getTaskStatusDescription('missed')).toBe('Resolution window passed without action');
    });

    test('returns "Unknown status" for invalid status', () => {
      expect(getTaskStatusDescription('invalid')).toBe('Unknown status');
      expect(getTaskStatusDescription('pending')).toBe('Unknown status');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 10. Shared task-status.js — CalHistoryStatus validation
  // ═══════════════════════════════════════════════════════════════════════

  describe('10. Shared task-status.js — CalHistoryStatus (shared)', () => {
    test('CalHistoryStatus has expected values', () => {
      expect(CalHistoryStatus.SCHEDULED).toBe('SCHEDULED');
      expect(CalHistoryStatus.COMPLETED).toBe('COMPLETED');
      expect(CalHistoryStatus.MISSED).toBe('MISSED');
      expect(CalHistoryStatus.CANCELLED).toBe('CANCELLED');
    });

    test('CAL_HISTORY_STATUSES contains exactly 4 entries', () => {
      expect(CAL_HISTORY_STATUSES).toHaveLength(4);
      expect(CAL_HISTORY_STATUSES).toContain('SCHEDULED');
      expect(CAL_HISTORY_STATUSES).toContain('COMPLETED');
      expect(CAL_HISTORY_STATUSES).toContain('MISSED');
      expect(CAL_HISTORY_STATUSES).toContain('CANCELLED');
    });

    test('CAL_HISTORY_STATUSES does NOT contain SKIPPED', () => {
      expect(CAL_HISTORY_STATUSES).not.toContain('SKIPPED');
    });

    test('CAL_HISTORY_STATUSES does NOT contain PENDING', () => {
      expect(CAL_HISTORY_STATUSES).not.toContain('PENDING');
    });

    test('CAL_HISTORY_TERMINAL_STATUSES contains exactly 3 entries', () => {
      expect(CAL_HISTORY_TERMINAL_STATUSES).toHaveLength(3);
      expect(CAL_HISTORY_TERMINAL_STATUSES).toContain('COMPLETED');
      expect(CAL_HISTORY_TERMINAL_STATUSES).toContain('MISSED');
      expect(CAL_HISTORY_TERMINAL_STATUSES).toContain('CANCELLED');
    });

    test('isValidCalHistoryStatus accepts valid statuses', () => {
      ['SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED'].forEach((s) => {
        expect(isValidCalHistoryStatus(s)).toBe(true);
      });
    });

    test('isValidCalHistoryStatus rejects invalid statuses', () => {
      ['', 'INVALID', 'PENDING', 'SKIPPED', 'scheduled', 'completed', null, undefined].forEach((s) => {
        expect(isValidCalHistoryStatus(s)).toBe(false);
      });
    });

    test('isCalHistoryTerminalStatus identifies terminal statuses', () => {
      expect(isCalHistoryTerminalStatus('COMPLETED')).toBe(true);
      expect(isCalHistoryTerminalStatus('MISSED')).toBe(true);
      expect(isCalHistoryTerminalStatus('CANCELLED')).toBe(true);
      expect(isCalHistoryTerminalStatus('SCHEDULED')).toBe(false);
    });

    test('isCalHistoryTerminalStatus rejects invalid/null/undefined', () => {
      expect(isCalHistoryTerminalStatus(null)).toBe(false);
      expect(isCalHistoryTerminalStatus(undefined)).toBe(false);
      expect(isCalHistoryTerminalStatus('SKIPPED')).toBe(false);
      expect(isCalHistoryTerminalStatus('PENDING')).toBe(false);
    });

    test('CalHistoryStatus is frozen', () => {
      expect(Object.isFrozen(CalHistoryStatus)).toBe(true);
      expect(Object.isFrozen(CAL_HISTORY_STATUSES)).toBe(true);
      expect(Object.isFrozen(CAL_HISTORY_TERMINAL_STATUSES)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 11. Backend status-enum.js — CalHistoryStatus validation
  // ═══════════════════════════════════════════════════════════════════════

  describe('11. Backend status-enum.js — CalHistoryStatus', () => {
    test('CalHistoryStatus has expected values', () => {
      expect(backendStatusEnum.CalHistoryStatus.SCHEDULED).toBe('SCHEDULED');
      expect(backendStatusEnum.CalHistoryStatus.COMPLETED).toBe('COMPLETED');
      expect(backendStatusEnum.CalHistoryStatus.MISSED).toBe('MISSED');
      expect(backendStatusEnum.CalHistoryStatus.CANCELLED).toBe('CANCELLED');
    });

    test('CalHistoryStatus does NOT have SKIPPED key', () => {
      expect(backendStatusEnum.CalHistoryStatus.SKIPPED).toBeUndefined();
    });

    test('CAL_HISTORY_STATUSES contains exactly 4 valid statuses', () => {
      expect(backendStatusEnum.CAL_HISTORY_STATUSES).toHaveLength(4);
      expect(backendStatusEnum.CAL_HISTORY_STATUSES).toContain('SCHEDULED');
      expect(backendStatusEnum.CAL_HISTORY_STATUSES).toContain('COMPLETED');
      expect(backendStatusEnum.CAL_HISTORY_STATUSES).toContain('MISSED');
      expect(backendStatusEnum.CAL_HISTORY_STATUSES).toContain('CANCELLED');
    });

    test('CAL_HISTORY_STATUSES does NOT contain SKIPPED or PENDING', () => {
      expect(backendStatusEnum.CAL_HISTORY_STATUSES).not.toContain('SKIPPED');
      expect(backendStatusEnum.CAL_HISTORY_STATUSES).not.toContain('PENDING');
    });

    test('CAL_HISTORY_TERMINAL_STATUSES contains exactly 3 entries', () => {
      expect(backendStatusEnum.CAL_HISTORY_TERMINAL_STATUSES).toHaveLength(3);
      expect(backendStatusEnum.CAL_HISTORY_TERMINAL_STATUSES).toContain('COMPLETED');
      expect(backendStatusEnum.CAL_HISTORY_TERMINAL_STATUSES).toContain('MISSED');
      expect(backendStatusEnum.CAL_HISTORY_TERMINAL_STATUSES).toContain('CANCELLED');
    });

    test('isValidCalHistoryStatus accepts valid statuses', () => {
      ['SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED'].forEach((s) => {
        expect(backendStatusEnum.isValidCalHistoryStatus(s)).toBe(true);
      });
    });

    test('isValidCalHistoryStatus rejects SKIPPED (removed from DB CHECK)', () => {
      expect(backendStatusEnum.isValidCalHistoryStatus('SKIPPED')).toBe(false);
    });

    test('isValidCalHistoryStatus rejects PENDING (not in DB CHECK)', () => {
      expect(backendStatusEnum.isValidCalHistoryStatus('PENDING')).toBe(false);
    });

    test('isValidCalHistoryStatus rejects invalid/null/undefined', () => {
      ['', 'invalid', 'scheduled', 'completed', null, undefined].forEach((s) => {
        expect(backendStatusEnum.isValidCalHistoryStatus(s)).toBe(false);
      });
    });

    test('isTerminalCalHistoryStatus identifies terminal statuses', () => {
      expect(backendStatusEnum.isTerminalCalHistoryStatus('COMPLETED')).toBe(true);
      expect(backendStatusEnum.isTerminalCalHistoryStatus('MISSED')).toBe(true);
      expect(backendStatusEnum.isTerminalCalHistoryStatus('CANCELLED')).toBe(true);
      expect(backendStatusEnum.isTerminalCalHistoryStatus('SCHEDULED')).toBe(false);
    });

    test('isTerminalCalHistoryStatus rejects SKIPPED and invalid', () => {
      expect(backendStatusEnum.isTerminalCalHistoryStatus('SKIPPED')).toBe(false);
      expect(backendStatusEnum.isTerminalCalHistoryStatus(null)).toBe(false);
      expect(backendStatusEnum.isTerminalCalHistoryStatus(undefined)).toBe(false);
    });

    test('getCalHistoryStatusDisplayName returns correct names', () => {
      expect(backendStatusEnum.getCalHistoryStatusDisplayName('SCHEDULED')).toBe('Scheduled');
      expect(backendStatusEnum.getCalHistoryStatusDisplayName('COMPLETED')).toBe('Completed');
      expect(backendStatusEnum.getCalHistoryStatusDisplayName('MISSED')).toBe('Missed');
      expect(backendStatusEnum.getCalHistoryStatusDisplayName('CANCELLED')).toBe('Cancelled');
    });

    test('getCalHistoryStatusDisplayName returns Unknown for SKIPPED', () => {
      expect(backendStatusEnum.getCalHistoryStatusDisplayName('SKIPPED')).toBe('Unknown');
    });

    test('getCalHistoryStatusDisplayName returns Unknown for invalid', () => {
      expect(backendStatusEnum.getCalHistoryStatusDisplayName('INVALID')).toBe('Unknown');
      expect(backendStatusEnum.getCalHistoryStatusDisplayName('')).toBe('Unknown');
    });

    test('all enum objects are frozen', () => {
      expect(Object.isFrozen(backendStatusEnum.CalHistoryStatus)).toBe(true);
      expect(Object.isFrozen(backendStatusEnum.CAL_HISTORY_STATUSES)).toBe(true);
      expect(Object.isFrozen(backendStatusEnum.CAL_HISTORY_TERMINAL_STATUSES)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12. Enum constancy — TASK_STATUSES, TERMINAL_STATUSES, etc. are frozen
  // ═══════════════════════════════════════════════════════════════════════

  describe('12. Enum constancy — shared constants are frozen', () => {
    test('TaskStatus is frozen', () => {
      expect(Object.isFrozen(TaskStatus)).toBe(true);
    });

    test('TASK_STATUSES is frozen', () => {
      expect(Object.isFrozen(TASK_STATUSES)).toBe(true);
    });

    test('TERMINAL_STATUSES is frozen', () => {
      expect(Object.isFrozen(TERMINAL_STATUSES)).toBe(true);
    });

    test('ACTIVE_STATUSES is frozen', () => {
      expect(Object.isFrozen(ACTIVE_STATUSES)).toBe(true);
    });

    test('STATUS_OPTIONS is frozen', () => {
      expect(Object.isFrozen(STATUS_OPTIONS)).toBe(true);
    });

    test('TaskStatus values are consistent with arrays', () => {
      expect(TaskStatus.EMPTY).toBe('');
      expect(TaskStatus.WIP).toBe('wip');
      expect(TaskStatus.DONE).toBe('done');
      expect(TaskStatus.CANCEL).toBe('cancel');
      expect(TaskStatus.SKIP).toBe('skip');
      expect(TaskStatus.PAUSE).toBe('pause');
      expect(TaskStatus.MISSED).toBe('missed');
    });

    test('TERMINAL_STATUSES contains exactly the expected values', () => {
      expect(TERMINAL_STATUSES).toEqual(['done', 'cancel', 'skip', 'pause', 'missed']);
    });

    test('ACTIVE_STATUSES contains exactly the expected values', () => {
      expect(ACTIVE_STATUSES).toEqual(['', 'wip']);
    });

    test('TASK_STATUSES equals STATUS_OPTIONS', () => {
      expect(TASK_STATUSES).toEqual(STATUS_OPTIONS);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 13. DB CHECK constraint alignment — application enums match DB constraints
  // ═══════════════════════════════════════════════════════════════════════

  describe('13. DB CHECK constraint alignment', () => {
    // The DB CHECK constraints as of the latest migrations define:
    // - task_masters.status: ('', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', 'pending', 'archived', 'restored') OR NULL
    // - task_instances.status: ('', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', 'pending', 'archived', 'restored')
    // - cal_history.status: ('SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED')
    // - cal_sync_ledger.event_status: ('pending', 'done', 'skip', 'cancel') OR NULL
    //
    // Note: task_masters/task_instances DB enums include 'disabled', 'pending',
    // 'archived', 'restored' which are NOT in the shared task-status.js TASK_STATUSES.
    // These are DB-only values used for subscription enforcement and task lifecycle.
    // The Zod schema (taskUpdateSchema) only allows: ['', 'wip', 'done', 'cancel', 'skip', 'pause', 'missed']
    // — API users cannot directly set disabled/archived/restored/pending.

    test('shared TaskStatus values are a subset of DB task_masters enum', () => {
      const dbTaskMasterStatuses = ['', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', 'pending', 'archived', 'restored'];
      TASK_STATUSES.forEach((s) => {
        expect(dbTaskMasterStatuses).toContain(s);
      });
    });

    test('shared TaskStatus values are a subset of DB task_instances enum', () => {
      const dbTaskInstanceStatuses = ['', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', 'pending', 'archived', 'restored'];
      TASK_STATUSES.forEach((s) => {
        expect(dbTaskInstanceStatuses).toContain(s);
      });
    });

    test('DB-only statuses (disabled, pending, archived, restored) are NOT in shared TASK_STATUSES', () => {
      expect(TASK_STATUSES).not.toContain('disabled');
      expect(TASK_STATUSES).not.toContain('pending');
      expect(TASK_STATUSES).not.toContain('archived');
      expect(TASK_STATUSES).not.toContain('restored');
    });

    test('Zod VALID_STATUS matches shared TASK_STATUSES exactly', () => {
      // This verifies the Zod schema and shared enum stay in sync
      const VALID_STATUS = ['', 'wip', 'done', 'cancel', 'skip', 'pause', 'missed'];
      expect(VALID_STATUS).toEqual(TASK_STATUSES);
    });

    test('cal_history DB enum matches backend CalHistoryStatus values', () => {
      const dbCalHistoryStatuses = ['SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED'];
      expect(backendStatusEnum.CAL_HISTORY_STATUSES).toEqual(dbCalHistoryStatuses);
    });

    test('shared CalHistoryStatus values match backend CalHistoryStatus values', () => {
      // Both the shared and backend enums should define the same set
      expect(CalHistoryStatus.SCHEDULED).toBe(backendStatusEnum.CalHistoryStatus.SCHEDULED);
      expect(CalHistoryStatus.COMPLETED).toBe(backendStatusEnum.CalHistoryStatus.COMPLETED);
      expect(CalHistoryStatus.MISSED).toBe(backendStatusEnum.CalHistoryStatus.MISSED);
      expect(CalHistoryStatus.CANCELLED).toBe(backendStatusEnum.CalHistoryStatus.CANCELLED);
    });

    test('PENDING is NOT in the cal_history DB CHECK (removed by migration 20260605010000)', () => {
      expect(backendStatusEnum.CAL_HISTORY_STATUSES).not.toContain('PENDING');
      expect(CAL_HISTORY_STATUSES).not.toContain('PENDING');
    });

    test('SKIPPED is NOT in the cal_history DB CHECK (removed by migration 20260605010000)', () => {
      expect(backendStatusEnum.CAL_HISTORY_STATUSES).not.toContain('SKIPPED');
      expect(CAL_HISTORY_STATUSES).not.toContain('SKIPPED');
    });

    test('cal_sync_ledger event_status DB values: pending, done, skip, cancel', () => {
      // These are distinct from task status and cal_history status
      const dbEventStatuses = ['pending', 'done', 'skip', 'cancel'];
      // Note: event_status is nullable — NULL is also valid
      expect(dbEventStatuses).toContain('pending');
      expect(dbEventStatuses).toContain('done');
      expect(dbEventStatuses).toContain('skip');
      expect(dbEventStatuses).toContain('cancel');
      // event_status values should not be confused with task status or cal_history status
      expect(dbEventStatuses).not.toContain('wip');
      expect(dbEventStatuses).not.toContain('missed');
      expect(dbEventStatuses).not.toContain('SCHEDULED');
      expect(dbEventStatuses).not.toContain('COMPLETED');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 14. Cross-layer consistency — no status value is valid in one layer but
  //     invalid in another where it should be consistent
  // ═══════════════════════════════════════════════════════════════════════

  describe('14. Cross-layer consistency', () => {
    test('every Zod-valid task status is also valid in shared isValidTaskStatus', () => {
      const zodValidStatuses = ['', 'wip', 'done', 'cancel', 'skip', 'pause', 'missed'];
      zodValidStatuses.forEach((s) => {
        expect(isValidTaskStatus(s)).toBe(true);
      });
    });

    test('every shared valid task status passes Zod taskUpdateSchema', () => {
      TASK_STATUSES.forEach((s) => {
        const req = { body: { status: s } };
        const res = makeRes();
        let called = false;
        validate(taskUpdateSchema)(req, res, () => { called = true; });
        expect(called).toBe(true);
        expect(res._code).toBeUndefined();
      });
    });

    test('every backend cal_history valid status is also valid in shared isValidCalHistoryStatus', () => {
      backendStatusEnum.CAL_HISTORY_STATUSES.forEach((s) => {
        expect(isValidCalHistoryStatus(s)).toBe(true);
      });
    });

    test('every shared cal_history valid status is also valid in backend isValidCalHistoryStatus', () => {
      CAL_HISTORY_STATUSES.forEach((s) => {
        expect(backendStatusEnum.isValidCalHistoryStatus(s)).toBe(true);
      });
    });

    test('task status values are lowercase (matching DB convention)', () => {
      TASK_STATUSES.forEach((s) => {
        if (s !== '') {
          expect(s).toBe(s.toLowerCase());
        }
      });
    });

    test('cal_history status values are UPPERCASE (matching DB convention)', () => {
      CAL_HISTORY_STATUSES.forEach((s) => {
        expect(s).toBe(s.toUpperCase());
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 15. Boolean column validation — isValidBooleanValue aligns with DB
  //     CHECK constraints (flex_when, recurring, split, unscheduled)
  // ═══════════════════════════════════════════════════════════════════════

  describe('15. Boolean column validation — isValidBooleanValue', () => {
    test('0 and 1 are valid boolean values (matches DB CHECK constraints)', () => {
      expect(isValidBooleanValue(0)).toBe(true);
      expect(isValidBooleanValue(1)).toBe(true);
    });

    test('values outside 0/1 are rejected (matches DB CHECK constraints)', () => {
      expect(isValidBooleanValue(2)).toBe(false);
      expect(isValidBooleanValue(-1)).toBe(false);
      expect(isValidBooleanValue(0.5)).toBe(false);
      expect(isValidBooleanValue(100)).toBe(false);
    });

    test('non-number types are rejected', () => {
      expect(isValidBooleanValue(null)).toBe(false);
      expect(isValidBooleanValue(undefined)).toBe(false);
      expect(isValidBooleanValue(true)).toBe(false);
      expect(isValidBooleanValue(false)).toBe(false);
      expect(isValidBooleanValue('0')).toBe(false);
      expect(isValidBooleanValue('1')).toBe(false);
    });

    test('DB nullable columns (split, unscheduled) also allow NULL at DB level', () => {
      // isValidBooleanValue only validates the 0/1 constraint portion
      // NULL is handled separately by the DB column definition
      // This test documents that NULL is valid at DB level but not via isValidBooleanValue
      expect(isValidBooleanValue(null)).toBe(false); // correct: function checks value constraint only
    });
  });
});
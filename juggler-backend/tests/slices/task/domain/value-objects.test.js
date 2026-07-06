/**
 * W2 unit tests — Task domain value objects (closed enums, S7 rejection paths).
 *
 * Covers WBS W2 acceptance (b) + (e): TaskStatus / PlacementMode
 * are CLOSED enums that REJECT unknown terms and ACCEPT exactly the canonical set
 * (characterized — verified against the controller libs + the W1 golden-master,
 * not assumed). Plus TaskId identity invariant.
 *
 * Pure unit — no DB, no network.
 */

'use strict';

const TaskId = require('../../../../src/slices/task/domain/value-objects/TaskId');
const TaskStatus = require('../../../../src/slices/task/domain/value-objects/TaskStatus');
const PlacementMode = require('../../../../src/slices/task/domain/value-objects/PlacementMode');

// The source-of-truth libs the VOs characterize against — assert the VO set
// equals the lib set (so the VO can never silently drift from the controller).
const { PLACEMENT_MODES } = require('../../../../src/lib/placementModes');
const { STATUS_OPTIONS, TERMINAL_STATUSES } = require('../../../../src/lib/task-status');

describe('TaskId — identity invariant', () => {
  test('accepts a non-empty string (UUIDv7 form)', () => {
    const id = new TaskId('0190a1b2-c3d4-7000-8000-000000000000');
    expect(id.toString()).toBe('0190a1b2-c3d4-7000-8000-000000000000');
  });

  test('accepts a synthetic recurring-instance id (rc_<src>_<digits>)', () => {
    expect(new TaskId('rc_tmpl-1_20260610').value).toBe('rc_tmpl-1_20260610');
  });

  test.each([['', 'empty string'], [null, 'null'], [undefined, 'undefined'], [123, 'number'], [{}, 'object']])(
    'rejects %s (%s)', (bad) => {
      expect(() => new TaskId(bad)).toThrow(/TaskId must be a non-empty string/);
    }
  );

  test('equals compares the underlying string', () => {
    expect(new TaskId('a').equals(new TaskId('a'))).toBe(true);
    expect(new TaskId('a').equals(new TaskId('b'))).toBe(false);
    expect(new TaskId('a').equals('a')).toBe(false);
  });

  test('from() passes through an existing TaskId', () => {
    const id = new TaskId('x');
    expect(TaskId.from(id)).toBe(id);
  });

  test('is frozen (immutable)', () => {
    const id = new TaskId('x');
    expect(Object.isFrozen(id)).toBe(true);
  });
});

describe('TaskStatus — closed enum (characterized from STATUS_OPTIONS)', () => {
  test('canonical set EQUALS lib STATUS_OPTIONS (no drift)', () => {
    expect(TaskStatus.VALUES).toEqual(STATUS_OPTIONS);
    expect(TaskStatus.TERMINAL).toEqual(TERMINAL_STATUSES);
  });

  test.each(STATUS_OPTIONS)('accepts canonical status %j', (s) => {
    expect(new TaskStatus(s).toString()).toBe(s);
    expect(TaskStatus.isValid(s)).toBe(true);
  });

  test.each([['wibble'], ['DONE'], ['active'], ['disabled'], [null], [undefined], [0]])(
    'REJECTS unknown status %j (throws)', (bad) => {
      expect(() => new TaskStatus(bad)).toThrow(/TaskStatus must be one of/);
      expect(TaskStatus.isValid(bad)).toBe(false);
    }
  );

  test('isTerminal matches lib TERMINAL_STATUSES exactly', () => {
    // Only user-selectable (STATUS_OPTIONS) statuses can be constructed into a
    // TaskStatus VO. System-only terminal statuses (cancelled, missed) aren't in
    // STATUS_OPTIONS, so they're covered by the direct array-equality check above
    // ('canonical set EQUALS lib STATUS_OPTIONS') instead of via construction here.
    TERMINAL_STATUSES.filter((s) => STATUS_OPTIONS.includes(s))
      .forEach((s) => expect(new TaskStatus(s).isTerminal()).toBe(true));
    [''].forEach((s) => expect(new TaskStatus(s).isTerminal()).toBe(false));
  });
});

describe('PlacementMode — closed enum (characterized from PLACEMENT_MODES)', () => {
  const CANON = Object.values(PLACEMENT_MODES);

  test('canonical set EQUALS Object.values(PLACEMENT_MODES) (no drift)', () => {
    expect(PlacementMode.VALUES).toEqual(CANON);
  });

  test.each(CANON)('accepts canonical placement mode %j', (m) => {
    expect(new PlacementMode(m).toString()).toBe(m);
    expect(PlacementMode.isValid(m)).toBe(true);
  });

  test.each([['NOT_VALID'], ['FIXED'], ['flexible'], ['marker'], [null], [undefined]])(
    'REJECTS unknown placement mode %j (throws)', (bad) => {
      expect(() => new PlacementMode(bad)).toThrow(/PlacementMode must be one of/);
      expect(PlacementMode.isValid(bad)).toBe(false);
    }
  );

  test("matches validateTaskInput's golden-master rejection of 'NOT_VALID'", () => {
    // Golden-master "Surface 1: 400 on invalid placementMode" sends 'NOT_VALID'.
    expect(PlacementMode.isValid('NOT_VALID')).toBe(false);
  });
});

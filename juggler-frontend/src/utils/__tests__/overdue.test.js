/**
 * W1 (D3) — overdue display must come from the canonical task.overdue (R50.6),
 * NEVER the scheduler placement _overdue. Regression: Day view marked floating
 * tasks overdue (placement _overdue=true) while Issues did not (task.overdue=false).
 *
 * 999.5116: isTaskOverdue must ALSO derive past-due from the task's own
 * scheduled date when the DB overdue flag has been cleared by the scheduler.
 * A task with a hard commitment (deadline, placementMode=fixed, or overdue=1)
 * whose scheduled date is in the past IS overdue, regardless of the DB flag.
 */
import { isTaskOverdue } from '../overdue';

describe('isTaskOverdue — canonical task.overdue is the only source (D3)', () => {
  test('overdue task, not done → overdue', () => {
    expect(isTaskOverdue({ overdue: true }, false)).toBe(true);
  });

  test('overdue task but done → not overdue', () => {
    expect(isTaskOverdue({ overdue: true }, true)).toBe(false);
  });

  test('floating task (task.overdue=false) is NOT overdue even if a caller had a placement _overdue (999.671)', () => {
    // The helper takes the TASK, so a placement _overdue can not leak in.
    expect(isTaskOverdue({ overdue: false, _overdue: true }, false)).toBe(false);
  });

  test('missing/undefined task or overdue → not overdue', () => {
    expect(isTaskOverdue({}, false)).toBe(false);
    expect(isTaskOverdue(null, false)).toBe(false);
    expect(isTaskOverdue(undefined, false)).toBe(false);
  });
});

describe('999.5116: isTaskOverdue derives past-due from scheduled date', () => {
  // Use a fixed "now" so tests are deterministic. Aug 2026.
  var now = new Date('2026-08-03T12:00:00');
  var todayKey = '2026-08-03';

  test('task with overdue=0 but scheduled in the past + hard commitment → overdue', () => {
    var task = {
      overdue: 0,
      date: '2025-01-15',
      time: '14:00',
      deadline: '2025-01-15',
    };
    expect(isTaskOverdue(task, false, now)).toBe(true);
  });

  test('task with overdue=0, scheduled in past, placementMode=fixed → overdue', () => {
    var task = {
      overdue: 0,
      date: '2025-01-15',
      time: '14:00',
      placementMode: 'fixed',
    };
    expect(isTaskOverdue(task, false, now)).toBe(true);
  });

  test('task with overdue=0, scheduled in past, no hard commitment → NOT overdue (floating)', () => {
    var task = {
      overdue: 0,
      date: '2025-01-15',
      time: '14:00',
      // no deadline, no fixed placement → floating, not overdue per 999.671
    };
    expect(isTaskOverdue(task, false, now)).toBe(false);
  });

  test('task scheduled in the future → NOT overdue', () => {
    var task = {
      overdue: 0,
      date: '2026-12-15',
      time: '14:00',
      deadline: '2026-12-15',
    };
    expect(isTaskOverdue(task, false, now)).toBe(false);
  });

  test('task scheduled today but in the past + hard commitment → overdue', () => {
    var task = {
      overdue: 0,
      date: todayKey,
      time: '08:00', // 8am, now is noon
      deadline: todayKey,
    };
    expect(isTaskOverdue(task, false, now)).toBe(true);
  });

  test('task scheduled today but in the future → NOT overdue', () => {
    var task = {
      overdue: 0,
      date: todayKey,
      time: '18:00', // 6pm, now is noon
      deadline: todayKey,
    };
    expect(isTaskOverdue(task, false, now)).toBe(false);
  });

  test('done task with past scheduled date → NOT overdue', () => {
    var task = {
      overdue: 0,
      date: '2025-01-15',
      time: '14:00',
      deadline: '2025-01-15',
    };
    expect(isTaskOverdue(task, true, now)).toBe(false);
  });

  test('task with overdue=1 still shows overdue regardless of date', () => {
    var task = {
      overdue: 1,
      date: '2026-12-15',
      time: '14:00',
    };
    expect(isTaskOverdue(task, false, now)).toBe(true);
  });

  test('task with no date/time but overdue=0 → NOT overdue', () => {
    var task = { overdue: 0 };
    expect(isTaskOverdue(task, false, now)).toBe(false);
  });
});

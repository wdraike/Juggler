/**
 * W1 (D3) — overdue display must come from the canonical task.overdue (R50.6),
 * NEVER the scheduler placement _overdue. Regression: Day view marked floating
 * tasks overdue (placement _overdue=true) while Issues did not (task.overdue=false).
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

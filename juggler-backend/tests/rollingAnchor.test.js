const { computeRollingAnchor, isRollingMaster } = require('../src/lib/rolling-anchor');

describe('isRollingMaster', () => {
  test('returns true for rolling recur type', () => {
    expect(isRollingMaster({ recur: JSON.stringify({ type: 'rolling', intervalDays: 7 }) })).toBe(true);
  });
  test('returns false for weekly type', () => {
    expect(isRollingMaster({ recur: JSON.stringify({ type: 'weekly', days: 'MTWRF' }) })).toBe(false);
  });
  test('returns false for null recur', () => {
    expect(isRollingMaster({ recur: null })).toBe(false);
  });
});

describe('computeRollingAnchor', () => {
  const currentAnchor = '2026-05-18';

  test('done: returns instance date', () => {
    expect(computeRollingAnchor('done', '2026-05-20', currentAnchor)).toBe('2026-05-20');
  });

  test('skip: returns instance date (full reanchor)', () => {
    expect(computeRollingAnchor('skip', '2026-05-20', currentAnchor)).toBe('2026-05-20');
  });

  test('missed: returns instance date + 1 day', () => {
    expect(computeRollingAnchor('missed', '2026-05-20', currentAnchor)).toBe('2026-05-21');
  });

  test('cancel: returns null (no anchor change)', () => {
    expect(computeRollingAnchor('cancel', '2026-05-20', currentAnchor)).toBe(null);
  });

  test('guard: terminal date < current anchor returns null', () => {
    expect(computeRollingAnchor('done', '2026-05-17', currentAnchor)).toBe(null);
  });

  test('guard: terminal date === current anchor returns new anchor (>= is allowed)', () => {
    expect(computeRollingAnchor('done', '2026-05-18', currentAnchor)).toBe('2026-05-18');
  });

  test('null currentAnchor: no guard applied', () => {
    expect(computeRollingAnchor('done', '2026-05-10', null)).toBe('2026-05-10');
  });

  // Option B (David 2026-06-24): anchor rolling tasks to the ACTUAL completion date,
  // not the scheduled date, so a LATE completion pushes the next occurrence out from
  // when it was really done.
  test('done with completionDate: anchors to actual completion date, not the scheduled date', () => {
    expect(computeRollingAnchor('done', '2026-05-20', currentAnchor, '2026-05-23')).toBe('2026-05-23');
  });

  test('done without completionDate: falls back to scheduled date (back-compat)', () => {
    expect(computeRollingAnchor('done', '2026-05-20', currentAnchor)).toBe('2026-05-20');
  });

  test('skip ignores completionDate (skip is not a completion)', () => {
    expect(computeRollingAnchor('skip', '2026-05-20', currentAnchor, '2026-05-23')).toBe('2026-05-20');
  });

  test('guard: completionDate before currentAnchor returns null (never move backwards)', () => {
    expect(computeRollingAnchor('done', '2026-05-20', currentAnchor, '2026-05-10')).toBe(null);
  });
});

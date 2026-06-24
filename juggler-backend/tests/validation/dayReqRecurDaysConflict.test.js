/**
 * Guard: a recurring weekly/biweekly task whose dayReq names day(s) NOT in recur.days
 * silently materializes ZERO instances (expandRecurring hard-filters every picked candidate
 * by dayReq AFTER picking — shared/scheduler/expandRecurring.js:509-521), so the task vanishes
 * (no row, not on calendar, not in Unplaced) — a never-missing-invariant violation.
 *
 * Real case (Certify NJ Unemployment): recur.days='MTWRF' but dayReq='Su' → 0 instances.
 * validateTaskInput must reject the inconsistent combo at save time.
 */
const { validateTaskInput } = require('../../src/slices/task/domain/validation/taskValidation');

const hasConflictError = (errors) =>
  errors.some((e) => /never (match|schedule)|dayReq.*recur\.days|recur\.days.*dayReq/i.test(e));

describe('dayReq ∉ recur.days conflict guard', () => {
  test('weekly recur.days=MTWRF + dayReq=Su → rejected (the Certify-NJ bug)', () => {
    const errors = validateTaskInput({
      text: 'Certify NJ', recurring: true, dayReq: 'Su',
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 1 }
    });
    expect(hasConflictError(errors)).toBe(true);
  });

  test('weekly recur.days=MTWRF + dayReq=weekend → rejected (Sat/Sun ∉ Mon-Fri)', () => {
    const errors = validateTaskInput({
      text: 'x', recurring: true, dayReq: 'weekend',
      recur: { type: 'weekly', days: 'MTWRF' }
    });
    expect(hasConflictError(errors)).toBe(true);
  });

  test('weekly recur.days=U + dayReq=Su → accepted (Sunday ∈ Sunday)', () => {
    const errors = validateTaskInput({
      text: 'x', recurring: true, dayReq: 'Su',
      recur: { type: 'weekly', days: 'U', timesPerCycle: 1 }
    });
    expect(hasConflictError(errors)).toBe(false);
  });

  test('weekly recur.days=MTWRF + dayReq=weekday → accepted (overlap)', () => {
    const errors = validateTaskInput({
      text: 'x', recurring: true, dayReq: 'weekday',
      recur: { type: 'weekly', days: 'MTWRF' }
    });
    expect(hasConflictError(errors)).toBe(false);
  });

  test('weekly recur.days=MTWRFSU + dayReq=Su → accepted (Sunday present)', () => {
    const errors = validateTaskInput({
      text: 'x', recurring: true, dayReq: 'Su',
      recur: { type: 'weekly', days: 'MTWRFSU' }
    });
    expect(hasConflictError(errors)).toBe(false);
  });

  test('dayReq=any → accepted (no day constraint)', () => {
    const errors = validateTaskInput({
      text: 'x', recurring: true, dayReq: 'any',
      recur: { type: 'weekly', days: 'MTWRF' }
    });
    expect(hasConflictError(errors)).toBe(false);
  });

  test('daily + dayReq=Su → accepted (daily matches every day, out of scope)', () => {
    const errors = validateTaskInput({
      text: 'x', recurring: true, dayReq: 'Su',
      recur: { type: 'daily' }
    });
    expect(hasConflictError(errors)).toBe(false);
  });

  test('no dayReq → accepted', () => {
    const errors = validateTaskInput({
      text: 'x', recurring: true,
      recur: { type: 'weekly', days: 'MTWRF' }
    });
    expect(hasConflictError(errors)).toBe(false);
  });

  test('default recur.days (MTWRF) + dayReq=Sa → rejected', () => {
    const errors = validateTaskInput({
      text: 'x', recurring: true, dayReq: 'Sa',
      recur: { type: 'weekly' }  // days omitted → defaults MTWRF
    });
    expect(hasConflictError(errors)).toBe(true);
  });
});

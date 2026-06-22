/**
 * Regression (999.816): rowToTask must NOT throw when called with a null
 * timezone on a FIXED task that has a scheduled_at.
 *
 * Bug: the R50.6 computed-overdue block (taskMappers.js) called
 * utcToLocal(scheduled_at, timezone || null). ListTasks (GET /api/tasks) passes
 * timezone=null, so a FIXED/ingested event with a scheduled_at hit
 * utcToLocal(..., null) → RangeError "Invalid time zone specified: null",
 * crashing the whole task-list serialization → empty list view (calendar
 * survived because placements come from the schedule-run path with a real tz).
 *
 * Fix: default to DEFAULT_TIMEZONE ('America/New_York') instead of null.
 *
 * Pure mapper test — no DB I/O.
 */

var mappers = require('../src/slices/task/domain/mappers/taskMappers');
var { PLACEMENT_MODES } = require('../src/lib/placementModes');

function fixedRow(overrides) {
  return Object.assign({
    id: 'apple_fixed_1',
    user_id: 'u1',
    task_type: 'task',
    text: 'Fixed event',
    status: '',
    placement_mode: PLACEMENT_MODES.FIXED,
    scheduled_at: '2026-06-20 11:00:00', // past UTC → would compute overdue
    deadline: null,
    implied_deadline: null,
    recurring: 0,
    dur: 30
  }, overrides);
}

describe('rowToTask null-tz regression (999.816)', () => {
  test('FIXED task + scheduled_at + null timezone does NOT throw', () => {
    expect(function () {
      mappers.rowToTask(fixedRow(), null, {});
    }).not.toThrow();
  });

  test('returns a usable task object (not a crash/empty)', () => {
    var t = mappers.rowToTask(fixedRow(), null, {});
    expect(t).toBeTruthy();
    expect(t.id).toBe('apple_fixed_1');
  });

  test('a past FIXED event still computes overdue under the default tz (feature preserved)', () => {
    // scheduled_at well in the past → overdue should resolve true via the
    // default-tz path, proving the fix kept the computation (not just silenced it).
    var t = mappers.rowToTask(fixedRow({ scheduled_at: '2020-01-01 12:00:00' }), null, {});
    expect(t.overdue).toBe(true);
  });

  test('explicit timezone still works (no regression for the normal path)', () => {
    expect(function () {
      mappers.rowToTask(fixedRow(), 'America/New_York', {});
    }).not.toThrow();
  });
});

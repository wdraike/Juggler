/**
 * event-newer-than-task.unit.test.js — DB-FREE decision-table unit tests for the
 * pure `isEventNewerThanTask(event, task)` tiebreaker extracted from the full-sync
 * conflict branch of controllers/cal-sync.controller.js (999.1025 inc. 7).
 *
 * This is the SIBLING of isEventModifiedExternally, and a DELIBERATELY DISTINCT
 * comparison (documented divergence — see event-modified-predicate.js header):
 *   - operands are event.lastModified vs the TASK's `_updated_at` (NOT the
 *     ledger's `last_modified_at`);
 *   - there is NO ETag fallback — it is the "last-modified wins" tiebreaker used
 *     only AFTER both sides are known to have changed, not the external-edit
 *     detector.
 * It shares ONE quirk with its sibling: the same >1000ms tolerance (a raw diff
 * with a 1-second window). PURE — no DB, no HTTP, no clock: event + task in,
 * boolean out.
 *
 * DB-FREE companion pin; the DB-backed byte-for-byte behavior stays owned by the
 * W4 golden master (conflict axis). The 1-second tolerance is a preserved quirk —
 * pinned here, NOT reconciled.
 */

'use strict';

var { isEventNewerThanTask } = require('../../src/slices/calendar/domain/event-modified-predicate');

// Reference instant: task._updated_at recorded 2026-06-10T00:00:00Z in MySQL
// datetime form (tz-less 'YYYY-MM-DD HH:MM:SS', as mysql2 dateStrings returns).
var TASK_UPD = '2026-06-10 00:00:00';

function makeEvent(over) {
  return Object.assign({}, over || {});
}
function makeTask(over) {
  return Object.assign({ _updated_at: TASK_UPD }, over || {});
}

// ── time comparison: >1000ms tolerance boundary (event.lastModified vs task._updated_at) ──

describe('isEventNewerThanTask — time comparison (>1000ms tolerance)', function () {
  it('1: event newer by 2000ms → true (event clearly wins the tiebreaker)', function () {
    expect(isEventNewerThanTask(
      makeEvent({ lastModified: '2026-06-10T00:00:02Z' }), makeTask()
    )).toBe(true);
  });

  it('2: event newer by exactly 1000ms → false (boundary is > not >=)', function () {
    expect(isEventNewerThanTask(
      makeEvent({ lastModified: '2026-06-10T00:00:01Z' }), makeTask()
    )).toBe(false);
  });

  it('3: event newer by 1001ms → true (just past the tolerance)', function () {
    expect(isEventNewerThanTask(
      makeEvent({ lastModified: '2026-06-10T00:00:01.001Z' }), makeTask()
    )).toBe(true);
  });

  it('4: event newer by 999ms → false (inside the tolerance window → task wins)', function () {
    expect(isEventNewerThanTask(
      makeEvent({ lastModified: '2026-06-10T00:00:00.999Z' }), makeTask()
    )).toBe(false);
  });

  it('5: event OLDER than task (negative delta) → false (task wins)', function () {
    expect(isEventNewerThanTask(
      makeEvent({ lastModified: '2026-06-09T23:59:55Z' }), makeTask()
    )).toBe(false);
  });

  it('6: event equal to task (delta 0) → false', function () {
    expect(isEventNewerThanTask(
      makeEvent({ lastModified: '2026-06-10T00:00:00Z' }), makeTask()
    )).toBe(false);
  });

  it('7: task._updated_at in MySQL "YYYY-MM-DD HH:MM:SS" form is parsed as UTC', function () {
    // taskMs = new Date(String(task._updated_at).replace(' ','T')+'Z').getTime()
    // If the space-form were parsed LOCAL, this comparison would drift by the tz
    // offset. Event 2s after the same wall-clock instant → event wins.
    expect(isEventNewerThanTask(
      makeEvent({ lastModified: '2026-06-10T00:00:02Z' }),
      makeTask({ _updated_at: '2026-06-10 00:00:00' })
    )).toBe(true);
  });

  it('8: operand is task._updated_at (not ledger.last_modified_at) — an unrelated ledger field is ignored', function () {
    // Passing a task whose _updated_at is far in the future makes the event the
    // loser regardless of any ledger timestamp — confirming the task field, not
    // the ledger field, is the second operand.
    expect(isEventNewerThanTask(
      makeEvent({ lastModified: '2026-06-10T00:00:05Z', last_modified_at: '2000-01-01 00:00:00' }),
      makeTask({ _updated_at: '2030-01-01 00:00:00' })
    )).toBe(false);
  });
});

// ── NaN guards: unparseable / absent timestamps → false ──────────────────────

describe('isEventNewerThanTask — NaN guards (absent or garbage timestamps)', function () {
  it('9: event.lastModified unparseable → false', function () {
    expect(isEventNewerThanTask(
      makeEvent({ lastModified: 'not-a-date' }), makeTask()
    )).toBe(false);
  });

  it('10: task._updated_at unparseable → false', function () {
    expect(isEventNewerThanTask(
      makeEvent({ lastModified: '2026-06-10T00:00:02Z' }),
      makeTask({ _updated_at: 'garbage' })
    )).toBe(false);
  });

  it('11: event.lastModified absent (undefined) → false', function () {
    expect(isEventNewerThanTask(
      makeEvent({}), makeTask()
    )).toBe(false);
  });

  it('12: task._updated_at absent (null) → false', function () {
    expect(isEventNewerThanTask(
      makeEvent({ lastModified: '2026-06-10T00:00:02Z' }),
      makeTask({ _updated_at: null })
    )).toBe(false);
  });
});

// ── documented divergence: NO ETag fallback (unlike isEventModifiedExternally) ─

describe('isEventNewerThanTask — NO ETag fallback (divergence from the external-edit predicate)', function () {
  it('13: no lastModified but etags differ → false (etags are never consulted here)', function () {
    expect(isEventNewerThanTask(
      makeEvent({ _etag: 'etag-new' }),
      makeTask({ _updated_at: null, provider_etag: 'etag-old' })
    )).toBe(false);
  });

  it('14: event newer past tolerance AND differing etags → still true on time alone (etags ignored)', function () {
    expect(isEventNewerThanTask(
      makeEvent({ lastModified: '2026-06-10T00:00:05Z', _etag: 'A' }),
      makeTask({ _updated_at: '2026-06-10 00:00:00', provider_etag: 'B' })
    )).toBe(true);
  });
});

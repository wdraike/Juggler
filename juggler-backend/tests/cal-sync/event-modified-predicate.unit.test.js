/**
 * event-modified-predicate.unit.test.js — DB-FREE decision-table unit tests for
 * the pure `isEventModifiedExternally(event, ledger)` predicate extracted from
 * the per-ledger sync loop in controllers/cal-sync.controller.js (999.1025 inc. 6).
 *
 * The predicate answers ONE question: "did the user edit this event on the
 * calendar side since our last sync?" It was FORKED at two byte-identical sites
 * inside sync() (the full-sync push/pull gate `eventModifiedExternally` and the
 * provider-origin pull gate `provEventModified`); inc. 6 unifies them into this
 * one pure function. It is PURE — no DB, no HTTP, no clock: event + ledger in,
 * boolean out.
 *
 * Two detection paths, mutually exclusive (the lastModified branch, once
 * ENTERED, never falls back to ETag):
 *   - lastModified present on BOTH sides → time comparison, 1-second tolerance:
 *     modified iff (event ms − ledger ms) > 1000. NaN on either side → false.
 *   - lastModified absent on either side, _etag present on both → ETag fallback
 *     for Apple CalDAV (iCloud VEVENTs carry no LAST-MODIFIED): modified iff
 *     event._etag !== ledger.provider_etag (exact, no tolerance).
 *   - otherwise → false.
 *
 * DB-FREE companion pin; the DB-backed byte-for-byte behavior stays owned by the
 * W4 golden master (axis S) + the W5 A6 source anchor. The 1-second tolerance and
 * the ETag fallback are preserved bugs/quirks — pinned here, NOT reconciled.
 */

'use strict';

var { isEventModifiedExternally } = require('../../src/slices/calendar/domain/event-modified-predicate');

// Reference instant: ledger recorded 2026-06-10T00:00:00Z (MySQL datetime form).
var LEDGER_MOD = '2026-06-10 00:00:00';

function makeEvent(over) {
  return Object.assign({}, over || {});
}
function makeLedger(over) {
  return Object.assign({ last_modified_at: LEDGER_MOD, provider_etag: null }, over || {});
}

// ── lastModified time path: 1-second tolerance boundary (both sides) ──────────

describe('isEventModifiedExternally — lastModified time path (>1000ms tolerance)', function () {
  it('1: event newer by 2000ms → true (clearly external edit)', function () {
    expect(isEventModifiedExternally(
      makeEvent({ lastModified: '2026-06-10T00:00:02Z' }), makeLedger()
    )).toBe(true);
  });

  it('2: event newer by exactly 1000ms → false (boundary is > not >=)', function () {
    expect(isEventModifiedExternally(
      makeEvent({ lastModified: '2026-06-10T00:00:01Z' }), makeLedger()
    )).toBe(false);
  });

  it('3: event newer by 1001ms → true (just past the tolerance)', function () {
    expect(isEventModifiedExternally(
      makeEvent({ lastModified: '2026-06-10T00:00:01.001Z' }), makeLedger()
    )).toBe(true);
  });

  it('4: event newer by 999ms → false (inside the tolerance window)', function () {
    expect(isEventModifiedExternally(
      makeEvent({ lastModified: '2026-06-10T00:00:00.999Z' }), makeLedger()
    )).toBe(false);
  });

  it('5: event OLDER than ledger (negative delta) → false', function () {
    expect(isEventModifiedExternally(
      makeEvent({ lastModified: '2026-06-09T23:59:55Z' }), makeLedger()
    )).toBe(false);
  });

  it('6: event equal to ledger (delta 0) → false', function () {
    expect(isEventModifiedExternally(
      makeEvent({ lastModified: '2026-06-10T00:00:00Z' }), makeLedger()
    )).toBe(false);
  });

  it('7: ledger last_modified_at in MySQL "YYYY-MM-DD HH:MM:SS" form is parsed as UTC', function () {
    // recordedModMs = new Date(String(ledger.last_modified_at).replace(' ','T')+'Z')
    // If the space-form were parsed LOCAL, this comparison would drift by the tz
    // offset. Event 2s after the same wall-clock instant → external edit.
    expect(isEventModifiedExternally(
      makeEvent({ lastModified: '2026-06-10T00:00:02Z' }),
      makeLedger({ last_modified_at: '2026-06-10 00:00:00' })
    )).toBe(true);
  });
});

// ── NaN handling: unparseable timestamps → false, NO ETag fallthrough ─────────

describe('isEventModifiedExternally — NaN guards (lastModified branch is exclusive)', function () {
  it('8: event.lastModified unparseable → false', function () {
    expect(isEventModifiedExternally(
      makeEvent({ lastModified: 'not-a-date' }), makeLedger()
    )).toBe(false);
  });

  it('9: ledger.last_modified_at unparseable → false', function () {
    expect(isEventModifiedExternally(
      makeEvent({ lastModified: '2026-06-10T00:00:02Z' }),
      makeLedger({ last_modified_at: 'garbage' })
    )).toBe(false);
  });

  it('10: unparseable lastModified does NOT fall back to a differing ETag → false', function () {
    // Both lastModified fields are truthy, so the predicate enters the time
    // branch and stays there — the ETag fallback is unreachable here even though
    // the etags differ. Characterized exclusivity, not a bug to reconcile.
    expect(isEventModifiedExternally(
      makeEvent({ lastModified: 'not-a-date', _etag: 'A' }),
      makeLedger({ last_modified_at: 'also-garbage', provider_etag: 'B' })
    )).toBe(false);
  });
});

// ── ETag fallback path (Apple CalDAV — no LAST-MODIFIED) ──────────────────────

describe('isEventModifiedExternally — ETag fallback (lastModified absent)', function () {
  it('11: no lastModified on either side, etags differ → true', function () {
    expect(isEventModifiedExternally(
      makeEvent({ _etag: 'etag-new' }),
      makeLedger({ last_modified_at: null, provider_etag: 'etag-old' })
    )).toBe(true);
  });

  it('12: no lastModified, etags equal → false', function () {
    expect(isEventModifiedExternally(
      makeEvent({ _etag: 'etag-same' }),
      makeLedger({ last_modified_at: null, provider_etag: 'etag-same' })
    )).toBe(false);
  });

  it('13: ledger.last_modified_at absent (event has lastModified) → falls to ETag path', function () {
    // `event.lastModified && ledger.last_modified_at` is false when the ledger
    // side is null, so the else-if ETag branch runs despite event.lastModified.
    expect(isEventModifiedExternally(
      makeEvent({ lastModified: '2026-06-10T00:00:02Z', _etag: 'X' }),
      makeLedger({ last_modified_at: null, provider_etag: 'Y' })
    )).toBe(true);
  });
});

// ── neither path applicable → false ──────────────────────────────────────────

describe('isEventModifiedExternally — no signals → false', function () {
  it('14: both lastModified null and both etag null → false (nothing to compare)', function () {
    expect(isEventModifiedExternally(
      makeEvent({ lastModified: null, _etag: null }),
      makeLedger({ last_modified_at: null, provider_etag: null })
    )).toBe(false);
  });

  it('15: no lastModified, event._etag present but ledger.provider_etag null → false', function () {
    expect(isEventModifiedExternally(
      makeEvent({ _etag: 'has-one' }),
      makeLedger({ last_modified_at: null, provider_etag: null })
    )).toBe(false);
  });

  it('16: no lastModified, ledger.provider_etag present but event._etag null → false', function () {
    expect(isEventModifiedExternally(
      makeEvent({ _etag: null }),
      makeLedger({ last_modified_at: null, provider_etag: 'has-one' })
    )).toBe(false);
  });
});

// ── exclusivity: lastModified takes precedence over ETag ──────────────────────

describe('isEventModifiedExternally — lastModified precedence over ETag', function () {
  it('17: both lastModified present within tolerance, etags differ → false (time path wins)', function () {
    // delta 500ms is inside tolerance → false, and the differing etags are
    // ignored because the lastModified branch was entered.
    expect(isEventModifiedExternally(
      makeEvent({ lastModified: '2026-06-10T00:00:00.500Z', _etag: 'A' }),
      makeLedger({ last_modified_at: '2026-06-10 00:00:00', provider_etag: 'B' })
    )).toBe(false);
  });

  it('18: both lastModified present past tolerance, etags equal → true (time path wins)', function () {
    expect(isEventModifiedExternally(
      makeEvent({ lastModified: '2026-06-10T00:00:05Z', _etag: 'same' }),
      makeLedger({ last_modified_at: '2026-06-10 00:00:00', provider_etag: 'same' })
    )).toBe(true);
  });
});

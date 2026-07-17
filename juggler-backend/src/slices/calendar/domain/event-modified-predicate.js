/**
 * event-modified-predicate.js — pure external-edit detection for cal-sync's sync().
 *
 * 999.1025 increment 6 (axis-S seam): extracts the "did the user edit this event
 * on the calendar side since our last sync?" predicate out of
 * controllers/cal-sync.controller.js. The predicate was FORKED at TWO sites
 * inside sync()'s per-ledger loop, byte-identical modulo local variable names:
 *   - the full-sync juggler-origin push/pull gate (`eventModifiedExternally`),
 *   - the provider-origin full-sync pull gate      (`provEventModified`).
 * Both computed the SAME boolean; increment 6 unifies them into this ONE pure
 * function. No DB, no HTTP, no clock — event + ledger in, boolean out.
 *
 * NOT folded in (documented divergence — a DIFFERENT comparison, left at the
 * call site): the full-sync conflict tiebreaker compares event.lastModified
 * against the TASK's `_updated_at` (not the ledger's `last_modified_at`) and has
 * NO ETag fallback — it is the "last-modified wins" tiebreaker, not the
 * external-edit predicate. It is intentionally NOT unified here.
 *
 * BEHAVIOR (preserved byte-for-byte — pinned by W4 axis S + W5 A6; the 1-second
 * tolerance and the ETag fallback are characterized quirks, NOT reconciled):
 *   - lastModified present on BOTH event and ledger → time comparison with a
 *     1-second tolerance: modified iff (event ms − ledger ms) > 1000. If either
 *     side parses to NaN → false. This branch is EXCLUSIVE: once entered it
 *     never falls back to ETag, even when both etags are present and differ.
 *   - lastModified absent on either side, BUT _etag present on both → ETag
 *     fallback for Apple CalDAV (iCloud VEVENTs carry no LAST-MODIFIED, so
 *     last_modified_at is always NULL for Apple rows): modified iff
 *     event._etag !== ledger.provider_etag (exact, no tolerance).
 *   - neither branch applicable → false.
 *
 * @param {Object} event   provider event (reads .lastModified and/or ._etag)
 * @param {Object} ledger  sync ledger row (reads .last_modified_at and/or .provider_etag)
 * @returns {boolean} true iff the event was modified externally since our last sync.
 */
'use strict';

function isEventModifiedExternally(event, ledger) {
  if (event.lastModified && ledger.last_modified_at) {
    var evModMs = new Date(event.lastModified).getTime();
    var recordedModMs = new Date(String(ledger.last_modified_at).replace(' ', 'T') + 'Z').getTime();
    if (!isNaN(evModMs) && !isNaN(recordedModMs)) {
      // 1-second tolerance: provider servers (especially MSFT) sometimes bump
      // lastModified by tens of ms internally even when no real edit occurred.
      // Without a tolerance window every push generates a phantom "externally
      // modified" detection on the next sync, triggering a pull that re-applies
      // the same scheduled_at and then fires enqueueScheduleRun, which loops
      // the system.
      return (evModMs - recordedModMs) > 1000;
    }
    return false;
  } else if (event._etag && ledger.provider_etag) {
    // ETag fallback for Apple CalDAV: LAST-MODIFIED is absent on iCloud VEVENTs,
    // so last_modified_at is always NULL for Apple rows. ETags change on every
    // server-side write and are exact — no tolerance needed.
    return event._etag !== ledger.provider_etag;
  }
  return false;
}

module.exports = { isEventModifiedExternally: isEventModifiedExternally };

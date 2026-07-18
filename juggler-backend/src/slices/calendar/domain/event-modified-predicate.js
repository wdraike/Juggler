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
 * SIBLING, NOT unified (documented divergence — a DIFFERENT comparison): the
 * full-sync conflict tiebreaker `isEventNewerThanTask(event, task)` (999.1025
 * inc. 7, below) compares event.lastModified against the TASK's `_updated_at`
 * (not the ledger's `last_modified_at`) and has NO ETag fallback — it is the
 * "last-modified wins" tiebreaker used only AFTER both sides are known to have
 * changed, not the external-edit detector. It shares ONLY the >1000ms tolerance
 * quirk with isEventModifiedExternally; the two are intentionally kept as
 * separate predicates rather than merged.
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

/**
 * isEventNewerThanTask — pure "last-modified wins" tiebreaker for cal-sync's
 * full-sync CONFLICT branch (both the task and the event changed since our last
 * sync). 999.1025 increment 7: extracted verbatim from the conflict resolution
 * in controllers/cal-sync.controller.js.
 *
 * DELIBERATELY DISTINCT from isEventModifiedExternally (see header):
 *   - the second operand is the TASK's `_updated_at` (MySQL tz-less form,
 *     normalized to UTC via `.replace(' ','T')+'Z'`), NOT the ledger's
 *     `last_modified_at`;
 *   - there is NO ETag fallback — this is a pure timestamp tiebreaker;
 *   - it shares the same >1000ms tolerance quirk (event must be newer by MORE
 *     than one second to win — providers bump lastModified by tens of ms on a
 *     no-op push, so a bare `>` would ping-pong).
 * If either side parses to NaN (absent/garbage timestamp) → false, i.e. the task
 * wins (push). PRESERVED byte-for-byte — pinned by the W4 golden master conflict
 * axis; the 1-second tolerance is a characterized quirk, NOT reconciled.
 *
 * @param {Object} event provider event (reads .lastModified)
 * @param {Object} task  resolved task row (reads ._updated_at)
 * @returns {boolean} true iff the event's lastModified is newer than the task's
 *   _updated_at by more than 1000ms (event wins → pull); false otherwise
 *   (task wins → push).
 */
function isEventNewerThanTask(event, task) {
  var evModMs = new Date(event.lastModified).getTime();
  var taskModMs = new Date(String(task._updated_at).replace(' ', 'T') + 'Z').getTime();
  return !isNaN(evModMs) && !isNaN(taskModMs) && (evModMs - taskModMs) > 1000;
}

module.exports = {
  isEventModifiedExternally: isEventModifiedExternally,
  isEventNewerThanTask: isEventNewerThanTask
};

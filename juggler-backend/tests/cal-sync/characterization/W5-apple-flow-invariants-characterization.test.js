/**
 * W5 — Apple/CalDAV sync() flow-invariant characterization (999.1025, increment 2)
 *
 * SAFETY ORACLE for the hexagonal extraction — DB-FREE companion to the W4
 * golden master. W4 pins the FULL observable behavior of sync() for gcal/msft
 * (17 scenarios, axes A–O) but DELIBERATELY DEFERS the Apple/CalDAV flow
 * ("Simulating the CalDAV URL-keyed store is an extraction-phase follow-up" —
 * see W4 header § AXES DELIBERATELY NOT COVERED). That leaves five
 * Apple-specific control-flow branches that live INLINE inside the ~1,880-line
 * sync() and are reached by NO golden master today. If the extraction silently
 * drops or reorders any of them, real data loss / duplicate-task bugs return
 * (each anchor below traces to a shipped Apple soak-test bug).
 *
 * These branches are NOT extractable to a pure function, so — exactly like the
 * W0 C1 (`(ledger.miss_count || 0) >= 1`) and B4 (`+ 60` window) pins — the
 * safest characterization that does NOT re-implement the logic locally is a
 * SOURCE-INSPECTION pin: read the REAL production source at test time and
 * assert the semantic anchor text. A mutation of the real file breaks the test;
 * a pure reformat (the anchors are chosen to survive whitespace changes) does
 * not.
 *
 * CONTRACT (same as W0): this is a PRE-extraction / early-extraction tripwire.
 * When the extraction LEGITIMATELY moves a branch out of
 * cal-sync.controller.js into a use-case/adapter, the corresponding anchor is
 * re-pointed at the new file as part of that reviewed structural change — the
 * DB-backed W4 Apple goldens (axes P + Q-T, 999.1025 inc. 2) are what survive
 * the move bit-for-bit. W5 is the fast DB-FREE tripwire that fails the instant
 * an anchor's source text changes, BEFORE the (test-bed-only) W4 golden run;
 * the two are complementary (W5 pins the source shape, W4 pins the DB effect).
 * Anchor→W4-axis map: A2 CDN-grace wiring→P, A3 dual-key dedup→R, A4
 * delete-by-URL→T, A6 ETag fallback→S.
 *
 * Anchors (each = one Apple-specific sync() branch + the bug it guards):
 *   1  CDN_GRACE_MS magnitude — apple:120s, none for gcal/msft
 *      (Apple CalDAV CDN lags >62s; without grace a just-pushed event reads as
 *       missing and the task is deleted after MISS_THRESHOLD syncs — soak Bug #2 class)
 *   2  CDN-grace WIRING — withinCdnGrace(ledger, pid) is consulted in the
 *      miss-ladder BEFORE the miss_count increment (order matters: grace must
 *      short-circuit the increment, not run after it)
 *   3  _url dual-key dedup — Apple events are indexed by BOTH VEVENT UID and
 *      CalDAV URL; both keys are claimed so the event is processed once
 *      (skips duplicate task creation / spurious orphan deletion)
 *   4  delete-by-URL fallback — deleteEvent/updateEvent target
 *      `event._url || ledger.provider_event_id` (CalDAV needs the URL, not the UID)
 *   5  Apple ingest-only is derived from user_calendars.sync_direction, NOT
 *      the provider-level cal_sync_settings.mode (multi-calendar model)
 *   6  ETag fallback — iCloud VEVENTs carry no LAST-MODIFIED, so external-edit
 *      detection falls back to `event._etag !== ledger.provider_etag`
 *
 * Fine-grained withinCdnGrace() unit behavior (null/undefined last_pushed_at,
 * within/past window, gcal/msft return false) is owned by
 * tests/apple-cal-cdn-grace.test.js — W5 adds only the flow-WIRING pin the unit
 * test cannot reach, plus a single magnitude cross-check.
 *
 * DB-FREE: reads source text + calls the exported pure withinCdnGrace(). No DB,
 * no network, no credentials. Runs under any jest config
 * (juggler-backend/jest.config.js).
 */

'use strict';

var fs = require('fs');
var path = require('path');

var CONTROLLER_PATH = path.resolve(
  __dirname, '../../../src/controllers/cal-sync.controller.js'
);
var src = fs.readFileSync(CONTROLLER_PATH, 'utf8');
var lines = src.split('\n');

// Requiring the controller is DB-free-safe: the DB singleton is lazy
// (getDefaultDb() on use, not on require) — same as tests/apple-cal-cdn-grace.test.js.
var calSyncController = require('../../../src/controllers/cal-sync.controller');

// 999.1025 inc. 3: the miss-ladder (`task && !event` branch) was extracted from
// the controller into the PURE use-case
// src/slices/calendar/domain/missing-event-decision.js (decisions in, effects
// out). Per THIS file's own contract (header: "When the extraction LEGITIMATELY
// moves a branch out of cal-sync.controller.js into a use-case/adapter, the
// corresponding anchor is re-pointed at the new file as part of that reviewed
// structural change"), Anchor 2 (CDN-grace WIRING / increment order) now reads
// the use-case source. The withinCdnGrace DEFINITION + CDN_GRACE_MS (Anchor 1)
// and every other anchor (3-6) stay in the controller and remain pinned there.
var USECASE_PATH = path.resolve(
  __dirname, '../../../src/slices/calendar/domain/missing-event-decision.js'
);
var usecaseSrc = fs.readFileSync(USECASE_PATH, 'utf8');
var usecaseLines = usecaseSrc.split('\n');

function firstLineIndex(needle) {
  return lines.findIndex(function (l) { return l.indexOf(needle) !== -1; });
}

function firstUsecaseLineIndex(needle) {
  return usecaseLines.findIndex(function (l) { return l.indexOf(needle) !== -1; });
}

// 999.1025 inc. 6: the external-edit predicate (`isEventModifiedExternally`,
// axis S) was FORKED at two byte-identical controller sites; the extraction
// unified both into the PURE module event-modified-predicate.js. Per THIS
// file's contract (header: re-point an anchor at its new home when a branch
// LEGITIMATELY moves out of the controller), Anchor 6 (ETag fallback) now reads
// the predicate source. W4 axis S is the DB-backed behavioral backstop.
var PREDICATE_PATH = path.resolve(
  __dirname, '../../../src/slices/calendar/domain/event-modified-predicate.js'
);
var predicateSrc = fs.readFileSync(PREDICATE_PATH, 'utf8');
var predicateLines = predicateSrc.split('\n');

function firstPredicateLineIndex(needle) {
  return predicateLines.findIndex(function (l) { return l.indexOf(needle) !== -1; });
}

// ─── Anchor 1: CDN grace magnitude (apple 120s, none for gcal/msft) ──────────

describe('W5-A1: CDN_GRACE_MS pins the Apple CalDAV propagation grace at 120s and NONE for gcal/msft', function () {
  it('A1-1: real source declares CDN_GRACE_MS = { apple: 120 * 1000 }', function () {
    // If this magnitude is dropped or shrunk below Apple CDN lag (>62s
    // observed), just-pushed Apple events read as missing and tasks get
    // deleted after MISS_THRESHOLD syncs (Apple soak Bug #2 class).
    expect(src).toContain('var CDN_GRACE_MS = { apple: 120 * 1000 };');
  });

  it('A1-2: grace is keyed by provider with a 0 default (gcal/msft have no grace)', function () {
    // withinCdnGrace reads CDN_GRACE_MS[pid] || 0 — gcal/msft (absent keys)
    // therefore get grace 0, so their miss ladder is never suppressed.
    expect(src).toContain('var grace = CDN_GRACE_MS[pid] || 0;');
  });

  it('A1-3: withinCdnGrace is exported so the miss-ladder wiring stays reachable', function () {
    expect(typeof calSyncController.withinCdnGrace).toBe('function');
  });

  it('A1-4: behavioral magnitude cross-check — apple grace covers ~119s, not ~121s (magnitude ≈ 120s)', function () {
    // Complements the source-text pin with a live probe of the CONSTANT's
    // magnitude (fine-grained cases owned by apple-cal-cdn-grace.test.js).
    var within = new Date(Date.now() - 119 * 1000).toISOString();
    var beyond = new Date(Date.now() - 121 * 1000).toISOString();
    expect(calSyncController.withinCdnGrace({ last_pushed_at: within }, 'apple')).toBe(true);
    expect(calSyncController.withinCdnGrace({ last_pushed_at: beyond }, 'apple')).toBe(false);
    // gcal/msft are never within grace regardless of recency.
    expect(calSyncController.withinCdnGrace({ last_pushed_at: within }, 'gcal')).toBe(false);
    expect(calSyncController.withinCdnGrace({ last_pushed_at: within }, 'msft')).toBe(false);
  });

  // ── A1-5: unguarded raw Date parse — a REAL, previously-unpinned gap ──────
  //
  // Found by W4 axis P (999.1025 inc. 2): withinCdnGrace's ONLY existing test
  // (apple-cal-cdn-grace.test.js) always seeds last_pushed_at via
  // `new Date(...).toISOString()` — a 'Z'-suffixed string that `new Date()`
  // parses identically on every host TZ. But the REAL caller
  // (cal-sync.controller.js's miss ladder) feeds withinCdnGrace a ledger row
  // read with dateStrings:true — a tz-LESS 'YYYY-MM-DD HH:MM:SS' string, same
  // shape as the TRAPS.md "mysql2 dateStrings + new Date() parses LOCAL"
  // class. withinCdnGrace does `new Date(ledger.last_pushed_at)` directly
  // (cal-sync.controller.js:53) — no localToUtc/parseDbUtc guard — so on a
  // non-UTC host this SAME tz-less string parses to a DIFFERENT instant than
  // intended (confirmed live: 'YYYY-MM-DD HH:MM:SS' on an America/New_York
  // process parses ~4h later than the identical instant's 'Z'-suffixed form).
  // The existing unit test's Z-suffixed seeds can never surface this because
  // they bypass the vulnerable code shape entirely.
  it('A1-5: withinCdnGrace parses last_pushed_at via a raw new Date() call — NOT a TZ-safe helper (source pin, host-TZ-independent)', function () {
    expect(src).toContain('return (Date.now() - new Date(ledger.last_pushed_at).getTime()) < grace;');
    // Confirms the vulnerable shape specifically: no localToUtc/parseDbUtc
    // wrapping ledger.last_pushed_at anywhere in withinCdnGrace's body.
    var fnStart = firstLineIndex('function withinCdnGrace(ledger, pid) {');
    var fnEnd = lines.findIndex(function (l, i) { return i > fnStart && l.trim() === '}'; });
    expect(fnStart).toBeGreaterThanOrEqual(0);
    expect(fnEnd).toBeGreaterThan(fnStart);
    var fnBody = lines.slice(fnStart, fnEnd + 1).join('\n');
    expect(fnBody).not.toMatch(/localToUtc|parseDbUtc/);
  });
});

// ─── Anchor 2: CDN-grace wiring precedes the miss-count increment ────────────

describe('W5-A2: the miss-ladder consults withinCdnGrace BEFORE incrementing miss_count', function () {
  // Anchored on the CALL-SITE form (`} else if (withinCdnGrace(ledger, pid)) {`),
  // not the bare `withinCdnGrace(ledger, pid)` substring — that bare form also
  // matches the FUNCTION DEFINITION (`function withinCdnGrace(ledger, pid) {`,
  // still in the controller), so it stays green even if the real miss-ladder
  // call is deleted — a false-green found by harrison review (999.1025 inc. 2).
  // 999.1025 inc. 3: the miss-ladder branch was extracted to the PURE use-case
  // (withinCdnGrace injected as a dependency, call-site form preserved), so this
  // anchor now reads `usecaseSrc`. W4 axis P is the behavioral backstop that
  // would catch a deleted call site end-to-end; this anchor pins the WIRING
  // (grace consulted before the increment) DB-free in its new home.
  it('A2-1: the call-site form `} else if (withinCdnGrace(ledger, pid)) {` is consulted inside the miss ladder', function () {
    expect(usecaseSrc).toContain('} else if (withinCdnGrace(ledger, pid)) {');
  });

  it('A2-2: the grace check appears BEFORE the miss_count increment (order-sensitive)', function () {
    // The grace branch must short-circuit the "event missing" ladder before
    // the increment — if it ran AFTER, a CDN-lagged Apple event would still
    // accrue a miss on every sync and be deleted at the threshold.
    var graceIdx = firstUsecaseLineIndex('} else if (withinCdnGrace(ledger, pid)) {');
    var incIdx = firstUsecaseLineIndex('var newMissCount = (ledger.miss_count || 0) + 1;');
    expect(graceIdx).toBeGreaterThanOrEqual(0);
    expect(incIdx).toBeGreaterThanOrEqual(0);
    expect(graceIdx).toBeLessThan(incIdx);
  });
});

// ─── Anchor 3: Apple _url dual-key dedup (UID + CalDAV URL) ──────────────────

describe('W5-A3: Apple pull dedups an event indexed under BOTH its UID and CalDAV URL', function () {
  it('A3-1: the URL sibling key is claimed when it differs from the UID', function () {
    // CalDAV returns the same event under two keys (UID and _url). Both are
    // claimed so the ingest loop processes it ONCE — otherwise duplicate
    // tasks (pull) or spurious orphan deletion (push) result.
    expect(src).toContain('if (newEvent._url && newEvent._url !== evId) {');
    expect(src).toContain('processedEventIds2.add(newEvent._url);');
  });

  it('A3-2: the UID sibling key is claimed when it differs from the URL', function () {
    expect(src).toContain('if (newEvent.id && newEvent.id !== evId) {');
    expect(src).toContain('processedEventIds2.add(newEvent.id);');
  });
});

// ─── Anchor 4: delete/update target the CalDAV URL, falling back to the UID ──

describe('W5-A4: Apple write ops target event._url, falling back to ledger.provider_event_id', function () {
  it('A4-1: the CalDAV-URL-first eventId expression is present', function () {
    // Apple deleteEvent/updateEvent need the CalDAV URL; gcal/msft fall back
    // to the provider_event_id (UID). A rewrite that drops the `_url` half
    // would 404 every Apple delete/update.
    expect(src).toContain('event._url || ledger.provider_event_id');
  });

  it('A4-2: the URL-first target is used for BOTH deleteEvent and pending update payloads', function () {
    var deleteUsesUrl = src.indexOf('deleteEvent(pToken, event._url || ledger.provider_event_id)') !== -1;
    var updateUsesUrl = src.indexOf('eventId: event._url || ledger.provider_event_id') !== -1;
    expect(deleteUsesUrl).toBe(true);
    expect(updateUsesUrl).toBe(true);
  });
});

// ─── Anchor 5: Apple ingest-only derived from user_calendars, not settings ───

describe('W5-A5: Apple effective sync mode is derived from user_calendars.sync_direction', function () {
  it('A5-1: appleHasFullSync queries an enabled apple calendar with sync_direction=full', function () {
    // Apple ignores provider-level cal_sync_settings.apple.mode (redundant,
    // not surfaced in the UI). A regression that keyed Apple off the settings
    // object instead would silently disable multi-calendar Apple push.
    expect(src).toContain("provider: 'apple', enabled: true, sync_direction: 'full'");
    expect(src).toContain('var appleHasFullSync = !!appleFullSyncRow;');
  });

  it('A5-2: isIngestOnly(apple) returns !appleHasFullSync, distinct from the settings-mode path', function () {
    expect(src).toContain('return !appleHasFullSync;');
    // The non-apple providers still key off cal_sync_settings[providerId].mode.
    expect(src).toContain("calSyncSettings[providerId].mode === 'ingest'");
  });
});

// ─── Anchor 6: ETag fallback for iCloud (no LAST-MODIFIED) ───────────────────

describe('W5-A6: external-edit detection falls back to ETag comparison for Apple CalDAV', function () {
  it('A6-1: an event._etag vs ledger.provider_etag comparison exists', function () {
    // iCloud VEVENTs have no LAST-MODIFIED, so ledger.last_modified_at is
    // always NULL for Apple rows; without the ETag fallback, external Apple
    // edits are never detected (calendar-side moves silently lost).
    // 999.1025 inc. 6: the predicate moved to event-modified-predicate.js, so
    // the assignment is now a `return`; anchor re-pointed at the predicate source.
    expect(predicateSrc).toContain('return event._etag !== ledger.provider_etag;');
  });

  it('A6-2: the ETag path is the else-branch of the lastModified comparison (fallback, not primary)', function () {
    var lastModIdx = firstPredicateLineIndex('if (event.lastModified && ledger.last_modified_at) {');
    var etagIdx = firstPredicateLineIndex('} else if (event._etag && ledger.provider_etag) {');
    expect(lastModIdx).toBeGreaterThanOrEqual(0);
    expect(etagIdx).toBeGreaterThanOrEqual(0);
    expect(lastModIdx).toBeLessThan(etagIdx);
  });
});

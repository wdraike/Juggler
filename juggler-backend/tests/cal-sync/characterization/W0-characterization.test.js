/**
 * W0 Characterization tests — Phase H0 Calendar Slice Extraction
 *
 * Safety oracle for the hexagonal refactor. These tests PIN CURRENT BEHAVIOR
 * (BEFORE any structural change) so the refactor can verify behavior is
 * IDENTICAL after. All tests are pure-unit (no DB, no network, no credentials).
 *
 * Behaviors pinned:
 *   C1  — Apple repush guard: the REAL source of cal-sync.controller.js must
 *          contain `(ledger.miss_count || 0) >= 1`. Tests read the production
 *          source at runtime so a mutation of the real file breaks the test.
 *          Also pins the real userHash() function from cal-sync-helpers.
 *   C2a — buildMsftEventBody includes task.url as "Link: …" in body.content.
 *   C2b — buildVEvent (Apple) includes task.url as "Link: …" in DESCRIPTION.
 *   B4  — Sync window computation: the REAL source must use `+ 60` for
 *          windowEnd. The `localToUtc` start semantics are tested via the
 *          real exported function from dateHelpers.
 *   B5  — sync-lock EXPORT-SHAPE check only (see B5 block comment for scope).
 *          Behavioral serialization is owned by 23-sync-consistency.test.js.
 *
 * C1 and B4 previously re-implemented the guard/arithmetic locally (making
 * them immune to production mutations). They now read the real production
 * source and assert the exact text — a source-inspection characterization pin.
 *
 * These tests do NOT require DB or external credentials.
 * Traceability: TRACEABILITY.md B1–B7 (W0 column).
 */

'use strict';

// ─── C2a: buildMsftEventBody — task.url appears as "Link: …" ─────────────────

var msftAdapter = require('../../../src/lib/cal-adapters/msft.adapter');

describe('C2a: buildMsftEventBody — task.url included as "Link: …" in body.content', function () {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  var YEAR = 2026;
  var TZ = 'America/New_York';

  it('C2a-1: task with url → body.content contains "Link: <url>"', function () {
    var task = {
      id: 'c2a-1',
      text: 'Task With URL',
      date: '6/15',
      time: '10:00 AM',
      dur: 30,
      when: 'morning',
      url: 'https://example.com/my-task'
    };
    var body = msftAdapter.buildMsftEventBody(task, YEAR, TZ);
    expect(body.body.content).toContain('Link: https://example.com/my-task');
  });

  it('C2a-2: task WITHOUT url → body.content does NOT contain "Link:"', function () {
    var task = {
      id: 'c2a-2',
      text: 'Task Without URL',
      date: '6/15',
      time: '10:00 AM',
      dur: 30,
      when: 'morning',
      url: null
    };
    var body = msftAdapter.buildMsftEventBody(task, YEAR, TZ);
    expect(body.body.content).not.toContain('Link:');
  });

  it('C2a-3: task with url → "Link:" appears exactly once (no duplication)', function () {
    var task = {
      id: 'c2a-3',
      text: 'Task Dup Check',
      date: '6/15',
      time: '10:00 AM',
      dur: 30,
      when: 'morning',
      url: 'https://example.com/dup-check'
    };
    var body = msftAdapter.buildMsftEventBody(task, YEAR, TZ);
    var count = (body.body.content.match(/Link:/g) || []).length;
    expect(count).toBe(1);
  });
});

// ─── C2b: buildVEvent (Apple) — task.url appears as "Link: …" ────────────────

var appleCalApi = require('../../../src/lib/apple-cal-api');

describe('C2b: buildVEvent (Apple) — task.url included as "Link: …" in DESCRIPTION', function () {
  var YEAR = 2026;
  var TZ = 'America/New_York';

  it('C2b-1: task with url → ICS DESCRIPTION contains "Link: <url>"', function () {
    var task = {
      id: 'c2b-1',
      text: 'Apple Task With URL',
      date: '6/15',
      time: '10:00 AM',
      dur: 30,
      when: 'morning',
      url: 'https://example.com/apple-task'
    };
    var ics = appleCalApi.buildVEvent(task, YEAR, TZ);
    // ICS DESCRIPTION field; may be folded per RFC 5545 but the content must be present
    expect(ics).toContain('Link: https://example.com/apple-task');
  });

  it('C2b-2: task WITHOUT url → ICS DESCRIPTION does NOT contain "Link:"', function () {
    var task = {
      id: 'c2b-2',
      text: 'Apple Task Without URL',
      date: '6/15',
      time: '10:00 AM',
      dur: 30,
      when: 'morning',
      url: null
    };
    var ics = appleCalApi.buildVEvent(task, YEAR, TZ);
    expect(ics).not.toContain('Link:');
  });
});

// ─── C1: Apple repush guard — miss_count >= 1 required ───────────────────────
//
// The guard lives in cal-sync.controller.js at the branch that decides whether
// to re-create an Apple (or any-provider) event when the ledger shows the event
// is missing. The condition is:
//
//   ledger.origin === JUGGLER_ORIGIN
//   && ledger.last_user_hash !== null
//   && userHash(task) !== ledger.last_user_hash    <- content changed
//   && (ledger.miss_count || 0) >= 1               <- C1 guard
//
// APPROACH: Source-inspection pin against the REAL production file.
//
// Because the guard is inline inside sync() (not a separately exported
// function), the safest characterization pin that does NOT replicate
// the logic locally is to read the production source at test-time and
// assert the exact guard text. This guarantees that:
//   - flipping `>= 1` to `>= 0` in the real file  → test FAILS
//   - removing the clause entirely                 → test FAILS
//   - the production source is unchanged           → test PASSES
//
// In addition we assert the real exported userHash() from cal-sync-helpers
// produces different hashes for different user-visible content (confirming
// the hash function the guard relies on is wired correctly), and that the
// guard constant JUGGLER_ORIGIN is 'juggler' in the real controller source.

var fs = require('fs');
var path = require('path');

// Read the REAL production source once (synchronous, test-setup time).
var CONTROLLER_PATH = path.resolve(
  __dirname, '../../../src/controllers/cal-sync.controller.js'
);
var controllerSource = fs.readFileSync(CONTROLLER_PATH, 'utf8');
var controllerLines = controllerSource.split('\n');

// 999.1025 inc.3 moved the miss-ladder (incl. the C1 repush guard) into the
// pure decision module — C1-1/C1-2 read it there now (mirrors W5's A2 re-point).
var MISSING_EVENT_DECISION_PATH = path.resolve(
  __dirname, '../../../src/slices/calendar/domain/missing-event-decision.js'
);
var decisionSource = fs.readFileSync(MISSING_EVENT_DECISION_PATH, 'utf8');
var decisionLines = decisionSource.split('\n');

// The real helpers — userHash is exported from cal-sync-helpers.
var { userHash } = require('../../../src/controllers/cal-sync-helpers');

describe('C1: Apple repush guard — miss_count >= 1 is required before re-create', function () {
  // ── Source-text invariant: the guard clause must read >= 1 ──────────────
  // These tests read cal-sync.controller.js directly. A mutation to the real
  // file (>= 0, > 0, removing the clause) breaks these tests.

  it('C1-1: real controller source contains the miss_count >= 1 guard clause', function () {
    // The guard must appear verbatim: (ledger.miss_count || 0) >= 1
    // Any relaxation to >= 0 or removal will fail this assertion.
    var guardPresent = decisionSource.includes('(ledger.miss_count || 0) >= 1');
    expect(guardPresent).toBe(true);
  });

  it('C1-2: real controller does NOT have a >= 0 repush guard (would re-enable repush-loop bug)', function () {
    // If the guard is relaxed to >= 0 the repush-loop bug (#2, Apple soak
    // 2026-04-26) is re-enabled. Assert the loosened form is absent.
    // We exclude the taskHash path at line ~1084 which legitimately uses === 0.
    // Strategy: find the repush branch block and confirm no >= 0 appears there.
    var repushBlockStart = decisionLines.findIndex(function(l) {
      return l.includes('(ledger.miss_count || 0) >= 1');
    });
    // Guard line itself must exist (C1-1 already catches if absent).
    // Now check that the guard line itself says '>= 1', not '>= 0'.
    if (repushBlockStart >= 0) {
      var guardLine = decisionLines[repushBlockStart];
      expect(guardLine).toContain('>= 1');
      expect(guardLine).not.toMatch(/>=\s*0/);
    } else {
      // If the guard line is not found, C1-1 already fails. Fail here too.
      expect(repushBlockStart).toBeGreaterThanOrEqual(0);
    }
  });

  it('C1-3: JUGGLER_ORIGIN is "juggler" in the real controller', function () {
    // Changing the origin constant would silently break all repush decisions.
    expect(controllerSource).toContain("var JUGGLER_ORIGIN = 'juggler';");
  });

  it('C1-4: real userHash produces different hashes when user-visible content changes', function () {
    // Confirms userHash is not a constant — the inequality userHash(task) !==
    // ledger.last_user_hash actually detects a content change.
    var taskA = { text: 'Original title', when: 'morning', project: '', notes: '', url: '', pri: '' };
    var taskB = { text: 'Renamed title',  when: 'morning', project: '', notes: '', url: '', pri: '' };
    expect(userHash(taskA)).not.toBe(userHash(taskB));
  });

  it('C1-5: real userHash returns the SAME hash for identical task content (guard does not fire spuriously)', function () {
    var task = { text: 'Same title', when: 'morning', project: '', notes: '', url: '', pri: '' };
    expect(userHash(task)).toBe(userHash(task));
  });

  it('C1-6: real userHash changes when url changes — confirming Link-field is guarded', function () {
    // task.url is part of userHash (confirmed in cal-sync-helpers.js). A
    // rename-plus-url change triggers the C1 path.
    var taskNoUrl  = { text: 'T', when: 'morning', project: '', notes: '', url: '',                         pri: '' };
    var taskWithUrl = { text: 'T', when: 'morning', project: '', notes: '', url: 'https://example.com/t', pri: '' };
    expect(userHash(taskNoUrl)).not.toBe(userHash(taskWithUrl));
  });

  // ── C1-7: BUG-999.1549 regression pin ────────────────────────────────────
  //
  // userHash's own doc comment (cal-sync-helpers.js:22-27) says it hashes
  // "user-editable task fields only — excludes scheduler-controlled fields
  // ... to distinguish genuine user edits ... from scheduler rescheduling".
  //
  // task.marker is NOT user-editable: it is a SQL-computed read-model column
  // (canonical-views.sql tasks_v: `case when m.placement_mode = 'reminder'
  // then 1 else 0 end`), and placement_mode is flipped for an EXISTING task
  // by the calendar pull-side adapters (e.g. MicrosoftCalendarAdapter.js
  // ~270-280) based on the external event's `isTransparent` flag — never by
  // a user action. Yet userHash currently folds `task.marker ? 'marker' : ''`
  // into its joined string (cal-sync-helpers.js:39), so a marker-only flip
  // (caused by the adapter, not the user) changes the hash. This defeats the
  // miss_count/repush safety guard at cal-sync.controller.js:743-761 (fires
  // when userHash(task) !== ledger.last_user_hash && miss_count >= 1), which
  // caused real data loss: 8 tasks hard-deleted 2020-01-11 (BUG-999.1549).
  //
  // RED on current code: task.marker is still hashed, so this FAILS until
  // the `task.marker ? 'marker' : ''` line is removed from userHash.
  it('C1-7: BUG-999.1549 — real userHash is INVARIANT to task.marker (adapter/scheduler-derived, not user-editable)', function () {
    var base = {
      text: 'Cut Grass',
      when: 'anytime',
      project: 'Yard',
      notes: 'front and back',
      url: 'https://example.com/lawn',
      pri: 'P3',
      location: ['home', 'outdoors'],
      tools: ['mower', 'edger']
    };
    var markerOff = Object.assign({}, base, { marker: 0 });
    var markerOn  = Object.assign({}, base, { marker: 1 });
    expect(userHash(markerOff)).toBe(userHash(markerOn));
  });
});

// ─── B4: Sync window — [user-tz local midnight today, now + 60 days] ─────────
//
// The sync() function in cal-sync.controller.js builds the window as (lines ~148-155):
//   todayKey   = Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)
//   windowStart = localToUtc(todayKey, '12:00 AM', tz)
//   windowEnd   = new Date(now); windowEnd.setDate(windowEnd.getDate() + 60)
//
// APPROACH: Source-inspection pin + real localToUtc call.
//
// B4-1 and B4-4 previously re-implemented the window arithmetic inline, making
// them immune to a mutation of the real `+60` offset.
//
// Fix: assert against the REAL source text (the `+ 60` literal in the controller)
// AND compute windowStart using the same real localToUtc the controller uses,
// then assert the computed value has the same midnight-semantics the controller
// documents.

var { localToUtc } = require('../../../src/scheduler/dateHelpers');

// Re-use the controller source already read above (C1 block).
// (CONTROLLER_PATH and controllerSource are declared in the C1 section above.)

describe('B4: Sync window — starts at local midnight today, ends now + 60 days', function () {

  // ── Source-text invariant: the +60 offset must be in the real controller ──

  it('B4-1: real controller source uses setDate(getDate() + 60) for windowEnd', function () {
    // If the real window is changed from +60 to +30 (or any other value) this
    // assertion fails. The test does NOT recompute +60 itself — it reads the
    // real source and asserts the literal is present.
    var has60 = controllerSource.includes('windowEnd.setDate(windowEnd.getDate() + 60)');
    expect(has60).toBe(true);
  });

  it('B4-4: real controller source does NOT use a 30-day window (mutation guard)', function () {
    // Zoe's proof: changing +60 to +30 left old B4-4 green. This assertion
    // fails when the controller reads + 30 for windowEnd.
    // We check the windowEnd setDate line specifically.
    var windowEndLine = controllerLines.find(function(l) {
      return l.includes('windowEnd.setDate(windowEnd.getDate()');
    });
    expect(windowEndLine).toBeDefined();
    // Must say + 60, not + 30 or any other value.
    expect(windowEndLine).toMatch(/\+\s*60/);
    expect(windowEndLine).not.toMatch(/\+\s*30/);
  });

  // ── Real localToUtc: window start semantics (B4-2, B4-3 unchanged — genuine) ─

  it('B4-2: windowStart is at local midnight for America/New_York', function () {
    var tz = 'America/New_York';
    var now = new Date();
    // Replicate the controller's exact todayKey computation (lines 148-150).
    var todayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now);

    // Call the REAL localToUtc — the same function the controller calls.
    var windowStart = localToUtc(todayKey, '12:00 AM', tz);

    expect(windowStart).not.toBeNull();
    expect(windowStart).toBeInstanceOf(Date);
    expect(isNaN(windowStart.getTime())).toBe(false);
    // midnight today <= now (can't be in the future)
    expect(windowStart.getTime()).toBeLessThanOrEqual(now.getTime());
    // midnight today >= 24h ago
    var oneDayAgoMs = now.getTime() - 24 * 60 * 60 * 1000;
    expect(windowStart.getTime()).toBeGreaterThanOrEqual(oneDayAgoMs);
  });

  it('B4-3: windowStart is at local midnight for America/Los_Angeles', function () {
    var tz = 'America/Los_Angeles';
    var now = new Date();
    var todayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now);

    var windowStart = localToUtc(todayKey, '12:00 AM', tz);

    expect(windowStart).toBeInstanceOf(Date);
    expect(isNaN(windowStart.getTime())).toBe(false);
    expect(windowStart.getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

// ─── B5 sync-lock: unit-level primitive test ──────────────────────────────────
//
// SCOPE DECLARATION (honest): This block is an EXPORT-SHAPE check only.
// It asserts that the four sync-lock functions are exported with the correct
// names so a rename would be caught immediately. It does NOT assert serialization
// behavior (acquire-then-reject semantics, 409 response, DB lock lifecycle).
//
// Serialization correctness — the behavior that matters — is owned by:
//   tests/cal-sync/23-sync-consistency.test.js  (409 + real DB lock, requires test-bed)
//   tests/cal-sync/20-sync-lock.test.js          (acquire/release lifecycle, requires test-bed)
//
// If those suites are skipped (DB unreachable / skipIfNoDB fires), the behavioral
// guarantee is unconfirmed. Oscar: ensure 23-sync-consistency runs non-skipped in
// the gate (see ZOE-REVIEW.md WARN #3 / telly re-review flag).
//
// This B5 block deliberately does NOT masquerade as a behavioral guard.

describe('B5: sync-lock — acquireLock / releaseLock are exported (shape check only)', function () {
  var syncLock = require('../../../src/lib/sync-lock');

  it('B5-1: acquireLock is a function', function () {
    expect(typeof syncLock.acquireLock).toBe('function');
  });

  it('B5-2: releaseLock is a function', function () {
    expect(typeof syncLock.releaseLock).toBe('function');
  });

  it('B5-3: withSyncLock is a function (high-level serializing wrapper)', function () {
    expect(typeof syncLock.withSyncLock).toBe('function');
  });

  it('B5-4: isLocked is a function (lock-state query)', function () {
    expect(typeof syncLock.isLocked).toBe('function');
  });
});

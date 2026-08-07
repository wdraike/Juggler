'use strict';

/**
 * checkmark-roundtrip.unit.test.js — 999.5272 regression guard.
 *
 * DB-FREE: requires the adapters via their legacy shim paths (same paths the
 * DB/creds-gated adapter suites in this directory already use for
 * buildEventBody/buildMsftEventBody/buildVEvent/applyEventToTaskFields), no
 * test-setup.js / assertDbAvailable() — these are pure-function round trips,
 * zero I/O, so they run unconditionally (no creds gate, no DB gate).
 *
 * David report 2026-08-07: "i notice done items are getting check marks on
 * their name... why are there items with multiple check marks?"
 *
 * Reproduces the ACTUAL mechanism, not just the regex: a done task's provider
 * event summary/subject/SUMMARY carries a "✓ " mark (push side, already
 * idempotent since 6556408b); the task is REOPENED; the pull path
 * (applyEventToTaskFields) reads that decorated provider title back in. Before
 * the fix, `text: event.title` wrote the mark straight into the stored task
 * text with no strip at all. The assertion is the ACTUAL stored `fields.text`
 * after a real push->pull round trip through the real production functions —
 * not a bare `stripDoneMark('✓ x') === 'x'` check, which would pass even if
 * the pull site were never wired to call it.
 */

var gcalAdapter = require('../../src/lib/cal-adapters/gcal.adapter');
var msftAdapter = require('../../src/lib/cal-adapters/msft.adapter');
var appleAdapter = require('../../src/lib/cal-adapters/apple.adapter');
var appleCalApi = require('../../src/lib/apple-cal-api');

function doneTask(text) {
  return { id: 't1', text: text, date: '2026-04-15', time: '9:00 AM', dur: 30, status: 'done', when: 'morning' };
}

function activeTask(text) {
  return { id: 't1', text: text, date: '2026-04-15', time: '9:00 AM', dur: 30, status: 'active', when: 'morning' };
}

// currentTask shape as applyEventToTaskFields' callers pass it (rowToTask
// output) — only the fields applyEventToTaskFields actually reads.
function reopenedCurrentTask(text) {
  return { text: text, when: 'morning', time: '9:00 AM', date: '2026-04-15' };
}

var TIMED_EVENT_BASE = {
  startDateTime: '2026-04-15T09:00:00',
  endDateTime: '2026-04-15T09:30:00',
  isAllDay: false,
  durationMinutes: 30,
  isTransparent: false,
  description: ''
};

function extractIcsSummary(ics) {
  var line = ics.split(/\r?\n/).find(function (l) { return l.indexOf('SUMMARY:') === 0; });
  return line ? line.slice('SUMMARY:'.length) : null;
}

describe('999.5272 — checkmark round trip: push (done) -> reopen -> pull', function () {
  it('GCal: reopened task pulls back CLEAN text, not the decorated provider summary', function () {
    var pushed = gcalAdapter.buildEventBody(doneTask('Buy milk'), 2026, 'America/New_York');
    expect(pushed.summary).toBe('✓ Buy milk'); // sanity: push side still decorates as before

    var pulledEvent = Object.assign({ title: pushed.summary }, TIMED_EVENT_BASE);
    var fields = gcalAdapter.applyEventToTaskFields(pulledEvent, 'America/New_York', reopenedCurrentTask('Buy milk'));

    expect(fields.text).toBe('Buy milk');
    expect(fields.text).not.toContain('✓');
  });

  it('MSFT: reopened task pulls back CLEAN text, not the decorated provider subject', function () {
    var pushed = msftAdapter.buildMsftEventBody(doneTask('Call dentist'), 2026, 'America/New_York');
    expect(pushed.subject).toBe('✓ Call dentist');

    var pulledEvent = Object.assign({ title: pushed.subject, startTimezone: null }, TIMED_EVENT_BASE);
    var fields = msftAdapter.applyEventToTaskFields(pulledEvent, 'America/New_York', reopenedCurrentTask('Call dentist'));

    expect(fields.text).toBe('Call dentist');
    expect(fields.text).not.toContain('✓');
  });

  it('Apple: reopened task pulls back CLEAN text, not the decorated provider SUMMARY', function () {
    var ics = appleCalApi.buildVEvent(doneTask('Water plants'), 2026, 'America/New_York');
    var pushedTitle = extractIcsSummary(ics);
    expect(pushedTitle).toBe('✓ Water plants');

    var pulledEvent = Object.assign({ title: pushedTitle }, TIMED_EVENT_BASE);
    var fields = appleAdapter.applyEventToTaskFields(pulledEvent, 'America/New_York', reopenedCurrentTask('Water plants'));

    expect(fields.text).toBe('Water plants');
    expect(fields.text).not.toContain('✓');
  });
});

describe("999.5272 — a user's OWN leading mark is never eaten", function () {
  // "✓ " is NOT a reserved prefix. A user may legitimately name a task
  // "✓ Deploy checklist". An earlier draft of this fix stripped on the active
  // push and on every pull, which silently renamed their provider event and
  // then erased the character from the app on the next pull — data loss in the
  // opposite direction from the bug being fixed. Push sends active text
  // verbatim; pull only removes a mark it can PROVE we added.
  it('GCal: an active task whose own title starts with a mark pushes it verbatim', function () {
    var body = gcalAdapter.buildEventBody(activeTask('✓ Deploy checklist'), 2026, 'America/New_York');
    expect(body.summary).toBe('✓ Deploy checklist');
  });

  it('MSFT: same — the mark survives the push', function () {
    var body = msftAdapter.buildMsftEventBody(activeTask('✓ Call dentist'), 2026, 'America/New_York');
    expect(body.subject).toBe('✓ Call dentist');
  });

  it('Apple: same — the mark survives the push', function () {
    var ics = appleCalApi.buildVEvent(activeTask('✓ Water plants'), 2026, 'America/New_York');
    expect(extractIcsSummary(ics)).toBe('✓ Water plants');
  });

  it('GCal: pulling that event back does NOT strip the user\'s mark', function () {
    // Stored text already carries the mark, so removing it would NOT yield the
    // stored text — proof the mark is the user's, not ours.
    var fields = gcalAdapter.applyEventToTaskFields(
      { title: '✓ Deploy checklist' },
      'America/New_York',
      reopenedCurrentTask('✓ Deploy checklist')
    );
    expect(fields.text).toBe('✓ Deploy checklist');
  });

  it('GCal: a title genuinely renamed provider-side is taken verbatim, mark and all', function () {
    // Stored "Buy milk", provider now says "✓ Something else" — we cannot prove
    // the mark is ours, so we must not delete it.
    var fields = gcalAdapter.applyEventToTaskFields(
      { title: '✓ Something else' },
      'America/New_York',
      reopenedCurrentTask('Buy milk')
    );
    expect(fields.text).toBe('✓ Something else');
  });
});

describe('999.5272 — idempotency: syncing twice does not change the title', function () {
  it('GCal: push -> pull -> push -> pull is stable at the clean title', function () {
    var body1 = gcalAdapter.buildEventBody(doneTask('Renew passport'), 2026, 'America/New_York');
    var pulled1 = gcalAdapter.applyEventToTaskFields(
      Object.assign({ title: body1.summary }, TIMED_EVENT_BASE),
      'America/New_York',
      reopenedCurrentTask('Renew passport')
    );

    var body2 = gcalAdapter.buildEventBody(doneTask(pulled1.text), 2026, 'America/New_York');
    var pulled2 = gcalAdapter.applyEventToTaskFields(
      Object.assign({ title: body2.summary }, TIMED_EVENT_BASE),
      'America/New_York',
      reopenedCurrentTask(pulled1.text)
    );

    expect(pulled1.text).toBe('Renew passport');
    expect(pulled2.text).toBe('Renew passport');
    expect(body1.summary).toBe(body2.summary);
  });

  it('MSFT: push -> pull -> push -> pull is stable at the clean title', function () {
    var body1 = msftAdapter.buildMsftEventBody(doneTask('File taxes'), 2026, 'America/New_York');
    var pulled1 = msftAdapter.applyEventToTaskFields(
      Object.assign({ title: body1.subject, startTimezone: null }, TIMED_EVENT_BASE),
      'America/New_York',
      reopenedCurrentTask('File taxes')
    );

    var body2 = msftAdapter.buildMsftEventBody(doneTask(pulled1.text), 2026, 'America/New_York');
    var pulled2 = msftAdapter.applyEventToTaskFields(
      Object.assign({ title: body2.subject, startTimezone: null }, TIMED_EVENT_BASE),
      'America/New_York',
      reopenedCurrentTask(pulled1.text)
    );

    expect(pulled1.text).toBe('File taxes');
    expect(pulled2.text).toBe('File taxes');
    expect(body1.subject).toBe(body2.subject);
  });
});

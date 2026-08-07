'use strict';

/**
 * notes-roundtrip-999-5283.unit.test.js — 999.5283 regression guard.
 *
 * DB-FREE: requires the adapters via their legacy shim paths (same paths
 * checkmark-roundtrip.unit.test.js already uses for buildEventBody /
 * buildMsftEventBody / buildVEvent / applyEventToTaskFields) — pure-function
 * round trips, zero I/O, run unconditionally.
 *
 * Reproduces the ACTUAL mechanism the ticket's evidence describes: push a
 * task with project/pri/notes/url set (the real build*EventBody /
 * buildVEvent composites them into ONE description/body), edit ONLY the
 * Notes line on the provider side (as a user would in Google/Outlook/iCloud),
 * pull it back through the real applyEventToTaskFields, and assert the
 * ACTUAL returned `fields.notes` — not a bare extractNotesFromDescription()
 * unit check, which would pass even if the pull site were never wired to
 * call it (see description-notes-parse-999-5283.unit.test.js for that).
 */

var gcalAdapter = require('../../src/lib/cal-adapters/gcal.adapter');
var msftAdapter = require('../../src/lib/cal-adapters/msft.adapter');
var appleAdapter = require('../../src/lib/cal-adapters/apple.adapter');
var appleCalApi = require('../../src/lib/apple-cal-api');

function linkedTask(overrides) {
  return Object.assign({
    id: 't1', text: 'Ship the report', date: '2026-04-15', time: '9:00 AM', dur: 30,
    status: '', when: 'morning',
    project: 'Q3 Launch', pri: 'P1', notes: 'old notes', url: 'https://example.com/doc'
  }, overrides);
}

// currentTask shape as applyEventToTaskFields' real caller passes it
// (rowToTask output) — only the fields the pull path actually reads.
function currentTaskFor(task) {
  return {
    text: task.text, when: task.when, time: task.time, date: task.date,
    project: task.project, pri: task.pri, notes: task.notes, url: task.url
  };
}

var TIMED_EVENT_BASE = {
  startDateTime: '2026-04-15T09:00:00',
  endDateTime: '2026-04-15T09:30:00',
  isAllDay: false,
  durationMinutes: 30,
  isTransparent: false
};

describe('999.5283 — an already-linked task pulls back an edited Notes line', function () {
  it('GCal: notes round-trips; project/pri/url do NOT', function () {
    var task = linkedTask();
    var pushed = gcalAdapter.buildEventBody(task, 2026, 'America/New_York');
    var editedDescription = pushed.description.replace('Notes: old notes', 'Notes: USER EDITED THIS ON GOOGLE CALENDAR');

    var pulledEvent = Object.assign({ title: pushed.summary, description: editedDescription }, TIMED_EVENT_BASE);
    var fields = gcalAdapter.applyEventToTaskFields(pulledEvent, 'America/New_York', currentTaskFor(task));

    expect(fields.notes).toBe('USER EDITED THIS ON GOOGLE CALENDAR');
    expect(fields.project).toBeUndefined();
    expect(fields.pri).toBeUndefined();
    expect(fields.url).toBeUndefined();
  });

  it('MSFT: notes round-trips; project/pri/url do NOT', function () {
    var task = linkedTask();
    var pushed = msftAdapter.buildMsftEventBody(task, 2026, 'America/New_York');
    var editedContent = pushed.body.content.replace('Notes: old notes', 'Notes: USER EDITED THIS ON OUTLOOK');

    var pulledEvent = Object.assign({ title: pushed.subject, description: editedContent, startTimezone: null }, TIMED_EVENT_BASE);
    var fields = msftAdapter.applyEventToTaskFields(pulledEvent, 'America/New_York', currentTaskFor(task));

    expect(fields.notes).toBe('USER EDITED THIS ON OUTLOOK');
    expect(fields.project).toBeUndefined();
    expect(fields.pri).toBeUndefined();
    expect(fields.url).toBeUndefined();
  });

  it('Apple: notes round-trips; project/pri/url do NOT', function () {
    var task = linkedTask();
    var ics = appleCalApi.buildVEvent(task, 2026, 'America/New_York');
    var edited = ics.replace('old notes', 'USER EDITED THIS ON ICLOUD');
    var parsed = appleCalApi.parseVEvents(edited, 'https://cal.example/x.ics', '"etag1"');

    var pulledEvent = Object.assign({}, parsed[0], TIMED_EVENT_BASE, { title: parsed[0].title });
    var fields = appleAdapter.applyEventToTaskFields(pulledEvent, 'America/New_York', currentTaskFor(task));

    expect(fields.notes).toBe('USER EDITED THIS ON ICLOUD');
    expect(fields.project).toBeUndefined();
    expect(fields.pri).toBeUndefined();
    expect(fields.url).toBeUndefined();
  });

  it('GCal: a genuinely external event (no Juggler marker) never writes notes', function () {
    var task = linkedTask();
    var pulledEvent = Object.assign({ title: 'Some Meeting', description: 'Bring snacks, meet in lobby' }, TIMED_EVENT_BASE);
    var fields = gcalAdapter.applyEventToTaskFields(pulledEvent, 'America/New_York', currentTaskFor(task));

    expect(fields.notes).toBeUndefined();
  });

  it('GCal: a description with no notes at all leaves task.notes untouched (no key written)', function () {
    var task = linkedTask({ project: null, pri: null, notes: null, url: null });
    var pushed = gcalAdapter.buildEventBody(task, 2026, 'America/New_York');
    var pulledEvent = Object.assign({ title: pushed.summary, description: pushed.description }, TIMED_EVENT_BASE);
    var fields = gcalAdapter.applyEventToTaskFields(pulledEvent, 'America/New_York', currentTaskFor(task));

    expect(fields.notes).toBeUndefined();
  });
});

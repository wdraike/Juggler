'use strict';

/**
 * description-notes-parse-999-5283.unit.test.js — pure-function unit tests
 * for descriptionParse.js's extractNotesFromDescription.
 *
 * DB-FREE: zero I/O, pure string logic — runs unconditionally like
 * checkmark-roundtrip.unit.test.js.
 */

var { extractNotesFromDescription } = require('../../src/slices/calendar/domain/descriptionParse');

function currentTask(overrides) {
  return Object.assign({ project: null, pri: null, notes: null, url: null }, overrides);
}

function buildDescription(task) {
  var parts = [];
  if (task.project) parts.push('Project: ' + task.project);
  if (task.pri) parts.push('Priority: ' + task.pri);
  if (task.notes) parts.push('Notes: ' + task.notes);
  if (task.url) parts.push('Link: ' + task.url);
  parts.push('', 'Synced from Raike & Sons');
  return parts.join('\n');
}

describe('999.5283 — extractNotesFromDescription', function () {
  it('extracts a plain notes edit when the description matches the exact composited template', function () {
    var task = currentTask({ project: 'Q3 Launch', pri: 'P1', notes: 'old notes', url: 'https://example.com/doc' });
    var pushed = buildDescription(task);
    // User edits Notes on the provider side, keeping everything else intact.
    var edited = pushed.replace('Notes: old notes', 'Notes: USER EDITED THIS ON GOOGLE CALENDAR');

    var result = extractNotesFromDescription(edited, task);
    expect(result).toBe('USER EDITED THIS ON GOOGLE CALENDAR');
  });

  it('extracts notes when project/pri/notes/url are ALL present (the exact ticket repro shape)', function () {
    var task = currentTask({ project: 'Q3 Launch', pri: 'P1', notes: 'x', url: 'https://x' });
    var description = 'Project: Q3 Launch\nPriority: P1\nNotes: USER EDITED THIS ON GOOGLE CALENDAR\nLink: https://x\n\nSynced from Raike & Sons';
    var result = extractNotesFromDescription(description, task);
    expect(result).toBe('USER EDITED THIS ON GOOGLE CALENDAR');
  });

  it('extracts a NEW notes value even when the task previously had none', function () {
    var task = currentTask({ project: null, pri: null, notes: null, url: null });
    var description = 'Notes: brand new note\n\nSynced from Raike & Sons';
    var result = extractNotesFromDescription(description, task);
    expect(result).toBe('brand new note');
  });

  it('preserves embedded newlines in the notes content', function () {
    var task = currentTask({ url: 'https://example.com' });
    var description = 'Notes: line one\nline two\nline three\nLink: https://example.com\n\nSynced from Raike & Sons';
    var result = extractNotesFromDescription(description, task);
    expect(result).toBe('line one\nline two\nline three');
  });

  it('returns null (do not write) when the marker suffix is missing — not a Juggler-origin push', function () {
    var task = currentTask({ notes: 'old' });
    var result = extractNotesFromDescription('Notes: old\nLink: https://x', task);
    expect(result).toBeNull();
  });

  it('returns null when the description is a genuinely external event with unrelated free text', function () {
    var task = currentTask({});
    var result = extractNotesFromDescription('Bring snacks, meet in lobby at 9am', task);
    expect(result).toBeNull();
  });

  it('returns null when project/pri/url lines do not match the CURRENT task (structural drift — cannot prove intent)', function () {
    var task = currentTask({ project: 'Q3 Launch', notes: 'x' });
    // Provider still shows a STALE project line the task no longer has.
    var description = 'Project: Old Project\nNotes: edited\n\nSynced from Raike & Sons';
    var result = extractNotesFromDescription(description, task);
    expect(result).toBeNull();
  });

  it('returns null when there is no Notes: line at all (nothing to extract, not a "clear notes" signal)', function () {
    var task = currentTask({ project: 'Q3 Launch' });
    var description = 'Project: Q3 Launch\n\nSynced from Raike & Sons';
    var result = extractNotesFromDescription(description, task);
    expect(result).toBeNull();
  });

  it('returns null for a non-string description (e.g. undefined)', function () {
    expect(extractNotesFromDescription(undefined, currentTask({}))).toBeNull();
    expect(extractNotesFromDescription(null, currentTask({}))).toBeNull();
  });

  it('returns null for an empty string description', function () {
    expect(extractNotesFromDescription('', currentTask({}))).toBeNull();
  });
});

/**
 * both-exist-disposition.unit.test.js — DB-FREE decision-table unit tests for the
 * pure pre-dispatch disposition extracted from cal-sync.controller.js's "both
 * exist" branch (999.1025 increment 11).
 *
 * The use-case owns the two guards at the top of the both-exist branch of the
 * per-ledger sync loop, evaluated in the original order:
 *   (1) recurring template with a live event → 'skip' (no effect)
 *   (2) unscheduled juggler-origin task in push mode → 'delete' (deleteEvent effect)
 *   (3) otherwise → 'proceed' (fall through to origin push/pull routing)
 *
 * It is PURE — decisions in, effects out: given a resolved context it returns a
 * plain descriptor {action, deleteTarget, taskUpdates, ledgerUpdates, logs,
 * statsDelta}. The deleteEvent/throttle effect (and its 404/410 swallow) is
 * applied by the controller through the SHARED applyTerminalDelete applier at the
 * call site, NOT here. No DB, no HTTP, no provider clients.
 *
 * This is the DB-FREE companion pin. The DB-backed byte-for-byte behavior is
 * owned by the W4 golden master (test-bed only). The delete descriptor is shaped
 * EXACTLY like decideTerminalTaskSync so applyTerminalDelete can be reused, and
 * the `event._url || ledger.provider_event_id` delete-target semantics are
 * preserved EXACTLY (both halves pinned below).
 */

'use strict';

var { decideBothExistDisposition } = require('../../src/slices/calendar/domain/both-exist-disposition');

var JUGGLER_ORIGIN = 'juggler';

// ── Fixture builders ─────────────────────────────────────────────────────────

function makeTask(over) {
  return Object.assign({ id: 't-1', text: 'Mow lawn', taskType: 'one-off', unscheduled: false }, over || {});
}
function makeEvent(over) {
  return Object.assign({ _url: 'https://caldav.icloud.com/home/w4t-1.ics' }, over || {});
}
function makeLedger(over) {
  return Object.assign({
    id: 'led-1', origin: JUGGLER_ORIGIN, provider_event_id: 'prov-123'
  }, over || {});
}
function makeCtx(over) {
  return Object.assign({
    task: makeTask(),
    event: makeEvent(),
    ledger: makeLedger(),
    isIngestOnly: false,
    JUGGLER_ORIGIN: JUGGLER_ORIGIN,
    eventIdColumn: 'provider_event_id'
  }, over || {});
}
function decide(over) {
  return decideBothExistDisposition(makeCtx(over));
}
function isInert(d) {
  return d.taskUpdates.length === 0 &&
    d.ledgerUpdates.length === 0 &&
    d.logs.length === 0 &&
    d.statsDelta.deleted_local === 0;
}

// ── Decision table ───────────────────────────────────────────────────────────

describe('decideBothExistDisposition — proceed (fall through to origin routing, no effect)', function () {
  it('1: scheduled one-off juggler task → proceed, no mutation', function () {
    var d = decide();
    expect(d.action).toBe('proceed');
    expect(d.deleteTarget).toBe(null);
    expect(isInert(d)).toBe(true);
  });

  it('2: unscheduled but NON-juggler origin → proceed (we do not own foreign events)', function () {
    var d = decide({ task: makeTask({ unscheduled: true }), ledger: makeLedger({ origin: 'gcal' }) });
    expect(d.action).toBe('proceed');
    expect(isInert(d)).toBe(true);
  });

  it('3: unscheduled juggler task but ingest-only provider → proceed (read-only, never mutate)', function () {
    var d = decide({ task: makeTask({ unscheduled: true }), isIngestOnly: true });
    expect(d.action).toBe('proceed');
    expect(isInert(d)).toBe(true);
  });

  it('4: defensive — missing event → proceed', function () {
    var d = decide({ event: null });
    expect(d.action).toBe('proceed');
    expect(isInert(d)).toBe(true);
  });

  it('5: defensive — missing task → proceed', function () {
    var d = decide({ task: null });
    expect(d.action).toBe('proceed');
    expect(isInert(d)).toBe(true);
  });
});

describe('decideBothExistDisposition — skip (recurring template, no effect)', function () {
  it('6: recurring_template → skip, no mutation', function () {
    var d = decide({ task: makeTask({ taskType: 'recurring_template' }) });
    expect(d.action).toBe('skip');
    expect(d.deleteTarget).toBe(null);
    expect(isInert(d)).toBe(true);
  });

  it('7: template precedence — recurring_template AND unscheduled → skip (template check is first)', function () {
    var d = decide({ task: makeTask({ taskType: 'recurring_template', unscheduled: true }) });
    expect(d.action).toBe('skip');
    expect(isInert(d)).toBe(true);
  });

  it('8: template skip ignores origin/ingest guards (unconditional)', function () {
    var d = decide({
      task: makeTask({ taskType: 'recurring_template' }),
      ledger: makeLedger({ origin: 'gcal' }),
      isIngestOnly: true
    });
    expect(d.action).toBe('skip');
    expect(isInert(d)).toBe(true);
  });
});

describe('decideBothExistDisposition — delete (unscheduled juggler task, push mode)', function () {
  it('9: unscheduled juggler task, push mode → delete; clears event id + ledger deleted_local + stat', function () {
    var d = decide({ task: makeTask({ unscheduled: true }) });
    expect(d.action).toBe('delete');
    expect(d.deleteTarget).toBe('https://caldav.icloud.com/home/w4t-1.ics');
    expect(d.taskUpdates).toEqual([{ id: 't-1', fields: { provider_event_id: null } }]);
    expect(d.ledgerUpdates).toEqual([{ id: 'led-1', fields: { status: 'deleted_local', provider_event_id: null } }]);
    expect(d.statsDelta.deleted_local).toBe(1);
    expect(d.logs).toHaveLength(0);
  });

  it('10: delete target — event._url present → CalDAV URL, not the VEVENT UID (Apple)', function () {
    var d = decide({
      task: makeTask({ unscheduled: true }),
      event: makeEvent({ _url: 'https://caldav.icloud.com/w4/calendars/home/w4t-1.ics' }),
      ledger: makeLedger({ provider_event_id: 'APPLE-VEVENT-UID-1' })
    });
    expect(d.deleteTarget).toBe('https://caldav.icloud.com/w4/calendars/home/w4t-1.ics');
    expect(d.deleteTarget).not.toBe('APPLE-VEVENT-UID-1');
  });

  it('11: delete target fallback — no event._url → ledger.provider_event_id', function () {
    var d = decide({
      task: makeTask({ unscheduled: true }),
      event: makeEvent({ _url: undefined }),
      ledger: makeLedger({ provider_event_id: 'gcal-evt-999' })
    });
    expect(d.deleteTarget).toBe('gcal-evt-999');
  });

  it('12: honors the per-provider eventIdColumn passed in ctx', function () {
    var d = decide({ task: makeTask({ unscheduled: true }), eventIdColumn: 'gcal_event_id' });
    expect(d.taskUpdates).toEqual([{ id: 't-1', fields: { gcal_event_id: null } }]);
  });
});

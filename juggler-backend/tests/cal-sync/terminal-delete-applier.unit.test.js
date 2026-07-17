/**
 * terminal-delete-applier.unit.test.js — DB-FREE unit test for the terminal
 * decision's delete EFFECT (999.1025 inc. 4, harrison WARN follow-up).
 *
 * decideTerminalTaskSync (terminal-task-decision.js) is pure and can't cover
 * deleteEvent error semantics; that behavior now lives in the small applier
 * `applyTerminalDelete`, exported from cal-sync.controller.js as a mockable
 * seam (same pattern as `withinCdnGrace` — see apple-cal-cdn-grace.test.js).
 * No DB, no network: pAdapter/throttle are plain jest mocks.
 *
 * Pins the exact semantics that used to live in the old (now-removed)
 * lib/cal-sync-helpers.js handleTerminalTaskSync:
 *   - 404/410 from deleteEvent is swallowed — the decision's mutation buffers
 *     are still returned (so the caller's loop continues normally)
 *   - any other error propagates out uncaught
 */

'use strict';

var calSyncController = require('../../src/controllers/cal-sync.controller');
var applyTerminalDelete = calSyncController.applyTerminalDelete;

var describeOrSkip = applyTerminalDelete ? describe : describe.skip;

function makeDecision(over) {
  return Object.assign({
    action: 'delete',
    deleteTarget: 'https://caldav.icloud.com/home/w4t-1.ics',
    taskUpdates: [{ id: 't-1', fields: { provider_event_id: null } }],
    ledgerUpdates: [{ id: 'led-1', fields: { status: 'deleted_local', provider_event_id: null } }],
    statsDelta: { deleted_local: 1 }
  }, over || {});
}

describeOrSkip('applyTerminalDelete', function () {
  it('deleteEvent succeeds → calls deleteEvent + throttle, returns decision buffers unchanged', async function () {
    var deleteEvent = jest.fn().mockResolvedValue(true);
    var throttle = jest.fn().mockResolvedValue(true);
    var decision = makeDecision();

    var applied = await applyTerminalDelete({ deleteEvent: deleteEvent }, 'tok', throttle, decision);

    expect(deleteEvent).toHaveBeenCalledWith('tok', decision.deleteTarget);
    expect(throttle).toHaveBeenCalled();
    expect(applied.taskUpdates).toEqual(decision.taskUpdates);
    expect(applied.ledgerUpdates).toEqual(decision.ledgerUpdates);
    expect(applied.statsDelta).toEqual({ deleted_local: 1 });
  });

  it('404 from deleteEvent is swallowed — mutation buffers still returned (loop continues)', async function () {
    var deleteEvent = jest.fn().mockRejectedValue(new Error('404 Not Found'));
    var throttle = jest.fn().mockResolvedValue(true);
    var decision = makeDecision();

    var applied = await applyTerminalDelete({ deleteEvent: deleteEvent }, 'tok', throttle, decision);

    expect(deleteEvent).toHaveBeenCalled();
    expect(applied.taskUpdates).toEqual(decision.taskUpdates);
    expect(applied.ledgerUpdates).toEqual(decision.ledgerUpdates);
    expect(applied.statsDelta).toEqual({ deleted_local: 1 });
  });

  it('410 from deleteEvent is swallowed — same as 404', async function () {
    var deleteEvent = jest.fn().mockRejectedValue(new Error('410 Gone'));
    var throttle = jest.fn().mockResolvedValue(true);
    var decision = makeDecision();

    var applied = await applyTerminalDelete({ deleteEvent: deleteEvent }, 'tok', throttle, decision);

    expect(applied.ledgerUpdates).toEqual(decision.ledgerUpdates);
  });

  it('non-4xx error (500) from deleteEvent propagates out of the applier', async function () {
    var deleteEvent = jest.fn().mockRejectedValue(new Error('500 Internal Error'));
    var throttle = jest.fn().mockResolvedValue(true);
    var decision = makeDecision();

    await expect(applyTerminalDelete({ deleteEvent: deleteEvent }, 'tok', throttle, decision))
      .rejects.toThrow('500 Internal Error');
    expect(throttle).not.toHaveBeenCalled();
  });
});

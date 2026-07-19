/**
 * done-frozen-policy.unit.test.js — DB-FREE decision-table unit tests for the
 * two pure sides of the done_frozen ledger lifecycle carved from
 * controllers/cal-sync.controller.js (999.2062, residuals [done-frozen-skip] +
 * [done-frozen-freeze]):
 *
 *   decideDoneFrozenSkip(ctx)  — [FIX D-03] already-frozen rows skip the push;
 *                                returns the ledger-update + log descriptors.
 *   shouldFreezeDonePush(ctx)  — [FIX D-02] freeze a done task's row after its
 *                                first successful push (calCompletedBehavior
 *                                'update' only).
 *
 * PURE — ledgerUpdates.push / stats bumps / logSyncAction stay at the call site.
 */

'use strict';

var { decideDoneFrozenSkip, shouldFreezeDonePush } = require('../../src/slices/calendar/domain/done-frozen-policy');

function ctx(over) {
  return Object.assign({
    task: { id: 't1', text: 'Task text' },
    event: { title: 'Event title' },
    ledger: { id: 'L1', status: 'done_frozen', provider_event_id: 'ev-1' }
  }, over || {});
}

describe('decideDoneFrozenSkip', function () {
  it('ledger not done_frozen → none', function () {
    var d = decideDoneFrozenSkip(ctx({ ledger: { id: 'L1', status: 'active', provider_event_id: 'ev-1' } }));
    expect(d.action).toBe('none');
  });

  it('done_frozen + event with title → skip; event_summary = event.title, miss_count reset', function () {
    var d = decideDoneFrozenSkip(ctx());
    expect(d.action).toBe('skip');
    expect(d.ledgerUpdate).toEqual({ id: 'L1', fields: { event_summary: 'Event title', miss_count: 0 } });
  });

  it('done_frozen + event WITHOUT title → event_summary falls back to task.text', function () {
    var d = decideDoneFrozenSkip(ctx({ event: { title: '' } }));
    expect(d.ledgerUpdate.fields.event_summary).toBe('Task text');
  });

  it('done_frozen + no event → event_summary = task.text', function () {
    var d = decideDoneFrozenSkip(ctx({ event: null }));
    expect(d.ledgerUpdate.fields.event_summary).toBe('Task text');
  });

  it('log descriptor: skipped + taskId/taskText/eventId', function () {
    var d = decideDoneFrozenSkip(ctx());
    expect(d.log).toEqual({
      action: 'skipped',
      opts: { taskId: 't1', taskText: 'Task text', eventId: 'ev-1' }
    });
  });

  it('null task (event present with title) → log ids null, summary from event', function () {
    var d = decideDoneFrozenSkip(ctx({ task: null }));
    expect(d.ledgerUpdate.fields.event_summary).toBe('Event title');
    expect(d.log.opts).toEqual({ taskId: null, taskText: null, eventId: 'ev-1' });
  });
});

describe('shouldFreezeDonePush', function () {
  it('done task + behavior update → freeze', function () {
    expect(shouldFreezeDonePush({ task: { status: 'done' }, calCompletedBehavior: 'update' })).toBe(true);
  });

  it('done task + behavior keep → no freeze', function () {
    expect(shouldFreezeDonePush({ task: { status: 'done' }, calCompletedBehavior: 'keep' })).toBe(false);
  });

  it('non-done task → no freeze', function () {
    expect(shouldFreezeDonePush({ task: { status: 'active' }, calCompletedBehavior: 'update' })).toBe(false);
  });

  it('missing task → no freeze', function () {
    expect(shouldFreezeDonePush({ task: null, calCompletedBehavior: 'update' })).toBe(false);
  });
});

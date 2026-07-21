/**
 * tasks-write-reset-ledger-guard.test.js — 999.1218 destructive-path guard.
 *
 * resetRecurringInstances cleans cal_sync_ledger (status -> 'deleted_local')
 * BEFORE hard-deleting future pending instances. A failure of that ledger
 * update MUST abort the delete: cal-lock is ledger-only (an active ledger row
 * = the task's edit-lock), so swallowing the error and deleting anyway leaves
 * ACTIVE ledger rows pointing at deleted task_ids — orphaned edit-locks and
 * remote calendar events that are never cleaned up.
 *
 * Pure unit — fake knex-ish dbOrTrx, no DB. Written failing-first against the
 * old `.catch(function(err){ logger.error(...) })` silent-swallow.
 */

var twrite = require('../src/lib/tasks-write');

/**
 * Minimal fake of the knex surface resetRecurringInstances touches:
 *   dbOrTrx('task_instances').where({...}).where(fn).pluck('id')  -> future ids
 *   dbOrTrx('cal_sync_ledger').where(...).whereIn(...).where(...).update({...})
 *   dbOrTrx('task_instances').where('user_id', ...).whereIn(...).del()
 *   dbOrTrx.fn.now()
 */
function makeFakeTrx(opts) {
  var calls = { ledgerUpdates: 0, instanceDeletes: 0 };

  function chain(table) {
    var c = {
      _table: table,
      where: function () { return c; },
      whereIn: function () { return c; },
      whereNull: function () { return c; },
      orWhere: function () { return c; },
      pluck: function () { return Promise.resolve(opts.futureIds); },
      update: function () {
        if (table === 'cal_sync_ledger') {
          calls.ledgerUpdates += 1;
          if (opts.ledgerFails) {
            return Promise.reject(new Error('ER_LOCK_WAIT_TIMEOUT: ledger update failed'));
          }
          return Promise.resolve(opts.futureIds.length);
        }
        return Promise.resolve(0);
      },
      del: function () {
        if (table === 'task_instances') calls.instanceDeletes += 1;
        return Promise.resolve(opts.futureIds.length);
      }
    };
    return c;
  }

  var trx = function (table) { return chain(table); };
  trx.fn = { now: function () { return new Date(); } };
  trx._calls = calls;
  return trx;
}

describe('resetRecurringInstances — ledger failure aborts the hard-delete (999.1218)', function () {
  beforeEach(() => {
    // Date-only fake timers (999.2157): Date frozen, every timer API real — no hangs
    installDateOnlyFakeTimers(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects when the cal_sync_ledger update fails and does NOT delete instances', async function () {
    var trx = makeFakeTrx({ futureIds: [11, 12], ledgerFails: true });

    await expect(
      twrite.resetRecurringInstances(trx, 'user-1', 42, '[TEST] reset')
    ).rejects.toThrow(/ledger update failed/);

    expect(trx._calls.ledgerUpdates).toBe(1);
    expect(trx._calls.instanceDeletes).toBe(0); // destructive step must not run
  });

  it('happy path: ledger update succeeds, instances are deleted, count returned', async function () {
    var trx = makeFakeTrx({ futureIds: [11, 12], ledgerFails: false });

    var n = await twrite.resetRecurringInstances(trx, 'user-1', 42, null);

    expect(n).toBe(2);
    expect(trx._calls.ledgerUpdates).toBe(1);
    expect(trx._calls.instanceDeletes).toBe(1);
  });

  it('no future pending instances: returns 0 and never touches ledger or delete', async function () {
    var trx = makeFakeTrx({ futureIds: [], ledgerFails: true });

    var n = await twrite.resetRecurringInstances(trx, 'user-1', 42, null);

    expect(n).toBe(0);
    expect(trx._calls.ledgerUpdates).toBe(0);
    expect(trx._calls.instanceDeletes).toBe(0);
  });
});

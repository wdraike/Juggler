/**
 * CalSyncPort signature regression (999.354 / 999.488 / 999.489).
 *
 * The cal-sync-linked task read is `fetchTasksWithEventIds(userId, queryBuilder)`
 * — TWO args. Four callers (user-config export, two cal-sync.controller sync
 * paths, MCP export) historically passed the legacy 3-arg
 * `(db, userId, queryBuilder)` shape, so a knex handle landed in the `userId`
 * slot and serialized to an empty `(select *)` subquery → ER_NO_TABLES_USED
 * against cal_sync_ledger/tasks_v (silently-empty export, broken sync).
 *
 * These tests pin the CORRECT 2-arg shape at the promoted CalSyncPort seam so the
 * regression cannot silently return (the golden-master only asserted the
 * `extraTasks` KEY existed, never its contents — which is why the bug shipped).
 */

'use strict';

var TaskSliceCalSyncAdapter = require('../../../../src/slices/user-config/adapters/TaskSliceCalSyncAdapter');
var CalSyncPort = require('../../../../src/slices/user-config/domain/ports/CalSyncPort');

describe('TaskSliceCalSyncAdapter — CalSyncPort 2-arg signature (999.488/489)', function () {
  test('fetchTasksWithEventIds forwards (userId, queryBuilder) verbatim — userId is a STRING, not a knex handle', function () {
    var seen = null;
    var fakeFacade = {
      fetchTasksWithEventIds: function (userId, queryBuilder) {
        seen = { userId: userId, queryBuilder: queryBuilder, argCount: arguments.length };
        return Promise.resolve([{ id: 't1' }]);
      },
      rowToTask: function (r) { return r; }
    };
    var adapter = new TaskSliceCalSyncAdapter({ taskFacade: fakeFacade });
    var qb = function (q) { q.orderBy('created_at', 'asc'); };

    return adapter.fetchTasksWithEventIds('user-123', qb).then(function (rows) {
      expect(seen.argCount).toBe(2);                 // NOT 3 — no db first-arg
      expect(seen.userId).toBe('user-123');          // a real user id string
      expect(typeof seen.userId).not.toBe('function');
      expect(typeof seen.userId).not.toBe('object'); // never a knex handle
      expect(typeof seen.queryBuilder).toBe('function');
      expect(rows).toEqual([{ id: 't1' }]);
    });
  });

  test('rowToTask delegates to the task facade mapper', function () {
    var fakeFacade = {
      fetchTasksWithEventIds: function () { return Promise.resolve([]); },
      rowToTask: function (row, tz) { return { mapped: row.id, tz: tz }; }
    };
    var adapter = new TaskSliceCalSyncAdapter({ taskFacade: fakeFacade });
    expect(adapter.rowToTask({ id: 'r1' }, 'UTC')).toEqual({ mapped: 'r1', tz: 'UTC' });
  });

  test('adapter implements the full CalSyncPort method set', function () {
    var adapter = new TaskSliceCalSyncAdapter({ taskFacade: {} });
    CalSyncPort.CAL_SYNC_PORT_METHODS.forEach(function (m) {
      expect(typeof adapter[m]).toBe('function');
    });
  });

  test('base CalSyncPort throws (not-implemented contract)', function () {
    var port = new CalSyncPort();
    expect(function () { port.fetchTasksWithEventIds('u'); }).toThrow(/not implemented/);
    expect(function () { port.rowToTask({}, 'UTC'); }).toThrow(/not implemented/);
  });
});

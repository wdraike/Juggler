/**
 * backward-dep-warning.unit.test.js — DB-FREE unit tests for the pure
 * `computeBackwardDepWarning(ctx)` helper carved from the pull branch of
 * controllers/cal-sync.controller.js (999.2062, residual [backward-dep-warning]).
 *
 * When a calendar edit pulls a task's scheduled_at to BEFORE a task it depends
 * on, the pull still happens — but the sync_history detail carries a warning.
 * PURE — string in, string out; the logSyncAction effect stays at the call site.
 */

'use strict';

var { computeBackwardDepWarning } = require('../../src/slices/calendar/domain/backward-dep-warning');

var TASKS_BY_ID = {
  dep1: { id: 'dep1', _scheduled_at: '2026-06-15T10:00:00Z' },
  dep2: { id: 'dep2', _scheduled_at: '2026-06-15T14:00:00Z' },
  depNoTime: { id: 'depNoTime', _scheduled_at: null }
};

describe('computeBackwardDepWarning — empty-string cases', function () {
  it('no pulled scheduled_at → ""', function () {
    expect(computeBackwardDepWarning({ scheduledAt: null, dependsOn: ['dep1'], tasksById: TASKS_BY_ID })).toBe('');
  });

  it('dependsOn not an array → ""', function () {
    expect(computeBackwardDepWarning({ scheduledAt: '2026-06-15T09:00:00Z', dependsOn: 'dep1', tasksById: TASKS_BY_ID })).toBe('');
  });

  it('dependsOn empty → ""', function () {
    expect(computeBackwardDepWarning({ scheduledAt: '2026-06-15T09:00:00Z', dependsOn: [], tasksById: TASKS_BY_ID })).toBe('');
  });

  it('dependency not in tasksById → ""', function () {
    expect(computeBackwardDepWarning({ scheduledAt: '2026-06-15T09:00:00Z', dependsOn: ['ghost'], tasksById: TASKS_BY_ID })).toBe('');
  });

  it('dependency has no _scheduled_at → ""', function () {
    expect(computeBackwardDepWarning({ scheduledAt: '2026-06-15T09:00:00Z', dependsOn: ['depNoTime'], tasksById: TASKS_BY_ID })).toBe('');
  });

  it('pulled AFTER its dependency → ""', function () {
    expect(computeBackwardDepWarning({ scheduledAt: '2026-06-15T11:00:00Z', dependsOn: ['dep1'], tasksById: TASKS_BY_ID })).toBe('');
  });
});

describe('computeBackwardDepWarning — violation cases', function () {
  it('pulled BEFORE its dependency → warning names the dependency', function () {
    expect(computeBackwardDepWarning({ scheduledAt: '2026-06-15T09:00:00Z', dependsOn: ['dep1'], tasksById: TASKS_BY_ID }))
      .toBe('Task promoted to before dependency dep1');
  });

  it('first violating dependency in dependsOn order wins (break on first hit)', function () {
    expect(computeBackwardDepWarning({ scheduledAt: '2026-06-15T09:00:00Z', dependsOn: ['dep2', 'dep1'], tasksById: TASKS_BY_ID }))
      .toBe('Task promoted to before dependency dep2');
  });

  it('non-violating deps are skipped until a violating one is found', function () {
    expect(computeBackwardDepWarning({ scheduledAt: '2026-06-15T12:00:00Z', dependsOn: ['dep1', 'dep2'], tasksById: TASKS_BY_ID }))
      .toBe('Task promoted to before dependency dep2');
  });

  it('Date-object _scheduled_at works the same as ISO strings', function () {
    var byId = { d: { id: 'd', _scheduled_at: new Date('2026-06-15T10:00:00Z') } };
    expect(computeBackwardDepWarning({ scheduledAt: '2026-06-15T09:00:00Z', dependsOn: ['d'], tasksById: byId }))
      .toBe('Task promoted to before dependency d');
  });
});

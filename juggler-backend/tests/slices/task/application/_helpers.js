/**
 * Shared fakes for the W5 application-layer tests.
 *
 * These fakes stand in for the injected collaborators that are OUTSIDE the W3/W4
 * ports (projects upsert, scheduler-lock queue, raw-table side-effect blocks, the
 * scheduler trigger). The ports themselves use the REAL InMemoryTaskRepository /
 * RedisTaskCache-shaped fake / EventBusTaskEvents-shaped fake so the orchestration
 * is exercised against the actual contract surface.
 *
 * S4/S6 instrumentation: `makeTriggerSpy()` records every enqueueScheduleRun call
 * with its args; `makeEventsSpy()` records publishes. The events spy has ZERO edge
 * to the trigger spy — proving a publish cannot cause a second/cascading trigger.
 */

'use strict';

var mappers = require('../../../../src/slices/task/domain/mappers/taskMappers');
var validation = require('../../../../src/slices/task/domain/validation/taskValidation');
var dateHelpers = require('../../../../src/scheduler/dateHelpers');
var { PLACEMENT_MODES } = require('../../../../src/lib/placementModes');
var { splitFields } = require('../../../../src/lib/task-write-queue');
var { isTerminalStatus } = require('../../../../src/lib/task-status');

// ── enqueueScheduleRun trigger spy (S4/S6) ───────────────────────────────────
function makeTriggerSpy() {
  var calls = [];
  function enqueueScheduleRun(userId, source, ids, options) {
    calls.push({ userId: userId, source: source, ids: ids, options: options || {} });
  }
  enqueueScheduleRun.calls = calls;
  return enqueueScheduleRun;
}

// ── TaskCachePort fake ───────────────────────────────────────────────────────
function makeCacheFake(seed) {
  var store = seed || {};
  var calls = { getTasks: 0, setTasks: 0, getVersion: 0, setVersion: 0, invalidateTasks: 0 };
  return {
    _store: store,
    calls: calls,
    getTasks: function (userId) { calls.getTasks++; return Promise.resolve(store['tasks:' + userId] || null); },
    setTasks: function (userId, payload) { calls.setTasks++; store['tasks:' + userId] = payload; return Promise.resolve(); },
    getVersion: function (userId) { calls.getVersion++; return Promise.resolve(store['version:' + userId] || null); },
    setVersion: function (userId, payload) { calls.setVersion++; store['version:' + userId] = payload; return Promise.resolve(); },
    invalidateTasks: function (userId) {
      calls.invalidateTasks++;
      delete store['tasks:' + userId];
      delete store['version:' + userId];
      return Promise.resolve();
    }
  };
}

// ── TaskEventPort fake (publisher only — NO scheduler edge, E-1/S4/S6) ────────
function makeEventsSpy() {
  var published = [];
  return {
    published: published,
    publishTaskCreated: function (t) { published.push({ type: 'created', task: t }); return null; },
    publishTaskUpdated: function (t) { published.push({ type: 'updated', task: t }); return null; },
    publishTaskCompleted: function (t) { published.push({ type: 'completed', task: t }); return null; }
  };
}

// ── ensureProject spy (records calls — W5-2) ─────────────────────────────────
// Returns a recording function AND a `calls` array. Dropping the `ensureProject`
// call from a use-case FAILS any test that checks calls.length > 0.
function makeEnsureProjectSpy() {
  var calls = [];
  function ensureProject(userId, project) {
    calls.push({ userId: userId, project: project });
    return Promise.resolve();
  }
  ensureProject.calls = calls;
  return ensureProject;
}

// ── triggerCalSync spy (records .sync calls — W5-2) ──────────────────────────
// Mirrors the real triggerCalSync interface: { sync(opts) }.
// Dropping the `triggerCalSync.sync(...)` call from a use-case FAILS any test
// that checks syncSpy.calls.length > 0.
function makeTriggerCalSyncSpy() {
  var calls = [];
  var spy = {
    calls: calls,
    sync: function (opts) {
      calls.push(opts || {});
    }
  };
  return spy;
}

// safeTimezone passthrough that mimics the real one for a known tz.
function safeTimezone(tz) { return tz || 'America/New_York'; }

// Base dep bundle shared by the command use-cases (the pure + spy collaborators).
function baseDeps(extra) {
  var deps = {
    mappers: mappers,
    validation: validation,
    dateHelpers: dateHelpers,
    placementModes: PLACEMENT_MODES,
    splitFieldsLib: { splitFields: splitFields },
    hasSchedulingFields: function (row) {
      if (!row) return false;
      return Object.keys(splitFields(row).schedulingFields).length > 0;
    },
    isTerminalStatus: isTerminalStatus,
    safeTimezone: safeTimezone,
    ensureProject: function () { return Promise.resolve(); },
    isLocked: function () { return Promise.resolve(false); },
    enqueueWrite: function () { return Promise.resolve(); },
    uuidv7: function () { return 'gen-' + Math.random().toString(36).slice(2, 10); },
    sleep: function () { return Promise.resolve(); }
  };
  return Object.assign(deps, extra || {});
}

module.exports = {
  mappers: mappers,
  validation: validation,
  dateHelpers: dateHelpers,
  PLACEMENT_MODES: PLACEMENT_MODES,
  splitFields: splitFields,
  isTerminalStatus: isTerminalStatus,
  makeTriggerSpy: makeTriggerSpy,
  makeCacheFake: makeCacheFake,
  makeEventsSpy: makeEventsSpy,
  makeEnsureProjectSpy: makeEnsureProjectSpy,
  makeTriggerCalSyncSpy: makeTriggerCalSyncSpy,
  safeTimezone: safeTimezone,
  baseDeps: baseDeps
};

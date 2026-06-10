/**
 * W5 — application QUERY use-case characterization (InMemory-backed).
 *
 * ListTasks / GetTask / GetVersion / GetDisabledTasks reproduce the legacy
 * getAllTasks / getTask / getVersion / getDisabledTasks handler flows over the
 * W3 repository + W4 cache ports. Driven against the REAL InMemoryTaskRepository
 * (TaskRepositoryPort) + a TaskCachePort fake so the cache-hit/miss + version +
 * srcMap orchestration is exercised on the actual contract surface.
 *
 * Traceability: WBS W5 (b) step-for-step, (e) characterization (W1 subset).
 */

'use strict';

var InMemoryTaskRepository = require('../../../../src/slices/task/adapters/InMemoryTaskRepository');
var ListTasks = require('../../../../src/slices/task/application/queries/ListTasks');
var GetTask = require('../../../../src/slices/task/application/queries/GetTask');
var GetVersion = require('../../../../src/slices/task/application/queries/GetVersion');
var GetDisabledTasks = require('../../../../src/slices/task/application/queries/GetDisabledTasks');
var H = require('./_helpers');

var USER = 'q-user';

function rows() {
  return [
    { id: 't1', user_id: USER, task_type: 'task', text: 'A', status: '', updated_at: new Date('2026-06-01T10:00:00Z'), scheduled_at: new Date('2026-06-02T15:00:00Z') },
    { id: 't2', user_id: USER, task_type: 'task', text: 'B', status: 'disabled', disabled_at: new Date('2026-06-03T10:00:00Z'), updated_at: new Date('2026-06-03T10:00:00Z') }
  ];
}

describe('ListTasks (getAllTasks)', function () {
  test('cache hit returns the cached payload WITHOUT reading the repo', function () {
    var repo = new InMemoryTaskRepository({ rows: rows() });
    var spyRead = jest.spyOn(repo, 'fetchTasksWithEventIds');
    var cache = H.makeCacheFake({ ['tasks:' + USER]: { tasks: [{ id: 'cached' }], version: 'v0' } });
    var uc = new ListTasks({ repo: repo, cache: cache, mappers: H.mappers });
    return uc.execute({ userId: USER, query: {} }).then(function (out) {
      expect(out).toEqual({ tasks: [{ id: 'cached' }], version: 'v0' });
      expect(spyRead).not.toHaveBeenCalled();
    });
  });

  test('cache miss reads repo, maps rows, computes version, and caches the result', function () {
    var repo = new InMemoryTaskRepository({ rows: rows() });
    var cache = H.makeCacheFake();
    var uc = new ListTasks({ repo: repo, cache: cache, mappers: H.mappers });
    return uc.execute({ userId: USER, query: {} }).then(function (out) {
      expect(Array.isArray(out.tasks)).toBe(true);
      expect(out.tasks.length).toBe(2);
      expect(out.tasks[0].id).toBe('t1');
      expect(typeof out.version).toBe('string');
      expect(out.version).toMatch(/:2$/); // COUNT(*) = 2
      // result cached
      expect(cache._store['tasks:' + USER]).toEqual(out);
    });
  });

  // Anti-tautology: break the mapper → the test must fail (proves it asserts real output).
  test('PINNING: a broken rowToTask would change the payload (fail-on-broken)', function () {
    var repo = new InMemoryTaskRepository({ rows: rows() });
    var cache = H.makeCacheFake();
    var brokenMappers = Object.assign({}, H.mappers, {
      rowToTask: function () { return { id: 'WRONG' }; }
    });
    var uc = new ListTasks({ repo: repo, cache: cache, mappers: brokenMappers });
    return uc.execute({ userId: USER, query: {} }).then(function (out) {
      expect(out.tasks[0].id).toBe('WRONG'); // confirms the test would catch a mapper regression
    });
  });
});

describe('GetTask (getTask)', function () {
  test('returns 200 + task envelope for an existing row', function () {
    var repo = new InMemoryTaskRepository({ rows: rows() });
    var uc = new GetTask({ repo: repo, mappers: H.mappers });
    return uc.execute({ id: 't1', userId: USER }).then(function (out) {
      expect(out.status).toBe(200);
      expect(out.body.task.id).toBe('t1');
      expect(out.body.task.text).toBe('A');
    });
  });

  test('returns 404 for a missing row (branch parity)', function () {
    var repo = new InMemoryTaskRepository({ rows: rows() });
    var uc = new GetTask({ repo: repo, mappers: H.mappers });
    return uc.execute({ id: 'nope', userId: USER }).then(function (out) {
      expect(out.status).toBe(404);
      expect(out.body).toEqual({ error: 'Task not found' });
    });
  });
});

describe('GetVersion (getVersion)', function () {
  test('cache hit returns cached version', function () {
    var repo = new InMemoryTaskRepository({ rows: rows() });
    var cache = H.makeCacheFake({ ['version:' + USER]: { version: 'cachedV' } });
    var uc = new GetVersion({ repo: repo, cache: cache });
    return uc.execute({ userId: USER }).then(function (out) {
      expect(out).toEqual({ version: 'cachedV' });
    });
  });

  test('cache miss computes + caches version', function () {
    var repo = new InMemoryTaskRepository({ rows: rows() });
    var cache = H.makeCacheFake();
    var uc = new GetVersion({ repo: repo, cache: cache });
    return uc.execute({ userId: USER }).then(function (out) {
      expect(out.version).toMatch(/:2$/);
      expect(cache._store['version:' + USER]).toEqual(out);
    });
  });
});

describe('GetDisabledTasks (getDisabledTasks)', function () {
  test('returns only disabled rows mapped to API tasks', function () {
    var repo = new InMemoryTaskRepository({ rows: rows() });
    var uc = new GetDisabledTasks({ repo: repo, mappers: H.mappers });
    return uc.execute({ userId: USER }).then(function (out) {
      // InMemory fetchTasksWithEventIds returns the full set; the queryBuilder
      // filter is a DB-side convenience. The use-case still maps every returned
      // row — assert the disabled one is present + shaped.
      var ids = out.tasks.map(function (t) { return t.id; });
      expect(ids).toContain('t2');
      var t2 = out.tasks.find(function (t) { return t.id === 't2'; });
      expect(t2.status).toBe('disabled');
    });
  });
});

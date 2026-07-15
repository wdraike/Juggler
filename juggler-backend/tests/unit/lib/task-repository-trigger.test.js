/**
 * Unit tests for lib/task-repository-trigger — the write-queue -> task-repository
 * seam (999.1628, ScheduleTriggerPort-style inversion).
 *
 * lib/task-write-queue.js used to lazy-require slices/task/facade.js for
 * KnexTaskRepository — a lazy require is still a graph edge (check-require-cycles.js's
 * own header documents this), and slices/task/facade.js top-level-requires
 * lib/task-write-queue.js, closing the cycle
 *   task-write-queue -> slices/task/facade -> task-write-queue.
 * This module is the dependency-free registry that inverts the edge: facade.js
 * populates it at ITS load time; task-write-queue.js reads from it instead of
 * requiring the facade.
 *
 * No database required — pure unit tests.
 */

'use strict';

describe('lib/task-repository-trigger', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('getKnexTaskRepository returns null before any registration', () => {
    const { getKnexTaskRepository } = require('../../../src/lib/task-repository-trigger');
    expect(getKnexTaskRepository()).toBeNull();
  });

  test('registerKnexTaskRepository makes the constructor available via getKnexTaskRepository', () => {
    const { registerKnexTaskRepository, getKnexTaskRepository } = require('../../../src/lib/task-repository-trigger');
    function FakeRepo() {}
    registerKnexTaskRepository(FakeRepo);
    expect(getKnexTaskRepository()).toBe(FakeRepo);
  });

  test('a later registration overwrites the earlier one (last writer wins, same as scheduleTrigger)', () => {
    const { registerKnexTaskRepository, getKnexTaskRepository } = require('../../../src/lib/task-repository-trigger');
    function RepoA() {}
    function RepoB() {}
    registerKnexTaskRepository(RepoA);
    registerKnexTaskRepository(RepoB);
    expect(getKnexTaskRepository()).toBe(RepoB);
  });

  test('unregistered contract: logs loudly (fail-loud, no silent constructor substitution)', () => {
    const errorSpy = jest.fn();
    jest.doMock('@raike/lib-logger', () => ({
      createLogger: () => ({ error: errorSpy, info: jest.fn(), warn: jest.fn(), debug: jest.fn() })
    }));
    const { getKnexTaskRepository } = require('../../../src/lib/task-repository-trigger');

    const result = getKnexTaskRepository();

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/no KnexTaskRepository registered/i);
  });
});

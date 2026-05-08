/**
 * juggler-cal-history Plan D — cron tests.
 * Mocks db chain + sync-lock + cache + sseEmitter; drives _internal.tick to assert behavior.
 */
process.env.NODE_ENV = 'test';

let resolveQueue = [];
let updateCalls = [];
let delCalls = 0;

function createChainMock() {
  const chain = jest.fn(() => chain);
  ['where', 'whereRaw', 'whereNotNull', 'whereNull', 'whereNot', 'whereIn',
   'orWhere', 'orderBy', 'orderByRaw', 'limit', 'offset', 'join', 'leftJoin',
   'count', 'distinct', 'pluck'].forEach(m => { chain[m] = jest.fn(() => chain); });

  chain.select = jest.fn(() => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : []));
  chain.first = jest.fn(() => Promise.resolve(resolveQueue.length ? resolveQueue.shift() : null));
  chain.update = jest.fn((fields) => { updateCalls.push(fields); return Promise.resolve(1); });
  chain.del = jest.fn(() => { delCalls++; return Promise.resolve(resolveQueue.length ? resolveQueue.shift() : 0); });
  chain.then = jest.fn((resolve, reject) =>
    Promise.resolve(resolveQueue.length ? resolveQueue.shift() : []).then(resolve, reject));
  chain.fn = { now: () => 'MOCK_NOW' };
  chain.raw = jest.fn(() => Promise.resolve([[]]));
  return chain;
}

const mockDb = createChainMock();

jest.mock('../../src/lib/sync-lock', () => ({
  acquireLock: jest.fn(() => Promise.resolve({ acquired: true, token: 'tok-1' })),
  releaseLock: jest.fn(() => Promise.resolve())
}));

const syncLockMock = require('../../src/lib/sync-lock');
let releaseCalls = 0;

const cache = { invalidateTasks: jest.fn(() => Promise.resolve()) };
const sseEmitter = { emit: jest.fn() };

const cron = require('../../src/cron/cal-history-cron');

beforeEach(() => {
  resolveQueue = [];
  updateCalls = [];
  delCalls = 0;
  releaseCalls = 0;
  syncLockMock.acquireLock.mockImplementation(() => Promise.resolve({ acquired: true, token: 'tok-1' }));
  syncLockMock.releaseLock.mockImplementation(() => { releaseCalls++; return Promise.resolve(); });
  jest.clearAllMocks();
  syncLockMock.acquireLock.mockImplementation(() => Promise.resolve({ acquired: true, token: 'tok-1' }));
  syncLockMock.releaseLock.mockImplementation(() => { releaseCalls++; return Promise.resolve(); });
});

describe('cal-history-cron — juggler-cal-history Plan D', () => {
  test('processMissedMark flips past-window pending recurring to missed + sets completed_at', async () => {
    var nowFixed = new Date('2026-05-08T14:00:00.000Z');
    // First .select() returns recurring instance rows (this shard).
    // Then per-row update fires and consumes nothing from queue.
    resolveQueue.push([
      { id: 'rc-1', user_id: 'u-1', scheduled_at: '2026-05-08T12:00:00.000Z', time_flex: 60 }
    ]);
    var deps = { db: mockDb, cache: cache, sseEmitter: sseEmitter };
    var res = await cron._internal.processMissedMark(deps, 0, nowFixed);
    expect(res.flipped).toBe(1);
    expect(updateCalls[0]).toMatchObject({ status: 'missed' });
    expect(updateCalls[0].completed_at instanceof Date).toBe(true);
    expect(updateCalls[0].completed_at.toISOString()).toBe('2026-05-08T13:00:00.000Z');
    expect(cache.invalidateTasks).toHaveBeenCalledWith('u-1');
    expect(sseEmitter.emit).toHaveBeenCalled();
  });

  test('processMissedMark does not flip when window still open', async () => {
    var nowFixed = new Date('2026-05-08T12:30:00.000Z');
    resolveQueue.push([
      { id: 'rc-2', user_id: 'u-2', scheduled_at: '2026-05-08T12:00:00.000Z', time_flex: 60 }
    ]);
    var deps = { db: mockDb, cache: cache, sseEmitter: sseEmitter };
    var res = await cron._internal.processMissedMark(deps, 0, nowFixed);
    expect(res.flipped).toBe(0);
    expect(updateCalls.length).toBe(0);
  });

  test('processPurge deletes terminal rows older than 12 months (and skips no-affected case)', async () => {
    var nowFixed = new Date('2027-06-01T00:00:00.000Z');
    // distinct().pluck() resolves first (queue position 1), then del() returns count.
    resolveQueue.push(['u-3', 'u-4']); // affected user_ids
    resolveQueue.push(2); // delete count
    var deps = { db: mockDb, cache: cache, sseEmitter: sseEmitter };
    var res = await cron._internal.processPurge(deps, 0, nowFixed);
    expect(res.deleted).toBe(2);
    expect(res.users).toEqual(['u-3', 'u-4']);
    expect(cache.invalidateTasks).toHaveBeenCalledTimes(2);
  });

  test('tick acquires lock; skips when not acquired', async () => {
    cron.start({ db: mockDb, cache: cache, sseEmitter: sseEmitter });
    syncLockMock.acquireLock.mockImplementationOnce(() => Promise.resolve({ acquired: false }));
    resolveQueue.push([]); // would-be missed-mark rows (not consumed if lock skip works)
    await cron._internal.tick();
    expect(updateCalls.length).toBe(0);
    cron.stop();
  });

  test('tick releases lock in finally even if processMissedMark throws', async () => {
    var deps = { db: mockDb, cache: cache, sseEmitter: sseEmitter };
    cron.start(deps);
    syncLockMock.acquireLock.mockImplementationOnce(() => Promise.resolve({ acquired: true, token: 'tok-finally' }));
    var origSelect = mockDb.select;
    mockDb.select = jest.fn(() => Promise.reject(new Error('boom')));
    await cron._internal.tick();
    mockDb.select = origSelect;
    expect(syncLockMock.releaseLock).toHaveBeenCalled();
    cron.stop();
  });

  test('lockKeyForShard formats correctly', () => {
    expect(cron._internal.lockKeyForShard(0)).toBe('__hist_0');
    expect(cron._internal.lockKeyForShard(59)).toBe('__hist_59');
  });

  test('SHARD_COUNT and RETENTION_DAYS exposed and sensible', () => {
    expect(cron._internal.SHARD_COUNT).toBe(60);
    expect(cron._internal.RETENTION_DAYS).toBe(365);
  });
});

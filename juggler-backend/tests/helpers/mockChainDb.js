/**
 * Reusable DB chain mock builder.
 *
 * Usage:
 *   const { mockDb, resolveQueue } = createMockChainDb();
 *   jest.mock('../../src/db', () => mockDb);
 *   // Before each test, push expected return values in call order:
 *   resolveQueue.push(myReturnValue);
 *
 * Key rule: every DB terminal call (select/first/then) pops from resolveQueue
 * in FIFO order. Push values in the exact order the controller makes DB calls.
 *
 * Diagnosis: temporarily log resolveQueue.length in nextResolve when a test
 * fails to find which call receives an empty queue.
 */
function createMockChainDb() {
  const resolveQueue = [];

  const chain = jest.fn(() => chain);
  ['where', 'whereRaw', 'whereNotNull', 'whereNull', 'whereNot', 'whereNotIn',
   'whereIn', 'orWhere', 'orWhereNot', 'orderBy', 'orderByRaw', 'limit',
   'offset', 'join', 'leftJoin', 'count', 'max', 'clearSelect', 'clearOrder',
   'clone', 'groupBy', 'having'].forEach(m => { chain[m] = jest.fn(() => chain); });

  function nextResolve(fallback) {
    return resolveQueue.length > 0 ? resolveQueue.shift() : fallback;
  }

  chain.select = jest.fn(() => Promise.resolve(nextResolve([])));
  chain.first  = jest.fn(() => Promise.resolve(nextResolve(null)));
  chain.insert = jest.fn(() => Promise.resolve());
  chain.update = jest.fn(() => Promise.resolve(1));
  chain.del    = jest.fn(() => Promise.resolve(1));
  chain.then   = jest.fn((resolve, reject) =>
    Promise.resolve(nextResolve([])).then(resolve, reject));
  chain.catch  = jest.fn((fn) => Promise.resolve([]).catch(fn));
  chain.fn     = { now: () => 'MOCK_NOW' };
  chain.raw    = (s) => s;
  chain.transaction = jest.fn(async (cb) => cb(chain));

  return { mockDb: chain, resolveQueue };
}

module.exports = { createMockChainDb };

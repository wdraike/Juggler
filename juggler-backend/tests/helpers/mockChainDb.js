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
 */
function createMockChainDb() {
  const resolveQueue = [];

  function makeChain(resolveVal) {
    const chain = jest.fn(() => chain);
    ['where', 'whereRaw', 'whereNotNull', 'whereNull', 'whereNot', 'whereNotIn',
     'whereIn', 'orWhere', 'orWhereNot', 'orWhereNull', 'orWhereIn', 'andWhere',
     'orderBy', 'orderByRaw', 'limit',
     'offset', 'join', 'leftJoin', 'innerJoin', 'rightJoin', 'count', 'countDistinct',
     'min', 'max', 'sum', 'avg', 'distinct', 'distinctOn', 'pluck', 'clearSelect',
     'clearOrder', 'clearWhere', 'clone', 'groupBy', 'groupByRaw', 'having',
     'havingRaw', 'returning', 'onConflict', 'forUpdate', 'forShare'].forEach(m => { chain[m] = jest.fn(() => chain); });

    function nextResolve(fallback) {
      return resolveQueue.length > 0 ? resolveQueue.shift() : fallback;
    }

    // .select() and .first() are chainable in Knex — return the builder,
    // which is also thenable so `await query.select(...)` resolves correctly.
    chain.select = jest.fn(() => chain);
    chain.first  = jest.fn(() => chain);
    chain.insert = jest.fn(() => chain);
    chain.update = jest.fn(() => chain);
    chain.del    = jest.fn(() => chain);
    chain.then   = jest.fn(function (resolve, reject) {
      return Promise.resolve(typeof resolveVal !== 'undefined' ? resolveVal : nextResolve([])).then(resolve, reject);
    });
    chain.catch  = jest.fn(function (fn) {
      return Promise.resolve([]).catch(fn);
    });
    chain.fn     = { now: () => 'MOCK_NOW' };
    chain.raw    = (s) => s;
    chain.transaction = jest.fn(async (cb) => cb(chain));

    return chain;
  }

  return { mockDb: makeChain(), resolveQueue };
}

module.exports = { createMockChainDb };

/**
 * Guard test (999.332) — InMemoryCacheAdapter.set(key, undefined).
 *
 * JSON.stringify(undefined) yields JS `undefined` (not a string). The previous
 * implementation stored that, and a later get() ran JSON.parse(undefined) which
 * throws SyntaxError. set() must instead treat an undefined value as a no-store
 * (cache miss) so get() returns null cleanly, matching how the adapter already
 * represents a miss.
 */

'use strict';

const InMemoryCacheAdapter = require('../../src/lib/cache/InMemoryCacheAdapter');

describe('InMemoryCacheAdapter — set(key, undefined) is a clean miss (999.332)', () => {
  test('set(undefined) then get() resolves to null and does not throw', async () => {
    const cache = new InMemoryCacheAdapter();
    await expect(cache.set('k', undefined)).resolves.toBe(true);
    await expect(cache.get('k')).resolves.toBeNull();
  });

  test('set(undefined) overwrites a previously-cached value as a miss', async () => {
    const cache = new InMemoryCacheAdapter();
    await cache.set('k', { a: 1 });
    await expect(cache.get('k')).resolves.toEqual({ a: 1 });
    await cache.set('k', undefined);
    await expect(cache.get('k')).resolves.toBeNull();
  });

  test('explicit null is still stored and round-trips as null (not a no-store)', async () => {
    const cache = new InMemoryCacheAdapter();
    await cache.set('k', null);
    await expect(cache.get('k')).resolves.toBeNull();
  });
});

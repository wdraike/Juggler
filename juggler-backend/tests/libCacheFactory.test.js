// Unit tests for src/lib/cache createCache() driver selection (H2 / W2).
//
// Covers the environment-gated driver default added per ARCH-REVIEW WARN-1:
// production + missing REDIS_URL must FAIL LOUD (no silent per-instance memory
// cache under Cloud Run scale-out); dev/test keeps in-memory as the default.

// Bind any require-time singleton to test-bed Redis, not dev :6379.
process.env.REDIS_URL = 'redis://localhost:6479';

const {
  createCache,
  RedisCacheAdapter,
  InMemoryCacheAdapter,
} = require('../src/lib/cache');

describe('lib/cache createCache() driver selection', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  test('REDIS_URL set → RedisCacheAdapter', () => {
    process.env.REDIS_URL = 'redis://localhost:6479';
    delete process.env.NODE_ENV;
    expect(createCache()).toBeInstanceOf(RedisCacheAdapter);
  });

  test('REDIS_URL unset + production → throws (fail loud, no silent memory cache)', () => {
    delete process.env.REDIS_URL;
    process.env.NODE_ENV = 'production';
    expect(() => createCache()).toThrow(/REDIS_URL is required in production/);
  });

  test('REDIS_URL unset + non-production → InMemoryCacheAdapter (deliberate dev/test default)', () => {
    delete process.env.REDIS_URL;
    process.env.NODE_ENV = 'test';
    expect(createCache()).toBeInstanceOf(InMemoryCacheAdapter);
  });

  test('explicit driver override wins over env', () => {
    delete process.env.REDIS_URL;
    process.env.NODE_ENV = 'production';
    // explicit memory override must NOT throw even in production
    expect(createCache({ driver: 'memory' })).toBeInstanceOf(InMemoryCacheAdapter);
  });

  test('unknown explicit driver throws', () => {
    expect(() => createCache({ driver: 'bogus' })).toThrow(/unknown driver/);
  });
});

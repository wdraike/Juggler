// Unit tests for src/lib/config — typed env access.
//
// Getters read process.env at call-time, so each test sets/deletes the
// relevant env var directly. We extend the schema in-place for type-coercion
// cases (int/bool) since the production schema currently declares only string
// keys; the extension is restored in afterEach.

const config = require('../src/lib/config');

describe('lib/config', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    // Clean up any temporary schema entries added by coercion tests.
    delete config.SCHEMA.__TEST_INT__;
    delete config.SCHEMA.__TEST_BOOL__;
  });

  describe('getString', () => {
    test('returns env value when present', () => {
      process.env.APP_ID = 'present-value';
      expect(config.getString('APP_ID')).toBe('present-value');
    });

    test('returns declared default when absent', () => {
      delete process.env.SERVICE_NAME;
      expect(config.getString('SERVICE_NAME')).toBe('strivers');
    });

    test('treats empty-string env var as unset (legacy `|| default` parity)', () => {
      process.env.PRODUCT_LABEL = '';
      expect(config.getString('PRODUCT_LABEL')).toBe('juggler');
    });
  });

  describe('getInt', () => {
    beforeEach(() => {
      config.SCHEMA.__TEST_INT__ = {
        key: '__TEST_INT__',
        type: 'int',
        default: 42,
      };
    });

    test('coerces a numeric string to an int', () => {
      process.env.__TEST_INT__ = '5';
      expect(config.getInt('__TEST_INT__')).toBe(5);
    });

    test('returns declared default when absent', () => {
      delete process.env.__TEST_INT__;
      expect(config.getInt('__TEST_INT__')).toBe(42);
    });

    test('throws on a non-numeric value', () => {
      process.env.__TEST_INT__ = 'not-a-number';
      expect(() => config.getInt('__TEST_INT__')).toThrow(/expected an integer/);
    });

    test('throws on trailing garbage (no silent parseInt truncation)', () => {
      process.env.__TEST_INT__ = '5abc';
      expect(() => config.getInt('__TEST_INT__')).toThrow(/expected an integer/);
    });

    test('treats empty-string env var as unset → default', () => {
      process.env.__TEST_INT__ = '';
      expect(config.getInt('__TEST_INT__')).toBe(42);
    });
  });

  describe('getBool', () => {
    beforeEach(() => {
      config.SCHEMA.__TEST_BOOL__ = {
        key: '__TEST_BOOL__',
        type: 'bool',
        default: false,
      };
    });

    test.each([
      ['true', true],
      ['TRUE', true],
      ['1', true],
      ['false', false],
      ['FALSE', false],
      ['0', false],
    ])('coerces "%s" to %s', (input, expected) => {
      process.env.__TEST_BOOL__ = input;
      expect(config.getBool('__TEST_BOOL__')).toBe(expected);
    });

    test('returns declared default when absent', () => {
      delete process.env.__TEST_BOOL__;
      expect(config.getBool('__TEST_BOOL__')).toBe(false);
    });

    test('throws on an unrecognized boolean value', () => {
      process.env.__TEST_BOOL__ = 'maybe';
      expect(() => config.getBool('__TEST_BOOL__')).toThrow(/expected a boolean/);
    });
  });

  describe('unknown key', () => {
    test('getString throws for an undeclared key', () => {
      expect(() => config.getString('NOT_DECLARED')).toThrow(/unknown config key/);
    });

    test('getInt throws for an undeclared key', () => {
      expect(() => config.getInt('NOT_DECLARED')).toThrow(/unknown config key/);
    });

    test('getBool throws for an undeclared key', () => {
      expect(() => config.getBool('NOT_DECLARED')).toThrow(/unknown config key/);
    });
  });

  describe('requiredInProduction (AUTH_JWKS_URL, 999.1197)', () => {
    test('unset outside production → documented dev default (localhost auth-service)', () => {
      delete process.env.AUTH_JWKS_URL;
      process.env.NODE_ENV = 'test';
      expect(config.getString('AUTH_JWKS_URL'))
        .toBe('http://localhost:5010/.well-known/jwks.json');
    });

    test('unset in production → throws (fail loud, no localhost leak)', () => {
      delete process.env.AUTH_JWKS_URL;
      process.env.NODE_ENV = 'production';
      expect(() => config.getString('AUTH_JWKS_URL'))
        .toThrow(/required in production/);
    });

    test('set in production → returns the env value', () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_JWKS_URL = 'https://auth.example.com/.well-known/jwks.json';
      expect(config.getString('AUTH_JWKS_URL'))
        .toBe('https://auth.example.com/.well-known/jwks.json');
    });
  });

  describe('type mismatch', () => {
    test('getInt throws when key is declared as string', () => {
      expect(() => config.getInt('APP_ID')).toThrow(/not "int"/);
    });

    test('getBool throws when key is declared as string', () => {
      expect(() => config.getBool('APP_ID')).toThrow(/not "bool"/);
    });
  });
});

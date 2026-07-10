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

  describe('requiredInProduction (999.1202 — OAuth-redirect/CORS/payment URL fallbacks)', () => {
    test.each([
      ['FRONTEND_URL', 'http://localhost:3000'],
      ['GCAL_REDIRECT_URI', 'http://localhost:5002/api/gcal/callback'],
      ['MSFT_CAL_REDIRECT_URI', 'http://localhost:5002/api/msft-cal/callback'],
      ['PAYMENT_SERVICE_URL', 'http://localhost:5020'],
      ['BILLING_SERVICE_URL', 'http://localhost:5020'],
    ])('%s: unset outside production → documented dev default', (key, defaultValue) => {
      delete process.env[key];
      process.env.NODE_ENV = 'test';
      expect(config.getString(key)).toBe(defaultValue);
    });

    test.each([
      'FRONTEND_URL',
      'GCAL_REDIRECT_URI',
      'MSFT_CAL_REDIRECT_URI',
      'PAYMENT_SERVICE_URL',
      'BILLING_SERVICE_URL',
    ])('%s: unset in production → throws (fail loud, no localhost leak)', (key) => {
      delete process.env[key];
      process.env.NODE_ENV = 'production';
      expect(() => config.getString(key)).toThrow(/required in production/);
    });

    test.each([
      ['FRONTEND_URL', 'https://strivers.example.com'],
      ['GCAL_REDIRECT_URI', 'https://juggler.example.com/api/gcal/callback'],
      ['MSFT_CAL_REDIRECT_URI', 'https://juggler.example.com/api/msft-cal/callback'],
      ['PAYMENT_SERVICE_URL', 'https://payment.example.com'],
      ['BILLING_SERVICE_URL', 'https://payment.example.com'],
    ])('%s: set in production → returns the env value', (key, prodValue) => {
      process.env.NODE_ENV = 'production';
      process.env[key] = prodValue;
      expect(config.getString(key)).toBe(prodValue);
    });
  });

  describe('operational defaults (999.1202 — not requiredInProduction)', () => {
    test('PORT: returns declared default when absent', () => {
      delete process.env.PORT;
      expect(config.getInt('PORT')).toBe(5002);
    });

    test('PORT: coerces a numeric env value', () => {
      process.env.PORT = '8080';
      expect(config.getInt('PORT')).toBe(8080);
    });

    test('GCP_REGION: returns declared default when absent', () => {
      delete process.env.GCP_REGION;
      expect(config.getString('GCP_REGION')).toBe('us-central1');
    });

    test('JUGGLER_QUEUE_DRIVER: returns declared default when absent', () => {
      delete process.env.JUGGLER_QUEUE_DRIVER;
      expect(config.getString('JUGGLER_QUEUE_DRIVER')).toBe('db');
    });

    test('JUGGLER_SCHEDULER_QUEUE: returns declared default when absent', () => {
      delete process.env.JUGGLER_SCHEDULER_QUEUE;
      expect(config.getString('JUGGLER_SCHEDULER_QUEUE')).toBe('juggler-scheduler-runs');
    });

    test.each(['PORT', 'GCP_REGION', 'JUGGLER_QUEUE_DRIVER', 'JUGGLER_SCHEDULER_QUEUE'])(
      '%s: unset in production does NOT throw (not requiredInProduction)',
      (key) => {
        delete process.env[key];
        process.env.NODE_ENV = 'production';
        expect(() => (key === 'PORT' ? config.getInt(key) : config.getString(key))).not.toThrow();
      },
    );
  });

  describe('requiredInProduction (999.1473 — INTERNAL_SERVICE_KEY + OAuth app credentials)', () => {
    test.each([
      'INTERNAL_SERVICE_KEY',
      'MICROSOFT_CLIENT_ID',
      'MICROSOFT_CLIENT_SECRET',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
    ])('%s: unset outside production → documented dev default (empty string)', (key) => {
      delete process.env[key];
      process.env.NODE_ENV = 'test';
      expect(config.getString(key)).toBe('');
    });

    test.each([
      'INTERNAL_SERVICE_KEY',
      'MICROSOFT_CLIENT_ID',
      'MICROSOFT_CLIENT_SECRET',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
    ])('%s: unset in production → throws (fail loud, no silent empty-string leak)', (key) => {
      delete process.env[key];
      process.env.NODE_ENV = 'production';
      expect(() => config.getString(key)).toThrow(/required in production/);
    });

    test.each([
      ['INTERNAL_SERVICE_KEY', 'shared-secret-value'],
      ['MICROSOFT_CLIENT_ID', 'ms-client-id-value'],
      ['MICROSOFT_CLIENT_SECRET', 'ms-client-secret-value'],
      ['GOOGLE_CLIENT_ID', 'google-client-id-value'],
      ['GOOGLE_CLIENT_SECRET', 'google-client-secret-value'],
    ])('%s: set in production → returns the env value', (key, prodValue) => {
      process.env.NODE_ENV = 'production';
      process.env[key] = prodValue;
      expect(config.getString(key)).toBe(prodValue);
    });
  });

  describe('operational defaults (999.1473 — remaining direct process.env migration)', () => {
    test('NODE_ENV: returns declared default when absent', () => {
      delete process.env.NODE_ENV;
      expect(config.getString('NODE_ENV')).toBe('development');
    });

    test('VAPID_SUBJECT: returns declared default when absent', () => {
      delete process.env.VAPID_SUBJECT;
      expect(config.getString('VAPID_SUBJECT')).toBe('mailto:support@raikeandsons.com');
    });

    test('AI_CALL_TIMEOUT_MS: returns declared default when absent', () => {
      delete process.env.AI_CALL_TIMEOUT_MS;
      expect(config.getInt('AI_CALL_TIMEOUT_MS')).toBe(45000);
    });

    test('AI_CALL_TIMEOUT_MS: coerces a numeric env value', () => {
      process.env.AI_CALL_TIMEOUT_MS = '5000';
      expect(config.getInt('AI_CALL_TIMEOUT_MS')).toBe(5000);
    });

    test.each([
      ['CREDENTIAL_ENCRYPTION_KEY', ''],
      ['PUBLIC_URL', ''],
      ['MCP_ISSUER_URL', ''],
      ['MCP_DEV_NO_AUTH', ''],
      ['LOG_LEVEL', ''],
      ['CI', ''],
      ['NO_COLOR', ''],
      ['TERM', ''],
      ['VAPID_PUBLIC_KEY', ''],
      ['VAPID_PRIVATE_KEY', ''],
      ['REDIS_URL', ''],
      ['GIT_COMMIT', ''],
      ['BUILD_DATE', ''],
      ['ADMIN_EMAILS', ''],
      ['FEATURE_CATALOG_KEY', ''],
      ['CLOUD_TASKS_EMULATOR_HOST', ''],
      ['GCP_PROJECT', ''],
      ['GOOGLE_CLOUD_PROJECT', ''],
      ['JUGGLER_WORKER_BASE_URL', ''],
      ['CLOUD_TASKS_INVOKER_SA', ''],
      ['SKIP_SCHEDULER_TASK_AUTH', ''],
      ['JUGGLER_TASK_SECRET', ''],
      ['BILLING_WEBHOOK_SECRET', ''],
    ])('%s: returns declared default (%j) when absent', (key, expected) => {
      delete process.env[key];
      expect(config.getString(key)).toBe(expected);
    });

    test.each([
      'NODE_ENV',
      'CREDENTIAL_ENCRYPTION_KEY',
      'PUBLIC_URL',
      'MCP_ISSUER_URL',
      'MCP_DEV_NO_AUTH',
      'LOG_LEVEL',
      'CI',
      'NO_COLOR',
      'TERM',
      'VAPID_PUBLIC_KEY',
      'VAPID_PRIVATE_KEY',
      'VAPID_SUBJECT',
      'REDIS_URL',
      'GIT_COMMIT',
      'BUILD_DATE',
      'ADMIN_EMAILS',
      'FEATURE_CATALOG_KEY',
      'CLOUD_TASKS_EMULATOR_HOST',
      'GCP_PROJECT',
      'GOOGLE_CLOUD_PROJECT',
      'JUGGLER_WORKER_BASE_URL',
      'CLOUD_TASKS_INVOKER_SA',
      'SKIP_SCHEDULER_TASK_AUTH',
      'JUGGLER_TASK_SECRET',
      'BILLING_WEBHOOK_SECRET',
    ])('%s: unset in production does NOT throw (not requiredInProduction)', (key) => {
      delete process.env[key];
      process.env.NODE_ENV = 'production';
      expect(() => config.getString(key)).not.toThrow();
    });

    test('AI_CALL_TIMEOUT_MS: unset in production does NOT throw (not requiredInProduction)', () => {
      delete process.env.AI_CALL_TIMEOUT_MS;
      process.env.NODE_ENV = 'production';
      expect(() => config.getInt('AI_CALL_TIMEOUT_MS')).not.toThrow();
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

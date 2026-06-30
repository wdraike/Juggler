process.env.NODE_ENV = 'test';
// Cluster 4 hardening: vendor/service-auth.js throws "SERVICE_NAME required" if
// neither the serviceName arg nor process.env.SERVICE_NAME is set. usage-reporter
// calls initServiceAuth({ serviceName: PRODUCT_LABEL }); if a suite jest.mocks the
// plan-features middleware, PRODUCT_LABEL can resolve undefined → throw. Setting a
// test-env default here (each worker requires this config) guarantees a serviceName
// without touching production behavior (only applied when unset).
if (!process.env.SERVICE_NAME) process.env.SERVICE_NAME = 'juggler';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js', '**/src/__tests__/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageReporters: ['text', 'text-summary', 'json-summary', 'lcov'],
  // Coverage thresholds — baseline minus 2% buffer to catch regressions.
  coverageThreshold: {
    global: {
      branches: 10,
      functions: 10,
      lines: 10,
      statements: 10
    }
  },
  moduleNameMapper: {
    '^uuid$': '<rootDir>/tests/helpers/uuid-mock.js'
  },
  globalSetup: '<rootDir>/tests/helpers/jest.globalSetup.js',
  // Per-test-file teardown: stop the scheduleQueue poll loop after each test/file
  // so a stray timer tick can't fire post-teardown and call getQueueBackend() on a
  // torn-down/mocked registry. Also prevents a background timer from firing during
  // jest's forceExit window (a known test-isolation defect).
  setupFilesAfterEnv: ['<rootDir>/test-helpers/afterEachFile.js'],
  forceExit: true,
  // Run sequentially — integration tests share a DB connection that
  // conflicts with jest.mock('../src/db') in parallel workers.
  maxWorkers: 1
};

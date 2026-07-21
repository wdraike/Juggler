process.env.NODE_ENV = 'test';
// Cluster 4 hardening: vendor/service-auth.js throws "SERVICE_NAME required" if
// neither the serviceName arg nor process.env.SERVICE_NAME is set. usage-reporter
// calls initServiceAuth({ serviceName: PRODUCT_LABEL }); if a suite jest.mocks the
// plan-features middleware, PRODUCT_LABEL can resolve undefined → throw. Setting a
// test-env default here (each worker requires this config) guarantees a serviceName
// without touching production behavior (only applied when unset).
if (!process.env.SERVICE_NAME) process.env.SERVICE_NAME = 'juggler';

// vinatieri quarantine ratchet — known-red suites parked with tickets so the
// passing set stays a HARD gate (pre-push + CI). List may only shrink; see
// jest.quarantine.json (999.1564 / 999.1439) + .planning/patriots/PLAYBOOK.md.
let quarantine = [];
try { quarantine = require('./jest.quarantine.json').patterns || []; }
catch (e) { console.warn('[quarantine] jest.quarantine.json unreadable — running ALL suites: ' + e.message); }

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js', '**/src/__tests__/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', ...quarantine],
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageReporters: ['text', 'text-summary', 'json-summary', 'lcov'],
  // Coverage thresholds — baseline minus 2% buffer to catch regressions.
  coverageThreshold: {
    global: {
      branches: 18,
      functions: 18,
      lines: 18,
      statements: 18
    }
  },
  moduleNameMapper: {
    '^uuid$': '<rootDir>/tests/helpers/uuid-mock.js'
  },
  globalSetup: '<rootDir>/tests/helpers/jest.globalSetup.js',
  // 999.1037: load .env.test before ANY test file's own top-level requires run
  // (see tests/helpers/jest.setupEnv.js for the full root-cause writeup).
  setupFiles: ['<rootDir>/tests/helpers/jest.setupEnv.js'],
  // Per-test-file teardown: stop the scheduleQueue poll loop after each test/file
  // so a stray timer tick can't fire post-teardown and call getQueueBackend() on a
  // torn-down/mocked registry. Also prevents a background timer from firing during
  // jest's forceExit window (a known test-isolation defect).
  // 999.1576 inc.4: armAuditTestActor arms the sandbox-scoped audit
  // test-default actor ('jest') in every test file — the approved test-only
  // fallback that lets strict stampInsert/stampUpdate run in tests without
  // per-suite runWithActor wrapping (see juggler/CLAUDE.md Approved Fallbacks).
  setupFilesAfterEnv: [
    '<rootDir>/tests/helpers/armAuditTestActor.js',
    '<rootDir>/tests/helpers/dateOnlyFakeTimers.js',
    '<rootDir>/test-helpers/afterEachFile.js',
  ],
  forceExit: true,
  // Run sequentially — integration tests share a DB connection that
  // conflicts with jest.mock('../src/db') in parallel workers.
  maxWorkers: 1
};

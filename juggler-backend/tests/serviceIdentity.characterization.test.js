// Characterization test for src/service-identity.js
//
// Locks in the EXACT current behavior of service-identity BEFORE the
// lib-config migration, and continues to assert it AFTER. This proves the
// refactor is behavior-preserving (byte-identical exported values).
//
// service-identity reads its values at require-time, so each case uses
// jest.resetModules() + process.env manipulation to force a fresh re-read.

describe('service-identity characterization', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    // Work on a clean copy so cases don't leak into one another.
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // --- env var SET → returns the env value -------------------------------
  test('APP_ID returns env value when APP_ID is set', () => {
    process.env.APP_ID = 'custom-app';
    const identity = require('../src/service-identity');
    expect(identity.APP_ID).toBe('custom-app');
  });

  test('PRODUCT_LABEL returns env value when PRODUCT_LABEL is set', () => {
    process.env.PRODUCT_LABEL = 'custom-label';
    const identity = require('../src/service-identity');
    expect(identity.PRODUCT_LABEL).toBe('custom-label');
  });

  test('SERVICE_NAME returns env value when SERVICE_NAME is set', () => {
    process.env.SERVICE_NAME = 'custom-service';
    const identity = require('../src/service-identity');
    expect(identity.SERVICE_NAME).toBe('custom-service');
  });

  // --- env var UNSET → returns current default ---------------------------
  test('APP_ID defaults to "juggler" when APP_ID is unset', () => {
    delete process.env.APP_ID;
    const identity = require('../src/service-identity');
    expect(identity.APP_ID).toBe('juggler');
  });

  test('PRODUCT_LABEL defaults to "juggler" when PRODUCT_LABEL is unset', () => {
    delete process.env.PRODUCT_LABEL;
    const identity = require('../src/service-identity');
    expect(identity.PRODUCT_LABEL).toBe('juggler');
  });

  test('SERVICE_NAME defaults to "strivers" when SERVICE_NAME is unset', () => {
    delete process.env.SERVICE_NAME;
    const identity = require('../src/service-identity');
    expect(identity.SERVICE_NAME).toBe('strivers');
  });
});

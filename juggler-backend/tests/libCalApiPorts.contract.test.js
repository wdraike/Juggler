/**
 * PORT-CONTRACT test for the calendar-provider API port trio (999.944 H7).
 *
 * Mirrors the libCache.contract.test.js / tests/calendar/port-contract.unit.test.js
 * idiom (zoe finding, 2026-07-02): pins down the exact invariant these port files
 * exist to document — the wrapped module MUST expose exactly the port's declared
 * method surface — as an enforced test, not a one-time manual claim. Without this,
 * a future add/remove of an export on gcal-api.js / msft-cal-api.js / apple-cal-api.js
 * silently drifts from its port with zero test failure.
 *
 * Pure unit — no DB, no live credentials, no network.
 */

'use strict';

const GcalApiPort = require('../src/lib/ports/GcalApiPort');
const { GCAL_API_PORT_METHODS } = GcalApiPort;
const MsftCalApiPort = require('../src/lib/ports/MsftCalApiPort');
const { MSFT_CAL_API_PORT_METHODS } = MsftCalApiPort;
const AppleCalApiPort = require('../src/lib/ports/AppleCalApiPort');
const { APPLE_CAL_API_PORT_METHODS } = AppleCalApiPort;

const gcalApi = require('../src/lib/gcal-api');
const msftCalApi = require('../src/lib/msft-cal-api');
const appleCalApi = require('../src/lib/apple-cal-api');

describe('GcalApiPort conformance', () => {
  test('GCAL_API_PORT_METHODS is frozen', () => {
    expect(Object.isFrozen(GCAL_API_PORT_METHODS)).toBe(true);
  });

  test('abstract base throws "not implemented" on every method', () => {
    const base = new GcalApiPort();
    GCAL_API_PORT_METHODS.forEach((m) => {
      expect(() => base[m]()).toThrow(/not implemented/);
    });
  });

  test('gcal-api.js exposes EXACTLY the GCAL_API_PORT_METHODS surface — no more, no fewer', () => {
    expect(Object.keys(gcalApi).sort()).toEqual(GCAL_API_PORT_METHODS.slice().sort());
    GCAL_API_PORT_METHODS.forEach((m) => {
      expect(typeof gcalApi[m]).toBe('function');
    });
  });
});

describe('MsftCalApiPort conformance', () => {
  test('MSFT_CAL_API_PORT_METHODS is frozen', () => {
    expect(Object.isFrozen(MSFT_CAL_API_PORT_METHODS)).toBe(true);
  });

  test('abstract base throws "not implemented" on every method', () => {
    const base = new MsftCalApiPort();
    MSFT_CAL_API_PORT_METHODS.forEach((m) => {
      expect(() => base[m]()).toThrow(/not implemented/);
    });
  });

  test('msft-cal-api.js exposes EXACTLY the MSFT_CAL_API_PORT_METHODS surface — no more, no fewer', () => {
    expect(Object.keys(msftCalApi).sort()).toEqual(MSFT_CAL_API_PORT_METHODS.slice().sort());
    MSFT_CAL_API_PORT_METHODS.forEach((m) => {
      expect(typeof msftCalApi[m]).toBe('function');
    });
  });
});

describe('AppleCalApiPort conformance', () => {
  test('APPLE_CAL_API_PORT_METHODS is frozen', () => {
    expect(Object.isFrozen(APPLE_CAL_API_PORT_METHODS)).toBe(true);
  });

  test('abstract base throws "not implemented" on every method', () => {
    const base = new AppleCalApiPort();
    APPLE_CAL_API_PORT_METHODS.forEach((m) => {
      expect(() => base[m]()).toThrow(/not implemented/);
    });
  });

  // apple-cal-api.js exports the DEFAULT_SERVER_URL constant ALONGSIDE its 9
  // functions; APPLE_CAL_API_PORT_METHODS deliberately covers only the function
  // surface (a constant has no "not implemented" contract to satisfy). Zoe
  // finding 2026-07-02: assert this precisely rather than a blunt full-key
  // equality that would falsely fail on the constant.
  test('apple-cal-api.js exposes EXACTLY the APPLE_CAL_API_PORT_METHODS function surface (DEFAULT_SERVER_URL excluded by design)', () => {
    const functionKeys = Object.keys(appleCalApi).filter((k) => typeof appleCalApi[k] === 'function');
    expect(functionKeys.sort()).toEqual(APPLE_CAL_API_PORT_METHODS.slice().sort());
  });

  test('DEFAULT_SERVER_URL is a non-function constant, correctly excluded from APPLE_CAL_API_PORT_METHODS', () => {
    expect(typeof appleCalApi.DEFAULT_SERVER_URL).toBe('string');
    expect(APPLE_CAL_API_PORT_METHODS.indexOf('DEFAULT_SERVER_URL')).toBe(-1);
  });
});

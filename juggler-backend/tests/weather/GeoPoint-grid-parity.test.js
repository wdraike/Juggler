/**
 * GeoPoint grid-parity — proves GeoPoint.gridValue is BIT-IDENTICAL to the
 * legacy weather.controller.js `roundCoord`.
 *
 * W1 (juggler-hex-h1-weather) folds roundCoord into the GeoPoint value object.
 * Any drift in the grid-key math silently desyncs the forecast cache, the
 * reverse-geocode cache key, and the scheduler weather-match. This test pins the
 * fold against:
 *   (a) the 17 captured input/output goldens from H1-characterization.test.js
 *       (B4), reproduced verbatim below — INCLUDING the IEEE-754 `-0` edge; and
 *   (b) the live production `roundCoord` export, asserting Object.is equality so
 *       the -0 vs +0 distinction is enforced (toBe / === would let -0 pass as 0).
 *
 * Pure unit — no DB, no network, no app bootstrap.
 *
 * Traceability: TRACEABILITY-juggler-hex-h1-weather.md B4 (grid-key parity).
 */

'use strict';

process.env.NODE_ENV = 'test';

const GeoPoint = require('../../src/slices/weather/domain/value-objects/GeoPoint');
const { roundCoord } = require('../../src/controllers/weather.controller');

// The exact 17 golden pairs from H1-characterization.test.js B4 (captured
// 2026-06-09 from Math.round(parseFloat(v) * 10) / 10). Reproduced verbatim so
// this suite fails independently if the GeoPoint fold drifts.
const GOLDEN_CASES = [
  // [input, expected]
  [37.77,    37.8],
  [-122.42, -122.4],
  [0,         0],
  [-0,        0],
  [37.75,    37.8],
  [37.74,    37.7],
  [37.749,   37.7],
  [37.751,   37.8],
  [90,        90],
  [-90,      -90],
  [180,       180],
  [-180,     -180],
  [37.05,    37.1],
  [37.04,    37.0],
  [-0.05,    -0],   // IEEE-754 negative-zero golden
  ['37.77',   37.8],
  ['-122.4', -122.4]
];

describe('GeoPoint.gridValue — bit-identical to legacy roundCoord', () => {
  it.each(GOLDEN_CASES)('GeoPoint.gridValue(%s) === %s (golden)', (input, expected) => {
    // Object.is so that the -0 case is enforced, not coerced away by ===.
    expect(Object.is(GeoPoint.gridValue(input), expected)).toBe(true);
  });

  it.each(GOLDEN_CASES)('GeoPoint.gridValue(%s) matches production roundCoord(%s) exactly', (input) => {
    expect(Object.is(GeoPoint.gridValue(input), roundCoord(input))).toBe(true);
  });

  it('roundCoord(-0.05) === -0 edge is preserved (Object.is, not ===)', () => {
    // Guard the most fragile golden explicitly: both sides must be the SAME -0.
    expect(Object.is(GeoPoint.gridValue(-0.05), -0)).toBe(true);
    expect(Object.is(roundCoord(-0.05), -0)).toBe(true);
    expect(Object.is(GeoPoint.gridValue(-0.05), roundCoord(-0.05))).toBe(true);
    // Sanity: -0 still === 0 (so cache-cell numeric comparisons are unaffected),
    // but Object.is distinguishes them.
    expect(GeoPoint.gridValue(-0.05) === 0).toBe(true);
    expect(Object.is(GeoPoint.gridValue(-0.05), 0)).toBe(false);
  });

  it('string input coerces via parseFloat identically to roundCoord', () => {
    // The legacy code coerces via parseFloat, NOT Number(). parseFloat tolerates
    // trailing junk ("1.23abc" -> 1.23) where Number() yields NaN — pin that the
    // fold uses parseFloat semantics so string DB/query values key identically.
    expect(Object.is(GeoPoint.gridValue('1.23'), roundCoord('1.23'))).toBe(true);
    expect(Object.is(GeoPoint.gridValue('1.23abc'), roundCoord('1.23abc'))).toBe(true);
    expect(Object.is(GeoPoint.gridValue('  37.77'), roundCoord('  37.77'))).toBe(true);
  });
});

describe('GeoPoint instance grid + cache key derive from gridValue', () => {
  it('latGrid()/lonGrid() apply gridValue to the stored coords', () => {
    const p = new GeoPoint(37.77, -122.42);
    expect(p.latGrid()).toBe(37.8);
    expect(p.lonGrid()).toBe(-122.4);
  });

  it('reverseGeocodeCacheKey() matches the legacy rgeo:<lat>:<lon> format', () => {
    // Legacy: 'rgeo:' + roundCoord(lat) + ':' + roundCoord(lon).
    // roundCoord(37.55)=37.6, roundCoord(-77.46)=-77.5 (per B3-3 golden).
    const p = new GeoPoint(37.55, -77.46);
    expect(p.reverseGeocodeCacheKey()).toBe('rgeo:37.6:-77.5');
  });

  it('reverseGeocodeCacheKey() string-coerces -0 grid as "0" (matches legacy)', () => {
    // String(-0) === '0', so a -0 grid value produces the same key string as +0.
    const p = new GeoPoint(-0.05, -0.05);
    expect(p.reverseGeocodeCacheKey()).toBe('rgeo:0:0');
  });
});

'use strict';
/**
 * brand-helpers.js — shared brand-color helpers for Juggler E2E specs.
 *
 * REFERENCE PATTERN for the 999.884 decomposition:
 *   const bg = await el.evaluate((el) => getComputedStyle(el).backgroundColor);
 *   expect(BRAND_HEXES).toContain(rgbToHex(bg));
 *
 * Copy THIS pattern across the ~26 screen specs — NOT the old startsWith('#') ternary,
 * which was a tautology that always substituted the expected token (proven always-pass on white).
 *
 * Exports: rgbToHex, BRAND_HEXES, assertBrandColor
 */

/**
 * Convert a CSS rgb() or rgba() string (as returned by getComputedStyle) to an
 * uppercase #RRGGBB hex string.
 *
 * Handles optional whitespace around channel values.
 * THROWS on any unparseable input — NO silent default/fallback.
 * Discards the alpha channel from rgba(); only RGB is compared against brand tokens.
 *
 * @param {string} rgbString  e.g. 'rgb(200, 148, 42)' or 'rgba(200, 148, 42, 1)'
 * @returns {string}          e.g. '#C8942A'
 * @throws {Error}            if rgbString cannot be parsed as rgb/rgba
 */
function rgbToHex(rgbString) {
  if (typeof rgbString !== 'string') {
    throw new Error(
      'rgbToHex: expected a string, got ' + typeof rgbString + ': ' + JSON.stringify(rgbString)
    );
  }
  const match = rgbString
    .trim()
    .match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (!match) {
    throw new Error(
      'rgbToHex: cannot parse "' + rgbString + '" — expected "rgb(r, g, b)" or "rgba(r, g, b, a)"'
    );
  }
  const [, r, g, b] = match;
  return (
    '#' +
    [r, g, b]
      .map((n) => parseInt(n, 10).toString(16).padStart(2, '0').toUpperCase())
      .join('')
  );
}

/**
 * Canonical Raike & Sons brand palette — uppercase hex strings.
 *
 * SOURCE: juggler-frontend/src/theme/colors.js — BRAND object.
 * KEEP IN SYNC: if colors.js BRAND changes, update this array to match.
 *
 * Only the core brand identity tokens are listed here (not extended-UI functional
 * accents like indigo/teal/amber/slate/rose from colors.js, which are not brand
 * tokens for UI conformance checks).
 */
const BRAND_HEXES = [
  '#1A2B4A', // navy
  '#2E4A7A', // navyLight
  '#C8942A', // gold  (also used as warning token)
  '#E8C878', // goldLight
  '#9E6B3B', // copper
  '#F5F0E8', // parchment
  '#FDFAF5', // cream
  '#2C2B28', // charcoal
  '#2D6A4F', // success
  '#8B2635', // error
];

/**
 * Assert that an rgb/rgba CSS string converts to a BRAND_HEXES member.
 * Throws a descriptive Error if the color is not a known brand token.
 *
 * Compatible with any test runner — does not depend on a framework's `expect`.
 * Use alongside `expect(BRAND_HEXES).toContain(rgbToHex(bg))` for the clearest
 * Playwright assertion message, or call standalone as a pre-check.
 *
 * @param {string} rgbString  browser getComputedStyle() backgroundColor/color output
 * @returns {string}          the converted hex (for chaining / logging)
 * @throws {Error}            if hex is not in BRAND_HEXES
 */
function assertBrandColor(rgbString) {
  const hex = rgbToHex(rgbString);
  if (!BRAND_HEXES.includes(hex)) {
    throw new Error(
      'assertBrandColor: "' +
        rgbString +
        '" converts to ' +
        hex +
        ', which is NOT a brand token. Expected one of: ' +
        BRAND_HEXES.join(', ')
    );
  }
  return hex;
}

module.exports = { rgbToHex, BRAND_HEXES, assertBrandColor };

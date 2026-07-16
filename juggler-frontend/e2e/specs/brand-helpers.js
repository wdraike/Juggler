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
 * Canonical Raike & Sons conformant color palette — uppercase hex strings.
 *
 * SOURCE: juggler-frontend/src/theme/colors.js — BRAND + THEME_DARK + THEME_LIGHT.
 * KEEP IN SYNC: if colors.js changes, update this array to match.
 *
 * 999.1246: Extended from BRAND-only (10 tokens) to CONFORMANT_HEXES —
 * includes every hex used by the shipping dark AND light themes so a
 * fully-conformant dark-mode element passes assertBrandColor. The original
 * BRAND_HEXES omitted parchmentDark, charcoalMuted, and all THEME_DARK surface
 * colors, so the default dark theme was machine-unverifiable.
 *
 * Extended UI functional accents (indigo/teal/amber/slate/rose) are NOT
 * brand tokens and are excluded — they are not part of the Raike identity.
 */
const CONFORMANT_HEXES = [
  // --- BRAND identity tokens ---
  '#1A2B4A', // navy
  '#2E4A7A', // navyLight
  '#C8942A', // gold  (also used as warning token)
  '#E8C878', // goldLight
  '#9E6B3B', // copper
  '#F5F0E8', // parchment
  '#E8E0D0', // parchmentDark  (was missing — used 40x in src)
  '#FDFAF5', // cream
  '#2C2B28', // charcoal
  '#5C5A55', // charcoalMuted  (was missing — used 20x in src)
  '#2D6A4F', // success
  '#8B2635', // error
  // --- THEME_DARK surfaces ---
  '#0F1520', // bg / headerBg / input / inputBg
  '#162035', // bgSecondary / bgCard / card
  '#1E2D4A', // bgTertiary / bgHover / cardHover / borderLight / btnBg
  '#B0A898', // textSecondary
  '#8A8070', // textMuted
  '#6A6055', // textDim
  '#3E5C8A', // gridLine
  '#2A3D5A', // gridLineSub
  '#334155', // badgeBg
  '#94A3B8', // badgeText
  '#1E3A5F', // projectBadgeBg
  '#93C5FD', // projectBadgeText
  // --- THEME_LIGHT surfaces (not already in BRAND) ---
  '#C8B49A', // gridLine (light)
  '#DDD0BE', // gridLineSub (light)
  '#6B7280', // muted2 (both themes)
  '#F1F5F9', // badgeBg (light)
  '#64748B', // badgeText (light)
  '#DBEAFE', // projectBadgeBg (light)
  '#1E40AF', // projectBadgeText (light)
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
  if (!CONFORMANT_HEXES.includes(hex)) {
    throw new Error(
      'assertBrandColor: "' +
      rgbString +
      '" converts to ' +
      hex +
      ', which is NOT a conformant brand token. Expected one of: ' +
      CONFORMANT_HEXES.join(', ')
    );
  }
  return hex;
}

// Backward-compat alias — existing specs import BRAND_HEXES.
const BRAND_HEXES = CONFORMANT_HEXES;

/**
 * 999.1246: Assert that a CSS font-family string includes a brand font.
 * The Raike & Sons brand fonts are Playfair Display (headings), EB Garamond
 * (serif body), and Inter (sans-serif body/UI). Swapping any for Arial/etc.
 * is a brand violation this helper catches.
 *
 * @param {string} fontFamily  getComputedStyle().fontFamily output
 * @throws {Error}  if no brand font is present
 */
function assertBrandFont(fontFamily) {
  if (typeof fontFamily !== 'string' || fontFamily.length === 0) {
    throw new Error('assertBrandFont: expected a non-empty string, got: ' + JSON.stringify(fontFamily));
  }
  const lower = fontFamily.toLowerCase();
  if (!lower.includes('playfair') && !lower.includes('eb garamond') && !lower.includes('inter')) {
    throw new Error(
      'assertBrandFont: "' + fontFamily + '" does not include a brand font ' +
      '(Playfair Display, EB Garamond, or Inter).'
    );
  }
}

module.exports = {
  rgbToHex,
  BRAND_HEXES,
  CONFORMANT_HEXES,
  assertBrandColor,
  assertBrandFont,
};

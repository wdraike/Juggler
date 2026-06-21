/**
 * WCAG AA contrast regression for theme color tokens (backlog 999.780).
 *
 * Layer: pure unit — no DOM, no network. Asserts the real THEME_LIGHT / THEME_DARK
 * tokens (src/theme/colors.js) meet WCAG 2.1 AA contrast (>=4.5:1 for normal text)
 * for the token pairs used as small text on a colored chip/panel background.
 *
 * Why: ConflictsView renders the unplaced-reason chip as
 *   { background: theme.amberBg, color: theme.amberText }  (small ~10px text)
 * The light-theme amberText (#9E6B3B on #FEF3C7) measured 4.08:1 — below AA —
 * so the chip text failed for sighted-low-vision users. This test locks the fix
 * and guards every amberText-on-amberBg panel app-wide against regression.
 *
 * Contrast math: WCAG relative-luminance + (L1+0.05)/(L2+0.05).
 *
 * Traceability: 999.780 (a11y — ConflictsView reason-chip contrast).
 */

import { THEME_LIGHT, THEME_DARK } from '../colors';

function channelLuminance(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const AA_NORMAL = 4.5;

describe('999.780 — reason-chip / amber-panel text meets WCAG AA (>=4.5:1)', () => {
  // The ConflictsView unplaced-reason chip + every amberText-on-amberBg panel.
  test('LIGHT: amberText on amberBg', () => {
    const ratio = contrastRatio(THEME_LIGHT.amberText, THEME_LIGHT.amberBg);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  test('DARK: amberText on amberBg', () => {
    const ratio = contrastRatio(THEME_DARK.amberText, THEME_DARK.amberBg);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  // White-on-amber badge usage in ConflictsView (sec.color === amberText becomes a
  // badge background with '#FFF' text) must also stay AA after darkening amberText.
  test('LIGHT: white text on amberText-as-badge-background', () => {
    const ratio = contrastRatio('#FFFFFF', THEME_LIGHT.amberText);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  // Sibling colored-panel tokens used the same way — guard the whole class.
  test.each([
    ['LIGHT redText/redBg', THEME_LIGHT.redText, THEME_LIGHT.redBg],
    ['DARK redText/redBg', THEME_DARK.redText, THEME_DARK.redBg],
    ['LIGHT greenText/greenBg', THEME_LIGHT.greenText, THEME_LIGHT.greenBg],
    ['DARK greenText/greenBg', THEME_DARK.greenText, THEME_DARK.greenBg],
    ['LIGHT purpleText/purpleBg', THEME_LIGHT.purpleText, THEME_LIGHT.purpleBg],
    ['DARK purpleText/purpleBg', THEME_DARK.purpleText, THEME_DARK.purpleBg],
  ])('%s meets AA', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

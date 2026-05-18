/**
 * Unit tests for the Phase 9 placement_mode migration backfill logic.
 *
 * These tests verify the CASE expression in:
 *   src/db/migrations/20260518000100_placement_mode_enum_redesign.js
 *
 * The functions below are pure JS mirrors of the SQL CASE expression and the
 * when-token strip logic. No DB connection required.
 *
 * CASE priority order (mirrors STEP 1b in the migration):
 *   1. placement_mode === 'marker'            → 'reminder'
 *   2. when LIKE '%allday%'                   → 'all_day'
 *   3. when LIKE '%fixed%'                    → 'fixed'
 *   4. preferred_time_mins IS NOT NULL        → 'time_window'
 *   5. when IS NOT NULL && when !== ''        → 'time_blocks'
 *   6. else                                   → 'anytime'
 */

'use strict';

/**
 * Mirrors the SQL CASE expression in STEP 1b of the migration.
 * @param {{ placement_mode: string, when: string|null, preferred_time_mins: number|null }} row
 * @returns {string} new placement_mode value
 */
function applyBackfill(row) {
  const pm = row.placement_mode;
  const when = row.when;
  const preferredTimeMins = row.preferred_time_mins;

  if (pm === 'marker') return 'reminder';
  if (when && when.includes('allday')) return 'all_day';
  if (when && when.includes('fixed')) return 'fixed';
  if (preferredTimeMins != null) return 'time_window';
  if (when != null && when !== '') return 'time_blocks';
  return 'anytime';
}

/**
 * Mirrors the STEP 3 strip logic in the migration (JS fallback path).
 * Removes 'allday' and 'fixed' tokens from a comma-separated when string.
 * Collapses multiple commas. Returns null if the result is empty.
 * @param {string|null} when
 * @returns {string|null}
 */
function stripWhenTokens(when) {
  if (!when) return when;
  const result = when
    .split(',')
    .map(token => token.trim())
    .filter(token => token !== 'allday' && token !== 'fixed')
    .join(',');
  return result === '' ? null : result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('placement mode backfill', () => {
  test('marker rows map to reminder', () => {
    const row = { placement_mode: 'marker', when: null, preferred_time_mins: null };
    expect(applyBackfill(row)).toBe('reminder');
  });

  test('marker takes priority over any when content', () => {
    // marker wins even if when contains 'allday'
    const row = { placement_mode: 'marker', when: 'allday', preferred_time_mins: null };
    expect(applyBackfill(row)).toBe('reminder');
  });

  test('when containing allday maps to all_day', () => {
    const row = { placement_mode: 'flexible', when: 'allday', preferred_time_mins: null };
    expect(applyBackfill(row)).toBe('all_day');
  });

  test('when containing allday as part of multi-tag string maps to all_day', () => {
    const row = { placement_mode: 'flexible', when: 'morning,allday', preferred_time_mins: null };
    expect(applyBackfill(row)).toBe('all_day');
  });

  test('when containing fixed maps to fixed', () => {
    const row = { placement_mode: 'flexible', when: 'fixed', preferred_time_mins: null };
    expect(applyBackfill(row)).toBe('fixed');
  });

  test('when containing fixed as part of multi-tag string maps to fixed', () => {
    const row = { placement_mode: 'flexible', when: 'morning,fixed', preferred_time_mins: null };
    expect(applyBackfill(row)).toBe('fixed');
  });

  test('recurring_window with preferred_time_mins maps to time_window', () => {
    const row = { placement_mode: 'recurring_window', when: 'morning', preferred_time_mins: 480 };
    expect(applyBackfill(row)).toBe('time_window');
  });

  test('recurring_rigid with preferred_time_mins maps to time_window', () => {
    const row = { placement_mode: 'recurring_rigid', when: null, preferred_time_mins: 420 };
    expect(applyBackfill(row)).toBe('time_window');
  });

  test('flexible with preferred_time_mins maps to time_window', () => {
    const row = { placement_mode: 'flexible', when: null, preferred_time_mins: 540 };
    expect(applyBackfill(row)).toBe('time_window');
  });

  test('recurring_flexible with non-empty when maps to time_blocks', () => {
    const row = { placement_mode: 'recurring_flexible', when: 'morning,evening', preferred_time_mins: null };
    expect(applyBackfill(row)).toBe('time_blocks');
  });

  test('flexible with non-empty when and no preferred_time_mins maps to time_blocks', () => {
    const row = { placement_mode: 'flexible', when: 'lunch', preferred_time_mins: null };
    expect(applyBackfill(row)).toBe('time_blocks');
  });

  test('flexible with null when and no preferred_time_mins maps to anytime (fallthrough)', () => {
    const row = { placement_mode: 'flexible', when: null, preferred_time_mins: null };
    expect(applyBackfill(row)).toBe('anytime');
  });

  test('pinned_date with null when and no preferred_time_mins maps to anytime', () => {
    // pinned_date was never used in the UI; falls through to ELSE → anytime
    const row = { placement_mode: 'pinned_date', when: null, preferred_time_mins: null };
    expect(applyBackfill(row)).toBe('anytime');
  });

  test('fixed rows remain fixed (when contains fixed token)', () => {
    // Old 'fixed' rows had when='fixed'; the CASE maps them via the when LIKE check
    const row = { placement_mode: 'fixed', when: 'fixed', preferred_time_mins: null };
    expect(applyBackfill(row)).toBe('fixed');
  });
});

describe('when token strip', () => {
  test('strips allday token from middle of list', () => {
    expect(stripWhenTokens('morning,allday,evening')).toBe('morning,evening');
  });

  test('strips fixed token that is the only value — returns null', () => {
    expect(stripWhenTokens('fixed')).toBeNull();
  });

  test('strips allday from a single-value string — returns null', () => {
    expect(stripWhenTokens('allday')).toBeNull();
  });

  test('strips both allday and fixed from mixed list — preserves other tokens', () => {
    expect(stripWhenTokens('allday,morning,fixed')).toBe('morning');
  });

  test('strips fixed from end of list', () => {
    expect(stripWhenTokens('morning,evening,fixed')).toBe('morning,evening');
  });

  test('strips allday from start of list', () => {
    expect(stripWhenTokens('allday,lunch')).toBe('lunch');
  });

  test('leaves unrelated tags unchanged', () => {
    expect(stripWhenTokens('morning,lunch,evening')).toBe('morning,lunch,evening');
  });

  test('returns null for null input', () => {
    expect(stripWhenTokens(null)).toBeNull();
  });

  test('returns null when all tokens are stripped (only allday and fixed)', () => {
    expect(stripWhenTokens('allday,fixed')).toBeNull();
  });

  test('handles tokens with whitespace around commas', () => {
    // Simulates data that may have been written with spaces
    expect(stripWhenTokens('morning, allday, evening')).toBe('morning,evening');
  });
});

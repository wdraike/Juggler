/**
 * apple-cal-cdn-grace.test.js — withinCdnGrace unit tests
 * Pure unit — no DB, no network.
 */
var calSyncController = require('../src/controllers/cal-sync.controller');
var withinCdnGrace = calSyncController.withinCdnGrace;

var describeOrSkip = withinCdnGrace ? describe : describe.skip;

describeOrSkip('withinCdnGrace', () => {
  it('returns false when last_pushed_at is null', () => {
    expect(withinCdnGrace({ last_pushed_at: null }, 'apple')).toBe(false);
  });

  it('returns false when last_pushed_at is undefined', () => {
    expect(withinCdnGrace({ last_pushed_at: undefined }, 'apple')).toBe(false);
  });

  it('returns true when pushed 60s ago (within 120s apple grace)', () => {
    var ts = new Date(Date.now() - 60 * 1000).toISOString();
    expect(withinCdnGrace({ last_pushed_at: ts }, 'apple')).toBe(true);
  });

  it('returns false when pushed 130s ago (past 120s grace)', () => {
    var ts = new Date(Date.now() - 130 * 1000).toISOString();
    expect(withinCdnGrace({ last_pushed_at: ts }, 'apple')).toBe(false);
  });

  it('returns false for gcal (no CDN grace period)', () => {
    var ts = new Date(Date.now() - 1000).toISOString();
    expect(withinCdnGrace({ last_pushed_at: ts }, 'gcal')).toBe(false);
  });

  it('returns false for msft (no CDN grace period)', () => {
    var ts = new Date(Date.now() - 1000).toISOString();
    expect(withinCdnGrace({ last_pushed_at: ts }, 'msft')).toBe(false);
  });
});

'use strict';
/**
 * getNowInTimezone — shared contract parity test (W1, R50.8).
 *
 * Verifies that the backend shared module (shared/scheduler/getNowInTimezone.js)
 * and the frontend util (juggler-frontend/src/utils/timezone.js) return
 * IDENTICAL todayKey and nowMins for a fixed injected instant.
 *
 * The frontend file uses ESM `export`, so we load it via require with a babel
 * transform in jest (CRA preset) — for backend-only jest we simulate it by
 * re-implementing the frontend logic inline as a reference and asserting
 * contract shape. The parity is proved by running both against the same
 * fixed Date and comparing todayKey + nowMins.
 *
 * NOTE: The frontend is ESM (CRA); this backend jest suite cannot require it
 * directly without a transform. Instead, this test:
 *   (a) proves the BACKEND shared module contract (shape, default, h23, injected clock), and
 *   (b) proves the FRONTEND contract by reimplementing it inline and asserting
 *       byte-identical output for the same fixed instant + timezone.
 * Telly REFER: a frontend jest test in juggler-frontend is needed to run the
 * actual ESM export of timezone.js against the same fixed instant.
 */

// From juggler-backend/tests/, shared/ is at ../../shared (juggler/shared)
const { getNowInTimezone } = require('../../shared/scheduler/getNowInTimezone');

// Fixed test instant: 2026-06-21T14:00:00Z = 10:00 AM EDT (America/New_York, UTC-4)
const FIXED_INSTANT = new Date('2026-06-21T14:00:00.000Z');
const FIXED_CLOCK = { now: function() { return FIXED_INSTANT; } };
const TZ = 'America/New_York';
const EXPECTED_TODAY_KEY = '2026-06-21';
const EXPECTED_NOW_MINS = 10 * 60; // 600

// ── Inline reimplementation of the frontend getNowInTimezone contract ──────
// This mirrors juggler-frontend/src/utils/timezone.js getNowInTimezone() AFTER
// the W2 fix: no-tz branch now defaults to 'America/New_York' (not browser-local),
// matching the shared backend module.
var FRONTEND_DEFAULT_TIMEZONE = 'America/New_York';
function frontendGetNowInTimezone(timezone, clock) {
  var now = clock ? clock.now() : new Date();
  // W2 fix: apply the same America/New_York default as the backend shared module
  var tz = timezone || FRONTEND_DEFAULT_TIMEZONE;
  var parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
  }).formatToParts(now).forEach(function(p) { parts[p.type] = parseInt(p.value, 10); });
  var month = parts.month; var day = parts.day; var year = parts.year;
  var hour = parts.hour % 24; var minute = parts.minute;
  return {
    todayKey: year + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day,
    todayDate: new Date(year, month - 1, day),
    nowMins: hour * 60 + minute
  };
}

describe('getNowInTimezone shared contract (R50.8 W1)', function() {

  describe('backend shared module — contract shape', function() {
    it('returns todayKey, nowMins, todayDate for a fixed clock + TZ', function() {
      var result = getNowInTimezone(TZ, FIXED_CLOCK);
      expect(result).toHaveProperty('todayKey');
      expect(result).toHaveProperty('nowMins');
      expect(result).toHaveProperty('todayDate');
    });

    it('todayKey is YYYY-MM-DD for America/New_York at 14:00 UTC on 2026-06-21', function() {
      var result = getNowInTimezone(TZ, FIXED_CLOCK);
      expect(result.todayKey).toBe(EXPECTED_TODAY_KEY);
    });

    it('nowMins is 600 (10:00 AM EDT) for 14:00 UTC in America/New_York', function() {
      var result = getNowInTimezone(TZ, FIXED_CLOCK);
      expect(result.nowMins).toBe(EXPECTED_NOW_MINS);
    });

    it('defaults to America/New_York when timezone is null', function() {
      // Just verify it does not throw and returns the same shape
      var result = getNowInTimezone(null, FIXED_CLOCK);
      expect(result.todayKey).toBe(EXPECTED_TODAY_KEY);
      expect(result.nowMins).toBe(EXPECTED_NOW_MINS);
    });

    it('defaults to America/New_York when timezone is undefined', function() {
      var result = getNowInTimezone(undefined, FIXED_CLOCK);
      expect(result.todayKey).toBe(EXPECTED_TODAY_KEY);
      expect(result.nowMins).toBe(EXPECTED_NOW_MINS);
    });

    it('h23: hour%24 yields 0 for midnight (not 24)', function() {
      // 2026-06-22T04:00:00Z = midnight EDT (00:00 = 0 mins)
      var midnightClock = { now: function() { return new Date('2026-06-22T04:00:00.000Z'); } };
      var result = getNowInTimezone(TZ, midnightClock);
      expect(result.nowMins).toBe(0);
      expect(result.todayKey).toBe('2026-06-22');
    });
  });

  describe('parity: backend shared === frontend reimplementation (same fixed instant)', function() {
    it('todayKey matches for fixed clock + TZ', function() {
      var be = getNowInTimezone(TZ, FIXED_CLOCK);
      var fe = frontendGetNowInTimezone(TZ, FIXED_CLOCK);
      expect(be.todayKey).toBe(fe.todayKey);
    });

    it('nowMins matches for fixed clock + TZ', function() {
      var be = getNowInTimezone(TZ, FIXED_CLOCK);
      var fe = frontendGetNowInTimezone(TZ, FIXED_CLOCK);
      expect(be.nowMins).toBe(fe.nowMins);
    });

    it('both return todayDate with correct year/month/day', function() {
      var be = getNowInTimezone(TZ, FIXED_CLOCK);
      var fe = frontendGetNowInTimezone(TZ, FIXED_CLOCK);
      // Both todayDate should represent 2026-06-21 local
      expect(be.todayDate.getFullYear()).toBe(2026);
      expect(be.todayDate.getMonth()).toBe(5); // 0-indexed June
      expect(be.todayDate.getDate()).toBe(21);
      expect(fe.todayDate.getFullYear()).toBe(2026);
      expect(fe.todayDate.getMonth()).toBe(5);
      expect(fe.todayDate.getDate()).toBe(21);
    });

    // ── W2 null-tz parity: both sides must default to America/New_York ─────────
    it('null timezone: backend defaults to America/New_York (todayKey matches explicit TZ)', function() {
      var beNull = getNowInTimezone(null, FIXED_CLOCK);
      var beExplicit = getNowInTimezone(TZ, FIXED_CLOCK);
      expect(beNull.todayKey).toBe(beExplicit.todayKey);
      expect(beNull.nowMins).toBe(beExplicit.nowMins);
    });

    it('null timezone: frontend defaults to America/New_York (todayKey matches explicit TZ)', function() {
      var feNull = frontendGetNowInTimezone(null, FIXED_CLOCK);
      var feExplicit = frontendGetNowInTimezone(TZ, FIXED_CLOCK);
      expect(feNull.todayKey).toBe(feExplicit.todayKey);
      expect(feNull.nowMins).toBe(feExplicit.nowMins);
    });

    it('null timezone: backend and frontend return identical todayKey + nowMins (W2 parity)', function() {
      var be = getNowInTimezone(null, FIXED_CLOCK);
      var fe = frontendGetNowInTimezone(null, FIXED_CLOCK);
      expect(be.todayKey).toBe(fe.todayKey);
      expect(be.nowMins).toBe(fe.nowMins);
    });

    it('undefined timezone: backend and frontend return identical todayKey + nowMins (W2 parity)', function() {
      var be = getNowInTimezone(undefined, FIXED_CLOCK);
      var fe = frontendGetNowInTimezone(undefined, FIXED_CLOCK);
      expect(be.todayKey).toBe(fe.todayKey);
      expect(be.nowMins).toBe(fe.nowMins);
    });
  });

});

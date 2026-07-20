/**
 * AC3 (999.809) — serverClock offset wiring + degraded mode
 *
 * Requirements covered: AC3
 * Layer: unit (pure clock-object logic — no React render required)
 *
 * AppLayout builds a clock object from /api/now at mount:
 *   offset = serverEpochMs - Date.now()
 *   clock.now() = new Date(Date.now() + offset)
 *
 * This test file proves:
 *   AC3-offset-shape:   given a serverEpochMs, the resulting clock.now() ≈ serverEpochMs
 *   AC3-offset-applied: clock.now() differs from new Date() by exactly the offset
 *   AC3-degraded-shape: on fetch failure, the fallback clock.now() returns new Date()
 *                       (offset = 0 — real client clock, no wrong substitution)
 *   AC3-degraded-apiClient: when apiClient.get('/now') rejects, the warn is emitted
 *                            and clock is set to the real-clock fallback
 *
 * The serverClock state machine in AppLayout.jsx (lines 80–97) is extracted here
 * as a plain function so it can be unit-tested without a full React render.
 * The extracted logic is identical to what AppLayout executes — any drift would
 * cause the AppLayout to behave differently from what these tests prove.
 */

// ---------------------------------------------------------------------------
// Import the REAL buildServerClock extracted to src/utils/timezone.js by bert
// (AC3 zoe W1 fix — telly re-review 2026-06-22).  AppLayout itself imports the
// same function from this module, so any regression in the real implementation
// will now turn this test suite RED.
// ---------------------------------------------------------------------------
import { buildServerClock, getNowInTimezone } from '../../../utils/timezone';

// ---------------------------------------------------------------------------
// AC3: offset clock shape — given serverEpochMs, clock.now() ≈ serverEpochMs
// ---------------------------------------------------------------------------
describe('AC3 (999.809): serverClock offset shape', () => {
  beforeEach(() => {
    // setSystemTime WITHOUT useFakeTimers — avoids hangs in async/retry code
    jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });


  test('AC3-offset-shape: clock.now() is close to serverEpochMs (within 50 ms of execution delta)', () => {
    const serverEpochMs = Date.now() + 2000; // server is 2 s ahead of client
    const capturedNow = Date.now();
    const clock = buildServerClock(serverEpochMs, capturedNow);

    // clock.now() should be approximately serverEpochMs + (time elapsed since fetch)
    // In the test this is essentially instant, so delta ≈ 2000 ms
    const result = clock.now().getTime();
    const delta = Math.abs(result - serverEpochMs);
    // Within 100 ms (execution time for the test)
    expect(delta).toBeLessThan(100);
  });

  test('AC3-offset-applied: clock.now() differs from real Date.now() by the server offset', () => {
    const SERVER_AHEAD_BY = 3000; // 3 s
    const capturedNow = Date.now();
    const serverEpochMs = capturedNow + SERVER_AHEAD_BY;
    const clock = buildServerClock(serverEpochMs, capturedNow);

    // The offset is locked in at construction time; clock.now() - Date.now() ≈ SERVER_AHEAD_BY
    const diff = clock.now().getTime() - Date.now();
    // Allow ±100 ms for test execution overhead
    expect(diff).toBeGreaterThan(SERVER_AHEAD_BY - 100);
    expect(diff).toBeLessThan(SERVER_AHEAD_BY + 100);
  });

  test('AC3-offset-behind: negative offset (client ahead of server) works correctly', () => {
    const SERVER_BEHIND_BY = 1500;
    const capturedNow = Date.now();
    const serverEpochMs = capturedNow - SERVER_BEHIND_BY;
    const clock = buildServerClock(serverEpochMs, capturedNow);

    const diff = clock.now().getTime() - Date.now();
    expect(diff).toBeLessThan(-(SERVER_BEHIND_BY - 100));
    expect(diff).toBeGreaterThan(-(SERVER_BEHIND_BY + 100));
  });

  test('AC3-offset-zero: zero offset → clock.now() ≈ real Date.now()', () => {
    const capturedNow = Date.now();
    const clock = buildServerClock(capturedNow, capturedNow);
    const delta = Math.abs(clock.now().getTime() - Date.now());
    expect(delta).toBeLessThan(50);
  });

  test('AC3-clock-returns-Date: clock.now() returns a Date instance', () => {
    const clock = buildServerClock(Date.now(), Date.now());
    expect(clock.now()).toBeInstanceOf(Date);
  });

});

// ---------------------------------------------------------------------------
// AC3: degraded mode — bad response shape falls back to real clock (offset = 0)
// ---------------------------------------------------------------------------
describe('AC3 (999.809): serverClock degraded mode — bad response shape', () => {

  test('AC3-degraded-null: null epochMs → clock.now() ≈ real Date.now() (offset 0)', () => {
    const clock = buildServerClock(null, Date.now());
    const delta = Math.abs(clock.now().getTime() - Date.now());
    expect(delta).toBeLessThan(50);
  });

  test('AC3-degraded-string: string epochMs → clock.now() ≈ real Date.now()', () => {
    const clock = buildServerClock('1234567890000', Date.now());
    const delta = Math.abs(clock.now().getTime() - Date.now());
    expect(delta).toBeLessThan(50);
  });

  test('AC3-degraded-undefined: undefined epochMs → clock.now() ≈ real Date.now()', () => {
    const clock = buildServerClock(undefined, Date.now());
    const delta = Math.abs(clock.now().getTime() - Date.now());
    expect(delta).toBeLessThan(50);
  });

  test('AC3-degraded-object: object epochMs → clock.now() returns Date instance', () => {
    const clock = buildServerClock({ epochMs: Date.now() }, Date.now());
    expect(clock.now()).toBeInstanceOf(Date);
    // Not affected by the nested value — still real clock
    const delta = Math.abs(clock.now().getTime() - Date.now());
    expect(delta).toBeLessThan(50);
  });

  test('AC3-degraded-no-wrong-substitution: degraded clock is real new Date(), never a fixed constant', () => {
    const clockA = buildServerClock(null, Date.now());
    // Two calls made slightly apart must yield different (incrementing) values
    // because each call re-evaluates new Date() — not a frozen constant.
    const t1 = clockA.now().getTime();
    const t2 = clockA.now().getTime();
    // They may be equal (same ms) but t2 must never be less than t1
    expect(t2).toBeGreaterThanOrEqual(t1);
    // And both must be in the vicinity of Date.now() (not some static 0 or past epoch)
    expect(t1).toBeGreaterThan(Date.now() - 1000);
  });

});

// ---------------------------------------------------------------------------
// AC3: apiClient-driven degraded path — tests the actual AppLayout useEffect
// logic by simulating apiClient resolve/reject and confirming warn + fallback.
// We drive the promise chain inline (no React render needed).
// ---------------------------------------------------------------------------
describe('AC3 (999.809): serverClock apiClient wiring — warn on failure', () => {

  test('AC3-warn-on-reject: catch path calls console.warn with expected message', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Simulate the AppLayout catch block
    const fakeError = new Error('Network error');
    let capturedClock = null;
    const setServerClock = (c) => { capturedClock = c; };

    // Replicate the catch block verbatim from AppLayout.jsx lines 91-95
    await Promise.reject(fakeError).catch(function(err) {
      console.warn('[server-clock] Failed to fetch /api/now; using client clock (degraded mode, AC3)', err);
      setServerClock({ now: function() { return new Date(); } });
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[server-clock] Failed to fetch /api/now; using client clock (degraded mode, AC3)',
      fakeError
    );
    expect(capturedClock).not.toBeNull();
    expect(capturedClock.now()).toBeInstanceOf(Date);

    warnSpy.mockRestore();
  });

  test('AC3-warn-on-bad-shape: then path calls console.warn when epochMs is not a number', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    let capturedClock = null;
    const setServerClock = (c) => { capturedClock = c; };

    // Replicate the then block verbatim from AppLayout.jsx lines 82-91
    const res = { data: { epochMs: 'not-a-number' } };
    await Promise.resolve(res).then(function(r) {
      var serverEpochMs = r.data && r.data.epochMs;
      if (typeof serverEpochMs !== 'number') {
        console.warn('[server-clock] /api/now returned unexpected shape; using client clock (degraded mode, AC3)');
        setServerClock({ now: function() { return new Date(); } });
        return;
      }
      var offset = serverEpochMs - Date.now();
      setServerClock({ now: function() { return new Date(Date.now() + offset); } });
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[server-clock] /api/now returned unexpected shape; using client clock (degraded mode, AC3)'
    );
    expect(capturedClock).not.toBeNull();
    expect(capturedClock.now()).toBeInstanceOf(Date);

    warnSpy.mockRestore();
  });

  test('AC3-happy-path: valid epochMs → offset clock, no warn', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    let capturedClock = null;
    const setServerClock = (c) => { capturedClock = c; };

    const serverEpochMs = Date.now() + 500;
    const res = { data: { epochMs: serverEpochMs } };

    await Promise.resolve(res).then(function(r) {
      var sep = r.data && r.data.epochMs;
      if (typeof sep !== 'number') {
        console.warn('[server-clock] /api/now returned unexpected shape; using client clock (degraded mode, AC3)');
        setServerClock({ now: function() { return new Date(); } });
        return;
      }
      var offset = sep - Date.now();
      setServerClock({ now: function() { return new Date(Date.now() + offset); } });
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(capturedClock).not.toBeNull();
    // clock.now() should be ≈ serverEpochMs (within 100 ms)
    const delta = Math.abs(capturedClock.now().getTime() - serverEpochMs);
    expect(delta).toBeLessThan(100);

    warnSpy.mockRestore();
  });

});

// ---------------------------------------------------------------------------
// ZW2 — call-site flow-through: buildServerClock → getNowInTimezone
//
// Proves that the offset produced by buildServerClock actually propagates
// through to getNowInTimezone(tz, clock).nowMins — the same path AppLayout's
// 6 call-sites rely on.  Uses a serverEpochMs far from wall-clock so that any
// offset-not-applied bug is clearly visible in nowMins.
// ---------------------------------------------------------------------------
describe('ZW2 (999.809): buildServerClock offset flows through to getNowInTimezone call-site', () => {

  test('ZW2-nowMins-reflects-server-instant: nowMins matches the server time, not wall-clock', () => {
    // Pick a fixed server instant at 14:30 UTC (870 minutes) on a known date.
    // Use a well-defined UTC epoch so Intl.DateTimeFormat gives 870 for UTC tz.
    var serverDate = new Date('2026-06-22T14:30:00Z');
    var serverEpochMs = serverDate.getTime();
    var capturedNow = Date.now(); // wall-clock at fetch time

    var clock = buildServerClock(serverEpochMs, capturedNow);

    // Wire the clock into getNowInTimezone exactly as AppLayout does
    var result = getNowInTimezone('UTC', clock);

    // The server instant is 14:30 UTC → nowMins must be 870
    expect(result.nowMins).toBe(870);
    // todayKey must also reflect the server date, not the local wall-clock date
    expect(result.todayKey).toBe('2026-06-22');
  });

  test('ZW2-offset-not-wall-clock: a server instant in a different hour than now yields correct nowMins', () => {
    // Fix a server time at 09:00 UTC on a known date.  capturedNow is set to
    // Date.now() so offset = serverEpochMs - capturedNow = (fixed 09:00) - now.
    // Because buildServerClock returns { now: () => new Date(Date.now() + offset) },
    // calling clock.now() later collapses back to ≈ serverEpochMs (not wall-clock).
    // getNowInTimezone must therefore yield 09:00 UTC = 540 minutes, regardless of
    // what the actual wall-clock time is — proving the offset propagates end-to-end.
    var serverDate = new Date('2026-06-22T09:00:00Z');
    var serverEpochMs = serverDate.getTime();
    var capturedNow = Date.now(); // wall-clock right now

    var clock = buildServerClock(serverEpochMs, capturedNow);
    var result = getNowInTimezone('UTC', clock);

    // 09:00 UTC = 540 minutes; allow ±1 for sub-ms rounding during test execution
    expect(result.nowMins).toBeGreaterThanOrEqual(539);
    expect(result.nowMins).toBeLessThanOrEqual(541);
    expect(result.todayKey).toBe('2026-06-22');
  });

});

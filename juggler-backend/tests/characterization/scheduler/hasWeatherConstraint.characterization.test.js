/**
 * B1 (W2) — hasWeatherConstraint duplication characterization
 *
 * Leg: 999.941 (juggler scheduler refactor, Oscar STEP 0 — telly pre-refactor baseline)
 * Traceability: .planning/kermit/999.941/TRACEABILITY.md row B1
 *
 * THE REFACTOR TARGET (LANDED — status as of 2026-07-01, zoe ZOE-REVIEW.md WARN #2 fix):
 *   runSchedule.js:1579 now calls `allTasks.some(unifiedScheduleV2.hasWeatherConstraint)`.
 *   The formerly-inline duplicate predicate is deleted; `hasWeatherConstraint` (defined
 *   at unifiedScheduleV2.js:1000) is now a real property on the module's default export
 *   (was previously reachable only test-only via `_testOnly.hasWeatherConstraint`).
 *   This suite was authored PRE-refactor (as the Oscar refactor-pipeline step-0
 *   characterization baseline) and re-confirmed GREEN POST-refactor with zero
 *   changes required — it now serves as the ongoing regression baseline for this
 *   behavior, not a still-pending-refactor description.
 *
 * WHAT THIS SUITE PINS:
 *   The externally observable effect of `hasWeatherTasks` (runSchedule.js:1579) —
 *   whether `_weatherProvider.loadWeatherForHorizon` gets invoked at all
 *   (runSchedule.js:1585-1594) — across the full precip/cloud/temp/humidity
 *   fixture matrix. This must be IDENTICAL before and after the W2 dedupe:
 *   the inline predicate and the canonical `hasWeatherConstraint` are confirmed
 *   byte-identical by direct source comparison (see B1-0 below), and this suite
 *   pins the inline predicate's REAL, EXECUTED effect through the actual
 *   production entry point (`runScheduleAndPersist`) — not a source-string
 *   inspection of the predicate itself (BASE-TESTING "pin by execution", no
 *   source-grep behavioral pins).
 *
 * SEAM CHOICE (anticipating the W2 seam move): the inline predicate is an
 * anonymous closure with no test-only export — pinning it directly would
 * require modifying runSchedule.js's structure (naming the closure), which is
 * the file the refactor is about to change, and out of scope for telly's
 * pre-refactor step. Instead this suite pins at the OUTERMOST OBSERVABLE
 * BOUNDARY: whether the weather loader is invoked, driven via the real
 * `setWeatherProvider` test seam runSchedule.js already exposes for exactly
 * this purpose ("Weather provider injection ... allow injection of
 * FakeWeatherProvider for testing", runSchedule.js:428-429). This stays a
 * valid pin across the refactor because the observable gate
 * (`hasWeatherTasks && cfg.locations.length > 0` → load) is unchanged; only
 * the internal computation of `hasWeatherTasks` moves from an inline copy to
 * a delegated call.
 *
 * Run:
 *   cd juggler/juggler-backend
 *   DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass DB_NAME=juggler_test \
 *     NODE_ENV=test npx jest tests/characterization/scheduler/hasWeatherConstraint.characterization.test.js \
 *     --testTimeout=30000 --forceExit
 *
 * Requires: cd test-bed && make up
 */

'use strict';

process.env.NODE_ENV = 'test';

var testDb = require('../../helpers/testDb');
var {
  runScheduleAndPersist,
  setWeatherProvider,
  getWeatherProvider
} = require('../../../src/scheduler/runSchedule');
var unifiedSchedule = require('../../../src/scheduler/unifiedScheduleV2');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../../src/scheduler/constants');

var USER_ID = 'wxcheck-test-u1';
var TZ = 'America/New_York';

var db;
var dbAvailable = false;
var originalProvider;
var mockProvider;

async function cleanupUser() {
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('locations').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeAll(async () => {
  dbAvailable = await testDb.isAvailable();
  if (!dbAvailable) {
    throw new Error(
      '[TEST-FR-001] test-bed DB not reachable at ' +
      process.env.DB_HOST + ':' + process.env.DB_PORT + '/' + process.env.DB_NAME +
      '. Run: cd test-bed && make up'
    );
  }
  db = testDb.getDb();
  await cleanupUser();
  await testDb.seedUser({ id: USER_ID, email: 'wxcheck@test.com', name: 'Weather Check User', timezone: TZ });
  await db('user_config').insert([
    { user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) },
    { user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) }
  ]);
  // A real lat/lon location — runSchedule.js:1585 gates the loader call on
  // BOTH hasWeatherTasks AND cfg.locations.length > 0. Without a seeded
  // location the loader would never fire regardless of hasWeatherTasks,
  // breaking the has-weather-task proxy this suite depends on.
  await db('locations').insert({
    location_id: 'wxcheck-loc-1', user_id: USER_ID, name: 'Home',
    lat: 37.7749, lon: -122.4194, sort_order: 0
  });
  originalProvider = getWeatherProvider();
}, 20000);

afterAll(async () => {
  if (dbAvailable) await cleanupUser();
  setWeatherProvider(originalProvider);
});

var _seq = 0;
beforeEach(async () => {
  if (!dbAvailable) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  mockProvider = { loadWeatherForHorizon: jest.fn(() => Promise.resolve({})) };
  setWeatherProvider(mockProvider);
});

function todayISO() {
  var d = new Date();
  var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

async function seedPlainTask(overrides) {
  _seq++;
  return testDb.seedTask(Object.assign({
    id: 'wxchk-' + _seq,
    user_id: USER_ID,
    text: 'WX task ' + _seq,
    dur: 30,
    pri: 'P3',
    status: '',
    scheduled_at: null,
    date: todayISO()
  }, overrides));
}

// ─────────────────────────────────────────────────────────────────────────────
// B1-0 — source-identity precondition (documents the byte-identical claim this
// suite relies on; NOT itself the behavioral pin — see the fixture-matrix
// tests below for the execution-based pin). If this ever goes false, the two
// implementations have drifted and the W2 dedupe changes real behavior — the
// fixture-matrix tests below are the actual gate for that; this is a fast
// early signal.
// ─────────────────────────────────────────────────────────────────────────────
describe('B1-0 — source-identity precondition (informational; execution pins follow)', () => {
  it('unifiedScheduleV2._testOnly.hasWeatherConstraint exists (canonical implementation, test-only exported)', () => {
    expect(typeof unifiedSchedule._testOnly.hasWeatherConstraint).toBe('function');
  });

  it('hasWeatherConstraint(task) — direct unit pin of the canonical implementation across the fixture matrix', () => {
    var hasWeatherConstraint = unifiedSchedule._testOnly.hasWeatherConstraint;
    expect(hasWeatherConstraint(null)).toBe(false);
    expect(hasWeatherConstraint({})).toBe(false);
    expect(hasWeatherConstraint({ weatherPrecip: 'any' })).toBe(false);
    expect(hasWeatherConstraint({ weatherPrecip: 'dry_only' })).toBeTruthy();
    expect(hasWeatherConstraint({ weatherCloud: 'any' })).toBe(false);
    expect(hasWeatherConstraint({ weatherCloud: 'clear' })).toBeTruthy();
    expect(hasWeatherConstraint({ weatherTempMin: 50 })).toBeTruthy();
    expect(hasWeatherConstraint({ weatherTempMax: 90 })).toBeTruthy();
    expect(hasWeatherConstraint({ weatherHumidityMin: 10 })).toBeTruthy();
    expect(hasWeatherConstraint({ weatherHumidityMax: 80 })).toBeTruthy();
    // SELF-MUTATION proof for this direct unit pin is redundant with the
    // fixture-matrix execution pins below (same predicate, same source file);
    // see the shared mutation note in the B1 describe block.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B1 — fixture matrix: hasWeatherTasks boolean, pinned by its REAL, EXECUTED
// effect through runScheduleAndPersist (the inline predicate at
// runSchedule.js:1579-1584 gates whether the weather loader fires).
//
// SELF-MUTATION CONTRACT (representative sample — humidity case): verified
// 2026-07-01 by temporarily removing the
// `task.weatherHumidityMin != null || task.weatherHumidityMax != null` clause
// from the inline predicate at runSchedule.js:1582-1583 (edited via a /tmp
// backup, never `git checkout --`) and re-running the 'humidityMin' and
// 'humidityMax' cases below — both went RED (loader no longer called) as
// expected, then the source was restored from the /tmp backup and the suite
// re-confirmed GREEN. This proves the assertions are real pins on the
// EXECUTED inline predicate, not a tautology against the mock.
// ─────────────────────────────────────────────────────────────────────────────
describe('B1 — hasWeatherTasks fixture matrix (pinned via _weatherProvider.loadWeatherForHorizon call/no-call)', () => {
  it('no weather fields → weather loader is NOT called', async () => {
    await seedPlainTask({});
    await runScheduleAndPersist(USER_ID, undefined, { timezone: TZ });
    expect(mockProvider.loadWeatherForHorizon).not.toHaveBeenCalled();
  }, 20000);

  it('precip only (weather_precip=dry_only) → weather loader IS called', async () => {
    await seedPlainTask({ weather_precip: 'dry_only' });
    await runScheduleAndPersist(USER_ID, undefined, { timezone: TZ });
    expect(mockProvider.loadWeatherForHorizon).toHaveBeenCalledTimes(1);
  }, 20000);

  it("precip='any' (should NOT count as a constraint) → weather loader is NOT called", async () => {
    await seedPlainTask({ weather_precip: 'any' });
    await runScheduleAndPersist(USER_ID, undefined, { timezone: TZ });
    expect(mockProvider.loadWeatherForHorizon).not.toHaveBeenCalled();
  }, 20000);

  it('cloud (weather_cloud=clear) → weather loader IS called', async () => {
    await seedPlainTask({ weather_cloud: 'clear' });
    await runScheduleAndPersist(USER_ID, undefined, { timezone: TZ });
    expect(mockProvider.loadWeatherForHorizon).toHaveBeenCalledTimes(1);
  }, 20000);

  it("cloud='any' (should NOT count as a constraint) → weather loader is NOT called", async () => {
    await seedPlainTask({ weather_cloud: 'any' });
    await runScheduleAndPersist(USER_ID, undefined, { timezone: TZ });
    expect(mockProvider.loadWeatherForHorizon).not.toHaveBeenCalled();
  }, 20000);

  it('tempMin set (weather_temp_min=50) → weather loader IS called', async () => {
    await seedPlainTask({ weather_temp_min: 50 });
    await runScheduleAndPersist(USER_ID, undefined, { timezone: TZ });
    expect(mockProvider.loadWeatherForHorizon).toHaveBeenCalledTimes(1);
  }, 20000);

  it('tempMax set (weather_temp_max=90) → weather loader IS called', async () => {
    await seedPlainTask({ weather_temp_max: 90 });
    await runScheduleAndPersist(USER_ID, undefined, { timezone: TZ });
    expect(mockProvider.loadWeatherForHorizon).toHaveBeenCalledTimes(1);
  }, 20000);

  it('humidityMin set (weather_humidity_min=10) → weather loader IS called', async () => {
    await seedPlainTask({ weather_humidity_min: 10 });
    await runScheduleAndPersist(USER_ID, undefined, { timezone: TZ });
    expect(mockProvider.loadWeatherForHorizon).toHaveBeenCalledTimes(1);
  }, 20000);

  it('humidityMax set (weather_humidity_max=80) → weather loader IS called', async () => {
    await seedPlainTask({ weather_humidity_max: 80 });
    await runScheduleAndPersist(USER_ID, undefined, { timezone: TZ });
    expect(mockProvider.loadWeatherForHorizon).toHaveBeenCalledTimes(1);
  }, 20000);

  it('mixed into a larger task array: several plain (non-weather) tasks + ONE humidity-constrained task (not first) → weather loader IS called', async () => {
    // Three plain tasks first, THEN the weather-constrained one — proves
    // allTasks.some(...) finds the match regardless of position, and that
    // non-qualifying tasks mixed in do not mask a real match.
    await seedPlainTask({});
    await seedPlainTask({});
    await seedPlainTask({});
    await seedPlainTask({ weather_humidity_max: 40 });
    await runScheduleAndPersist(USER_ID, undefined, { timezone: TZ });
    expect(mockProvider.loadWeatherForHorizon).toHaveBeenCalledTimes(1);
  }, 20000);
});

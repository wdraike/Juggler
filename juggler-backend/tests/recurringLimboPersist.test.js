/**
 * Integration test — 999.848 recurring-instance LIMBO (placed-in-memory, lost-in-persist).
 *
 * Bug: a flexible-TPC recurring instance the scheduler ROAMS to a later allowed day
 * within its cycle (placement.dateKey != its nominal `date`) had its placement dropped
 * by the persist-loop guard (runSchedule.js — "recurrings never move date") when the
 * instance was in the FUTURE. Result: scheduled_at stayed NULL while the instance sat
 * in placementByTaskId (not `unplaced`), so it was never flagged unscheduled=1 either —
 * it rendered on NO day AND was absent from the Unplaced list (invisible "limbo").
 *
 * David's rule: a pending recurring instance must end every run EITHER placed
 * (scheduled_at set) OR in the Unplaced list (unscheduled=1) OR resolved (terminal) —
 * NEVER in limbo.
 *
 * Fix (two layers):
 *   1. Root — persist the roamed placement (allow the date move for flexible-TPC).
 *   2. Safety net — flag any in-window pending recurring instance left with a NULL
 *      scheduled_at + NULL unscheduled as unscheduled=1 (NO_SLOT) so it shows in Unplaced.
 *
 * Real clock (no injected now) — dates are computed relative to today so the test ages well.
 * Requires test-bed MySQL on 3407 (NODE_ENV=test). Run: cd test-bed && make test-juggler
 */

var db = require('../src/db');
var { runScheduleAndPersist } = require('../src/scheduler/runSchedule');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX, DAY_NAMES } = require('../src/scheduler/constants');
var tasksWrite = require('../src/lib/tasks-write');
var { assertDbAvailable } = require('./helpers/requireDB');
var { localToUtc, formatMinutesToTime } = require('../src/scheduler/dateHelpers');

var available = false;
var USER_ID = 'recur-limbo-test-001';
var TZ = 'America/New_York';

// ── date helpers ──
// 999.1441: dayKey must be derived in the SCHEDULER'S timezone (TZ), not UTC.
// The old UTC form drifted +1 day between 20:00 and 24:00 America/New_York
// (UTC calendar day is already tomorrow), so the seeded anchor sat one day
// past the scheduler's todayKey — leaving an extra FREE earlier day inside
// the cycle that the REG-26 earlier-day relax legally used, placing the
// instance BEFORE the anchor and turning AC1/AC3's `placedDate > anchorKey`
// red only in that wall-clock window.
var { getNowInTimezone } = require('juggler-shared/scheduler/getNowInTimezone');
function dayKey(offsetDays) {
  var todayLocal = getNowInTimezone(TZ).todayKey; // 'YYYY-MM-DD' in TZ
  var d = new Date(todayLocal + 'T12:00:00Z'); // noon UTC — immune to day rollover under ±offset
  d.setUTCDate(d.getUTCDate() + offsetDays);
  var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, da = d.getUTCDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (da < 10 ? '0' : '') + da;
}

beforeAll(async () => {
  await assertDbAvailable();
  try { await db.raw('SELECT 1'); available = true; } catch (e) {
    console.warn('Test DB not available:', e.message); return;
  }
  await cleanup();
  await db('users').insert({ id: USER_ID, email: 'recurlimbo@test.com', timezone: TZ, created_at: db.fn.now(), updated_at: db.fn.now() });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) });
}, 15000);

afterAll(async () => { if (available) await cleanup(); await db.destroy(); });

async function cleanup() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeEach(async () => {
  if (!available) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where({ user_id: USER_ID, config_key: 'schedule_cache' }).del();
});

function seedTask(overrides) {
  var task = Object.assign({
    id: 'rl-' + Math.random().toString(36).slice(2, 10),
    user_id: USER_ID, task_type: 'task', text: 'Test', dur: 30, pri: 'P3',
    status: '', recurring: 0, created_at: db.fn.now(), updated_at: db.fn.now()
  }, overrides);
  return tasksWrite.insertTask(db, task).then(function() { return task; });
}

// Block the WHOLE morning home block on a given day with a pinned fixed task.
// Uses localToUtc — same function the scheduler uses — to produce the correct
// UTC timestamp. This avoids the dateStrings misparse trap: storing a bare "HH:MM:SS"
// string is parsed as LOCAL time by `new Date()`, so "10:00:00" stays at 10:00 local
// (not 06:00 EDT). localToUtc converts "6:00 AM" in TZ → correct UTC datetime object.
//
// 999.1451: the morning block is NOT the same size on every day of the week —
// DEFAULT_WEEKDAY_BLOCKS' morning is 360-480 (06:00-08:00, 120 min) but
// DEFAULT_WEEKEND_BLOCKS' morning is 420-720 (07:00-12:00, 300 min). A blocker
// hardcoded to "6:00 AM, dur 120" only fully occupies the WEEKDAY window; on a
// weekend anchor day (dayKey(1) lands on Sat/Sun roughly 2/7 of the time — e.g.
// any run where "today" is Friday) it leaves 240 free minutes after 8am, so the
// flexible-TPC instance places later THE SAME DAY instead of roaming to a new
// day — AC1/AC3's `placedDate > anchorKey` then goes red although the persist
// fix (dd27105d, 999.848) is completely intact. Derive the block's actual
// start/duration from DEFAULT_TIME_BLOCKS for that day's day-of-week so the
// blocker always fully occupies the morning window, weekday or weekend.
function blockMorning(dayOffset) {
  var dk = dayKey(dayOffset);
  var dow = DAY_NAMES[new Date(dk + 'T12:00:00Z').getUTCDay()]; // 'Sun'..'Sat'
  var dayBlocks = DEFAULT_TIME_BLOCKS[dow] || DEFAULT_TIME_BLOCKS.Mon;
  var morningBlock = dayBlocks.filter(function(b) { return b.tag === 'morning'; })[0];
  if (!morningBlock) throw new Error('blockMorning: no morning block for ' + dow);
  var blockDur = morningBlock.end - morningBlock.start; // fully occupy, weekday or weekend
  var startTimeStr = formatMinutesToTime(morningBlock.start); // e.g. '6:00 AM' / '7:00 AM'
  var scheduledAtUtc = localToUtc(dk, startTimeStr, TZ);
  if (!scheduledAtUtc) throw new Error('blockMorning: localToUtc returned null for ' + dk);
  // MySQL DATETIME format: "YYYY-MM-DD HH:MM:SS" (UTC stored, UTC interpreted by scheduler)
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  var utcStr = scheduledAtUtc.getUTCFullYear() + '-' +
    pad(scheduledAtUtc.getUTCMonth() + 1) + '-' +
    pad(scheduledAtUtc.getUTCDate()) + ' ' +
    pad(scheduledAtUtc.getUTCHours()) + ':' +
    pad(scheduledAtUtc.getUTCMinutes()) + ':' +
    pad(scheduledAtUtc.getUTCSeconds());
  return seedTask({
    text: 'BLOCK morning ' + dayOffset,
    // placement_mode:'fixed' makes isRigid=true → tryPlaceAtTime → reserveWithTravel → dayOcc occupied.
    // when:'fixed' alone is the OLD convention; the scheduler now reads `placement_mode`, not `when`.
    placement_mode: 'fixed', // date_pinned removed 20260526000000 (999.1440/58d9a12a) — placement_mode is the sole immovability signal
    scheduled_at: utcStr, dur: blockDur // fills exactly that day's morning home block
  });
}

function pendingRecurInstances() {
  // task_instances is the underlying table (carries unplaced_reason); tasks_v omits it.
  return db('task_instances')
    .where('user_id', USER_ID)
    .whereNotIn('status', ['done', 'cancel', 'skip', 'pause', 'missed'])
    .select('id', 'date', 'scheduled_at', 'unscheduled', 'status', 'unplaced_reason');
}

// limbo = pending, non-terminal, scheduled_at NULL, AND not flagged unscheduled
function findLimbo(rows) {
  return rows.filter(function(r) { return r.scheduled_at == null && !r.unscheduled; });
}

/**
 * AC1 TRUE-RED regression test.
 *
 * What makes this test TRUE RED on pre-fix code (unlike the tests above):
 *
 * The roam-with-dateChanged condition requires THREE things simultaneously:
 *   (a) original.recurring = true
 *   (b) dateChanged = true  (placement.dateKey != priorDate)
 *   (c) original._preReconDate == null  (reconcile did NOT do an occurrenceMove)
 *
 * Condition (c) is only satisfied when reconcile matches the instance via the
 * EXACT-DATE path (remaining[i].date === desired.date) — because the nearest-match
 * path writes _preReconDate, and the guard checks `_preReconDate == null` to allow
 * the move for reconcile-initiated date changes.
 *
 * The prior tests seed a fresh master with NO pre-existing instances, so:
 *   - expandRecurring generates a desired occurrence for dayKey(1)
 *   - Phase 1 inserts a fresh row with date=dayKey(1), scheduled_at=NULL
 *   - The fresh row IS in existingGroupsByMaster (status='', task_type='recurring_instance')
 *     but with g.date = dayKey(1) — and desired.date = dayKey(1) too → EXACT-MATCH
 *     → no occurrenceMove → _preReconDate stays null ✓
 *   - BUT the `blockMorning` helper stored scheduled_at as a bare 'YYYY-MM-DD HH:MM:SS'
 *     string (no timezone suffix). Node's `new Date('YYYY-MM-DD HH:MM:SS')` parses this
 *     as LOCAL time, not UTC — so in EDT the blocker lands at 10:00–12:00 local (not
 *     06:00–08:00). Morning (06:00–08:00) stayed clear and the recurring fit there,
 *     so dateChanged was false and the guard never fired → false green.
 *
 * This test fixes the blocker: uses localToUtc (same function the scheduler uses) so
 * the blocker truly occupies 06:00–08:00 local, forcing the scheduler to roam the
 * recurring to the next morning (day+2), producing dateChanged=true + _preReconDate=null.
 *
 * Pre-fix behaviour: persist guard sees recurring+dateChanged+_preReconDate==null and
 * !isFlexibleTpcRecur (function doesn't exist) → `continue` → scheduled_at stays NULL,
 * unscheduled stays NULL → LIMBO. The assertions below FAIL.
 *
 * Post-fix behaviour: isFlexibleTpcRecur(original.recur) returns true → guard allows
 * the date move → scheduled_at written at the roamed slot → assertions PASS.
 */
describe('999.848 AC1 TRUE-RED — roam-with-dateChanged triggers persist-guard bug', () => {
  test('AC1: flexible-TPC roam with morning blocked — instance PLACED on roamed day, not in limbo', async () => {
    if (!available) return;
    // Flexible-TPC weekly (1×/week across all 7 days) — isFlexibleTpc=true.
    // When: morning (06:00–08:00 weekday, 07:00–12:00 weekend), dur=120 fills it exactly.
    // Anchor: tomorrow (day+1). Morning on day+1 is blocked → scheduler roams to day+2.
    var anchorKey = dayKey(1);
    var masterId = 'rl-ac1-true-red';
    await db('task_masters').insert({
      id: masterId, user_id: USER_ID, text: 'AC1 Roamer', dur: 120, status: '', recurring: 1,
      recur: JSON.stringify({ type: 'weekly', days: 'MTWRFSU', timesPerCycle: 1 }),
      recur_start: anchorKey, when: 'morning', placement_mode: 'anytime',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });

    // Block tomorrow's entire morning with a correctly-UTC-stamped fixed task.
    // blockMorning now uses localToUtc so the blocker actually occupies 06:00–08:00
    // local (= 10:00–12:00 UTC in EDT), not 10:00–12:00 local as the prior bare
    // string did. This is the fix that makes the blocker effective.
    await blockMorning(1);

    // Run once — this is where the bug fires on pre-fix code.
    await runScheduleAndPersist(USER_ID);

    // Query recurring instances only (source_id matches the master we created).
    // The blocker (fixed one-off) has scheduled_at set from the INSERT, but is NOT
    // a recurring instance — filtering by source_id isolates the occurrence we care about.
    var allRows = await db('task_instances')
      .where('user_id', USER_ID)
      .whereNotIn('status', ['done', 'cancel', 'skip', 'pause', 'missed'])
      .select('id', 'master_id', 'date', 'scheduled_at', 'unscheduled', 'status', 'unplaced_reason');
    // Filter to only the recurring instance seeded by this test (master_id matches the template).
    // The blocker (fixed one-off) has master_id = its own task id, not the recurring master id.
    var recurRows = allRows.filter(function(r) { return r.master_id === masterId; });

    // AC1 ROOT: the roamed instance must be PLACED (scheduled_at set), not in limbo.
    // Pre-fix: persist guard drops the roamed placement → scheduled_at=NULL, unscheduled=NULL
    //          → limbo → placed.length=0 → this expect FAILS (RED on pre-fix)
    // Post-fix: isFlexibleTpcRecur allows the date move → scheduled_at written → PASS
    var placed = recurRows.filter(function(r) { return r.scheduled_at != null; });
    expect(placed.length).toBeGreaterThanOrEqual(1);

    // AC1 PLACEMENT DAY: the roamed placement must land AFTER the blocked anchor (day+1).
    // This pins the dateChanged condition: the placed day must differ from the nominal anchor.
    // Pre-fix: no row is placed so this block is skipped (irrelevant under FAIL above).
    // Post-fix: placed[0].date is the roamed day (day+2 or later) — must be > anchorKey.
    var placedRow = placed[0];
    var placedDate = placedRow && placedRow.date ? String(placedRow.date).split('T')[0] : null;
    expect(placedDate).not.toBeNull();
    expect(placedDate > anchorKey).toBe(true);

    // AC2 INVARIANT: no recurring instance may remain in limbo after the run.
    var limboRecur = recurRows.filter(function(r) { return r.scheduled_at == null && !r.unscheduled; });
    expect(limboRecur).toEqual([]);
  }, 25000);
});

describe('999.848 recurring LIMBO — flexible-TPC roam persists, never limbo', () => {
  test('a roamed flexible-TPC instance is PLACED (scheduled_at written), never limbo', async () => {
    if (!available) return;
    // Flexible-TPC weekly (tpc 1 < 7 selected days → roams within the cycle), morning home
    // block, dur=120 (fills the morning exactly). Anchored at today+1.
    await db('task_masters').insert({
      id: 'rl-tmpl-roam', user_id: USER_ID, text: 'Roamer', dur: 120, status: '', recurring: 1,
      recur: JSON.stringify({ type: 'weekly', days: 'MTWRFSU', timesPerCycle: 1 }),
      recur_start: dayKey(1), when: 'morning', placement_mode: 'time_window', time_flex: 10080,
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    // Block the anchor day's morning so the only-occurrence MUST roam to a later day this cycle.
    await blockMorning(1);

    await runScheduleAndPersist(USER_ID);

    var rows = await pendingRecurInstances();
    var limbo = findLimbo(rows);
    // INVARIANT: no pending recurring instance may be in limbo.
    expect(limbo).toEqual([]);
    // ROOT FIX: the roamed occurrence is genuinely placeable (later mornings are free),
    // so it must be PLACED (scheduled_at set), not merely flagged unplaced.
    var placed = rows.filter(function(r) { return r.scheduled_at != null; });
    expect(placed.length).toBeGreaterThanOrEqual(1);
  }, 20000);

  test('no drift: a second run leaves the placed instance stable and still not limbo', async () => {
    if (!available) return;
    await db('task_masters').insert({
      id: 'rl-tmpl-stable', user_id: USER_ID, text: 'Stable roamer', dur: 120, status: '', recurring: 1,
      recur: JSON.stringify({ type: 'weekly', days: 'MTWRFSU', timesPerCycle: 1 }),
      recur_start: dayKey(1), when: 'morning', placement_mode: 'time_window', time_flex: 10080,
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await blockMorning(1);

    await runScheduleAndPersist(USER_ID);
    var after1 = await pendingRecurInstances();
    expect(findLimbo(after1)).toEqual([]);
    var placed1 = after1.filter(function(r) { return r.scheduled_at != null; }).map(function(r) { return r.scheduled_at; }).sort();

    await runScheduleAndPersist(USER_ID);
    var after2 = await pendingRecurInstances();
    expect(findLimbo(after2)).toEqual([]);
    var placed2 = after2.filter(function(r) { return r.scheduled_at != null; }).map(function(r) { return r.scheduled_at; }).sort();

    // Guard against vacuous equality: both arrays must be non-empty (mirrors AC3 hard-case guard).
    // If both runs place zero instances, the equality below is trivially true and tests nothing.
    expect(placed1.length).toBeGreaterThanOrEqual(1);
    // Placements stable across runs — the roamed scheduled_at does not creep forward each run.
    expect(placed2).toEqual(placed1);
  }, 25000);

  test('safety net: a genuinely unplaceable in-window recurring instance lands in Unplaced (unscheduled=1), not limbo', async () => {
    if (!available) return;
    // Flexible-TPC recurring whose `when` matches NO time block — it can never be placed
    // on any day (tz-independent, unlike capacity blocking). It must surface in the
    // Unplaced list (unscheduled=1), never vanish into limbo. (Strategy A, mirrors the
    // BUG-142 AC2 unplaceable-recurring seed.)
    await db('task_masters').insert({
      id: 'rl-tmpl-noslot', user_id: USER_ID, text: 'No slot roamer', dur: 120, status: '', recurring: 1,
      recur: JSON.stringify({ type: 'weekly', days: 'MTWRFSU', timesPerCycle: 1 }),
      recur_start: dayKey(1), when: '_invalid_window_', placement_mode: 'time_window', time_flex: 10080,
      created_at: db.fn.now(), updated_at: db.fn.now()
    });

    await runScheduleAndPersist(USER_ID);

    var rows = await pendingRecurInstances();
    expect(findLimbo(rows)).toEqual([]);            // INVARIANT: never limbo
    // At least one instance exists and is flagged unplaced with a reason.
    var flagged = rows.filter(function(r) { return r.scheduled_at == null && r.unscheduled; });
    expect(flagged.length).toBeGreaterThanOrEqual(1);
    expect(flagged[0].unplaced_reason).toBeTruthy();
  }, 25000);
});

/**
 * AC3 HARD CASE — convergence under a CHANGING blocker.
 *
 * The existing "no drift" test above only exercises the STEADY-STATE fixed point: identical
 * calendar conditions across both runs. It does NOT prove that the placement stabilises after
 * a ONE-TIME corrective hop when the roamed slot itself later becomes blocked (cookie WARN-1).
 *
 * This test exercises the harder AC3 shape — the actual 6/24→7/2 drift that was observed in
 * production before the fix:
 *
 *   Run 1 — anchor (day+1) morning blocked → roams to roamed_day (e.g. day+2).
 *   Run 2 — roamed_day morning now ALSO blocked → forced to hop again to placed2_day.
 *   Run 3 — no new blocker added → scheduler re-runs with the same calendar.
 *
 * KEY PROPERTY: placed3 === placed2  (no further creep on run 3)
 *   AND at no run is the recurring instance in limbo (scheduled_at NULL + unscheduled NULL).
 *
 * If the fix is correct, the instance makes AT MOST ONE corrective hop per changed blocker,
 * then stabilises. If the old drift bug were re-introduced, run 3 would move forward again
 * (placed3 > placed2), or the instance would land in limbo on run 2 when its roamed slot is
 * also blocked.
 *
 * Implementation note on blockMorningByDateKey: blockMorning(offset) derives its dateKey from
 * dayKey(offset), which is UTC-based. To block a day we read back from the DB (dateStrings:true
 * returns 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM:SS.000Z' depending on column type), we strip the
 * T-suffix with split('T')[0] and pass the result directly to localToUtc — the same conversion
 * blockMorning uses — so the blocker occupies exactly 06:00–08:00 local on that calendar day.
 */
describe('999.848 AC3 HARD CASE — convergence under a changing blocker (no cumulative creep)', () => {
  // Helper: block the morning of a specific date string (e.g. '2026-06-27') obtained from a
  // DB query, using the same localToUtc + UTC-string approach as blockMorning(dayOffset).
  // This is needed when we must block the specific day the scheduler roamed to — we learn
  // that day from a DB query and cannot express it as a day-offset at authoring time.
  // 999.1451: same weekday/weekend window-size issue as blockMorning — derive
  // start/duration from DEFAULT_TIME_BLOCKS for dateStr's day-of-week instead
  // of hardcoding the weekday-sized (120 min) block.
  function blockMorningByDateKey(dateStr) {
    var dow = DAY_NAMES[new Date(dateStr + 'T12:00:00Z').getUTCDay()];
    var dayBlocks = DEFAULT_TIME_BLOCKS[dow] || DEFAULT_TIME_BLOCKS.Mon;
    var morningBlock = dayBlocks.filter(function(b) { return b.tag === 'morning'; })[0];
    if (!morningBlock) throw new Error('blockMorningByDateKey: no morning block for ' + dow);
    var blockDur = morningBlock.end - morningBlock.start;
    var startTimeStr = formatMinutesToTime(morningBlock.start);
    var scheduledAtUtc = localToUtc(dateStr, startTimeStr, TZ);
    if (!scheduledAtUtc) throw new Error('blockMorningByDateKey: localToUtc returned null for ' + dateStr);
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    var utcStr = scheduledAtUtc.getUTCFullYear() + '-' +
      pad(scheduledAtUtc.getUTCMonth() + 1) + '-' +
      pad(scheduledAtUtc.getUTCDate()) + ' ' +
      pad(scheduledAtUtc.getUTCHours()) + ':' +
      pad(scheduledAtUtc.getUTCMinutes()) + ':' +
      pad(scheduledAtUtc.getUTCSeconds());
    return seedTask({
      text: 'BLOCK morning ' + dateStr,
      placement_mode: 'fixed', // date_pinned removed 20260526000000 (999.1440/58d9a12a) — placement_mode is the sole immovability signal
      scheduled_at: utcStr, dur: blockDur
    });
  }

  test('AC3 hard case: re-stabilises in one hop when roamed slot is later blocked (no cumulative creep)', async () => {
    if (!available) return;

    var masterId = 'rl-ac3-hard';

    // Seed a flexible-TPC weekly recurring — same shape as the existing tests.
    // days: all 7, timesPerCycle: 1, when: morning, dur: 120, placement_mode: anytime.
    // Anchor: day+1.
    await db('task_masters').insert({
      id: masterId, user_id: USER_ID, text: 'AC3 Hard Roamer', dur: 120, status: '', recurring: 1,
      recur: JSON.stringify({ type: 'weekly', days: 'MTWRFSU', timesPerCycle: 1 }),
      recur_start: dayKey(1), when: 'morning', placement_mode: 'anytime',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });

    // ── RUN 1: anchor morning blocked → instance roams to a later morning ──────────────────
    await blockMorning(1); // block day+1 morning
    await runScheduleAndPersist(USER_ID);

    var rows1 = await db('task_instances')
      .where('user_id', USER_ID)
      .where('master_id', masterId)
      .whereNotIn('status', ['done', 'cancel', 'skip', 'pause', 'missed'])
      .select('id', 'date', 'scheduled_at', 'unscheduled');

    // INVARIANT after run 1: no limbo.
    var limbo1 = rows1.filter(function(r) { return r.scheduled_at == null && !r.unscheduled; });
    expect(limbo1).toEqual([]);

    // The instance must be PLACED (roamed to a later morning).
    var placed1Rows = rows1.filter(function(r) { return r.scheduled_at != null; });
    expect(placed1Rows.length).toBeGreaterThanOrEqual(1);

    // Extract the date the scheduler roamed to (strip ISO T-suffix if present).
    var roamedDate = String(placed1Rows[0].date).split('T')[0];
    // It must be after the anchor (day+1) — confirms the roam fired.
    expect(roamedDate > dayKey(1)).toBe(true);

    // ── RUN 2: block the ROAMED slot too → instance must hop again (or stay, no limbo) ────
    await blockMorningByDateKey(roamedDate); // block the day it landed on
    await runScheduleAndPersist(USER_ID);

    var rows2 = await db('task_instances')
      .where('user_id', USER_ID)
      .where('master_id', masterId)
      .whereNotIn('status', ['done', 'cancel', 'skip', 'pause', 'missed'])
      .select('id', 'date', 'scheduled_at', 'unscheduled');

    // INVARIANT after run 2: no limbo — even though the prior roamed slot is now blocked.
    var limbo2 = rows2.filter(function(r) { return r.scheduled_at == null && !r.unscheduled; });
    expect(limbo2).toEqual([]);

    // The instance must still be placed after run 2 (either re-roamed or held via an
    // alternate morning on roamedDate — but roamedDate morning is now blocked so it hops).
    var placed2Rows = rows2.filter(function(r) { return r.scheduled_at != null; });
    expect(placed2Rows.length).toBeGreaterThanOrEqual(1);

    // Capture the run-2 scheduled_at values (normalised to string for comparison).
    var placed2 = placed2Rows.map(function(r) { return String(r.scheduled_at); }).sort();

    // ── RUN 3: no new blocker — calendar unchanged from run 2 → placement must HOLD ───────
    await runScheduleAndPersist(USER_ID);

    var rows3 = await db('task_instances')
      .where('user_id', USER_ID)
      .where('master_id', masterId)
      .whereNotIn('status', ['done', 'cancel', 'skip', 'pause', 'missed'])
      .select('id', 'date', 'scheduled_at', 'unscheduled');

    // INVARIANT after run 3: no limbo.
    var limbo3 = rows3.filter(function(r) { return r.scheduled_at == null && !r.unscheduled; });
    expect(limbo3).toEqual([]);

    var placed3Rows = rows3.filter(function(r) { return r.scheduled_at != null; });
    expect(placed3Rows.length).toBeGreaterThanOrEqual(1);

    var placed3 = placed3Rows.map(function(r) { return String(r.scheduled_at); }).sort();

    // KEY PROPERTY: no further creep between run 2 and run 3.
    // The date does NOT advance again; the corrective hop (run 1 → 2) was the last move.
    // Pre-fix (old drift bug): each run would push the instance forward → placed3 !== placed2.
    // Post-fix: the placement is idempotent once the calendar is stable → placed3 === placed2.
    expect(placed3).toEqual(placed2);
  }, 40000);
});

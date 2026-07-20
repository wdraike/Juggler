// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../src/lib/audit-context').stampInsert(rows);
/**
 * 999.834 recurring lifecycle bugfix — pre-fix RED repro tests
 *
 * Three behaviors authored as step-0 of the bugfix pipeline:
 *
 *   A — 999.834: TPC over-materialization cap (unit, EXPECT GREEN — already enforced by 999.013)
 *   B — 999.835: Cancelled recurring_template must NOT fabricate instances (DB, EXPECT RED)
 *   C — 999.843: Null-date orphan ghost must surface as unscheduled (DB, EXPECT RED)
 *
 * GOVERNING INVARIANT — NEVER-MISSING:
 *   A task row is NEVER deleted to fix a bug. Past-incomplete recurring instances
 *   are never auto-missed; they stay live visible commitments.
 *
 * DB tests target juggler_834_test on test-bed MySQL 3407.
 *
 * Run:
 *   cd juggler/juggler-backend && \
 *   NODE_ENV=test DB_PORT=3407 DB_NAME=juggler_834_test \
 *   DB_USER=root DB_PASSWORD=rootpass \
 *   npx jest tests/scheduler/recurring-lifecycle-999834.test.js --forceExit --runInBand
 *
 * Model: bug814-runschedule-slowpath-cancelled.test.js, noAutoMiss.test.js
 * Traceability: .planning/kermit/999.834/TRACEABILITY.md
 */

'use strict';

process.env.NODE_ENV = 'test';

var { expandRecurring }  = require('../../../shared/scheduler/expandRecurring');
var db                   = require('../../src/db');
var { runScheduleAndPersist } = require('../../src/scheduler/runSchedule');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
var { REASON_CODES }     = require('../../../shared/scheduler/reasonCodes');
var { localToUtc }       = require('../../src/scheduler/dateHelpers');
var { assertDbAvailable } = require('../helpers/requireDB');

// ── helpers ───────────────────────────────────────────────────────────────────

/** UTC date key with day offset (mirrors noAutoMiss.test.js). */
function dayKey(off) {
  var d = new Date();
  d.setUTCDate(d.getUTCDate() + off);
  var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, a = d.getUTCDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (a < 10 ? '0' : '') + a;
}

// ── File-level teardown — destroy DB connection ONCE after all describes ──────
// Must not be inside any describe; per-describe afterAlls only clean data.
afterAll(async function() {
  try { await db.destroy(); } catch (_) {}
}, 10000);

// =============================================================================
// A — TPC over-materialization cap
// Unit test (no DB). EXPECT GREEN: 999.013 budget-aware TPC already enforces the cap.
// If this goes RED, a TPC regression exists — flag loudly.
// =============================================================================

describe('999.834-A — TPC cap: flexible-TPC weekly emits <=timesPerCycle per ISO week [unit, EXPECT GREEN]', function() {
  test('MTWRF weekly with timesPerCycle=2 emits at most 2 instances per 7-day cycle over 2 weeks', function() {
    // Fixed far-future 2-week window: Mon 2030-01-07 through Sun 2030-01-20.
    // Far-future avoids any "today" boundary edge cases in expandRecurring.
    // Jan 7, 2030 is a Monday (confirmed: Jan 1 2030 = Tue → Jan 7 = Mon).
    var start = new Date(2030, 0, 7);   // 2030-01-07 Mon (local midnight)
    var end   = new Date(2030, 0, 20);  // 2030-01-20 Sun (local midnight)

    var src = {
      id: 'tpc-834-src',
      text: 'TPC-capped task',
      dur: 60,
      pri: 'P2',
      recurring: true,
      taskType: 'recurring_template',
      // 5 selected days (MTWRF), timesPerCycle=2 → TPC filter must cap to 2/week.
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 2 },
      recurStart: '2030-01-07',
      date: '2030-01-07'
    };

    // Model call from runSchedule.js:762 (statuses + maxOrdBySource + pendingBookedByDate).
    var result = expandRecurring([src], start, end, {
      statuses: {},
      maxOrdBySource: {},
      pendingBookedByDate: {}
    });

    // Must produce some instances (the cap reduces but doesn't zero-out over 2 weeks).
    expect(result.length).toBeGreaterThan(0);

    // Group by ISO week start (Monday). Assert <=timesPerCycle per week.
    var byWeek = {};
    result.forEach(function(t) {
      if (!t.date) return;
      // Parse YYYY-MM-DD → local Date for day-of-week computation.
      var parts = t.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!parts) return;
      var d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
      var dow = d.getDay();             // 0=Sun, 1=Mon, ..., 6=Sat
      var daysBack = (dow === 0) ? 6 : (dow - 1); // steps back to Monday
      var mon = new Date(d);
      mon.setDate(mon.getDate() - daysBack);
      var wk = mon.getFullYear() + '-' +
               ('0' + (mon.getMonth() + 1)).slice(-2) + '-' +
               ('0' + mon.getDate()).slice(-2);
      byWeek[wk] = (byWeek[wk] || 0) + 1;
    });

    var weeks = Object.keys(byWeek);
    expect(weeks.length).toBeGreaterThan(0);

    weeks.forEach(function(wk) {
      // BLOCK if RED: 999.013 TPC regression — over-materialization cap broken.
      expect(byWeek[wk]).toBeLessThanOrEqual(2);
    });
  });

  test('sanity (no TPC): MTWRF weekly without timesPerCycle emits > 2 per week — proves TPC is the constraint', function() {
    // Without timesPerCycle, a 5-day MTWRF template over 1 week (Mon-Sun) generates
    // 5 instances. If this is <=2, expandRecurring itself is broken (not TPC).
    var start = new Date(2030, 0, 7);   // 2030-01-07 Mon
    var end   = new Date(2030, 0, 13);  // 2030-01-13 Sun (one full week)

    var src = {
      id: 'no-tpc-834-src',
      text: 'No-TPC task',
      dur: 60,
      pri: 'P2',
      recurring: true,
      taskType: 'recurring_template',
      recur: { type: 'weekly', days: 'MTWRF' }, // no timesPerCycle → no cap
      recurStart: '2030-01-07',
      date: '2030-01-07'
    };

    var result = expandRecurring([src], start, end, { statuses: {} });

    // MTWRF over 1 week = up to 5 weekday instances. Without TPC, must be > 2.
    expect(result.length).toBeGreaterThan(2);
  });
});

// =============================================================================
// B — 999.835: Cancelled recurring_template must NOT fabricate instances
// DB test on juggler_834_test @ 3407.
// EXPECT RED: tasks_v hardcodes status=NULL for all recurring_template header rows
// (confirmed in src/db/views/canonical-views.sql: `(convert(NULL using utf8mb4) ... ) AS status`).
// Even when task_masters.status='cancelled', the orWhereNull branch at runSchedule.js:526
// loads the template, and expandRecurring's cancelled-filter never fires (st = '' not 'cancelled').
// =============================================================================

var USER_B           = '834-b-user';
var CANCELLED_MASTER = '834-b-cancelled';
var CONTROL_MASTER   = '834-b-control';
var TZ               = 'America/New_York';

async function cleanupB() {
  await db('cal_sync_ledger').where('user_id', USER_B).del().catch(function() {});
  await db('schedule_queue').where('user_id', USER_B).del().catch(function() {});
  await db('task_instances').where('user_id', USER_B).del().catch(function() {});
  await db('task_masters').where('user_id', USER_B).del().catch(function() {});
  await db('user_config').where('user_id', USER_B).del().catch(function() {});
  await db('users').where('id', USER_B).del().catch(function() {});
}

describe('999.835-B — Cancelled template no-fabricate [DB @ 3407, EXPECT RED pre-fix]', function() {
  beforeAll(async function() {
    await assertDbAvailable();
    await cleanupB();
    await db('users').insert(__stampFixture({
      id: USER_B, email: '834b@test.invalid', timezone: TZ,
      created_at: db.fn.now(), updated_at: db.fn.now()
    }));
    await db('user_config').insert(__stampFixture({
      user_id: USER_B, config_key: 'time_blocks',
      config_value: JSON.stringify(DEFAULT_TIME_BLOCKS)
    }));
    await db('user_config').insert(__stampFixture({
      user_id: USER_B, config_key: 'tool_matrix',
      config_value: JSON.stringify(DEFAULT_TOOL_MATRIX)
    }));
  }, 15000);

  afterAll(cleanupB, 10000);

  beforeEach(async function() {
    // Clear task data between tests; preserve user + static config.
    await db('task_instances').where('user_id', USER_B).del().catch(function() {});
    await db('task_masters').where('user_id', USER_B).del().catch(function() {});
    await db('user_config').where({ user_id: USER_B, config_key: 'schedule_cache' }).del().catch(function() {});
  });

  test('cancelled template generates ZERO new instances; active control template generates instances', async function() {
    // ── Seed: cancelled recurring template ────────────────────────────────────
    // task_masters.status='cancelled' — should stop fabrication.
    // BUG: tasks_v returns status=NULL for this template header row (view hardcodes NULL).
    // The orWhereNull at runSchedule.js:526 loads it → expandRecurring can't see 'cancelled'.
    await db('task_masters').insert(__stampFixture({
      id:          CANCELLED_MASTER,
      user_id:     USER_B,
      text:        'Cancelled recurring task 999.835',
      dur:         30,
      pri:         'P3',
      recurring:   1,
      status:      'cancelled', // ← task_masters.status='cancelled' (invisible through tasks_v)
      recur:       JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      recur_start: dayKey(0),
      created_at:  db.fn.now(),
      updated_at:  db.fn.now()
    }));

    // ── Seed: active control template ─────────────────────────────────────────
    // status='' (active) — must still fabricate. No-regression guard.
    await db('task_masters').insert(__stampFixture({
      id:          CONTROL_MASTER,
      user_id:     USER_B,
      text:        'Active recurring task control 999.835',
      dur:         30,
      pri:         'P3',
      recurring:   1,
      status:      '',   // active
      recur:       JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      recur_start: dayKey(0),
      created_at:  db.fn.now(),
      updated_at:  db.fn.now()
    }));

    await runScheduleAndPersist(USER_B);

    // REGRESSION GUARD: active template MUST generate instances (no over-exclusion).
    var activeInsts = await db('task_instances').where({ master_id: CONTROL_MASTER });
    expect(activeInsts.length).toBeGreaterThan(0);

    // PRIMARY ASSERTION — EXPECT RED on pre-fix code:
    // Cancelled template must produce ZERO task_instances rows.
    // Pre-fix: tasks_v status=NULL → orWhereNull loads it → expandRecurring st='' →
    //   filter(st==='cancelled') never fires → instances fabricated → count > 0 → RED.
    // Post-fix: template excluded before expansion → count = 0 → GREEN.
    var cancelledInsts = await db('task_instances').where({ master_id: CANCELLED_MASTER });
    expect(cancelledInsts.length).toBe(0); // ← RED on pre-fix code
  }, 30000);
});

// =============================================================================
// C — 999.843: Null-date orphan ghost must surface as unscheduled, not linger
// DB test on juggler_834_test @ 3407.
// EXPECT RED: computeNoLimboUpdates early-returns when raw.date is NULL
// (runSchedule.js:2211-2212: `var nominalDate = raw.date ? parseDate(raw.date) : null;
//   if (!nominalDate || ...) return;`). The ghost's date=NULL → nominalDate=null → return.
// Ghost lingers: unscheduled stays NULL, unplaced_reason stays NULL → invisible limbo.
// Post-fix: the null-date path must surface the ghost as unscheduled=1 with a reason code.
// NEVER-MISSING invariant: the row must NOT be deleted regardless.
// =============================================================================

var USER_C       = '834-c-user';
var GHOST_MASTER = '834-c-master';
var GHOST_INST   = '834-c-ghost';

async function cleanupC() {
  await db('cal_sync_ledger').where('user_id', USER_C).del().catch(function() {});
  await db('schedule_queue').where('user_id', USER_C).del().catch(function() {});
  await db('task_instances').where('user_id', USER_C).del().catch(function() {});
  await db('task_masters').where('user_id', USER_C).del().catch(function() {});
  await db('user_config').where('user_id', USER_C).del().catch(function() {});
  await db('users').where('id', USER_C).del().catch(function() {});
}

describe('999.843-C — Null-date ghost surfaces as unscheduled [DB @ 3407, EXPECT RED pre-fix]', function() {
  beforeAll(async function() {
    await assertDbAvailable();
    await cleanupC();
    await db('users').insert(__stampFixture({
      id: USER_C, email: '834c@test.invalid', timezone: TZ,
      created_at: db.fn.now(), updated_at: db.fn.now()
    }));
    await db('user_config').insert(__stampFixture({
      user_id: USER_C, config_key: 'time_blocks',
      config_value: JSON.stringify(DEFAULT_TIME_BLOCKS)
    }));
    await db('user_config').insert(__stampFixture({
      user_id: USER_C, config_key: 'tool_matrix',
      config_value: JSON.stringify(DEFAULT_TOOL_MATRIX)
    }));
  }, 15000);

  afterAll(cleanupC, 10000);

  beforeEach(async function() {
    await db('task_instances').where('user_id', USER_C).del().catch(function() {});
    await db('task_masters').where('user_id', USER_C).del().catch(function() {});
    await db('user_config').where({ user_id: USER_C, config_key: 'schedule_cache' }).del().catch(function() {});
  });

  test('orphan ghost (date=NULL, scheduled_at=NULL, status=\'\') is not deleted and is surfaced as unscheduled', async function() {
    // ── Seed: the recurring master ────────────────────────────────────────────
    await db('task_masters').insert(__stampFixture({
      id:          GHOST_MASTER,
      user_id:     USER_C,
      text:        'Ghost master 999.843',
      dur:         30,
      pri:         'P3',
      recurring:   1,
      status:      '',
      recur:       JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      recur_start: dayKey(0),
      created_at:  db.fn.now(),
      updated_at:  db.fn.now()
    }));

    // ── Seed: the orphan ghost instance ──────────────────────────────────────
    // date=NULL, scheduled_at=NULL, status='' (non-terminal) — the grandfather-spared ghost.
    // occurrence_ordinal=999: far outside the normal expansion window (1..~90 daily instances),
    // so reconcile won't pair this with any desired occurrence and won't overwrite it.
    // This instance is in visible limbo: not placed, not unscheduled, not terminal → invisible.
    await db('task_instances').insert(__stampFixture({
      id:                 GHOST_INST,
      master_id:          GHOST_MASTER,
      user_id:            USER_C,
      occurrence_ordinal: 999,
      split_ordinal:      1,
      split_total:        1,
      dur:                30,
      date:               null,           // ← ghost: no date
      scheduled_at:       null,           // ← no placement
      status:             '',             // ← non-terminal (must remain live)
      created_at:         db.fn.now(),
      updated_at:         db.fn.now()
    }));

    await runScheduleAndPersist(USER_C);

    // Verify against task_instances table directly (not tasks_v) — this is where
    // computeNoLimboUpdates writes the unscheduled=1 flag.
    var ghost = await db('task_instances').where({ id: GHOST_INST }).first();

    // NEVER-MISSING invariant: the row must still exist — never deleted to fix a bug.
    expect(ghost).toBeTruthy();

    // Must not be terminal (scheduler must not have silently closed it).
    var TERMINAL = ['done', 'skip', 'cancel', 'cancelled', 'missed', 'disabled'];
    expect(TERMINAL).not.toContain(ghost.status || '');

    // PRIMARY ASSERTION 1 — EXPECT RED on pre-fix code:
    // Ghost must be surfaced as unscheduled=1 (visible in the Unplaced panel).
    // Pre-fix: computeNoLimboUpdates early-returns on null date (line 2211-2212).
    //   ghost.unscheduled stays NULL → visible nowhere → invisible limbo → RED.
    // Post-fix: null-date branch flags unscheduled=1 → GREEN.
    expect(Number(ghost.unscheduled)).toBe(1); // ← RED on pre-fix code

    // PRIMARY ASSERTION 2 — EXPECT RED on pre-fix code:
    // unplaced_reason must be REASON_CODES.NO_SLOT ('no_slot').
    // computeNoLimboUpdates line 2240: `t._unplacedReason || REASON_CODES.NO_SLOT`.
    // The ghost (ordinal=999) is never processed by the scheduler placement phases,
    // so t._unplacedReason is undefined → fallback fires → REASON_CODES.NO_SLOT.
    // Pre-fix: stays NULL (no update written) → RED.
    // Post-fix: 'no_slot' → GREEN.
    expect(ghost.unplaced_reason).toBe(REASON_CODES.NO_SLOT); // ← RED on pre-fix code
  }, 30000);

  // ── WARN-1 no-regression control ─────────────────────────────────────────
  // Fix 2 widened computeNoLimboUpdates so null-date rows fall through the window
  // check. This test proves the widened guard does NOT spuriously flag a validly
  // PLACED instance as unscheduled=1.
  //
  // Control design:
  //   - occurrence_ordinal=997: far outside the ~14-day daily reconcile range, so
  //     the reconciler won't overwrite it; the scheduler leaves it alone.
  //   - date=dayKey(1) (tomorrow): in-window, non-null — NOT the null-date path.
  //   - scheduled_at=localToUtc(...): PLACED (non-null). computeNoLimboUpdates
  //     line 2234: `if (finalSched != null) return;` → returns immediately, so
  //     the placed row is never touched by the no-limbo backstop.
  //
  // This guards against the widened guard accidentally over-flagging placed rows.
  test('no-regression control: placed instance (scheduled_at set, date in-window) is NOT spuriously flagged unscheduled by widened no-limbo guard', async function() {
    var CTRL_MASTER_ID = '834-c-ctrl-master';
    var CTRL_INST_ID   = '834-c-ctrl-inst';
    var placedAt       = localToUtc(dayKey(1), '9:00 AM', TZ);

    await db('task_masters').insert(__stampFixture({
      id:          CTRL_MASTER_ID,
      user_id:     USER_C,
      text:        'No-over-flagging control master 999.843',
      dur:         30,
      pri:         'P3',
      recurring:   1,
      status:      '',
      recur:       JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      recur_start: dayKey(0),
      created_at:  db.fn.now(),
      updated_at:  db.fn.now()
    }));

    await db('task_instances').insert(__stampFixture({
      id:                 CTRL_INST_ID,
      master_id:          CTRL_MASTER_ID,
      user_id:            USER_C,
      occurrence_ordinal: 997,       // outside reconcile range → not overwritten
      split_ordinal:      1,
      split_total:        1,
      dur:                30,
      date:               dayKey(1), // tomorrow — in-window, non-null
      scheduled_at:       placedAt,  // PLACED — non-null
      status:             '',        // non-terminal
      created_at:         db.fn.now(),
      updated_at:         db.fn.now()
    }));

    await runScheduleAndPersist(USER_C);

    var ctrl = await db('task_instances').where({ id: CTRL_INST_ID }).first();
    expect(ctrl).toBeTruthy();  // still exists
    // A placed instance must NOT be flagged unscheduled by the no-limbo backstop.
    // computeNoLimboUpdates exits at line 2234 (finalSched != null) before writing.
    expect(Number(ctrl.unscheduled) || 0).toBe(0);
  }, 30000);
});

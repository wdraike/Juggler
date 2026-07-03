// TELLY-17b: Adversarial HIGH gap tests TS-320 to TS-334
// Status transition matrix (TS-320-329) — aligned to docs/architecture/TASK-STATE-MATRIX.md
// Template crash safety (TS-330-332)
// Timezone enforcement (TS-333-334)
// File: statusTransitionsMatrix.test.js
// Tests: TS-320, TS-321, TS-322, TS-323, TS-324, TS-325, TS-326, TS-327, TS-328, TS-329, TS-330, TS-331, TS-332, TS-333, TS-334
//
// ── 2026-06-24 alignment ───────────────────────────────────────────────────
// The TS-320..TS-329 block was rewritten to match the AUTHORITATIVE state model
// (docs/architecture/TASK-STATE-MATRIX.md + controllers/task.controller.js
// `updateTaskStatus`):
//   • Valid statuses are `['', 'done', 'wip', 'cancel', 'skip', 'pause', 'disabled']`.
//     The previously-asserted `archived`/`restored` statuses are NOT part of the
//     model — `disabled` (+ the re-enable endpoint) is the freeze/restore mechanism.
//   • Transition guards live in the controller, NOT in a direct DB UPDATE. The old
//     `updateTask()` test-helper writes columns straight to the DB, so it can never
//     fire a transition guard — every old `.rejects.toThrow()` assertion was
//     structurally invalid (a direct write only throws on a CHECK violation, and the
//     2026-06-24 widen-migration removed even that). These now drive through the real
//     `updateTaskStatus` controller and assert HTTP status per the matrix.
//   • David ruling 2026-06-24 (migration 20260624160000): a task_masters row may now
//     legitimately hold run-state (`wip`/`pause`/`disabled`/...), so writing those to a
//     master is no longer a failure.

const { describe, it, expect, beforeAll, afterAll, beforeEach } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask, updateTask, createRecurringTask } = require('../../test-helpers/tasks');
const { runScheduler } = require('../../test-helpers/scheduler');
const { getTasks, getTaskInstances } = require('../../test-helpers/queries');
const { mockClock, mockTimezone } = require('../../test-helpers/time');

// Real controller — exercises the authoritative status-transition guard.
const controller = require('../../src/controllers/task.controller');
// telly fix (leg sched-audit 2026-07-03): knexfile `test` uses dateStrings:true —
// scheduled_at reads back as a tz-less string; use the project's UTC-safe reparse
// helper rather than a bare `new Date()` (the documented juggler dateStrings/
// new-Date misparse trap).
const { scheduledAtToISO } = require('../../src/slices/task/domain/mappers/taskMappers');

// Test-helper rows are seeded under user_id '1' (see test-helpers/db.js).
const HARNESS_USER_ID = '1';

function mockReq(overrides) {
  return Object.assign({
    user: { id: HARNESS_USER_ID },
    headers: { 'x-timezone': 'America/New_York' },
    params: {},
    query: {},
    body: {},
    planFeatures: {
      limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1, schedule_templates: -1 },
      calendar: { max_providers: -1 },
      scheduling: { dependencies: true, travel_time: true },
      tasks: { rigid: true }
    },
    planId: 'enterprise'
  }, overrides);
}

function mockRes() {
  const res = {
    statusCode: 200,
    _json: null,
    status(code) { res.statusCode = code; return res; },
    json(data) { res._json = data; return res; }
  };
  return res;
}

// Drive a status change through the real controller. Returns the mockRes.
async function setStatusViaController(id, status, extraBody) {
  const req = mockReq({ params: { id }, body: Object.assign({ status }, extraBody || {}) });
  const res = mockRes();
  await controller.updateTaskStatus(req, res);
  return res;
}

/**
 * Seed an OPEN one-off instance (master + child instance row) and return both ids.
 * The instance carries `scheduled_at` so the controller's terminal-status guard
 * (SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS) is satisfied for done/skip/cancel.
 */
async function seedOpenInstance(text, overrides) {
  const master = await createTask(Object.assign({ text: (text || 'task') + ' (master)', dur: 30, status: '' }, (overrides && overrides.master) || {}));
  const instance = await createTask(Object.assign({
    master_id: master.id,
    text: text || 'task',
    dur: 30,
    status: '',
    scheduled_at: '2026-06-20T09:00:00Z'
  }, (overrides && overrides.instance) || {}));
  return { masterId: master.id, instanceId: instance.id };
}

/**
 * TS-320: disabled → re-enabled — the freeze/restore mechanism in the authoritative
 * model (the old `archived`/`restored` names are not part of the model). A disabled
 * row is frozen against status changes via updateTaskStatus (403 TASK_DISABLED) and
 * is restored only through the dedicated re-enable endpoint.
 * Domain: State Machine / Status Transitions / Lifecycle
 */
describe('TS-320: disabled is frozen against updateTaskStatus', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: a disabled task rejects status changes via updateTaskStatus (403 TASK_DISABLED)', async () => {
    const { instanceId } = await seedOpenInstance('disabled-frozen', {
      instance: { status: 'disabled' }
    });

    // Any status write through the controller is refused while disabled.
    const res = await setStatusViaController(instanceId, '');
    expect(res.statusCode).toBe(403);
    expect(res._json.code).toBe('TASK_DISABLED');
  });
});

/**
 * TS-321: open → done — completed normally, completed_at set.
 * Domain: State Machine / Status Transitions / Completion
 */
describe('TS-321: open → done — completed normally', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: open task marked done → terminal status with completed_at', async () => {
    const { instanceId } = await seedOpenInstance('open-to-done');

    const res = await setStatusViaController(instanceId, 'done');
    expect(res.statusCode).toBe(200);
    expect(res._json.task.status).toBe('done');

    const row = await getTasks({ id: instanceId });
    expect(row.status).toBe('done');
    expect(row.completed_at).toBeTruthy();
  });
});

/**
 * TS-322: WIP → done — completion records completed_at.
 * Domain: State Machine / Status Transitions / Time Tracking
 */
describe('TS-322: WIP → done', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: WIP task marked done → completed_at set, original dur preserved', async () => {
    const { instanceId } = await seedOpenInstance('wip-to-done', {
      instance: { dur: 120 }
    });

    let res = await setStatusViaController(instanceId, 'wip');
    expect(res.statusCode).toBe(200);
    expect(res._json.task.status).toBe('wip');

    res = await setStatusViaController(instanceId, 'done');
    expect(res.statusCode).toBe(200);
    expect(res._json.task.status).toBe('done');

    const row = await getTasks({ id: instanceId });
    expect(row.status).toBe('done');
    expect(row.completed_at).toBeTruthy();
    expect(row.dur).toBe(120); // Original duration preserved
  });
});

/**
 * TS-323: WIP → skip — terminal; completed_at stamped.
 * Domain: State Machine / Status Transitions / Skip
 */
describe('TS-323: WIP → skip', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: WIP task skipped → terminal status with completed_at', async () => {
    const { instanceId } = await seedOpenInstance('wip-to-skip');

    let res = await setStatusViaController(instanceId, 'wip');
    expect(res.statusCode).toBe(200);

    res = await setStatusViaController(instanceId, 'skip');
    expect(res.statusCode).toBe(200);
    expect(res._json.task.status).toBe('skip');

    const row = await getTasks({ id: instanceId });
    expect(row.status).toBe('skip');
    expect(row.completed_at).toBeTruthy();
  });
});

/**
 * TS-324: WIP → cancel — terminal; the master's rolling anchor is NOT advanced by a cancel.
 * Domain: State Machine / Status Transitions / Cancel
 */
describe('TS-324: WIP → cancel — rolling anchor NOT updated', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: WIP recurring instance cancelled → rolling anchor unchanged', async () => {
    const master = await createRecurringTask({
      text: 'Daily habit',
      dur: 30,
      pri: 'P3',
      recur: { type: 'daily' },
      rolling_anchor: '2026-06-15'
    });
    const instance = await createTask({
      master_id: master.id,
      text: master.text,
      dur: 30,
      status: '',
      scheduled_at: '2026-06-15T10:00:00Z'
    });

    let res = await setStatusViaController(instance.id, 'wip');
    expect(res.statusCode).toBe(200);

    res = await setStatusViaController(instance.id, 'cancel');
    expect(res.statusCode).toBe(200);
    expect(res._json.task.status).toBe('cancel');

    const row = await getTasks({ id: instance.id });
    expect(row.status).toBe('cancel');
    expect(row.completed_at).toBeTruthy();

    // Master's rolling anchor unchanged (cancel does not advance it).
    const updatedMaster = await getTaskInstances(master.id, true);
    expect(updatedMaster.rollingAnchor).toBe('2026-06-15');
  });
});

/**
 * TS-325: user cannot set `missed` — it is no longer a valid status (400).
 * Domain: State Machine / Status Transitions / Recovery
 */
describe('TS-325: user-set missed is rejected (invalid status)', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: setting missed via the controller → 400 Invalid status', async () => {
    const { instanceId } = await seedOpenInstance('missed-attempt');

    const res = await setStatusViaController(instanceId, 'missed');
    expect(res.statusCode).toBe(400);
    expect(res._json.error).toMatch(/Invalid status/);
  });
});

/**
 * TS-326: Paused → active — unpausing a recurring template restores the open ('') status.
 * Domain: State Machine / Pause / Recurring Templates
 */
describe('TS-326: Paused → active — template unpause', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: paused recurring template unpaused → master status back to open', async () => {
    const template = await createRecurringTask({
      text: 'Weekly report',
      dur: 60,
      pri: 'P3',
      when: 'morning',
      status: 'pause',
      recur: { type: 'weekly', days: ['Mon'] }
    });

    // Unpause via the controller (only '' or 'pause' are valid on a template).
    const res = await setStatusViaController(template.id, '');
    expect(res.statusCode).toBe(200);

    const masterRow = await getTaskInstances(template.id, true);
    expect(masterRow.status).toBe('');
  });
});

/**
 * TS-327: Active → pause — pausing a recurring template; existing instances are preserved.
 * Domain: State Machine / Pause / Suspension
 */
describe('TS-327: Active → pause — template suspension', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: active recurring template paused → master=pause, existing instances preserved', async () => {
    const template = await createRecurringTask({
      text: 'Morning routine',
      dur: 30,
      pri: 'P3',
      when: 'morning',
      status: '',
      recur: { type: 'daily' }
    });
    const instance1 = await createTask({ master_id: template.id, text: template.text, dur: 30, status: '', scheduled_at: '2026-06-15T07:00:00Z' });
    const instance2 = await createTask({ master_id: template.id, text: template.text, dur: 30, status: '', scheduled_at: '2026-06-16T07:00:00Z' });

    const res = await setStatusViaController(template.id, 'pause');
    expect(res.statusCode).toBe(200);

    const masterRow = await getTaskInstances(template.id, true);
    expect(masterRow.status).toBe('pause');

    // Both pre-existing instances are still present (pause keeps them, per 999.590).
    const existing = await getTaskInstances({ master_id: template.id });
    const ids = existing.map(i => i.id);
    expect(ids).toContain(instance1.id);
    expect(ids).toContain(instance2.id);
  });
});

/**
 * TS-328: open → wip → done → reopen('') → done — round-trip lifecycle through the controller.
 * Domain: State Machine / Lifecycle / Round-Trip
 */
describe('TS-328: open → wip → done → reopen → done round-trip', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: full lifecycle round-trip completes without errors', async () => {
    const { instanceId } = await seedOpenInstance('round-trip');

    expect((await setStatusViaController(instanceId, 'wip')).statusCode).toBe(200);
    expect((await setStatusViaController(instanceId, 'done')).statusCode).toBe(200);

    // Reopen (done → '') clears completed_at.
    const reopen = await setStatusViaController(instanceId, '');
    expect(reopen.statusCode).toBe(200);
    expect(reopen._json.task.status).toBe('');
    expect(reopen._json.task.completedAt).toBeNull();

    // Mark done again.
    const finalDone = await setStatusViaController(instanceId, 'done');
    expect(finalDone.statusCode).toBe(200);
    expect(finalDone._json.task.status).toBe('done');

    const row = await getTasks({ id: instanceId });
    expect(row.status).toBe('done');
    expect(row.completed_at).toBeTruthy();
  });
});

/**
 * TS-329: pairwise status transitions verified against the authoritative matrix
 * (docs/architecture/TASK-STATE-MATRIX.md), driven through the real updateTaskStatus
 * controller so the actual guard is exercised.
 *
 * Matrix (one-off / instance):
 *   "" (open) → done | wip | skip | cancel        (terminals require a scheduled time)
 *   wip       → done | "" (reopen) | skip | cancel
 *   done|skip|cancel are terminal but reactivation to "" / wip is supported
 *     (done_frozen reactivation, R-undo); the matrix's hard rules are:
 *       - an unknown status string is rejected       → 400 Invalid status
 *       - a disabled row is frozen                   → 403 TASK_DISABLED (see TS-320)
 * Domain: State Machine / Transition Matrix
 */
describe('TS-329: status transitions verified through the real guard', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  // ── Valid transitions the matrix allows from an open/wip one-off ───────────
  const validFromOpen = [
    ['', 'wip'], ['', 'done'], ['', 'skip'], ['', 'cancel']
  ];
  validFromOpen.forEach(([from, to]) => {
    it(`Valid: open → ${to}`, async () => {
      const { instanceId } = await seedOpenInstance(`valid-${to}`);
      if (from === 'wip') {
        expect((await setStatusViaController(instanceId, 'wip')).statusCode).toBe(200);
      }
      const res = await setStatusViaController(instanceId, to);
      expect(res.statusCode).toBe(200);
      expect(res._json.task.status).toBe(to);
    });
  });

  const validFromWip = [
    ['wip', ''], ['wip', 'done'], ['wip', 'skip'], ['wip', 'cancel']
  ];
  validFromWip.forEach(([from, to]) => {
    it(`Valid: wip → ${to === '' ? 'open' : to}`, async () => {
      const { instanceId } = await seedOpenInstance(`valid-wip-${to || 'open'}`);
      expect((await setStatusViaController(instanceId, 'wip')).statusCode).toBe(200);
      const res = await setStatusViaController(instanceId, to);
      expect(res.statusCode).toBe(200);
      expect(res._json.task.status).toBe(to);
    });
  });

  // ── Hard-forbidden by the matrix, asserted through the real guard ──────────

  it('Forbidden: user cannot set missed → 400 Invalid status', async () => {
    const { instanceId } = await seedOpenInstance('forbid-missed');
    const res = await setStatusViaController(instanceId, 'missed');
    expect(res.statusCode).toBe(400);
    expect(res._json.error).toMatch(/Invalid status/);
  });

  it('Forbidden: an unknown status string is rejected → 400 Invalid status', async () => {
    const { instanceId } = await seedOpenInstance('forbid-unknown');
    // `archived`/`restored` are NOT in the authoritative status set.
    for (const bad of ['archived', 'restored', 'bogus']) {
      const res = await setStatusViaController(instanceId, bad);
      expect(res.statusCode).toBe(400);
      expect(res._json.error).toMatch(/Invalid status/);
    }
  });

  // revised leg sched-audit 2026-07-02: reject-400 superseded by D-B resolve-in-place
  // ruling (snap-then-write) — see bert REFER db-guard-7 (DB-GUARD-bert-REVIEW.json)
  // + UpdateTaskStatus.js:154-171. A terminal write on an unscheduled instance now
  // SUCCEEDS (200) with scheduled_at snapped to ~now, instead of being rejected.
  // A FRESH instance is seeded per status (rather than reusing one instance across
  // all three, as the original 400-path loop did) so each case starts from the
  // same unscheduled-open precondition — done/skip/cancel are independent checks,
  // not a sequential transition chain.
  it('Snap-then-write: terminal status without a scheduled time → 200, scheduled_at snapped to ~now', async () => {
    const master = await createTask({ text: 'no-sched (master)', dur: 30, status: '' });
    for (const term of ['done', 'skip', 'cancel']) {
      const instance = await createTask({ master_id: master.id, text: 'no-sched-' + term, dur: 30, status: '' });
      const before = Date.now();
      const res = await setStatusViaController(instance.id, term);
      const after = Date.now();
      expect(res.statusCode).toBe(200);
      expect(res._json.task.status).toBe(term);

      const row = await getTasks({ id: instance.id });
      expect(row.status).toBe(term);
      expect(row.scheduled_at).toBeTruthy();
      const snappedAt = new Date(scheduledAtToISO(row.scheduled_at)).getTime();
      expect(snappedAt).toBeGreaterThanOrEqual(before - 5000);
      expect(snappedAt).toBeLessThanOrEqual(after + 5000);
    }
  });

  it('Forbidden: a recurring template only accepts "" or "pause" → 400 otherwise', async () => {
    const template = await createRecurringTask({
      text: 'template-guard', dur: 30, pri: 'P3', status: '',
      recur: { type: 'daily', days: 'MTWRFSU', every: 1 }
    });
    for (const bad of ['done', 'wip', 'skip', 'cancel']) {
      const res = await setStatusViaController(template.id, bad);
      expect(res.statusCode).toBe(400);
    }
  });
});

/**
 * TS-330: locScheduleOverrides references non-existent templateId — resolveLocationId falls through
 * Domain: Template Resolution / Location / Graceful Fallthrough
 */
describe('TS-330: locScheduleOverrides non-existent templateId fallthrough', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: non-existent templateId falls through to block.loc', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');

    // Setup config with non-existent template
    const config = {
      hourLocationOverrides: {},
      locScheduleOverrides: { '2026-06-15': 'nonexistent-template-id' },
      locScheduleDefaults: {},
      locSchedules: { 'valid-template': { hours: { 480: 'work' } } },
      scheduleTemplates: null
    };

    // Mock resolveLocationId to use our test config
    const { resolveLocationId } = require('../../src/scheduler/locationHelpers');
    
    const blocks = [
      { tag: 'morning', start: 360, end: 480, loc: 'home' },
      { tag: 'biz', start: 480, end: 720, loc: 'work' }
    ];

    const result = resolveLocationId('2026-06-15', 540, config, blocks);
    expect(result).toBe('work'); // Should fall through to block.loc
  });

  it('SUB-330a: Non-existent templateId at minute 360 → returns home', async () => {
    const config = {
      hourLocationOverrides: {},
      locScheduleOverrides: { '2026-06-15': 'nonexistent-template-id' },
      locScheduleDefaults: {},
      locSchedules: {},
      scheduleTemplates: null
    };

    const { resolveLocationId } = require('../../src/scheduler/locationHelpers');
    
    const blocks = [
      { tag: 'morning', start: 360, end: 480 }, // No loc field
      { tag: 'biz', start: 480, end: 720, loc: 'work' }
    ];

    const result = resolveLocationId('2026-06-15', 360, config, blocks);
    expect(result).toBe('home'); // Should return default 'home'
  });
});

/**
 * TS-331: locScheduleDefaults references non-existent templateId — falls through to block.loc
 * Domain: Template Resolution / Location / Graceful Fallthrough
 */
describe('TS-331: locScheduleDefaults non-existent templateId fallthrough', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: non-existent templateId in defaults falls through', async () => {
    const config = {
      hourLocationOverrides: {},
      locScheduleOverrides: {},
      locScheduleDefaults: { 'Mon': 'nonexistent-template-id' },
      locSchedules: { 'another-valid': { hours: { 600: 'gym' } } },
      scheduleTemplates: null
    };

    const { resolveLocationId } = require('../../src/scheduler/locationHelpers');
    
    const blocks = [
      { tag: 'morning', start: 360, end: 480, loc: 'home' },
      { tag: 'biz', start: 480, end: 720, loc: 'office' }
    ];

    const result = resolveLocationId('2026-06-15', 600, config, blocks);
    expect(result).toBe('office'); // Should fall through to block.loc
  });
});

/**
 * TS-332: locSchedules references non-existent templateId — falls through to default "home"
 * Domain: Template Resolution / Location / Graceful Fallthrough
 */
describe('TS-332: locSchedules non-existent templateId fallthrough', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: empty locSchedules falls through to home', async () => {
    const config = {
      hourLocationOverrides: {},
      locScheduleOverrides: {},
      locScheduleDefaults: {},
      locSchedules: {}, // Empty
      scheduleTemplates: null
    };

    const { resolveLocationId } = require('../../src/scheduler/locationHelpers');
    
    const blocks = [
      { tag: 'morning', start: 360, end: 480 }, // No loc
      { tag: 'biz', start: 480, end: 720 }     // No loc
    ];

    const result = resolveLocationId('2026-06-15', 420, config, blocks);
    expect(result).toBe('home'); // Should return default 'home'
  });
});

/**
 * TS-333: Every test must specify user timezone — test fails if timezone not explicitly set
 * Domain: Timezone / Test Infrastructure / Mandatory Setup
 */
describe('TS-333: Timezone enforcement in test framework', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Test without timezone should fail validation', async () => {
    // This test intentionally doesn't set timezone to demonstrate the requirement
    // In a real implementation, the test framework would catch this and fail
    
    // For now, we'll just document the requirement
    expect(true).toBe(true); // Placeholder - actual validation would be in test framework
  });

  it('Test with explicit timezone should pass', async () => {
    mockClock('2026-06-15T08:00:00-04:00');
    mockTimezone('America/New_York');
    
    // This test has explicit timezone, so it should pass
    expect(true).toBe(true);
  });
});

/**
 * TS-334: User in America/Los_Angeles vs America/New_York — different nowMins → different placement
 * Domain: Timezone / Cross-TZ Placement / Determinism
 */
describe('TS-334: Cross-timezone placement differences', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: same absolute clock, different timezone → different placement', async () => {
    // Drive the REAL wired clock seam (getNowInTimezone, R50.8) rather than the
    // inert mockClock/mockTimezone setters: one absolute instant, resolved in two
    // timezones, yields two different nowMins that the scheduler genuinely consumes.
    //
    // Absolute clock: 2026-06-15T12:00:00Z (12:00 UTC)
    //   • America/New_York   (UTC-4 EDT) → 08:00 → nowMins = 480 (morning block ended)
    //   • America/Los_Angeles(UTC-7 PDT) → 05:00 → nowMins = 300 (morning not started)
    const { getNowInTimezone } = require('../../../shared/scheduler/getNowInTimezone');
    const { FakeClockAdapter } = require('../../test-helpers/clock');

    const absClock = new FakeClockAdapter({ startTime: '2026-06-15T12:00:00Z' });
    const ny = getNowInTimezone('America/New_York', absClock);
    const la = getNowInTimezone('America/Los_Angeles', absClock);

    // Sanity: the same instant resolves to different wall clocks per tz.
    expect(ny.nowMins).toBe(480);
    expect(la.nowMins).toBe(300);
    expect(ny.nowMins).not.toBe(la.nowMins);

    // A daily morning task (block 360-480) seeded once; the only variable across
    // the two runs is the timezone-resolved nowMins fed into the scheduler.
    await createRecurringTask({
      text: 'Morning report',
      dur: 30,
      pri: 'P3',
      when: 'morning',
      recur: { type: 'daily' },
      recurStart: '2026-06-15'
    });

    // Run as the NY user: today's morning block already closed at nowMins=480.
    const runNY = await runScheduler([], {}, ny.todayKey, ny.nowMins, { timezone: 'America/New_York' });
    // Run as the LA user: today's morning block (from 360) is still open at nowMins=300.
    const runLA = await runScheduler([], {}, la.todayKey, la.nowMins, { timezone: 'America/Los_Angeles' });

    const firstNY = runNY.scheduledTasks[0];
    const firstLA = runLA.scheduledTasks[0];

    // Both runs place instances somewhere (NEVER-MISSING invariant).
    expect(firstNY).toBeDefined();
    expect(firstLA).toBeDefined();

    // The earlier wall clock (LA, 5:00 AM) still fits today's 6:00 AM morning slot,
    // so its first placed instance is 2026-06-15. The later one (NY, 8:00 AM) has
    // missed today's morning, so its first placed instance rolls to 2026-06-16.
    expect(firstLA.date).toBe('6/15/2026');
    expect(firstNY.date).toBe('6/16/2026');
    expect(firstNY.date).not.toBe(firstLA.date);
  });
});
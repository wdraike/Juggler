// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../src/lib/audit-context').stampInsert(rows);
/**
 * BUG-814 slow-path coverage — runSchedule.js:2183 query + expandRecurring filter.
 *
 * Covers: BUG-814 slow-path (fixy-cancelled leg)
 * Layer: integration (DB-backed — requires test-bed MySQL @3407)
 * Traceability: .planning/kermit/fixy-cancelled/TRACEABILITY.md BUG-814
 *
 * ── Architecture of the slow-path fix ────────────────────────────────────────
 *
 * The slow-path load query at runSchedule.js:2183 (getSchedulePlacements when
 * cache is stale) mirrors the primary load (:500). Both add:
 *
 *   .orWhere(function() {
 *     this.where('task_type', 'recurring_template')
 *         .whereNotIn('status', ['cancelled', 'disabled']);
 *   })
 *
 * HOWEVER: tasks_v is a LEFT JOIN over task_masters + task_instances. A
 * recurring_template generates TWO view rows when it has a matching instance:
 *   Row 1 — task_type='recurring_template', status=NULL  (master header)
 *   Row 2 — task_type='recurring_instance', status='cancelled'  (instance row)
 *
 * The recurring_instance row (Row 2) IS excluded by the query — its status
 * 'cancelled' does not match '', 'wip', NULL, or the recurring_template branch.
 *
 * The recurring_template header row (Row 1) STILL appears via orWhereNull —
 * this is the residual gap. The whereNotIn guard on the recurring_template
 * branch is not reached because orWhereNull fires first.
 *
 * ── Why expansion is still blocked (defence-in-depth) ────────────────────────
 *
 * Even though the template header row loads, the full slow-path in
 * getSchedulePlacements builds a statuses map from DB state:
 *
 *   statuses[t.id] = t.status || ''
 *
 * For the template header row, rowToTask returns status='' (null coerced).
 * The statuses map therefore gets statuses[tmplId] = ''.
 *
 * BUT: the runScheduleAndPersist primary path (:500) uses the SAME query
 * shape. After cancel-series, the task_masters row has status='cancelled'.
 * The statuses map is built from the rowToTask output (which reads from
 * tasks_v status=NULL → ''), NOT from task_masters.status directly. So
 * the statuses map has '' for the template, and expandRecurring's statuses-map
 * guard (line 84: `var st = statuses[t.id] || t.status || ''`) also resolves
 * to '' (not 'cancelled').
 *
 * The defence-in-depth layer that DOES prevent expansion is:
 *   expandRecurring.js:85 filter: `if (st === 'pause' || st === 'disabled'
 *                                      || st === 'cancelled') return false;`
 *
 * For this filter to fire, st must be 'cancelled'. st = statuses[id] || t.status.
 * When the slow path loads the template via the null-status view path, t.status
 * is null → '' → the filter does NOT fire → the template IS re-expanded.
 *
 * CONCLUSION: The slow-path fix at :2183 is INCOMPLETE in isolation. The
 * correct fix requires one of:
 *   (a) Excluding `task_type='recurring_template'` from the orWhereNull branch
 *       (so the template header never loads unless it falls into the
 *       recurring_template branch with status NOT IN ('cancelled','disabled')).
 *   (b) Reading task_masters.status directly instead of through tasks_v
 *       (as SchedulerTaskProvider does — that's why BUG-814 is fixed there).
 *
 * The residual gap is documented as WARN-1 in TEST-CATALOG.md. This test file
 * provides:
 *   1. GREEN tests that pin what IS correctly excluded (recurring_instance rows
 *      with cancelled status, and the query contract on that type).
 *   2. A documented RESIDUAL-GAP test that asserts the current (incomplete)
 *      state without lying that it is fixed.
 *
 * ── Run command ──────────────────────────────────────────────────────────────
 *
 *   DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass \
 *   DB_NAME=juggler_fixy_test NODE_ENV=test \
 *   npx jest --testPathPattern="bug814-runschedule-slowpath" --forceExit
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../../src/db');
var tasksWrite = require('../../src/lib/tasks-write');
var { assertDbAvailable } = require('../helpers/requireDB');

var USER_ID = 'bug814-sp-' + Date.now().toString(36);

async function cleanup() {
  await db('task_instances').where('user_id', USER_ID).del().catch(function() {});
  await db('task_masters').where('user_id', USER_ID).del().catch(function() {});
  await db('users').where('id', USER_ID).del().catch(function() {});
}

beforeAll(async function() {
  await assertDbAvailable();
  await cleanup();
  await db('users').insert(__stampFixture({
    id: USER_ID, email: 'bug814sp@test.invalid', timezone: 'America/New_York',
    created_at: db.fn.now(), updated_at: db.fn.now(),
  }));
}, 15000);

afterAll(async function() { await cleanup(); await db.destroy(); }, 10000);

beforeEach(async function() {
  await db('task_instances').where('user_id', USER_ID).del().catch(function() {});
  await db('task_masters').where('user_id', USER_ID).del().catch(function() {});
});

// The slow-path query shape — identical to runSchedule.js:2183
function slowPathQuery(userId) {
  return db('tasks_v').where('user_id', userId)
    .where(function() {
      this.where('status', '').orWhere('status', 'wip').orWhereNull('status')
        .orWhere(function() {
          this.where('task_type', 'recurring_template')
              .whereNotIn('status', ['cancelled', 'disabled']);
        });
    })
    .select('id', 'status', 'task_type');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BUG-814 slow-path: load query — recurring_instance rows with cancelled status excluded', function() {
  // ── What IS correctly filtered by the fix ──────────────────────────────────

  test('active recurring_template header row IS returned (golden-master, no-regress)', async function() {
    // An active template must still load — no regression.
    await tasksWrite.insertTask(db, {
      id: 'sp-act-' + Math.random().toString(36).slice(2, 8),
      user_id: USER_ID, task_type: 'recurring_template', text: 'Active', dur: 30, pri: 'P3',
      status: '', recurring: 1, recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      created_at: db.fn.now(), updated_at: db.fn.now(),
    });

    var rows = await slowPathQuery(USER_ID);
    // At least one row returned for the active template.
    expect(rows.length).toBeGreaterThan(0);
  });

  test('cancelled recurring_instance row (fabricated instance) is EXCLUDED by the fix', async function() {
    // A recurring_instance row (task_type='recurring_instance') with status='cancelled'
    // represents a fabricated instance that was soft-cancelled. The fix at :2183
    // ensures these rows do NOT appear in taskRows (preventing re-hydration into
    // the schedule as active tasks).
    //
    // PRE-FIX: the bare `OR task_type='recurring_template'` at :2183 did NOT
    // cover recurring_instance rows, but the original query also lacked the
    // explicit exclusion of status='cancelled' for those rows. Post-fix the
    // structure is: only status='', 'wip', NULL are included + active recurring
    // templates. A cancelled instance row is NOT ''/wip/null and NOT a template
    // → correctly excluded.
    var tmplId = 'sp-tpl-' + Math.random().toString(36).slice(2, 8);
    var instId = tmplId + '-inst1';

    await db('task_masters').insert(__stampFixture({
      id: tmplId, user_id: USER_ID, text: 'Template', dur: 30, pri: 'P3',
      recurring: 1, status: 'cancelled',
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      created_at: new Date(), updated_at: new Date(),
    }));
    // Fabricated instance row with status='cancelled' — this is what softCancelWhere
    // sets on fabricated task_instances rows after cancel-series.
    await db('task_instances').insert(__stampFixture({
      id: instId, master_id: tmplId, user_id: USER_ID,
      status: 'cancelled', occurrence_ordinal: 1, split_ordinal: 1, split_total: 1,
      dur: 30, scheduled_at: new Date(Date.now() + 86400000),
      created_at: new Date(), updated_at: new Date(),
    }));

    var rows = await slowPathQuery(USER_ID);
    var instanceRows = rows.filter(function(r) {
      return r.id === instId && r.task_type === 'recurring_instance';
    });

    // The cancelled instance row must NOT appear in the load set.
    // POST-FIX: excluded (status='cancelled' is not matched by any branch).
    // PRE-FIX: also excluded (it's not a recurring_template) — but the key
    // point is the guard prevents re-loading as an active task.
    expect(instanceRows).toHaveLength(0);
  });

  test('wip recurring_instance row IS included in slow-path query (golden-master regression)', async function() {
    // Confirms the query does not over-exclude: a wip instance must still load.
    var tmplId = 'sp-wip-' + Math.random().toString(36).slice(2, 8);
    var instId = tmplId + '-inst1';

    await db('task_masters').insert(__stampFixture({
      id: tmplId, user_id: USER_ID, text: 'WIP template', dur: 30, pri: 'P3',
      recurring: 1, status: '',
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      created_at: new Date(), updated_at: new Date(),
    }));
    await db('task_instances').insert(__stampFixture({
      id: instId, master_id: tmplId, user_id: USER_ID,
      status: 'wip', occurrence_ordinal: 1, split_ordinal: 1, split_total: 1,
      dur: 30, scheduled_at: new Date(Date.now() + 86400000),
      created_at: new Date(), updated_at: new Date(),
    }));

    var rows = await slowPathQuery(USER_ID);
    var wipRows = rows.filter(function(r) {
      return r.id === instId && r.status === 'wip';
    });
    // wip instance MUST still appear — the fix must not over-exclude.
    expect(wipRows).toHaveLength(1);
  });

  // ── RESIDUAL GAP: recurring_template HEADER row ────────────────────────────
  //
  // The template HEADER row (task_type='recurring_template') always appears in
  // tasks_v with status=NULL (LEFT JOIN — no matching instance row for the master
  // header). The orWhereNull branch captures it BEFORE the recurring_template
  // branch with whereNotIn runs. Therefore the header row appears even for a
  // cancelled template.
  //
  // This test documents the current behaviour (the gap), NOT the desired fix.
  // It is marked with the RESIDUAL-GAP prefix so it is visible in CI output.
  //
  // Fix needed: exclude task_type='recurring_template' from the orWhereNull
  // branch, or query task_masters.status directly (see SchedulerTaskProvider
  // which is the correctly-fixed hex adapter).
  test('RESIDUAL-GAP (known unfixed): cancelled recurring_template header row still appears via orWhereNull', async function() {
    var tmplId = 'sp-gap-' + Math.random().toString(36).slice(2, 8);
    var instId = tmplId + '-inst1';

    await db('task_masters').insert(__stampFixture({
      id: tmplId, user_id: USER_ID, text: 'Gap template', dur: 30, pri: 'P3',
      recurring: 1, status: 'cancelled',
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      created_at: new Date(), updated_at: new Date(),
    }));
    // Fabricated instance with cancelled status (distinct id from template)
    await db('task_instances').insert(__stampFixture({
      id: instId, master_id: tmplId, user_id: USER_ID,
      status: 'cancelled', occurrence_ordinal: 1, split_ordinal: 1, split_total: 1,
      dur: 30, scheduled_at: new Date(Date.now() + 86400000),
      created_at: new Date(), updated_at: new Date(),
    }));

    var rows = await slowPathQuery(USER_ID);
    var templateHeaderRows = rows.filter(function(r) {
      return r.id === tmplId && r.task_type === 'recurring_template';
    });

    // RESIDUAL GAP: the template HEADER row appears with status=null via
    // orWhereNull — this is the UNFIXED part of BUG-814 in the slow-path.
    // When this assertion eventually changes to toHaveLength(0), the gap is
    // closed and this test should be updated to assert exclusion instead.
    expect(templateHeaderRows).toHaveLength(1);   // gap: header still present
    expect(templateHeaderRows[0].status).toBeNull(); // status=null from LEFT JOIN
  });
});

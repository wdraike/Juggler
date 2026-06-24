/**
 * Leg D (scheduler-recurring-rework §4) — auto-miss removed.
 *
 * David (2026-06-24): "there should not be any auto-miss feature. remove that."
 * A past-incomplete recurring instance must NEVER be auto-marked terminal 'missed'
 * by the system. Per R50 + the never-missing invariant it stays a live, VISIBLE
 * commitment: OVERDUE (pinned on its day) if placed, or unscheduled if never placed.
 *
 * RED on pre-fix code (the instance becomes status='missed'); GREEN after (overdue,
 * not missed). test-bed 3407; never bare jest on dev 3308.
 */
var db = require('../../src/db');
var { runScheduleAndPersist } = require('../../src/scheduler/runSchedule');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
var { assertDbAvailable } = require('../helpers/requireDB');

var available = false;
var USER_ID = 'no-auto-miss-test-001';
var TZ = 'America/New_York';

function dayKey(off) {
  var d = new Date(); d.setUTCDate(d.getUTCDate() + off);
  var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, a = d.getUTCDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (a < 10 ? '0' : '') + a;
}

beforeAll(async () => {
  await assertDbAvailable();
  try { await db.raw('SELECT 1'); available = true; } catch (e) { console.warn('no DB', e.message); return; }
  await cleanup();
  await db('users').insert({ id: USER_ID, email: 'nam@test.com', timezone: TZ, created_at: db.fn.now(), updated_at: db.fn.now() });
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

var fs = require('fs');
var path = require('path');

describe('Leg D — no auto-miss; past-incomplete recurring stays visible', () => {
  test('STRUCTURAL: the scheduler no longer writes status:missed (auto-miss removed)', () => {
    // Deterministic proof the feature is gone: no `status: 'missed'` write remains in the
    // scheduler source (comments referencing the retired behavior are allowed).
    var src = fs.readFileSync(path.join(__dirname, '../../src/scheduler/runSchedule.js'), 'utf8');
    var writeMatches = src.split('\n').filter(function(line) {
      var trimmed = line.trim();
      // skip line comments and JSDoc/block-comment lines
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
      var code = line.replace(/\/\/.*$/, '');
      return /status\s*:\s*['"]missed['"]/.test(code);
    });
    expect(writeMatches).toEqual([]);
  });

  test('INVARIANT: past-incomplete recurring is never missed and always visible', async () => {
    if (!available) return;
    // DAILY (day-locked — no roam, the real "Apply for Jobs" case). small timeFlex so a
    // 10-day-old occurrence is outside BOTH the timeFlex window AND its (1-day) period →
    // pre-fix code froze it on its day then auto-missed it. Day-locked → reconcile won't
    // move it forward, so the miss path is reliably exercised.
    await db('task_masters').insert({
      id: 'nam-tmpl', user_id: USER_ID, text: 'Past recurring', dur: 30, status: '', recurring: 1,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      recur_start: dayKey(-30), when: 'morning', placement_mode: 'time_window', time_flex: 60,
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    // a NEVER-PLACED past instance 10 days ago (scheduled_at NULL), still pending. This is
    // the case PATH-C does NOT spare → pre-fix code auto-marks it 'missed' (RED).
    await db('task_instances').insert({
      id: 'nam-inst', master_id: 'nam-tmpl', user_id: USER_ID,
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1,
      scheduled_at: null, date: dayKey(-10), time: null,
      status: '', dur: 30, created_at: db.fn.now(), updated_at: db.fn.now()
    });

    await runScheduleAndPersist(USER_ID);

    var row = await db('task_instances').where({ id: 'nam-inst' }).first();
    // The instance must still EXIST and must NOT be terminal 'missed'.
    expect(row).toBeTruthy();
    expect(row.status).not.toBe('missed');
    // Never-missing: it is visible in SOME live state — placed (scheduled_at set, shown
    // overdue on its past day), overdue-flagged, or unscheduled (Unplaced). Never absent,
    // never silently closed. (Which path handles it depends on placement; all are visible.)
    var visible = (row.scheduled_at != null) || !!row.overdue || !!row.unscheduled;
    expect(visible).toBe(true);
    // NO recurring instance for this master was auto-missed by the system.
    var missed = await db('task_instances').where({ master_id: 'nam-tmpl', status: 'missed' });
    expect(missed.length).toBe(0);
  }, 20000);
});

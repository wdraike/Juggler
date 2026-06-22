/**
 * H4 W5 unit tests — config use-cases (GetConfig/GetProjects/GetLocations/GetTools,
 * UpdateConfig, CreateProject/UpdateProject/DeleteProject/ReorderProjects,
 * ReplaceLocations/ReplaceTools).
 *
 * Behavioral, over the W3 InMemoryConfigRepository (no DB) + fake cache/collaborator
 * doubles. Each test asserts the use-case reproduces the legacy handler's HTTP
 * envelope ({status, body}) + the byte-identical mapping + the side-effects (cache
 * invalidation, transaction rollback). Hardened (BASE-TESTING §2a): assertions are
 * behavioral (no source-grep), and the key pins are self-mutation-verified in
 * `*.mutation.test.js` siblings where the assertion is load-bearing.
 *
 * Traceability: WBS W5 (a)(b)(c)(f); golden-master Surfaces 1/2 (H1/H2).
 */

'use strict';

var path = require('path');
var SLICE = path.join(__dirname, '..', '..', '..', '..', 'src', 'slices', 'user-config');
var InMemoryConfigRepository = require(path.join(SLICE, 'adapters', 'InMemoryConfigRepository'));
var App = require(path.join(SLICE, 'application'));

function fakeCache() {
  return {
    _store: {},
    _calls: { get: [], set: [], invalidateConfig: [], invalidateTasks: [] },
    get: function (k) { this._calls.get.push(k); return Promise.resolve(this._store[k] || null); },
    set: function (k, v) { this._calls.set.push([k, v]); this._store[k] = v; return Promise.resolve(true); },
    invalidateConfig: function (u) { this._calls.invalidateConfig.push(u); return Promise.resolve(true); },
    invalidateTasks: function (u) { this._calls.invalidateTasks.push(u); return Promise.resolve(true); }
  };
}

var USER = 'w5-user-A';

// ── GetConfig ────────────────────────────────────────────────────────────────
describe('GetConfig (== getAllConfig, H1-1/H1-3)', () => {
  test('cache HIT returns the cached payload verbatim WITHOUT reading the repo', async () => {
    var cache = fakeCache();
    cache._store['user:' + USER + ':config'] = { sentinel: 'cached' };
    // repo with a getLocations that would THROW if called — proves the cache short-circuits.
    var repo = new InMemoryConfigRepository();
    repo.getLocations = function () { throw new Error('repo must NOT be read on cache hit'); };
    var uc = new App.GetConfig({ repo: repo, cache: cache });

    var res = await uc.execute({ userId: USER });
    expect(res).toEqual({ status: 200, body: { sentinel: 'cached' } });
  });

  test('cache MISS reads repo, builds the shape, sets a 3600s cache entry', async () => {
    var repo = new InMemoryConfigRepository({
      locations: [{ user_id: USER, location_id: 'l1', name: 'Home', icon: '', lat: '37.7', lon: '-122.4', display_name: 'SF', sort_order: 0 }],
      tools: [{ user_id: USER, tool_id: 't1', name: 'Laptop', icon: '💻', sort_order: 0 }],
      projects: [{ user_id: USER, id: 9, name: 'Work', color: '#blue', icon: null, sort_order: 0 }],
      config: [
        { user_id: USER, config_key: 'preferences', config_value: JSON.stringify({ weekStartsOn: 1 }) },
        { user_id: USER, config_key: 'temp_unit_pref', config_value: '"F"' }
      ]
    });
    var cache = fakeCache();
    var uc = new App.GetConfig({ repo: repo, cache: cache });

    var res = await uc.execute({ userId: USER });
    expect(res.status).toBe(200);
    // lat/lon parseFloat'd; displayName mapped
    expect(res.body.locations[0]).toMatchObject({ id: 'l1', name: 'Home', lat: 37.7, lon: -122.4, displayName: 'SF' });
    expect(res.body.tools[0]).toMatchObject({ id: 't1', name: 'Laptop' });
    expect(res.body.projects[0]).toMatchObject({ id: 9, name: 'Work', color: '#blue', icon: null, sortOrder: 0 });
    expect(res.body.preferences).toEqual({ weekStartsOn: 1 });
    expect(res.body.tempUnitPref).toBe('F');
    // 1h TTL cache set
    expect(cache._calls.set).toHaveLength(1);
    expect(cache._calls.set[0][0]).toBe('user:' + USER + ':config');
  });

  test('userTimezone surfaces the configured users.timezone for FE display (A1)', async () => {
    var repo = new InMemoryConfigRepository({ userTimezones: { [USER]: 'America/New_York' } });
    var uc = new App.GetConfig({ repo: repo, cache: fakeCache() });
    var res = await uc.execute({ userId: USER });
    expect(res.body.userTimezone).toBe('America/New_York');
  });

  test('userTimezone is null when the user has no configured timezone (A1)', async () => {
    var repo = new InMemoryConfigRepository();
    var uc = new App.GetConfig({ repo: repo, cache: fakeCache() });
    var res = await uc.execute({ userId: USER });
    expect(res.body.userTimezone).toBeNull();
  });

  test('tempUnitPref defaults to "F" + null fields when no config rows (H1-3)', async () => {
    var repo = new InMemoryConfigRepository();
    var uc = new App.GetConfig({ repo: repo, cache: fakeCache() });
    var res = await uc.execute({ userId: USER });
    expect(res.body.tempUnitPref).toBe('F');
    expect(res.body.toolMatrix).toBeNull();
    expect(res.body.timeBlocks).toBeNull();
  });
});

// ── GetProjects / GetLocations / GetTools ────────────────────────────────────
describe('GetProjects / GetLocations / GetTools (H1-11/H1-19/H1-22)', () => {
  test('GetProjects maps to {id,name,color,icon,sortOrder}', async () => {
    var repo = new InMemoryConfigRepository({ projects: [{ user_id: USER, id: 1, name: 'Home', color: '#ccc', icon: null, sort_order: 0 }] });
    var res = await new App.GetProjects({ repo: repo }).execute({ userId: USER });
    expect(res.status).toBe(200);
    expect(res.body.projects[0]).toMatchObject({ id: 1, name: 'Home', sortOrder: 0 });
  });

  test('GetLocations parseFloats lat/lon + maps displayName', async () => {
    var repo = new InMemoryConfigRepository({ locations: [{ user_id: USER, location_id: 'l1', name: 'Home', icon: '', lat: '1.5', lon: '2.5', display_name: 'X', sort_order: 0 }] });
    var res = await new App.GetLocations({ repo: repo }).execute({ userId: USER });
    expect(res.body.locations[0]).toMatchObject({ id: 'l1', lat: 1.5, lon: 2.5, displayName: 'X' });
  });

  test('GetTools maps to {id,name,icon}', async () => {
    var repo = new InMemoryConfigRepository({ tools: [{ user_id: USER, tool_id: 't1', name: 'Laptop', icon: '💻', sort_order: 0 }] });
    var res = await new App.GetTools({ repo: repo }).execute({ userId: USER });
    expect(res.body.tools[0]).toMatchObject({ id: 't1', name: 'Laptop' });
  });
});

// ── UpdateConfig ─────────────────────────────────────────────────────────────
describe('UpdateConfig (== updateConfig, H1-5..H1-10)', () => {
  test('valid key upserts, invalidates cache, returns {key,value,warnings}', async () => {
    var repo = new InMemoryConfigRepository();
    var cache = fakeCache();
    var res = await new App.UpdateConfig({ repo: repo, cache: cache, enqueueScheduleRun: function () {} })
      .execute({ userId: USER, key: 'preferences', value: { weekStartsOn: 1 } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: 'preferences', value: { weekStartsOn: 1 }, warnings: [] });
    expect(cache._calls.invalidateConfig).toEqual([USER]);
    // the row was upserted (stored as a JSON string)
    var row = await repo.getConfigRow(USER, 'preferences');
    expect(JSON.parse(row.config_value)).toEqual({ weekStartsOn: 1 });
  });

  test('invalid config key → 400 WITHOUT writing (no upsert)', async () => {
    var repo = new InMemoryConfigRepository();
    var writeCount = 0; var orig = repo.upsertConfig.bind(repo);
    repo.upsertConfig = function () { writeCount++; return orig.apply(repo, arguments); };
    var res = await new App.UpdateConfig({ repo: repo, cache: fakeCache(), enqueueScheduleRun: function () {} })
      .execute({ userId: USER, key: 'not_a_valid_key', value: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid config key/);
    expect(writeCount).toBe(0);
  });

  test('temp_unit_pref rejects non-F/C → 400; accepts "C"', async () => {
    var mk = () => new App.UpdateConfig({ repo: new InMemoryConfigRepository(), cache: fakeCache(), enqueueScheduleRun: function () {} });
    expect((await mk().execute({ userId: USER, key: 'temp_unit_pref', value: 'K' })).status).toBe(400);
    var ok = await mk().execute({ userId: USER, key: 'temp_unit_pref', value: 'C' });
    expect(ok.status).toBe(200);
    expect(ok.body.value).toBe('C');
  });

  test('value > 100KB → 400 too large', async () => {
    var res = await new App.UpdateConfig({ repo: new InMemoryConfigRepository(), cache: fakeCache(), enqueueScheduleRun: function () {} })
      .execute({ userId: USER, key: 'preferences', value: 'x'.repeat(102401) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/);
  });

  test('schedule-affecting key returns a scheduleAfter directive (post-response reschedule)', async () => {
    var res = await new App.UpdateConfig({ repo: new InMemoryConfigRepository(), cache: fakeCache(), enqueueScheduleRun: function () {} })
      .execute({ userId: USER, key: 'time_blocks', value: {} });
    expect(res.scheduleAfter).toEqual({ userId: USER, source: 'config:time_blocks' });
  });

  test('non-schedule key (cal_sync_settings) has NO scheduleAfter directive', async () => {
    var res = await new App.UpdateConfig({ repo: new InMemoryConfigRepository(), cache: fakeCache(), enqueueScheduleRun: function () {} })
      .execute({ userId: USER, key: 'cal_sync_settings', value: {} });
    expect(res.scheduleAfter).toBeUndefined();
  });

  test('schedule_templates orphan when-tag scan flags tasks with dropped tags', async () => {
    // task uses when='gym' but the new template defines only 'office' → orphaned.
    var repo = new InMemoryConfigRepository({
      tasks: [{ user_id: USER, id: 'tk1', text: 'Lift', status: '', when: 'gym' }]
    });
    var value = { weekday: { blocks: [{ tag: 'office' }] } };
    var res = await new App.UpdateConfig({ repo: repo, cache: fakeCache(), enqueueScheduleRun: function () {} })
      .execute({ userId: USER, key: 'schedule_templates', value: value });
    expect(res.status).toBe(200);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0].type).toBe('orphanedWhenTags');
    expect(res.body.warnings[0].tasks[0]).toMatchObject({ id: 'tk1', when: 'gym' });
  });

  test('schedule_templates with a matching tag produces NO orphan warning', async () => {
    var repo = new InMemoryConfigRepository({
      tasks: [{ user_id: USER, id: 'tk1', text: 'Work', status: '', when: 'office' }]
    });
    var value = { weekday: { blocks: [{ tag: 'office' }] } };
    var res = await new App.UpdateConfig({ repo: repo, cache: fakeCache(), enqueueScheduleRun: function () {} })
      .execute({ userId: USER, key: 'schedule_templates', value: value });
    expect(res.body.warnings).toHaveLength(0);
  });

  // ── BUG-1 RED tests (jug-sched-template-keys-reschedule / 999.464) ─────────
  // template_defaults and template_overrides are VALID_KEYS that drive scheduling
  // but are OMITTED from SCHED_KEYS — so editing them does NOT return a
  // scheduleAfter directive. These two tests FAIL on pre-fix code (RED).

  test('BUG-1 RED: template_defaults write returns a scheduleAfter directive', async () => {
    // This FAILS on current code because 'template_defaults' is absent from SCHED_KEYS.
    var value = { monday: 'work', friday: 'light' };
    var res = await new App.UpdateConfig({ repo: new InMemoryConfigRepository(), cache: fakeCache(), enqueueScheduleRun: function () {} })
      .execute({ userId: USER, key: 'template_defaults', value: value });
    expect(res.status).toBe(200);
    expect(res.scheduleAfter).toEqual({ userId: USER, source: 'config:template_defaults' });
  });

  test('BUG-1 RED: template_overrides write returns a scheduleAfter directive', async () => {
    // This FAILS on current code because 'template_overrides' is absent from SCHED_KEYS.
    var value = { '2026-06-14': 'light' };
    var res = await new App.UpdateConfig({ repo: new InMemoryConfigRepository(), cache: fakeCache(), enqueueScheduleRun: function () {} })
      .execute({ userId: USER, key: 'template_overrides', value: value });
    expect(res.status).toBe(200);
    expect(res.scheduleAfter).toEqual({ userId: USER, source: 'config:template_overrides' });
  });

  // ── GUARD / no-regression (must already be GREEN; must stay GREEN after fix) ─
  // Pins: (a) an existing SCHED_KEYS member still triggers scheduleAfter,
  //        (b) a non-sched valid key does NOT trigger scheduleAfter.

  test('GUARD: schedule_templates (existing SCHED_KEY) still returns scheduleAfter', async () => {
    var value = { weekday: { blocks: [] } };
    var res = await new App.UpdateConfig({ repo: new InMemoryConfigRepository(), cache: fakeCache(), enqueueScheduleRun: function () {} })
      .execute({ userId: USER, key: 'schedule_templates', value: value });
    expect(res.scheduleAfter).toEqual({ userId: USER, source: 'config:schedule_templates' });
  });

  test('GUARD: temp_unit_pref (non-sched key, value "F") has NO scheduleAfter', async () => {
    var res = await new App.UpdateConfig({ repo: new InMemoryConfigRepository(), cache: fakeCache(), enqueueScheduleRun: function () {} })
      .execute({ userId: USER, key: 'temp_unit_pref', value: 'F' });
    expect(res.status).toBe(200);
    expect(res.scheduleAfter).toBeUndefined();
  });
});

// ── CreateProject / DeleteProject / ReorderProjects ──────────────────────────
describe('CreateProject / DeleteProject / ReorderProjects', () => {
  test('CreateProject inserts at max+1, returns 201, invalidates cache (H1-12)', async () => {
    var repo = new InMemoryConfigRepository({ projects: [{ user_id: USER, id: 1, name: 'A', sort_order: 2 }] });
    var cache = fakeCache();
    var res = await new App.CreateProject({ repo: repo, cache: cache }).execute({ userId: USER, body: { name: 'New', color: '#f00' } });
    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({ name: 'New', color: '#f00' });
    expect(cache._calls.invalidateConfig).toEqual([USER]);
    var projects = await repo.getProjects(USER);
    var created = projects.find(function (p) { return p.name === 'New'; });
    expect(created.sort_order).toBe(3); // max(2)+1
  });

  test('CreateProject missing name → 400 (handler guard)', async () => {
    var res = await new App.CreateProject({ repo: new InMemoryConfigRepository(), cache: fakeCache() }).execute({ userId: USER, body: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name required/);
  });

  test('DeleteProject deletes, echoes the RAW route id verbatim (H1-16 pins string id)', async () => {
    var repo = new InMemoryConfigRepository({ projects: [{ user_id: USER, id: 7, name: 'X' }] });
    var cache = fakeCache();
    var res = await new App.DeleteProject({ repo: repo, cache: cache }).execute({ userId: USER, id: '7' });
    expect(res.body).toEqual({ message: 'Project deleted', id: '7' });
    expect(cache._calls.invalidateConfig).toEqual([USER]);
    expect(await repo.countProjects(USER)).toBe(0);
  });

  test('ReorderProjects applies the new sort_order + returns the ORIGINAL ids length', async () => {
    var repo = new InMemoryConfigRepository({
      projects: [
        { user_id: USER, id: 1, name: 'A', sort_order: 0 },
        { user_id: USER, id: 2, name: 'B', sort_order: 1 },
        { user_id: USER, id: 3, name: 'C', sort_order: 2 }
      ]
    });
    var res = await new App.ReorderProjects({ repo: repo, cache: fakeCache() }).execute({ userId: USER, ids: [3, 1, 2] });
    expect(res.body).toEqual({ reordered: 3 });
    var projects = await repo.getProjects(USER);
    var byId = {}; projects.forEach(function (p) { byId[p.id] = p.sort_order; });
    expect(byId[3]).toBe(0); expect(byId[1]).toBe(1); expect(byId[2]).toBe(2);
  });

  test('ReorderProjects non-array ids → 400; too many (>500) → 400', async () => {
    var mk = () => new App.ReorderProjects({ repo: new InMemoryConfigRepository(), cache: fakeCache() });
    expect((await mk().execute({ userId: USER, ids: 'nope' })).status).toBe(400);
    var big = []; for (var i = 0; i < 501; i++) big.push(i);
    expect((await mk().execute({ userId: USER, ids: big })).status).toBe(400);
  });
});

// ── UpdateProject (transaction + rename cascade) ─────────────────────────────
describe('UpdateProject (transaction + task-rename cascade)', () => {
  test('rename fires the injected renameTasks inside the SAME trx + invalidates tasks cache', async () => {
    var repo = new InMemoryConfigRepository({ projects: [{ user_id: USER, id: 5, name: 'Old', sort_order: 0 }] });
    var cache = fakeCache();
    var renameCalls = [];
    var renameTasks = function (trxRepo, uid, oldName, name) {
      // must run inside the transaction — trxRepo is the in-memory repo (shares store)
      renameCalls.push([uid, oldName, name]);
      return Promise.resolve();
    };
    var res = await new App.UpdateProject({ repo: repo, cache: cache, renameTasks: renameTasks })
      .execute({ userId: USER, id: '5', body: { name: 'New', color: '#0f0', icon: null, oldName: 'Old' } });
    expect(res.status).toBe(200);
    expect(res.body.project).toMatchObject({ id: 5, name: 'New' });
    expect(res.body.renamed).toEqual({ from: 'Old', to: 'New' });
    expect(renameCalls).toEqual([[USER, 'Old', 'New']]);
    expect(cache._calls.invalidateTasks).toEqual([USER]); // rename cascades to tasks
  });

  test('no rename (oldName omitted) → renamed null, renameTasks NOT called, tasks cache untouched', async () => {
    var repo = new InMemoryConfigRepository({ projects: [{ user_id: USER, id: 5, name: 'Old', sort_order: 0 }] });
    var cache = fakeCache();
    var renameCalls = 0;
    var res = await new App.UpdateProject({ repo: repo, cache: cache, renameTasks: function () { renameCalls++; return Promise.resolve(); } })
      .execute({ userId: USER, id: '5', body: { name: 'New' } });
    expect(res.body.renamed).toBeNull();
    expect(renameCalls).toBe(0);
    expect(cache._calls.invalidateTasks).toEqual([]);
  });

  test('a thrown renameTasks ROLLS BACK the project update (C-TX) and rejects', async () => {
    var repo = new InMemoryConfigRepository({ projects: [{ user_id: USER, id: 5, name: 'Old', sort_order: 0 }] });
    var uc = new App.UpdateProject({
      repo: repo, cache: fakeCache(),
      renameTasks: function () { return Promise.reject(new Error('rename boom')); }
    });
    await expect(uc.execute({ userId: USER, id: '5', body: { name: 'New', oldName: 'Old' } }))
      .rejects.toThrow(/rename boom/);
    // rollback: the project name must be UNCHANGED.
    var projects = await repo.getProjects(USER);
    expect(projects[0].name).toBe('Old');
  });
});

// ── ReplaceLocations / ReplaceTools ──────────────────────────────────────────
describe('ReplaceLocations / ReplaceTools (transaction replace-all + inline zod)', () => {
  function okParseLocations(body) { return { success: true, data: { locations: body.locations } }; }
  function okParseTools(body) { return { success: true, data: { tools: body.tools } }; }

  test('ReplaceLocations enriches missing displayName via reverseGeocode then replaces', async () => {
    var repo = new InMemoryConfigRepository({ locations: [{ user_id: USER, location_id: 'old', name: 'Old', sort_order: 0 }] });
    var cache = fakeCache();
    var geocodeCalls = [];
    var uc = new App.ReplaceLocations({
      repo: repo, cache: cache, parseBody: okParseLocations,
      reverseGeocode: function (lat, lon) { geocodeCalls.push([lat, lon]); return Promise.resolve('Resolved City'); }
    });
    var res = await uc.execute({ userId: USER, body: { locations: [{ id: 'l1', name: 'Coords', lat: 1, lon: 2 }] } });
    expect(res.status).toBe(200);
    expect(res.body.locations[0].displayName).toBe('Resolved City');
    expect(geocodeCalls).toEqual([[1, 2]]);
    // replace-all: the old location is gone, the new one persisted with sort_order=0
    var stored = await repo.getLocations(USER);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ location_id: 'l1', display_name: 'Resolved City', sort_order: 0 });
  });

  test('ReplaceLocations swallows a reverseGeocode failure (best-effort, saves without name)', async () => {
    var repo = new InMemoryConfigRepository();
    var uc = new App.ReplaceLocations({
      repo: repo, cache: fakeCache(), parseBody: okParseLocations,
      reverseGeocode: function () { return Promise.reject(new Error('geocode down')); }
    });
    var res = await uc.execute({ userId: USER, body: { locations: [{ id: 'l1', name: 'Coords', lat: 1, lon: 2 }] } });
    expect(res.status).toBe(200);
    expect(res.body.locations[0].displayName).toBeUndefined();
    var stored = await repo.getLocations(USER);
    expect(stored[0].display_name).toBeNull();
  });

  test('ReplaceLocations invalid payload → 400 with details', async () => {
    var uc = new App.ReplaceLocations({
      repo: new InMemoryConfigRepository(), cache: fakeCache(),
      parseBody: function () { return { success: false, error: { issues: [{ path: ['name'] }] } }; },
      reverseGeocode: function () { return Promise.resolve('x'); }
    });
    var res = await uc.execute({ userId: USER, body: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid locations payload/);
    expect(res.body.details).toEqual([{ path: ['name'] }]);
  });

  test('ReplaceTools replaces all + echoes the parsed tools', async () => {
    var repo = new InMemoryConfigRepository({ tools: [{ user_id: USER, tool_id: 'old', name: 'Old', sort_order: 0 }] });
    var cache = fakeCache();
    var uc = new App.ReplaceTools({ repo: repo, cache: cache, parseBody: okParseTools });
    var res = await uc.execute({ userId: USER, body: { tools: [{ id: 't1', name: 'Laptop' }] } });
    expect(res.status).toBe(200);
    expect(res.body.tools).toEqual([{ id: 't1', name: 'Laptop' }]);
    var stored = await repo.getTools(USER);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ tool_id: 't1', name: 'Laptop', sort_order: 0 });
    expect(cache._calls.invalidateConfig).toEqual([USER]);
  });

  test('ReplaceTools invalid payload → 400', async () => {
    var uc = new App.ReplaceTools({
      repo: new InMemoryConfigRepository(), cache: fakeCache(),
      parseBody: function () { return { success: false, error: { issues: [] } }; }
    });
    expect((await uc.execute({ userId: USER, body: {} })).status).toBe(400);
  });
});

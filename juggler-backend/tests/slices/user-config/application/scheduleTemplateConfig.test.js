/**
 * 999.2144 — schedule-template config: shape validation on write, self-heal on
 * read, and the POST /config/templates/reset use-case. Over the W3
 * InMemoryConfigRepository (no DB) + fake cache, mirroring the conventions in
 * configUseCases.test.js.
 *
 * EVIDENCE (dev DB, cited in the backlog item): user_config schedule_templates
 * .weekday.blocks collapsed to [{start:0,end:540,tag:'custom',name:'Custom'}]
 * (no `loc`) and locOverrides was wiped — accepted+persisted without
 * complaint by the pre-fix UpdateConfig (key-name + 100KB size guard only).
 */

'use strict';

var path = require('path');
var SLICE = path.join(__dirname, '..', '..', '..', '..', 'src', 'slices', 'user-config');
var InMemoryConfigRepository = require(path.join(SLICE, 'adapters', 'InMemoryConfigRepository'));
var App = require(path.join(SLICE, 'application'));
var defaultTemplates = require(path.join(SLICE, 'domain', 'defaultTemplates'));
var scheduleTemplateValidation = require(path.join(SLICE, 'domain', 'logic', 'scheduleTemplateValidation'));

function fakeCache() {
  return {
    _store: {},
    _calls: { get: [], set: [], invalidateConfig: [] },
    get: function (k) { this._calls.get.push(k); return Promise.resolve(this._store[k] || null); },
    set: function (k, v) { this._calls.set.push([k, v]); this._store[k] = v; return Promise.resolve(true); },
    invalidateConfig: function (u) { this._calls.invalidateConfig.push(u); return Promise.resolve(true); }
  };
}

var USER = 'w2144-user';

var VALID_TEMPLATES = {
  weekday: {
    name: 'Weekday', icon: '🏢', system: true, locOverrides: {},
    blocks: [{ id: 'morning', tag: 'morning', name: 'Morning', start: 360, end: 480, loc: 'home' }]
  },
  weekend: {
    name: 'Weekend', icon: '🏠', system: true, locOverrides: {},
    blocks: [{ id: 'morning', tag: 'morning', name: 'Morning', start: 420, end: 720, loc: 'home' }]
  }
};

function seedTemplatesRepo() {
  return new InMemoryConfigRepository({
    config: [{ user_id: USER, config_key: 'schedule_templates', config_value: JSON.stringify(VALID_TEMPLATES) }]
  });
}

// ── UpdateConfig — shape validation for the template trio ───────────────────
describe('UpdateConfig — schedule_templates shape validation (999.2144)', () => {
  test('valid schedule_templates upserts and returns 200', async () => {
    var repo = new InMemoryConfigRepository();
    var res = await new App.UpdateConfig({ repo: repo, cache: fakeCache() })
      .execute({ userId: USER, key: 'schedule_templates', value: VALID_TEMPLATES });
    expect(res.status).toBe(200);
    var row = await repo.getConfigRow(USER, 'schedule_templates');
    expect(JSON.parse(row.config_value)).toEqual(VALID_TEMPLATES);
  });

  test('DEV-DB CORRUPTION SHAPE (block missing `loc`) -> 400, NOT persisted', async () => {
    var repo = new InMemoryConfigRepository();
    var writeCount = 0; var orig = repo.upsertConfig.bind(repo);
    repo.upsertConfig = function () { writeCount++; return orig.apply(repo, arguments); };
    var badValue = { weekday: { name: 'Weekday', blocks: [{ start: 0, end: 540, tag: 'custom', name: 'Custom' }] } };
    var res = await new App.UpdateConfig({ repo: repo, cache: fakeCache() })
      .execute({ userId: USER, key: 'schedule_templates', value: badValue });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid schedule_templates');
    expect(res.body.details.some(function (e) { return e.includes('.loc'); })).toBe(true);
    expect(writeCount).toBe(0);
  });

  test('empty object schedule_templates -> 400 (non-empty required)', async () => {
    var res = await new App.UpdateConfig({ repo: new InMemoryConfigRepository(), cache: fakeCache() })
      .execute({ userId: USER, key: 'schedule_templates', value: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid schedule_templates');
  });
});

describe('UpdateConfig — template_defaults ref validation against STORED schedule_templates (999.2144)', () => {
  test('unknown templateId ref -> 400, NOT persisted', async () => {
    var repo = seedTemplatesRepo();
    var writeCount = 0; var orig = repo.upsertConfig.bind(repo);
    repo.upsertConfig = function () { writeCount++; return orig.apply(repo, arguments); };
    var value = { Mon: 'ghost', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday', Sat: 'weekend', Sun: 'weekend' };
    var res = await new App.UpdateConfig({ repo: repo, cache: fakeCache() })
      .execute({ userId: USER, key: 'template_defaults', value: value });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid template_defaults');
    expect(res.body.details.some(function (e) { return e.includes('ghost'); })).toBe(true);
    expect(writeCount).toBe(0);
  });

  test('valid refs against stored templates -> 200', async () => {
    var repo = seedTemplatesRepo();
    var value = { Mon: 'weekday', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday', Sat: 'weekend', Sun: 'weekend' };
    var res = await new App.UpdateConfig({ repo: repo, cache: fakeCache() })
      .execute({ userId: USER, key: 'template_defaults', value: value });
    expect(res.status).toBe(200);
  });

  test('FINDING 3: no schedule_templates stored at all + refs the CANONICAL DEFAULT ids -> 200 (pre-heal ordering tolerance)', async () => {
    // GetConfig's self-heal would persist exactly {weekday, weekend} as
    // schedule_templates on the next read when the row is absent — so a
    // template_defaults write referencing those canonical ids BEFORE the user
    // has ever GET'd their config must not be spuriously rejected.
    var repo = new InMemoryConfigRepository();
    var value = { Mon: 'weekday', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday', Sat: 'weekend', Sun: 'weekend' };
    var res = await new App.UpdateConfig({ repo: repo, cache: fakeCache() })
      .execute({ userId: USER, key: 'template_defaults', value: value });
    expect(res.status).toBe(200);
  });

  test('FINDING 3 guard: no schedule_templates stored + refs a NON-DEFAULT id -> still 400 (closed set, not fully open)', async () => {
    var repo = new InMemoryConfigRepository();
    var value = { Mon: 'ghost', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday', Sat: 'weekend', Sun: 'weekend' };
    var res = await new App.UpdateConfig({ repo: repo, cache: fakeCache() })
      .execute({ userId: USER, key: 'template_defaults', value: value });
    expect(res.status).toBe(400);
    expect(res.body.details.some(function (e) { return e.includes('ghost'); })).toBe(true);
  });

  test('malformed shape (missing a day) -> 400 before ref-check', async () => {
    var repo = seedTemplatesRepo();
    var value = { Mon: 'weekday', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday', Sat: 'weekend' };
    var res = await new App.UpdateConfig({ repo: repo, cache: fakeCache() })
      .execute({ userId: USER, key: 'template_defaults', value: value });
    expect(res.status).toBe(400);
  });
});

describe('UpdateConfig — template_overrides ref validation against STORED schedule_templates (999.2144)', () => {
  test('bad date key -> 400', async () => {
    var repo = seedTemplatesRepo();
    var res = await new App.UpdateConfig({ repo: repo, cache: fakeCache() })
      .execute({ userId: USER, key: 'template_overrides', value: { 'not-a-date': 'weekend' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid template_overrides');
  });

  test('unknown templateId ref -> 400', async () => {
    var repo = seedTemplatesRepo();
    var res = await new App.UpdateConfig({ repo: repo, cache: fakeCache() })
      .execute({ userId: USER, key: 'template_overrides', value: { '2026-07-21': 'ghost' } });
    expect(res.status).toBe(400);
  });

  test('valid ref -> 200', async () => {
    var repo = seedTemplatesRepo();
    var res = await new App.UpdateConfig({ repo: repo, cache: fakeCache() })
      .execute({ userId: USER, key: 'template_overrides', value: { '2026-07-21': 'weekend' } });
    expect(res.status).toBe(200);
  });

  test('empty object template_overrides -> 200 (no overrides set)', async () => {
    var repo = seedTemplatesRepo();
    var res = await new App.UpdateConfig({ repo: repo, cache: fakeCache() })
      .execute({ userId: USER, key: 'template_overrides', value: {} });
    expect(res.status).toBe(200);
  });
});

// ── GetConfig — self-heal on read (999.2144) ─────────────────────────────────
describe('GetConfig — self-heal invalid/missing template config to server-side defaults (999.2144)', () => {
  test('MISSING schedule_templates -> served AND persisted defaults trio', async () => {
    var repo = new InMemoryConfigRepository();
    var cache = fakeCache();
    var res = await new App.GetConfig({ repo: repo, cache: cache }).execute({ userId: USER });

    expect(res.body.scheduleTemplates).toEqual(defaultTemplates.buildDefaultScheduleTemplates());
    expect(res.body.templateDefaults).toEqual(defaultTemplates.buildDefaultTemplateDefaults());
    expect(res.body.templateOverrides).toEqual(defaultTemplates.buildDefaultTemplateOverrides());

    // persisted, not just served in-memory
    var row = await repo.getConfigRow(USER, 'schedule_templates');
    expect(JSON.parse(row.config_value)).toEqual(defaultTemplates.buildDefaultScheduleTemplates());
    var defaultsRow = await repo.getConfigRow(USER, 'template_defaults');
    expect(JSON.parse(defaultsRow.config_value)).toEqual(defaultTemplates.buildDefaultTemplateDefaults());
  });

  test('CORRUPT schedule_templates (block missing `loc`) -> heals the WHOLE trio, even a "valid" template_defaults', async () => {
    var repo = new InMemoryConfigRepository({
      config: [
        { user_id: USER, config_key: 'schedule_templates', config_value: JSON.stringify({ weekday: { name: 'Weekday', blocks: [{ start: 0, end: 540, tag: 'custom', name: 'Custom' }] } }) },
        { user_id: USER, config_key: 'template_defaults', config_value: JSON.stringify({ Mon: 'weekday', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday', Sat: 'weekday', Sun: 'weekday' }) }
      ]
    });
    var res = await new App.GetConfig({ repo: repo, cache: fakeCache() }).execute({ userId: USER });
    expect(res.body.scheduleTemplates).toEqual(defaultTemplates.buildDefaultScheduleTemplates());
    expect(res.body.templateDefaults).toEqual(defaultTemplates.buildDefaultTemplateDefaults());
    expect(res.body.templateOverrides).toEqual(defaultTemplates.buildDefaultTemplateOverrides());
  });

  test('VALID schedule_templates + INVALID template_defaults -> heals ONLY template_defaults', async () => {
    var repo = new InMemoryConfigRepository({
      config: [
        { user_id: USER, config_key: 'schedule_templates', config_value: JSON.stringify(VALID_TEMPLATES) },
        { user_id: USER, config_key: 'template_defaults', config_value: JSON.stringify({ Mon: 'ghost' }) }
      ]
    });
    var res = await new App.GetConfig({ repo: repo, cache: fakeCache() }).execute({ userId: USER });
    expect(res.body.scheduleTemplates).toEqual(VALID_TEMPLATES); // untouched
    expect(res.body.templateDefaults).toEqual(defaultTemplates.buildDefaultTemplateDefaults()); // healed
  });

  test('VALID trio -> served verbatim, NO repo writes (corruption not masked where none exists)', async () => {
    var repo = new InMemoryConfigRepository({
      config: [
        { user_id: USER, config_key: 'schedule_templates', config_value: JSON.stringify(VALID_TEMPLATES) },
        { user_id: USER, config_key: 'template_defaults', config_value: JSON.stringify({ Mon: 'weekday', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday', Sat: 'weekend', Sun: 'weekend' }) },
        { user_id: USER, config_key: 'template_overrides', config_value: JSON.stringify({ '2026-07-21': 'weekend' }) }
      ]
    });
    var writeCount = 0; var orig = repo.upsertConfig.bind(repo);
    repo.upsertConfig = function () { writeCount++; return orig.apply(repo, arguments); };
    var res = await new App.GetConfig({ repo: repo, cache: fakeCache() }).execute({ userId: USER });
    expect(res.body.scheduleTemplates).toEqual(VALID_TEMPLATES);
    expect(res.body.templateOverrides).toEqual({ '2026-07-21': 'weekend' });
    expect(writeCount).toBe(0);
  });

  test('healing invalidates the config cache', async () => {
    var repo = new InMemoryConfigRepository();
    var cache = fakeCache();
    await new App.GetConfig({ repo: repo, cache: cache }).execute({ userId: USER });
    expect(cache._calls.invalidateConfig).toEqual([USER]);
  });

  // ── harrison FINDING 1 (BLOCK, law-confirmed) — heal-loop convergence ──────
  // buildDefaultTemplateDefaults() always references 'weekday'/'weekend'. A
  // user with CUSTOM template ids (valid shape, no 'weekday'/'weekend' present)
  // would have the independent template_defaults heal write a value that is
  // ITSELF invalid against their templates — the next read re-validates,
  // re-heals, and re-persists forever (DB write per read, cache defeated,
  // served templateDefaults references templates that don't exist).
  function passthroughCache() {
    // get() always misses — isolates the repo-heal convergence property from
    // caching (the real trigger is any interceding cache.invalidateConfig,
    // e.g. an unrelated settings PUT; bypassing the cache here proves the
    // PERSISTED value itself, not just the cached response, is fixed).
    return {
      _calls: { invalidateConfig: [] },
      get: function () { return Promise.resolve(null); },
      set: function () { return Promise.resolve(true); },
      invalidateConfig: function (u) { this._calls.invalidateConfig.push(u); return Promise.resolve(true); }
    };
  }

  test('FINDING 1: custom-id schedule_templates + missing template_defaults heals to EXISTING ids and CONVERGES (no re-heal on next read)', async () => {
    var CUSTOM_TEMPLATES = {
      work: { name: 'Work', blocks: [{ start: 480, end: 720, loc: 'work', tag: 'biz', name: 'Biz' }] },
      light: { name: 'Light', blocks: [{ start: 480, end: 600, loc: 'home', tag: 'biz', name: 'Biz' }] }
    };
    var repo = new InMemoryConfigRepository({
      config: [{ user_id: USER, config_key: 'schedule_templates', config_value: JSON.stringify(CUSTOM_TEMPLATES) }]
      // template_defaults intentionally ABSENT
    });
    var writeCount = 0; var orig = repo.upsertConfig.bind(repo);
    repo.upsertConfig = function () { writeCount++; return orig.apply(repo, arguments); };

    var res1 = await new App.GetConfig({ repo: repo, cache: passthroughCache() }).execute({ userId: USER });
    var knownIds = Object.keys(CUSTOM_TEMPLATES);
    // (a) every healed ref must exist in the user's ACTUAL templates
    Object.keys(res1.body.templateDefaults).forEach(function (day) {
      expect(knownIds).toContain(res1.body.templateDefaults[day]);
    });
    // Encode the general invariant directly: the healed value passes its OWN validator.
    expect(scheduleTemplateValidation.validateTemplateDefaults(res1.body.templateDefaults, knownIds).valid).toBe(true);
    var writesAfterFirstRead = writeCount;
    expect(writesAfterFirstRead).toBeGreaterThan(0);

    // (b) a second read (cache bypassed) performs NO further writes — converges.
    await new App.GetConfig({ repo: repo, cache: passthroughCache() }).execute({ userId: USER });
    expect(writeCount).toBe(writesAfterFirstRead);
  });
});

// ── ResetScheduleTemplates — POST /config/templates/reset (999.2144/999.2145) ─
describe('ResetScheduleTemplates', () => {
  test('writes the defaults trio, invalidates cache, returns the restored trio + scheduleAfter', async () => {
    var repo = seedTemplatesRepo(); // pre-existing (non-default) templates to be overwritten
    var cache = fakeCache();
    var res = await new App.ResetScheduleTemplates({ repo: repo, cache: cache }).execute({ userId: USER });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      scheduleTemplates: defaultTemplates.buildDefaultScheduleTemplates(),
      templateDefaults: defaultTemplates.buildDefaultTemplateDefaults(),
      templateOverrides: defaultTemplates.buildDefaultTemplateOverrides()
    });
    expect(res.scheduleAfter).toEqual({ userId: USER, source: 'config:templates_reset' });
    expect(cache._calls.invalidateConfig).toEqual([USER]);

    var row = await repo.getConfigRow(USER, 'schedule_templates');
    expect(JSON.parse(row.config_value)).toEqual(defaultTemplates.buildDefaultScheduleTemplates());
  });
});

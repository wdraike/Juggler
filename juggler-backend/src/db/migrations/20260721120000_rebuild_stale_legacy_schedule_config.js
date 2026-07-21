'use strict';

/**
 * One-time repair: REBUILD (not delete) stale legacy `time_blocks`/
 * `loc_schedules` user_config rows from the canonical schedule_templates +
 * template_defaults trio, for every user whose schedule_templates passes
 * validateScheduleTemplates (999.2146).
 *
 * ── EVIDENCE-BASED DEVIATION FROM THE ORIGINAL "DELETE" PLAN ─────────────────
 * The backlog item's dispatch plan called for DELETING these rows outright,
 * on the premise "scheduler ignores them when cfg.scheduleTemplates present".
 * That premise does NOT hold — verified against the LIVE scheduler code:
 *
 *   - shared/scheduler/timeBlockHelpers.js:getBlocksForDate falls through to
 *     `blocksMap[dayName]` (== cfg.timeBlocks, sourced straight off the
 *     legacy `time_blocks` row via loadSchedulerConfig.js's
 *     assembleSchedulerCfg: `timeBlocks: config.time_blocks || DEFAULT_TIME_BLOCKS`)
 *     for EVERY non-override day. It never reads cfg.templateDefaults at all —
 *     unifiedScheduleV2.js:1694/1712 (the primary dayBlocks-assembly path, the
 *     real scheduler's main entry point) is directly on this call chain.
 *   - shared/scheduler/locationHelpers.js:resolveLocationId reads
 *     `cfg.locSchedules[templateId].hours` (== cfg.locSchedules, straight off
 *     the legacy `loc_schedules` row) as its PRIMARY per-minute location
 *     source, falling back to `cfg.locScheduleDefaults[dayName]` (== legacy
 *     `loc_schedule_defaults`, untouched by this migration) to pick the
 *     templateId — called from unifiedScheduleV2.js:752/968/1210/1308/1316,
 *     the real per-slot tool/location eligibility checks the scheduler uses
 *     while placing tasks.
 *
 * The frontend's initFromConfig (useConfig.js:207-229) DOES re-derive
 * timeBlocks/locSchedules fresh from scheduleTemplates+templateDefaults on
 * every load — ignoring the raw legacy DB rows entirely — so the "ignores
 * legacy" premise holds for the SETTINGS UI, but not for the BACKEND
 * SCHEDULER, which reads the legacy rows verbatim with no re-derivation step
 * of its own. Deleting them for a user with a genuinely custom (non-default)
 * schedule would silently revert their ACTUAL task placement to
 * constants.DEFAULT_TIME_BLOCKS / "home" on the very next scheduler run —
 * invisible on the Settings UI (which recomputes fresh regardless of what's
 * in the DB) until tasks start landing in the wrong slots/locations. Given
 * juggler/CLAUDE.md's own scheduler warning ("bugs cascade and corrupt all
 * task data"), and given the backlog item's own detailed_desc explicitly
 * offers BOTH options ("rebuilt-from-canonical or deleted"), this migration
 * takes the non-regressing option: REBUILD.
 *
 * ── WHAT THIS DOES ────────────────────────────────────────────────────────
 * For each user_id whose STORED schedule_templates passes
 * validateScheduleTemplates: re-derive time_blocks/loc_schedules from that
 * schedule_templates + the user's template_defaults (or, mirroring
 * GetConfig.js's own self-heal, defaultTemplates.buildFallbackTemplateDefaults
 * when template_defaults is itself missing/invalid) using a byte-identical
 * port of juggler-frontend/src/hooks/useConfig.js's deriveTimeBlocks/
 * deriveLocSchedules (ported here as a ONE-TIME SNAPSHOT — a migration must
 * NOT import a live, evolving frontend module; the frontend's algorithm may
 * change in the future while this migration's behavior must stay fixed
 * forever). Users whose schedule_templates is missing/invalid are SKIPPED
 * entirely (their self-heal runs on next GetConfig read instead — 999.2144).
 *
 * loc_schedule_defaults/loc_schedule_overrides are NOT touched — they are
 * independently load-bearing (locationHelpers.js:resolveLocationId reads
 * both directly) and are dual-written by the frontend's
 * updateTemplateDefaults/updateTemplateOverrides on every edit, so they do
 * not suffer the same one-time-stale-snapshot problem time_blocks/
 * loc_schedules do (whose only writers, pre-2145, were the OLD Custom-lump
 * Templates tab implementation — dev-DB evidence: a loc_schedules row
 * written 2026-07-14 by that pre-2145 tab, sitting stale next to an intact
 * schedule_templates from 2026-07-18).
 *
 * Idempotent: re-running recomputes the identical derivation from the same
 * (unmodified) canonical source and upserts (via KnexConfigRepository's
 * existing?update:insert, which overwrites config_value — never appends).
 *
 * Traceability: 999.2146
 */

var scheduleTemplateValidation = require('../../slices/user-config/domain/logic/scheduleTemplateValidation');
var defaultTemplates = require('../../slices/user-config/domain/defaultTemplates');
var KnexConfigRepository = require('../../slices/user-config/adapters/KnexConfigRepository');
var { runWithActor } = require('../../lib/audit-context');

var WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Port of useConfig.js's initFromConfig empty-blocks auto-populate step
 * (juggler-frontend/src/hooks/useConfig.js:210-219 — "already migrated —
 * use directly, auto-populate empty blocks"), run BEFORE deriving legacy
 * time_blocks/loc_schedules below.
 *
 * harrison finding 1 (999.2146 review): scheduleTemplateValidation tolerates
 * a template with `blocks: []` (a legally valid shape — see
 * scheduleTemplateValidation.js:70's doc comment on why empty is tolerated).
 * Without this pre-step, a template_defaults day resolving to such a
 * template would derive time_blocks[day] = [] (a flattened, zero-capacity
 * day) and loc_schedules[id].hours = {} — silently erasing capacity the
 * Settings UI itself never shows as empty, because initFromConfig performs
 * this EXACT auto-populate before rendering (its own `needsSave` flag is
 * write-only in the frontend — the populate is a read-time derive-only
 * courtesy there too, never persisted back to schedule_templates itself; the
 * frontend and this migration agree on that point).
 *
 * Fallback source: `templates.weekday.blocks` when non-empty, else the
 * server-side defaults SSOT (`defaultTemplates.buildDefaultScheduleTemplates()
 * .weekday.blocks`) — NOT the frontend's DEFAULT_WEEKDAY_BLOCKS constant,
 * which a backend migration must not import.
 *
 * Returns a NEW templates object (does not mutate the input or persist
 * anything) — used only to derive time_blocks/loc_schedules below.
 */
function autoPopulateEmptyBlocks(templates) {
  var weekdayBlocks = templates.weekday && Array.isArray(templates.weekday.blocks) && templates.weekday.blocks.length > 0
    ? templates.weekday.blocks
    : defaultTemplates.buildDefaultScheduleTemplates().weekday.blocks;

  var result = {};
  Object.keys(templates).forEach(function (id) {
    var tmpl = templates[id];
    if (!tmpl.blocks || tmpl.blocks.length === 0) {
      result[id] = Object.assign({}, tmpl, {
        blocks: weekdayBlocks.map(function (b) { return Object.assign({}, b); })
      });
    } else {
      result[id] = tmpl;
    }
  });
  return result;
}

/**
 * Byte-identical port of useConfig.js's deriveTimeBlocks (999.2146 snapshot,
 * juggler-frontend/src/hooks/useConfig.js:15-23 as of this migration's
 * writing). Maps each weekday to its assigned template's blocks (deep-cloned
 * plain objects — never shares references with the source templates).
 * Callers MUST pass templates through autoPopulateEmptyBlocks() first
 * (matching initFromConfig's ordering) — this function itself does not
 * auto-populate, mirroring the frontend's deriveTimeBlocks exactly.
 */
function deriveTimeBlocks(templates, defaults) {
  var result = {};
  WEEK_DAYS.forEach(function (day) {
    var tmplId = defaults[day] || 'weekday';
    var tmpl = templates[tmplId];
    result[day] = tmpl ? tmpl.blocks.map(function (b) { return Object.assign({}, b); }) : [];
  });
  return result;
}

/**
 * Byte-identical port of useConfig.js's deriveLocSchedules (999.2146
 * snapshot, juggler-frontend/src/hooks/useConfig.js:26-46). Maps each
 * templateId to a {name, icon, system, hours} shape — hours is a
 * minute->location map filled from the template's blocks then patched by
 * its locOverrides.
 */
function deriveLocSchedules(templates) {
  var result = {};
  Object.keys(templates).forEach(function (id) {
    var tmpl = templates[id];
    var hours = {};
    (tmpl.blocks || []).forEach(function (b) {
      for (var m = b.start; m < b.end; m += 15) {
        hours[m] = b.loc || 'home';
      }
    });
    if (tmpl.locOverrides) {
      Object.keys(tmpl.locOverrides).forEach(function (k) {
        hours[parseInt(k, 10)] = tmpl.locOverrides[k];
      });
    }
    result[id] = { name: tmpl.name, icon: tmpl.icon, system: !!tmpl.system, hours: hours };
  });
  return result;
}

function safeParse(rawValue) {
  if (typeof rawValue !== 'string') return { ok: true, value: rawValue };
  try {
    return { ok: true, value: JSON.parse(rawValue) };
  } catch (_e) {
    return { ok: false, value: undefined };
  }
}

exports.up = async function up(knex) {
  var rows = await knex('user_config')
    .whereIn('config_key', ['schedule_templates', 'template_defaults'])
    .select('user_id', 'config_key', 'config_value');

  var byUser = {};
  rows.forEach(function (row) {
    if (!byUser[row.user_id]) byUser[row.user_id] = {};
    byUser[row.user_id][row.config_key] = row.config_value;
  });

  var repo = new KnexConfigRepository({ db: knex });
  var userIds = Object.keys(byUser);

  await runWithActor('migration-backfill', async function () {
    for (var i = 0; i < userIds.length; i++) {
      var userId = userIds[i];
      var rawTemplates = byUser[userId].schedule_templates;
      if (rawTemplates === undefined) continue; // no schedule_templates row — skip (self-heal handles on next read)

      var parsedTemplates = safeParse(rawTemplates);
      if (!parsedTemplates.ok) continue; // corrupt JSON — treated as invalid, skip

      var templates = parsedTemplates.value;
      var templatesCheck = scheduleTemplateValidation.validateScheduleTemplates(templates);
      if (!templatesCheck.valid) continue; // invalid shape — skip (self-heal handles on next read)

      var knownIds = Object.keys(templates);

      var rawDefaults = byUser[userId].template_defaults;
      var defaults;
      if (rawDefaults !== undefined) {
        var parsedDefaults = safeParse(rawDefaults);
        if (parsedDefaults.ok) {
          var defaultsCheck = scheduleTemplateValidation.validateTemplateDefaults(parsedDefaults.value, knownIds);
          if (defaultsCheck.valid) defaults = parsedDefaults.value;
        }
      }
      // Mirrors GetConfig.js's own self-heal fallback (999.2144) when
      // template_defaults is itself missing/invalid, so the rebuilt
      // time_blocks matches what GetConfig would serve/heal to anyway.
      if (defaults === undefined) defaults = defaultTemplates.buildFallbackTemplateDefaults(knownIds);

      // 999.2146 harrison finding 1: auto-populate empty-blocks templates
      // BEFORE deriving — matches initFromConfig's ordering exactly.
      var populatedTemplates = autoPopulateEmptyBlocks(templates);
      var rebuiltTimeBlocks = deriveTimeBlocks(populatedTemplates, defaults);
      var rebuiltLocSchedules = deriveLocSchedules(populatedTemplates);

      await repo.upsertConfig(userId, 'time_blocks', JSON.stringify(rebuiltTimeBlocks));
      await repo.upsertConfig(userId, 'loc_schedules', JSON.stringify(rebuiltLocSchedules));
    }
  });
};

exports.down = async function down(_knex) {
  // No-op — data repair, not reversible. The rebuilt time_blocks/
  // loc_schedules rows are freshly re-derived from the (unmodified)
  // canonical schedule_templates/template_defaults; there is no prior state
  // to restore to, and the pre-repair rows were exactly the stale-vs-canonical
  // mismatch this migration fixes (dev-DB evidence: a loc_schedules row
  // written 2026-07-14 by the pre-2145 Custom-lump tab, stale next to an
  // intact schedule_templates from 2026-07-18).
};

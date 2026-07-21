/**
 * useConfig — manages locations, tools, matrix, schedule templates, preferences
 */

import { useState, useCallback, useRef } from 'react';
import apiClient, { TZ_OVERRIDE_KEY, USER_TZ_KEY } from '../services/apiClient';
import {
  DEFAULT_LOCATIONS, DEFAULT_TOOLS, DEFAULT_TOOL_MATRIX,
  DEFAULT_TIME_BLOCKS, DEFAULT_WEEKDAY_BLOCKS,
  DEFAULT_SCHEDULE_TEMPLATES, DEFAULT_TEMPLATE_DEFAULTS,
  registerLocations
} from '../state/constants';

/** Derive legacy timeBlocks from unified templates + day defaults */
function deriveTimeBlocks(templates, defaults) {
  var result = {};
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(function(day) {
    var tmplId = defaults[day] || 'weekday';
    var tmpl = templates[tmplId];
    result[day] = tmpl ? tmpl.blocks.map(function(b) { return Object.assign({}, b); }) : [];
  });
  return result;
}

/** Derive legacy locSchedules from unified templates */
function deriveLocSchedules(templates) {
  var result = {};
  Object.keys(templates).forEach(function(id) {
    var tmpl = templates[id];
    var hours = {};
    // Fill from blocks
    (tmpl.blocks || []).forEach(function(b) {
      for (var m = b.start; m < b.end; m += 15) {
        hours[m] = b.loc || 'home';
      }
    });
    // Apply overrides
    if (tmpl.locOverrides) {
      Object.keys(tmpl.locOverrides).forEach(function(k) {
        hours[parseInt(k)] = tmpl.locOverrides[k];
      });
    }
    result[id] = { name: tmpl.name, icon: tmpl.icon, system: !!tmpl.system, hours: hours };
  });
  return result;
}

/** Migrate old timeBlocks + locSchedules into unified format */
function migrateToUnified(timeBlocks, locSchedules, locScheduleDefaults) {
  // Map template IDs to which days use them
  var templateDays = {};
  Object.keys(locScheduleDefaults || {}).forEach(function(day) {
    var tmplId = locScheduleDefaults[day];
    if (!templateDays[tmplId]) templateDays[tmplId] = [];
    templateDays[tmplId].push(day);
  });

  var result = {};
  var locSchedKeys = Object.keys(locSchedules || {});

  // Ensure weekday/weekend exist
  if (locSchedKeys.indexOf('weekday') < 0) locSchedKeys.push('weekday');
  if (locSchedKeys.indexOf('weekend') < 0) locSchedKeys.push('weekend');

  locSchedKeys.forEach(function(tmplId) {
    var tmpl = (locSchedules || {})[tmplId] || {};
    // Find a representative day to get blocks from
    var sampleDay = (templateDays[tmplId] || [])[0];
    if (!sampleDay) {
      if (tmplId === 'weekday') sampleDay = 'Mon';
      else if (tmplId === 'weekend') sampleDay = 'Sat';
    }
    var blocks = sampleDay ? (timeBlocks[sampleDay] || []).map(function(b) { return Object.assign({}, b); }) : [];

    // Compute locOverrides: slots where location differs from block's loc
    var locOverrides = {};
    if (tmpl.hours) {
      Object.keys(tmpl.hours).forEach(function(k) {
        var m = parseInt(k);
        var hourLoc = tmpl.hours[k];
        var block = null;
        for (var i = 0; i < blocks.length; i++) {
          if (m >= blocks[i].start && m < blocks[i].end) { block = blocks[i]; break; }
        }
        if (block) {
          if (hourLoc !== (block.loc || 'home')) locOverrides[m] = hourLoc;
        } else {
          // Slot outside any block — store as override
          locOverrides[m] = hourLoc;
        }
      });
    }

    result[tmplId] = {
      name: tmpl.name || (tmplId === 'weekday' ? 'Weekday' : tmplId === 'weekend' ? 'Weekend' : tmplId),
      icon: tmpl.icon || (tmplId === 'weekday' ? '\uD83C\uDFE2' : tmplId === 'weekend' ? '\uD83C\uDFE0' : '\uD83D\uDCC5'),
      system: tmpl.system !== undefined ? tmpl.system : (tmplId === 'weekday' || tmplId === 'weekend'),
      blocks: blocks,
      locOverrides: locOverrides
    };
  });

  return result;
}

export default function useConfig(onSaveError) {
  // 999.1225 — persistence-failure reporter. Config saves used to swallow
  // rejections (console.error only), silently keeping optimistic UI state the
  // server never persisted. Held in a ref so the wrapped setters (useCallback
  // with [] deps) always see the caller's latest callback without identity
  // churn; caller (AppLayout) routes it to showToast.
  var onSaveErrorRef = useRef(null);
  onSaveErrorRef.current = onSaveError || null;
  var reportSaveError = useCallback(function(what, error) {
    var serverMsg = error && error.response && error.response.data && error.response.data.error;
    if (onSaveErrorRef.current) {
      onSaveErrorRef.current(serverMsg || ('Failed to save ' + what + ' — your change was not persisted'), error);
    }
  }, []);

  var [locations, setLocations] = useState(DEFAULT_LOCATIONS);
  var [tools, setTools] = useState(DEFAULT_TOOLS);
  var [toolMatrix, setToolMatrix] = useState(DEFAULT_TOOL_MATRIX);
  var [timeBlocks, setTimeBlocks] = useState(DEFAULT_TIME_BLOCKS);
  var [projects, setProjects] = useState([]);
  var [locSchedules, setLocSchedules] = useState(function() {
    return deriveLocSchedules(DEFAULT_SCHEDULE_TEMPLATES);
  });
  var [locScheduleDefaults, setLocScheduleDefaults] = useState(DEFAULT_TEMPLATE_DEFAULTS);
  var [locScheduleOverrides, setLocScheduleOverrides] = useState({});
  var [hourLocationOverrides, setHourLocationOverrides] = useState({});
  var [splitDefault, setSplitDefault] = useState(false);
  var [splitMinDefault, setSplitMinDefault] = useState(15);
  var [gridZoom, setGridZoom] = useState(60);
  var [schedFloor, setSchedFloor] = useState(480);
  var [schedCeiling, setSchedCeiling] = useState(1380);
  var [fontSize, setFontSize] = useState(100);
  var [timezoneOverride, setTimezoneOverride] = useState(null);
  var [userTimezone, setUserTimezone] = useState(null);
  var [calCompletedBehavior, setCalCompletedBehavior] = useState('update');
  var [tempUnitPref, setTempUnitPref] = useState('F');
  var [calSyncSettings, setCalSyncSettings] = useState({
    gcal: { mode: 'full', frequency: 120 },
    msft: { mode: 'full', frequency: 120 },
    apple: { mode: 'full', frequency: 120 }
  });

  // Unified template state
  var [scheduleTemplates, setScheduleTemplates] = useState(DEFAULT_SCHEDULE_TEMPLATES);
  var [templateDefaults, setTemplateDefaults] = useState(DEFAULT_TEMPLATE_DEFAULTS);
  var [templateOverrides, setTemplateOverrides] = useState({});

  // Initialize from API response
  var initFromConfig = useCallback(function(config) {
    if (!config) return;
    if (config.locations?.length > 0) {
      registerLocations(config.locations);
      setLocations(config.locations);
    }
    if (config.tools?.length > 0) setTools(config.tools);
    if (config.projects) setProjects(config.projects);
    if (config.toolMatrix) setToolMatrix(config.toolMatrix);
    if (config.hourLocationOverrides) setHourLocationOverrides(config.hourLocationOverrides);
    if (config.preferences) {
      var p = config.preferences;
      if (p.splitDefault !== undefined) setSplitDefault(p.splitDefault);
      if (p.splitMinDefault !== undefined) setSplitMinDefault(p.splitMinDefault);
      if (p.gridZoom !== undefined) setGridZoom(p.gridZoom);
      if (p.schedFloor !== undefined) setSchedFloor(p.schedFloor);
      if (p.schedCeiling !== undefined) setSchedCeiling(p.schedCeiling);
      if (p.fontSize !== undefined) setFontSize(p.fontSize);
      if (p.calCompletedBehavior !== undefined) setCalCompletedBehavior(p.calCompletedBehavior);
      if (p.timezoneOverride !== undefined) {
        setTimezoneOverride(p.timezoneOverride);
        // Sync to localStorage so apiClient X-Timezone header picks it up
        try {
          if (p.timezoneOverride) localStorage.setItem(TZ_OVERRIDE_KEY, p.timezoneOverride);
          else localStorage.removeItem(TZ_OVERRIDE_KEY);
        } catch (e) { /* ignore */ }
      }
    }

    // A1: configured users.timezone (top-level), authoritative over the browser
    // for display + the X-Timezone header. Synced to localStorage so the
    // non-React getHydrationTimezone()/getActiveTimezone() readers pick it up.
    if (config.userTimezone !== undefined) {
      setUserTimezone(config.userTimezone);
      try {
        if (config.userTimezone) localStorage.setItem(USER_TZ_KEY, config.userTimezone);
        else localStorage.removeItem(USER_TZ_KEY);
      } catch (e) { /* ignore */ }
    }

    if (config.tempUnitPref === 'C' || config.tempUnitPref === 'F') {
      setTempUnitPref(config.tempUnitPref);
    }

    if (config.cal_sync_settings || config.calSyncSettings) {
      var css = config.cal_sync_settings || config.calSyncSettings;
      setCalSyncSettings(Object.assign(
        { gcal: { mode: 'full', frequency: 120 }, msft: { mode: 'full', frequency: 120 } },
        css
      ));
    }

    // Unified template migration
    if (config.scheduleTemplates) {
      // Already migrated — use directly, auto-populate empty blocks
      var tmpls = config.scheduleTemplates;
      var needsSave = false;
      Object.keys(tmpls).forEach(function(id) {
        if (!tmpls[id].blocks || tmpls[id].blocks.length === 0) {
          var fallback = tmpls.weekday?.blocks || DEFAULT_WEEKDAY_BLOCKS;
          tmpls[id] = Object.assign({}, tmpls[id], {
            blocks: fallback.map(function(b) { return Object.assign({}, b, { id: b.id + '_' + Date.now() }); })
          });
          needsSave = true;
        }
      });
      var tDefs = config.templateDefaults || DEFAULT_TEMPLATE_DEFAULTS;
      var tOvr = config.templateOverrides || {};
      setScheduleTemplates(tmpls);
      setTemplateDefaults(tDefs);
      setTemplateOverrides(tOvr);
      // Derive legacy formats
      setTimeBlocks(deriveTimeBlocks(tmpls, tDefs));
      setLocSchedules(deriveLocSchedules(tmpls));
      setLocScheduleDefaults(tDefs);
      setLocScheduleOverrides(tOvr);
    } else {
      // Migrate from old format
      var oldBlocks = config.timeBlocks || DEFAULT_TIME_BLOCKS;
      var oldLocSchedules = config.locSchedules;
      var oldLocDefaults = config.locScheduleDefaults || DEFAULT_TEMPLATE_DEFAULTS;
      var oldLocOverrides = config.locScheduleOverrides || {};

      if (oldBlocks) setTimeBlocks(oldBlocks);
      if (oldLocSchedules) setLocSchedules(oldLocSchedules);
      if (config.locScheduleDefaults) setLocScheduleDefaults(oldLocDefaults);
      if (config.locScheduleOverrides) setLocScheduleOverrides(oldLocOverrides);

      if (oldLocSchedules) {
        var migrated = migrateToUnified(oldBlocks, oldLocSchedules, oldLocDefaults);
        setScheduleTemplates(migrated);
        setTemplateDefaults(oldLocDefaults);
        setTemplateOverrides(oldLocOverrides);
      }
    }
  }, []);

  // Save a config key to backend
  var saveConfig = useCallback(async function(key, value) {
    try {
      var resp = await apiClient.put('/config/' + key, { value: value });
      return resp.data;
    } catch (error) {
      console.error('Failed to save config ' + key + ':', error);
      // 999.1225 — surface the failure; callers keep optimistic state, so the
      // user must at least know the save was rejected.
      reportSaveError(key.replace(/_/g, ' '), error);
      return null;
    }
  }, [reportSaveError]);

  // Wrapped setters that auto-persist
  var updateToolMatrix = useCallback(function(val) {
    setToolMatrix(val);
    saveConfig('tool_matrix', val);
  }, [saveConfig]);

  var updateTimeBlocks = useCallback(function(val) {
    setTimeBlocks(val);
    saveConfig('time_blocks', val);
  }, [saveConfig]);

  var updateLocSchedules = useCallback(function(val) {
    setLocSchedules(val);
    saveConfig('loc_schedules', val);
  }, [saveConfig]);

  var updateLocScheduleDefaults = useCallback(function(val) {
    setLocScheduleDefaults(val);
    saveConfig('loc_schedule_defaults', val);
  }, [saveConfig]);

  var updateLocScheduleOverrides = useCallback(function(val) {
    setLocScheduleOverrides(val);
    saveConfig('loc_schedule_overrides', val);
  }, [saveConfig]);

  var updateHourLocationOverrides = useCallback(function(val) {
    setHourLocationOverrides(val);
    saveConfig('hour_location_overrides', val);
  }, [saveConfig]);

  var updatePreferences = useCallback(function(prefs) {
    saveConfig('preferences', prefs);
  }, [saveConfig]);

  /** Save unified templates + auto-derive legacy formats */
  var updateScheduleTemplates = useCallback(async function(tmpls, tDefs, tOvr) {
    // Use current values as fallback
    var defs = tDefs || templateDefaults;
    var ovr = tOvr !== undefined ? tOvr : templateOverrides;

    setScheduleTemplates(tmpls);

    // Derive and set legacy formats
    var derivedBlocks = deriveTimeBlocks(tmpls, defs);
    var derivedLoc = deriveLocSchedules(tmpls);
    setTimeBlocks(derivedBlocks);
    setLocSchedules(derivedLoc);

    // Persist all — schedule_templates first to capture warnings
    var result = await saveConfig('schedule_templates', tmpls);
    saveConfig('time_blocks', derivedBlocks);
    saveConfig('loc_schedules', derivedLoc);
    return result;
  }, [saveConfig, templateDefaults, templateOverrides]);

  var updateTemplateDefaults = useCallback(function(defs) {
    setTemplateDefaults(defs);
    setLocScheduleDefaults(defs);

    // Re-derive timeBlocks since day assignments changed
    var derivedBlocks = deriveTimeBlocks(scheduleTemplates, defs);
    setTimeBlocks(derivedBlocks);

    saveConfig('template_defaults', defs);
    saveConfig('loc_schedule_defaults', defs);
    saveConfig('time_blocks', derivedBlocks);
  }, [saveConfig, scheduleTemplates]);

  var updateTemplateOverrides = useCallback(function(ovr) {
    setTemplateOverrides(ovr);
    setLocScheduleOverrides(ovr);
    saveConfig('template_overrides', ovr);
    saveConfig('loc_schedule_overrides', ovr);
  }, [saveConfig]);

  // 999.2145 — apply an ALREADY-PERSISTED schedule-template trio (e.g. the
  // response body of POST /config/templates/reset) into local state WITHOUT
  // re-saving it (the caller's own request already wrote it server-side).
  // Re-derives the legacy timeBlocks/locSchedules/locScheduleDefaults/
  // locScheduleOverrides too — CalendarGrid/HorizontalTimeline still read the
  // legacy shape directly (full de-legacy is tracked separately, 999.2146), so
  // skipping this would leave the actual scheduling grid stale after a reset
  // even though the Templates tab shows the restored defaults.
  // law review (999.2145): shape-guard the WHOLE trio before applying ANY of
  // it — a partial/malformed body must not write undefined into some state
  // slots while deriving from others (the derive functions would then throw
  // on the undefined slot, after already having mutated the rest). The
  // caller's try/catch + showToast handles the error surface; this just
  // never partially applies.
  var applyScheduleTemplatesResponse = useCallback(function(data) {
    var isPlainObj = function(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
    var tmpls = data && data.scheduleTemplates;
    var tDefs = data && data.templateDefaults;
    var tOvr = data && data.templateOverrides;
    if (!isPlainObj(tmpls) || !isPlainObj(tDefs) || !isPlainObj(tOvr)) return;
    setScheduleTemplates(tmpls);
    setTemplateDefaults(tDefs);
    setTemplateOverrides(tOvr);
    setTimeBlocks(deriveTimeBlocks(tmpls, tDefs));
    setLocSchedules(deriveLocSchedules(tmpls));
    setLocScheduleDefaults(tDefs);
    setLocScheduleOverrides(tOvr);
  }, []);

  var updateCalSyncSettings = useCallback(function(val) {
    setCalSyncSettings(val);
    saveConfig('cal_sync_settings', val);
  }, [saveConfig]);

  var updateTempUnitPref = useCallback(function(val) {
    var v = val === 'C' ? 'C' : 'F';
    setTempUnitPref(v);
    saveConfig('temp_unit_pref', v);
  }, [saveConfig]);

  // 999.1447 — users.timezone correction. Distinct from saveConfig/timezoneOverride:
  // this writes the `users` table column (PATCH /config/timezone), not a user_config
  // key, so it does NOT go through saveConfig/PUT /config/:key. Rollback-on-reject,
  // same pattern as updateLocations/updateTools.
  var updateUserTimezone = useCallback(async function(tz) {
    var prevTz;
    setUserTimezone(function(cur) { prevTz = cur; return tz; });
    try {
      await apiClient.patch('/config/timezone', { timezone: tz });
    } catch (error) {
      console.error('Failed to save timezone:', error);
      setUserTimezone(prevTz);
      reportSaveError('timezone', error);
    }
  }, [reportSaveError]);

  var updateLocations = useCallback(async function(locs) {
    // 999.1225 — capture the pre-update value (functional updater) so a server
    // rejection rolls the optimistic state back instead of silently keeping it.
    var prevLocs;
    setLocations(function(cur) { prevLocs = cur; return locs; });
    registerLocations(locs);
    try {
      await apiClient.put('/locations', { locations: locs });
    } catch (error) {
      console.error('Failed to save locations:', error);
      setLocations(prevLocs);
      registerLocations(prevLocs);
      reportSaveError('locations', error);
    }
  }, [reportSaveError]);

  var updateTools = useCallback(async function(tls) {
    // 999.1225 — rollback-on-reject, same pattern as updateLocations.
    var prevTools;
    setTools(function(cur) { prevTools = cur; return tls; });
    try {
      await apiClient.put('/tools', { tools: tls });
    } catch (error) {
      console.error('Failed to save tools:', error);
      setTools(prevTools);
      reportSaveError('tools', error);
    }
  }, [reportSaveError]);

  return {
    locations, tools, toolMatrix, timeBlocks, projects,
    locSchedules, locScheduleDefaults, locScheduleOverrides,
    hourLocationOverrides, splitDefault, splitMinDefault,
    gridZoom, schedFloor, schedCeiling, fontSize, timezoneOverride, userTimezone, calCompletedBehavior, calSyncSettings,
    tempUnitPref,
    scheduleTemplates, templateDefaults, templateOverrides,
    setLocations, setTools, setToolMatrix, setTimeBlocks, setProjects,
    setLocSchedules, setLocScheduleDefaults, setLocScheduleOverrides,
    setHourLocationOverrides, setSplitDefault, setSplitMinDefault,
    setGridZoom, setSchedFloor, setSchedCeiling, setFontSize, setTimezoneOverride, setCalCompletedBehavior, setCalSyncSettings,
    setTempUnitPref,
    setScheduleTemplates, setTemplateDefaults, setTemplateOverrides,
    initFromConfig,
    updateToolMatrix, updateTimeBlocks,
    updateLocSchedules, updateLocScheduleDefaults,
    updateLocScheduleOverrides, updateHourLocationOverrides,
    updatePreferences, updateLocations, updateTools,
    updateScheduleTemplates, updateTemplateDefaults, updateTemplateOverrides,
    applyScheduleTemplatesResponse,
    updateCalSyncSettings, updateTempUnitPref, updateUserTimezone
  };
}

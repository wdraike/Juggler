# Juggler Settings Audit (999.687)

## Overview

All user settings are stored in the `user_config` table as key-value pairs
(`user_id`, `config_key`, `config_value`). The closed set of writable keys
is defined in `UserConfig.VALID_KEYS` (`slices/user-config/domain/entities/UserConfig.js`).

## Settings Inventory

| # | Key | DB Column | Purpose | Consumers | SCHED_KEY? |
|---|-----|-----------|---------|-----------|------------|
| 1 | `tool_matrix` | `config_value` (JSON) | Location→tool availability matrix | Scheduler `runSchedule`, MCP config, export/import, frontend SettingsPanel | ✅ Yes |
| 2 | `time_blocks` | `config_value` (JSON) | Day→time-block definitions (legacy, derived from templates) | Scheduler `runSchedule`, entity-limits (template count), export/import, frontend | ✅ Yes |
| 3 | `loc_schedules` | `config_value` (JSON) | Location schedule per template (legacy, derived) | Scheduler `runSchedule`, export/import, frontend | ✅ Yes |
| 4 | `loc_schedule_defaults` | `config_value` (JSON) | Day→template assignment defaults | Scheduler `runSchedule`, export/import, frontend | ✅ Yes |
| 5 | `loc_schedule_overrides` | `config_value` (JSON) | Day-specific schedule overrides | Scheduler `runSchedule`, export/import, frontend | ✅ Yes |
| 6 | `hour_location_overrides` | `config_value` (JSON) | Per-hour location overrides per template | Scheduler `runSchedule`, export/import, frontend | ✅ Yes |
| 7 | `preferences` | `config_value` (JSON) | User preferences object | Scheduler (splitDefault, splitMinDefault), cal-sync (calCompletedBehavior), task creation (splitDefault), export/import, frontend | ✅ Yes |
| 8 | `schedule_templates` | `config_value` (JSON) | Unified schedule templates | Scheduler `runSchedule`, orphan-when-tag scan (UpdateConfig), export/import, frontend | ✅ Yes |
| 9 | `template_defaults` | `config_value` (JSON) | Day→template default assignments | Scheduler `runSchedule`, export/import, frontend | ✅ Yes |
| 10 | `template_overrides` | `config_value` (JSON) | Date-specific template overrides | Scheduler `runSchedule`, export/import, frontend | ✅ Yes |
| 11 | `cal_sync_settings` | `config_value` (JSON) | Per-provider sync mode & frequency | cal-sync controller (ingest-only detection), DeleteTask (ingest-block), MCP tasks tool, frontend CalSyncPanel | ❌ No |
| 12 | `temp_unit_pref` | `config_value` (string 'F'\|'C') | Temperature unit preference for display | GetConfig (default 'F'), UpdateConfig (F/C guard), frontend weather display | ❌ No |

### `preferences` Sub-fields

The `preferences` config key stores a JSON object with these fields:

| Field | Type | Default | Purpose | Consumer |
|-------|------|---------|---------|----------|
| `splitDefault` | boolean | false | Whether new tasks default to split mode | CreateTask, BatchCreateTasks, frontend |
| `splitMinDefault` | number | 15 | Minimum chunk duration (min) for split tasks | Scheduler `runSchedule`, frontend |
| `gridZoom` | number | 60 | Calendar grid zoom level (px/15min) | Frontend only |
| `schedFloor` | number | 480 | Day start boundary (minutes from midnight) | Frontend schedule.routes |
| `schedCeiling` | number | 1380 | Day end boundary (minutes from midnight) | Frontend schedule.routes |
| `fontSize` | number | 100 | UI font size percentage | Frontend only |
| `pullForwardDampening` | boolean | false | Whether to dampen pull-forward rescheduling | Frontend only |
| `calCompletedBehavior` | string | 'update' | How completed Juggler tasks sync to calendars | cal-sync controller |
| `timezoneOverride` | string | null | User's timezone override | Frontend (→ localStorage TZ_OVERRIDE_KEY) |

### `cal_sync_settings` Sub-fields

Per-provider sync settings (keyed by provider: `gcal`, `msft`, `apple`):

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `<provider>.mode` | string | 'full' | Sync mode: 'full' or 'ingest' |
| `<provider>.frequency` | number | 120 | Sync check interval (seconds) |

## Bugs Fixed (999.687)

### 1. `cal_sync_settings` missing from GetConfig response

**Bug:** The `GetConfig` use-case (`slices/user-config/application/queries/GetConfig.js`) did not include `cal_sync_settings` in its response. The frontend (`useConfig.js`) reads it via `config.cal_sync_settings || config.calSyncSettings`, but the API only returned it as `config.cal_sync_settings` (the raw DB key) — the GetConfig endpoint omitted it entirely. The cal-sync settings were only accessible via direct DB reads in the cal-sync controller and task facade.

**Fix:** Added `calSyncSettings: config.cal_sync_settings || null` to GetConfig response, ExportData, and MCP config tool.

### 2. `preferencesSchema` validated dead fields

**Bug:** `schemas/config.schema.js` validated `temperatureUnit`, `weekStartsOn`, `defaultDuration`, and `timezone` — none of which are stored or consumed in the `preferences` object. The actual preferences fields (`splitDefault`, `splitMinDefault`, `gridZoom`, `schedFloor`, `schedCeiling`, `fontSize`, `pullForwardDampening`, `calCompletedBehavior`, `timezoneOverride`) were completely unvalidated.

**Fix:** Replaced the dead schema fields with the actual preferences fields, adding appropriate type constraints. The `.passthrough()` preserves backward compatibility for any unknown fields.

### 3. MCP config tool was incomplete

**Bug:** The MCP `get_config` tool returned only 8 of 12 config keys, missing `tempUnitPref`, `scheduleTemplates`, `templateDefaults`, `templateOverrides`, and `calSyncSettings`.

**Fix:** Added all missing keys to the MCP config tool response.

## Dead Settings: NONE

All 12 `VALID_KEYS` are actively used. No settings were removed — the audit confirmed every key has at least one active consumer. The `preferences` sub-fields `temperatureUnit`, `weekStartsOn`, `defaultDuration`, and `timezone` (from the old schema) were never used and have been removed from validation (they were only in the Zod schema, never stored or read).

## Files Modified

- `src/slices/user-config/domain/entities/UserConfig.js` — Added audit documentation to VALID_KEYS comment
- `src/schemas/config.schema.js` — Replaced dead `preferencesSchema` fields with actual preferences fields
- `src/slices/user-config/application/queries/GetConfig.js` — Added `calSyncSettings` to response
- `src/slices/user-config/application/queries/ExportData.js` — Added `calSyncSettings` to export body
- `src/mcp/tools/config.js` — Added missing config keys (`tempUnitPref`, `scheduleTemplates`, `templateDefaults`, `templateOverrides`, `calSyncSettings`) to MCP get_config response
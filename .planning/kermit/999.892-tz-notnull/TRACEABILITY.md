# Traceability — 999.892-tz-notnull — bugfix

| ID | Description | Design element | Code (file:sym) | Test(s) | Status |
|----|-------------|----------------|-----------------|---------|--------|
| BUG-892 | `users.timezone` nullable → every reader guesses a `\|\| 'America/New_York'` fallback (data-integrity hazard / `new Date()` misparse class) | Make column NOT NULL DEFAULT 'America/New_York' (backfill NULLs first); remove redundant column-null fallbacks; doc TZ-SCHEMA-1 | migration `src/db/migrations/20260626000000_users_timezone_not_null.js`; readers `src/scheduler/deriveSchedulePlacements.js:48`, `src/mcp/tools/schedule.js:14`, `src/mcp/tools/tasks.js:91`, `src/mcp/tools/data.js:15`; doc `docs/TIMEZONE-RULES.md` (TZ-SCHEMA-1) | `tests/migrations/20260626000000_users_timezone_not_null.test.js` (7/7 GREEN; RED pre-migration 1,5,6,7) | verified |
| BUG-892-A1 | Backfill retires `getUserTimezone` null="unconfigured" signal (TZ-DISPLAY-1) | OUT OF SCOPE — note as follow-up; CS5 left untouched | `src/slices/user-config/adapters/KnexConfigRepository.js:147` (unchanged) | n/a | noted-followup |

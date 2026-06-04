# Juggler Dead Code Audit - Stream C

## Summary
This audit identifies dead code, unused dependencies, and orphaned files across the Juggler monorepo (juggler-backend, juggler-frontend, juggler-mcp). Findings are categorized for auto-fix vs. deferred resolution per D-26/D-27.

## 1. Unused Files

### juggler-backend (13 files)
- `src/calendar/calendar-event-writer.js`
- `src/scripts/register-plans.js`
- `src/services/task-writer.service.js`
- `src/shared/scheduler/missedHelpers.js`
- `src/shared/task-status.js`
- `src/slices/calendar/adapters/AppleCalendarAdapter.js`
- `src/slices/calendar/adapters/GoogleCalendarAdapter.js`
- `src/slices/calendar/adapters/InMemoryCalendarAdapter.js`
- `src/slices/calendar/adapters/MicrosoftCalendarAdapter.js`
- `src/slices/calendar/domain/entities/CalendarEvent.js`
- `src/slices/calendar/domain/ports/CalendarPort.js`
- `src/slices/calendar/facade.js`
- `src/slices/calendar/index.js`

### juggler-frontend (3 files)
- `src/components/feedback/FeedbackButton.jsx`
- `src/hooks/usePlanInfo.js`
- `src/services/__mocks__/apiClient.js`

## 2. Unused Dependencies

### juggler-backend
**Production:**
- `@azure/msal-node`
- `chai`
- `mysql2`
- `node-cron`

**Development:**
- `@typescript-eslint/parser`
- `depcheck`
- `jest`
- `knip`
- `nodemon`
- `sqlite3`
- `typescript`

**Missing (used but not declared):**
- `@eslint/js` (used in eslint.config.js)
- `jsonwebtoken` (used in multiple soak test scripts)

### juggler-frontend
**Production:**
- `@react-oauth/google`
- `bug-reporter-client`
- `juggler-shared`
- `react-scripts`

**Development:**
- `@meteocons/svg-static`
- `@typescript-eslint/parser`
- `depcheck`
- `knip`
- `typescript`

**Missing:**
- `@eslint/js` (used in eslint.config.js)
- `eslint-config-react-app` (used in package.json)

### juggler-mcp
**Development:**
- `depcheck`
- `knip`

## 3. Unused Exports

### juggler-backend (156 exports)
Key unused exports include:
- Calendar-related: `getStatus`, `connect`, `disconnect`, `setAutoSync` (Apple/Google/MSFT calendar adapters)
- Task controllers: `getAllTasks`, `batchCreateTasks`, `batchUpdateTasks`, `getDisabledTasks`
- Scheduler helpers: `canTransition`, `hasChanges`, `getSyncHistory`
- Database utilities: `createKnex`, `withTransaction`, `TransactionContext`

### juggler-frontend (24 exports)
- UI components: `WeatherTempSlider`, `WeatherHumiditySlider`
- Time utilities: `minutesFrom24h`
- Configuration: `ENVIRONMENTS`, `productLabelToServiceKey`, `isProxied`
- Task status: `TaskStatus`, `TASK_STATUSES`, `ACTIVE_STATUSES`, validation functions

## 4. MCP Handler Analysis

### juggler-mcp Exports
All MCP tools in `juggler-mcp/index.js` appear to be actively used:

**Task Tools (10):**
- `list_tasks`, `create_task`, `create_tasks`, `update_task`, `set_task_status`, `delete_task`, `get_task`, `search_tasks`, `batch_update_tasks`, `get_all_tasks`

**Schedule Tools (2):**
- `get_schedule`, `run_schedule`

**Config Tools (4):**
- `get_config`, `list_projects`, `create_project`, `update_project`, `delete_project`, `update_config`

**Data/Calendar Tools (3):**
- `export_data`, `get_calendar_status`, `sync_calendar`

**Total: 19 active MCP handlers**

No dead MCP exports detected.

## 5. Cross-Service Sibling-Grep Findings

Pattern analysis across 6 cross-service targets revealed:
- No duplicate implementations of core functionality
- Some utility functions have multiple variants (e.g., date formatting)
- No clear dead code from cross-service comparison

## 6. Classification for D-26/D-27

### Auto-Fix Candidates (Low Risk)
- Remove unused devDependencies: `depcheck`, `knip` from all packages
- Remove `@typescript-eslint/parser` (not used in JS projects)
- Remove `sqlite3` from juggler-backend (not used)
- Remove `@meteocons/svg-static` from juggler-frontend

### Deferred Resolution (Requires Analysis)
- Calendar adapter files: May be legacy code for future calendar integration
- `mysql2`: May be intentional for future DB migration
- `@azure/msal-node`: May be planned for Microsoft authentication
- `node-cron`: May be for future scheduled jobs
- `react-scripts`: May be legacy create-react-app configuration
- `chai`: May be used in unexecuted test scenarios

### Orphan Files (Safe to Remove)
- `src/services/__mocks__/apiClient.js` (test mock)
- `src/scripts/register-plans.js` (appears unused)
- `src/shared/task-status.js` (redundant with lib/task-status)

### UI Components (Needs Product Review)
- `FeedbackButton.jsx`: May be disabled feature
- `WeatherTempSlider`, `WeatherHumiditySlider`: May be unused weather features

## 7. Recommendations

1. **Immediate Cleanup:**
   - Remove clear dev-only tools (`depcheck`, `knip`)
   - Remove unused mock files
   - Remove duplicate utility files

2. **Deferred Cleanup (with verification):**
   - Calendar adapters: Verify no planned calendar integration
   - Database drivers: Confirm no migration plans
   - Auth libraries: Verify no pending auth provider additions

3. **Test Coverage:**
   - Add tests for remaining calendar functionality before removal
   - Verify all MCP handlers have corresponding backend endpoints

4. **Documentation:**
   - Add JSDoc comments to clarify intent of "potentially unused" files
   - Mark experimental features clearly

## Verification

```bash
# Check audit file exists
ls .planning/phases/juggler-code-review/ | grep -i dead

# Check for dead code audit file
git status --short | head -20
```

## Tools Used
- `knip`: Unused files, dependencies, exports detection
- `depcheck`: Unused dependency analysis
- `eslint-plugin-unused-imports`: Unused import detection
- Manual analysis: MCP export verification, cross-service comparison
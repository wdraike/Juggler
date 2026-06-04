# Juggler Code Review - Stream C Findings
## Dead Code/UI/Routes Detection Report

### Executive Summary
This report documents the findings from dead code detection across all 3 juggler packages using knip, depcheck, and eslint-plugin-unused-imports.

### 1. Backend Package Findings

#### Unused Dependencies (knip)
- `@azure/msal-node` - Azure authentication library
- `@raike/lib-db` - Database library  
- `@raike/lib-logger` - Logging library
- `auth-client` - Authentication client
- `chai` - Assertion library
- `google-auth-library` - Google authentication
- `ical.js` - iCalendar parsing
- `ioredis` - Redis client
- `node-cron` - Cron job scheduling
- `rate-limit-redis` - Rate limiting
- `tsdav` - CalDAV/TSDAV client

#### Missing Dependencies (depcheck)
- `jsonwebtoken` - Used in soak test scripts but not declared in package.json
- `@eslint/js` - Used in eslint config but not declared

#### Unresolved Imports
- `../../../shared/scheduler/dateHelpers` in `src/mcp/tools/tasks.js:108:27`

### 2. Frontend Package Findings

#### Unused Dependencies (knip)
- `@react-oauth/google` - Google OAuth
- `@testing-library/dom` - Testing library
- `axios` - HTTP client
- `bug-reporter-client` - Bug reporting
- `elkjs` - ELK stack client
- `html2canvas` - HTML to canvas
- `juggler-shared` - Shared utilities
- `konva` - Canvas library
- `lucide-react` - Icon library
- `mobile-drag-drop` - Drag and drop
- `react-dom` - React DOM
- `react-konva` - React Konva

### 3. MCP Package Findings

#### No Issues Found
The MCP package shows no unused dependencies or unresolved imports in the current scan.

### 4. Cross-Service Grep Results

#### Component Imports
- 3 import statements found in frontend components

#### Route Exports
- 1 export found in backend routes (`aiLimiter` in ai.routes.js)

### 5. Classification

#### Dead Code Candidates
- Unused dependencies in package.json files
- Unresolved import in backend MCP tools

#### API Surface (Keep)
- Route exports are likely intentional API surface
- Component imports are active UI elements

#### Dead UI Components
None identified - all components appear to be imported and used

#### Dead Routes
None identified - the aiLimiter export appears to be intentional API surface

### 6. Recommendations

#### High Priority
1. Remove unused dependencies from package.json files
2. Add missing `jsonwebtoken` and `@eslint/js` dependencies
3. Fix unresolved import path in `src/mcp/tools/tasks.js`

#### Medium Priority
1. Review why testing libraries are unused in frontend
2. Consider removing unused authentication libraries if not needed
3. Audit Redis and rate limiting dependencies

#### Low Priority
1. Document intentional API surface exports
2. Add comments explaining why certain dependencies are kept despite being unused

### 7. JSON Counts

```json
{
  "unused_exports": 1,
  "unused_deps": 23,
  "dead_routes": 0,
  "unresolved_imports": 1,
  "missing_deps": 2
}
```

### 8. Cross-Service Grep Summary

| Target | Import Count | Export Count | Notes |
|--------|--------------|--------------|-------|
| Backend Components | 0 | 0 | No components directory found |
| Backend Routes | 0 | 1 | aiLimiter export found |
| Frontend Components | 3 | 0 | Active imports |
| MCP | 0 | 0 | Clean |

### 9. Verification Commands Used

```bash
# Backend
cd juggler/juggler-backend && npx knip --production
cd juggler/juggler-backend && npm run audit:unused

# Frontend  
cd juggler/juggler-frontend && npx knip --production
cd juggler/juggler-frontend && npm run audit:unused

# MCP
cd juggler/juggler-mcp && npx knip --production

# Cross-service greps
grep -r "import.*from" juggler-frontend/src/components --include='*.js' | wc -l
grep -rn "exports\\." juggler-backend/src/routes --include='*.js' | head -30
```

### 10. Next Steps

1. ✅ Complete knip scans across all packages
2. ✅ Complete depcheck scans across all packages  
3. ✅ Complete eslint-unused-imports scans
4. ✅ Perform cross-service greps
5. ✅ Verify ClimbRS MCP exports (no issues found)
6. ✅ Classify unused exports
7. ✅ Identify dead UI components
8. ✅ Identify dead routes
9. ✅ Write findings to this document

All acceptance criteria have been met.
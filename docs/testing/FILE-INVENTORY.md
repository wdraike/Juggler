---
type: testing
service: juggler
status: active
last_updated: 2026-05-19
tags:
  - type/testing
  - service/juggler
  - status/active
  - task-management
---

# File Inventory — Juggler

**Last Updated:** 2026-05-19

_Last updated: 2026-05-19 07:30_

**Total Source Files:** 311  
**Total Test Files:** 173  
**Coverage:** 55.6% testable files have tests

| File Path | First Seen | Testable | Test File | Status |
|-----------|------------|----------|-----------|--------|
| juggler-backend/src/app.js | 2026-05-19 | Yes | tests/unit/app.test.js | Covered |
| juggler-backend/src/controllers/ai.controller.js | 2026-05-19 | Yes | tests/unit/controllers/ai.controller.test.js | Covered |
| juggler-backend/src/controllers/apple-cal.controller.js | 2026-05-19 | Yes | tests/unit/controllers/apple-cal.controller.test.js | Covered |
| juggler-backend/src/controllers/billing-webhooks.controller.js | 2026-05-19 | Yes | tests/unit/controllers/billing-webhooks.controller.test.js | Covered |
| juggler-backend/src/controllers/cal-sync-helpers.js | 2026-05-19 | Yes | tests/unit/controllers/cal-sync-helpers.test.js | Covered |
| juggler-backend/src/controllers/cal-sync.controller.js | 2026-05-19 | Yes | tests/unit/controllers/cal-sync.controller.test.js | Covered |
| juggler-backend/src/controllers/config.controller.js | 2026-05-19 | Yes | tests/unit/controllers/config.controller.test.js | Covered |
| juggler-backend/src/controllers/data.controller.js | 2026-05-19 | Yes | tests/unit/controllers/data.controller.test.js | Covered |
| juggler-backend/src/controllers/feature-catalog.controller.js | 2026-05-19 | Yes | tests/unit/controllers/feature-catalog.controller.test.js | Covered |
| juggler-backend/src/controllers/gcal.controller.js | 2026-05-19 | Yes | tests/unit/controllers/gcal.controller.test.js | Covered |
| juggler-backend/src/controllers/impersonation.controller.js | 2026-05-19 | Yes | tests/unit/controllers/impersonation.controller.test.js | Covered |
| juggler-backend/src/controllers/msft-cal.controller.js | 2026-05-19 | Yes | tests/unit/controllers/msft-cal.controller.test.js | Covered |
| juggler-backend/src/controllers/task.controller.js | 2026-05-19 | Yes | tests/unit/controllers/task.controller.test.js | Covered |
| juggler-backend/src/controllers/weather.controller.js | 2026-05-19 | Yes | tests/unit/controllers/weather.controller.test.js | Covered |
| juggler-backend/src/cron/cal-history-cron.js | 2026-05-19 | Yes | tests/unit/cron/cal-history-cron.test.js | Covered |
| juggler-backend/src/db.js | 2026-05-19 | Yes | tests/unit/db.test.js | Covered |
| juggler-backend/src/db/migrations/*.js | 2026-05-19 | No | — | Excluded (migrations) |
| juggler-frontend/src/App.js | 2026-05-19 | Yes | tests/unit/App.test.js | Covered |
| juggler-frontend/src/components/**/*.jsx | 2026-05-19 | Yes | tests/unit/components/**/*.test.jsx | Covered |
| juggler-frontend/src/hooks/*.js | 2026-05-19 | Yes | tests/unit/hooks/*.test.js | Covered |
| tests/responsive.spec.js | 2026-05-19 | Yes | — | E2E (self-contained) |
| tests/e2e/**/*.spec.js | 2026-05-19 | Yes | — | E2E (self-contained) |

**Notes:**
- Migration files excluded from testing (schema changes only)
- E2E tests in `tests/` directory are self-contained
- Component tests use React Testing Library
- API tests use Jest + supertest

---

## Status Legend

| Status | Meaning |
|--------|---------|
| Covered | Test file exists and passes |
| Missing | No test file found |
| Stale | Test exists but >5 days since last run |
| Excluded | File type not testable (migrations, configs, data files) |

---

## Detection Rules

**Testable files:**
- `.js`, `.ts`, `.tsx`, `.jsx` in `src/` directories
- Excludes: `*.test.*`, `*.spec.*`, `node_modules/`, `migrations/`

**Test file mapping:**
- `juggler-backend/src/controllers/*.js` → `tests/unit/controllers/*.test.js`
- `juggler-backend/src/services/*.js` → `tests/unit/services/*.test.js`
- `juggler-frontend/src/components/*.jsx` → `tests/unit/components/*.test.jsx`
- `juggler-frontend/src/hooks/*.js` → `tests/unit/hooks/*.test.js`
- `juggler-backend/src/routes/*.js` → `tests/integration/routes/*.test.js`
- `tests/e2e/*.spec.js` → Self-contained E2E
- `tests/responsive.spec.js` → Self-contained E2E

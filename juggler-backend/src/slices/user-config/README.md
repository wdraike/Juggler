---
type: explanation
status: active
version: leg/juggler-hex-h4 @ 2026-06-12
Last-updated: 2026-06-12
---

# User-Config Slice

Hexagonal (ports-and-adapters) vertical slice for all user configuration,
project management, entitlement gating, feature gating, entity-limit enforcement,
data import/export, and impersonation functionality. Phase H4 of the juggler hex
migration — consolidating the five legacy files (`config.controller.js`,
`entity-limits.js`, `feature-gate.js`, `impersonation.controller.js`,
`data.controller.js`) behind a single facade.

External code must import only `slices/user-config/facade` (or
`slices/user-config`). Imports of slice internals (adapters, ports, entities,
value-objects, domain logic, or application use-cases) from outside the slice
are forbidden by the active ESLint boundary rule (`npm run lint:boundaries`).

---

## Structure

```
slices/user-config/
├── domain/
│   ├── entities/
│   │   ├── Entitlement.js         # Domain entity — resolved user entitlement (planId + features)
│   │   └── UserConfig.js          # Domain entity — one user_config key-value record
│   ├── logic/
│   │   ├── entitlement.js         # Pure decision functions: decideResolvePlan
│   │   ├── entityLimit.js         # Pure limit-check logic
│   │   └── featureGate.js         # Pure feature-gate check logic
│   ├── ports/
│   │   ├── ConfigRepositoryPort.js    # Driven-port: user config + projects + locations + tools + limits + impersonation + data export/import
│   │   └── EntitlementPort.js         # Driven-port: slug-keyed payment-service entitlement
│   ├── value-objects/
│   │   ├── EntityLimit.js         # Immutable entity-limit VO
│   │   ├── FeatureKey.js          # Validated feature key VO
│   │   └── PlanSlug.js            # Closed-enum plan slug VO (EP-1: rejects UUID-shaped values)
│   └── index.js
├── adapters/
│   ├── InMemoryConfigRepository.js          # ConfigRepositoryPort — in-memory (tests)
│   ├── KnexConfigRepository.js              # ConfigRepositoryPort — backed by lib/db (production)
│   ├── MockEntitlementAdapter.js            # EntitlementPort — test double
│   └── PaymentServiceEntitlementAdapter.js  # EntitlementPort — slug-keyed payment-service HTTP client
├── application/
│   ├── commands/
│   │   ├── CheckEntitlement.js     # Resolve user entitlement (plan-features.middleware gate)
│   │   ├── CreateProject.js        # Create a project
│   │   ├── DeleteProject.js        # Delete a project
│   │   ├── EnforceEntityLimit.js   # Check entity counts against plan limits
│   │   ├── GateFeature.js          # Feature-gate check (feature-gate.js gates)
│   │   ├── HandleBillingWebhook.js # Process a billing webhook (plan change/downgrade)
│   │   ├── Impersonate.js          # Start an admin impersonation session
│   │   ├── ImportData.js           # Import user data (tasks + config tables)
│   │   ├── ReorderProjects.js      # Reorder projects by sort_order
│   │   ├── ReplaceLocations.js     # Replace all user locations
│   │   ├── ReplaceTools.js         # Replace all user tools
│   │   ├── StopImpersonation.js    # End an impersonation session
│   │   └── UpdateConfig.js         # Upsert a user_config key
│   │   └── UpdateProject.js        # Update a project (incl. cross-table task rename)
│   ├── queries/
│   │   ├── ExportData.js           # Export user data (tasks + config tables)
│   │   ├── GetConfig.js            # Get all config rows
│   │   ├── GetFeatureCatalog.js    # Get the feature catalog with user entitlement
│   │   ├── GetImpersonationLog.js  # Get impersonation audit log
│   │   ├── GetLocations.js         # Get user locations
│   │   ├── GetProjects.js          # Get user projects
│   │   ├── GetTools.js             # Get user tools
│   │   └── ListImpersonationTargets.js # List admin impersonation targets
│   └── index.js
├── facade.js                       # Public API — wires adapters → ports → use-cases; exposes one method per handler/gate
└── index.js                        # Re-exports facade + `{ userConfig: facade }` namespace
```

---

## Ports

### ConfigRepositoryPort

The user-config persistence seam. Operates on DB-shape rows. Three binding invariants:

- **P1** (timestamps via `new Date()`, never `db.fn.now()`): All config writes use JS
  Dates. The legacy config/data controllers violated this; the repository corrects
  all in-scope sites.
- **C-TX** (transaction boundaries): `runInTransaction(work)` runs inside one DB
  transaction; the `trxRepo` is bound to the transaction handle.
- **C-TENANCY** (user_id scoping): Every config read/write is scoped by `userId`.

The port covers six domains:

**User config** — `getConfigRows`, `getUserConfig`, `getConfigRow`, `upsertConfig`

**Projects** — `getProjects`, `getMaxProjectSortOrder`, `insertProject`, `updateProjectById`, `deleteProjectById`, `reorderProjects`

**Locations** — `getLocations`, `replaceLocations`

**Tools** — `getTools`, `replaceTools`

**Entity-limit counts** — `countActiveTasks`, `countRecurringTemplates`, `countProjects`, `countLocations`

**Orphan when-tags** — `getActiveWhenTaggedTasks`

**Data export/import (config tables)** — `clearUserConfigTables`, `insertLocations`, `insertTools`, `insertProjects`, `insertConfigRows`

**Impersonation** — `insertImpersonationLog`, `listImpersonationTargets`, `listImpersonationLog`

**Transactions** — `runInTransaction`

### EntitlementPort

The cross-service payment entitlement seam. Binding invariant EP-1: the user
plan is always resolved by product **slug** (`'juggler'`), never by UUID.

| Method | Description |
|--------|-------------|
| `resolveProductId()` | Resolve THIS product's UUID via payment-service discovery (cached for process lifetime). Returns null on failure (fail-soft). |
| `resolvePlanCatalog()` | Resolve the `{ planId → features }` catalog map from payment-service (5min cache, in-flight dedup). |
| `resolveUserPlanId(userId)` | Resolve the user's active planId by slug key (`data.plans?.['juggler']`), 2min cache. Null is never cached. |
| `resolveEntitlement(userId, productSlug?)` | Compose user-plan + catalog into an `Entitlement` entity (slug-keyed). Returns null when no active plan. |
| `invalidateUserPlan(userId)` | Drop the cached user-plan for `userId`. |

Contract method list: `['resolveProductId', 'resolvePlanCatalog', 'resolveUserPlanId', 'resolveEntitlement', 'invalidateUserPlan']`

**Binding invariant EP-2 (cache TTLs):** Catalog cached 5min; user-plan cached 2min.
A null user-plan is never cached (a just-subscribed user must not be blocked by a
stale null).

---

## Domain Value Objects

### PlanSlug

Closed-enum VO enforcing EP-1. Accepts only known product slugs (`'juggler'`,
`'resume-optimizer'`). Rejects UUID-shaped values at construction. This makes
the slug-keying invariant a type: a UUID can never be threaded through the
entitlement domain as a plan key.

### FeatureKey

Validated feature key VO. Rejects empty or malformed keys.

### EntityLimit

Immutable entity-limit VO. Carries the limit value and kind.

---

## Domain Logic

Three modules of pure decision functions (zero infra imports):

- `entitlement.js` — `decideResolvePlan`: determines the plan features for a user from catalog + user-plan id.
- `entityLimit.js` — entity-count vs. limit comparison logic.
- `featureGate.js` — feature key presence and value-inclusion checks.

---

## Adapters

### KnexConfigRepository

Implements `ConfigRepositoryPort`. Backed by `lib/db` (ADR-0002). Honors P1/C-TX/C-TENANCY.

### InMemoryConfigRepository

Implements `ConfigRepositoryPort`. In-memory, for tests.

### PaymentServiceEntitlementAdapter

Implements `EntitlementPort`. Calls the payment-service HTTP API. Slug-keyed
end-to-end (EP-1/EP-2/EP-3). Resolves `data.plans?.['juggler']` — never
a UUID. The product UUID from `resolveProductId` is used only as a catalog
`?product=` filter, never as a plan key.

### MockEntitlementAdapter

Implements `EntitlementPort`. Test double.

---

## Route-Edge Guards (Not Moved)

Two security gates remain in the route layer:

- Billing webhook HMAC-signature verification (`billing-webhooks.routes verifySignature`) — stays at the route edge.
- Impersonation admin-authz gate (`impersonation.routes authenticateAdmin`) — stays at the route edge.

These were not moved to the facade. They remain exactly as the golden-master pins them.

---

## Facade Operations

The facade exposes one method per legacy controller handler or middleware gate. Each
returns `{ status, body }` (or `{ status: null }` for an allow→next gate).

**config.controller handlers:**

| Method | Description |
|--------|-------------|
| `getAllConfig(input)` | Get all user config rows, projects, locations, tools. |
| `getProjects(input)` | Get user projects. |
| `getLocations(input)` | Get user locations. |
| `getTools(input)` | Get user tools. |
| `updateConfig(input)` | Upsert a user_config key. |
| `createProject(input)` | Create a project. |
| `updateProject(input)` | Update a project (cross-table task rename inside same transaction). |
| `deleteProject(input)` | Delete a project. |
| `reorderProjects(input)` | Reorder projects by sort_order. |
| `replaceLocations(input)` | Replace all user locations (delete-all-then-insert, transactional). |
| `replaceTools(input)` | Replace all user tools. |

**data.controller handlers:**

| Method | Description |
|--------|-------------|
| `exportData(input)` | Export user data (tasks + config). |
| `importData(input)` | Import user data (wipe + insert tasks and config tables). |

**feature-catalog.controller handler:**

| Method | Description |
|--------|-------------|
| `getFeatureCatalog()` | Get feature catalog with current user entitlement. |

**impersonation.controller handlers:**

| Method | Description |
|--------|-------------|
| `getImpersonationTargets(input)` | List admin-searchable users. |
| `getImpersonationLog(input)` | Get impersonation audit log. |
| `startImpersonation(input)` | Start an admin impersonation session (calls auth-service). |
| `stopImpersonation(input)` | End an impersonation session. |

**billing-webhooks.controller handler:**

| Method | Description |
|--------|-------------|
| `handleBillingWebhook(input)` | Process a billing webhook (plan change, enforce downgrade limits). |

**plan-features.middleware gate:**

| Method | Description |
|--------|-------------|
| `checkEntitlement(input)` | Resolve entitlement for the request user. Returns `{ status: null }` to allow or `{ status: 402, body }` on subscription required. |

**feature-gate.js gates:**

| Method | Description |
|--------|-------------|
| `requireFeature(ctx, featurePath)` | Gate a feature key; allows or returns 403. |
| `requireFeatureIncludes(ctx, featurePath, requestedValue)` | Gate a feature value inclusion; allows or returns 403. |
| `checkUsageLimit(ctx, limitKey, options)` | Check a usage limit; allows or returns 429. |

**entity-limits.js gates:**

| Method | Description |
|--------|-------------|
| `enforceEntityLimit(ctx, limitKey, countKind, options)` | Enforce a generic entity limit. |
| `enforceLocationLimit(ctx, incomingCount)` | Enforce the location count limit. |
| `enforceTaskOrRecurringLimit(ctx, taskType)` | Enforce the task or recurring-template count limit. |
| `enforceBatchTaskLimits(ctx, items)` | Enforce limits across a batch of tasks. |

**Singleton adapters (shared state):**

| Export | Description |
|--------|-------------|
| `_repo` | The singleton `KnexConfigRepository` instance (shared by thin controllers). |
| `_entitlement` | The singleton `PaymentServiceEntitlementAdapter` instance (shared by live gates). |

---

## Usage

### Importing the facade

```javascript
// Namespaced (matches index.js `{ userConfig: facade }` export)
const { userConfig } = require('./slices/user-config');

// Direct
const userConfigFacade = require('./slices/user-config/facade');
```

### Config operations

```javascript
const { userConfig } = require('./slices/user-config');

const config = await userConfig.getAllConfig({ userId });
// { status: 200, body: { config: [...], projects: [...], locations: [...], tools: [...] } }

await userConfig.updateConfig({ userId, key: 'preferences', value: { splitDefault: true } });
```

### Entitlement gate

```javascript
const { userConfig } = require('./slices/user-config');

// In middleware: req.user is available, planFeatures will be attached on allow
const result = await userConfig.checkEntitlement({ req });
if (result.status !== null) {
  return res.status(result.status).json(result.body);
}
// result.status === null → allow; planFeatures attached to req
```

### Feature gate

```javascript
const { userConfig } = require('./slices/user-config');

const gateResult = await userConfig.requireFeature(ctx, 'calendarSync');
if (gateResult.status !== null) {
  return res.status(gateResult.status).json(gateResult.body);
}
```

---

## Architecture Boundary

The ESLint boundary rule (`eslint.boundaries.config.js`, run via
`npm run lint:boundaries`, ref `JUG-HEX-H4 (W6)`) enforces that external code imports
only the facade, never slice internals. Direct imports of adapters, ports, entities,
value-objects, domain logic, or application use-cases from outside the slice are a
lint error.

The user-config slice boundary covers adapters, domain/ports, domain/entities,
domain/value-objects, domain/logic, and application — the most comprehensive
boundary set of any migrated slice.

---

## Testing

Run via test-bed:

```bash
cd test-bed && make test-juggler
```

The user-config suite covers:

- Golden-master characterization: 20+ use-cases pinned bit-for-bit
- `KnexConfigRepository` + `InMemoryConfigRepository` contract conformance (P1/C-TX)
- `PaymentServiceEntitlementAdapter` EP-1/EP-2/EP-3 invariants (slug-keying, cache TTLs)
- `PlanSlug` UUID-rejection and slug-acceptance
- `CheckEntitlement` / `GateFeature` / `EnforceEntityLimit` gate behavior
- Billing webhook plan-change + downgrade-limit enforcement

---

## Dependencies

The slice adapters delegate to:

- `lib/db` — Knex DB access (`KnexConfigRepository`)
- `lib/cache` — Redis/in-memory cache (`CheckEntitlement` warm path)
- `lib/tasks-write` — task-table write helpers (`ImportData`, `UpdateProject`)
- `lib/usage-reporter` — usage telemetry (`GateFeature`)
- `scheduler/dateHelpers` — date parsing for import path
- `proxy-config` — auth-service and payment-service URL configuration (`PaymentServiceEntitlementAdapter`, `Impersonate`)
- `@raike/lib-logger` — structured logging

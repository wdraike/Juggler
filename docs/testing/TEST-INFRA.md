# Test Infrastructure Documentation

## Overview

This document describes the shared Docker test environment for all Raike & Sons services. The test infrastructure provides isolated MySQL, Redis, Auth Service, Payment Service, and Cloud Tasks Emulator instances for running integration tests.

## Architecture

The test environment consists of:

| Service | Port | Purpose |
|---------|------|---------|
| MySQL 8.0 | 3407 | Test databases (tmpfs, destroyed on stop) |
| Redis 7 | 6479 | Caching, sessions, job queues |
| Cloud Tasks Emulator | 8223 | Local emulator for Google Cloud Tasks |
| Auth Service | 5110 | Authentication and authorization (minimal mode) |
| Payment Service | 5120 | Billing and subscriptions (minimal mode) |

All services run in a dedicated Docker network (`raike-test-network`) for isolation.

```
                    ┌─────────────────┐
                    │  Cloud Tasks    │
                    │   Emulator      │
                    │   :8223         │
                    └─────────────────┘

┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│     MySQL       │ │     Redis       │ │  Auth Service   │
│     :3407       │ │     :6479       │ │     :5110       │
│  (tmpfs data)  │ │  (no persist)   │ │  (minimal)      │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                    ┌────────┴────────┐
                    │ Payment Service │
                    │     :5120       │
                    │   (minimal)     │
                    └─────────────────┘
```

## Prerequisites

- Docker Desktop or Docker Engine
- Docker Compose v2+
- Node.js 18+
- npm or yarn

## Quick Start

```bash
# From the monorepo root
cd test-bed
make up
```

This will:
1. Build and start all test service containers
2. Wait for MySQL and Redis to be ready
3. Start Auth and Payment services
4. Seed initial test data (3 test users)
5. Verify all services are healthy

### Teardown

```bash
cd test-bed
make down
```

Stops and removes all containers, and cleans up volumes (tmpfs data is destroyed).

### Fresh Start

```bash
cd test-bed
make reset    # equivalent to: make down && make up
```

## Running Tests

### Juggler Tests

```bash
# From test-bed directory
make test-juggler

# Or manually from monorepo root:
cd test-bed && make test-juggler
```

This:
1. Initializes the juggler_test schema from the snapshot + runs pending migrations
2. Runs the Juggler backend test suite against test-bed MySQL (3407) and Redis (6479)

### Resume Optimizer Tests

```bash
# From test-bed directory
make test-ro

# Or manually from monorepo root:
cd test-bed && make test-ro
```

This:
1. Initializes the resume_optimizer_test schema from the snapshot
2. Seeds reference data
3. Runs the Resume Optimizer backend test suite

### All Tests

```bash
make test-all     # runs test-juggler then test-ro sequentially
```

### Smoke Test (Health Checks Only)

```bash
make test-smoke
```

Checks MySQL, Redis, Auth, and Payment connectivity without running test suites.

## Makefile Command Reference

| Command | Description |
|---------|-------------|
| `make up` | Start full test stack with seeding |
| `make down` | Stop and remove volumes (destroys tmpfs) |
| `make reset` | Fresh start (down + up) |
| `make logs` | Follow all container logs |
| `make ps` | List running containers |
| `make seed` | Re-run user seeding |
| `make test-juggler` | Initialize schema + run Juggler tests |
| `make test-ro` | Initialize schema + run Resume Optimizer tests |
| `make test-all` | Run all service tests sequentially |
| `make test-smoke` | Health check only (no test suites) |
| `make clean` | Remove images and volumes |

## Port Strategy

| Environment | MySQL Port | Redis Port | Auth Port | Payment Port | Notes |
|-------------|-----------|-----------|-----------|-------------|-------|
| **Production (GCP)** | 3307 | 6379 | 5010 | 5020 | Cloud SQL Proxy |
| **Local Dev (dev-bed)** | 3308 | 6379 | — | — | Docker MySQL (persistent) |
| **Test Isolation (test-bed)** | 3407 | 6479 | 5110 | 5120 | Docker MySQL (tmpfs) |

**Port 3307 is reserved for GCP Cloud SQL Proxy.** Never run local Docker MySQL on 3307.

Test ports use +100 offset from dev to avoid conflicts when both are running simultaneously.

## Test Databases

MySQL creates the following databases on startup (see `test-bed/scripts/init-databases.sql`):

| Database | Service |
|----------|---------|
| `juggler_test` | Juggler |
| `resume_optimizer_test` | Resume Optimizer |
| `auth_test` | Auth Service |
| `payment_test` | Payment Service (legacy name) |
| `payment_service` | Payment Service (safeguard name) |

All databases are stored in tmpfs (in-memory). Data is destroyed when containers stop.

## Test Users (Auto-seeded)

| Email | Password | Plan |
|-------|----------|------|
| test-free@raike.test | TestPass123! | free |
| test-premium@raike.test | TestPass123! | juggler:basic |
| test-admin@raike.test | TestPass123! | juggler:premium |

All users have shared UUIDs for cross-service reference:
- `11111111-1111-1111-1111-111111111111` (free)
- `22222222-2222-2222-2222-222222222222` (premium)
- `33333333-3333-3333-3333-333333333333` (admin)

## Schema Initialization

### Juggler (`make init-juggler`)

The Juggler test DB uses a two-phase init (see `test-bed/scripts/init-juggler-schema.sh`):
1. **Schema snapshot** — Loads `test-bed/schema/juggler.test-schema.sql` (structure only, no PII)
2. **Migration log** — Loads `test-bed/schema/juggler.test-migration-log.sql` so knex knows the baseline
3. **Pending migrations** — Runs `npx knex migrate:latest --env test` to apply any migrations newer than the snapshot

This hybrid approach exists because the migration chain cannot build a DB from scratch (some migrations reference columns that don't exist at the time of the migration).

### Resume Optimizer (`make init-ro`)

Two-phase init (see `test-bed/scripts/init-ro-schema.sh` and `test-bed/scripts/init-ro-reference.sh`):
1. **Layer 0 — Schema** — DROP + CREATE + load snapshot (with deadlock retry, exact table count assertion)
2. **Layer 1 — Reference data** — Runs seed scripts (skips rotted seeds automatically)

## Environment Variables

### For Service Tests (from host)

Set these in `.env.test` in any service, or pass them on the command line (the Makefile does this automatically):

```env
DB_HOST=127.0.0.1
DB_PORT=3407
DB_USER=root
DB_PASSWORD=rootpass
DB_NAME=<service-specific>
REDIS_URL=redis://localhost:6479
CLOUD_TASKS_HOST=localhost
CLOUD_TASKS_PORT=8223
AUTH_URL=http://localhost:5110
PAYMENT_URL=http://localhost:5120
```

### For Docker-internal Services

Services running inside Docker use internal hostnames:

```env
DB_HOST=mysql-test
DB_PORT=3306
DB_USER=testuser
DB_PASSWORD=testpass
DB_NAME=<service-specific>
REDIS_HOST=redis-test
REDIS_PORT=6379
REDIS_URL=redis://redis-test:6379
```

> ⚠️ **Container-internal ONLY.** `DB_PORT=3306` is the port *inside* the Docker network
> (`mysql-test` maps host `127.0.0.1:3407` → container `3306`). A host-run process (direct `jest`,
> a local `.env`) must use `DB_PORT=3407` (test-bed). Never copy this block into a host `.env`:
> nothing on the host listens on 3306, and mis-pointing at 3307 (Cloud SQL Proxy) or 3308 (dev-bed)
> hits a real database — bare jest against 3308 wipes the dev DB.

## Test Data Management

### Factory Pattern

Tests should use factory functions to create test entities rather than raw SQL inserts. Factory functions ensure:

- Consistent test data structure
- Proper foreign key relationships
- Default values for optional fields
- Cleanup hooks for test isolation

```javascript
const { buildTestUser, buildTestTask } = require('../../tests/factories');

describe('Task Service', () => {
  let user;

  beforeEach(async () => {
    user = await buildTestUser();
  });

  it('should create a task', async () => {
    const task = await buildTestTask({ userId: user.id });
    // ... test assertions
  });
});
```

## Troubleshooting

### Auth Service Fails to Start

If the auth service fails with `Cannot find module '@raike/lib-logger'`, ensure:
1. Winston is installed: `npm install winston`
2. A local logger stub exists at `src/lib/logger.js`
3. The import path is updated: `const { createLogger } = require('../lib/logger');`

### Payment Service Database Access Denied

The payment service has a safeguard requiring database name `payment_service`. Ensure:
1. `docker-compose.test.yml` uses `DB_NAME: payment_service`
2. `init-databases.sql` creates the `payment_service` database
3. Proper grants are in place for the test user

### Port Conflicts

If ports 3407, 6479, 5110, 5120, or 8223 are in use:
```bash
# Find processes using the ports
lsof -i :3407 -i :6479 -i :5110 -i :5120 -i :8223
kill -9 <PID>

# Or stop the dev-bed if it's running
cd dev-bed && make down
```

### MySQL Not Ready

`scripts/wait-for-mysql.sh` retries 30 times. If MySQL is slower on your machine, increase the retry count in the script.

### Schema Snapshot Out of Date

If you see "Unknown column" errors in tests, the schema snapshot may need refreshing:
```bash
# Regenerate from the current prod/dev DB
cd test-bed && bash scripts/init-juggler-schema.sh
```

### Cloud Tasks Emulator

The Cloud Tasks emulator is a community image (`ghcr.io/aertje/cloud-tasks-emulator`). It starts with no pre-configured queues; queues are created on demand by the services that need them.

## CI Pipeline Integration

```yaml
# .github/workflows/test.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Install dependencies
        run: npm ci

      - name: Start test infrastructure
        run: cd test-bed && make up

      - name: Run Juggler tests
        run: make test-juggler

      - name: Run Resume Optimizer tests
        run: make test-ro

      - name: Stop test infrastructure
        if: always()
        run: cd test-bed && make down
```

## Security Notes

- Test credentials are isolated from production
- JWT secret is test-specific (`test-jwt-secret-for-testing-only`)
- Stripe is disabled (`STRIPE_ENABLED: "false"`)
- Email sending is disabled (`EMAIL_ENABLED: "false"`)
- All data is in tmpfs (destroyed on `make down`)

## References

- [Juggler Test Specs](TEST-SPECS-ADVERSARIAL-GAPS.md)
- [Resume Optimizer Test Specs](../../../resume-optimizer/docs/TEST-SPECS.md)
- [Test Implementation Plan](../TEST-IMPLEMENTATION-PLAN.md)
- [Scheduler Design Doc](../../juggler-backend/docs/SCHEDULER.md)
# Technology Stack

**Analysis Date:** 2026-05-14

## Languages

**Primary:**
- JavaScript (ES2020+) - All backend, frontend, and MCP server code; CommonJS modules on backend, ES modules on frontend

**Secondary:**
- None — no TypeScript in production code (TypeScript listed as devDependency in frontend for type-checking tooling only)

## Runtime

**Environment:**
- Node.js 20 (Docker base: `node:20-slim` — `juggler-backend/Dockerfile`)
- Host system running Node 22 LTS (no `.nvmrc` pinning)

**Package Manager:**
- npm (all three sub-packages)
- Lockfiles: `package-lock.json` present in `juggler-backend/` and `juggler-frontend/`

## Frameworks

**Backend (`juggler-backend/`):**
- Express 4.18 — HTTP API server, port 5002
- Knex 3.1 — SQL query builder and migration runner
- Zod 4.3 — Request body validation schemas (`src/schemas/`)
- Jest 30 — Test runner (backend unit + integration tests)

**Frontend (`juggler-frontend/`):**
- React 18.2 — UI framework, port 3003
- Create React App 5.0 (`react-scripts`) — Build tooling, dev server with proxy
- Axios 1.6 — HTTP client (`src/services/apiClient.js`)

**MCP Server (`juggler-mcp/`):**
- `@modelcontextprotocol/sdk` 1.12 — MCP protocol SDK (stdio transport for Claude Code)
- Zod 3.23 — Tool parameter validation

**Build/Dev:**
- nodemon 3.1 — Backend dev auto-restart (`juggler-backend/nodemon.json`)
- Playwright 1.42 — End-to-end tests (`tests/` at monorepo root, root `package.json`)

## Key Dependencies

**Backend Critical:**
- `mysql2` 3.9 — MySQL database client (Knex uses this under the hood)
- `ioredis` 5.10 — Redis client for caching and SSE pub/sub (`src/lib/redis.js`, `src/lib/sse-emitter.js`)
- `jose` 5.2 — JWKS-based JWT verification for MCP transport (`src/middleware/jwt-auth.js`)
- `@google/genai` 1.46 — Gemini / Vertex AI client (`src/controllers/ai.controller.js`)
- `google-auth-library` 9.6 — Google Calendar OAuth2 client (`src/lib/gcal-api.js`)
- `@azure/msal-node` 5.0 — Microsoft OAuth (imported; direct REST / PKCE path also used in `src/lib/msft-cal-api.js`)
- `tsdav` 2.1 — CalDAV client for Apple Calendar (`src/lib/apple-cal-api.js`)
- `ical.js` 2.2 — iCal/VEVENT parsing and building (`src/lib/apple-cal-api.js`)
- `@modelcontextprotocol/sdk` 1.27 — MCP server embedded in backend (`src/mcp/`)
- `uuid` 13.0 — UUID generation (calendar event IDs, lock tokens)
- `compression` 1.7 — gzip response compression (SSE stream excluded)
- `helmet` 8.1 — HTTP security headers
- `express-rate-limit` 8.3 — Per-endpoint and per-user rate limiting
- `morgan` 1.10 — HTTP request logging

**Backend Infrastructure:**
- `dotenv` 16.4 — Environment variable loading
- `cookie-parser` 1.4 — Cookie parsing (auth tokens)
- `body-parser` 1.20 — JSON/URL-encoded body parsing
- `cors` 2.8 — CORS with configurable origin whitelist

**Frontend Critical:**
- `konva` 9.3 + `react-konva` 18.2 — Canvas rendering for annotation overlay (`src/components/feedback/AnnotationCanvas.jsx`)
- `elkjs` 0.11 — Graph layout engine for dependency view (`src/components/views/DependencyView.jsx`)
- `mobile-drag-drop` 3.0-rc — Touch drag-and-drop polyfill (`src/index.js`)
- `html2canvas` 1.4 — Screenshot capture for bug reporting
- `@react-oauth/google` 0.12 — Google OAuth button (auth-service integration)
- `juggler-shared` (file:../shared) — Shared scheduler utilities (date helpers, dependency helpers)
- `bug-reporter-client` (file:../../bug-reporter-service/shared) — Internal feedback widget (`src/components/feedback/FeedbackDialog.jsx`)

**Vendored Modules:**
- `juggler-backend/vendor/service-auth.js` — Service-to-service JWT auth (copied from auth-service, not published to npm)
- `juggler-backend/node_modules/auth-client/` — Copied from `auth-service/shared/` during Docker build (gitignored, path rewritten in Dockerfile)

## Configuration

**Environment:**
- Backend reads from `.env` via `dotenv` at startup (`juggler-backend/.env` — gitignored)
- `.env.test` used for integration test suite (requires test MySQL on port 3307, populated from `juggler-backend/.env.test.example`)
- Frontend uses runtime `proxy-config.js` for service URL resolution — detects localhost / `.localdev.raikegroup.com` / `.raikegroup.com` automatically (no REACT_APP_ env vars needed at build time in most cases)

**Key Backend Env Vars:**
```
# Database
DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
CLOUD_SQL_CONNECTION_NAME   # GCP Cloud SQL socket (production)

# Auth
AUTH_JWKS_URL               # Points to auth-service JWKS endpoint (default: http://localhost:5010/.well-known/jwks.json)

# Google Calendar + AI
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
GCAL_REDIRECT_URI
GEMINI_API_KEY
GEMINI_MODEL                # Default: gemini-2.5-flash
USE_VERTEX_AI               # true = use Vertex AI instead of Gemini API key
GOOGLE_CLOUD_PROJECT        # Required when USE_VERTEX_AI=true
VERTEX_AI_LOCATION          # Default: us-central1

# Microsoft Calendar
MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET
MSFT_CAL_REDIRECT_URI

# Apple Calendar
CREDENTIAL_ENCRYPTION_KEY   # 64-char hex, 32 bytes — AES-256-GCM for stored app-specific passwords

# Redis
REDIS_URL                   # Default: redis://127.0.0.1:6379

# Service-to-service
PAYMENT_SERVICE_URL         # Default: http://localhost:5020
BILLING_SERVICE_URL         # Alias used in ai-usage-flusher
BILLING_WEBHOOK_SECRET      # HMAC-SHA256 secret for payment-service webhooks
INTERNAL_SERVICE_KEY        # Fallback auth key for service-to-service calls

# Runtime
PORT                        # Default: 5002; Docker: 8080
FRONTEND_URL                # CORS whitelist (comma-separated)
NODE_ENV                    # development | production | test
APP_ID                      # Default: juggler
PRODUCT_LABEL               # Default: juggler
SERVICE_NAME                # Default: strivers
ADMIN_EMAILS                # Comma-separated admin email list
```

**Build:**
- Backend: none (plain `node src/server.js`)
- Frontend: `react-scripts build` → `juggler-frontend/build/`
- Docker: `juggler-backend/Dockerfile` (backend only; frontend served separately or built into static hosting)
- GCP Cloud Build: `juggler-backend/cloudbuild.yaml`

## Database

**Engine:** MySQL 8 (development: local 127.0.0.1:3306; production: GCP Cloud SQL via Unix socket)
**ORM/Builder:** Knex 3.1
**Charset:** `utf8mb4`, timezone `+00:00`, `dateStrings: true`
**Pool:** dev min 2 / max 10; production min 2 / max 20
**Migration directory:** `juggler-backend/src/db/migrations/` (~60+ migrations from 2026-03 onward)
**Test database:** separate `juggler_test` DB on port 3308 (Docker Compose: `juggler-backend/docker-compose.test.yml`)

**Collation rule:** All new migration tables must specify `COLLATE utf8mb4_unicode_ci` explicitly — MySQL 8 defaults to `utf8mb4_0900_ai_ci` which silently breaks JOINs against older tables.

## Platform Requirements

**Development:**
- Node.js 20+, npm
- MySQL 8 running locally (or Docker Compose for tests)
- Redis (optional; app fails open if unavailable)
- auth-service running at port 5010 (JWT validation)
- payment-service running at port 5020 (plan features, usage reporting)

**Production:**
- GCP Cloud Run (containerized `node:20-slim`)
- GCP Cloud SQL (MySQL 8) connected via socket
- Redis (optional, SSE scale-out limited to single instance without it)
- Caddy reverse proxy routes `/api/*` to backend, everything else to frontend

---

*Stack analysis: 2026-05-14*

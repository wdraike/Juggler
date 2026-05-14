# External Integrations

**Analysis Date:** 2026-05-14

## APIs & External Services

**AI / Machine Learning:**
- Google Gemini API — natural language task commands, AI enrichment (titles/descriptions)
  - SDK/Client: `@google/genai` (npm package), client created in `juggler-backend/src/controllers/ai.controller.js`
  - Auth: `GEMINI_API_KEY` env var (direct API key mode)
  - Model: `GEMINI_MODEL` env var, default `gemini-2.5-flash`
  - Alternate mode: Vertex AI (set `USE_VERTEX_AI=true`, requires `GOOGLE_CLOUD_PROJECT` + GCP service account)
  - All calls tracked via `juggler-backend/src/services/gemini-tracked-call.js` → usage outbox

**Calendar Sync:**

- Google Calendar API (REST v3) — bidirectional event sync with user Google Calendars
  - SDK/Client: `google-auth-library` OAuth2Client + direct `fetch` to `https://www.googleapis.com/calendar/v3`
  - Auth: OAuth2 Authorization Code flow; tokens stored per-user in DB (`gcal_tokens` table)
  - Credentials: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GCAL_REDIRECT_URI`
  - Callback: `GET /api/gcal/callback`
  - Scope: `https://www.googleapis.com/auth/calendar.events`
  - Implementation: `juggler-backend/src/lib/gcal-api.js`, adapter: `juggler-backend/src/lib/cal-adapters/gcal.adapter.js`

- Microsoft Graph API (v1.0) — bidirectional event sync with Outlook/Microsoft 365 Calendars
  - SDK/Client: Direct `fetch` to `https://graph.microsoft.com/v1.0`; PKCE flow (no MSAL at runtime, despite `@azure/msal-node` in deps)
  - Auth: OAuth2 Authorization Code + PKCE; tokens stored per-user in DB (`msft_cal_tokens` table)
  - Credentials: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MSFT_CAL_REDIRECT_URI`
  - Callback: `GET /api/msft-cal/callback`
  - Scopes: `Calendars.ReadWrite offline_access User.Read`
  - Token endpoint: `https://login.microsoftonline.com/common/oauth2/v2.0/token`
  - Implementation: `juggler-backend/src/lib/msft-cal-api.js`, adapter: `juggler-backend/src/lib/cal-adapters/msft.adapter.js`

- Apple iCloud CalDAV — bidirectional event sync with Apple Calendar
  - SDK/Client: `tsdav` (CalDAV protocol) + `ical.js` (VEVENT parsing/building)
  - Auth: HTTP Basic auth with Apple ID + app-specific password; credential stored AES-256-GCM encrypted in DB
  - Server: `https://caldav.icloud.com` (default)
  - Credentials at rest: encrypted via `CREDENTIAL_ENCRYPTION_KEY` env var in `juggler-backend/src/lib/credential-encrypt.js`
  - Implementation: `juggler-backend/src/lib/apple-cal-api.js`, adapter: `juggler-backend/src/lib/cal-adapters/apple.adapter.js`

**Weather:**
- Open-Meteo Forecast API — 14-day hourly weather forecasts for outdoor task scheduling
  - URL: `https://api.open-meteo.com/v1/forecast`
  - Auth: None (free, no API key required)
  - Caching: DB-backed, 1-hour TTL, stored in Fahrenheit (`weather_cache` table)
  - Implementation: `juggler-backend/src/controllers/weather.controller.js`

- Open-Meteo Geocoding API — location search by name
  - URL: `https://geocoding-api.open-meteo.com/v1/search`
  - Auth: None (free)

- Nominatim (OpenStreetMap) Reverse Geocoding — display name from lat/lon ("Locate me" feature)
  - URL: `https://nominatim.openstreetmap.org/reverse`
  - Auth: None (free, rate-limited)

## Data Storage

**Databases:**
- MySQL 8 (primary datastore)
  - Development connection: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
  - Production connection: GCP Cloud SQL via Unix socket (`CLOUD_SQL_CONNECTION_NAME` env var)
  - Client: Knex 3.1 + mysql2 3.9 (`juggler-backend/knexfile.js`)
  - Migration directory: `juggler-backend/src/db/migrations/`

**Caching:**
- Redis (optional, fails open)
  - Connection: `REDIS_URL` env var (default `redis://127.0.0.1:6379`)
  - Client: `ioredis` (`juggler-backend/src/lib/redis.js`)
  - Key prefix: `strivers:`
  - Used for: task/config/user read cache, SSE pub/sub channel (`sse:{userId}`)
  - SSE pub/sub requires separate `ioredis` subscriber connection (`juggler-backend/src/lib/sse-emitter.js`)
  - Fall-back behavior: all cache reads return null; SSE falls back to local in-process map

**File Storage:**
- None — no external object storage (S3, GCS) used

## Authentication & Identity

**Auth Provider:**
- auth-service (internal Raike & Sons service)
  - JWT type: RS256 (asymmetric); public keys fetched from JWKS endpoint
  - JWKS URL: `AUTH_JWKS_URL` env var (default `http://localhost:5010/.well-known/jwks.json`)
  - Issuer claim: `raike-auth`
  - Client: Vendored `auth-client` module (copied from `auth-service/shared/` into `juggler-backend/vendor/` and Docker `node_modules/auth-client/`)
  - JWT middleware: `juggler-backend/src/middleware/jwt-auth.js`
  - Frontend stores access token in `localStorage` key `juggler-access-token`; refresh token in `juggler-refresh-token`
  - Auth flow: redirect to auth-service login → auth code → POST `/api/auth/token` at auth-service → JWT stored locally

- Google OAuth (login via Google) — handled entirely by auth-service; juggler frontend has `@react-oauth/google` as dependency but the actual Google SSO login button is in auth-service, not juggler frontend

**Service-to-Service Auth:**
- `INTERNAL_SERVICE_KEY` header for calls to payment-service internal API
- Vendored `juggler-backend/vendor/service-auth.js` — service JWT tokens for outbound calls (used by `juggler-backend/src/lib/usage-reporter.js`)

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry or equivalent configured)

**AI Usage Tracking:**
- Internal outbox table (`ai_usage_outbox` DB table, migration `20260507000001_create_ai_usage_outbox.js`)
- Flusher service sends batches to payment-service every 30s (`juggler-backend/src/services/ai-usage-flusher.service.js`)
- All Gemini calls wrapped in `trackedGeminiCall()` which captures token counts, latency, use-case labels
- Use-case labels defined in `juggler-backend/src/constants/ai-use-cases.js`
- `ai_command_log` table also tracks per-user daily limits (50/day)

**Feature/Usage Events:**
- `feature_events` DB table — logs all feature gate checks and usage limit hits
- Reported to payment-service via `juggler-backend/src/lib/usage-reporter.js` (30s batches, 50-event flush threshold)

**Logging:**
- `morgan` HTTP request logging (stdout, dev format; SSE endpoint with token query param is skipped)
- `console.log/warn/error` throughout (no structured log format)

## Billing & Payments

**Payment Service:**
- Internal Raike & Sons payment-service (port 5020 local, `billing.raikegroup.com` production)
- Connection: `PAYMENT_SERVICE_URL` env var
- Used for:
  - Plan feature resolution — `GET /api/plans?product=<id>` (`juggler-backend/src/middleware/plan-features.middleware.js`)
  - User plan lookup — internal API (`/internal/user-plan/<userId>`)
  - Product discovery — `GET /internal/products/<label>` (resolves product UUID at startup)
  - Usage reporting — `POST /internal/usage` (batched by usage-reporter)
  - AI usage flush — batched to billing service

**Incoming Billing Webhooks:**
- Endpoint: `POST /api/billing-webhooks` (`juggler-backend/src/routes/billing-webhooks.routes.js`)
- Sender: payment-service
- Verification: HMAC-SHA256 signature on raw body (`X-Billing-Signature` header); 5-minute freshness window
- Secret: `BILLING_WEBHOOK_SECRET` env var (falls back to `INTERNAL_SERVICE_KEY`)
- Handler: `juggler-backend/src/controllers/billing-webhooks.controller.js`

## MCP Protocol

**Embedded MCP Server (HTTP transport):**
- Protocol: Model Context Protocol (Streamable HTTP, stateless)
- Endpoint: `POST /mcp` in main Express app (`juggler-backend/src/app.js`)
- Auth: JWT via auth-service JWKS (reuses `verifyToken` from `jwt-auth.js`)
- OAuth discovery/proxy: `createOAuthProxyRoutes` from auth-client/mcp-auth module
- Server factory: `juggler-backend/src/mcp/server.js` (creates per-user McpServer)
- Tools registered: tasks, schedule, config, data (subdirs of `juggler-backend/src/mcp/tools/`)
- Rate limit: 300 req/min

**Standalone MCP Server (stdio transport):**
- Entry: `juggler-mcp/index.js`
- Transport: stdio (for Claude Code integration)
- Auth: reads JWT from `JUGGLER_TOKEN` env var or `~/.juggler-mcp-token` file
- Calls backend API at `JUGGLER_API_URL` (default `http://localhost:5002`)
- Consumer: ClimbRS (resume-optimizer) as external MCP client

## CI/CD & Deployment

**Hosting:**
- GCP Cloud Run (containerized, stateless)
- Production domain: `strivers.raikegroup.com`
- Staging/localdev: `strivers.localdev.raikegroup.com`

**CI Pipeline:**
- GCP Cloud Build: `juggler-backend/cloudbuild.yaml`
- Build step: `docker build -f juggler-backend/Dockerfile` from monorepo root (needs `auth-client/` in context)

**Container Registry:**
- `gcr.io/$PROJECT_ID/juggler-backend`

## Real-Time Communication

**SSE (Server-Sent Events):**
- Endpoint: `GET /api/events` (accepts JWT via `?token=` query param — EventSource limitation)
- Client registry: in-process Map (single-instance; multi-instance requires Redis pub/sub)
- Redis pub/sub channel: `sse:{userId}` for cross-instance fan-out when Redis available
- Heartbeat: 30-second interval to maintain connection through proxies
- Implementation: `juggler-backend/src/lib/sse-emitter.js`

## Webhooks & Callbacks

**Incoming:**
- `POST /api/billing-webhooks` — plan changes from payment-service (HMAC-signed)
- `GET /api/gcal/callback` — Google OAuth2 redirect from Google
- `GET /api/msft-cal/callback` — Microsoft OAuth2 redirect from Microsoft

**Outgoing:**
- Batched usage reports to payment-service (`/internal/usage`)
- Batched AI usage to billing service (`/internal/ai-usage/ingest`)

## Environment Configuration

**Required env vars (backend):**
```
DB_HOST, DB_USER, DB_PASSWORD, DB_NAME    # MySQL
AUTH_JWKS_URL                              # auth-service JWKS endpoint
FRONTEND_URL                               # CORS whitelist
CREDENTIAL_ENCRYPTION_KEY                  # 64-char hex for Apple credential encryption
PAYMENT_SERVICE_URL                        # billing/plan features
INTERNAL_SERVICE_KEY                       # service-to-service auth
```

**Optional env vars:**
```
GEMINI_API_KEY                             # Required if USE_VERTEX_AI != true
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET     # Required for Google Calendar
MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET  # Required for Microsoft Calendar
REDIS_URL                                  # App works without Redis
BILLING_WEBHOOK_SECRET                     # Falls back to INTERNAL_SERVICE_KEY
USE_VERTEX_AI, GOOGLE_CLOUD_PROJECT, VERTEX_AI_LOCATION  # Vertex AI mode
```

**Secrets location:**
- Development: `juggler-backend/.env` (gitignored)
- Integration tests: `juggler-backend/.env.test` (gitignored, template at `.env.test.example`)
- Production: GCP Secret Manager (consumed by Cloud Run at deploy time)

---

*Integration audit: 2026-05-14*

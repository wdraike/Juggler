---
type: security-audit
service: juggler
status: active
last_updated: 2026-05-19
tags:
  - type/security-audit
  - service/juggler
  - status/active
  - security
---

# Juggler / StriveRS — API Security Audit

**Last Updated:** 2026-05-19

**Audit completed:** 2026-04-18
**Scope:** 57 REST endpoints (17 route files) + 21 embedded MCP tools + 20 standalone MCP tools + 5 middleware.
**Master plan:** `~/.claude/plans/in-climbrs-i-want-linear-bachman.md` (Part 4).

## Headline

Juggler's structure mirrors ClimbRS — same `jwt-auth`/`resolvePlanFeatures` pipeline, same Knex-parameterized DB access, same OAuth-driven calendar integrations. Several of the ClimbRS-era leaks existed verbatim here and have been ported to the fixed pattern. No critical or high-severity issues; all findings were medium/low.

## Fixed in this audit (2026-04-18)

- **JF1 — feature-catalog service-key not timing-safe.** `src/routes/feature-catalog.routes.js` used `!==`. Ported the `crypto.timingSafeEqual` pattern from ClimbRS (F16).
- **JF2 — feature-events leaks + unbounded params.** `src/routes/feature-events.routes.js:58` echoed `error.message`; `days` and `limit` had no upper bound; `event_type` wasn't enum-validated. Applied ClimbRS F16/F17/F18 in full — timing-safe compare, clamped `days ≤ 90` and `limit ≤ 1000`, allow-listed `event_type`, generic 500 message.
- **JF3 — billing webhook leaks error.message.** `src/controllers/billing-webhooks.controller.js:216` returned raw error text. Now logs + returns `Internal server error`.
- **JF4 — data import leaks error.message.** `src/controllers/data.controller.js:202` returned `{error: 'Import failed', message: error.message}`. Removed the `message` field.
- **JF5 — schedule debug leaks error.message.** `src/routes/schedule.routes.js:138` concatenated `error.message` into the response. Replaced with generic message.
- **JF6 — msft-cal OAuth callback leaks error.message.** `src/controllers/msft-cal.controller.js:131` echoed it into the 500 body. Replaced with generic text.
- **JF7 — cal-sync audit leaks error.message.** `src/controllers/cal-sync.controller.js:1555` included `detail: error.message`. Removed.
- **JF8 — billing webhook no replay protection.** `src/routes/billing-webhooks.routes.js` verifier now also checks `req.body.timestamp` (already sent by payment-service) against a 5-minute freshness window.
- **JF9 — loopback-friendly dev CORS + origin trim.** `src/app.js` now trims `FRONTEND_URL` entries and allows any `localhost` / `127.0.0.1` / `[::1]` origin on any port, `*.localdev.test`, and explicit `CORS_ALLOW_ANY_ORIGIN=true` opt-in. Production lockdown preserved.

## Verified safe (no fix needed)

- **Global auth enforcement.** Most route files start with `router.use(authenticateJWT, resolvePlanFeatures)`. Health, OAuth callbacks (gcal/msft), billing-webhooks (HMAC), and feature-catalog/feature-events (service key) are the only public endpoints and all intentional.
- **Per-resource ownership.** Task, project, config, location, tool controllers scope queries by `user_id` consistently.
- **MCP auth + userId scoping.** Embedded `/mcp` endpoint uses auth-client's Bearer/API-key check; tool handlers receive `extra.userId` and scope DB access by it. Standalone MCP at `juggler-mcp/` uses env-var JWT.
- **Knex parameterized everywhere.** No string concat in SQL observed.
- **No cloud functions, no multer, no user-supplied URL fetching** — zero SSRF surface.

## Known issues (intentional)

- **JF-I1 — Billing signature signs `JSON.stringify(req.body)` not raw body.** Works only because payment-service uses the same stringify. Fragile if either side changes key ordering or whitespace. Fix: mount `/api/billing-webhooks` before global body-parser with raw-body capture, same pattern as `resume-optimizer-backend/src/app.js:182-188`. See JF-R2 below.

## Remaining work

- [ ] **[OPEN] JF-R1 — Public-endpoint rate limits.** Port `resume-optimizer-backend/src/middleware/public-rate-limits.js` to juggler. Apply to `/health`, `/api/gcal/callback`, `/api/msft-cal/callback`, `/api/billing-webhooks` (pre-signature), `/api/feature-catalog`, `/api/feature-events`. The existing `apiLimiter` in `app.js:78` is 1000/min global per IP — good floor but doesn't protect the specific brute-force surfaces.
- [ ] **[OPEN] JF-R2 — Billing webhook raw-body signing.** Move to raw-body HMAC input (see JF-I1 above). Requires mounting the billing-webhooks route before `bodyParser.json` and capturing `req.rawBody`. Coordinate with payment-service to ensure both sides use the same bytes.
- [ ] **[OPEN] JF-R3 — Zod schemas on REST write routes.** `zod` is already a dependency (v4.3.6) but only used in MCP tools. Add schema validation to the top-10 write endpoints (`POST /api/tasks`, batch CRUD, config updates, etc.). Manual validation in controllers works but is inconsistent.
- [ ] **[OPEN] JF-R4 — Live probe suite.** Mirror `resume-optimizer/temp/security-probes/probe-rest.sh`. Add probes specific to juggler: OAuth callback with missing/mismatched `state` (expect 400), MCP tool call with spoofed `userId` in params (handler must ignore and use `extra.userId`), billing webhook with stale timestamp (expect 401 after JF8 fix).

## Files modified this pass

- `src/routes/feature-catalog.routes.js` — JF1
- `src/routes/feature-events.routes.js` — JF2
- `src/controllers/billing-webhooks.controller.js` — JF3
- `src/controllers/data.controller.js` — JF4
- `src/routes/schedule.routes.js` — JF5
- `src/controllers/msft-cal.controller.js` — JF6
- `src/controllers/cal-sync.controller.js` — JF7
- `src/routes/billing-webhooks.routes.js` — JF8
- `src/app.js` — JF9

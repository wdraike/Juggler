---
type: mcp
service: juggler
status: active
last_updated: 2026-07-21
tags:
  - type/mcp
  - service/juggler
  - status/active
  - mcp
  - tooling
  - scheduler
---

# MCP Server — Juggler (Streamable HTTP)

**Last Updated:** 2026-07-21
**Location:** `juggler-backend/src/mcp/` (`server.js`, `tools/*`, `transport.js`, `api-key-auth.js`)

> **History:** this doc previously described the `juggler-mcp/` standalone stdio
> client package. That package was **deleted in 999.2158 (2026-07-21)** — it
> called the REST API (which accepts JWKS-verified JWTs only), so MCP API keys
> 401'd on every tool call, and its tool definitions duplicated the backend
> MCP's. MCP is now served exclusively by `juggler-backend` over Streamable HTTP.

## Endpoints

| Path | Status |
|------|--------|
| `POST /api/mcp` | Canonical (path-consistent with resume-optimizer's `/api/mcp`) |
| `POST /mcp` | Legacy alias — the prod claude.ai StriveRS connector is registered at `strivers.raikegroup.com/mcp`; keep until that registration is repointed |

Both paths are served by the same handlers (`src/app.js` mounts → `src/mcp/transport.js`)
with the same rate limit. `GET`/`DELETE` return 405 (stateless mode — one
`McpServer` per POST, no session tracking, Cloud Run safe).
Parity + auth contract tests: `juggler-backend/tests/mcp-api-alias-parity.test.js`.

## Auth — two doors (ruling 2026-07-21)

1. **OAuth access-JWT** — exclusively for claude.ai remote connectors
   (30-day single-use refresh-token rotation keeps them live between uses).
2. **auth-service `mcp` API key** — the sole path for local clients
   (Claude Code, Claude Desktop via `mcp-remote`, scripts). Validated fresh on
   every call — auth-service introspection + payment-service entitlement
   (`src/mcp/api-key-auth.js`), fail-closed, no caching.

Mint a key via auth-service's Account Security → API Keys UI (type `mcp`), then:

```bash
# Claude Code
claude mcp add --transport http strivers http://localhost:5002/api/mcp \
  --header "Authorization: Bearer <key>"
```

## Tools

Tool definitions live in `juggler-backend/src/mcp/tools/` (tasks, schedule,
config, data) and register in `src/mcp/server.js` — one registry serves every
transport and client, so the tool surface cannot drift between clients.

## Dev smoke

Backend must be running (`node dev.js` → port 5002):

```bash
curl -s -X POST http://localhost:5002/api/mcp \
  -H "Authorization: Bearer <key>" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

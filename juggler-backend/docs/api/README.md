---
type: api-reference
service: juggler
status: active
last_updated: 2026-05-31
tags:
  - type/api-reference
  - service/juggler
  - status/active
  - api
  - rest
---

# Juggler Backend — API Reference

**Last Updated:** 2026-05-31
**Base URL:** `http://localhost:5002` (dev)

---

## Authentication

All `/api/*` routes (except `/api/data/import` and `/health`) require a JWT issued by auth-service:

```
Authorization: Bearer <JWT_TOKEN>
```

The SSE endpoint (`/api/events`) also accepts the token as a query parameter because the browser `EventSource` API does not support custom headers:

```
GET /api/events?token=<JWT_TOKEN>
```

---

## MCP Endpoint

### Streamable HTTP MCP

```http
POST /mcp
Authorization: Bearer <JWT>
Content-Type: application/json
```

Stateless MCP endpoint. Each request creates a fresh server instance scoped to the authenticated user. Supports all juggler MCP tools (task CRUD, schedule, config, data). See `docs/mcp/juggler-mcp-server.md` for tool reference.

---

## Tasks

**Base path:** `/api/tasks`

All task routes require JWT. Write operations are additionally rate-limited to 300/min per user.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks` | List all tasks for the authenticated user |
| `GET` | `/api/tasks/:id` | Get a single task by ID |
| `GET` | `/api/tasks/disabled` | List disabled tasks |
| `GET` | `/api/tasks/version` | Get task data version (used for cache invalidation) |
| `GET` | `/api/tasks/suggest-icon` | Suggest an emoji icon for a task text (Gemini) |
| `POST` | `/api/tasks` | Create a task |
| `POST` | `/api/tasks/batch` | Batch create tasks (array) |
| `PUT` | `/api/tasks/batch` | Batch update tasks (array) |
| `PUT` | `/api/tasks/:id` | Update a task |
| `PUT` | `/api/tasks/:id/status` | Update task status only |
| `PUT` | `/api/tasks/:id/re-enable` | Re-enable a disabled task |
| `POST` | `/api/tasks/:id/take-ownership` | Take ownership of an AI-enriched task |
| `DELETE` | `/api/tasks/:id` | Delete a task (remaps dependents) |

### Create Task — key fields

```json
{
  "text": "Buy groceries",
  "project": "Personal",
  "pri": "P2",
  "dur": 30,
  "date": "6/15",
  "time": "10:00 AM",
  "deadline": "2026-06-20",
  "when": "morning,afternoon",
  "placementMode": "anytime",
  "recur": { "type": "weekly", "days": "M,W,F" },
  "split": false,
  "dependsOn": ["<task-id>"],
  "notes": "Optional notes",
  "url": "https://example.com"
}
```

`date` + `time` are preferred over `scheduledAt` — the server converts local strings to UTC using the user's stored timezone.

---

## Schedule

**Base path:** `/api/schedule`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/schedule/run` | Run scheduler, persist placements, return result (rate-limited 10/min) |
| `GET` | `/api/schedule/placements` | Read current placements (read-only, no state change) |
| `POST` | `/api/schedule/nudge` | Nudge scheduler without full re-run |
| `POST` | `/api/schedule/debug` | Admin: debug scheduler run with step-by-step output |
| `POST` | `/api/schedule/step/start` | Admin: start a stepper session |
| `GET` | `/api/schedule/step/:sessionId/summary` | Admin: get step session summary |
| `GET` | `/api/schedule/step/:sessionId/:stepIndex` | Admin: get specific step detail |
| `POST` | `/api/schedule/step/:sessionId/stop` | Admin: stop a stepper session |

---

## Projects

**Base path:** `/api/projects`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects` | Create a project |
| `PUT` | `/api/projects/reorder` | Reorder projects |
| `PUT` | `/api/projects/:id` | Update a project (rename cascades to tasks) |
| `DELETE` | `/api/projects/:id` | Delete a project (tasks kept, lose association) |

---

## Configuration

**Base path:** `/api/config`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | Get all user config (locations, tools, time blocks, preferences, tool matrix) |
| `PUT` | `/api/config/:key` | Update a config key |

Valid config keys: `time_blocks`, `preferences`, `loc_schedules`, `loc_schedule_defaults`, `loc_schedule_overrides`, `hour_location_overrides`, `tool_matrix`.

---

## Calendar Sync

**Base path:** `/api/cal`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/cal/has-changes` | Check if there are local changes pending sync |
| `POST` | `/api/cal/sync` | Run a full bi-directional calendar sync |
| `GET` | `/api/cal/sync-history` | Get sync action history |
| `GET` | `/api/cal/audit` | Audit sync ledger state |

### Google Calendar — `/api/gcal`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/gcal/callback` | OAuth callback (rate-limited 20/min) |
| Other | `/api/gcal/*` | GCal OAuth flow and sync routes |

### Microsoft Calendar — `/api/msft-cal`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/msft-cal/callback` | OAuth callback (rate-limited 20/min) |
| Other | `/api/msft-cal/*` | MSFT OAuth flow and sync routes |

### Apple CalDAV — `/api/apple-cal`

All Apple CalDAV connection and sync routes.

---

## AI Commands

**Base path:** `/api/ai`

Rate-limited to 20 requests/min (Redis-backed across instances). Per-user daily quota of 50 commands enforced in the controller.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/ai/command` | Execute an AI command (Gemini) on task data |

---

## Weather

**Base path:** `/api/weather`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/weather` | Get forecast for a coordinate (cached 1h, 10km grid) |

---

## User Profile

```http
GET /api/auth/me
Authorization: Bearer <JWT>
```

Returns `{ user: { id, email, name, picture } }`.

---

## Real-Time Events (SSE)

```http
GET /api/events?token=<JWT>
Accept: text/event-stream
```

Pushes `schedule:changed` events when the scheduler completes. Heartbeat every 30s. Requires JWT via query param (EventSource limitation).

---

## Data Import/Export

**Base path:** `/api/data`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/data/import` | Import task data (2MB JSON limit) |
| `GET` | `/api/data/export` | Export all user data as JSON |

---

## Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Load balancer health probe |
| `GET` | `/api/health` | JWT | Frontend-accessible health check |
| `GET` | `/api/health/detailed` | JWT | Detailed health (DB, Redis, queue status) |

---

## Feature Catalog & Plan

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/feature-catalog` | List all feature gates and their limits |
| `GET/POST` | `/api/feature-events` | Feature gate event analytics |
| `GET` | `/api/my-plan` | Current user's active plan and entitlements |

---

## Error Codes

| Code | Meaning |
|------|---------|
| `400` | Invalid input or validation failure |
| `401` | Missing or expired JWT |
| `403` | Feature gated (plan limit reached) |
| `404` | Resource not found |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

---

## OpenAPI Spec

No OpenAPI spec exists yet. The endpoints above are the authoritative reference until one is authored.

---

## Related Documentation

- `docs/mcp/juggler-mcp-server.md` — MCP tool reference (task CRUD via MCP)
- `docs/use-cases/task.controller.md` — Task controller use cases
- `docs/use-cases/cal-sync.controller.md` — Cal sync use cases

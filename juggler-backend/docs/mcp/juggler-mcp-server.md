---
type: mcp-server
service: juggler
status: active
last_updated: 2026-07-05
tags:
  - type/mcp-server
  - service/juggler
  - status/active
  - mcp
  - tools
---

# Juggler MCP Server

**Last Updated:** 2026-07-05

Juggler exposes its task and scheduling capabilities as an MCP server. Two transport modes exist for different client types.

---

## Transport Modes

### Embedded Streamable HTTP (primary — for MCP-over-HTTP clients)

**Endpoint:** `POST /mcp`
**Auth:** Bearer token — either a JWT issued by auth-service, **or** an auth-service-minted MCP API key (`key_type='mcp'`)
**Implementation:** `src/mcp/transport.js` + `src/mcp/server.js` + `src/mcp/api-key-auth.js`

Stateless — each `POST /mcp` creates a fresh `McpServer` instance scoped to the authenticated user, then tears it down after the response. No session state is maintained. Works correctly across multiple Cloud Run instances.

The bearer token is authenticated by the shared `authenticateMcpRequest()` (`auth-client/mcp-auth.js`): JWTs (3 dot-separated segments) are verified via JWKS as before; anything else is handed to `api-key-auth.js`'s `apiKeyValidator`, which POSTs the raw key to auth-service's `POST /internal/api-keys/introspect` (service-to-service, ServiceJWT-authenticated) and, on `{valid:true, key_type:'mcp'}`, checks payment-service's `GET /internal/users/:userId/entitlement?product=juggler` **fresh on every request** (no caching) before granting access. Either failure (invalid/expired/wrong-type key, or no entitlement) is fail-closed — `401`.

Dev mode: token `dev-token` is accepted without verification when `NODE_ENV=development`.

### stdio (for Claude Code / ClimbRS)

**Entry point:** `juggler-mcp/index.js`
**Auth:** Token stored in `~/.juggler-mcp-token` or `JUGGLER_TOKEN` env var — now an auth-service-minted MCP API key (see `docs/mcp/juggler-mcp.md`); the same token is sent as the Bearer credential to the embedded HTTP server above, so it goes through the same API-key introspection + entitlement path.
**Implementation:** Thin HTTP proxy — each tool call makes a REST API call to the juggler backend.

```bash
# Setup
echo YOUR_JWT > ~/.juggler-mcp-token
```

The stdio server is a separate npm package in `juggler/juggler-mcp/`. It proxies to whatever `JUGGLER_API_URL` points at (default: `http://localhost:5002`).

---

## Server Identity

```json
{
  "name": "strivers",
  "version": "1.0.0"
}
```

The server name comes from `src/service-identity.js` (`SERVICE_NAME`, overridable via env). The product identity (`APP_ID`) used for plan checks is `juggler`.

---

## Authentication & Authorization

The embedded server authenticates via `auth-client/mcp-auth`'s `authenticateMcpRequest()`, which tries two branches:

**JWT branch** (token has 3 dot-separated segments):
1. Validates JWT against auth-service's JWKS endpoint
2. Auto-provisions a user record if the JWT is valid but the user doesn't exist locally
3. Checks `plans.juggler` claim in JWT for active subscription — this is a JWT-claims-only check (no round-trip to payment-service)

**API-key branch** (anything else, via `src/mcp/api-key-auth.js`'s `apiKeyValidator`):
1. Introspects the raw key against auth-service's `POST /internal/api-keys/introspect` (service-to-service; rejects non-`mcp` or invalid/expired/revoked keys)
2. Calls payment-service's `GET /internal/users/:userId/entitlement?product=juggler` for the resolved user — checked fresh on every request, no per-connection cache
3. Synthesizes a `plans.juggler` claim so the shared `planCheck` (below) passes without a second entitlement round-trip

Both branches run the same `planCheck`: if `plans.juggler` is not truthy, the request is rejected with `402 Active subscription required`. (Fixed 2026-07 — the API-key branch previously skipped this check entirely, a live entitlement-bypass bug; it now runs `planCheck` identically to the JWT branch.) A request with no active plan is rejected on both paths — this is server-level enforcement, not route-level.

---

## OAuth Discovery (for MCP clients that require it)

**Superseded as the recommended path (brain:59595):** the MCP API key described above is now
the recommended auth mechanism for juggler-mcp and ClimbRS. This OAuth discovery/redirect flow
remains mounted for MCP clients that specifically require RFC 8414/9728 discovery and a full
authorization-code exchange; see `auth-service/docs/api/oauth-mcp-flow.md` (marked
legacy/deprecated) for the endpoint-level detail of the flow these routes proxy to.

The backend exposes OAuth endpoints at:

- `GET /.well-known/oauth-authorization-server` — discovery document
- `POST /oauth/register` — dynamic client registration
- `GET /oauth/authorize` — authorization endpoint (dev: auto-approves)
- `POST /oauth/token` — token endpoint (dev: issues `dev-token`)

In production, `createOAuthProxyRoutes()` from `auth-client/mcp-auth` wires these to auth-service.

---

## Tools

All tools are scoped to the authenticated user — they can only read and write that user's data.

### Task Tools (`src/mcp/tools/tasks.js`)

#### `list_tasks`

List tasks. Excludes `done` tasks by default.

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string? | Filter by exact status: `""`, `"wip"`, `"done"`, `"skip"`, `"cancel"`, `"disabled"`, `"pause"` |
| `includeDone` | boolean? | Include done tasks (default: false) |
| `project` | string? | Filter by project name |
| `date` | string? | Filter by date in M/D format (e.g. `"6/15"`) |
| `limit` | number? | Max tasks to return |

---

#### `create_task`

Create a single task.

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | string | Task description (required) |
| `id` | string? | Task ID (auto-generated UUIDv7 if omitted) |
| `project` | string? | Project name |
| `pri` | string? | Priority: `"P1"` (highest) through `"P4"` (lowest); default `"P3"` |
| `dur` | number? | Duration in minutes |
| `date` | string? | Scheduled date as M/D (e.g. `"6/15"`) — preferred over `scheduledAt` |
| `time` | string? | Scheduled time as h:mm AM/PM (e.g. `"9:30 AM"`) — preferred over `scheduledAt` |
| `scheduledAt` | string? | UTC ISO timestamp — avoid; use `date`+`time` instead |
| `deadline` | string? | Hard deadline as YYYY-MM-DD or M/D |
| `startAfter` | string? | Start-after date as YYYY-MM-DD or M/D |
| `when` | string? | Time-of-day preference tags: `"morning"`, `"afternoon"`, `"evening"`, `"lunch"`, `"biz"`, `"night"` (comma-separated) |
| `dayReq` | string? | Day requirement: `"any"`, `"weekday"`, `"weekend"`, or day letters `"M,W,F"` |
| `placementMode` | enum? | `anytime`, `time_window`, `time_blocks`, `fixed`, `all_day`, `reminder` |
| `recur` | object? | Recurrence: `{ type, days?, every?, timesPerCycle?, fillPolicy? }` |
| `split` | boolean? | Allow splitting across time blocks |
| `splitMin` | number? | Minimum split chunk in minutes |
| `dependsOn` | string[]? | Array of task IDs this task depends on |
| `location` | string[]? | Location IDs |
| `tools` | string[]? | Tool IDs |
| `notes` | string? | Free-text notes |
| `url` | string? | External link (surfaced as clickable link on task card) |
| `marker` | boolean? | Non-blocking reminder — visible on calendar but doesn't consume capacity |
| `flexWhen` | boolean? | Allow scheduler to relax time-of-day preference if windows are full |
| `travelBefore` | number? | Travel buffer in minutes before task |
| `travelAfter` | number? | Travel buffer in minutes after task |

**Scheduling note:** When `date` is provided without `time`, the task defaults to `all_day` placement mode. When `date`+`time` are both provided, it defaults to `fixed`.

---

#### `create_tasks`

Batch create multiple tasks. Same fields as `create_task` per item.

| Parameter | Type | Description |
|-----------|------|-------------|
| `tasks` | object[] | Array of task objects (same fields as `create_task`) |

---

#### `update_task`

Update fields on an existing task. Only provided fields are changed.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID to update (required) |
| `status` | string? | New status |
| *(all `create_task` fields)* | | Same optional fields as create |

Calendar-synced tasks (with `gcal_event_id`, `msft_event_id`, or `apple_event_id`) can only have `status` and `notes` changed.

---

#### `batch_update_tasks`

Update multiple tasks at once. Max 200 per call.

| Parameter | Type | Description |
|-----------|------|-------------|
| `updates` | object[] | Array of `{ id, ...fields }` — same fields as `update_task` |

---

#### `set_task_status`

Set task status (simplified single-field update).

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID |
| `status` | string | `""` (active), `"done"`, `"wip"`, `"skip"`, `"cancel"`, `"pause"` |

---

#### `delete_task`

Delete a task. Dependencies referencing the deleted task are remapped to that task's own dependencies.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID to delete |

Calendar-linked tasks in `ingest` mode cannot be deleted; delete from the calendar instead.

---

#### `get_task`

Get a single task by ID. Returns full task detail including both UTC and local time fields.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Task ID |

---

#### `search_tasks`

Search tasks by text across task names and notes. Excludes done tasks by default.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Search text (case-insensitive) |
| `status` | string? | Filter by exact status |
| `includeDone` | boolean? | Include done tasks |
| `project` | string? | Filter by project |
| `limit` | number? | Max results (default 20) |

---

### Schedule Tools (`src/mcp/tools/schedule.js`)

#### `get_schedule`

Read current schedule placements. Does not modify any task data.

Returns: `{ dayPlacements, unplaced, deadlineMisses }`

No parameters.

---

#### `run_schedule`

Run the scheduler and persist date/time changes to tasks.

Returns stats: tasks moved, cleared, and reset counts.

No parameters. Retries up to 5 times with backoff if the per-user lock is held.

---

### Config Tools (`src/mcp/tools/config.js`)

#### `get_config`

Get all user configuration.

Returns: `{ locations, tools, projects, toolMatrix, timeBlocks, locSchedules, locScheduleDefaults, locScheduleOverrides, hourLocationOverrides, preferences }`

No parameters.

---

#### `list_projects`

List all projects with task counts.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string? | Filter by exact project name |

---

#### `create_project`

Create a new project.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Project name (must be unique) |
| `color` | string? | Hex color (e.g. `"#4A90D9"`) |
| `icon` | string? | Icon identifier |

---

#### `update_project`

Update a project. Renaming cascades to all associated tasks.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | number | Project ID |
| `name` | string? | New name |
| `color` | string? | New color |
| `icon` | string? | New icon |

---

#### `delete_project`

Delete a project. Tasks in the project are kept but lose their project association.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | number | Project ID |

---

#### `update_config`

Update a user configuration value.

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | enum | One of: `time_blocks`, `preferences`, `loc_schedules`, `loc_schedule_defaults`, `loc_schedule_overrides`, `hour_location_overrides`, `tool_matrix` |
| `value` | any | New value (object or array) |

Config changes that affect scheduling automatically enqueue a scheduler run.

---

### Data Tools (`src/mcp/tools/data.js`)

#### `export_data`

Export all user data as JSON.

Returns: `{ tasks, locations, tools, projects, config, exported }`

No parameters.

---

#### `get_calendar_status`

Check calendar provider connection status and last sync time.

Returns: `{ googleCalendar: { connected, lastSyncedAt, autoSync }, microsoftCalendar: { connected, lastSyncedAt } }`

No parameters.

---

#### `sync_calendar`

Trigger a full bi-directional calendar sync across all connected providers.

No parameters.

---

#### `integrity_check`

Scan for data integrity issues: orphaned instances, empty task text, broken dependencies, split ordinal violations, duplicate instances, orphaned sync records, orphaned masters, impossible constraints (startAfter > deadline).

| Parameter | Type | Description |
|-----------|------|-------------|
| `autoFix` | boolean? | If true, auto-fix safe issues (delete orphans, clear broken deps). Default: false (report only) |

---

## Concurrency Behaviour

Write tools (`create_task`, `update_task`, etc.) check the per-user sync lock before writing:

- **Lock free:** write directly to the DB, then enqueue a scheduler run
- **Lock held:** non-scheduling fields (text, notes, etc.) are written immediately; scheduling fields are queued in `task_write_queue` and applied when the lock releases

All responses include `queued: true` when the scheduling portion was deferred.

---

## Related Documentation

- `docs/api/README.md` — REST API reference
- `docs/architecture/README.md` — Architecture overview
- `docs/architecture/SCHEDULER.md` — Scheduler design
- `docs/architecture/TASK-PROPERTIES.md` — Full task field reference
- `docs/architecture/TASK-STATE-MATRIX.md` — Valid task state transitions

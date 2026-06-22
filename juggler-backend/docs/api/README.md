---
type: api-reference
service: juggler
status: active
last_updated: 2026-06-22
version: leg/fixy-now @ 2026-06-22
tags:
  - type/api-reference
  - service/juggler
  - status/active
  - api
  - rest
---

# Juggler Backend — API Reference

**Last Updated:** 2026-06-22
**Base URL:** `http://localhost:5002` (dev)

---

## Authentication

All `/api/*` routes (except `/api/data/import`, `/health`, and `/api/client-errors`) require a JWT issued by auth-service:

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

## Server Time

```http
GET /api/now
Authorization: Bearer <JWT>
```

Returns the server's canonical current time. The frontend uses this to compute a clock offset (`serverTime - clientTime`) and passes it into `getNowInTimezone`'s injectable clock, eliminating client-clock skew from overdue-status calculations (R50.8 family).

**Auth:** `authenticateJWT` (JWT required). Not rate-limited (registered before the `apiLimiter` mount, same as `/api/auth/me`).

**Request:** no parameters, no body.

**Response — 200 OK**

```json
{
  "epochMs": 1750598400000,
  "iso": "2026-06-22T16:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `epochMs` | integer | Server `Date.now()` — milliseconds since Unix epoch |
| `iso` | string | Same instant as ISO-8601 UTC (`toISOString()`) |

Both fields are derived from a single `new Date()` capture and are therefore consistent with each other.

**Error responses**

| Status | Condition |
|--------|-----------|
| `401` | Missing or expired JWT |
| `500` | Internal server error |

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
| `POST` | `/api/data/import` | Import task data — JSON or CSV (`Content-Type: text/csv` or `?format=csv`); 2 MB body cap |
| `GET` | `/api/data/export` | Export user data — JSON (default) or CSV (`?format=csv`) |

### GET /api/data/export

**Auth:** `authenticateJWT` + `requireFeature('data.export')`. Both formats share the same gate — the CSV path adds no new route, no new query, and no new data source.

**Query parameters**

| Parameter | Type | Required | Values | Default | Description |
|-----------|------|----------|--------|---------|-------------|
| `format` | string | no | `json`, `csv` | `json` | Response format. Any value other than `csv` produces the JSON envelope. |

---

#### format=json (default)

Returns the v7 JSON backup envelope — tasks, config, locations, tools, and projects — suitable for round-trip import via `POST /api/data/import`.

**Response**

```
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "version": 7,
  "extraTasks": [ ... ],
  "config": { ... },
  "locations": [ ... ],
  "tools": [ ... ],
  "projects": [ ... ]
}
```

#### format=csv

Returns the authenticated user's **tasks only** as RFC-4180 CSV. Config, locations, tools, and projects are not included (use `format=json` for a full backup).

**Response**

```
HTTP/1.1 200 OK
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="juggler-tasks.csv"
```

**Columns (fixed order)**

| # | Column | Source field | Notes |
|---|--------|-------------|-------|
| 1 | `id` | `task.id` | |
| 2 | `text` | `task.text` | |
| 3 | `taskType` | `task.taskType` | |
| 4 | `status` | `task.status` | |
| 5 | `pri` | `task.pri` | |
| 6 | `project` | `task.project` | |
| 7 | `dur` | `task.dur` | Duration in minutes |
| 8 | `scheduledAt` | `task.scheduledAt` | UTC ISO timestamp |
| 9 | `date` | `task.date` | |
| 10 | `time` | `task.time` | |
| 11 | `deadline` | `task.deadline` | |
| 12 | `startAfter` | `task.startAfter` | |
| 13 | `recurring` | `task.recurring` | |
| 14 | `location` | `task.location` | Array joined with `;` |
| 15 | `tools` | `task.tools` | Array joined with `;` |
| 16 | `notes` | `task.notes` | |
| 17 | `url` | `task.url` | |
| 18 | `completedAt` | `task.completedAt` | UTC ISO timestamp |

**Encoding rules (applied in order)**

1. `null` / `undefined` → empty cell (no quotes, no content).
2. Boolean → `true` or `false`.
3. Number → decimal string (`String(n)`).
4. Array fields (`location`, `tools`) → elements joined with `;`, then the joined string is processed through the steps below.
5. CSV formula-injection guard (OWASP): if a cell's first **non-whitespace** character is a spreadsheet formula trigger (`=`, `+`, `-`, `@`) — or its first character is a leading `\t`/`\r` — the cell is prefixed with a single quote (`'`) so spreadsheet clients (Excel, LibreOffice, Google Sheets) treat it as text and never execute it. The first-non-whitespace check defeats the leading-whitespace bypass (e.g. `" =HYPERLINK(...)"`), since spreadsheets strip leading whitespace before formula evaluation.
6. RFC-4180 escaping: a cell value is wrapped in double-quotes if it contains `,`, `"`, `\n`, or `\r`; any `"` inside a quoted field is doubled to `""`. Lines are terminated with `\r\n` (RFC-4180 §2). (Applied after the injection guard, so a neutralized cell that also contains a comma is still quoted correctly.)

**Empty export**

If the user has no tasks, the response is a header-only CSV (one line, `\r\n` terminated).

**Example (two tasks)**

```csv
id,text,taskType,status,pri,project,dur,scheduledAt,date,time,deadline,startAfter,recurring,location,tools,notes,url,completedAt
42,Buy groceries,one-off,pending,P2,Personal,30,,6/15,10:00 AM,,,,,,,https://example.com,
99,"Plan Q3, review",one-off,done,P1,Work,60,2026-06-14T14:00:00Z,,,,,,,,,2026-06-14T15:00:00Z
```

**Error responses**

| Status | Condition |
|--------|-----------|
| `401` | Missing or expired JWT |
| `403` | `data.export` feature not enabled on the user's plan |
| `500` | Internal server error |

---

### POST /api/data/import — CSV path

**Auth:** `authenticateJWT` (all tiers — no `requireFeature` gate). Import is available on every plan.

**Body size cap:** 2 MB (enforced by the `express.text` / `bodyParser.json` mounts in `app.js` before the route handler; oversized bodies are rejected with `413` before any parsing).

#### Triggering the CSV path

The CSV path is selected when **either** of the following conditions is true:

- The `Content-Type` request header is `text/csv` (preferred — lets the body parser populate `req.body` as the raw CSV string).
- The query parameter `?format=csv` is present (regardless of `Content-Type`).

When neither condition is met the request is handled as JSON (the pre-existing path, unchanged).

#### Request

```http
POST /api/data/import
Authorization: Bearer <JWT>
Content-Type: text/csv

id,text,taskType,status,pri,project,dur,scheduledAt,date,time,deadline,startAfter,recurring,location,tools,notes,url,completedAt
,Buy groceries,one-off,pending,P2,Personal,30,,6/15,10:00 AM,,,,Home,,Need oat milk,,
```

- The body must be valid RFC-4180 CSV.
- The header row must contain a `text` column (the only required column). All other columns from the 18-column export schema are optional — unrecognised columns are rejected.
- Rows where the `text` cell is empty are silently skipped.
- The `id` column may be omitted or left blank; the server assigns a synthetic id per row and then fabricates a final unique DB id at insert time (no collision with existing tasks).

#### Merge semantics

CSV import is **always additive (merge mode)**. The mode is hard-forced to `merge` in the controller regardless of any `?mode=` query parameter — a task-only CSV cannot carry the config, projects, and locations needed to drive a safe destructive replace. Concretely:

- Existing tasks and configuration are **never wiped**.
- Each CSV row is inserted as a **new** task with a freshly fabricated id.
- Imported tasks are appended to — not merged into — the existing task set.
- The `?confirm=delete_all` parameter has no effect on CSV imports.

#### Round-trip with CSV export

The CSV format produced by `GET /api/data/export?format=csv` is the canonical input format for this endpoint. The 18 columns are identical, encoding rules are exact inverses:

| Export rule | Import inverse |
|-------------|---------------|
| `null`/`undefined` → empty cell | Empty cell → field omitted from task object |
| Array fields joined with `;` | `;`-delimited string split back to array |
| Formula-injection guard: leading `'` prepended when first non-whitespace char is `=`, `+`, `-`, `@`, `\t`, or `\r` | Leading `'` stripped **only** when `str[1]` is one of those trigger chars — genuine apostrophe-led values (`'tis`, `'90s`) are preserved |
| `recurring`: `true` or `false` | `'true'` → `true`; anything else → `false` |

**Known limitation — semicolons in names.** The `location` and `tools` arrays are joined and split on `;`. A location or tools name that itself contains a `;` character will be mis-split on import, producing extra spurious array elements. This is an inherent ambiguity of the `;` separator convention; such names are **not round-trip-safe**. Workaround: avoid `;` in location and tools names.

#### Response

On success the response mirrors the JSON import envelope:

```
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{ "ok": true }
```

(The exact body shape is owned by `facade.importData`; the HTTP status is always `200` on a clean merge.)

#### Error responses

| Status | Condition | Body |
|--------|-----------|------|
| `400 Bad Request` | Malformed CSV: unbalanced quotes, ragged row (cell count differs from header count), missing `text` header column, or body is not a string. Zero DB writes on any parse error. | `{ "error": "Invalid CSV: <descriptive message>" }` |
| `401 Unauthorized` | Missing or expired JWT | Standard auth error |
| `413 Payload Too Large` | Body exceeds the 2 MB cap | Standard Express body-parser error |
| `500 Internal Server Error` | Unexpected server error after a successful parse | `{ "error": "Import failed" }` |

#### Example — import a single task via curl

```bash
curl -s -X POST http://localhost:5002/api/data/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/csv" \
  --data-binary $'id,text,taskType,status,pri,project,dur,scheduledAt,date,time,deadline,startAfter,recurring,location,tools,notes,url,completedAt\r\n,Buy groceries,one-off,pending,P2,Personal,30,,6/15,10:00 AM,,,,,,,https://example.com,\r\n'
```

Or equivalently, sending an exported CSV file back:

```bash
curl -s -X POST "http://localhost:5002/api/data/import?format=csv" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/csv" \
  --data-binary @juggler-tasks.csv
```

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

## Browser Error Capture

```http
POST /api/client-errors
Content-Type: application/json
```

**Authentication:** None. The endpoint is unauthenticated by design — browser errors can occur before the user logs in or on any page where the token is not available. Abuse is bounded by a rate limiter and a body-size cap instead.

**Purpose:** Passive ingest of uncaught browser errors and unhandled promise rejections from the juggler frontend. The frontend `errorReporter.js` module ships each event here; the backend appends one sanitized line to `browser-errors.log`, which the log-triage skill mines on its next run to file backlog items.

### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | **yes** | Error message text. Missing or blank → 400. |
| `source` | string | no | Script URL where the error originated. |
| `lineno` | number | no | Line number in the source file. |
| `colno` | number | no | Column number in the source file. |
| `stack` | string | no | Stack trace (truncated to 2000 chars by the frontend). |
| `kind` | string | no | `"error"` (uncaught) or `"unhandledrejection"`. Defaults to `"error"` if omitted. |
| `userAgent` | string | no | Client browser User-Agent string; appended to the log line as `ua=…` and capped at 160 chars. |
| `url` | string | no | Page URL where the error occurred. |
| `ts` | number/string | no | Client-side timestamp (informational; not used in log line). |

Fields are per-field capped at 2000 characters (40 chars for `kind`). All fields are control-character-stripped before writing: no newline in any field can forge an extra log line (log-injection defence).

### Example request

```json
{
  "message": "Cannot read properties of undefined (reading 'id')",
  "source": "http://localhost:3002/static/js/main.chunk.js",
  "lineno": 1,
  "colno": 4821,
  "stack": "TypeError: Cannot read properties of undefined\n    at TaskList ...",
  "kind": "error",
  "url": "http://localhost:3002/tasks"
}
```

### Responses

| Status | Condition | Body |
|--------|-----------|------|
| `204 No Content` | Log line written successfully. | *(empty)* |
| `400 Bad Request` | Missing or blank `message`, or malformed JSON body. | `{ "error": "invalid payload: message required" }` or `{ "error": "malformed body" }` |
| `413 Payload Too Large` | Body exceeds the 16 KB mount-level limit. | `{ "error": "payload too large" }` |
| `429 Too Many Requests` | Per-IP rate limit exceeded (30 requests/60 s). | Standard `express-rate-limit` response. |
| `500 Internal Server Error` | `fs.appendFile` failed (disk full, permission error). | `{ "error": "log write failed" }` |

### Security posture

- **Log-injection neutralized:** all C0/C1 control characters (CR, LF, TAB, NUL, DEL) plus Unicode line/paragraph separators (U+2028, U+2029) are stripped from every field before the log line is assembled. A crafted `message` containing newlines cannot forge additional log entries.
- **Abuse bounded:** body size is capped at 16 KB at the `express.json` mount layer (not inside the handler, so oversized bodies are rejected before any parsing). Per-IP rate limit: 30 requests per 60-second window (`express-rate-limit`, per-instance).
- **Log rotation:** the log file is rotated (renamed to `.1`) when it exceeds 5 MB; at most one backup is kept, bounding total disk use to approximately 10 MB.
- **No secrets logged:** the handler does not read or log `Authorization` headers, cookies, or any request header. Per-field char caps limit the surface area for PII leakage from error text.

### Log-triage pipeline integration

The written line format is:

```text
ERROR [browser] <kind>: <message> at <source>:<lineno> ua=<userAgent>
```

The leading `ERROR [browser]` token matches the log-triage collector's error-level pattern. The `kind` and `source` fields give the fingerprinter a stable `error_type` + `source_location` so identical errors across sessions collapse to a single backlog item. The log file (`browser-errors.log`) lives under `juggler/juggler-backend/` and is covered by the existing `juggler/juggler-backend/*.log` glob in `.planning/log-monitor/config.json` — no config change required.

See `~/.claude/skills/log-triage/SKILL.md` for how the triage pipeline ingests and deduplicates the log.

### Environment variable

| Variable | Default | Description |
|----------|---------|-------------|
| `BROWSER_ERRORS_LOG` | `<juggler-backend-root>/browser-errors.log` | Absolute path to the browser-errors log file. Override in test environments to isolate output. |

---

## Error Codes

| Code | Meaning |
|------|---------|
| `400` | Invalid input or validation failure |
| `401` | Missing or expired JWT |
| `403` | Feature gated (plan limit reached) |
| `404` | Resource not found |
| `413` | Payload too large (body exceeds endpoint's size cap) |
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

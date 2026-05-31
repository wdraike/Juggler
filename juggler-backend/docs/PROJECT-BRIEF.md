---
type: project-brief
service: juggler
status: active
last_updated: 2026-05-31
tags:
  - type/project-brief
  - service/juggler
  - status/active
  - tasks
  - scheduler
  - calendar-sync
---

# Juggler — Project Brief

**Last Updated:** 2026-05-31
**Location:** `juggler/`

---

## Purpose

Juggler is an AI-assisted task and calendar management service. It lets users capture tasks, set scheduling constraints, and have a constraint-solving scheduler automatically place tasks into the most appropriate time slots. Calendar sync keeps Juggler tasks and external calendar events (Google, Microsoft, Apple) in bi-directional sync.

---

## Users

- **End users** — Manage tasks, projects, scheduling constraints, and calendar connections
- **ClimbRS** — External MCP client that uses juggler-mcp (stdio) to manage tasks via Claude
- **auth-service** — Validates JWTs for all authenticated routes
- **payment-service** — Provides subscription entitlement checks for feature gating

---

## Capabilities

| Feature | Description |
|---------|-------------|
| **Task management** | Create, update, delete tasks with priorities, durations, due dates, dependencies |
| **Scheduler** | Constraint-based placement engine (most-constrained-first); handles recurring tasks, splits, dependencies |
| **Calendar sync** | Bi-directional sync with Google Calendar, Microsoft Calendar (Outlook), and Apple CalDAV |
| **Projects** | Group tasks by named project; optional color and icon |
| **AI enrichment** | Gemini-powered AI commands for task suggestions and enrichment |
| **Weather integration** | Weather-aware scheduling — tasks can declare precipitation, cloud, or temperature preferences |
| **MCP server** | Embedded `POST /mcp` endpoint (Streamable HTTP) exposing task/schedule tools to MCP clients |
| **External MCP client** | `juggler-mcp/` stdio server for Claude Code integration |
| **SSE push** | Real-time schedule updates pushed to connected frontends via Server-Sent Events |

---

## Tech Stack

- **Runtime:** Node.js, Express
- **Database:** MySQL with Knex.js migrations
- **Auth:** JWT via auth-service (JWKS endpoint)
- **Calendar APIs:** Google Calendar, Microsoft Graph, CalDAV (Apple)
- **AI:** Google Gemini API (via `@google/generative-ai`)
- **MCP:** `@modelcontextprotocol/sdk` (stateless Streamable HTTP transport)
- **Cache:** Redis (rate limiting for AI routes; SSE fan-out across instances)
- **Deploy:** GCP Cloud Run

---

## Ports

| Environment | Frontend | Backend |
|-------------|---------|---------|
| Local dev | port 3003 | port 5002 |
| Test-bed | port 3003 | port 5002 |
| Production (GCP Cloud Run) | CDN | — |

DB port: 3407 (dev/test Docker MySQL), 3307 (GCP Cloud SQL Proxy)

---

## Service Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `juggler-backend/` | `juggler/juggler-backend/` | Node.js/Express REST API + MCP server |
| `juggler-frontend/` | `juggler/juggler-frontend/` | React frontend (port 3003) |
| `juggler-mcp/` | `juggler/juggler-mcp/` | stdio MCP server for Claude Code |
| `auth-client/` | `juggler/auth-client/` | Shared JWT auth module |
| `lib-logger/` | `juggler/lib-logger/` | Shared structured logger |

---

## Key Concepts

| Term | Meaning |
|------|---------|
| `task_masters` | User intent — the logical task with its constraints |
| `task_instances` | Scheduler-placed occurrences (one per occurrence for one-offs, N for recurring/split) |
| `tasks_v` | View joining masters and instances for all read paths |
| `cal_sync_ledger` | Current bi-directional sync state per (task, provider event) |
| `schedule_queue` | Debounce queue that triggers scheduler runs after mutations |
| `placement_mode` | How the scheduler treats a task: `anytime`, `fixed`, `all_day`, `time_window`, `time_blocks`, `marker` |

---

## Related Services

- [[auth-service]] — JWT issuance and validation
- [[payment-service]] — Subscription feature gating

---

## API Overview

| Prefix | Description |
|--------|-------------|
| `POST /mcp` | MCP Streamable HTTP endpoint (task and schedule tools) |
| `/api/tasks` | Task CRUD, batch operations |
| `/api/schedule` | Schedule run, placements, nudge |
| `/api/projects` | Project CRUD |
| `/api/config` | User configuration (time blocks, preferences, locations, tools) |
| `/api/cal` | Calendar sync (run, history, audit) |
| `/api/gcal` | Google Calendar OAuth + sync |
| `/api/msft-cal` | Microsoft Calendar OAuth + sync |
| `/api/apple-cal` | Apple CalDAV OAuth + sync |
| `/api/ai` | AI command endpoint (Gemini) |
| `/api/weather` | Weather forecast (cached Open-Meteo) |
| `/api/auth/me` | Current user profile |
| `/api/events` | SSE real-time stream |

No OpenAPI spec exists yet. See `docs/api/README.md` for a fuller endpoint reference.

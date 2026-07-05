---
type: mcp
service: juggler
status: active
last_updated: 2026-05-19
tags:
  - type/mcp
  - service/juggler
  - status/active
  - mcp
  - tooling
  - scheduler
---

# MCP Server — Juggler

**Last Updated:** 2026-05-18  
**Location:** `juggler/juggler-mcp/index.js`  
**Configuration:** `.mcp.json` in project root or `.claude/settings.json`

---

## Purpose

Exposes Juggler scheduler capabilities to Claude Code. Create/list/update tasks, manage projects, query schedule — all via natural language.

## Available Tools

| Tool | Args | Description | Example |
|------|------|-------------|---------|
| `list_tasks` | status, project, date, limit | List tasks with filters | `list_tasks(status="pending", limit=10)` |
| `create_task` | text, project, pri, dur, when, dependsOn, scheduledAt, deadline | Create a task with full scheduling options | `create_task(text="Write tests", project="auth", pri=2, dur=60)` |
| `update_task` | id, text, status, pri, dur, project | Update existing task | `update_task(id="abc123", status="completed")` |
| `delete_task` | id | Delete task by ID | `delete_task(id="abc123")` |
| `add_dependency` | taskId, dependsOnId | Add task dependency | `add_dependency(taskId="A", dependsOnId="B")` |
| `remove_dependency` | taskId, dependsOnId | Remove task dependency | `remove_dependency(taskId="A", dependsOnId="B")` |
| `list_projects` | — | List all projects | `list_projects()` |
| `create_project` | name, color | Create new project | `create_project(name="Q3 Goals", color="blue")` |
| `update_project` | name, color | Update project | `update_project(name="Q3 Goals", color="green")` |
| `delete_project` | name | Delete project | `delete_project(name="Old Project")` |
| `get_schedule` | date, project | Get scheduled tasks for date | `get_schedule(date="5/18")` |
| `update_schedule` | taskId, date, time | Update task schedule | `update_schedule(taskId="abc", date="5/19", time="2:00 PM")` |

## Configuration

### Required Environment Variables

```bash
JUGGLER_API_URL=http://localhost:5002
JUGGLER_TOKEN=<jwt-token>
```

### Get Token

Mint an MCP API key via auth-service's AccountSecurityPage UI (log in, then
Account Security → API Keys → create a key of type `mcp`) and use it as
`JUGGLER_TOKEN` — no browser localStorage scraping required.

### settings.json Entry

```json
{
  "mcpServers": {
    "juggler": {
      "command": "node",
      "args": ["juggler-mcp/index.js"],
      "env": {
        "JUGGLER_API_URL": "http://localhost:5002",
        "JUGGLER_TOKEN": "eyJhbGc..."
      }
    }
  }
}
```

## Usage Examples

### Create a Task with Deadline

```
Create a task "Deploy to staging" with priority 1, duration 2 hours, deadline 2026-05-20
```

**Claude calls:**
```javascript
create_task({
  text: "Deploy to staging",
  pri: 1,
  dur: 120,
  deadline: "2026-05-20"
})
```

### List Pending Tasks for Project

```
Show me pending tasks for the auth project
```

**Claude calls:**
```javascript
list_tasks({ status: "pending", project: "auth", limit: 20 })
```

### Add Dependency

```
Make task B depend on task A completing first
```

**Claude calls:**
```javascript
add_dependency({ taskId: "B", dependsOnId: "A" })
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `No JUGGLER_TOKEN set` | Token not in env or file | Set `JUGGLER_TOKEN` env var or create `~/.juggler-mcp-token` |
| `API 401` | Key expired or revoked | Mint a new MCP API key via auth-service's AccountSecurityPage UI |
| `API 404` | Wrong JUGGLER_API_URL | Verify backend is running on correct port |
| Tool not found | MCP not in settings.json | Add config to `.claude/settings.json` or project `.mcp.json` |

## Related Documentation

- [[juggler-project-brief]] — Juggler service overview
- [[juggler-api-reference]] — API endpoints this MCP wraps
- [[juggler-architecture-overview]] — Scheduler architecture

---

**Maintainer:** @W. David Raike

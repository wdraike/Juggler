---
type: project-brief
service: juggler
status: active
last_updated: 2026-05-19
tags:
  - type/project-brief
  - service/juggler
  - status/active
  - scheduler
  - task-management
  - time-tracking
---

# Juggler — Project Brief

**Last Updated:** 2026-05-18  
**Location:** `juggler/`

---

## Purpose

Juggler is a full-stack task scheduler and time-tracking application. Helps users manage projects, schedule tasks with time estimates, track actual time spent, and visualize workload via calendar integration.

---

## Users

- **Individual contributors** — Track tasks, manage time, plan sprints
- **Team leads** — View team workload, assign tasks, monitor progress
- **Freelancers** — Billable hour tracking, project estimation

---

## Capabilities

| Feature | Description |
|---------|-------------|
| **Task Management** | Create, update, delete tasks with priority, duration, deadlines |
| **Project Tracking** | Organize tasks into projects with color coding |
| **Time Tracking** | Clock in/out, log actual vs estimated time |
| **Calendar Integration** | iCal/CalDAV sync, visualize tasks alongside meetings |
| **Scheduling** | Drag-and-drop scheduling, dependency management |
| **Reports** | Time reports, project burn-down, capacity planning |

---

## Tech Stack

### Backend
- **Runtime:** Node.js, Express
- **Database:** MySQL (via Knex ORM)
- **Auth:** JWT via auth-service
- **Cache:** Redis (rate limiting, sessions)
- **AI:** Google GenAI (task suggestions, time estimates)
- **Calendar:** iCal.js, tsdav (CalDAV)

### Frontend
- **Framework:** React
- **State:** Custom hooks
- **UI:** Custom components with calendar integration

### DevOps
- **Deploy:** GCP Cloud Run
- **Testing:** Jest (unit), Playwright (E2E)

---

## Related Services

- [[auth-service]] — JWT authentication
- [[payment-service]] — Subscription billing (if monetized)

---

## MCP Integration

Juggler exposes an MCP server for Claude Code task management. See [[juggler-mcp-doc]].

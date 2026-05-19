---
type: api-reference
service: juggler
status: active
last_updated: 2026-05-19
tags:
  - type/api-reference
  - service/juggler
  - status/active
  - api
  - reference
---

# Juggler — API Reference

**Last Updated:** 2026-05-18  
**Base URL:** `http://localhost:5002` (dev) | `https://juggler-<hash>-uc.a.run.app` (prod)

---

## Authentication

All endpoints require JWT authentication:

```bash
Authorization: Bearer <JWT_TOKEN>
```

Token obtained via [[auth-service]] login flow.

---

## Endpoints

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tasks` | List tasks (filter: status, project, date) |
| `POST` | `/api/tasks` | Create new task |
| `GET` | `/api/tasks/:id` | Get task by ID |
| `PUT` | `/api/tasks/:id` | Update task |
| `DELETE` | `/api/tasks/:id` | Delete task |
| `POST` | `/api/tasks/:id/dependency` | Add dependency |
| `DELETE` | `/api/tasks/:id/dependency` | Remove dependency |

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects` | Create project |
| `PUT` | `/api/projects/:name` | Update project |
| `DELETE` | `/api/projects/:name` | Delete project |

### Schedule

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/schedule/:date` | Get scheduled tasks for date |
| `PUT` | `/api/schedule/:taskId` | Update task schedule |

### Time Tracking

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/time/clock-in` | Start time tracking |
| `POST` | `/api/time/clock-out` | Stop time tracking |
| `GET` | `/api/time/logs/:taskId` | Get time logs for task |

---

## OpenAPI Spec

Full spec: `juggler/juggler-backend/openapi.yaml`

---

## Rate Limiting

- **Default:** 100 requests/minute per IP
- **Authenticated:** 1000 requests/minute per user
- **Headers:** `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## Error Codes

| Code | Meaning |
|------|---------|
| `400` | Invalid input (Zod validation failed) |
| `401` | Missing or expired JWT |
| `403` | Insufficient permissions |
| `404` | Task/project not found |
| `409` | Conflict (duplicate project, circular dependency) |
| `429` | Rate limit exceeded |

---

## Related Documentation

- [[auth-service-api-reference]] — Authentication details
- [[juggler-mcp-doc]] — MCP tools wrapping this API

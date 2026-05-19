---
type: architecture
service: juggler
status: active
last_updated: 2026-05-19
tags:
  - type/architecture
  - service/juggler
  - status/active
  - architecture
  - c4
  - diagram
---

# Juggler — Architecture Overview

**Last Updated:** 2026-05-18  
**Level:** C4 System Context + Container

---

## System Context (C4 Level 1)

```mermaid
flowchart TD
    subgraph Juggler["Juggler Application"]
        BE[Backend API]
        FE[React Frontend]
        MCP[MCP Server]
    end
    
    User[User] --> FE
    User --> MCP
    Claude[Claude Code] --> MCP
    
    subgraph External["External Services"]
        Auth[auth-service]
        Stripe[Stripe]
        CalDAV[CalDAV/iCal Servers]
    end
    
    BE --> Auth
    BE --> CalDAV
    BE --> DB[(MySQL)]
    
    FE --> BE
    MCP --> BE
```

---

## Container Diagram (C4 Level 2)

```mermaid
flowchart LR
    subgraph Backend["Backend API"]
        R[Routes/Controllers]
        S[Services]
        K[Knex DB Layer]
        M[MSAL Auth]
        G[Google GenAI]
        C[CalDAV Client]
    end
    
    subgraph Frontend["Frontend"]
        Cmp[Components]
        Hks[Hooks]
        Cal[Calendar UI]
    end
    
    subgraph MCP["MCP Server"]
        T[Tools]
        H[HTTP Handler]
    end
    
    Frontend --> R
    MCP --> R
    R --> S
    S --> K
    S --> M
    S --> G
    S --> C
    K --> DB[(MySQL)]
```

---

## Key Components

| Component | Responsibility |
|-----------|---------------|
| **Routes/Controllers** | HTTP endpoints, request validation (Zod), rate limiting |
| **Services** | Business logic: task CRUD, scheduling, time tracking |
| **Knex DB Layer** | Query builder, migrations, seed data |
| **MSAL Auth** | Microsoft Entra ID integration (optional SSO) |
| **Google GenAI** | Task description suggestions, time estimates |
| **CalDAV Client** | Calendar sync, iCal import/export |
| **MCP Tools** | `list_tasks`, `create_task`, `update_schedule`, etc. |

---

## Data Model (Simplified)

```mermaid
classDiagram
    class Task {
        +string id
        +string text
        +string project
        +int priority
        +int duration_min
        +datetime scheduled_at
        +datetime deadline
        +string status
    }
    
    class Project {
        +string name
        +string color
    }
    
    class TimeLog {
        +string task_id
        +datetime started_at
        +datetime ended_at
        +int duration_min
    }
    
    Task "1" --> "1" Project : belongs to
    Task "1" --> "0..*" TimeLog : has logs
```

---

## Related Documentation

- [[juggler-api-reference]] — API endpoints
- [[juggler-mcp-doc]] — MCP server tools

# Knowledge Map

Index of what's stored where. Maintained by Scooter.

## Knowledge Graph (Curated Facts)

Location: `~/.mempalace/knowledge_graph.sqlite3`

### Entities (by type)

| Type | Names |
|------|-------|
| product | Juggler |
| service | juggler-backend, juggler-frontend, juggler-mcp |
| component | scheduler |
| technology | MySQL, React, Node.js, Knex.js |

### Predicates (vocabulary)

| Predicate | Meaning | Single/Multi |
|-----------|---------|--------------|
| `is_product_slug` | Product identifier | single |
| `is_service_of` | Service belongs to product | multi |
| `uses_port` | Service port | single |
| `db_port_local` | Local DB port | single |
| `db_port_prod` | Production DB port | single |
| `uses_stack` | Technology in stack | multi |
| `is_component_of` | Component belongs to product | multi |
| `core_principle` | Core design principle | single |
| `severity_hierarchy` | Priority ordering | single |
| `entry_point` | Main file | single |
| `task_type` | Task type terminology | multi |

### Triple Count

Run `sqlite3 ~/.mempalace/knowledge_graph.sqlite3 "SELECT COUNT(*) FROM triples;"` for current count.

---

## Authoritative Documents (Source Files)

| Kind | Path | Notes |
|------|------|-------|
| Stack | `CLAUDE.md` | Ports, technologies, scheduler principles |
| Scheduler | `docs/SCHEDULER.md` | Full design doc |
| Task Properties | `docs/TASK-PROPERTIES.md` | All task fields |
| State Matrix | `docs/TASK-STATE-MATRIX.md` | Valid transitions |
| NFR | `docs/NFR.md` | Non-functional requirements |
| Project Brief | `docs/PROJECT-BRIEF.md` | Use cases, scope |
| Architecture | `docs/architecture/` | ADRs, C4 diagrams |

---

## Domain Rules (per-domain decisions)

| Domain | Skill | Notes |
|--------|-------|-------|
| Auth | `auth-rules` | Authentication/authorization decisions |
| Calendar | `calendar-rules` | Calendar sync decisions |
| Extraction | `extraction-rules` | Data extraction decisions |
| JD | `jd-rules` | Job description domain |
| Keywords | `keywords-rules` | Keyword handling |
| Resume | `resume-rules` | Resume domain |
| Scheduler | `scheduler-rules` | Scheduler domain |

---

## Vault (Long-term Memory)

Obsidian vault: `~/Library/Mobile Documents/iCloud~md~obsidian~document/Documents/`

Access via: `Skill("vault-recall") with "<topic> --service=<svc>"`

---

## INBOX (Pending Changes)

Location: `.planning/scooter/INBOX.md`

Pending notices waiting for reconcile.

---

## Last Audit

Run `scooter --audit` to refresh this map.
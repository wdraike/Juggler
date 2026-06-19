---
version: 1.1.0
status: active
last_updated: 2026-06-18
service: juggler
---

# User Stories — Juggler

## Story Inventory

| ID | Story | Requirements | Priority | Status |
|----|-------|-------------|----------|--------|
| US-1 | Create and manage tasks | R1.1–R1.10, R2.1–R2.8, R3.1–R3.3, R6.1–R6.6, R16.1–R16.3, R23.1–R23.4, R29.1–R29.3 | P1 — Core | Partial |
| US-2 | Organize work into projects | R4.1–R4.5, R5.1 | P1 — Core | Implemented |
| US-3 | View schedule in multiple calendar layouts | R8.1–R8.8 | P2 — Important | Implemented |
| US-4 | Interact with the calendar via drag-and-drop | R9.1–R9.3 | P2 — Important | Partial |
| US-5 | Run the daily scheduler | R11.1–R11.22, R21.1–R21.3, R26.1–R26.4, R37.1–R37.3, R39.1–R39.5, R40.1–R40.3, R41.1–R41.5 | P1 — Core | Partial |
| US-6 | Set up recurring tasks | R18.1–R18.8, R32.1–R32.7, R33.1–R33.5, R34.1–R34.5 | P2 — Important | Implemented |
| US-7 | Split large tasks across time blocks | R19.1–R19.7, R35.1–R35.6 | P2 — Important | Partial |
| US-8 | Sync with external calendars | R7.1–R7.8, R30.1–R30.2 | P1 — Core | Implemented |
| US-9 | Use AI to manage tasks with natural language | R15.1–R15.5 | P3 — Enhancement | Implemented |
| US-10 | Export and import my data | R22.1–R22.5 | P3 — Enhancement | Implemented |
| US-11 | Configure locations, tools, and weather constraints | R20.1–R20.4, R25.1–R25.5, R27.1–R27.3, R38.1–R38.4 | P2 — Important | Partial |
| US-12 | Control Juggler via MCP tools | R17.1–R17.2 | P3 — Enhancement | Partial |
| US-13 | Manage my subscription plan | R24.1–R24.6 | P3 — Enhancement | Implemented |
| US-14 | Administer the system | R28.1–R28.3 | P4 — Admin | Partial |
| US-15 | Customize my preferences | R31.1–R31.5 | P2 — Important | Implemented |
| US-16 | Chain tasks with dependencies | R10.1–R10.5, R36.1–R36.3 | P2 — Important | Partial |
| US-17 | Generate reports on time and workload | R12.1, R13.1, R14.1 | P4 — Planned | Planned |

## Stories

### US-1: Create and manage tasks

**As a** knowledge worker
**I want** to create, update, organize, and track the status of my tasks with priorities, durations, and deadlines
**So that** I can capture work as it arrives, keep my workload visible, and know what to do next.

**Acceptance (story-level):**
- I can create a task in under 5 seconds from any view, providing a description, priority, and time estimate
- I can update any field on an existing task — text, priority, duration, deadline, status, or scheduling constraints
- I can delete a task I no longer need
- I can change a task's status through its lifecycle: todo → in-progress → done (or paused/cancelled/disabled)
- I can see how much time remains on an in-progress task against my original estimate
- I can disable a task to hide it temporarily and re-enable it later when I have capacity
- I can create up to 500 tasks or update up to 2000 tasks in a single batch operation
- I can authenticate once and access all task features without re-entering credentials

**Mapped requirements:** R1.1–R1.10, R2.1–R2.8, R3.1–R3.3, R6.1–R6.6, R16.1–R16.3, R23.1–R23.4, R29.1–R29.3

**Priority:** P1 — Core
**Status:** Partial

---

### US-2: Organize work into projects

**As a** knowledge worker
**I want** to group my tasks into named, color-coded projects
**So that** I can visually distinguish client work, personal tasks, and side projects at a glance.

**Acceptance (story-level):**
- I can create a project with a unique name and assign a color to it
- I can rename a project or change its color at any time
- I can reorder my projects in the sidebar to match my priorities
- When I batch-create tasks referencing a new project name, the project is created automatically
- I can filter my task list and calendar views by project

**Mapped requirements:** R4.1–R4.5, R5.1

**Priority:** P1 — Core
**Status:** Implemented

---

### US-3: View schedule in multiple calendar layouts

**As a** knowledge worker
**I want** to see my scheduled tasks and synced calendar events in daily, weekly, three-day, timeline, list, S-curve, priority-kanban, and dependency-graph views
**So that** I can choose the right perspective for planning my day, reviewing my week, or spotting bottlenecks.

**Acceptance (story-level):**
- I can switch between at least 8 calendar views with one click
- In the daily view, tasks and events appear on the correct time slots in a time-proportional grid
- In the weekly view, I can see all seven days at once with tasks in their correct day columns
- In the priority view, tasks are organized in P1–P4 kanban columns so I can see what's urgent
- In the dependency graph view, I can see which tasks block others as a visual chain
- Synced external calendar events appear alongside my tasks in every chronological view

**Mapped requirements:** R8.1–R8.8

**Priority:** P2 — Important
**Status:** Implemented

---

### US-4: Interact with the calendar via drag-and-drop

**As a** knowledge worker
**I want** to reschedule tasks by dragging them on the calendar grid, change priorities by dragging between kanban columns, and create dependency links by dragging between task nodes
**So that** I can reorganize my day as quickly as I can think, without opening edit forms.

**Acceptance (story-level):**
- I can drag a task from one time slot to another on the daily/weekly grid and have it reschedule instantly
- I can drag a task card from the P2 column to the P1 column in the priority view and have its priority update
- I can drag a connector from one task node to another in the dependency graph to create a "depends on" link
- After any drag operation, the change is persisted and reflected in all views

**Mapped requirements:** R9.1–R9.3

**Priority:** P2 — Important
**Status:** Partial

---

### US-5: Run the daily scheduler

**As a** knowledge worker
**I want** the system to automatically place my tasks into optimal time slots based on my availability, constraints, and priorities
**So that** I don't have to manually figure out what fits where, and I can trust that my day is packed efficiently without overcommitment.

**Acceptance (story-level):**
- I can press "Run Schedule" and see my tasks placed across my available working hours within seconds
- Fixed-time tasks (appointments, meetings) stay exactly where I put them and are never moved
- Tasks with deadlines are prioritized over tasks without deadlines
- If a task can't fit in its preferred time window, the scheduler tries looser placement before giving up
- Tasks I can't get to today are clearly flagged with a reason (e.g., "no available time block")
- I can define my working hours by day type (weekday, weekend, remote) and the scheduler respects them
- I can set a "start no earlier than" date on a task and the scheduler won't place it before then
- When I change my working hours or task constraints, the schedule re-runs automatically
- The scheduler considers all my constraints together: time blocks, locations, tools, weather, travel time, dependencies, and recurring patterns

**Mapped requirements:** R11.1–R11.22, R21.1–R21.3, R26.1–R26.4, R37.1–R37.3, R39.1–R39.5, R40.1–R40.3, R41.1–R41.5

**Priority:** P1 — Core
**Status:** Partial

---

### US-6: Set up recurring tasks

**As a** knowledge worker
**I want** to define tasks that repeat daily, weekly, biweekly, monthly, on a custom interval, or on a rolling basis after each completion
**So that** I don't have to re-create the same standup, review, or workout task every day.

**Acceptance (story-level):**
- I can set a task to repeat on a schedule: every day, every Monday/Wednesday/Friday, every other week, first of the month, every 3 days, or "3 days after I finish the last one"
- I can say "I want to do this 3 times per week" and let the scheduler pick the best days within that week
- When I mark a recurring instance as done, the next occurrence is scheduled automatically
- When I skip a recurring instance, it doesn't come back on that date
- For rolling tasks (e.g., "mow the lawn every 14 days after last mow"), the next date shifts forward when I complete it
- I can override a single instance's text or time without affecting the rest of the series
- I can cancel a recurring series and all future instances are removed while past completed ones are preserved

**Mapped requirements:** R18.1–R18.8, R32.1–R32.7, R33.1–R33.5, R34.1–R34.5

**Priority:** P2 — Important
**Status:** Implemented

---

### US-7: Split large tasks across time blocks

**As a** knowledge worker
**I want** to break a large task into smaller chunks that can fit into gaps between meetings
**So that** I can make progress on a 4-hour task even on a day full of 30-minute openings.

**Acceptance (story-level):**
- I can toggle "split" on any task and set a minimum chunk size (e.g., 15 minutes)
- The scheduler divides my task into chunks and places them in available gaps throughout the day
- For recurring split tasks, all chunks stay within the recurrence interval (e.g., all chunks of a weekly task finish within that week)
- For one-off split tasks, chunks can span across multiple days if needed
- If chunks can't all fit, the remaining portion is flagged so I know the task isn't fully scheduled
- I can set my preferred default split size in settings so new tasks inherit it

**Mapped requirements:** R19.1–R19.7, R35.1–R35.6

**Priority:** P2 — Important
**Status:** Partial

---

### US-8: Sync with external calendars

**As a** knowledge worker
**I want** to connect my Google, Microsoft, or Apple calendar so my meetings appear alongside my tasks
**So that** I have one unified view of my day and don't double-book myself.

**Acceptance (story-level):**
- I can connect my Google Calendar with a standard OAuth flow in a few clicks
- I can connect my Microsoft/Outlook calendar the same way
- I can connect my Apple/iCloud calendar by entering my CalDAV credentials
- My external events appear on the Juggler calendar grid alongside my tasks
- My scheduled Juggler tasks appear on my external calendar so colleagues can see when I'm busy
- When I sync, changes flow both ways — new external events come in, new Juggler tasks go out
- If I want to reschedule a meeting that came from my external calendar, I can "take ownership" of it to detach it from the source and move it freely

**Mapped requirements:** R7.1–R7.8, R30.1–R30.2

**Priority:** P1 — Core
**Status:** Implemented

---

### US-9: Use AI to manage tasks with natural language

**As a** knowledge worker
**I want** to type or speak commands like "schedule 2 hours for code review tomorrow morning" and have the system create and place the task
**So that** I can capture tasks as fast as I can think, without navigating forms and menus.

**Acceptance (story-level):**
- I can type a natural-language command and have it create, update, reschedule, or status-change a task
- The system suggests a relevant emoji/icon for each task based on its text
- I can use AI commands up to 50 times per day without hitting a limit
- If I exceed the daily quota, I get a clear message telling me when I can use it again

**Mapped requirements:** R15.1–R15.5

**Priority:** P3 — Enhancement
**Status:** Implemented

---

### US-10: Export and import my data

**As a** freelancer or contractor
**I want** to export all my tasks, projects, locations, and configuration as a JSON file and import it back later (or into another account)
**So that** I can back up my data, migrate between accounts, or process my task data in external tools for billing.

**Acceptance (story-level):**
- I can download a complete JSON export of all my Juggler data with one click
- I can import a JSON file and choose whether to merge it with my existing data or replace everything
- If my import file has errors, I get specific messages about what's wrong so I can fix it
- The import validates the data structure so I don't accidentally corrupt my account

**Mapped requirements:** R22.1–R22.5

**Priority:** P3 — Enhancement
**Status:** Implemented

---

### US-11: Configure locations, tools, and weather constraints

**As a** knowledge worker
**I want** to define my work locations (home, office, co-working), the tools available at each (laptop, monitor, phone), and weather-dependent task rules
**So that** the scheduler knows I can't do "deep focus work" at a coffee shop without my monitor, and won't schedule "paint the fence" on a rainy day.

**Acceptance (story-level):**
- I can create named locations with addresses that resolve to coordinates
- I can assign a location to any task
- I can define which tools are available at each location (e.g., "office has laptop + monitor, coffee shop has laptop only")
- I can require specific tools on a task and the scheduler only places it where those tools are available
- The scheduler inserts travel time between consecutive tasks at different locations
- I can see current weather conditions and forecasts for my locations
- I can set a task to "dry weather only" and the scheduler skips rainy time slots
- When weather data is unavailable, weather-constrained tasks are flagged rather than placed blindly

**Mapped requirements:** R20.1–R20.4, R25.1–R25.5, R27.1–R27.3, R38.1–R38.4

**Priority:** P2 — Important
**Status:** Partial

---

### US-12: Control Juggler via MCP tools

**As a** team lead or power user
**I want** to create, update, schedule, and query tasks through structured tool calls from my AI coding assistant or automation scripts
**So that** I can manage my task list without leaving my development environment.

**Acceptance (story-level):**
- I can list, search, create, update, and delete tasks via MCP tool calls
- I can run the scheduler and retrieve my daily schedule as structured data
- I can manage projects and configuration through MCP tools
- I can export my data and check calendar sync status via MCP
- All MCP operations are scoped to my user account — I can only see and modify my own tasks

**Mapped requirements:** R17.1–R17.2

**Priority:** P3 — Enhancement
**Status:** Partial

---

### US-13: Manage my subscription plan

**As a** knowledge worker
**I want** to see my current plan, understand my feature limits, and upgrade when I need more capacity
**So that** I know what I can do on my plan and don't hit unexpected walls.

**Acceptance (story-level):**
- I can view my current plan, its features, and entity limits (max tasks, projects, locations, etc.) at any time
- If I try to use a feature not included in my plan, I get a clear message explaining the restriction
- If I hit an entity limit (e.g., max active tasks), I'm told what the limit is and how to upgrade
- When I upgrade, new features and higher limits take effect immediately
- When I downgrade, excess items are gracefully disabled (newest first) rather than deleted

**Mapped requirements:** R24.1–R24.6

**Priority:** P3 — Enhancement
**Status:** Implemented

---

### US-14: Administer the system

**As an** admin
**I want** to impersonate other users to debug their scheduling issues and audit all impersonation activity
**So that** I can troubleshoot problems without asking users to share their credentials or screen-share.

**Acceptance (story-level):**
- I can start impersonating any user by their ID and see Juggler exactly as they see it
- A visible banner reminds me (and anyone looking over my shoulder) that I'm impersonating
- I can stop impersonating and return to my own account at any time
- I can review a log of all impersonation events — who impersonated whom and when

**Mapped requirements:** R28.1–R28.3

**Priority:** P4 — Admin
**Status:** Partial

---

### US-15: Customize my preferences

**As a** knowledge worker
**I want** to set my timezone, calendar grid zoom level, default split sizes, working-hour boundaries, and font size
**So that** Juggler feels tuned to my workflow and visual comfort.

**Acceptance (story-level):**
- I can set my timezone and all times display correctly for my location
- I can zoom the calendar grid to see more or fewer hours at once
- I can set default split duration and minimum chunk size so new tasks inherit my preferences
- I can define my earliest and latest working hours (schedule floor and ceiling)
- I can adjust the font size for readability
- When I change time-related settings, my schedule re-runs automatically to reflect the new constraints

**Mapped requirements:** R31.1–R31.5

**Priority:** P2 — Important
**Status:** Implemented

---

### US-16: Chain tasks with dependencies

**As a** knowledge worker
**I want** to declare that task B can't start until task A is finished
**So that** the scheduler places them in the right order and I don't accidentally work on something whose prerequisite isn't done.

**Acceptance (story-level):**
- I can link tasks so that one depends on another, forming a chain
- The scheduler always places a dependent task after its predecessor
- If I create a circular dependency (A depends on B which depends on A), the system detects it and flags the tasks rather than crashing
- A task's deadline propagates backward — if the final task is due Friday, earlier tasks in the chain are scheduled with that deadline in mind
- I can see all my dependency chains visualized as a graph with directional arrows
- I cannot add dependencies to recurring tasks (the system tells me why)

**Mapped requirements:** R10.1–R10.5, R36.1–R36.3

**Priority:** P2 — Important
**Status:** Partial

---

### US-17: Generate reports on time and workload

**As a** freelancer or team lead
**I want** to see time reports comparing estimates to actuals, burn-down charts showing progress against deadlines, and capacity forecasts showing how full my future weeks are
**So that** I can bill clients accurately, know if my project is on track, and avoid overcommitting next week.

**Acceptance (story-level):**
- I can request a time report for a date range and see estimated vs. actual hours broken down by project
- I can view a burn-down chart for a project showing remaining work versus time elapsed
- I can see a capacity report showing how many free hours I have each day versus how many are already committed
- Reports are based on my actual task data — durations, completion dates, and schedule placements

**Mapped requirements:** R12.1, R13.1, R14.1

**Priority:** P4 — Planned
**Status:** Planned

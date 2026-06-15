# Juggler Test Suite — Muppet Dispatch Plan

> Generated: 2026-06-15
> Based on: TEST-IMPLEMENTATION-PLAN.md (265h, 466 tests, ~40 new files)
> Available profiles: ernie, cookie, zoe, elmo, scooter (opus equiv); telly, bert, abby, bird, count (sonnet equiv); prairie, snuffy (haiku equiv); kermit, oscar (orchestrators)

---

## 0. MASTER TASK GRAPH

```
Phase 0 (Infra) ─── bert ─────────────────────────────────────► telly(verify)
                    │                                                    │
                    ├── cookie (arch review)                             │
                    └── ernie (correctness)                              │
                                                                         ▼
Phases 1-6 ──────── telly ─────────────────────────────────────► zoe(audit)
(Core Scheduler)    │                                                  
                    ├── ernie (logic verify, golden-master compare)     
                    └── snuffy (scope/edge discovery)                  
                                                                         
Phases 7-9 ──────── telly ─────────────────────────────────────► zoe(audit)
(Advanced)          │                                                  
                    ├── bert (calendar sync mock wiring)               
                    └── bird (frontend template UX)                    
                                                                         
Phase 10 ────────── telly ─────► zoe(audit) ← INDEPENDENT
(Validation)
                                                                         
Phase 11 ────────── telly ─────► zoe(audit) ← BLOCKED on Phase 0
(Time-Travel)
                                                                         
Phase 12 ────────── telly ─────► zoe(audit) ← BLOCKED on Phases 1-6
(Adversarial)       │
                    ├── ernie (contradiction checks)
                    └── bert (some code fixes needed)
                                                                         
Phase 13 ────────── bird ─────► zoe(audit) ← INDEPENDENT
(Frontend)
                                                                         
Phase 14 ────────── telly ─────► zoe(audit) ← BLOCKED on everything
(E2E)
```

## 1. AGENT ASSIGNMENTS

| Agent | Role | What they do | Model |
|-------|------|-------------|-------|
| **telly** | Test Author | Writes all test implementations (PRIMARY agent for phases 1-12) | devstral-small-2:24b |
| **zoe** | Adversarial QA | Challenges every test file for gaps, contradictions, missing scenarios | devstral-2:123b |
| **ernie** | Logic Verifier | Verifies test logic correctness, golden-master parity, contradiction detection | devstral-2:123b |
| **cookie** | Architecture | Reviews FakeClockAdapter wiring, hex arch port compliance | devstral-2:123b |
| **bert** | Fix Implementer | Implements Phase 0 infrastructure code (FakeClockAdapter, FakeWeatherProvider, legacy scheduler refactoring) | devstral-2:123b |
| **bird** | UX/Frontend | Writes frontend component tests, drag-and-drop handler tests | devstral-small-2:24b |
| **abby** | Docs | Updates documentation, writes implementation plan docs | gemma3:27b |
| **prairie** | Doc Verify | Verifies docs match implementation | gemma3:12b |
| **snuffy** | Scope Skeptic | Scopes tasks, finds missing edge cases before implementation | gemma3:12b |
| **count** | Intake | Analyzes the test plan, breaks down into tiny tasks | devstral-small-2:24b |
| **scooter** | Knowledge | Stores durable facts about test infrastructure decisions | devstral-2:123b |
| **kermit** | Coordinator | Cron job that dispatches tasks, monitors progress, handles blocked tasks | kimi-k2.5 |
| **oscar** | Gate | Verifies each phase passes all gates before promotion | kimi-k2.5 |

## 2. PHASE DISPATCH SEQUENCE

### Wave 0: Analysis + Intake (parallel, immediate)
```
count ────► Analyze test-implementation-plan.md → create tiny task breakdown
├── snuffy ──► Review plan for missing scope/edge cases
├── scooter ──► Store facts about test infrastructure
└── abby ────► Create test implementation guide for workers
```

### Wave 1: Phase 0 — Infrastructure (bert + cookie + ernie)
```
bert ────► Task 0.1: Build FakeClockAdapter (2h)
bert ────► Task 0.2: Build FakeWeatherProvider (1h)
bert ────► Task 0.3: Refactor legacy scheduler for ClockPort (8h) ← CRITICAL PATH
bert ────► Task 0.4: Refactor legacy scheduler for WeatherProvider (4h)
bert ────► Task 0.5: Shared test fixture builder (3h)
bert ────► Task 0.6: Add timezone fixture to all helpers (1h)
cookie ──► Task 0.a: Review hex arch port compliance for fakes
ernie ───► Task 0.b: Verify golden-master parity before/after refactoring
telly ───► Task 0.c: Unit tests for FakeClockAdapter + FakeWeatherProvider
```

### Wave 2: Phase 10 + 13 (parallel, independent — can start immediately)
```
telly ────► Task 10.1: Zod validation tests (TS-251 to TS-268)
telly ────► Task 10.2: Resilience tests (TS-269 to TS-272)
bird ─────► Task 13.1: View component tests (DailyView, ThreeDayView, etc.)
bird ─────► Task 13.2: Drag-and-drop handler tests
bird ─────► Task 13.3: Weather badge UI tests
zoe ──────► Task 10.z + 13.z: Adversarial audit of Phases 10 & 13
```

### Wave 3: Phases 1-3 — Core Scheduler Tests (telly + ernie + zoe)
```
telly ────► Task 1: Placement Mode tests (TS-01 to TS-71)
telly ────► Task 2: Recurrence tests (TS-72 to TS-110)
telly ────► Task 3: Split tests (TS-111 to TS-126br)
ernie ────► Task 1.e: Verify placement mode logic against golden-master
snuffy ───► Task 1.s: Find missing split/recurrence edge cases
zoe ──────► Task 1-3.z: Adversarial audit of all core scheduler tests
```

### Wave 4: Phases 4-6 — Deadlines, Weather, Dependencies (telly + ernie)
```
telly ────► Task 4: Deadline + Earliest-Start tests (TS-127 to TS-141q)
telly ────► Task 5: Weather tests (TS-142 to TS-154x)
telly ────► Task 6: Dependency tests (TS-155 to TS-162y)
ernie ────► Task 4.e: Verify deadline chain backpropagation logic
zoe ──────► Task 4-6.z: Adversarial audit
```

### Wave 5: Phases 7-9 — Advanced Tests + Templates (telly + bird)
```
telly ────► Task 7: Scheduler Phases + Triggers (TS-163 to TS-194)
telly ────► Task 8: Calendar Sync tests (TS-195 to TS-206)
telly ────► Task 9: User Config + Template tests (TS-207 to TS-250)
bird ─────► Task 9.b: Frontend template/task interaction UI tests
zoe ──────► Task 7-9.z: Adversarial audit
```

### Wave 6: Phase 11 — Time-Travel (telly, BLOCKED on Phase 0.3)
```
telly ────► Task 11: Time-Travel tests (TS-273 to TS-288)
ernie ────► Task 11.e: Verify FakeClockAdapter wiring completeness
zoe ──────► Task 11.z: Adversarial audit
```

### Wave 7: Phase 12 — Adversarial Gap Fixes (telly + ernie + zoe loop)
```
telly ────► Task 12.1: HIGH gap tests (TS-301 to TS-334)
ernie ────► Task 12.e: Verify contradictions resolved
zoe ──────► Task 12.z: SECOND adversarial pass (verify gaps are truly fixed)
          ↓
          └── LOOP: If zoe finds new gaps → telly fixes → zoe re-audits
          ↓
telly ────► Task 12.2: MED + cross-domain tests (TS-335 to TS-348)
telly ────► Task 12.3: LOW gap tests (G-021 to G-029)
```

### Wave 8: Phase 14 — E2E + Final Gate (telly + oscar)
```
telly ────► Task 14.1: Full-stack scheduler E2E (Playwright)
telly ────► Task 14.2: Calendar sync E2E
telly ────► Task 14.3: MCP protocol integration tests
oscar ────► Task 14.o: Final gate — verify all phases complete, all tests pass
```

## 3. DEPENDENCY TRACKING

| Task | Depends On | Unblocked When |
|------|-----------|----------------|
| Phase 1-6 | Phase 0.3 | FakeClockAdapter wired into legacy scheduler |
| Phase 5 | Phase 0.4 | FakeWeatherProvider wired |
| Phase 7-9 | Phase 1-6 | Core scheduler tests stable |
| Phase 11 | Phase 0.3 | ClockPort wiring |
| Phase 12 | Phase 1-6, 7-9 | All core + advanced tests passing |
| Phase 14 | Everything | All phases complete |
| zoe audit (each phase) | That phase's telly tasks | Telly marks test file done |
| oscar gate | All phases + all zoe audits | Everything green |

## 4. TASK SIZING

Target: **TINY tasks** — single file, <30 minutes, clear acceptance criteria.

### Good task size examples:
```
✓ "Write FakeClockAdapter.js — 40 lines, implements ClockPort"
✓ "TS-01 to TS-05: Anytime mode tests — 5 tests in placementModes.test.js"
✓ "TS-142 to TS-146: Weather base precip/cloud tests — 5 tests in weather.test.js"
```

### Too-large tasks (must split):
```
✗ "Write all Phase 1 tests" — 71 tests, ~28h
✗ "Write all Phase 12 adversarial tests" — 51 tests, ~28h
✗ "Refactor legacy scheduler" — 8h block, split into per-function tasks
```

## 5. QUALITY GATES

Each phase passes through this pipeline:
```
[telly writes tests] → [telly runs them GREEN] → [zoe audits] → [zoe approves or finds gaps]
                                                                       │
                                                                       └── [telly fixes gaps] → [zoe re-audits]
                                                                       
[ernie verifies logic] → [oscar gates phase promotion]
```

**Oscar gate checklist for each phase:**
- [ ] All test IDs in the phase exist as test cases
- [ ] All tests pass (GREEN)
- [ ] Zoe adversarial audit passed (no HIGH gaps)
- [ ] Golden-master tests still green (if applicable)
- [ ] Test files organized in correct directory
- [ ] Sub-scenarios from spec docs are covered

## 6. CONCURRENCY LIMITS

| Resource | Limit |
|----------|-------|
| Max concurrent workers | 2 (user preference) |
| Max cron jobs | 3 total |
| Coordinator cron interval | Every 10 min |
| Workers per phase | Max 1 per phase (serial within a phase) |
| Parallel phases | Phase 10 + 13 + Phase 0 can run simultaneously |

## 7. COORDINATOR CRON BEHAVIOR

The `kermit` profile runs a cron job every 10 minutes that:

1. Check running task count — if ≥2, skip dispatch
2. Check blocked tasks — add project path context, unblock
3. Check for tasks ready to dispatch — within concurrency limit
4. Create new tasks from unchecked ROADMAP/plan items
5. Report progress to `.muppets/logs/KERMIT-LOG-{DATE}.md`
6. Check if any zoe audit tasks are done — if so, mark source phase as verified
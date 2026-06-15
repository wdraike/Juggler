# VERIFICATION-CHECKLIST Summary — juggler

**Audit date:** 2026-06-15
**Standard:** REQUIREMENTS-STANDARDS.md §9.3
**Service:** juggler
**Version:** 1.0.0

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| **Total requirements** | 228 |
| **Verified** | 192 |
| **Discrepancies** | 7 |
| **Untested** | 26 |
| **Not applicable (planned)** | 3 |
| **Coverage** | 84.2% |

## Verification by Domain

| Domain | Total | Verified | Discrepancy | Untested | N/A |
|--------|-------|----------|-------------|----------|-----|
| Task Management | 56 | 54 | 0 | 2 | 0 |
| Scheduler | 103 | 86 | 7 | 10 | 0 |
| Calendar Sync | 10 | 10 | 0 | 0 | 0 |
| Calendar Views | 11 | 1 | 0 | 10 | 0 |
| AI | 5 | 5 | 0 | 0 | 0 |
| Auth | 3 | 3 | 0 | 0 | 0 |
| MCP | 2 | 2 | 0 | 0 | 0 |
| Data | 5 | 5 | 0 | 0 | 0 |
| Billing | 6 | 6 | 0 | 0 | 0 |
| Weather | 9 | 9 | 0 | 0 | 0 |
| Admin | 6 | 5 | 0 | 1 | 0 |
| Reporting | 3 | 0 | 0 | 0 | 3 |

## Discrepancies (7) — Zero-Tolerance Domain (Scheduler)

Requirements with `partial` status and acceptance-criteria gaps in the Scheduler domain (zero-tolerance per REQUIREMENTS-STANDARDS.md):

| ID | Domain | Issue |
|----|--------|-------|
| R11.10 | Scheduler | Weather constraint currently fail-open (weatherOk returns true when data missing); requirement mandates fail-closed |
| R36.1 | Scheduler | Deadline backpropagation is imprecise — inherits consumer's deadline date without capacity-aware offset |
| R36.2 | Scheduler | Capacity-aware offset for propagated deadlines not implemented; documented limitation |
| R36.3 | Scheduler | `deadlineMisses` array in scheduler return shape is dead code (always `[]`) |
| R37.1 | Scheduler | `earliest_start_at` field has no dedicated test |
| R37.2 | Scheduler | No backend validation for `startAfter > deadline` (silently goes unplaced) |
| R37.3 | Scheduler | Rename from `start_after_at` to `earliest_start_at` not yet executed |

## Untested (26)

Requirements marked `implemented` but with no test files existing on disk:

- **R8.1, R8.3, R8.4, R8.5, R8.6, R8.7, R8.8** — Calendar Views (frontend components — no dedicated backend tests)
- **R32.2** — `skip` status on recurring instances (references `tests/recurring/tpc*.test.js` which doesn't exist)
- **R34.2, R34.3, R34.4, R34.5** — TPC fillPolicy, spacing guard, flexible roaming (no dedicated tests)
- **R40.1, R40.2, R40.3** — FlexWhen (no dedicated test)
- **R42.1, R42.2, R42.3, R42.4** — Health & Observability endpoints (no dedicated tests)
- **R44.3, R44.4, R44.5, R44.6, R44.7** — Scheduler admin stepper endpoints (no dedicated tests)
- **R46.1, R46.2** — Task version and disabled list endpoints (no dedicated tests)

## Not Applicable (3)

All Reporting domain requirements are `planned` (no code, no tests):
- R12.1 — Time reports
- R13.1 — Burn-down reports
- R14.1 — Capacity planning reports

## Key Findings

1. **Strong coverage core**: Task Management (96%), Calendar Sync (100%), Billing (100%), Auth (100%), AI (100%)
2. **Calendar Views untested**: 8 of 11 view components have no dedicated unit tests
3. **Weather constraint fail-open**: Critical Scheduler gap (R11.10) — weather-constrained tasks are placed even when weather data is missing
4. **TPC test gap**: `tests/recurring/tpc*.test.js` referenced in REQUIREMENTS.md does not exist on disk; 5 TPC requirements are untested (R32.2, R34.2–34.5)
5. **FlexWhen untested**: R40.1–40.3 have zero dedicated test coverage
6. **Admin endpoints missing tests**: Health (R42) and admin scheduler (R44) endpoints have no dedicated tests
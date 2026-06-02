# Code Review — ZOE-JUG-002 (expandRecurring placement_mode) — 2026-06-01

## Summary

Two files changed: one-line fix adding `placement_mode: src.placement_mode` to the non-rolling instance push in `shared/scheduler/expandRecurring.js`, and one new test in `juggler-backend/tests/expandRecurring.test.js`. The rolling branch already copied `placement_mode` (line 339); this brings the non-rolling branch into parity. Test drove the fix RED→GREEN. Ship-ready.

## Critical Findings (must fix before merge)

_None._

## Warning Findings (fix this sprint)

_None._

## Info / Suggestions

| # | Finding | File:Line | Suggestion |
|---|---------|-----------|------------|
| I1 | The rolling instance push omits several fields that the non-rolling push copies (project, location, tools, split, splitMin, timeFlex, preferredTimeMins, marker, flexWhen, notes, section). Pre-existing gap, not introduced by this change. | expandRecurring.js:327-341 | Track as follow-up to audit rolling instance field parity |

## Checklist Status

- [x] Complexity — PASS (single-line addition, pure function)
- [x] Error handling — PASS (no async, no I/O)
- [x] Test coverage — PASS (new test drives the fix, 49/49 pass)
- [x] Observability — PASS (no logging changes needed)
- [x] Scalability — PASS (no loop or DB impact)
- [x] API design — N/A (scheduler utility, no routes changed)
- [x] Dead code — PASS (no TODOs added)

## Status: PASS

_Signed: Ernie — 2026-06-01T00:00:00Z_

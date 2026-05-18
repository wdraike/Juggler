# Juggler — Roadmap

## Phase: 10-drop-startAfterAt

**Goal:** Remove the redundant `startAfterAt` ISO string field from `rowToTask` output and the MCP input schema. The scheduling feature itself (`startAfter` date key, `start_after_at` DB column) is preserved. Only the duplicate ISO representation is removed.

**Status:** Complete

**Depends on:** 09-placement-mode-enum-redesign

---

## Phase: 11-migrate-rigid-to-placementMode

**Goal:** Replace all reads of `task.rigid` (the backward-compat virtual view column) with `task.placementMode === 'fixed'` checks. Remove `rigid` from `rowToTask` output. Replace `rigid: true` writes in `register-plans.js` with `placementMode: 'fixed'`. Fix `cal-sync.controller.js:866` stale `task.rigid || when.includes('fixed')` check. Drop `rigid` from data export. Drop the virtual `rigid` column from both views.

**Status:** Complete

**Depends on:** 09-placement-mode-enum-redesign

---

## Phase: 12-drop-preferredTime-column

**Goal:** Remove the `preferred_time` boolean column from `task_masters` DB table and all code references. The column is now fully derivable from `placement_mode = 'time_window'`. Remove from migrations, views, `rowToTask`, `taskToRow`, MCP schema, and any frontend reads.

**Status:** Pending

**Depends on:** 09-placement-mode-enum-redesign

---

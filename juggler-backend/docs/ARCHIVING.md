# Task Archiving — current state & reconciliation (999.676)

_Reviewed 2026-06-18. This documents the **actual** archiving behavior end-to-end and
reconciles the intended feature against the code. Bottom line: archiving is **partially
implemented** — the status values exist in the DB enum but are not operationalized._

## What exists

- **Status values.** The `task_instances.status` CHECK constraint includes `'archived'`
  and `'restored'` (migrations `20260602000000_add_completed_at_and_status_enum.js`,
  `20260607000000_update_task_status_enum.js`: `'archived'` = archived tasks, `'restored'` =
  restored from archive). So a row *can* hold `status = 'archived'`.
- **Recurring-template delete cascade (R32).** Deleting a recurring **template** hard-deletes
  pending instances and **archives completed** ones (R32 lifecycle). Historically completed
  instances were re-parented to an "archival master"; that re-parenting was removed
  (`src/slices/task/facade.js:601` — the DB-level delete still applies, but no archival master).

## What is MISSING (intended-vs-code gaps)

These are the reconciliation gaps — the feature was started (DB enum) but not wired through:

1. **Scheduler does not recognise `'archived'`.** The runtime terminal set is
   `TERMINAL_STATUSES = ['done','cancel','skip','pause','missed']` (`src/lib/task-status.js:2`),
   used by the scheduler load/skip paths (`runSchedule.js:476,2103`). `'archived'` is **not**
   in it, so an `archived` instance is neither a recognised terminal status nor an explicitly
   scheduled one — its scheduler treatment is undefined-by-omission.
2. **No archive / restore use-case command.** There is no `ArchiveTask` / `RestoreTask`
   application command. `UndoTask` handles undo (clears `completed_at`, restores prior status)
   but is not an archive feature; `UpdateTaskStatus` gates `disabled` items to a re-enable
   endpoint — there is no equivalent archive→restore transition path.
3. **No way to VIEW archived items in the UI.** The view filter dropdown offers
   Open / Action / All / Done / WIP / Overdue / Fixed / Blocked / Unplaced / Paused / Missed —
   there is **no `Archived` filter**, so a user cannot browse or restore archived items.
4. **Dependency handling of/around archived items is unspecified** — no code path adjusts
   `dependsOn` when a task is archived, and there is no documented intended behavior.

## Intended behavior (to be ratified before completing the feature)

Open product questions (these need a decision before archiving is finished — see follow-up):
- Are archived items excluded from the scheduler (treat `'archived'` as terminal)?
- How does a user view + restore archived items (an `Archived` filter + a restore action)?
- What happens to a dependency on/of an archived task (break it, or block restore)?

**Status: archiving is NOT a complete feature.** Today its only concrete effect is the R32
template-delete cascade marking completed instances; the standalone "archive a task / view
archive / restore" workflow is not implemented. A follow-up backlog item tracks completing or
formally descoping it.

## DECISION — formally DESCOPED (999.749, 2026-06-18)

Archiving is **formally descoped** (not "in progress"). Rationale:
- **No demonstrated user need.** There is no request or use case driving a standalone
  archive→view→restore workflow; tasks already have terminal states (`done`/`cancel`/`skip`)
  and a `disabled`→re-enable path for entitlement-driven hiding. Archiving would duplicate
  much of that surface for an unproven benefit.
- **Cost/risk is non-trivial.** Completing it requires: scheduler-terminal recognition of
  `'archived'`, an `ArchiveTask`/`RestoreTask` use-case pair, an `Archived` view filter + restore
  action, and a defined dependency policy (the open questions above) — a multi-slice feature on a
  scheduler-adjacent surface, for low value.
- **No cleanup required.** The `'archived'`/`'restored'` enum values are RETAINED in the
  `task_instances.status` CHECK constraint (harmless; removing them would need a migration and
  could reject legacy rows). They are simply unused by any operational path. The R32 cascade
  behavior is unchanged.

**If revisited:** treat this doc's "Intended behavior" section as the starting spec; ratify the
three open product questions first, then re-open a scoped feature item. Until then, archiving is
out of scope and this is the decision of record.

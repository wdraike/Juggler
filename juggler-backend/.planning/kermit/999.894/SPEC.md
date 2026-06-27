# Authoring Brief — 999.894 — Document the fixed-XOR-recurring invariant

**Mode:** chore (docs-only). **Scope:** juggler. **No code changes** — only the two docs below.

## Goal
Document the **fixed-XOR-recurring invariant** established/enforced in leg 999.867 (commit `60a9e81`)
in BOTH:
- `juggler-backend/docs/architecture/TASK-PROPERTIES.md`
- `juggler-backend/docs/architecture/TASK-STATE-MATRIX.md`

State the invariant **exactly as the code enforces it**, with a code citation. Do NOT invent or soften
semantics. Accuracy over completeness.

## The invariant — EXACTLY as enforced (do not paraphrase loosely)

A task is **EITHER** *fixed* **OR** *recurring* — never both. They are mutually exclusive (XOR).
- **fixed** means `placement_mode === 'fixed'` (the immovable placement mode).
- **recurring** means the `recurring` flag is truthy (equivalently `task_type` is
  `recurring_template` or `recurring_instance`).
- The illegal state is precisely `placement_mode === 'fixed'` AND `recurring` truthy.

**Single source of the decision** (cite this file:line in BOTH docs):
`isFixedRecurringConflict(opts)` in
`juggler-backend/src/slices/task/domain/validation/taskValidation.js:98`
```js
function isFixedRecurringConflict(opts) {
  return opts.placementMode === 'fixed' && !!opts.recurring;
}
```
This is the SOLE source of the XOR decision; every enforcing path delegates to it (no inlined literal).

**Enforced at four chokepoints (all call the helper):**
| Path | Location | Result on violation |
|------|----------|---------------------|
| Create / general validation | `validateTaskInput` → `taskValidation.js:329` | returns `['invalid_combination']` |
| HTTP `PUT /api/tasks/:id` | `UpdateTask.execute` → `src/slices/task/application/commands/UpdateTask.js:151-152` | `{ status: 400, body: { error: 'invalid_combination' } }` |
| MCP `update_task` | `src/mcp/tools/tasks.js:283-284` | `Validation error: invalid_combination` (isError) |
| Bulk `ImportData` | `src/slices/user-config/application/commands/ImportData.js:122-123` | `{ status: 400, body: { error: 'invalid_combination' } }` (validated before the destructive transaction) |

**Flip handling (999.875, folded into the same leg):** the HTTP-update and MCP-update paths evaluate the
rule against the EFFECTIVE merged `{placementMode, recurring}` — incoming body merged over the existing
row, by KEY PRESENCE — so a flip is caught in **either** direction: setting `placement_mode='fixed'` on an
already-recurring task, OR setting `recurring=true` on an already-fixed task. This requires the repository
read `fetchTaskRecurring` to SELECT `placement_mode` (`KnexTaskRepository.js` and `InMemoryTaskRepository.js`).

**Violation outcome:** the write is **rejected** with the machine-readable error code `invalid_combination`
(HTTP 400 / MCP validation error). Nothing is persisted — there is no silent coercion.

**Orthogonality nuance (important for accuracy):** recurrence is orthogonal to placement mode for every
mode EXCEPT `fixed`. A recurring task may use `reminder`, `all_day`, `time_window`, `time_blocks`, or
`anytime`; it may NOT use `fixed`. (Authority: `src/lib/placementModes.js` — recurrence is a separate
`recurring` flag, deliberately decoupled from the placement-mode enum.)

## Required edits

### TASK-PROPERTIES.md
1. **Reconcile the existing orthogonality note at line ~34.** It currently reads
   *"Recurrence is orthogonal — any mode can be recurring."* That is now **inaccurate**: `fixed` is the one
   exception. Correct it to state that any mode EXCEPT `fixed` can be recurring, and point to the new
   invariant subsection.
2. **Add a dedicated subsection** (suggested under "Scheduling Modes", after the corrected note) titled
   e.g. **"Fixed–Recurring Exclusion (XOR invariant)"** that states the invariant exactly as above, lists
   the four enforcement chokepoints, the `invalid_combination` outcome, the flip-handling note, and cites
   `taskValidation.js:98` (`isFixedRecurringConflict`).
3. Optionally cross-reference from the `Fixed` mode row and the `Recurring` property row.

### TASK-STATE-MATRIX.md
1. **Add an invariant section** (suggested near "Regular Task Scheduling Modes" / the Task Types area)
   documenting the fixed-XOR-recurring rule, same exact statement + `taskValidation.js:98` citation +
   `invalid_combination` outcome.
2. **The "Field Visibility Matrix → Regular Tasks" table (line ~296)** currently shows `🔁 Recurrence` as
   `✅` under the **Fixed** column. This contradicts the backend XOR. Do NOT silently flip the cell to a
   bare `❌` (the actual frontend control-visibility behavior is NOT verified by this leg — 999.867 is
   backend enforcement only). Instead, add a footnote/caveat to that cell pointing to the invariant:
   the combination is **rejected server-side with `invalid_combination`** regardless of whether the UI
   surfaces the control. Document what IS verified (backend rejection); flag the UI-vs-backend tension
   rather than overstating frontend behavior.

## Constraints
- Docs only. Touch ONLY the two files above.
- Cite the enforcing code `file:line` in both docs (`taskValidation.js:98` at minimum).
- Do not assert any behavior not present in the 999.867 code (commit `60a9e81`).
- Bump each doc's `last_updated` / **Last Updated** to 2026-06-26 and reference leg 999.867.

# SPEC — juggler-sweep-duration — mode: new

## Intent
Enhance the task-sidebar **Duration** input (`WhenSection.jsx`) with two related, same-field
improvements (backlog 999.889 + 999.890):
1. Let the user **freely type** a value (today an inline `Math.max(1, parseInt||1)` coercion snaps
   the controlled input back to `1` mid-keystroke, so the field cannot be cleared / multi-digit-edited
   cleanly). The native number-spinner stepper must keep working.
2. **Enforce + surface** the valid min/max range, and **indicate the unit is minutes**.

## Canonical range (mirrored, NOT invented)
The Duration field's save path is `PUT /api/tasks/:id`, validated by `taskUpdateSchema`
(`juggler-backend/src/schemas/task.schema.js:17` → `dur: z.number().int().min(5).max(480)`,
bound in `juggler-backend/src/routes/task.routes.js:9`). The UI mirrors **min 5, max 480 minutes** —
this is the exact constraint that rejects an out-of-range value on save (the current HTML `min={1}`
is an existing mismatch: 1–4 pass the UI but fail server-side validation).

> **Known latent disagreement (out of scope — David follow-up):** other layers disagree on the cap
> — `facade.js` (batch routes) min 1/max 1440, domain `taskValidation.js` `dur>0` (no max), and a
> recorded brain invariant "capped at 720 min". The sidebar's own save path is unambiguous (5–480),
> so this leg mirrors that; unifying the four is separate backend tech debt.

## Requirements (acceptance criteria)
- **R1 (999.889 — free-type):** The user can clear the Duration field and type a multi-digit value
  without the input snapping to `1` on each keystroke. The committed value (on blur / Enter) is the
  integer the user typed (when in range).
- **R2 (999.889 — range enforced + surfaced):** Min 5, max 480 (mirrored from `taskUpdateSchema`)
  are surfaced to the user (visible hint and/or input `min`/`max` attributes). A free-typed
  out-of-range value is **corrected to the nearest bound** on commit (below-min → 5, above-max → 480)
  — NOT silently coerced to a magic default like `1` — with the range visible. The range bounds come
  from a single named constant mirroring `task.schema.js`.
- **R3 (999.890 — minutes unit):** The field clearly indicates the unit is minutes
  (label/suffix/placeholder containing "min").
- **R4 (preserve existing behavior):** The native number-spinner stepper still adjusts the value, and
  the existing end-time projection (`onEndTimeChange(addMinutesTo24h(time, dur))`) still fires on a
  committed change.

## Out of scope
- Unifying the cross-layer duration-cap disagreement (480 vs 720 vs 1440 vs unbounded) — David follow-up.
- Adding preset buttons (none exist today; "stepper/presets" = the native number spinner).

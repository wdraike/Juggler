# Security Review — rolling recur type allowlist addition

**Reviewer:** peneloppy
**Date:** 2026-05-21
**Scope:** `juggler-backend/src/controllers/task.controller.js` — `validateTaskInput` recurrence section (lines ~742-766) and downstream effects of adding `'rolling'` to `validRecurTypes`. Broadened review of the full recurrence validation block.
**Files read:** task.controller.js, shared/scheduler/expandRecurring.js, juggler-backend/src/lib/rolling-anchor.js

---

## Summary

CRITICAL: 0 | HIGH: 0 | MEDIUM: 1 | LOW: 2 | INFO: 1

The one-line change is safe. Adding `'rolling'` to `validRecurTypes` does not bypass any existing guard, does not open an injection path, and does not enable prototype pollution. The anchor-guard block (`isAnchorDependentRecur`) already returns `true` for `rolling` (expandRecurring.js line 479), so rolling tasks are subject to the same `recurStart` enforcement as `biweekly` and `interval` — the allowlist addition is the correct complement to that existing guard.

The findings below are all pre-existing in the recurrence validation section; none were introduced by this commit.

---

## Findings

### MEDIUM-1 — No validation of `recur.intervalDays` for rolling type

**File:** `juggler-backend/src/controllers/task.controller.js` line 742-766
**Also:** `shared/scheduler/expandRecurring.js` line 299

`validateTaskInput` validates only `recur.type`. The `recur` object's sub-fields are accepted without constraints by `.passthrough()` in `taskPatchSchema` (line 1509) and are never checked in `validateTaskInput`. For rolling tasks, the scheduler reads `r.intervalDays` at line 299:

```js
var rollingInterval = Math.max(1, Number(r.intervalDays) || 7);
```

An authenticated user can supply `intervalDays: "Infinity"` or `intervalDays: 1e308`. `Number('Infinity')` = `Infinity`; `Math.max(1, Infinity)` = `Infinity`; `Math.round(n * Infinity)` = `Infinity`; `setDate(date + Infinity)` produces an Invalid Date. The loop's exit condition `rollingDate > end` evaluates to `false` for NaN, so all 1000 iterations run, each pushing a task object with `date: 'NaN/NaN'` into the scheduler output. This corrupts that user's scheduled task list silently until they correct or delete the task.

The 1000-iteration hard cap bounds CPU exposure to a constant; this is not a server-DoS vector. The effect is per-user data corruption, not cross-user. Severity is MEDIUM because an authenticated user can corrupt their own scheduler state in a way that is not immediately obvious and may persist.

**Remediation:** Add a bounds check in `validateTaskInput` for rolling type:
```js
if (rType === 'rolling') {
  var id = Number(body.recur.intervalDays);
  if (body.recur.intervalDays !== undefined &&
      (!Number.isFinite(id) || id < 1 || id > 365)) {
    errors.push('Rolling interval must be between 1 and 365 days');
  }
}
```

---

### LOW-1 — User-supplied string reflected verbatim in validation error message

**File:** `juggler-backend/src/controllers/task.controller.js` line 746

```js
if (rType && validRecurTypes.indexOf(rType) === -1) errors.push('Invalid recurrence type: ' + rType);
```

`rType` is the caller-supplied `body.recur.type` lowercased. The lowercased string is reflected directly into the error response body. Because the response is `application/json` and not rendered as HTML, there is no XSS risk. However, it leaks the exact input back to the caller, which is unnecessary and slightly aids enumeration. A 30-char input would produce a 30-char payload in the error message with no truncation.

**Remediation:** Either omit the value from the message or truncate it: `rType.slice(0, 20)`.

---

### LOW-2 — `when` field accepts arbitrary strings below 30 chars (pre-existing)

**File:** `juggler-backend/src/controllers/task.controller.js` lines 692-699

The `when` validation rejects tags over 30 chars but does not restrict to the `VALID_WHEN_KEYWORDS` allowlist (`['', 'fixed', 'allday', 'anytime']` defined at line 673). Any comma-separated string with each part <= 30 chars is stored. This is unrelated to the `rolling` change. Not a direct injection risk given the field is stored as a plain string and rendered as text, but it means callers can store arbitrary short strings that the scheduler does not understand. Note the comment in the code acknowledges this for "custom time block tags", so this may be intentional.

**Remediation:** If custom block tags are intentional, document the expected format. Otherwise, enforce the allowlist.

---

### INFO-1 — No prototype pollution risk in the `rolling` change

`body.recur` is accessed only after a `typeof body.recur === 'object'` guard. Properties are read individually (`body.recur.type`). The object is serialized via `JSON.stringify(task.recur)` before DB write. `Object.keys` iteration over `body` at lines 1875 and 1992 does not iterate prototype keys (standard behavior). No `Object.assign(target, body.recur)` pattern is present. Prototype pollution is not a concern here.

---

## Change-specific verdict

The `'rolling'` allowlist addition at line 744 is correct and introduces no new attack surface:

- `rolling` is already classified as anchor-dependent in `isAnchorDependentRecur` — the anchor guard fires correctly.
- The scheduler's rolling loop has a hard 1000-iteration cap and the `rollingDate > end` break, bounding any CPU exposure.
- No validation logic that applies to other types is bypassed for `rolling`.
- No injection or prototype pollution vector was identified.

MEDIUM-1 (`intervalDays` bounds) is the only finding directly relevant to the new `rolling` type and should be addressed before this type is exposed in production UI.

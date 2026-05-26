# CODE-REVIEW — Project select field in TaskDetailHeader

**Reviewer:** Ernie
**Date:** 2026-05-26
**Scope:** `juggler-frontend/src/components/tasks/TaskDetailHeader.jsx` — project `<select>` dropdown added to task detail card; `__tests__/TaskDetailHeader.test.jsx` updated with project-select coverage.

---

## Summary

**Critical: 1 | Warning: 2 | Info: 1**

---

## Critical

### C1 — Unapproved `||` fallback on `project` prop silently coerces null/undefined to empty string

**File:** `juggler-frontend/src/components/tasks/TaskDetailHeader.jsx`, line 142

```jsx
<select value={project || ''} onChange={...}>
```

`project` is passed in as a controlled prop. If `project` is `null` or `undefined`, this silently substitutes `''` and the select binds to the "No project" option without surfacing that the data was missing. Per project rules, unapproved `||` fallbacks are prohibited — if `project` can legitimately be null/undefined it must be an approved, documented case. If the task always has a project field (even if empty string), the caller should guarantee it and the fallback is papering over a prop contract bug.

Two distinct problems collapse here:
1. The parent may be omitting `project` entirely when it should pass `''` for an unassigned task — the fallback hides this contract violation.
2. A `null` DB value and a deliberately empty `''` value are being treated identically with no integrity signal.

**Fix:** Remove `|| ''`. The parent component is responsible for passing `project` as a string (empty string for unassigned). If `project` is genuinely expected to sometimes be `null`/`undefined`, file for explicit approval and document it in `CLAUDE.md` before re-adding the fallback.

---

## Warning

### W1 — Unapproved `||` fallback on `allProjectNames` silently swallows missing prop

**File:** `juggler-frontend/src/components/tasks/TaskDetailHeader.jsx`, line 145

```jsx
{(allProjectNames || []).map(...)}
```

If `allProjectNames` is not passed (caller forgot, async fetch not yet resolved, API returned null), this silently renders zero options with no error or loading signal. The user sees only "No project" and has no indication that the list failed to load. Same class of unapproved fallback as C1.

**Fix:** Either make `allProjectNames` a required prop (PropTypes or TypeScript) and let the missing-prop warning surface, or handle the loading/error state explicitly in the parent and always pass a defined array. Do not paper over the missing data with `|| []`.

---

### W2 — Test for "notes preview" asserts behavior the component does not implement

**File:** `juggler-frontend/src/components/tasks/__tests__/TaskDetailHeader.test.jsx`, lines 50–57

```js
it('shows notes preview when notes is non-empty', () => {
  ...
  expect(screen.getByText(/Pick up milk and eggs/)).toBeInTheDocument();
});
```

`TaskDetailHeader.jsx` renders notes as a controlled `<textarea>` with `value={notes || ''}`. A `<textarea>` with a `value` prop does not produce a DOM text node that `getByText` can match — it sets the `.value` property of the element. This test will either fail or is accidentally passing because `getByText` happens to search textarea content in the test environment, which is implementation-dependent behavior. Either way the assertion does not correctly describe what the component does.

**Fix:** Assert `screen.getByDisplayValue('Pick up milk and eggs')` instead of `getByText`. While not part of the new project-select feature, this is a pre-existing bug in the test file that is part of the staged changeset and should be fixed before commit.

Note: `notes` also uses a `|| ''` fallback on line 186 — consistent with the existing pattern but equally unapproved if the same project rules apply to this component in full. The staged diff is introducing the same pattern on `project`; that is what is being flagged as Critical/Warning here.

---

## Info

### I1 — `onProjectChange` silently no-ops when handler is omitted

**File:** `juggler-frontend/src/components/tasks/TaskDetailHeader.jsx`, line 142

```jsx
onChange={e => onProjectChange && onProjectChange(e.target.value)}
```

This is a consistent pattern with the rest of the component (same guard is used for `onStatusChange`, `onPriChange`, `onMarkerChange`, `onTextChange`). It is an established component convention, not a new smell. Flagging for awareness: if `onProjectChange` is omitted, the select appears interactive but changes are silently discarded. A read-only `disabled` attribute would be more honest UX, but this pre-dates the current change and is not a blocker.

---

## Test Coverage Assessment

The two new project-select tests (lines 59–84) cover the correct cases:
- Correct option is selected when `project="Work"` is passed.
- "No project" option is always present.
- `onProjectChange` is called with the selected string value on change.

Coverage is adequate for the new feature. The `getByText` assertion in the pre-existing notes test (W2) is the only structural test bug in the staged file.

---

## Final Verdict: BLOCK

C1 is a project-rule violation (unapproved `||` fallback on a controlled prop). W1 is a second unapproved `||` fallback in the same diff. Both must be resolved before commit. W2 is a test correctness bug in the staged file — fix it in the same pass.

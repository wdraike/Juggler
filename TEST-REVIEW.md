# Test Review — TaskDetailHeader Project Select Field
# 2026-05-26 | Mode: --focus TaskDetailHeader

## Run Result

| Status | Count |
|--------|-------|
| PASS   | 6     |
| FAIL   | 0     |
| BLOCK (missing test) | 0 |
| STALE  | 0     |

All 6 tests pass. Duration: ~2.9 s.

---

## Tests Run

| # | Test Name | Covers |
|---|-----------|--------|
| 1 | renders task title | Task text input renders with correct value |
| 2 | shows Save button only when dirty | isDirty prop controls Save button visibility |
| 3 | calls onClose when × clicked | Close button fires onClose |
| 4 | shows notes preview when notes is non-empty | Notes textarea shows value |
| 5 | renders project select with current value and all options | Select renders with correct value + all options including "No project" |
| 6 | calls onProjectChange when project select changes | onChange fires onProjectChange with new value |

---

## Coverage Assessment — Project Select Field

Tests 5 and 6 are the two new tests under review. Both are correct and pass. They cover:
- The select renders with `value="Work"` when `project="Work"` is passed
- The "No project" option is present
- Other named options are present
- Firing `change` calls `onProjectChange` with the new value

The following edge cases in the source code are **not covered by any existing test**.

---

## Uncovered Edge Cases

### 1. `project` prop is `null` — select should fall back to "No project"

Source (`TaskDetailHeader.jsx` line 142):
```jsx
<select value={project || ''} ...>
```
When `project` is `null` (which API responses commonly produce), the `||` guard coerces it to `''` so the "No project" option is selected. No test renders with `project={null}`.

**Risk:** If the guard were removed, `value={null}` would cause a React controlled-component warning and unpredictable display. The test would catch a regression.

### 2. `project` prop is `undefined` (prop omitted)

Same guard path as null, but a distinct caller pattern — the component is used without passing `project` at all. Neither case is tested.

### 3. `allProjectNames` omitted entirely

Source (line 145):
```jsx
{(allProjectNames || []).map(function(p) { return <option key={p} value={p}>{p}</option>; })}
```
When `allProjectNames` is not passed, the `|| []` guard prevents a crash. The select should render with only the static "No project" option. No test exercises this path.

### 4. `allProjectNames` is an empty array `[]`

The guard passes through an empty array without using the fallback. The select should render with only "No project". Distinct from the omit-prop case and worth an explicit assertion.

### 5. `onProjectChange` not provided — no crash when select changes

Source (line 142):
```jsx
onChange={e => onProjectChange && onProjectChange(e.target.value)}
```
The short-circuit guard prevents a crash when `onProjectChange` is absent. No test fires `change` without the prop present to confirm the guard holds.

### 6. Project select renders in `isCreate={true}` mode

The status button row is hidden behind `{!isCreate && ...}` (line 102), but the project select has no such guard — it renders in both create and edit modes. No test covers `isCreate={true}` with the project select.

### 7. Project name with special characters

If a project name contains `&`, `<`, `>`, or quotes, the option must render with the correct visible text. Not tested.

---

## Priority

| Gap | Severity | Reason |
|-----|----------|--------|
| `project={null}` | HIGH | API commonly returns null; the fallback guard is the only safety net |
| `allProjectNames` omitted | HIGH | Prop is optional — omission is a valid caller pattern |
| `onProjectChange` absent + change fired | MEDIUM | Guard path untested; crash risk if guard is later removed |
| `allProjectNames={[]}` | MEDIUM | Distinct data state; common initial render condition |
| `isCreate={true}` renders select | MEDIUM | Distinct render mode; select presence in create flow unverified |
| Special characters in names | LOW | JSX escaping handles it automatically, but a regression check is cheap |

---

## Recommended Additional Tests

Three tests covering the HIGH and most important MEDIUM priorities:

```javascript
it('renders project select with "No project" selected when project is null', () => {
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries" project={null} pri="P3" dur={30} notes="" url=""
    allProjectNames={['Work', 'Personal']}
    onProjectChange={() => {}}
  />);
  expect(screen.getByDisplayValue('No project')).toBeInTheDocument();
});

it('renders only "No project" option when allProjectNames is omitted', () => {
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries" project="" pri="P3" dur={30} notes="" url=""
    onProjectChange={() => {}}
  />);
  // Use label text to target the project select specifically (priority select also has options)
  const projectSelect = screen.getByRole('combobox', { name: /Project/i });
  const options = within(projectSelect).getAllByRole('option');
  expect(options).toHaveLength(1);
  expect(options[0]).toHaveTextContent('No project');
});

it('does not crash when onProjectChange is not provided and select changes', () => {
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries" project="Work" pri="P3" dur={30} notes="" url=""
    allProjectNames={['Work', 'Personal']}
  />);
  expect(() => {
    fireEvent.change(screen.getByDisplayValue('Work'), { target: { value: 'Personal' } });
  }).not.toThrow();
});
```

Note: the second test above requires adding `import { within } from '@testing-library/react'` to the existing import line.

---

## Files

| File | Path |
|------|------|
| Source | `juggler-frontend/src/components/tasks/TaskDetailHeader.jsx` |
| Test file | `juggler-frontend/src/components/tasks/__tests__/TaskDetailHeader.test.jsx` |
| Result | `.muppets/results/2026-05-26-JUG-UT-TaskDetailHeader.md` |

---

## Verdict: PASS with gaps

The two new tests are correct and all 6 tests pass. The primary happy path and callback invocation are verified. Six edge cases are uncovered; two are HIGH priority and should be added before this component is considered fully covered at the unit tier.

Signed: Telly — 2026-05-26

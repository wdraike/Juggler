# Recurrence UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rolling recurrence mode to WhenSection, replace bare tpc dropdown with an "All N days / Flexible quota" toggle, and fix two existing labels.

**Architecture:** All changes are in WhenSection.jsx (UI rendering only) and its test file. No backend, DB, or API changes required. Rolling mode reuses existing `recurEvery`/`recurUnit` props and reads `task.rolling_anchor` for the read-only anchor card.

**Tech Stack:** React (class-free, var-style), @testing-library/react, react-scripts test

---

## File Map

| Action | File |
|--------|------|
| Modify | `juggler-frontend/src/components/tasks/sections/WhenSection.jsx` |
| Modify | `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.test.jsx` |

No other files change. `shared/scheduler/expandRecurring.js` already handles `rolling` in `isAnchorDependentRecur` (line 479) — no change needed there.

---

## Task 1: Label fixes

**Files:**
- Modify: `juggler-frontend/src/components/tasks/sections/WhenSection.jsx:466,474`
- Modify: `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.test.jsx`

- [ ] **Step 1.1: Write the failing tests**

Add to the end of `WhenSection.test.jsx`:

```jsx
it('day picker label says "Eligible days" for weekly recurrence', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MTWRF"
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByText('Eligible days')).toBeInTheDocument();
});

it('recurrence select has option "Every 2 weeks" not "Biweekly"', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.queryByRole('option', { name: 'Biweekly' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Every 2 weeks' })).toBeInTheDocument();
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
cd juggler-frontend
CI=true react-scripts test --testPathPattern="WhenSection" --watchAll=false 2>&1 | grep -E "PASS|FAIL|✓|✕|●"
```

Expected: 2 new tests fail.

- [ ] **Step 1.3: Apply label fixes in WhenSection.jsx**

Change line 466:
```jsx
// Before
<option value="biweekly">Biweekly</option>
// After
<option value="biweekly">Every 2 weeks</option>
```

Change line 474 (the `<label style={lStyle}>` wrapping the day picker for weekly/biweekly):
```jsx
// Before
Days
// After
Eligible days
```

The exact surrounding context to match for the Edit tool:
```jsx
            <label style={lStyle}>
                Days
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
```
Replace with:
```jsx
            <label style={lStyle}>
                Eligible days
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
```

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
cd juggler-frontend
CI=true react-scripts test --testPathPattern="WhenSection" --watchAll=false 2>&1 | grep -E "PASS|FAIL|✓|✕|●"
```

Expected: all tests pass.

- [ ] **Step 1.5: Commit**

```bash
cd juggler-frontend/.. # juggler worktree root
git add juggler-frontend/src/components/tasks/sections/WhenSection.jsx \
        juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.test.jsx
git commit -m "fix(when-section): label fixes — eligible days + every 2 weeks"
```

---

## Task 2: Sub-mode split for weekly / biweekly flexible quota

**Files:**
- Modify: `juggler-frontend/src/components/tasks/sections/WhenSection.jsx:490-507`
- Modify: `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.test.jsx`

The current code (lines 490–507) shows a bare tpc `<select>` whenever `selectedCount > 1`. Replace this block with a two-button toggle that controls whether tpc = all or < all.

- [ ] **Step 2.1: Write the failing tests**

Add to `WhenSection.test.jsx`:

```jsx
it('shows "All N days" / "Flexible quota" toggle when selectedCount > 1 for weekly', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MWF" recurTpc={3}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByText('All 3 days')).toBeInTheDocument();
  expect(screen.getByText('Flexible quota')).toBeInTheDocument();
});

it('"All N days" is active when recurTpc === selectedCount', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MWF" recurTpc={3}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  var allBtn = screen.getByText('All 3 days');
  expect(allBtn.style.fontWeight).toBe('600');
});

it('"Flexible quota" is active when recurTpc < selectedCount', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MWF" recurTpc={2}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  var flexBtn = screen.getByText('Flexible quota');
  expect(flexBtn.style.fontWeight).toBe('600');
});

it('clicking "All N days" calls onRecurTpcChange with selectedCount', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MWF" recurTpc={2}
    onRecurTpcChange={function(v) { called = v; }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  fireEvent.click(screen.getByText('All 3 days'));
  expect(called).toBe(3);
});

it('clicking "Flexible quota" when tpc===selectedCount calls onRecurTpcChange with selectedCount-1', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MWF" recurTpc={3}
    onRecurTpcChange={function(v) { called = v; }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  fireEvent.click(screen.getByText('Flexible quota'));
  expect(called).toBe(2);
});

it('tpc select not shown when "All N days" is active', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MWF" recurTpc={3}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  // tpc select shows values like "1", "2", "3 (all)" — when All mode, no "(all)" option
  expect(screen.queryByText(/\(all\)/)).not.toBeInTheDocument();
});

it('tpc select IS shown when "Flexible quota" is active', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MWF" recurTpc={2}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByText('Complete per cycle')).toBeInTheDocument();
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
cd juggler-frontend
CI=true react-scripts test --testPathPattern="WhenSection" --watchAll=false 2>&1 | grep -E "PASS|FAIL|✓|✕|●"
```

Expected: 7 new tests fail.

- [ ] **Step 2.3: Replace tpc block in WhenSection.jsx**

Find the `selectedCount > 1` block (around lines 490–507) inside the `(recurType === 'weekly' || recurType === 'biweekly')` branch. Replace it with:

```jsx
                {selectedCount > 1 && (function() {
                  var isAllMode = (recurTpc || selectedCount) >= selectedCount;
                  var cycleLabel = recurType === 'biweekly' ? '2 weeks' : 'week';
                  return (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                        <button
                          onClick={function() { onRecurTpcChange(selectedCount); }}
                          style={togStyle(isAllMode, '#2D6A4F')}
                        >All {selectedCount} days</button>
                        <button
                          onClick={function() {
                            if (isAllMode) onRecurTpcChange(selectedCount - 1);
                          }}
                          style={togStyle(!isAllMode, '#C8942A')}
                        >Flexible quota</button>
                      </div>
                      {!isAllMode && (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                          <span style={{ fontSize: 10, color: TH.textMuted }}>Complete per cycle</span>
                          <select
                            value={recurTpc || (selectedCount - 1)}
                            onChange={function(e) { onRecurTpcChange(parseInt(e.target.value)); }}
                            style={{ ...iStyle, width: 'auto', minWidth: 50 }}
                          >
                            {Array.from({ length: selectedCount - 1 }, function(_, i) { return i + 1; }).map(function(n) {
                              return <option key={n} value={n}>{n}</option>;
                            })}
                          </select>
                          <span style={{ fontSize: 9, color: '#C8942A' }}>
                            ≈every {Math.round(((recurType === 'biweekly' ? 14 : 7) / (recurTpc || (selectedCount - 1))) * 10) / 10} days
                          </span>
                        </div>
                      )}
                      {!isAllMode && FillPolicyBlock(cycleLabel)}
                    </div>
                  );
                })()}
```

Also remove the old FillPolicyBlock call that was outside the `selectedCount > 1` block (line 504 in original):
```jsx
// Remove this line (it was the standalone FillPolicyBlock outside the tpc select):
{(recurTpc > 0 && recurTpc < selectedCount) && FillPolicyBlock('week')}
```

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
cd juggler-frontend
CI=true react-scripts test --testPathPattern="WhenSection" --watchAll=false 2>&1 | grep -E "PASS|FAIL|✓|✕|●"
```

Expected: all tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add juggler-frontend/src/components/tasks/sections/WhenSection.jsx \
        juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.test.jsx
git commit -m "feat(when-section): sub-mode split for weekly flexible quota (option B)"
```

---

## Task 3: Rolling recurrence mode UI

**Files:**
- Modify: `juggler-frontend/src/components/tasks/sections/WhenSection.jsx`
- Modify: `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.test.jsx`

- [ ] **Step 3.1: Write the failing tests**

Add to `WhenSection.test.jsx`:

```jsx
it('recurrence select has "Rolling (after completion)" option', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByRole('option', { name: 'Rolling (after completion)' })).toBeInTheDocument();
});

it('rolling mode shows interval input', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="rolling" recurEvery={7} recurUnit="days"
    task={{ rolling_anchor: null }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByText('Repeat every')).toBeInTheDocument();
  expect(screen.getByDisplayValue('7')).toBeInTheDocument();
});

it('rolling mode shows unit select with days/weeks/months options', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="rolling" recurEvery={7} recurUnit="days"
    task={{ rolling_anchor: null }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByRole('option', { name: 'days' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'weeks' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'months' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'years' })).not.toBeInTheDocument();
});

it('rolling mode anchor card shows "not yet set" when rolling_anchor is null', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="rolling" recurEvery={7} recurUnit="days"
    task={{ rolling_anchor: null }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByText(/Anchor not yet set/)).toBeInTheDocument();
});

it('rolling mode anchor card shows last completed and next due when rolling_anchor set', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="rolling" recurEvery={7} recurUnit="days"
    task={{ rolling_anchor: '2026-05-19' }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByText('Last completed')).toBeInTheDocument();
  expect(screen.getByText('Next due')).toBeInTheDocument();
});

it('rolling mode hides day picker', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="rolling" recurEvery={7} recurUnit="days"
    task={{ rolling_anchor: null }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.queryByText('Eligible days')).not.toBeInTheDocument();
});

it('rolling mode hides fill policy', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="rolling" recurEvery={7} recurUnit="days"
    task={{ rolling_anchor: null }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.queryByText(/Keep the schedule/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Backfill missed/)).not.toBeInTheDocument();
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
cd juggler-frontend
CI=true react-scripts test --testPathPattern="WhenSection" --watchAll=false 2>&1 | grep -E "PASS|FAIL|✓|✕|●"
```

Expected: 7 new tests fail.

- [ ] **Step 3.3: Add rolling option to recurrence select**

In WhenSection.jsx, find the `<select value={recurType} ...>` block (around line 461). Add rolling after interval:

```jsx
              <option value="interval">Every N (days/wks/mo/yr)</option>
              <option value="rolling">Rolling (after completion)</option>
```

- [ ] **Step 3.4: Add rolling helper — addDaysToAnchor**

Add this pure function near the top of WhenSection.jsx (after the `minutesFrom24h` function, before `TimezoneSelector`):

```jsx
function addIntervalToDate(dateStr, every, unit) {
  var d = new Date(dateStr + 'T00:00:00');
  var n = parseInt(every, 10) || 1;
  if (unit === 'weeks') { d.setDate(d.getDate() + n * 7); }
  else if (unit === 'months') { d.setMonth(d.getMonth() + n); }
  else { d.setDate(d.getDate() + n); } // days (default)
  return d.toISOString().slice(0, 10);
}

function formatAnchorDate(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
```

- [ ] **Step 3.5: Add rolling mode block inside the recurrence section**

In WhenSection.jsx, find the `recurType === 'interval'` block (around lines 550–565). Add the rolling block immediately after it (before the closing `</div>` of the flex container at line 566):

```jsx
          {recurType === 'rolling' && (
            <div style={{ marginTop: 4 }}>
              <label style={lStyle}>
                Repeat every
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="number" min={1} value={recurEvery || 7}
                    onChange={function(e) { onRecurEveryChange(e.target.value); }}
                    style={{ ...iStyle, width: 50 }}
                  />
                  <select
                    value={recurUnit || 'days'}
                    onChange={function(e) { onRecurUnitChange(e.target.value); }}
                    style={{ ...iStyle, width: 'auto' }}
                  >
                    <option value="days">days</option>
                    <option value="weeks">weeks</option>
                    <option value="months">months</option>
                  </select>
                  <span style={{ fontSize: 10, color: TH.textMuted }}>after completion</span>
                </div>
              </label>
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 9, color: TH.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Rolling anchor</div>
                {(task && task.rolling_anchor) ? (
                  <div style={{ display: 'flex', gap: 16, background: TH.bgCard, border: '1px solid ' + TH.inputBorder, borderRadius: 4, padding: '6px 10px', fontSize: 11 }}>
                    <div>
                      <div style={{ fontSize: 9, color: TH.textMuted, marginBottom: 1 }}>Last completed</div>
                      <div style={{ color: TH.text, fontWeight: 500 }}>{formatAnchorDate(task.rolling_anchor)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: TH.textMuted, marginBottom: 1 }}>Next due</div>
                      <div style={{ color: TH.accent, fontWeight: 500 }}>{formatAnchorDate(addIntervalToDate(task.rolling_anchor, recurEvery || 7, recurUnit || 'days'))}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: TH.textMuted, fontStyle: 'italic' }}>
                    Anchor not yet set — computed from first completion
                  </div>
                )}
              </div>
            </div>
          )}
```

- [ ] **Step 3.6: Guard day picker and sub-mode toggle from showing when rolling**

The day picker block is gated by `(recurType === 'weekly' || recurType === 'biweekly')` — rolling is naturally excluded. No change needed.

Verify by reading lines 471–507 of WhenSection.jsx — the condition is `if (function() { ... })()` inside `{(recurType === 'weekly' || recurType === 'biweekly') && (function() {`. Rolling is already excluded. ✓

- [ ] **Step 3.7: Run tests to verify they pass**

```bash
cd juggler-frontend
CI=true react-scripts test --testPathPattern="WhenSection" --watchAll=false 2>&1 | grep -E "PASS|FAIL|✓|✕|●"
```

Expected: all tests pass.

- [ ] **Step 3.8: Commit**

```bash
git add juggler-frontend/src/components/tasks/sections/WhenSection.jsx \
        juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.test.jsx
git commit -m "feat(when-section): rolling recurrence mode — interval + anchor card"
```

---

## Self-Review

**Spec coverage:**
- ✅ Rolling mode: select option, interval (days/weeks/months), anchor card (null + set states), hides day picker/tpc/fill policy
- ✅ Sub-mode split (Option B): toggle All N / Flexible quota, tpc selector in flexible only, fill policy in flexible only
- ✅ Label fixes: Eligible days, Every 2 weeks
- ✅ No backend changes
- ✅ Edge case: `recurIsAnchorDependent` already handles rolling in shared code — no TaskEditForm change needed

**Placeholder scan:** None found. All steps have code.

**Type consistency:**
- `addIntervalToDate` defined in Task 3.4, used in Task 3.5 ✓
- `formatAnchorDate` defined in Task 3.4, used in Task 3.5 ✓
- `togStyle` already exists in component scope (line 189), used in Task 2 toggle ✓
- `recurTpc`, `recurEvery`, `recurUnit`, `recurDays`, `onRecurTpcChange`, `onRecurEveryChange`, `onRecurUnitChange` — all destructured from props at top of WhenSection ✓

---

## Notes

- The `task` prop is already destructured from props (line 175). When `recurType === 'rolling'` and task is null/undefined (isCreate = true, no task yet), the `task && task.rolling_anchor` guard shows "Anchor not yet set" — correct behavior for new tasks.
- The `recurEvery`/`recurUnit` defaults in the rolling block (`|| 7` and `|| 'days'`) prevent NaN/undefined in the display.

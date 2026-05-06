# Calendar & Scheduling Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three independent bugs: scheduler ignores `time_remaining`, reminders overlap regular tasks in DailyView, and calendar event cards use CSS stylesheet tiers for font scaling instead of hardcoded inline values.

**Architecture:** Task 1 is a one-line backend fix to `effectiveDuration()`. Task 2 removes the marker/regular-task split in `DailyView` so all items enter the same column-layout algorithm. Task 3 introduces `ScheduleCard.css` with four `data-size` tiers (`lg`/`md`/`sm`/`xs`) driven by card height; JS sets the attribute, CSS handles all font sizes, padding, and row visibility.

**Tech Stack:** Node.js/Jest (backend tests), React/JSX (frontend), CSS attribute selectors (`[data-size]`)

---

## Task 1: Fix `effectiveDuration` field-name mismatch

**Files:**
- Modify: `juggler-backend/src/scheduler/unifiedScheduleV2.js:56-59`
- Test: `juggler-backend/tests/unifiedSchedule.test.js`

### Context
`effectiveDuration(t)` checks `t.timeRemaining` (camelCase) but `buildItems()` receives raw DB rows where the field is `t.time_remaining` (snake_case). The camelCase property is always `undefined`, so the function silently falls back to `t.dur` (full planned duration) rather than the user's remaining time.

- [ ] **Step 1: Write the failing test**

Add this test at the bottom of `juggler-backend/tests/unifiedSchedule.test.js`, before the last closing line:

```js
test('uses time_remaining (snake_case) when scheduling a wip task', function() {
  // Task is 60 min planned but only 15 min remain — scheduler must use 15
  var task = makeTask({ dur: 60, time_remaining: 15, date: TODAY, status: 'wip' });
  var result = schedule([task], NOW_MINS);
  var placements = getAllPlacements(result);
  expect(placements.length).toBe(1);
  expect(placements[0].dur).toBe(15);
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd juggler-backend && npx jest tests/unifiedSchedule.test.js --forceExit -t "time_remaining"
```

Expected: FAIL — placement `dur` is `60`, not `15`.

- [ ] **Step 3: Fix `effectiveDuration`**

In `juggler-backend/src/scheduler/unifiedScheduleV2.js`, replace lines 56-59:

```js
// Before
function effectiveDuration(t) {
  var rd = t.timeRemaining != null ? t.timeRemaining : t.dur;
  return Math.min(rd > 0 ? rd : (rd === 0 ? 0 : 30), 720);
}
```

```js
// After
function effectiveDuration(t) {
  var rd = t.timeRemaining != null ? t.timeRemaining
         : t.time_remaining != null ? t.time_remaining
         : t.dur;
  return Math.min(rd > 0 ? rd : (rd === 0 ? 0 : 30), 720);
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd juggler-backend && npx jest tests/unifiedSchedule.test.js --forceExit -t "time_remaining"
```

Expected: PASS.

- [ ] **Step 5: Run full scheduler test suite**

```bash
cd juggler-backend && npx jest --forceExit
```

Expected: all previously-passing tests still pass.

- [ ] **Step 6: Commit**

```bash
cd juggler-backend && git add src/scheduler/unifiedScheduleV2.js tests/unifiedSchedule.test.js
git commit -m "fix(scheduler): read time_remaining (snake_case) in effectiveDuration"
```

---

## Task 2: Include reminders in DailyView column layout

**Files:**
- Modify: `juggler-frontend/src/components/views/DailyView.jsx:854-860, 1299, 1325-1351`

### Context
`DailyView.jsx:854-860` splits `allScheduled` into `scheduled` (no markers) and `markers` before layout runs. Only `scheduled` enters `computeColumns()`. Markers render afterward with hardcoded `col={0} totalCols={1}`, painting them over whatever task already occupies the same slot. The fix: remove the split, feed all items to `computeColumns()`, remove the separate marker render block.

- [ ] **Step 1: Remove the `scheduled`/`markers` split memos (lines 854-860)**

In `DailyView.jsx`, delete these lines:

```js
  // Separate reminder events from regular tasks — reminders don't participate in column layout
  var scheduled = useMemo(function () {
    return allScheduled.filter(function (p) { return !p.task.marker; });
  }, [allScheduled]);
  var markers = useMemo(function () {
    return allScheduled.filter(function (p) { return !!p.task.marker; });
  }, [allScheduled]);
```

- [ ] **Step 2: Update the task-blocks render call to use `allScheduled`**

Find this line (around line 1299 after the deletion offset shifts):

```js
          {computeColumns(scheduled, hourHeight).map(function (layout) {
```

Change it to:

```js
          {computeColumns(allScheduled, hourHeight).map(function (layout) {
```

- [ ] **Step 3: Remove the separate marker render block**

Delete the entire `{/* Reminder event overlays */}` section:

```js
          {/* Reminder event overlays — rendered full-width, don't affect task column layout */}
          {markers.map(function (p) {
            var mTop = ((p.start - GRID_START * 60) / 60) * hourHeight;
            var mDur = p.end ? p.end - p.start : (p.task.dur || 30);
            var mHeight = Math.max((mDur / 60) * hourHeight, MIN_BLOCK_H);
            return (
              <TaskBlock
                key={'m-' + p.task.id}
                item={p}
                status={statuses[p.task.id] || ''}
                top={mTop}
                height={mHeight}
                col={0}
                totalCols={1}
                onExpand={onExpand}
                onStatusChange={onStatusChange ? function (val) { onStatusChange(p.task.id, val); } : null}
                theme={theme}
                darkMode={darkMode}
                isMobile={isMobile}
                isBlocked={false}
                canDrag={canDrag}
                gutterW={GUTTER_W}
                hourHeight={hourHeight}
                weatherDay={weatherByDate && weatherByDate[selectedDateKey]}
              />
            );
          })}
```

- [ ] **Step 4: Verify the frontend builds without errors**

```bash
cd juggler-frontend && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors. Warnings about unused variables (`markers`) would be an error — confirm `markers` is fully removed.

- [ ] **Step 5: Manual smoke test**

Start the frontend (`npm start` in `juggler-frontend`). Open the daily view for a day that has both a reminder task and a regular task at the same time. Confirm:
- Both appear side by side without overlapping
- The reminder retains its indigo tint and dotted border
- Regular tasks retain their full-width layout when no reminder is present at the same time

- [ ] **Step 6: Commit**

```bash
git add juggler-frontend/src/components/views/DailyView.jsx
git commit -m "fix(calendar): reminders participate in column layout, no more overlap"
```

---

## Task 3: CSS `data-size` tiered font scaling for ScheduleCard

**Files:**
- Create: `juggler-frontend/src/components/schedule/ScheduleCard.css`
- Modify: `juggler-frontend/src/components/schedule/ScheduleCard.jsx`

### Context
All font sizes in `ScheduleCard.jsx` are inline style props with a single `compact` (< 48px) boolean. The user wants stylesheet-driven tiers. JS will derive a `size` string from `cardHeight` and set `data-size` on the root element; a new CSS file handles font sizes, padding, and row visibility per tier.

**Four tiers:**

| `data-size` | Height | Content |
|---|---|---|
| `lg` | ≥ 80px | Title 12px + time range 10px + badges + details row |
| `md` | 48–80px | Title 11px + time + priority inline 9px, no details |
| `sm` | 28–48px | Title 10px + start time 8px, no badge row, no details |
| `xs` | < 28px | Title 9px only, Row 2 hidden |

- [ ] **Step 1: Create `ScheduleCard.css`**

Create `juggler-frontend/src/components/schedule/ScheduleCard.css` with this content:

```css
/* ScheduleCard — data-size tier font/layout rules */
/* Default = lg (≥80px) */
.sc-root { padding: 4px 8px; }
.sc-row1 { font-size: 12px; }
.sc-dur-badge { font-size: 10px; }
.sc-row2 { margin-top: 3px; }
.sc-details-row { display: block; }

/* Mobile: lg tier only */
.sc-root[data-mobile="1"] { padding: 4px 6px; }
.sc-root[data-mobile="1"] .sc-row1 { font-size: 11px; }

/* md: 48–80px */
.sc-root[data-size="md"] { padding: 3px 6px; }
.sc-root[data-size="md"] .sc-row1 { font-size: 11px; }
.sc-root[data-size="md"] .sc-dur-badge { font-size: 8px; }
.sc-root[data-size="md"] .sc-row2 { margin-top: 1px; }
.sc-root[data-size="md"] .sc-details-row { display: none; }

/* md mobile */
.sc-root[data-size="md"][data-mobile="1"] .sc-row1 { font-size: 10px; }

/* sm: 28–48px */
.sc-root[data-size="sm"] { padding: 3px 6px; }
.sc-root[data-size="sm"] .sc-row1 { font-size: 10px; }
.sc-root[data-size="sm"] .sc-dur-badge { font-size: 8px; }
.sc-root[data-size="sm"] .sc-row2 { margin-top: 1px; }
.sc-root[data-size="sm"] .sc-details-row { display: none; }

/* xs: <28px */
.sc-root[data-size="xs"] { padding: 2px 5px; }
.sc-root[data-size="xs"] .sc-row1 { font-size: 9px; }
.sc-root[data-size="xs"] .sc-dur-badge { display: none; }
.sc-root[data-size="xs"] .sc-row2 { display: none; }
.sc-root[data-size="xs"] .sc-details-row { display: none; }
```

- [ ] **Step 2: Add the CSS import and derive `size` tier in `ScheduleCard.jsx`**

At the top of `ScheduleCard.jsx`, after the existing imports, add:

```js
import './ScheduleCard.css';
```

Then replace lines 32-33 (the `compact`/`showDetails` declarations):

```js
// Before
var compact = layoutMode === 'compact' || (cardHeight != null && cardHeight < 48);
var showDetails = !compact && (cardHeight || 52) >= 60;
```

```js
// After
var h = cardHeight != null ? cardHeight : 52;
var size = layoutMode === 'compact' || h < 28 ? 'xs'
         : h < 48 ? 'sm'
         : h < 80 ? 'md'
         : 'lg';
var compact = size === 'xs' || size === 'sm';
var showDetails = size === 'lg';
```

- [ ] **Step 3: Add `data-size`, `data-mobile`, and `className` to the root element**

The root `<div>` in the `return` block currently starts at line 100:

```jsx
// Before
    <div
      draggable
      onDragStart={function(e) { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={onExpand}
      style={containerStyle}
    >
```

```jsx
// After
    <div
      draggable
      onDragStart={function(e) { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={onExpand}
      className="sc-root"
      data-size={size}
      data-mobile={isMobile ? '1' : undefined}
      style={containerStyle}
    >
```

- [ ] **Step 4: Remove `padding` from `containerStyle` (now in CSS)**

In the `containerStyle` useMemo (lines 39-52), remove the `padding` line:

```js
// Before (inside containerStyle useMemo)
      padding: compact ? '3px 6px' : (isMobile ? '4px 6px' : '4px 8px'),
```

Delete that line entirely — padding is now handled by `.sc-root` in the CSS.

Also remove `compact` and `isMobile` from the useMemo dependency array since they no longer affect `containerStyle`:

```js
// Before
  }, [theme, task.recurring, isDone, priColor, compact, isMobile, isOverdue]);
```

```js
// After
  }, [theme, task.recurring, isDone, priColor, isOverdue]);
```

- [ ] **Step 5: Add `className="sc-row1"` to Row 1 and remove its inline `fontSize`**

Find the Row 1 container `<div>` (around line 119):

```jsx
// Before
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: compact ? 10 : (isMobile ? 11 : 12), lineHeight: 1.2
      }}>
```

```jsx
// After
      <div className="sc-row1" style={{
        display: 'flex', alignItems: 'center', gap: 4, lineHeight: 1.2
      }}>
```

- [ ] **Step 6: Add `className="sc-dur-badge"` to the duration badge and remove its inline `fontSize`**

Find the duration badge `<span>` (around line 145):

```jsx
// Before
        <span style={{
          fontSize: compact ? 8 : 10, flexShrink: 0, fontWeight: 600,
          color: theme.badgeText,
          background: theme.badgeBg,
          borderRadius: 3, padding: '1px 4px'
        }}>
          {durLabel}
        </span>
```

```jsx
// After
        <span className="sc-dur-badge" style={{
          flexShrink: 0, fontWeight: 600,
          color: theme.badgeText,
          background: theme.badgeBg,
          borderRadius: 3, padding: '1px 4px'
        }}>
          {durLabel}
        </span>
```

- [ ] **Step 7: Add `className="sc-row2"` to Row 2 and remove its inline `marginTop`**

Find the Row 2 container `<div>` (around line 165):

```jsx
// Before
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: compact ? 1 : 3 }}>
```

```jsx
// After
      <div className="sc-row2" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
```

- [ ] **Step 8: Add `className="sc-details-row"` to the Row 3 details div**

Find the Row 3 details `<div>` (around line 216):

```jsx
// Before
        <div style={{
          fontSize: 9, color: theme.textMuted, marginTop: 1,
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          lineHeight: 1.3, opacity: 0.75
        }}>
```

```jsx
// After
        <div className="sc-details-row" style={{
          fontSize: 9, color: theme.textMuted, marginTop: 1,
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          lineHeight: 1.3, opacity: 0.75
        }}>
```

- [ ] **Step 9: Verify the frontend builds**

```bash
cd juggler-frontend && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

- [ ] **Step 10: Manual smoke test across tiers**

Start the frontend (`npm start` in `juggler-frontend`). In the daily view:

1. Find a short task (15 min, `xs` tier at normal zoom): confirm only title shows, no Row 2, no badges.
2. Find a 30-min task (`sm`/`md` tier): confirm title + compact time shows, details row hidden.
3. Find a 2-hour task (`lg` tier): confirm title, time range, badges, and details row all show.
4. Resize the browser or change zoom level: confirm cards recompute `data-size` and the correct tier rules apply.

- [ ] **Step 11: Commit**

```bash
git add juggler-frontend/src/components/schedule/ScheduleCard.css \
        juggler-frontend/src/components/schedule/ScheduleCard.jsx
git commit -m "feat(calendar): CSS data-size tiered font scaling on ScheduleCard"
```

---

## Task 4: Bump submodule pointer

- [ ] **Step 1: Confirm all three commits are on juggler `main`**

```bash
cd juggler && git log --oneline -5
```

Expected: the three commits from Tasks 1–3 appear.

- [ ] **Step 2: Bump the submodule pointer in the monorepo**

```bash
cd .. && git add juggler
git commit -m "chore(submodule): bump juggler — time_remaining scheduling fix, reminder overlap, CSS font tiers"
```

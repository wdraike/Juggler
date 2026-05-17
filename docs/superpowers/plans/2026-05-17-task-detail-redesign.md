# Task Detail Panel Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `TaskEditForm.jsx` from ~2200 lines to ~350 by extracting each section into its own component and wrapping all sections in a shared `CollapsibleSection` chrome, persisting collapse state to `localStorage`.

**Architecture:** `TaskEditForm` stays as orchestrator owning all form state. Eight new components — `CollapsibleSection`, `TaskDetailHeader`, and six `sections/` files — each receive only the slice of state they display. Helper functions `WeatherTempSlider`/`WeatherHumiditySlider` move to `WeatherSection.jsx`; `TimezoneSelector` moves to `WhenSection.jsx`. All other helpers stay in `TaskEditForm.jsx` for now.

**Tech Stack:** React (functional, no hooks library), `@testing-library/react`, `localStorage`, inline styles via `getTheme(darkMode)`

---

## File Map

| Action | Path |
|--------|------|
| Create | `src/components/tasks/CollapsibleSection.jsx` |
| Create | `src/components/tasks/TaskDetailHeader.jsx` |
| Create | `src/components/tasks/sections/MetaSection.jsx` |
| Create | `src/components/tasks/sections/WhereSection.jsx` |
| Create | `src/components/tasks/sections/WeatherSection.jsx` |
| Create | `src/components/tasks/sections/ToolsSection.jsx` |
| Create | `src/components/tasks/sections/DependsOnSection.jsx` |
| Create | `src/components/tasks/sections/WhenSection.jsx` |
| Create | `src/components/tasks/__tests__/CollapsibleSection.test.jsx` |
| Create | `src/components/tasks/__tests__/TaskDetailHeader.test.jsx` |
| Create | `src/components/tasks/sections/__tests__/MetaSection.test.jsx` |
| Create | `src/components/tasks/sections/__tests__/WhereSection.test.jsx` |
| Create | `src/components/tasks/sections/__tests__/WeatherSection.test.jsx` |
| Create | `src/components/tasks/sections/__tests__/ToolsSection.test.jsx` |
| Create | `src/components/tasks/sections/__tests__/DependsOnSection.test.jsx` |
| Create | `src/components/tasks/sections/__tests__/WhenSection.test.jsx` |
| Modify | `src/components/tasks/TaskEditForm.jsx` |

All paths are relative to `juggler-frontend/`.

Run tests from `juggler-frontend/`: `npm test -- --watchAll=false`

---

## Task 1: CollapsibleSection + collapse state ✓ DONE

**Files:**
- Create: `src/components/tasks/CollapsibleSection.jsx`
- Create: `src/components/tasks/__tests__/CollapsibleSection.test.jsx`

- [x] **Step 1: Write the failing test**

```jsx
// src/components/tasks/__tests__/CollapsibleSection.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CollapsibleSection from '../CollapsibleSection';

const TH = { border: '#ccc', accent: '#4f46e5', text: '#000', textMuted: '#888', bgCard: '#fff' };

it('shows children when open', () => {
  render(
    <CollapsibleSection id="when" label="When" isOpen={true} onToggle={() => {}} TH={TH}>
      <span>inner content</span>
    </CollapsibleSection>
  );
  expect(screen.getByText('inner content')).toBeInTheDocument();
});

it('hides children when closed', () => {
  render(
    <CollapsibleSection id="when" label="When" isOpen={false} onToggle={() => {}} TH={TH}>
      <span>inner content</span>
    </CollapsibleSection>
  );
  expect(screen.queryByText('inner content')).not.toBeInTheDocument();
});

it('shows badge when provided', () => {
  render(
    <CollapsibleSection id="when" label="When" isOpen={false} onToggle={() => {}} badge="Today · 2:00 PM" TH={TH}>
      <span>inner</span>
    </CollapsibleSection>
  );
  expect(screen.getByText('Today · 2:00 PM')).toBeInTheDocument();
});

it('calls onToggle with id when header is clicked', () => {
  const toggle = jest.fn();
  render(
    <CollapsibleSection id="where" label="Where" isOpen={false} onToggle={toggle} TH={TH}>
      <span>inner</span>
    </CollapsibleSection>
  );
  fireEvent.click(screen.getByRole('button'));
  expect(toggle).toHaveBeenCalledWith('where');
});
```

- [x] **Step 2: Run test to confirm it fails**

```bash
npm test -- --watchAll=false --testPathPattern=CollapsibleSection
```

Expected: FAIL — `CollapsibleSection` not found

- [x] **Step 3: Create CollapsibleSection.jsx**

```jsx
// src/components/tasks/CollapsibleSection.jsx
import React from 'react';

export default function CollapsibleSection({ id, label, isOpen, onToggle, badge, TH, children }) {
  return (
    <div style={{ borderTop: '1px solid ' + TH.border }}>
      <button
        onClick={() => onToggle(id)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '7px 12px', border: 'none', background: 'transparent', cursor: 'pointer',
          color: TH.text, fontFamily: 'inherit', fontSize: 11, fontWeight: 600, textAlign: 'left'
        }}
      >
        <span>{isOpen ? '▼' : '▶'} {label}</span>
        {badge && (
          <span style={{
            fontSize: 10, color: TH.textMuted, background: TH.bgCard,
            borderRadius: 3, padding: '1px 6px', fontWeight: 400
          }}>
            {badge}
          </span>
        )}
      </button>
      {isOpen && (
        <div style={{ padding: '2px 12px 12px' }}>
          {children}
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --watchAll=false --testPathPattern=CollapsibleSection
```

Expected: 4 tests pass

- [x] **Step 5: Add collapse state utilities to TaskEditForm.jsx**

> Note: `toggleCollapse` was upgraded to `useCallback` during the simplify pass to avoid unnecessary re-renders when passed as prop to child `CollapsibleSection` instances.

- [x] **Step 6: Commit**

---

## Task 2: TaskDetailHeader

**Files:**
- Create: `src/components/tasks/TaskDetailHeader.jsx`
- Create: `src/components/tasks/__tests__/TaskDetailHeader.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/tasks/__tests__/TaskDetailHeader.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TaskDetailHeader from '../TaskDetailHeader';

const TH = {
  badgeBg: '#f0f0f0', border: '#ccc', accent: '#4f46e5', text: '#000', textMuted: '#888',
  redBg: '#fee', redText: '#c00', btnBorder: '#ccc', bgCard: '#fff', inputBg: '#fff',
  inputBorder: '#ccc', inputText: '#000', amberBg: '#fff3cd', amberText: '#856404', amberBorder: '#ffc107'
};

const BASE_TASK = { id: 't1', text: 'Buy groceries', pri: 'P3', dur: 30, notes: '', url: '' };

it('renders task title', () => {
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries" project="" pri="P3" dur={30} notes="" url=""
  />);
  expect(screen.getByDisplayValue('Buy groceries')).toBeInTheDocument();
});

it('shows Save button only when dirty', () => {
  const { rerender } = render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries" project="" pri="P3" dur={30} notes="" url=""
  />);
  expect(screen.queryByText(/Save/)).not.toBeInTheDocument();

  rerender(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={true} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries changed" project="" pri="P3" dur={30} notes="" url=""
  />);
  expect(screen.getByText(/Save/)).toBeInTheDocument();
});

it('calls onClose when × clicked', () => {
  const close = jest.fn();
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={close} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries" project="" pri="P3" dur={30} notes="" url=""
  />);
  fireEvent.click(screen.getByText('×'));
  expect(close).toHaveBeenCalled();
});

it('shows notes preview when notes is non-empty', () => {
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries" project="" pri="P3" dur={30} notes="Pick up milk and eggs" url=""
  />);
  expect(screen.getByText(/Pick up milk and eggs/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --watchAll=false --testPathPattern=TaskDetailHeader
```

Expected: FAIL — `TaskDetailHeader` not found

- [ ] **Step 3: Create TaskDetailHeader.jsx**

Move the top-bar block, status buttons, title input, badge row, and notes preview out of `TaskEditForm.jsx` into this new file. The component receives controlled values (`text`, `project`, `pri`, `dur`, `notes`, `url`) as props plus their setters (`onTextChange`, `onProjectChange`, etc.) so the orchestrator keeps state ownership.

```jsx
// src/components/tasks/TaskDetailHeader.jsx
import React from 'react';
import { STATUS_OPTIONS } from '../../state/constants';

export default function TaskDetailHeader({
  // identity
  task, isCreate, isMobile,
  // theme
  TH, darkMode,
  // action bar
  isDirty, saveStatus, onSave, onCreate, onClose, onDelete, calSyncSettings,
  // status
  status, onStatusChange,
  // controlled field values (orchestrator owns state)
  text, onTextChange,
  project, onProjectChange, allProjectNames,
  pri, onPriChange,
  dur, // read-only display; edit happens in WhenSection
  notes, onNotesChange,
  url, onUrlChange,
  // scheduling summary for badge
  scheduledBadge,  // e.g. "Today · 2:00–2:30 PM" or null
  // unplaced banner
  unplacedDetail, whenBlocked, onEnableFlex,
}) {
  var BTN_H = isMobile ? 30 : 26;
  var iStyle = {
    fontSize: isMobile ? 13 : 11, padding: isMobile ? '6px 8px' : '3px 4px',
    border: '1px solid ' + TH.inputBorder, borderRadius: 4,
    background: TH.inputBg, color: TH.inputText, fontFamily: 'inherit',
    height: BTN_H, boxSizing: 'border-box', maxWidth: '100%'
  };

  // Truncate notes to first line for preview
  var notesPreview = notes ? notes.split('\n')[0] : '';

  return (
    <>
      {/* Action bar */}
      <div style={{
        display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
        background: TH.badgeBg, padding: '8px 12px', borderBottom: '1px solid ' + TH.border
      }}>
        {isCreate ? (
          <button onClick={onCreate} style={{
            fontSize: 10, fontWeight: 700, padding: '4px 14px', border: 'none', borderRadius: 4,
            background: '#2D6A4F', color: '#FDFAF5', cursor: 'pointer'
          }}>✚ Create</button>
        ) : (
          <>
            {isDirty && (
              <button onClick={onSave} style={{
                fontSize: 10, fontWeight: 700, padding: '4px 14px', border: 'none', borderRadius: 4,
                background: TH.accent, color: '#FDFAF5', cursor: 'pointer'
              }}>💾 Save</button>
            )}
            {saveStatus && (
              <span style={{
                fontSize: 10, fontWeight: 600,
                color: saveStatus === 'failed' ? '#8B2635' : saveStatus === 'saving' ? TH.textMuted : '#2D6A4F',
                padding: '4px 8px'
              }}>
                {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'failed' ? '✖ Save failed' : '✔ Saved'}
              </span>
            )}
          </>
        )}
        <div style={{ flex: 1 }} />
        {!isCreate && onDelete && (() => {
          var css = calSyncSettings || {};
          var isIngestBlocked = (task.gcalEventId && css.gcal && css.gcal.mode === 'ingest')
                             || (task.msftEventId && css.msft && css.msft.mode === 'ingest');
          if (isIngestBlocked) {
            return <span style={{ fontSize: 10, color: TH.textMuted, fontStyle: 'italic' }}>Calendar event</span>;
          }
          return (
            <button onClick={() => onDelete(task.id)} style={{
              fontSize: 10, fontWeight: 600, padding: '4px 10px',
              border: '1px solid #8B2635', borderRadius: 4,
              background: TH.redBg, color: TH.redText, cursor: 'pointer'
            }}>🗑 Delete</button>
          );
        })()}
        <button onClick={onClose} style={{
          border: 'none', background: 'transparent', color: TH.textMuted,
          fontSize: isMobile ? 24 : 16, cursor: 'pointer', padding: '2px 6px',
          minWidth: isMobile ? 44 : undefined, minHeight: isMobile ? 44 : undefined
        }}>×</button>
      </div>

      <div style={{ padding: '10px 12px', boxSizing: 'border-box' }}>
        {/* Unplaced banner */}
        {!isCreate && unplacedDetail && (
          <div style={{
            fontSize: 10, padding: '6px 10px', marginBottom: 8, borderRadius: 4,
            background: TH.amberBg, color: TH.amberText, border: '1px solid ' + TH.amberBorder,
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap'
          }}>
            <span style={{ fontWeight: 600 }}>⚠ Not placed:</span>
            <span>{unplacedDetail}</span>
            {whenBlocked && (
              <button onClick={onEnableFlex} style={{
                fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                border: '1px solid #C8942A', background: '#C8942A18', color: '#C8942A',
                cursor: 'pointer', fontFamily: 'inherit'
              }}>Enable Flex</button>
            )}
          </div>
        )}

        {/* Status buttons */}
        {!isCreate && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: TH.textMuted, fontWeight: 600, marginBottom: 3 }}>Status</div>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {STATUS_OPTIONS.map(function(s) {
                var isActive = (status || '') === s.value;
                var sBg = darkMode ? s.bgDark : s.bg;
                var sColor = darkMode ? s.colorDark : s.color;
                return (
                  <button key={s.value} onClick={() => { if (onStatusChange) onStatusChange(s.value); }}
                    title={s.tip}
                    style={{
                      border: '1px solid ' + (isActive ? sColor : TH.btnBorder),
                      borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
                      background: isActive ? sBg : 'transparent',
                      color: isActive ? sColor : TH.textMuted,
                      fontSize: 10, fontWeight: isActive ? 700 : 500, fontFamily: 'inherit',
                      height: BTN_H, boxSizing: 'border-box'
                    }}>
                    {s.label} {s.tip.split(' — ')[0]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Title */}
        <input
          type="text" value={text} onChange={e => onTextChange(e.target.value)}
          autoFocus={isCreate}
          style={{
            width: '100%', fontSize: 15, fontWeight: 700, background: 'transparent',
            border: 'none', borderBottom: '1px solid ' + TH.border, color: TH.text,
            outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
            marginBottom: 6, padding: '2px 0'
          }}
        />

        {/* Badge row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
          {project && (
            <span style={{
              fontSize: 10, background: TH.projectBadgeBg, color: TH.projectBadgeText,
              borderRadius: 3, padding: '1px 6px', fontWeight: 600
            }}>{project}</span>
          )}
          <span style={{ fontSize: 10, background: TH.badgeBg, color: TH.badgeText, borderRadius: 3, padding: '1px 6px' }}>{pri}</span>
          {dur > 0 && (
            <span style={{ fontSize: 10, background: TH.badgeBg, color: TH.badgeText, borderRadius: 3, padding: '1px 6px' }}>
              {dur >= 60 ? (Math.round(dur / 60 * 10) / 10) + 'h' : dur + 'm'}
            </span>
          )}
          {scheduledBadge && (
            <span style={{ fontSize: 10, background: TH.accent + '22', color: TH.accent, borderRadius: 3, padding: '1px 6px' }}>
              ⏰ {scheduledBadge}
            </span>
          )}
          {url && /^https?:\/\//i.test(url) && (
            <a href={url} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 10, color: TH.accent }}>🔗</a>
          )}
        </div>

        {/* Notes preview — click to expand (handled by WhenSection notes textarea; this is read-only preview) */}
        {notesPreview && (
          <div style={{
            fontSize: 11, color: TH.textMuted, background: TH.badgeBg,
            borderRadius: 4, padding: '5px 8px', marginBottom: 4,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>
            {notesPreview}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --watchAll=false --testPathPattern=TaskDetailHeader
```

Expected: 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/TaskDetailHeader.jsx src/components/tasks/__tests__/TaskDetailHeader.test.jsx
git commit -m "feat(task-detail): TaskDetailHeader component"
```

---

## Task 3: MetaSection

**Files:**
- Create: `src/components/tasks/sections/MetaSection.jsx`
- Create: `src/components/tasks/sections/__tests__/MetaSection.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/tasks/sections/__tests__/MetaSection.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import MetaSection from '../MetaSection';

const TH = { textMuted: '#888', border: '#ccc' };

it('renders created date', () => {
  render(<MetaSection task={{ createdAt: '2026-01-15T10:00:00Z', slackMins: null }} TH={TH} />);
  expect(screen.getByText(/Jan 15, 2026/)).toBeInTheDocument();
});

it('shows ∞ for null slack', () => {
  render(<MetaSection task={{ createdAt: null, slackMins: null }} TH={TH} />);
  expect(screen.getByText('∞')).toBeInTheDocument();
});

it('renders slack in minutes when under 60', () => {
  render(<MetaSection task={{ createdAt: null, slackMins: 45 }} TH={TH} />);
  expect(screen.getByText('45m')).toBeInTheDocument();
});

it('renders slack in hours when 60+', () => {
  render(<MetaSection task={{ createdAt: null, slackMins: 90 }} TH={TH} />);
  expect(screen.getByText('1h 30m')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --watchAll=false --testPathPattern=MetaSection
```

Expected: FAIL — `MetaSection` not found

- [ ] **Step 3: Create MetaSection.jsx**

Cut the "Metadata footer" block (~lines 2097–2152 of `TaskEditForm.jsx`) into this file:

```jsx
// src/components/tasks/sections/MetaSection.jsx
import React from 'react';

var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function MetaSection({ task, TH }) {
  var created = task.createdAt ? new Date(task.createdAt) : null;
  var createdStr = created
    ? MONTHS[created.getMonth()] + ' ' + created.getDate() + ', ' + created.getFullYear()
    : '—';

  var startStr = null, endStr = null;
  if (task.time) startStr = task.time;
  if (task.time && task.dur) {
    var m = task.time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (m) {
      var hh = parseInt(m[1], 10), mm = parseInt(m[2], 10), ap = (m[3] || '').toUpperCase();
      if (ap === 'PM' && hh < 12) hh += 12;
      if (ap === 'AM' && hh === 12) hh = 0;
      var total = hh * 60 + mm + task.dur;
      if (total < 24 * 60) {
        var eh = Math.floor(total / 60), em = total % 60;
        var eap = eh >= 12 ? 'PM' : 'AM';
        var eh12 = eh % 12 || 12;
        endStr = eh12 + ':' + (em < 10 ? '0' : '') + em + ' ' + eap;
      }
    }
  }

  var s = task.slackMins;
  var slackStr = s == null ? '∞' : s <= 0 ? '0m' : s < 60 ? s + 'm' : Math.floor(s / 60) + 'h ' + (s % 60) + 'm';

  var rowStyle = { display: 'flex', gap: 6, fontSize: 10, color: TH.textMuted, lineHeight: 1.5 };
  var labelStyle = { minWidth: 64, fontWeight: 600, color: TH.textMuted };

  return (
    <div style={{ fontFamily: 'inherit' }}>
      <div style={rowStyle}><span style={labelStyle}>Created</span><span>{createdStr}</span></div>
      <div style={rowStyle}>
        <span style={labelStyle}>Scheduled</span>
        <span>{startStr ? (endStr ? startStr + ' → ' + endStr : startStr) : '—'}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle} title="How much time the scheduler can shift this task before it misses its deadline. ∞ means no deadline constraint.">Slack</span>
        <span>{slackStr}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --watchAll=false --testPathPattern=MetaSection
```

Expected: 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/sections/MetaSection.jsx src/components/tasks/sections/__tests__/MetaSection.test.jsx
git commit -m "feat(task-detail): extract MetaSection"
```

---

## Task 4: WhereSection

**Files:**
- Create: `src/components/tasks/sections/WhereSection.jsx`
- Create: `src/components/tasks/sections/__tests__/WhereSection.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/tasks/sections/__tests__/WhereSection.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WhereSection from '../WhereSection';

const TH = { accent: '#4f46e5', btnBorder: '#ccc', textMuted: '#888', bgCard: '#fff' };
const LOCS = [
  { id: 'home', name: 'Home', icon: '🏠' },
  { id: 'office', name: 'Office', icon: '🏢' },
];

it('renders location buttons', () => {
  render(<WhereSection locations={LOCS} taskLoc={[]} onChange={() => {}} TH={TH} isMobile={false} />);
  expect(screen.getByText(/Home/)).toBeInTheDocument();
  expect(screen.getByText(/Office/)).toBeInTheDocument();
});

it('calls onChange with location id when clicked', () => {
  const onChange = jest.fn();
  render(<WhereSection locations={LOCS} taskLoc={[]} onChange={onChange} TH={TH} isMobile={false} />);
  fireEvent.click(screen.getByText(/Home/));
  expect(onChange).toHaveBeenCalledWith(['home']);
});

it('calls onChange with empty array when Anywhere clicked', () => {
  const onChange = jest.fn();
  render(<WhereSection locations={LOCS} taskLoc={['home']} onChange={onChange} TH={TH} isMobile={false} />);
  fireEvent.click(screen.getByText(/Anywhere/));
  expect(onChange).toHaveBeenCalledWith([]);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --watchAll=false --testPathPattern=WhereSection
```

Expected: FAIL

- [ ] **Step 3: Create WhereSection.jsx**

Cut the "Where" block (~lines 2007–2027 of `TaskEditForm.jsx`) into this file:

```jsx
// src/components/tasks/sections/WhereSection.jsx
import React from 'react';

export default function WhereSection({ locations, taskLoc, onChange, TH, isMobile }) {
  var BTN_H = isMobile ? 30 : 26;
  function togStyle(on, color) {
    return {
      height: BTN_H, padding: '0 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
      fontWeight: on ? 600 : 400, fontFamily: 'inherit', boxSizing: 'border-box',
      border: on ? '2px solid ' + (color || TH.accent) : '1px solid ' + TH.btnBorder,
      background: on ? (color || TH.accent) + '22' : TH.bgCard,
      color: on ? (color || TH.accent) : TH.textMuted,
    };
  }

  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      <button onClick={() => onChange([])} title="Task can be done at any location"
        style={togStyle(taskLoc.length === 0, '#2D6A4F')}>🌍 Anywhere</button>
      {(locations || []).map(function(loc) {
        var isOn = taskLoc.indexOf(loc.id) !== -1;
        var anywhere = taskLoc.length === 0;
        return (
          <button key={loc.id} title={'Restrict to ' + loc.name}
            onClick={() => {
              if (anywhere) { onChange([loc.id]); }
              else { onChange(isOn ? taskLoc.filter(function(x) { return x !== loc.id; }) : [...taskLoc, loc.id]); }
            }}
            style={{ ...togStyle(isOn && !anywhere), opacity: anywhere ? 0.4 : 1 }}>
            {loc.icon} {loc.name}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --watchAll=false --testPathPattern=WhereSection
```

Expected: 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/sections/WhereSection.jsx src/components/tasks/sections/__tests__/WhereSection.test.jsx
git commit -m "feat(task-detail): extract WhereSection"
```

---

## Task 5: WeatherSection

Weather section has two helper components (`WeatherTempSlider`, `WeatherHumiditySlider`) that are currently defined in `TaskEditForm.jsx`. They are only used by this section, so they move here.

**Files:**
- Create: `src/components/tasks/sections/WeatherSection.jsx`
- Create: `src/components/tasks/sections/__tests__/WeatherSection.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/tasks/sections/__tests__/WeatherSection.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WeatherSection from '../WeatherSection';

const TH = { accent: '#4f46e5', btnBorder: '#ccc', textMuted: '#888', bgCard: '#fff', inputBorder: '#ccc', inputBg: '#fff' };

const BASE = {
  weatherPrecip: 'any', weatherCloud: 'any',
  weatherTempMin: '', weatherTempMax: '',
  weatherHumidityMin: '', weatherHumidityMax: '',
};

it('renders precipitation buttons', () => {
  render(<WeatherSection {...BASE} onChange={() => {}} TH={TH} isMobile={false} tempUnitPref="F" />);
  expect(screen.getByText(/Dry only/)).toBeInTheDocument();
});

it('calls onChange with updated precip when button clicked', () => {
  const onChange = jest.fn();
  render(<WeatherSection {...BASE} onChange={onChange} TH={TH} isMobile={false} tempUnitPref="F" />);
  fireEvent.click(screen.getByText(/Dry only/));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ weatherPrecip: 'dry_only' }));
});

it('renders sky cover buttons', () => {
  render(<WeatherSection {...BASE} onChange={() => {}} TH={TH} isMobile={false} tempUnitPref="F" />);
  expect(screen.getByText(/Clear/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --watchAll=false --testPathPattern=WeatherSection
```

Expected: FAIL

- [ ] **Step 3: Create WeatherSection.jsx**

Cut `WeatherTempSlider`, `WeatherHumiditySlider`, and the "Weather" JSX block from `TaskEditForm.jsx` into this file. The `onChange` callback receives a partial update object `{ weatherPrecip, weatherCloud, weatherTempMin, weatherTempMax, weatherHumidityMin, weatherHumidityMax }`.

```jsx
// src/components/tasks/sections/WeatherSection.jsx
import React, { useRef } from 'react';

var TEMP_RANGES = { F: { min: -20, max: 120 }, C: { min: -29, max: 49 } };

function fToUnit(f, unit) { if (f == null) return f; if (unit === 'C') return Math.round((f - 32) * 5 / 9); return f; }
function unitToF(v, unit) { if (v == null) return v; if (unit === 'C') return Math.round(v * 9 / 5 + 32); return v; }

function WeatherTempSlider({ tempMin, tempMax, unit, onChange, TH }) {
  var displayUnit = unit === 'C' ? 'C' : 'F';
  var range = TEMP_RANGES[displayUnit];
  var totalSpan = range.max - range.min;
  var loF = (tempMin !== '' && tempMin !== null && tempMin !== undefined) ? Number(tempMin) : null;
  var hiF = (tempMax !== '' && tempMax !== null && tempMax !== undefined) ? Number(tempMax) : null;
  var lo = loF != null ? fToUnit(loF, displayUnit) : range.min;
  var hi = hiF != null ? fToUnit(hiF, displayUnit) : range.max;
  if (lo < range.min) lo = range.min;
  if (hi > range.max) hi = range.max;
  function pct(val) { return ((val - range.min) / totalSpan) * 100; }
  var noMin = lo <= range.min, noMax = hi >= range.max;
  var noRestriction = noMin && noMax;
  var loRef = useRef(null), hiRef = useRef(null);

  function handleMouseMove(e) {
    if (!loRef.current || !hiRef.current) return;
    var rect = e.currentTarget.getBoundingClientRect();
    var x = (e.clientX - rect.left) / rect.width;
    var preferLo = Math.abs(x - pct(lo)/100) <= Math.abs(x - pct(hi)/100);
    loRef.current.style.zIndex = preferLo ? 4 : 2;
    hiRef.current.style.zIndex = preferLo ? 2 : 3;
  }

  function handleLoChange(e) {
    var v = Math.min(Number(e.target.value), hi - 1);
    onChange(v <= range.min ? null : unitToF(v, displayUnit), noMax ? null : unitToF(hi, displayUnit));
  }
  function handleHiChange(e) {
    var v = Math.max(Number(e.target.value), lo + 1);
    onChange(noMin ? null : unitToF(lo, displayUnit), v >= range.max ? null : unitToF(v, displayUnit));
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 9, color: TH.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        Temperature (°{displayUnit})
        {noRestriction ? <span style={{ fontWeight: 400, marginLeft: 6 }}>Any</span>
          : <span style={{ fontWeight: 400, marginLeft: 6 }}>{noMin ? `up to ${hi}°${displayUnit}` : noMax ? `${lo}°${displayUnit}+` : `${lo}–${hi}°${displayUnit}`}</span>}
      </div>
      <div style={{ position: 'relative', height: 20, marginBottom: 4 }} onMouseMove={handleMouseMove}>
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 4, background: TH.inputBorder, borderRadius: 2, transform: 'translateY(-50%)' }} />
        <div style={{
          position: 'absolute', top: '50%', transform: 'translateY(-50%)', height: 4,
          left: pct(lo) + '%', right: (100 - pct(hi)) + '%',
          background: noRestriction ? TH.inputBorder : TH.accent, borderRadius: 2
        }} />
        <input ref={loRef} type="range" min={range.min} max={range.max} value={lo} onChange={handleLoChange}
          style={{ position: 'absolute', width: '100%', opacity: 0, cursor: 'pointer', zIndex: 2, margin: 0, height: '100%' }} />
        <input ref={hiRef} type="range" min={range.min} max={range.max} value={hi} onChange={handleHiChange}
          style={{ position: 'absolute', width: '100%', opacity: 0, cursor: 'pointer', zIndex: 3, margin: 0, height: '100%' }} />
      </div>
    </div>
  );
}

function WeatherHumiditySlider({ humidityMin, humidityMax, onChange, TH }) {
  var lo = humidityMin !== '' && humidityMin != null ? Number(humidityMin) : 0;
  var hi = humidityMax !== '' && humidityMax != null ? Number(humidityMax) : 100;
  var noRestriction = lo <= 0 && hi >= 100;
  var loRef = useRef(null), hiRef = useRef(null);

  function handleMouseMove(e) {
    if (!loRef.current || !hiRef.current) return;
    var rect = e.currentTarget.getBoundingClientRect();
    var x = (e.clientX - rect.left) / rect.width;
    var preferLo = Math.abs(x - lo/100) <= Math.abs(x - hi/100);
    loRef.current.style.zIndex = preferLo ? 4 : 2;
    hiRef.current.style.zIndex = preferLo ? 2 : 3;
  }

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 9, color: TH.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        Humidity (%)
        {noRestriction ? <span style={{ fontWeight: 400, marginLeft: 6 }}>Any</span>
          : <span style={{ fontWeight: 400, marginLeft: 6 }}>{lo}–{hi}%</span>}
      </div>
      <div style={{ position: 'relative', height: 20 }} onMouseMove={handleMouseMove}>
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 4, background: TH.inputBorder, borderRadius: 2, transform: 'translateY(-50%)' }} />
        <div style={{
          position: 'absolute', top: '50%', transform: 'translateY(-50%)', height: 4,
          left: lo + '%', right: (100 - hi) + '%',
          background: noRestriction ? TH.inputBorder : TH.accent, borderRadius: 2
        }} />
        <input ref={loRef} type="range" min={0} max={100} value={lo}
          onChange={e => { var v = Math.min(Number(e.target.value), hi - 1); onChange(v <= 0 ? null : v, hi >= 100 ? null : hi); }}
          style={{ position: 'absolute', width: '100%', opacity: 0, cursor: 'pointer', zIndex: 2, margin: 0, height: '100%' }} />
        <input ref={hiRef} type="range" min={0} max={100} value={hi}
          onChange={e => { var v = Math.max(Number(e.target.value), lo + 1); onChange(lo <= 0 ? null : lo, v >= 100 ? null : v); }}
          style={{ position: 'absolute', width: '100%', opacity: 0, cursor: 'pointer', zIndex: 3, margin: 0, height: '100%' }} />
      </div>
    </div>
  );
}

export default function WeatherSection({
  weatherPrecip, weatherCloud,
  weatherTempMin, weatherTempMax,
  weatherHumidityMin, weatherHumidityMax,
  onChange, TH, isMobile, tempUnitPref
}) {
  var BTN_H = isMobile ? 30 : 26;
  function togStyle(on) {
    return {
      height: BTN_H, padding: '0 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
      fontWeight: on ? 600 : 400, fontFamily: 'inherit', boxSizing: 'border-box',
      border: on ? '2px solid ' + TH.accent : '1px solid ' + TH.btnBorder,
      background: on ? TH.accent + '22' : TH.bgCard,
      color: on ? TH.accent : TH.textMuted,
    };
  }

  var PRECIP = [
    { val: 'any', label: '🌦️ Any' },
    { val: 'wet_ok', label: '🌧️ Precip OK' },
    { val: 'light_ok', label: '🌂 Light OK' },
    { val: 'dry_only', label: '☀️ Dry only' },
  ];
  var CLOUD = [
    { val: 'any', label: '⛅ Any' },
    { val: 'overcast_ok', label: '☁️ Overcast OK' },
    { val: 'partly_ok', label: '🌤️ Partly OK' },
    { val: 'clear', label: '☀️ Clear' },
  ];

  return (
    <div>
      <div style={{ fontSize: 9, color: TH.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Precipitation</div>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 8 }}>
        {PRECIP.map(function(o) {
          return <button key={o.val} onClick={() => onChange({ weatherPrecip: o.val })} style={togStyle(weatherPrecip === o.val)}>{o.label}</button>;
        })}
      </div>
      <div style={{ fontSize: 9, color: TH.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Sky cover</div>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 8 }}>
        {CLOUD.map(function(o) {
          return <button key={o.val} onClick={() => onChange({ weatherCloud: o.val })} style={togStyle(weatherCloud === o.val)}>{o.label}</button>;
        })}
      </div>
      <WeatherTempSlider
        tempMin={weatherTempMin} tempMax={weatherTempMax}
        unit={tempUnitPref || 'F'}
        onChange={(min, max) => onChange({
          weatherTempMin: min !== null ? String(min) : '',
          weatherTempMax: max !== null ? String(max) : ''
        })}
        TH={TH}
      />
      <WeatherHumiditySlider
        humidityMin={weatherHumidityMin} humidityMax={weatherHumidityMax}
        onChange={(min, max) => onChange({
          weatherHumidityMin: min !== null ? String(min) : '',
          weatherHumidityMax: max !== null ? String(max) : ''
        })}
        TH={TH}
      />
    </div>
  );
}
```

After creating this file, **delete** `WeatherTempSlider` and `WeatherHumiditySlider` from `TaskEditForm.jsx` (they moved here).

- [ ] **Step 4: Run tests**

```bash
npm test -- --watchAll=false --testPathPattern=WeatherSection
```

Expected: 3 tests pass

- [ ] **Step 5: Run full test suite to confirm nothing broke**

```bash
npm test -- --watchAll=false
```

Expected: all existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/components/tasks/sections/WeatherSection.jsx src/components/tasks/sections/__tests__/WeatherSection.test.jsx src/components/tasks/TaskEditForm.jsx
git commit -m "feat(task-detail): extract WeatherSection (moves WeatherTempSlider + WeatherHumiditySlider)"
```

---

## Task 6: ToolsSection

**Files:**
- Create: `src/components/tasks/sections/ToolsSection.jsx`
- Create: `src/components/tasks/sections/__tests__/ToolsSection.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/tasks/sections/__tests__/ToolsSection.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ToolsSection from '../ToolsSection';

const TH = { accent: '#4f46e5', btnBorder: '#ccc', textMuted: '#888', bgCard: '#fff' };
const TOOLS = [
  { id: 'car', name: 'Car', icon: '🚗' },
  { id: 'laptop', name: 'Laptop', icon: '💻' },
];

it('renders tool buttons', () => {
  render(<ToolsSection tools={TOOLS} taskTools={[]} onChange={() => {}} TH={TH} isMobile={false} />);
  expect(screen.getByText(/Car/)).toBeInTheDocument();
  expect(screen.getByText(/Laptop/)).toBeInTheDocument();
});

it('calls onChange with tool id when clicked', () => {
  const onChange = jest.fn();
  render(<ToolsSection tools={TOOLS} taskTools={[]} onChange={onChange} TH={TH} isMobile={false} />);
  fireEvent.click(screen.getByText(/Car/));
  expect(onChange).toHaveBeenCalledWith(['car']);
});

it('calls onChange removing tool when clicked again', () => {
  const onChange = jest.fn();
  render(<ToolsSection tools={TOOLS} taskTools={['car']} onChange={onChange} TH={TH} isMobile={false} />);
  fireEvent.click(screen.getByText(/Car/));
  expect(onChange).toHaveBeenCalledWith([]);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --watchAll=false --testPathPattern=ToolsSection
```

- [ ] **Step 3: Create ToolsSection.jsx**

```jsx
// src/components/tasks/sections/ToolsSection.jsx
import React from 'react';

export default function ToolsSection({ tools, taskTools, onChange, TH, isMobile }) {
  var BTN_H = isMobile ? 30 : 26;
  function togStyle(on) {
    return {
      height: BTN_H, padding: '0 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
      fontWeight: on ? 600 : 400, fontFamily: 'inherit', boxSizing: 'border-box',
      border: on ? '2px solid ' + TH.accent : '1px solid ' + TH.btnBorder,
      background: on ? TH.accent + '22' : TH.bgCard,
      color: on ? TH.accent : TH.textMuted,
    };
  }

  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      {(tools || []).map(function(tool) {
        var isOn = taskTools.indexOf(tool.id) !== -1;
        return (
          <button key={tool.id} title={'Requires ' + tool.name}
            onClick={() => onChange(isOn ? taskTools.filter(function(x) { return x !== tool.id; }) : [...taskTools, tool.id])}
            style={togStyle(isOn)}>
            {tool.icon} {tool.name}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --watchAll=false --testPathPattern=ToolsSection
```

Expected: 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/sections/ToolsSection.jsx src/components/tasks/sections/__tests__/ToolsSection.test.jsx
git commit -m "feat(task-detail): extract ToolsSection"
```

---

## Task 7: DependsOnSection

The current form has a "Dependencies" button that opens the dependency view chain. Extract the dependency UI into its own section. Look at how `task.dependsOn` is rendered in the existing "Task Description" section (~lines 1290–1297 of `TaskEditForm.jsx`).

**Files:**
- Create: `src/components/tasks/sections/DependsOnSection.jsx`
- Create: `src/components/tasks/sections/__tests__/DependsOnSection.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/tasks/sections/__tests__/DependsOnSection.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DependsOnSection from '../DependsOnSection';

const TH = { accent: '#4f46e5', border: '#ccc', btnBorder: '#ccc', textMuted: '#888', bgCard: '#fff', text: '#000' };

it('shows dep count when deps are set', () => {
  render(<DependsOnSection task={{ id: 't1', dependsOn: ['t2', 't3'], recurring: false }}
    onShowChain={() => {}} TH={TH} isMobile={false} />);
  expect(screen.getByText(/2/)).toBeInTheDocument();
});

it('calls onShowChain when button clicked', () => {
  const onShowChain = jest.fn();
  render(<DependsOnSection task={{ id: 't1', dependsOn: ['t2'], recurring: false }}
    onShowChain={onShowChain} TH={TH} isMobile={false} />);
  fireEvent.click(screen.getByRole('button'));
  expect(onShowChain).toHaveBeenCalled();
});

it('renders nothing for recurring tasks (no dep chain UI)', () => {
  const { container } = render(<DependsOnSection
    task={{ id: 't1', dependsOn: [], recurring: true }}
    onShowChain={() => {}} TH={TH} isMobile={false} />);
  expect(container.firstChild).toBeNull();
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --watchAll=false --testPathPattern=DependsOnSection
```

- [ ] **Step 3: Create DependsOnSection.jsx**

```jsx
// src/components/tasks/sections/DependsOnSection.jsx
import React from 'react';

export default function DependsOnSection({ task, onShowChain, TH, isMobile }) {
  if (task.recurring) return null;

  var BTN_H = isMobile ? 30 : 26;
  var depCount = task.dependsOn && task.dependsOn.length > 0 ? task.dependsOn.length : 0;

  return (
    <button onClick={onShowChain} style={{
      border: '1px solid #0EA5E9', borderRadius: 4, padding: '4px 10px',
      background: 'transparent', color: '#0EA5E9', fontSize: 10, fontWeight: 600,
      cursor: 'pointer', fontFamily: 'inherit', width: '100%',
      height: BTN_H, boxSizing: 'border-box'
    }}>
      🔗 Dependencies{depCount > 0 ? ' (' + depCount + ')' : ''}
    </button>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --watchAll=false --testPathPattern=DependsOnSection
```

Expected: 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/sections/DependsOnSection.jsx src/components/tasks/sections/__tests__/DependsOnSection.test.jsx
git commit -m "feat(task-detail): extract DependsOnSection"
```

---

## Task 8: WhenSection

This is the most complex extraction. The existing When block runs from ~line 1340 to ~line 2006 in `TaskEditForm.jsx`. It contains:
- Date / Start / End / Duration fields (three-way binding)
- Float/Fixed badge
- Timezone selector (`TimezoneSelector` — moves here)
- Recurring mode (fixed-time window vs. time blocks)
- Non-recurring date/time
- Recurrence config (type, days, tpc, date range)
- Deadline, start-after, split, travel buffers

`TimezoneSelector` is currently defined in `TaskEditForm.jsx` (~lines 66–161). It moves to `WhenSection.jsx`.

The section exposes three nested collapsibles:
- **Tier 1 (Date & Time)** — always visible inside When
- **Tier 2 (Recurrence)** — `CollapsibleSection` with `id="when_recurrence"`
- **Tier 3 (Constraints)** — `CollapsibleSection` with `id="when_constraints"`

`collapse` and `toggleCollapse` are passed down from `TaskEditForm`.

**Files:**
- Create: `src/components/tasks/sections/WhenSection.jsx`
- Create: `src/components/tasks/sections/__tests__/WhenSection.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// src/components/tasks/sections/__tests__/WhenSection.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WhenSection from '../WhenSection';

const TH = {
  accent: '#4f46e5', btnBorder: '#ccc', textMuted: '#888', bgCard: '#fff',
  border: '#ccc', text: '#000', inputBg: '#fff', inputBorder: '#ccc', inputText: '#000',
  amberBg: '#fff3cd', amberText: '#856404', amberBorder: '#ffc107', purpleBg: '#f3e8ff', purpleText: '#7c3aed'
};

var BASE = {
  date: '2026-05-17', time: '14:00', endTime: '14:30', dur: 30,
  recurring: false, rigid: false, timeFlex: 60,
  recurType: 'none', recurDays: 'MTWRF', recurEvery: 1, recurTpc: 1,
  recurStart: '', recurEnd: '',
  deadline: '', startAfter: '', split: false, splitMin: 15,
  travelBefore: 0, travelAfter: 0, marker: false, flexWhen: false,
  datePinned: false, dayReq: 'any', when: '', timeRemaining: '',
  taskTz: 'America/New_York',
  isCreate: false, isMobile: false, scheduleTemplates: [], templateDefaults: {},
  collapse: { when_recurrence: false, when_constraints: false },
  uniqueTags: [],
};

function noop() {}

it('renders date field', () => {
  render(<WhenSection {...BASE} TH={TH}
    onDateChange={noop} onTimeChange={noop} onEndTimeChange={noop} onDurChange={noop}
    onRigidChange={noop} onTimeFlexChange={noop} onRecurTypeChange={noop}
    onRecurDaysChange={noop} onRecurEveryChange={noop} onRecurTpcChange={noop}
    onRecurStartChange={noop} onRecurEndChange={noop}
    onDeadlineChange={noop} onStartAfterChange={noop}
    onSplitChange={noop} onSplitMinChange={noop}
    onTravelBeforeChange={noop} onTravelAfterChange={noop}
    onMarkerChange={noop} onFlexWhenChange={noop} onDatePinnedChange={noop}
    onDayReqChange={noop} onWhenChange={noop} onTimeRemainingChange={noop}
    onChangeTz={noop} toggleCollapse={noop}
  />);
  expect(screen.getByDisplayValue('2026-05-17')).toBeInTheDocument();
});

it('shows Recurrence sub-section collapsed by default', () => {
  render(<WhenSection {...BASE} TH={TH}
    onDateChange={noop} onTimeChange={noop} onEndTimeChange={noop} onDurChange={noop}
    onRigidChange={noop} onTimeFlexChange={noop} onRecurTypeChange={noop}
    onRecurDaysChange={noop} onRecurEveryChange={noop} onRecurTpcChange={noop}
    onRecurStartChange={noop} onRecurEndChange={noop}
    onDeadlineChange={noop} onStartAfterChange={noop}
    onSplitChange={noop} onSplitMinChange={noop}
    onTravelBeforeChange={noop} onTravelAfterChange={noop}
    onMarkerChange={noop} onFlexWhenChange={noop} onDatePinnedChange={noop}
    onDayReqChange={noop} onWhenChange={noop} onTimeRemainingChange={noop}
    onChangeTz={noop} toggleCollapse={noop}
  />);
  // When_recurrence is false by default → recurrence mode buttons should not be visible
  expect(screen.queryByText(/Daily/)).not.toBeInTheDocument();
});

it('expands Recurrence sub-section when collapse.when_recurrence is true', () => {
  render(<WhenSection {...BASE} collapse={{ when_recurrence: true, when_constraints: false }} TH={TH}
    onDateChange={noop} onTimeChange={noop} onEndTimeChange={noop} onDurChange={noop}
    onRigidChange={noop} onTimeFlexChange={noop} onRecurTypeChange={noop}
    onRecurDaysChange={noop} onRecurEveryChange={noop} onRecurTpcChange={noop}
    onRecurStartChange={noop} onRecurEndChange={noop}
    onDeadlineChange={noop} onStartAfterChange={noop}
    onSplitChange={noop} onSplitMinChange={noop}
    onTravelBeforeChange={noop} onTravelAfterChange={noop}
    onMarkerChange={noop} onFlexWhenChange={noop} onDatePinnedChange={noop}
    onDayReqChange={noop} onWhenChange={noop} onTimeRemainingChange={noop}
    onChangeTz={noop} toggleCollapse={noop}
  />);
  expect(screen.getByText(/Daily/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --watchAll=false --testPathPattern=WhenSection
```

- [ ] **Step 3: Create WhenSection.jsx**

This is a large file. Move the following from `TaskEditForm.jsx` into `WhenSection.jsx`:
1. `TimezoneSelector` function (~lines 66–161)
2. `addMinutesTo24h` and `minutesFrom24h` helper functions (~lines 15–33)
3. The entire When JSX block (~lines 1340–2006)

Wrap the When block in three tiers using `CollapsibleSection`. `collapse` and `toggleCollapse` are props.

```jsx
// src/components/tasks/sections/WhenSection.jsx
import React, { useRef } from 'react';
import CollapsibleSection from '../CollapsibleSection';
import { getTimezoneAbbr, getUtcOffset } from '../../../utils/timezone';
import { isAnchorDependentRecur } from '../../../scheduler/expandRecurring';
import { toTime24, fromTime24, toDateISO, fromDateISO } from '../../../scheduler/dateHelpers';

// ─── helpers (moved from TaskEditForm) ───────────────────────────────────────

var ALL_TIMEZONES = (function() {
  try {
    if (typeof Intl !== 'undefined' && Intl.supportedValuesOf) return Intl.supportedValuesOf('timeZone');
  } catch (e) { /* ignore */ }
  return ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Anchorage', 'America/Phoenix', 'Pacific/Honolulu', 'America/Toronto',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai',
    'Asia/Kolkata', 'Australia/Sydney', 'Pacific/Auckland'];
})();

function addMinutesTo24h(hhmm, mins) {
  if (!hhmm) return '';
  var parts = String(hhmm).split(':');
  var h = parseInt(parts[0], 10); if (isNaN(h)) return '';
  var m = parseInt(parts[1], 10); if (isNaN(m)) m = 0;
  var total = h * 60 + m + (Number(mins) || 0);
  if (total < 0) total = 0;
  if (total > 23 * 60 + 59) total = 23 * 60 + 59;
  var nh = Math.floor(total / 60), nm = total % 60;
  return (nh < 10 ? '0' : '') + nh + ':' + (nm < 10 ? '0' : '') + nm;
}

function minutesFrom24h(hhmm) {
  if (!hhmm) return null;
  var parts = String(hhmm).split(':');
  var h = parseInt(parts[0], 10); if (isNaN(h)) return null;
  var m = parseInt(parts[1], 10); if (isNaN(m)) m = 0;
  return h * 60 + m;
}

function TimezoneSelector({ taskTz, onChangeTz, TH }) {
  var [tzSearch, setTzSearch] = React.useState('');
  var [tzOpen, setTzOpen] = React.useState(false);
  var dropdownRef = React.useRef(null);

  React.useEffect(function() {
    if (!tzOpen) return;
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setTzOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return function() { document.removeEventListener('mousedown', handleClick); };
  }, [tzOpen]);

  var searchLower = tzSearch.toLowerCase();
  var filteredTzs = searchLower
    ? ALL_TIMEZONES.filter(function(tz) { return tz.toLowerCase().includes(searchLower); })
    : ALL_TIMEZONES;
  var displayTzs = filteredTzs.slice(0, 50);

  function selectTz(tz) { onChangeTz(tz); setTzOpen(false); setTzSearch(''); }

  var tzAbbr = getTimezoneAbbr(taskTz);
  var utcOff = getUtcOffset(taskTz);

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button onClick={function() { setTzOpen(!tzOpen); setTzSearch(''); }} style={{
        fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
        border: '1px solid ' + TH.inputBorder, background: TH.inputBg, color: TH.text,
        fontFamily: 'inherit', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4
      }}>
        🌐 {tzAbbr} <span style={{ fontSize: 9, color: TH.textMuted, fontFamily: 'monospace' }}>{utcOff}</span> ▾
      </button>
      {tzOpen && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, zIndex: 200, width: 280,
          background: TH.bgCard, border: '1px solid ' + TH.inputBorder, borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
        }}>
          <div style={{ padding: 6 }}>
            <input type="text" autoFocus value={tzSearch} placeholder="Search timezones..."
              onChange={function(e) { setTzSearch(e.target.value); }}
              style={{ width: '100%', fontSize: 12, padding: '5px 8px',
                border: '1px solid ' + TH.inputBorder, borderRadius: 4,
                background: TH.inputBg, color: TH.text, boxSizing: 'border-box' }} />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {displayTzs.map(function(tz) {
              var isSelected = tz === taskTz;
              return (
                <div key={tz} onClick={function() { selectTz(tz); }} style={{
                  padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                  background: isSelected ? TH.accent + '22' : 'transparent', color: TH.text,
                  borderBottom: '1px solid ' + TH.inputBorder + '33',
                  display: 'flex', justifyContent: 'space-between'
                }}>
                  <span style={{ fontWeight: isSelected ? 600 : 400 }}>{tz.replace(/_/g, ' ')}</span>
                  <span style={{ fontSize: 10, color: TH.textMuted, fontFamily: 'monospace' }}>{getUtcOffset(tz)}</span>
                </div>
              );
            })}
            {filteredTzs.length > 50 && (
              <div style={{ padding: '6px 10px', fontSize: 10, color: TH.textMuted, textAlign: 'center' }}>
                Type to narrow {filteredTzs.length} results...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function WhenSection(props) {
  var {
    // scheduling fields
    date, onDateChange,
    time, onTimeChange,
    endTime, onEndTimeChange, endTimeError,
    dur, onDurChange,
    recurring, rigid, onRigidChange,
    timeFlex, onTimeFlexChange,
    recurType, onRecurTypeChange,
    recurDays, onRecurDaysChange,
    recurEvery, onRecurEveryChange,
    recurTpc, onRecurTpcChange,
    recurStart, onRecurStartChange,
    recurEnd, onRecurEndChange,
    deadline, onDeadlineChange,
    startAfter, onStartAfterChange,
    split, onSplitChange,
    splitMin, onSplitMinChange,
    travelBefore, onTravelBeforeChange,
    travelAfter, onTravelAfterChange,
    marker, onMarkerChange,
    flexWhen, onFlexWhenChange,
    datePinned, onDatePinnedChange,
    dayReq, onDayReqChange,
    when, onWhenChange,
    timeRemaining, onTimeRemainingChange,
    taskTz, onChangeTz,
    // context
    task, isCreate, isMobile, TH,
    scheduleTemplates, templateDefaults,
    uniqueTags,
    // collapse
    collapse, toggleCollapse,
  } = props;

  var BTN_H = isMobile ? 30 : 26;
  var iStyle = {
    fontSize: isMobile ? 13 : 11, padding: isMobile ? '6px 8px' : '3px 4px',
    border: '1px solid ' + TH.inputBorder, borderRadius: 4,
    background: TH.inputBg, color: TH.inputText, fontFamily: 'inherit',
    height: BTN_H, boxSizing: 'border-box', maxWidth: '100%'
  };
  var lStyle = { fontSize: 9, color: TH.textMuted, display: 'flex', flexDirection: 'column', gap: 2, fontWeight: 600 };
  function togStyle(on, color) {
    return {
      height: BTN_H, padding: '0 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
      fontWeight: on ? 600 : 400, fontFamily: 'inherit', boxSizing: 'border-box',
      border: on ? '2px solid ' + (color || TH.accent) : '1px solid ' + TH.btnBorder,
      background: on ? (color || TH.accent) + '22' : TH.bgCard,
      color: on ? (color || TH.accent) : TH.textMuted,
    };
  }

  var isRecurring = !!recurring;
  var hasPreferredTime = isRecurring && recurType !== 'none' && !(!timeFlex && !rigid);

  // Build the "When" badge for the collapsed header
  function buildBadge() {
    if (!date) return 'No date';
    var label = date === new Date().toISOString().slice(0, 10) ? 'Today' : date;
    if (time) {
      var startDisplay = fromTime24(time) || time;
      if (endTime) {
        var endDisplay = fromTime24(endTime) || endTime;
        return label + ' · ' + startDisplay + '–' + endDisplay;
      }
      return label + ' · ' + startDisplay;
    }
    return label;
  }

  // ── Tier 1: Date & Time (always visible) ─────────────────────────────────

  var tier1 = (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 }}>
        <label style={lStyle}>
          Date
          <input type="date" value={date} onChange={e => onDateChange(e.target.value)}
            style={{ ...iStyle, width: 130 }} />
        </label>
        <label style={lStyle}>
          Start
          <input type="time" value={time} onChange={e => {
            onTimeChange(e.target.value);
            if (e.target.value && dur) onEndTimeChange(addMinutesTo24h(e.target.value, dur));
          }} style={{ ...iStyle, width: 90 }} />
        </label>
        <label style={lStyle}>
          End
          <input type="time" value={endTime} onChange={e => {
            onEndTimeChange(e.target.value);
            if (e.target.value && time) {
              var startMins = minutesFrom24h(time);
              var endMins = minutesFrom24h(e.target.value);
              if (startMins !== null && endMins !== null && endMins > startMins) {
                onDurChange(endMins - startMins);
              }
            }
          }} style={{ ...iStyle, width: 90 }} />
        </label>
        <label style={lStyle}>
          Duration
          <input type="number" min={1} value={dur} onChange={e => {
            var v = Math.max(1, parseInt(e.target.value, 10) || 1);
            onDurChange(v);
            if (time) onEndTimeChange(addMinutesTo24h(time, v));
          }} style={{ ...iStyle, width: 65 }} />
        </label>
      </div>
      {endTimeError && <div style={{ fontSize: 9, color: TH.amberText, marginBottom: 4 }}>{endTimeError}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
        <TimezoneSelector taskTz={taskTz} onChangeTz={onChangeTz} TH={TH} />
        <button onClick={() => onRigidChange(!rigid)} style={{ ...togStyle(rigid, '#2D6A4F'), fontSize: 9 }}>
          {rigid ? '📌 Fixed' : '🔀 Float'}
        </button>
      </div>
    </div>
  );

  // ── Tier 2: Recurrence ────────────────────────────────────────────────────

  var recurBadge = recurType && recurType !== 'none' ? recurType.charAt(0).toUpperCase() + recurType.slice(1) : 'none';
  var tier2 = (
    <CollapsibleSection
      id="when_recurrence" label="Recurrence"
      isOpen={!!collapse.when_recurrence}
      onToggle={toggleCollapse}
      badge={recurBadge}
      TH={TH}
    >
      <div>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 6 }}>
          {['none', 'daily', 'weekly', 'weekdays', 'custom'].map(function(rt) {
            return (
              <button key={rt} onClick={() => onRecurTypeChange(rt)} style={togStyle(recurType === rt)}>
                {rt.charAt(0).toUpperCase() + rt.slice(1)}
              </button>
            );
          })}
        </div>
        {recurType !== 'none' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={lStyle}>
              Every
              <input type="number" min={1} value={recurEvery} onChange={e => onRecurEveryChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
                style={{ ...iStyle, width: 55 }} />
            </label>
            <label style={lStyle}>
              Times/cycle
              <input type="number" min={1} value={recurTpc} onChange={e => onRecurTpcChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
                style={{ ...iStyle, width: 55 }} />
            </label>
            <label style={lStyle}>
              Start
              <input type="date" value={recurStart} onChange={e => onRecurStartChange(e.target.value)}
                style={{ ...iStyle, width: 130 }} />
            </label>
            <label style={lStyle}>
              End
              <input type="date" value={recurEnd} onChange={e => onRecurEndChange(e.target.value)}
                style={{ ...iStyle, width: 130 }} />
            </label>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );

  // ── Tier 3: Constraints ───────────────────────────────────────────────────

  var constraintsBadge = deadline ? 'deadline set' : '';
  var tier3 = (
    <CollapsibleSection
      id="when_constraints" label="Constraints"
      isOpen={!!collapse.when_constraints}
      onToggle={toggleCollapse}
      badge={constraintsBadge}
      TH={TH}
    >
      <div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 }}>
          <label style={lStyle}>
            Deadline
            <input type="date" value={deadline} onChange={e => onDeadlineChange(e.target.value)}
              style={{ ...iStyle, width: 130 }} />
          </label>
          <label style={lStyle}>
            Start after
            <input type="date" value={startAfter} onChange={e => onStartAfterChange(e.target.value)}
              style={{ ...iStyle, width: 130 }} />
          </label>
        </div>
        {!marker && !isRecurring && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 }}>
            <label style={lStyle}>
              Travel before (min)
              <input type="number" min={0} value={travelBefore} onChange={e => onTravelBeforeChange(parseInt(e.target.value, 10) || 0)}
                style={{ ...iStyle, width: 80 }} />
            </label>
            <label style={lStyle}>
              Travel after (min)
              <input type="number" min={0} value={travelAfter} onChange={e => onTravelAfterChange(parseInt(e.target.value, 10) || 0)}
                style={{ ...iStyle, width: 80 }} />
            </label>
          </div>
        )}
        {!marker && !isRecurring && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ ...lStyle, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <input type="checkbox" checked={!!split} onChange={e => onSplitChange(e.target.checked)} />
              Allow split
            </label>
            {split && (
              <label style={lStyle}>
                Min chunk (min)
                <input type="number" min={5} value={splitMin} onChange={e => onSplitMinChange(parseInt(e.target.value, 10) || 15)}
                  style={{ ...iStyle, width: 65 }} />
              </label>
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );

  return (
    <div>
      {tier1}
      {tier2}
      {tier3}
    </div>
  );
}
```

**Important:** After creating `WhenSection.jsx`, remove the `TimezoneSelector`, `addMinutesTo24h`, and `minutesFrom24h` definitions from `TaskEditForm.jsx` (they are now in `WhenSection.jsx`). Also remove the entire When JSX block from the `dialogContent` in `TaskEditForm.jsx`.

- [ ] **Step 4: Run tests**

```bash
npm test -- --watchAll=false --testPathPattern=WhenSection
```

Expected: 3 tests pass

- [ ] **Step 5: Run full test suite**

```bash
npm test -- --watchAll=false
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/components/tasks/sections/WhenSection.jsx src/components/tasks/sections/__tests__/WhenSection.test.jsx src/components/tasks/TaskEditForm.jsx
git commit -m "feat(task-detail): extract WhenSection with nested Recurrence + Constraints"
```

---

## Task 9: Wire TaskEditForm as orchestrator

Replace the existing inline JSX blocks in `TaskEditForm.jsx` with imports of the new components, threading props through to each child. After this task, `TaskEditForm.jsx` should be ~350 lines.

**Files:**
- Modify: `src/components/tasks/TaskEditForm.jsx`

- [ ] **Step 1: Write the orchestrator integration test**

```jsx
// src/components/tasks/__tests__/TaskEditForm.integration.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TaskEditForm from '../TaskEditForm';

const BASE_TASK = {
  id: 't1', text: 'Test task', pri: 'P3', dur: 30, project: '', notes: '', url: '',
  location: [], tools: [], dependsOn: [], recurring: false, marker: false,
  slackMins: null, createdAt: '2026-01-01T00:00:00Z',
  weatherPrecip: 'any', weatherCloud: 'any',
  weatherTempMin: null, weatherTempMax: null,
  weatherHumidityMin: null, weatherHumidityMax: null,
};

it('renders task title', () => {
  render(<TaskEditForm task={BASE_TASK} status="todo" onUpdate={() => {}} onStatusChange={() => {}}
    onDelete={() => {}} onClose={() => {}} darkMode={false} isMobile={false}
    locations={[]} tools={[]} uniqueTags={[]} allProjectNames={[]}
    scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
  />);
  expect(screen.getByDisplayValue('Test task')).toBeInTheDocument();
});

it('When section is expanded by default', () => {
  // Clear localStorage so defaults kick in
  localStorage.clear();
  render(<TaskEditForm task={BASE_TASK} status="todo" onUpdate={() => {}} onStatusChange={() => {}}
    onDelete={() => {}} onClose={() => {}} darkMode={false} isMobile={false}
    locations={[]} tools={[]} uniqueTags={[]} allProjectNames={[]}
    scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
  />);
  // When expanded → Date input visible
  expect(screen.getByLabelText !== undefined).toBe(true); // sanity
  // The date input should be present since When is expanded
  expect(document.querySelector('input[type="date"]')).toBeInTheDocument();
});

it('clicking ▶ When collapses the section', () => {
  localStorage.clear();
  render(<TaskEditForm task={BASE_TASK} status="todo" onUpdate={() => {}} onStatusChange={() => {}}
    onDelete={() => {}} onClose={() => {}} darkMode={false} isMobile={false}
    locations={[]} tools={[]} uniqueTags={[]} allProjectNames={[]}
    scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
  />);
  // Find and click the When toggle
  var whenButton = screen.getByText(/▼ When/);
  fireEvent.click(whenButton);
  expect(screen.queryByText(/▼ When/)).not.toBeInTheDocument();
  expect(screen.getByText(/▶ When/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to confirm it fails** (imports will fail until orchestrator is wired)

```bash
npm test -- --watchAll=false --testPathPattern=TaskEditForm.integration
```

- [ ] **Step 3: Rewrite TaskEditForm.jsx as orchestrator**

Add imports at the top of `TaskEditForm.jsx`:

```js
import CollapsibleSection from './CollapsibleSection';
import TaskDetailHeader from './TaskDetailHeader';
import MetaSection from './sections/MetaSection';
import WhereSection from './sections/WhereSection';
import WeatherSection from './sections/WeatherSection';
import ToolsSection from './sections/ToolsSection';
import DependsOnSection from './sections/DependsOnSection';
import WhenSection from './sections/WhenSection';
```

Replace the entire `dialogContent` JSX (between `var dialogContent = (` and the closing `);`) with:

```jsx
var dialogContent = (
  <>
    <TaskDetailHeader
      task={task} isCreate={isCreate} isMobile={isMobile} TH={TH} darkMode={darkMode}
      isDirty={isDirty} saveStatus={saveStatus} onSave={handleSave} onCreate={handleCreate}
      onClose={onClose} onDelete={onDelete} calSyncSettings={calSyncSettings}
      status={status} onStatusChange={onStatusChange}
      text={text} onTextChange={setText}
      project={project} onProjectChange={setProject} allProjectNames={allProjectNames}
      pri={pri} onPriChange={setPri}
      dur={dur}
      notes={notes} onNotesChange={setNotes}
      url={url} onUrlChange={setUrl}
      scheduledBadge={date && time ? (date === formatDateKey(new Date()) ? 'Today' : date) + ' · ' + (fromTime24(time) || time) + (endTime ? '–' + (fromTime24(endTime) || endTime) : '') : null}
      unplacedDetail={!isCreate && task && task._unplacedDetail ? task._unplacedDetail : null}
      whenBlocked={!isCreate && task && task._whenBlocked && !flexWhen}
      onEnableFlex={() => setFlexWhen(true)}
    />

    {!marker && (
      <CollapsibleSection id="when" label="When" isOpen={!!collapse.when}
        onToggle={toggleCollapse}
        badge={collapse.when ? null : (date && time ? (date === new Date().toISOString().slice(0,10) ? 'Today' : date) + ' · ' + (fromTime24(time)||time) + (endTime ? '–'+(fromTime24(endTime)||endTime) : '') : 'No date')}
        TH={TH}>
        <WhenSection
          date={date} onDateChange={setDate}
          time={time} onTimeChange={setTime}
          endTime={endTime} onEndTimeChange={setEndTime} endTimeError={endTimeError}
          dur={dur} onDurChange={setDur}
          recurring={recurring} rigid={rigid} onRigidChange={setRigid}
          timeFlex={timeFlex} onTimeFlexChange={setTimeFlex}
          recurType={recurType} onRecurTypeChange={setRecurType}
          recurDays={recurDays} onRecurDaysChange={setRecurDays}
          recurEvery={recurEvery} onRecurEveryChange={setRecurEvery}
          recurTpc={recurTpc} onRecurTpcChange={setRecurTpc}
          recurStart={recurStart} onRecurStartChange={setRecurStart}
          recurEnd={recurEnd} onRecurEndChange={setRecurEnd}
          deadline={deadline} onDeadlineChange={setDeadline}
          startAfter={startAfter} onStartAfterChange={setStartAfter}
          split={split} onSplitChange={setSplit}
          splitMin={splitMin} onSplitMinChange={setSplitMin}
          travelBefore={travelBefore} onTravelBeforeChange={setTravelBefore}
          travelAfter={travelAfter} onTravelAfterChange={setTravelAfter}
          marker={marker} onMarkerChange={setMarker}
          flexWhen={flexWhen} onFlexWhenChange={setFlexWhen}
          datePinned={datePinned} onDatePinnedChange={setDatePinned}
          dayReq={dayReq} onDayReqChange={setDayReq}
          when={when} onWhenChange={setWhen}
          timeRemaining={timeRemaining} onTimeRemainingChange={setTimeRemaining}
          taskTz={taskTz} onChangeTz={changeTaskTimezone}
          task={task} isCreate={isCreate} isMobile={isMobile} TH={TH}
          scheduleTemplates={scheduleTemplates} templateDefaults={templateDefaults}
          uniqueTags={uniqueTags}
          collapse={collapse} toggleCollapse={toggleCollapse}
        />
      </CollapsibleSection>
    )}

    {!marker && (
      <CollapsibleSection id="where" label="Where" isOpen={!!collapse.where}
        onToggle={toggleCollapse}
        badge={taskLoc.length > 0 ? taskLoc.length + ' location' + (taskLoc.length > 1 ? 's' : '') : null}
        TH={TH}>
        <WhereSection locations={locations} taskLoc={taskLoc} onChange={setTaskLoc} TH={TH} isMobile={isMobile} />
      </CollapsibleSection>
    )}

    {!marker && (
      <CollapsibleSection id="weather" label="Weather" isOpen={!!collapse.weather}
        onToggle={toggleCollapse}
        badge={(weatherTempMin || weatherTempMax) ? (weatherTempMin || '?') + '–' + (weatherTempMax || '?') + '°' : null}
        TH={TH}>
        <WeatherSection
          weatherPrecip={weatherPrecip} weatherCloud={weatherCloud}
          weatherTempMin={weatherTempMin} weatherTempMax={weatherTempMax}
          weatherHumidityMin={weatherHumidityMin} weatherHumidityMax={weatherHumidityMax}
          onChange={function(patch) {
            if (patch.weatherPrecip !== undefined) setWeatherPrecip(patch.weatherPrecip);
            if (patch.weatherCloud !== undefined) setWeatherCloud(patch.weatherCloud);
            if (patch.weatherTempMin !== undefined) setWeatherTempMin(patch.weatherTempMin);
            if (patch.weatherTempMax !== undefined) setWeatherTempMax(patch.weatherTempMax);
            if (patch.weatherHumidityMin !== undefined) setWeatherHumidityMin(patch.weatherHumidityMin);
            if (patch.weatherHumidityMax !== undefined) setWeatherHumidityMax(patch.weatherHumidityMax);
          }}
          TH={TH} isMobile={isMobile} tempUnitPref={tempUnitPref}
        />
      </CollapsibleSection>
    )}

    {!marker && (tools || []).length > 0 && (
      <CollapsibleSection id="tools" label="Tools" isOpen={!!collapse.tools}
        onToggle={toggleCollapse}
        badge={taskTools.length > 0 ? taskTools.length + ' tool' + (taskTools.length > 1 ? 's' : '') : null}
        TH={TH}>
        <ToolsSection tools={tools} taskTools={taskTools} onChange={setTaskTools} TH={TH} isMobile={isMobile} />
      </CollapsibleSection>
    )}

    {!isCreate && onShowChain && (
      <CollapsibleSection id="deps" label="Depends On" isOpen={!!collapse.deps}
        onToggle={toggleCollapse}
        badge={task && task.dependsOn && task.dependsOn.length > 0 ? task.dependsOn.length + ' dep' + (task.dependsOn.length > 1 ? 's' : '') : null}
        TH={TH}>
        <DependsOnSection task={task} onShowChain={onShowChain} TH={TH} isMobile={isMobile} />
      </CollapsibleSection>
    )}

    {!isCreate && (
      <CollapsibleSection id="meta" label="Metadata" isOpen={!!collapse.meta}
        onToggle={toggleCollapse} TH={TH}>
        <MetaSection task={task} TH={TH} />
      </CollapsibleSection>
    )}

    {manageCalDialog && !isCreate && task && (
      <ManageCalTaskDialog
        task={task} darkMode={darkMode}
        onClose={function() { setManageCalDialog(false); }}
        onOwnershipTaken={function(updatedTask) { if (onUpdate && updatedTask) onUpdate(updatedTask); }}
      />
    )}
  </>
);
```

- [ ] **Step 4: Run integration tests**

```bash
npm test -- --watchAll=false --testPathPattern=TaskEditForm.integration
```

Expected: 3 tests pass

- [ ] **Step 5: Run full test suite**

```bash
npm test -- --watchAll=false
```

Expected: all tests pass

- [ ] **Step 6: Verify in browser**

Start dev server:
```bash
npm start
```

Manual smoke checks:
1. Open any task → rich header visible, When expanded, all other sections collapsed
2. Collapse When → badge shows `"Today · 2:00–2:30 PM"` (or `"No date"`)
3. Close task, reopen → collapse state preserved
4. Expand Weather → temp sliders work, values save correctly
5. Edit any field → save → reopen → value persists
6. Create mode → Create button visible, no status buttons, no Metadata/DependsOn sections

- [ ] **Step 7: Commit**

```bash
git add src/components/tasks/TaskEditForm.jsx src/components/tasks/__tests__/TaskEditForm.integration.test.jsx
git commit -m "feat(task-detail): wire TaskEditForm as orchestrator — collapsible sections"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** CollapsibleSection ✓ · collapse state + localStorage ✓ · TaskDetailHeader (all 5 rows) ✓ · WhenSection (3 tiers) ✓ · WhereSection ✓ · WeatherSection ✓ · ToolsSection ✓ · DependsOnSection ✓ · MetaSection ✓ · badges per section ✓
- [x] **Placeholders:** none
- [x] **Type consistency:** `onChange` signatures consistent (`WhereSection` and `ToolsSection` pass arrays; `WeatherSection` passes patch object; all match orchestrator usage)
- [x] **Helper moves:** `WeatherTempSlider`/`WeatherHumiditySlider` → `WeatherSection.jsx`; `TimezoneSelector`/`addMinutesTo24h`/`minutesFrom24h` → `WhenSection.jsx`; plan notes both removals

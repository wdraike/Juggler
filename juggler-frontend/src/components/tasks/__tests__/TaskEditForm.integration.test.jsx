import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

jest.mock('../../../services/apiClient');

import TaskEditForm from '../TaskEditForm';

var BASE_TASK = {
  id: 't1', text: 'Test task', pri: 'P3', dur: 30, project: '', notes: '', url: '',
  location: [], tools: [], dependsOn: [], recurring: false, marker: false,
  slackMins: null, createdAt: '2026-01-01T00:00:00Z',
  weatherPrecip: 'any', weatherCloud: 'any',
  weatherTempMin: null, weatherTempMax: null,
  weatherHumidityMin: null, weatherHumidityMax: null,
};

it('renders task title', function() {
  render(<TaskEditForm task={BASE_TASK} status="todo" onUpdate={function() {}} onStatusChange={function() {}}
    onDelete={function() {}} onClose={function() {}} darkMode={false} isMobile={false}
    locations={[]} tools={[]} uniqueTags={[]} allProjectNames={[]}
    scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
  />);
  expect(screen.getByDisplayValue('Test task')).toBeInTheDocument();
});

it('When section is expanded by default', function() {
  localStorage.clear();
  render(<TaskEditForm task={BASE_TASK} status="todo" onUpdate={function() {}} onStatusChange={function() {}}
    onDelete={function() {}} onClose={function() {}} darkMode={false} isMobile={false}
    locations={[]} tools={[]} uniqueTags={[]} allProjectNames={[]}
    scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
  />);
  expect(document.querySelector('input[type="date"]')).toBeInTheDocument();
});

it('clicking When toggle collapses the section', function() {
  localStorage.clear();
  render(<TaskEditForm task={BASE_TASK} status="todo" onUpdate={function() {}} onStatusChange={function() {}}
    onDelete={function() {}} onClose={function() {}} darkMode={false} isMobile={false}
    locations={[]} tools={[]} uniqueTags={[]} allProjectNames={[]}
    scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
  />);
  var whenButton = screen.getByText(/▼ When/);
  fireEvent.click(whenButton);
  expect(screen.queryByText(/▼ When/)).not.toBeInTheDocument();
  expect(screen.getByText(/▶ When/)).toBeInTheDocument();
});

it('save flow: editing title and saving calls onUpdate with changed fields', async function() {
  localStorage.clear();
  var onUpdate = jest.fn().mockResolvedValue(undefined);
  render(<TaskEditForm task={BASE_TASK} status="todo" onUpdate={onUpdate} onStatusChange={function() {}}
    onDelete={function() {}} onClose={function() {}} darkMode={false} isMobile={false}
    locations={[]} tools={[]} uniqueTags={[]} allProjectNames={[]}
    scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
  />);
  var titleInput = screen.getByDisplayValue('Test task');
  fireEvent.change(titleInput, { target: { value: 'Updated task title' } });
  var saveButton = screen.getByText(/Save/);
  await act(async function() {
    fireEvent.click(saveButton);
  });
  expect(onUpdate).toHaveBeenCalledTimes(1);
  expect(onUpdate).toHaveBeenCalledWith('t1', expect.objectContaining({ text: 'Updated task title' }));
});

it('create mode: form initializes with empty defaults when mode=create', function() {
  localStorage.clear();
  var onCreate = jest.fn();
  render(<TaskEditForm task={null} status="todo" onUpdate={function() {}} onStatusChange={function() {}}
    onDelete={function() {}} onClose={function() {}} darkMode={false} isMobile={false}
    locations={[]} tools={[]} uniqueTags={[]} allProjectNames={[]}
    scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
    mode="create" onCreate={onCreate}
  />);
  // Create mode shows a Create button (not a Save button)
  expect(screen.getByText(/✚ Create/)).toBeInTheDocument();
  // The title text input is empty — no prefilled task text
  var textInputs = document.querySelectorAll('input[type="text"]');
  var emptyTitleInput = Array.from(textInputs).find(function(el) { return el.value === ''; });
  expect(emptyTitleInput).toBeTruthy();
  // No task-specific data from a saved task should appear (e.g. no "t1" id value)
  expect(screen.queryByDisplayValue('Test task')).not.toBeInTheDocument();
});

it('recurring task with rolling recur type shows rolling anchor card', function() {
  // Recurrence sub-section (when_recurrence) is collapsed by default.
  // Pre-open it via localStorage so the rolling anchor card renders.
  localStorage.clear();
  localStorage.setItem('juggler_task_detail_collapse', JSON.stringify({
    when: true, when_recurrence: true
  }));
  var rollingTask = Object.assign({}, BASE_TASK, {
    recurring: true,
    recur: { type: 'rolling', every: 7, unit: 'days' },
    nextStart: '2026-05-01',
  });
  render(<TaskEditForm task={rollingTask} status="todo" onUpdate={function() {}} onStatusChange={function() {}}
    onDelete={function() {}} onClose={function() {}} darkMode={false} isMobile={false}
    locations={[]} tools={[]} uniqueTags={[]} allProjectNames={[]}
    scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
  />);
  // Rolling anchor card shows "Last completion" heading and "Completed on" / "Next due" info
  expect(screen.getByText(/Last completion/i)).toBeInTheDocument();
  expect(screen.getByText(/Completed on/i)).toBeInTheDocument();
  expect(screen.getByText(/Next due/i)).toBeInTheDocument();
});

// ── Regression: UI must match the stored `when` for a single-tag time_blocks
// recurring task (juggler when-display-mismatch, 2026-06-20). Previously a
// recurring task with placement_mode='time_blocks' and a single tag (e.g. 'biz')
// was mis-coerced into preferred-time mode (tag-count heuristic), and entering
// time_blocks mode clobbered the stored tag with the 5-block default — so the UI
// showed the 5 non-biz blocks instead of the stored 'biz'. Display now flows from
// the canonical placement_mode; the single stored tag is shown selected.
var TAGS6 = [
  { tag: 'morning', name: 'Morning', icon: 'M', color: '#C8942A' },
  { tag: 'biz', name: 'Biz', icon: 'B', color: '#2E4A7A' },
  { tag: 'lunch', name: 'Lunch', icon: 'L', color: '#2D6A4F' },
  { tag: 'afternoon', name: 'Afternoon', icon: 'A', color: '#C8942A' },
  { tag: 'evening', name: 'Evening', icon: 'E', color: '#7A4A2E' },
  { tag: 'night', name: 'Night', icon: 'N', color: '#333' },
];
var BIZ_TASK = Object.assign({}, BASE_TASK, {
  id: 'tbiz', text: 'Submit Weekly UI Claim', dur: 15,
  recurring: true, recur: { type: 'weekly', days: 'TWRFU', timesPerCycle: 1 },
  when: 'biz', placementMode: 'time_blocks',
});

function renderBiz() {
  localStorage.clear();
  render(<TaskEditForm task={BIZ_TASK} status="todo" onUpdate={function() {}} onStatusChange={function() {}}
    onDelete={function() {}} onClose={function() {}} darkMode={false} isMobile={false}
    locations={[]} tools={[]} uniqueTags={TAGS6} allProjectNames={[]}
    scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
  />);
}

it('single-tag time_blocks recurring task renders the block grid (not preferred-time)', function() {
  renderBiz();
  // Block buttons are shown for every tag → block-grid mode, NOT preferred-time.
  expect(screen.getByText(/Biz/)).toBeInTheDocument();
  expect(screen.getByText(/Morning/)).toBeInTheDocument();
  // Preferred-time control (± Window) must NOT be present — proves no coercion.
  expect(screen.queryByText(/± Window/)).not.toBeInTheDocument();
});

it("shows the stored 'biz' block as the selected one — not the 5-block default", function() {
  renderBiz();
  // Selected blocks carry a '2px solid' border (togStyle on-state). Only Biz is
  // selected; the 5 non-biz blocks are not — i.e. the UI reflects when='biz'.
  function isSelected(label) {
    // Block buttons render as "{icon} {name}" (e.g. "B Biz"), so match the name substring.
    var btn = screen.getByText(new RegExp(label)).closest('button');
    return /2px solid/.test(btn.getAttribute('style') || '');
  }
  expect(isSelected('Biz')).toBe(true);
  expect(isSelected('Morning')).toBe(false);
  expect(isSelected('Lunch')).toBe(false);
});

// ── W3: Legacy edge — task with when='biz' but no placement_mode (pre-migration) ─
// This test asserts the CHANGED (fixed) display behavior for a legacy task that
// pre-dates the placement_mode column (placementMode=null). It FAILS on pre-fix code
// because the old tag-count heuristic coerced a single-tag task into preferred-time
// mode (hasPreferredTime=true → ± Window shown, block grid hidden, Biz not findable).
//
// Post-fix behavior: placementMode=null → effectiveMode defaults to 'anytime'
// (TaskEditForm: `placementMode || 'anytime'`). With effectiveMode='anytime',
// hasPreferredTime=false, so:
//   - The block grid does NOT render (effectiveMode !== 'time_blocks')
//   - The ± Window control does NOT render (hasPreferredTime=false)
//   - The Biz tag button is NOT visible (block buttons only show in time_blocks mode)
//   - The Anytime mode button IS the active selection (togStyle 2px solid)
//
// In other words: a legacy null-placement task is now shown honestly as "anytime"
// mode (the canonical default), not mis-coerced into preferred-time. The stored
// when='biz' tag is preserved in state but the block grid is NOT shown because
// effectiveMode is 'anytime', not 'time_blocks'.
var LEGACY_TASK = Object.assign({}, BASE_TASK, {
  id: 'tlegacy', text: 'Legacy when task',
  recurring: true,
  recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 1 },
  when: 'biz',
  placementMode: null,   // absent / pre-migration stored task
});

it('W3: legacy task (when=biz, placementMode=null) displays as Anytime mode — no ± Window, Anytime button is active', function() {
  localStorage.clear();
  render(<TaskEditForm task={LEGACY_TASK} status="todo" onUpdate={function() {}} onStatusChange={function() {}}
    onDelete={function() {}} onClose={function() {}} darkMode={false} isMobile={false}
    locations={[]} tools={[]} uniqueTags={TAGS6} allProjectNames={[]}
    scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
  />);
  // ± Window is NOT present — effectiveMode='anytime' (hasPreferredTime=false)
  // Pre-fix: this FAILS because old heuristic set hasPreferredTime=true and ± Window rendered.
  expect(screen.queryByText(/± Window/)).not.toBeInTheDocument();
  // Anytime mode button is the active selection (togStyle: 2px solid border)
  // This distinguishes "anytime is active" from "anytime button merely exists".
  var anytimeBtn = screen.getByText(/🔄 Anytime/);
  expect(/2px solid/.test(anytimeBtn.getAttribute('style') || '')).toBe(true);
  // Time blocks button is NOT active (not the selected mode)
  var timeBlocksBtn = screen.getByText(/📅 Time blocks/);
  expect(/2px solid/.test(timeBlocksBtn.getAttribute('style') || '')).toBe(false);
});

// ── W4 Regression: snapshot-sync must preserve hasPreferredTime for a time_window
// recurring task after an external task-prop update (bert fix: snapshotFromTask now
// includes placementMode so the reload-sync useEffect at ~line 333 calls
// setRecurringHasPreferredTime(newSnap.placementMode === 'time_window') → true).
//
// Pre-fix failure path: snapshotFromTask lacked the placementMode key, so newSnap.placementMode
// was undefined → undefined==='time_window' is false → setRecurringHasPreferredTime(false)
// → the ± Window control disappeared on the next external prop update.
//
// How to verify it would have failed before bert's fix:
//   1. Remove `placementMode: t.placementMode || 'anytime'` from snapshotFromTask (~line 296)
//   2. Run this test → RED: "± Window" not in document after rerender
//   3. Restore the line → GREEN
// This was confirmed by a /tmp-backup stash-revert (not git checkout to preserve uncommitted
// work) before adding this test to the suite.
var TIME_WINDOW_TASK = Object.assign({}, BASE_TASK, {
  id: 'ttw', text: 'Time window task v1',
  recurring: true,
  recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 1 },
  placementMode: 'time_window',
  preferredTimeMins: 540,   // 9:00 AM preferred time
  when: '',
});

it('W4: recurring time_window task keeps ± Window visible after external task-prop update (snapshot-placementMode fix)', function() {
  localStorage.clear();
  var result = render(
    <TaskEditForm task={TIME_WINDOW_TASK} status="todo" onUpdate={function() {}} onStatusChange={function() {}}
      onDelete={function() {}} onClose={function() {}} darkMode={false} isMobile={false}
      locations={[]} tools={[]} uniqueTags={TAGS6} allProjectNames={[]}
      scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
    />
  );
  // Confirm initial render: time_window → hasPreferredTime=true → ± Window visible
  expect(screen.getAllByText(/± Window/)[0]).toBeInTheDocument();

  // Simulate an external task-prop update (e.g. background poll returns same task
  // with updated text but same placementMode='time_window'). The snapshot-sync
  // useEffect fires because text changed → newSnap differs from oldSnap.
  var updatedTask = Object.assign({}, TIME_WINDOW_TASK, { text: 'Time window task v2' });
  result.rerender(
    <TaskEditForm task={updatedTask} status="todo" onUpdate={function() {}} onStatusChange={function() {}}
      onDelete={function() {}} onClose={function() {}} darkMode={false} isMobile={false}
      locations={[]} tools={[]} uniqueTags={TAGS6} allProjectNames={[]}
      scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
    />
  );

  // AFTER the sync: placementMode is still 'time_window' → hasPreferredTime must remain true.
  // Pre-fix: snapshotFromTask lacked placementMode → setRecurringHasPreferredTime(false) → FAIL here.
  // Post-fix: snapshotFromTask includes placementMode → setRecurringHasPreferredTime(true) → PASS.
  expect(screen.getAllByText(/± Window/)[0]).toBeInTheDocument();
  // The task title input must reflect the updated prop (confirms the sync effect ran at all)
  expect(screen.getByDisplayValue('Time window task v2')).toBeInTheDocument();
});

// ── 999.1110: editable recurrence anchor — "Next Cycle Starts" (David 2026-07-04) ──
// The anchor (nextStart — the single unified anchor column; rolling_anchor /
// next_occurrence_anchor were dropped, see juggler-anchor-column-cleanup)
// previously had no UI/API path once set — editing 'Recurrence starts' is
// silently a no-op post-first-completion because getAnchor prefers the
// anchor. These tests cover the new control: render, save payload, and
// pattern-snap validation.

function openRecurrenceCollapse() {
  localStorage.clear();
  localStorage.setItem('juggler_task_detail_collapse', JSON.stringify({
    when: true, when_recurrence: true
  }));
}

var WEEKLY_MONDAY_TASK = Object.assign({}, BASE_TASK, {
  id: 'trec', text: 'Weekly report',
  recurring: true,
  recur: { type: 'weekly', days: 'M' },
  nextStart: '2026-07-13', // a Monday
});

function renderAnchorTask(task, onUpdate) {
  render(<TaskEditForm task={task} status="todo" onUpdate={onUpdate || function() {}} onStatusChange={function() {}}
    onDelete={function() {}} onClose={function() {}} darkMode={false} isMobile={false}
    locations={[]} tools={[]} uniqueTags={[]} allProjectNames={[]}
    scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
  />);
}

it('999.1110: "Next Cycle Starts" control renders for an existing recurring task, initialized from the anchor', function() {
  openRecurrenceCollapse();
  renderAnchorTask(WEEKLY_MONDAY_TASK);
  var input = screen.getByLabelText('Next Cycle Starts');
  expect(input).toBeInTheDocument();
  expect(input.value).toBe('2026-07-13');
});

it('999.1110: control is NOT rendered in create mode (no anchor exists before first completion)', function() {
  openRecurrenceCollapse();
  render(<TaskEditForm task={null} status="todo" onUpdate={function() {}} onStatusChange={function() {}}
    onDelete={function() {}} onClose={function() {}} darkMode={false} isMobile={false}
    locations={[]} tools={[]} uniqueTags={[]} allProjectNames={[]}
    scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
    mode="create" onCreate={function() {}}
  />);
  expect(screen.queryByLabelText('Next Cycle Starts')).not.toBeInTheDocument();
});

it('999.1110: saving an edited anchor sends nextStart in the update payload', async function() {
  openRecurrenceCollapse();
  var onUpdate = jest.fn().mockResolvedValue(undefined);
  renderAnchorTask(WEEKLY_MONDAY_TASK, onUpdate);
  var input = screen.getByLabelText('Next Cycle Starts');
  // 2026-07-20 is also a Monday — valid for the pattern, no snap.
  fireEvent.change(input, { target: { value: '2026-07-20' } });
  expect(input.value).toBe('2026-07-20');
  var saveButton = screen.getByText(/Save/);
  await act(async function() {
    fireEvent.click(saveButton);
  });
  expect(onUpdate).toHaveBeenCalledTimes(1);
  expect(onUpdate).toHaveBeenCalledWith('trec', expect.objectContaining({ nextStart: '2026-07-20' }));
});

it('999.1110 VALIDATION: a pattern-invalid date snaps forward to the next date the recur pattern allows, with a notice', function() {
  openRecurrenceCollapse();
  renderAnchorTask(WEEKLY_MONDAY_TASK);
  var input = screen.getByLabelText('Next Cycle Starts');
  // 2026-07-22 is a Wednesday; the pattern is Mondays-only → snap to Mon 2026-07-27.
  fireEvent.change(input, { target: { value: '2026-07-22' } });
  expect(input.value).toBe('2026-07-27');
  expect(screen.getByRole('status').textContent).toMatch(/Adjusted to 2026-07-27/);
});

it('999.1110: rolling recur type accepts ANY date without snapping (no pattern constraint)', function() {
  openRecurrenceCollapse();
  var rollingTask = Object.assign({}, BASE_TASK, {
    id: 'troll', text: 'Water plants',
    recurring: true,
    recur: { type: 'rolling', every: 7, unit: 'days' },
    nextStart: '2026-07-01',
  });
  renderAnchorTask(rollingTask);
  var input = screen.getByLabelText('Next Cycle Starts');
  expect(input.value).toBe('2026-07-01');
  fireEvent.change(input, { target: { value: '2026-07-22' } }); // arbitrary Wednesday
  expect(input.value).toBe('2026-07-22');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

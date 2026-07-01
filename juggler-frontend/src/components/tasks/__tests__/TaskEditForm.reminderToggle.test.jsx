import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

jest.mock('../../../services/apiClient');

import TaskEditForm from '../TaskEditForm';

/**
 * Bug 999.1000 — the ◇ "Reminder" toggle in the task detail card is inert.
 *
 * Root cause: the `marker` boolean column was DROPPED (migration
 * 20260501000300_placement_mode_stored.js / d532577). `placement_mode='reminder'`
 * is now the single source of truth server-side (tasks_v view derives
 * `marker = CASE WHEN placement_mode='reminder'`; scheduler unifiedScheduleV2.js:251
 * keys isMarker off placement_mode===REMINDER). The frontend never migrated:
 * TaskDetailHeader's ◇ button still flips a `marker` boolean
 * (onMarkerChange={setMarker}), TaskEditForm still sends that dead `marker` key
 * in the save payload, and placementMode (separate state) is never touched by
 * the toggle. Backend CreateTask/UpdateTask have zero `marker` handling, so the
 * write is silently ignored and placement_mode never becomes 'reminder'.
 *
 * SEAM CHOICE: render TaskEditForm (not a smaller unit) because the load-bearing
 * behavior spans three pieces of local state (`marker`, `placementMode`) plus the
 * diff-and-save logic in TaskEditFormSave's buildChangedFields/commitSave — the
 * bug is precisely that these three don't talk to each other. Testing any single
 * piece in isolation (e.g. just buildFields) would hand-construct the exact
 * payload the fix must synthesize; testing at the TaskEditForm boundary click→save→onUpdate
 * exercises the REAL production wiring end-to-end: the real button's onClick,
 * the real onMarkerChange/setMarker, the real buildChangedFields diff, and the
 * real onUpdate(id, changed) payload the backend actually receives. This mirrors
 * the pre-existing 'save flow' test in TaskEditForm.integration.test.jsx, which
 * already asserts on the onUpdate payload as the production seam.
 *
 * AC1 (load-bearing, RED pre-fix): toggling the ◇ button ON and saving must
 *   produce a payload whose placementMode is 'reminder'.
 * AC2 (expected already-passing / not-broken-by-FE): a task loaded with
 *   placementMode='reminder' must render the toggle in its ON state. This
 *   exercises only the frontend read-path (`marker = placementMode ===
 *   'reminder'`, TaskEditForm.jsx:213), which the backend already derives
 *   correctly from placement_mode — so this AC documents that the read side
 *   is NOT part of the bug, only the write side.
 *
 *   [zoe BLOCK jug1000, re-review]: after bert's discoverability fix
 *   (UX-REVIEW WARN #2), the toggle's `textContent` is the hardcoded literal
 *   '◇ Reminder' in BOTH marker states — only `title` / background / color /
 *   border discriminate ON vs OFF now (TaskDetailHeader.jsx:186-197). AC2 was
 *   asserting only `textContent`, which stays green even under a fully
 *   broken `marker` derivation (zoe's `var marker = false` mutation) because
 *   the literal never changes. Fixed here to assert `title`, the actual
 *   state-discriminating prop, plus a negative case (AC2b) for a non-reminder
 *   task — this is what turns RED under a broken derivation.
 * AC2b (negative, added re-review): a task loaded WITHOUT
 *   placementMode='reminder' must render the toggle in its OFF-state title.
 *   Paired with AC2, this makes the pin non-vacuous — a derivation that
 *   collapses to a constant (e.g. `marker = false` always, or `marker = true`
 *   always) fails one of the two.
 * AC3 (RED pre-fix): toggling an active reminder OFF and saving must reset
 *   placementMode back to 'anytime' — not merely flip the dead `marker` key.
 */

var BASE_TASK = {
  id: 't1', text: 'Test task', pri: 'P3', dur: 30, project: '', notes: '', url: '',
  location: [], tools: [], dependsOn: [], recurring: false, marker: false,
  placementMode: 'anytime',
  slackMins: null, createdAt: '2026-01-01T00:00:00Z',
  weatherPrecip: 'any', weatherCloud: 'any',
  weatherTempMin: null, weatherTempMax: null,
  weatherHumidityMin: null, weatherHumidityMax: null,
};

function renderForm(task, onUpdate) {
  return render(
    <TaskEditForm task={task} status="todo" onUpdate={onUpdate} onStatusChange={function() {}}
      onDelete={function() {}} onClose={function() {}} darkMode={false} isMobile={false}
      locations={[]} tools={[]} uniqueTags={[]} allProjectNames={[]}
      scheduleTemplates={[]} templateDefaults={{}} tempUnitPref="F"
    />
  );
}

// Locate the ◇ toggle by its `title` attribute (stable regardless of glyph-only
// vs "◇ Reminder" label text, which changes with `marker` state).
function getMarkerToggle() {
  return screen.getByTitle(/reminder/i);
}

// The toggle's `title` is the actual state-discriminating property
// (TaskDetailHeader.jsx:186 — `marker ? ON_TITLE : OFF_TITLE`). textContent is
// the fixed literal '◇ Reminder' in both states post-bert-fix and does NOT
// discriminate — see zoe BLOCK jug1000 re-review note above AC2.
var MARKER_ON_TITLE = 'Reminder event — does not block time';
var MARKER_OFF_TITLE = 'Make this a non-blocking reminder event';

describe('BUG-999.1000 — reminder toggle must drive placement_mode, not dead marker boolean', function() {
  it('AC1 [RED pre-fix]: toggling ◇ ON and saving sends placementMode=\'reminder\' in the update payload', async function() {
    localStorage.clear();
    var onUpdate = jest.fn().mockResolvedValue(undefined);
    renderForm(BASE_TASK, onUpdate);

    // Sanity: toggle starts OFF. Per bird UX-REVIEW jug1000 WARN #2 (discoverability),
    // the "◇ Reminder" text label is always visible in both ON/OFF states — only
    // color/background/border distinguish the states now. This assertion no longer
    // pins the old bare-'◇' OFF text (see BERT-LOG jug1000 iteration 2).
    var toggle = getMarkerToggle();
    expect(toggle.textContent).toBe('◇ Reminder');

    // Drive the REAL production click handler (TaskDetailHeader's onClick={() => onMarkerChange(!marker)})
    fireEvent.click(toggle);

    // Save button appears once the form is dirty; click it to trigger the real
    // save pipeline (handleSave -> buildChangedFields -> commitSave -> onUpdate).
    var saveButton = screen.getByText(/Save/);
    await act(async function() {
      fireEvent.click(saveButton);
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    var payload = onUpdate.mock.calls[0][1];
    // Load-bearing assertion: the payload must carry placement_mode='reminder'.
    // Pre-fix: TaskEditFormSave.buildChangedFields never derives `placementMode`
    // from `marker` — it diffs `placementMode` state directly, which the ◇
    // toggle never touches. So `payload.placementMode` is undefined here
    // (only `payload.marker === true` is present) — RED.
    expect(payload.placementMode).toBe('reminder');
  });

  it("AC2 [documents read-path, backend-derived]: a task loaded with placementMode='reminder' shows the toggle ON (title reflects ON state)", function() {
    localStorage.clear();
    // Mirrors what the backend actually sends: tasks_v derives
    // `marker = CASE WHEN placement_mode='reminder'` (taskMappers.js:329
    // `marker: !!row.marker`), so a reminder task arrives with BOTH fields set.
    var reminderTask = Object.assign({}, BASE_TASK, { marker: true, placementMode: 'reminder' });
    renderForm(reminderTask, function() {});
    var toggle = getMarkerToggle();
    // textContent is the fixed literal in both states (not state-discriminating,
    // kept only as a smoke check that the button renders at all).
    expect(toggle.textContent).toBe('◇ Reminder');
    // State-discriminating assertion: title must be the ON variant. This is
    // what flips RED under a broken `marker` derivation (e.g. `marker = false`
    // always) — see AC2b below for the paired negative case.
    expect(toggle.title).toBe(MARKER_ON_TITLE);
  });

  it("AC2b [negative, added re-review]: a task loaded WITHOUT placementMode='reminder' shows the toggle OFF (title reflects OFF state)", function() {
    localStorage.clear();
    // BASE_TASK carries placementMode: 'anytime' and marker: false — the
    // non-reminder case. Paired with AC2, a derivation collapsed to a
    // constant (always-true or always-false) can only satisfy one of the two.
    renderForm(BASE_TASK, function() {});
    var toggle = getMarkerToggle();
    expect(toggle.textContent).toBe('◇ Reminder');
    expect(toggle.title).toBe(MARKER_OFF_TITLE);
  });

  it("AC3 [RED pre-fix]: toggling an active reminder OFF and saving resets placementMode to 'anytime'", async function() {
    localStorage.clear();
    var onUpdate = jest.fn().mockResolvedValue(undefined);
    var reminderTask = Object.assign({}, BASE_TASK, { marker: true, placementMode: 'reminder' });
    renderForm(reminderTask, onUpdate);

    var toggle = getMarkerToggle();
    expect(toggle.textContent).toBe('◇ Reminder');

    fireEvent.click(toggle); // flips marker -> false via the real onClick handler

    var saveButton = screen.getByText(/Save/);
    await act(async function() {
      fireEvent.click(saveButton);
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    var payload = onUpdate.mock.calls[0][1];
    // Pre-fix: only `payload.marker === false` is sent; placementMode is never
    // touched by the toggle, so `payload.placementMode` stays undefined (it was
    // never diffed, since the `placementMode` state itself never changed) — RED.
    expect(payload.placementMode).toBe('anytime');
  });
});

// src/components/features/__tests__/ImportExportPanel.icsImport.test.jsx
// 999.1544 / ernie-1544-w1 WARN — handleICSImportConfirm (ImportExportPanel.jsx:561-596)
// previously had NO add-feedback path at all: `await addTasks(tasksToAdd)` was called
// with no opts, and since addTasks (post-999.1544 fix) catches its own error internally
// and calls opts.onError instead of rejecting, a failed batch add would silently fall
// straight through to the unconditional "Imported N events..." success toast + the
// setIcsPreview(null) that closes the preview panel — zero feedback of any kind.
//
// bert's fix (ImportExportPanel.jsx:572-579): added a local `addFailed` flag set by
// `opts.onError`, plus `if (addFailed) return;` BEFORE the statusUpdates loop, the
// success toast, and setIcsPreview(null) — reusing this file's own pre-existing
// mutual-exclusivity convention (success XOR error toast; see the early-return-after-
// error-toast shape already at handleICSFileSelect:546-548), NOT the AppLayout.jsx
// fire-and-forget/last-write-wins convention. So — UNLIKE the AppLayout AI-ops test —
// this test asserts the success toast and setIcsPreview(null) do NOT fire on failure
// (the preview panel stays open) as a literal claim, not just an end-state overwrite.
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// Increase timeout for async tests (house convention — see RO frontend
// __tests__ files). Needed so the outer per-test clock (react-scripts/jest
// default 5000ms) doesn't race the waitFor({ timeout: 5000 }) calls below
// under machine load — a per-test timeout equal to the waitFor timeout lets
// Jest kill the test before waitFor's own internal timeout is ever exercised.
jest.setTimeout(30000);

jest.mock('../../../services/apiClient');

import apiClient from '../../../services/apiClient';
import ImportExportPanel from '../ImportExportPanel';

// Minimal valid single-VEVENT .ics — DTSTART/DTEND both timed (not all-day) so
// icsEventsToTasks produces exactly one non-all-day task, matching the shape
// handleICSImportConfirm passes straight through to addTasks.
var VALID_ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:evt-1@test',
  'SUMMARY:Team Sync',
  'DTSTART:20260715T090000',
  'DTEND:20260715T093000',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

function renderPanel(extra) {
  var props = Object.assign({
    onClose: function() {},
    darkMode: false,
    showToast: jest.fn(),
    allTasks: [],
    statuses: {},
    dayPlacements: {},
    isMobile: false,
    addTasks: jest.fn().mockResolvedValue(undefined),
  }, extra || {});
  render(<ImportExportPanel {...props} />);
  return props;
}

async function openIcsPreview() {
  var file = new File([VALID_ICS], 'calendar.ics', { type: 'text/calendar' });
  var input = document.querySelector('input[type="file"][accept=".ics,text/calendar"]');
  await act(async function() {
    fireEvent.change(input, { target: { files: [file] } });
    // FileReader.onload resolves on a microtask/macrotask; flush it.
    await new Promise(function(r) { setTimeout(r, 0); });
  });
  await waitFor(function() {
    expect(screen.getByText(/event.*found/)).toBeInTheDocument();
  }, { timeout: 5000 });
}

async function clickImportConfirm() {
  await act(async function() {
    fireEvent.click(screen.getByText(/Import \d+ Events?/));
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(function() {
  jest.clearAllMocks();
});

it('sanity: choosing a valid .ics file opens the preview with the parsed event', async function() {
  var props = renderPanel();
  await openIcsPreview();
  expect(screen.getByText('Team Sync')).toBeInTheDocument();
  expect(props.addTasks).not.toHaveBeenCalled();
});

it('ernie-1544-w1 fixed: a rejected addTasks (ICS import) shows an error toast and does NOT show the success toast or close the preview', async function() {
  var onErrorCapture;
  var props = renderPanel({
    addTasks: jest.fn(function(tasks, opts) {
      onErrorCapture = opts && opts.onError;
      // addTasks (per useTaskState.js post-999.1544) never rejects — it catches
      // its own error and calls opts.onError, then resolves.
      if (onErrorCapture) onErrorCapture('Could not add tasks — change reverted');
      return Promise.resolve();
    })
  });
  await openIcsPreview();

  await clickImportConfirm();

  expect(props.addTasks).toHaveBeenCalledTimes(1);
  expect(props.addTasks.mock.calls[0][0]).toEqual([
    expect.objectContaining({ text: 'Team Sync' })
  ]);
  expect(typeof props.addTasks.mock.calls[0][1].onError).toBe('function');

  // Error toast fires.
  expect(props.showToast).toHaveBeenCalledWith(
    'Could not add tasks — change reverted', 'error'
  );
  // Success-only side effects must NOT fire on failure:
  // (1) the "Imported N events..." success toast is skipped
  expect(props.showToast).not.toHaveBeenCalledWith(
    expect.stringContaining('Imported'), 'success'
  );
  // (2) setIcsPreview(null) is skipped — the preview panel stays open, so the
  // parsed event and the Import/Discard buttons are still on screen.
  expect(screen.getByText('Team Sync')).toBeInTheDocument();
  expect(screen.getByText(/Import \d+ Events?/)).toBeInTheDocument();
});

it('regression guard: a successful addTasks (ICS import) shows the success toast, closes the preview, and still applies per-event statuses', async function() {
  var props = renderPanel({
    addTasks: jest.fn().mockResolvedValue(undefined)
  });
  await openIcsPreview();

  await clickImportConfirm();

  expect(props.addTasks).toHaveBeenCalledTimes(1);
  await waitFor(function() {
    expect(props.showToast).toHaveBeenCalledWith(
      expect.stringContaining('Imported 1 events from calendar.ics'), 'success'
    );
  }, { timeout: 5000 });
  // Success-only side effect DOES fire: setIcsPreview(null) closes the panel.
  await waitFor(function() {
    expect(screen.queryByText('Team Sync')).not.toBeInTheDocument();
  }, { timeout: 5000 });
  expect(screen.queryByText(/Import \d+ Events?/)).not.toBeInTheDocument();
  // No error toast on the happy path.
  expect(props.showToast).not.toHaveBeenCalledWith(
    expect.any(String), 'error'
  );
});

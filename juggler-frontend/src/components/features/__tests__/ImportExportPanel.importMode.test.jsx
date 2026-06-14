// src/components/features/__tests__/ImportExportPanel.importMode.test.jsx
// Wave 4 / W6 — two-mode data import: mode-picker dialog flow.
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

jest.mock('../../../services/apiClient');

import apiClient from '../../../services/apiClient';
import ImportExportPanel from '../ImportExportPanel';

var VALID_JSON = '{"tasks":[{"id":"t1","text":"x"}]}';

function renderPanel(extra) {
  var props = Object.assign({
    onClose: function() {},
    darkMode: false,
    showToast: jest.fn(),
    allTasks: [],
    statuses: {},
    dayPlacements: {},
    isMobile: false,
    addTasks: jest.fn(),
  }, extra || {});
  render(<ImportExportPanel {...props} />);
  return props;
}

function openModePicker() {
  // Paste valid JSON, then click "Import Data" to open the picker (posts nothing yet).
  var textarea = screen.getByPlaceholderText('Paste JSON here...');
  fireEvent.change(textarea, { target: { value: VALID_JSON } });
  fireEvent.click(screen.getByText('Import Data'));
}

beforeEach(function() {
  apiClient.post.mockReset();
  apiClient.post.mockResolvedValue({ data: { mode: 'merge', counts: {} } });
  // Stop the post-success reload from blowing up jsdom.
  delete window.location;
  window.location = { reload: jest.fn() };
});

it('does not call the API just from clicking Import Data — it opens the picker', function() {
  renderPanel();
  openModePicker();
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(screen.getByText('How should we import?')).toBeInTheDocument();
});

it('rejects invalid JSON before opening the picker', function() {
  var props = renderPanel();
  var textarea = screen.getByPlaceholderText('Paste JSON here...');
  fireEvent.change(textarea, { target: { value: 'not json {' } });
  fireEvent.click(screen.getByText('Import Data'));
  expect(screen.queryByText('How should we import?')).not.toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(props.showToast).toHaveBeenCalledWith(
    expect.stringContaining('invalid JSON'), 'error'
  );
});

it('choosing Merge calls the API with ?mode=merge', async function() {
  apiClient.post.mockResolvedValue({
    data: { mode: 'merge', counts: { tasks: 3, tasksRekeyed: 1, projects: 2 } }
  });
  var props = renderPanel();
  openModePicker();
  await act(async function() {
    fireEvent.click(screen.getByText('Merge — keep my data, add new'));
  });
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.post).toHaveBeenCalledWith(
    '/data/import?mode=merge',
    JSON.parse(VALID_JSON)
  );
  await waitFor(function() {
    expect(props.showToast).toHaveBeenCalledWith(
      expect.stringContaining('3 tasks added'), 'success'
    );
  });
  // Re-keyed count surfaced
  var toastMsg = props.showToast.mock.calls.find(function(c) { return c[1] === 'success'; })[0];
  expect(toastMsg).toContain('1 re-keyed');
});

it('choosing Replace all calls the API with ?mode=replace&confirm=delete_all', async function() {
  apiClient.post.mockResolvedValue({ data: { mode: 'replace', counts: { tasks: 5 } } });
  var props = renderPanel();
  openModePicker();
  await act(async function() {
    fireEvent.click(screen.getByText(/Replace all — delete everything first/));
  });
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.post).toHaveBeenCalledWith(
    '/data/import?mode=replace&confirm=delete_all',
    JSON.parse(VALID_JSON)
  );
  await waitFor(function() {
    expect(props.showToast).toHaveBeenCalledWith(
      expect.stringContaining('Import successful'), 'success'
    );
  });
});

it('Cancel posts nothing and closes the picker', function() {
  renderPanel();
  openModePicker();
  fireEvent.click(screen.getByText('Cancel'));
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(screen.queryByText('How should we import?')).not.toBeInTheDocument();
});

it('Escape cancels the picker without posting', function() {
  renderPanel();
  openModePicker();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(screen.queryByText('How should we import?')).not.toBeInTheDocument();
});

it('Cancel button (safe action) receives initial focus, not the destructive action', function() {
  renderPanel();
  openModePicker();
  expect(document.activeElement).toBe(screen.getByText('Cancel'));
});

// BLOCK-3 focus-return (bert REFER→telly): after Cancel/Esc/overlay-click, focus returns
// to the "Import Data" trigger button — not body or overlay.
it('BLOCK-3: Cancel returns focus to the Import Data trigger button', function() {
  renderPanel();
  openModePicker();
  // picker is open; Cancel button has focus (established above).
  // Now click Cancel and assert focus returned to the trigger button.
  fireEvent.click(screen.getByText('Cancel'));
  // The dialog is gone.
  expect(screen.queryByText('How should we import?')).not.toBeInTheDocument();
  // Focus must have returned to the "Import Data" button (the importTriggerRef target).
  expect(document.activeElement).toBe(screen.getByText('Import Data'));
});

it('BLOCK-3: Esc returns focus to the Import Data trigger button', function() {
  renderPanel();
  openModePicker();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByText('How should we import?')).not.toBeInTheDocument();
  expect(document.activeElement).toBe(screen.getByText('Import Data'));
});

it('BLOCK-3: overlay click returns focus to the Import Data trigger button', function() {
  renderPanel();
  openModePicker();
  // The overlay is the dialog element with role="dialog". Clicking it (not a child)
  // triggers cancelImportMode via the dialog's own onClick handler.
  var dialog = document.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  fireEvent.click(dialog);
  expect(screen.queryByText('How should we import?')).not.toBeInTheDocument();
  expect(document.activeElement).toBe(screen.getByText('Import Data'));
});

// WARN-2 focus-ring (bert REFER→telly): onFocus sets a boxShadow ring on each of the
// three dialog buttons; onBlur clears it. The ring color is theme.accent (#C8942A light).
it('WARN-2: Merge button gains a boxShadow ring on focus, clears it on blur', function() {
  renderPanel();
  openModePicker();
  var mergeBtn = screen.getByText('Merge — keep my data, add new').closest('button');
  // Trigger onFocus — the handler sets boxShadow inline.
  fireEvent.focus(mergeBtn);
  expect(mergeBtn.style.boxShadow).toMatch(/0 0 0 2px/);
  // Trigger onBlur — the handler clears it.
  fireEvent.blur(mergeBtn);
  expect(mergeBtn.style.boxShadow).toBe('none');
});

it('WARN-2: Replace button gains a boxShadow ring on focus, clears it on blur', function() {
  renderPanel();
  openModePicker();
  // The Replace button carries an aria-label; use that to find it precisely.
  var replaceBtn = screen.getByRole('button', { name: /Replace all — delete everything first/i });
  fireEvent.focus(replaceBtn);
  expect(replaceBtn.style.boxShadow).toMatch(/0 0 0 2px/);
  fireEvent.blur(replaceBtn);
  expect(replaceBtn.style.boxShadow).toBe('none');
});

it('WARN-2: Cancel button gains a boxShadow ring on focus, clears it on blur', function() {
  renderPanel();
  openModePicker();
  var cancelBtn = screen.getByText('Cancel');
  fireEvent.focus(cancelBtn);
  expect(cancelBtn.style.boxShadow).toMatch(/0 0 0 2px/);
  fireEvent.blur(cancelBtn);
  expect(cancelBtn.style.boxShadow).toBe('none');
});

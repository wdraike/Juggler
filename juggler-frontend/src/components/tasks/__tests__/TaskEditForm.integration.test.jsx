import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

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
    rolling_anchor: '2026-05-01',
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

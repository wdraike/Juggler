import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

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

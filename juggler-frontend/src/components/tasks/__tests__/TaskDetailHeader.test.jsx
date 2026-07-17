// src/components/tasks/__tests__/TaskDetailHeader.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TaskDetailHeader from '../TaskDetailHeader';
import { formatDateKey } from '../../../scheduler/dateHelpers';

const TH = {
  badgeBg: '#f0f0f0', border: '#ccc', accent: '#4f46e5', text: '#000', textMuted: '#888',
  redBg: '#fee', redText: '#c00', btnBorder: '#ccc', bgCard: '#fff', inputBg: '#fff',
  inputBorder: '#ccc', inputText: '#000', amberBg: '#fff3cd', amberText: '#856404', amberBorder: '#ffc107'
};

const BASE_TASK = { id: 't1', text: 'Buy groceries', pri: 'P3', dur: 30, notes: '', url: '' };

function dateKeyOffsetFromToday(days) {
  var d = new Date();
  d.setDate(d.getDate() + days);
  return formatDateKey(d);
}
const TODAY_KEY = dateKeyOffsetFromToday(0);
const YESTERDAY_KEY = dateKeyOffsetFromToday(-1);

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
  expect(screen.getByDisplayValue('Pick up milk and eggs')).toBeInTheDocument();
});

it('renders project select with current value and all options', () => {
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries" project="Work" pri="P3" dur={30} notes="" url=""
    allProjectNames={['Work', 'Personal', 'Health']}
    onProjectChange={() => {}}
  />);
  const select = screen.getByDisplayValue('Work');
  expect(select).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'No project' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Personal' })).toBeInTheDocument();
});

it('calls onProjectChange when project select changes', () => {
  const onProjectChange = jest.fn();
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries" project="Work" pri="P3" dur={30} notes="" url=""
    allProjectNames={['Work', 'Personal']}
    onProjectChange={onProjectChange}
  />);
  fireEvent.change(screen.getByDisplayValue('Work'), { target: { value: 'Personal' } });
  expect(onProjectChange).toHaveBeenCalledWith('Personal');
});

it('renders project select with no-project selected when project is null — no React warning', () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries" project={null} pri="P3" dur={30} notes="" url=""
    allProjectNames={['Work', 'Personal']}
    onProjectChange={() => {}}
  />);
  const nullValueWarnings = errorSpy.mock.calls.filter(
    call => call.some(arg => typeof arg === 'string' && /value.*prop.*null|null.*value.*prop/i.test(arg))
  );
  expect(screen.getByDisplayValue('No project')).toBeInTheDocument();
  expect(nullValueWarnings).toHaveLength(0);
  errorSpy.mockRestore();
});

// TC-P003: null/undefined project renders without crash
it('TC-P003: renders without crash when project is null', () => {
  expect(() => {
    render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
      onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
      isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
      text="Buy groceries" project={null} pri="P3" dur={30} notes="" url=""
      allProjectNames={['Work']}
      onProjectChange={() => {}}
    />);
  }).not.toThrow();
});

it('TC-P003b: renders without crash when project is undefined', () => {
  expect(() => {
    render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
      onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
      isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
      text="Buy groceries" project={undefined} pri="P3" dur={30} notes="" url=""
      allProjectNames={['Work']}
      onProjectChange={() => {}}
    />);
  }).not.toThrow();
});

// TC-P004: isMobile=true applies BTN_H=36; isMobile=false applies BTN_H=28
it('TC-P004: isMobile=true applies BTN_H=36 to project select height', () => {
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={true}
    text="Buy groceries" project="" pri="P3" dur={30} notes="" url=""
    allProjectNames={[]}
    onProjectChange={() => {}}
  />);
  const select = document.getElementById('task-project-select');
  expect(select).not.toBeNull();
  expect(select.style.height).toBe('36px');
});

it('TC-P004b: isMobile=false applies BTN_H=28 to project select height', () => {
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries" project="" pri="P3" dur={30} notes="" url=""
    allProjectNames={[]}
    onProjectChange={() => {}}
  />);
  const select = document.getElementById('task-project-select');
  expect(select).not.toBeNull();
  expect(select.style.height).toBe('28px');
});

// TC-P005: empty allProjectNames array renders without crash
it('TC-P005: renders without crash when allProjectNames is empty array', () => {
  expect(() => {
    render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
      onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
      isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
      text="Buy groceries" project="" pri="P3" dur={30} notes="" url=""
      allProjectNames={[]}
      onProjectChange={() => {}}
    />);
  }).not.toThrow();
  expect(screen.getByRole('option', { name: 'No project' })).toBeInTheDocument();
});

// TC-P006: missing/undefined onProjectChange doesn't crash on interaction
it('TC-P006: select change does not crash when onProjectChange is undefined', () => {
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries" project="" pri="P3" dur={30} notes="" url=""
    allProjectNames={['Work', 'Personal']}
  />);
  const select = document.getElementById('task-project-select');
  expect(() => {
    fireEvent.change(select, { target: { value: 'Work' } });
  }).not.toThrow();
});

// ZOE-JUG-004: allProjectNames=['Work','Personal','Health'] → options.length === allProjectNames.length + 1
it('ZOE-JUG-004: project select has allProjectNames.length + 1 options (including No project)', () => {
  const projectNames = ['Work', 'Personal', 'Health'];
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries" project="Work" pri="P3" dur={30} notes="" url=""
    allProjectNames={projectNames}
    onProjectChange={() => {}}
  />);
  const select = document.getElementById('task-project-select');
  expect(select).not.toBeNull();
  expect(select.options.length).toBe(projectNames.length + 1);
});

// ZOE-JUG-005: allProjectNames prop omitted entirely — only "No project" option renders
it('ZOE-JUG-005: only No project option renders when allProjectNames is omitted', () => {
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries" project="" pri="P3" dur={30} notes="" url=""
  />);
  const select = document.getElementById('task-project-select');
  expect(select).not.toBeNull();
  expect(select.options.length).toBe(1);
  expect(select.options[0].text).toBe('No project');
});

// ZOE-JUG-008: isCreate=true — project select renders with correct initial value
it('ZOE-JUG-008: isCreate=true renders project select with correct initial value', () => {
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={true} isMobile={false}
    text="Buy groceries" project="Work" pri="P3" dur={30} notes="" url=""
    allProjectNames={['Work', 'Personal']}
    onProjectChange={() => {}}
  />);
  const select = document.getElementById('task-project-select');
  expect(select).not.toBeNull();
  expect(select.value).toBe('Work');
});

// TC-P007: label association — id='task-project-select' paired with htmlFor label
it('TC-P007: project select has id=task-project-select paired with a htmlFor label', () => {
  render(<TaskDetailHeader task={BASE_TASK} status="todo" TH={TH} darkMode={false}
    onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
    isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
    text="Buy groceries" project="" pri="P3" dur={30} notes="" url=""
    allProjectNames={['Work']}
    onProjectChange={() => {}}
  />);
  const select = document.getElementById('task-project-select');
  expect(select).not.toBeNull();
  const label = document.querySelector('label[for="task-project-select"]');
  expect(label).not.toBeNull();
  expect(label).toHaveTextContent('Project');
});

// 999.2031: A manually-created task pushed to Google Calendar (origin='juggler',
// gcalEventId set) must NOT show "Calendar event" in the delete slot — that label
// is for tasks PULLED FROM a provider (origin != 'juggler'). The gcalEventId alone
// is not sufficient provenance; calSyncOrigin distinguishes push vs pull.
describe('TaskDetailHeader — provenance-aware delete slot (999.2031)', () => {
  const INGEST_SETTINGS = { gcal: { mode: 'ingest', frequency: 120 } };

  it('shows 🗑 Delete (not "Calendar event") for a juggler-origin task pushed to gcal', () => {
    render(<TaskDetailHeader
      task={{ ...BASE_TASK, gcalEventId: 'evt_123', calSyncOrigin: 'juggler' }}
      status="todo" TH={TH} darkMode={false}
      onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
      isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
      calSyncSettings={INGEST_SETTINGS}
      text="Fix Slate Wall" project="" pri="P3" dur={90} notes="" url=""
    />);
    expect(screen.getByText(/Delete/)).toBeInTheDocument();
    expect(screen.queryByText('Calendar event')).not.toBeInTheDocument();
  });

  it('shows "Calendar event" for a gcal-origin task in ingest mode', () => {
    render(<TaskDetailHeader
      task={{ ...BASE_TASK, gcalEventId: 'evt_456', calSyncOrigin: 'gcal' }}
      status="todo" TH={TH} darkMode={false}
      onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
      isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
      calSyncSettings={INGEST_SETTINGS}
      text="Synced meeting" project="" pri="P3" dur={30} notes="" url=""
    />);
    expect(screen.getByText('Calendar event')).toBeInTheDocument();
    expect(screen.queryByText(/Delete/)).not.toBeInTheDocument();
  });
});

// SPEC (juggler-recur-lifecycle-redesign) FR-2/AC3 — UI half of the reopen date
// gate, parallel `VALID_TRANSITIONS`-style map inline in TaskDetailHeader (see
// docs/architecture/TASK-STATE-MATRIX.md:78-87, "a parallel map in
// TaskDetailHeader.jsx"). Currently gates ONLY on current status, not the
// instance's own `task.date` — RED until W6 wires the date check in.
describe('TaskDetailHeader — reopen date gate (FR-2/AC3 UI half)', () => {
  it('disables the reopen ("—") status button when task.date is before today', () => {
    render(<TaskDetailHeader task={{ ...BASE_TASK, date: YESTERDAY_KEY }} status="done" TH={TH} darkMode={false}
      onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
      isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
      text="Buy groceries" project="" pri="P3" dur={30} notes="" url=""
    />);
    const reopenBtn = screen.getByTitle('Open — not started');
    expect(reopenBtn).toBeDisabled();
  });

  it('keeps the reopen ("—") status button enabled when task.date is today (same-day carve-out)', () => {
    render(<TaskDetailHeader task={{ ...BASE_TASK, date: TODAY_KEY }} status="done" TH={TH} darkMode={false}
      onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={() => {}}
      isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
      text="Buy groceries" project="" pri="P3" dur={30} notes="" url=""
    />);
    const reopenBtn = screen.getByTitle('Open — not started');
    expect(reopenBtn).not.toBeDisabled();
  });

  it('clicking a disabled past-dated reopen button never calls onStatusChange', () => {
    const onStatusChange = jest.fn();
    render(<TaskDetailHeader task={{ ...BASE_TASK, date: YESTERDAY_KEY }} status="done" TH={TH} darkMode={false}
      onSave={() => {}} onClose={() => {}} onDelete={() => {}} onStatusChange={onStatusChange}
      isDirty={false} saveStatus={null} isCreate={false} isMobile={false}
      text="Buy groceries" project="" pri="P3" dur={30} notes="" url=""
    />);
    const reopenBtn = screen.getByTitle('Open — not started');
    fireEvent.click(reopenBtn);
    expect(onStatusChange).not.toHaveBeenCalled();
  });
});

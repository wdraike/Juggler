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

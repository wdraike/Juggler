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

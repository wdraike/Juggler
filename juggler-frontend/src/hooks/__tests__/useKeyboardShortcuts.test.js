/**
 * useKeyboardShortcuts — contract tests vs HelpModal's advertised shortcuts
 * (999.1234): case-insensitive J/K/S, modifier guard (Cmd+S must not cycle
 * status), '?' opens Help, Escape closes only the expanded panel.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import useKeyboardShortcuts from '../useKeyboardShortcuts';
import { formatDateKey } from '../../scheduler/dateHelpers';

function Harness(props) {
  useKeyboardShortcuts(props);
  return null;
}

function makeProps(overrides) {
  var selectedDate = new Date(2026, 6, 9);
  var tasks = [{ id: 't1', text: 'Task one' }, { id: 't2', text: 'Task two' }];
  var tasksByDate = {};
  tasksByDate[formatDateKey(selectedDate)] = tasks;
  return Object.assign({
    selectedDate: selectedDate,
    tasksByDate: tasksByDate,
    statuses: {},
    allTasks: tasks,
    expandedTask: null,
    expandedInstanceMap: {},
    setExpandedTask: jest.fn(),
    setDayOffset: jest.fn(),
    setShowHelp: jest.fn(),
    onStatusChange: jest.fn(),
    popUndo: jest.fn(),
    showToast: jest.fn(),
    filter: 'all'
  }, overrides);
}

function press(key, opts) {
  fireEvent.keyDown(window, Object.assign({ key: key }, opts));
}

beforeEach(function() { localStorage.clear(); });

test('uppercase J (CapsLock/Shift) still navigates tasks', () => {
  var props = makeProps();
  render(<Harness {...props} />);
  press('J');
  expect(props.setExpandedTask).toHaveBeenCalledWith('t1');
});

test('uppercase S still cycles status on the expanded task', () => {
  var props = makeProps({ expandedTask: 't1' });
  render(<Harness {...props} />);
  press('S');
  expect(props.onStatusChange).toHaveBeenCalledWith('t1', 'done');
});

test('Cmd/Ctrl+S (browser save reflex) does NOT cycle status', () => {
  var props = makeProps({ expandedTask: 't1' });
  render(<Harness {...props} />);
  press('s', { metaKey: true });
  press('s', { ctrlKey: true });
  expect(props.onStatusChange).not.toHaveBeenCalled();
});

test('? opens the help guide', () => {
  var props = makeProps();
  render(<Harness {...props} />);
  press('?', { shiftKey: true });
  expect(props.setShowHelp).toHaveBeenCalledWith(true);
});

test('Escape closes only the expanded panel', () => {
  var props = makeProps({ expandedTask: 't1' });
  render(<Harness {...props} />);
  press('Escape');
  expect(props.setExpandedTask).toHaveBeenCalledWith(null);
});

test('Ctrl+Z undo still fires with CapsLock (uppercase Z)', () => {
  var props = makeProps();
  props.popUndo.mockReturnValue('edit task');
  render(<Harness {...props} />);
  press('Z', { ctrlKey: true });
  expect(props.popUndo).toHaveBeenCalled();
});

test('help-discoverability hint shows once on first visit only', () => {
  var first = makeProps();
  render(<Harness {...first} />);
  expect(first.showToast).toHaveBeenCalledWith('Tip: press ? for keyboard shortcuts and help', 'info');

  var second = makeProps();
  render(<Harness {...second} />);
  expect(second.showToast).not.toHaveBeenCalled();
});

/**
 * useDragDrop hook tests
 */

import { renderHook, act } from '@testing-library/react';
import useDragDrop from '../useDragDrop';

describe('useDragDrop', () => {
  const mockTasks = [
    { id: 'task1', text: 'Task 1', date: '2026-06-15', time: '9:00 AM', pri: 'P1' },
    { id: 'task2', text: 'Task 2', date: '2026-06-15', time: '10:00 AM', pri: 'P2', recurring: true, recur: { type: 'weekly', days: ['M', 'W', 'F'] } }
  ];

  const mockUpdate = jest.fn();
  const mockToast = jest.fn();
  const mockRecurConflict = jest.fn();

  it('handleGridDrop updates task time and date', () => {
    const { result } = renderHook(() =>
      useDragDrop({
        allTasks: mockTasks,
        onUpdate: mockUpdate,
        gridZoom: 60,
        showToast: mockToast
      })
    );

    const mockEvent = {
      preventDefault: jest.fn(),
      dataTransfer: {
        getData: () => 'task1'
      },
      currentTarget: {
        getBoundingClientRect: () => ({ top: 0 })
      },
      clientY: 300 // 5 hours * 60 px/hour = 300px, so 9:00 AM
    };

    act(() => {
      result.current.handleGridDrop(mockEvent, '2026-06-16');
    });

    expect(mockUpdate).toHaveBeenCalledWith('task1', expect.objectContaining({
      time: expect.stringContaining('AM'),
      date: '2026-06-16'
    }));
    expect(mockToast).toHaveBeenCalled();
  });

  it('handleDateDrop updates task date only', () => {
    const { result } = renderHook(() =>
      useDragDrop({
        allTasks: mockTasks,
        onUpdate: mockUpdate,
        showToast: mockToast
      })
    );

    const mockEvent = {
      preventDefault: jest.fn(),
      dataTransfer: {
        getData: () => 'task1'
      }
    };

    act(() => {
      result.current.handleDateDrop(mockEvent, '2026-06-17');
    });

    expect(mockUpdate).toHaveBeenCalledWith('task1', {
      date: '2026-06-17'
    });
  });

  it('handlePriorityDrop updates task priority', () => {
    const { result } = renderHook(() =>
      useDragDrop({
        allTasks: mockTasks,
        onUpdate: mockUpdate,
        showToast: mockToast
      })
    );

    act(() => {
      result.current.handlePriorityDrop('task1', 'P3');
    });

    expect(mockUpdate).toHaveBeenCalledWith('task1', {
      pri: 'P3'
    });
    expect(mockToast).toHaveBeenCalledWith('Priority: P3', 'success');
  });

  it('handleGridDrop calls onRecurDayConflict for conflicting recurrence days', () => {
    const { result } = renderHook(() =>
      useDragDrop({
        allTasks: mockTasks,
        onUpdate: mockUpdate,
        gridZoom: 60,
        showToast: mockToast,
        onRecurDayConflict: mockRecurConflict
      })
    );

    const mockEvent = {
      preventDefault: jest.fn(),
      dataTransfer: {
        getData: () => 'task2' // This is the recurring task
      },
      currentTarget: {
        getBoundingClientRect: () => ({ top: 0 })
      },
      clientY: 300
    };

    // Try to move to Tuesday (not in M/W/F pattern)
    act(() => {
      result.current.handleGridDrop(mockEvent, '2026-06-16'); // Tuesday
    });

    expect(mockRecurConflict).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('handleDateDrop calls onRecurDayConflict for conflicting recurrence days', () => {
    const { result } = renderHook(() =>
      useDragDrop({
        allTasks: mockTasks,
        onUpdate: mockUpdate,
        showToast: mockToast,
        onRecurDayConflict: mockRecurConflict
      })
    );

    const mockEvent = {
      preventDefault: jest.fn(),
      dataTransfer: {
        getData: () => 'task2'
      }
    };

    act(() => {
      result.current.handleDateDrop(mockEvent, '2026-06-16'); // Tuesday
    });

    expect(mockRecurConflict).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not update when taskId is not found', () => {
    const { result } = renderHook(() =>
      useDragDrop({
        allTasks: mockTasks,
        onUpdate: mockUpdate,
        showToast: mockToast
      })
    );

    const mockEvent = {
      preventDefault: jest.fn(),
      dataTransfer: {
        getData: () => 'nonexistent'
      }
    };

    act(() => {
      result.current.handleDateDrop(mockEvent, '2026-06-17');
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not update priority when task already has that priority', () => {
    const { result } = renderHook(() =>
      useDragDrop({
        allTasks: mockTasks,
        onUpdate: mockUpdate,
        showToast: mockToast
      })
    );

    act(() => {
      result.current.handlePriorityDrop('task1', 'P1'); // Already P1
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
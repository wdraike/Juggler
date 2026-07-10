/**
 * DisabledItemsPanel tests (999.1211 — billing/plan-gating UI).
 *
 * Pins:
 *  - loading / empty / grouped-list rendering (recurrings vs tasks, instance counts)
 *  - re-enable happy path (PUT /tasks/:id/re-enable, row removed, onRefreshTasks)
 *  - re-enable limit failure surfaces human copy via showToast (999.1226/999.1233)
 *  - delete flow goes through ConfirmDialog; recurring delete adds ?cascade=recurring
 *  - missing showToast degrades to no-op (no crash)
 *  - close via footer button and overlay click
 */

import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import DisabledItemsPanel from '../DisabledItemsPanel';
import apiClient from '../../../services/apiClient';
import { getTheme } from '../../../theme/colors';

jest.mock('../../../services/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const theme = getTheme(false);

async function flush() {
  await act(async () => {});
}

function renderPanel(props = {}) {
  return render(
    <DisabledItemsPanel
      theme={theme}
      onClose={props.onClose || jest.fn()}
      onRefreshTasks={props.onRefreshTasks}
      showToast={props.showToast}
    />
  );
}

describe('DisabledItemsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a loading indicator while /tasks/disabled is pending', () => {
    apiClient.get.mockReturnValue(new Promise(() => {}));

    renderPanel();

    expect(apiClient.get).toHaveBeenCalledWith('/tasks/disabled');
    expect(screen.getByText(/Loading disabled items/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no disabled items', async () => {
    apiClient.get.mockResolvedValue({ data: { tasks: [] } });

    renderPanel();

    expect(await screen.findByText('No disabled items')).toBeInTheDocument();
    expect(screen.getByText('Disabled Items')).toBeInTheDocument();
  });

  it('groups items into Recurrings and Tasks, counts disabled instances, hides instance rows', async () => {
    const disabledAt = '2026-07-01T12:00:00Z';
    const expectedDate = new Date(disabledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    apiClient.get.mockResolvedValue({
      data: {
        tasks: [
          { id: 'r1', text: 'Water plants', taskType: 'recurring_template' },
          { id: 'i1', text: 'Water plants', taskType: 'recurring_instance', sourceId: 'r1' },
          { id: 'i2', text: 'Water plants', taskType: 'recurring_instance', sourceId: 'r1' },
          { id: 't1', text: 'Fix sink', taskType: 'task', project: 'Home', disabledAt },
        ],
      },
    });

    renderPanel();

    expect(await screen.findByText('Recurrings (1)')).toBeInTheDocument();
    expect(screen.getByText('Tasks (1)')).toBeInTheDocument();
    // The subtitle span renders as " · 2 instances also disabled" (middot
    // separator shares the span), so match by substring not exact text.
    expect(screen.getByText(/2 instances also disabled/)).toBeInTheDocument();
    expect(screen.getByText('Fix sink')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Disabled ' + expectedDate)).toBeInTheDocument();
    // Instances are counted, not rendered as their own rows: one row per group
    expect(screen.getAllByRole('button', { name: 'Re-enable' })).toHaveLength(2);
    // Untitled fallback not shown for titled items
    expect(screen.queryByText('Untitled')).toBeNull();
  });

  it('re-enables an item: PUT /tasks/:id/re-enable, removes the row, refreshes tasks', async () => {
    apiClient.get.mockResolvedValue({
      data: { tasks: [{ id: 't1', text: 'Fix sink', taskType: 'task' }] },
    });
    apiClient.put.mockResolvedValue({ data: {} });
    const onRefreshTasks = jest.fn();

    renderPanel({ onRefreshTasks });
    await screen.findByText('Fix sink');

    fireEvent.click(screen.getByRole('button', { name: 'Re-enable' }));
    await flush();

    expect(apiClient.put).toHaveBeenCalledWith('/tasks/t1/re-enable');
    expect(screen.queryByText('Fix sink')).toBeNull();
    expect(screen.getByText('No disabled items')).toBeInTheDocument();
    expect(onRefreshTasks).toHaveBeenCalledTimes(1);
  });

  it('surfaces ENTITY_LIMIT_REACHED re-enable failures as human copy via showToast', async () => {
    apiClient.get.mockResolvedValue({
      data: { tasks: [{ id: 't1', text: 'Fix sink', taskType: 'task' }] },
    });
    apiClient.put.mockRejectedValue({
      response: { data: { code: 'ENTITY_LIMIT_REACHED', limit_key: 'limits.active_tasks', current_count: 5, limit: 5 } },
    });
    const showToast = jest.fn();

    renderPanel({ showToast });
    await screen.findByText('Fix sink');

    fireEvent.click(screen.getByRole('button', { name: 'Re-enable' }));
    await flush();

    expect(showToast).toHaveBeenCalledWith(
      'Cannot re-enable: you have reached the active task limit for your plan (5/5).',
      'error'
    );
    // Item stays in the list on failure
    expect(screen.getByText('Fix sink')).toBeInTheDocument();
  });

  it('derives a readable label for unknown limit keys (999.1233 fallback)', async () => {
    apiClient.get.mockResolvedValue({
      data: { tasks: [{ id: 't1', text: 'Fix sink', taskType: 'task' }] },
    });
    apiClient.put.mockRejectedValue({
      response: { data: { code: 'ENTITY_LIMIT_REACHED', limit_key: 'limits.magic_widgets', current_count: 3, limit: 3 } },
    });
    const showToast = jest.fn();

    renderPanel({ showToast });
    await screen.findByText('Fix sink');

    fireEvent.click(screen.getByRole('button', { name: 'Re-enable' }));
    await flush();

    expect(showToast).toHaveBeenCalledWith(
      'Cannot re-enable: you have reached the magic widgets limit for your plan (3/3).',
      'error'
    );
  });

  it('does not crash on re-enable failure when showToast is not provided (999.1226 guard)', async () => {
    apiClient.get.mockResolvedValue({
      data: { tasks: [{ id: 't1', text: 'Fix sink', taskType: 'task' }] },
    });
    apiClient.put.mockRejectedValue({ response: { data: { error: 'nope' } } });

    renderPanel(); // no showToast
    await screen.findByText('Fix sink');

    fireEvent.click(screen.getByRole('button', { name: 'Re-enable' }));
    await flush();

    // Still rendered, item retained — failure degraded to a no-op notification
    expect(screen.getByText('Fix sink')).toBeInTheDocument();
  });

  it('deletes a plain task after ConfirmDialog confirmation (no cascade param)', async () => {
    apiClient.get.mockResolvedValue({
      data: { tasks: [{ id: 't1', text: 'Fix sink', taskType: 'task' }] },
    });
    apiClient.delete.mockResolvedValue({ data: {} });
    const onRefreshTasks = jest.fn();

    renderPanel({ onRefreshTasks });
    await screen.findByText('Fix sink');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Permanently delete "Fix sink"\? This cannot be undone\./)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await flush();

    expect(apiClient.delete).toHaveBeenCalledWith('/tasks/t1');
    expect(screen.queryByText('Fix sink')).toBeNull();
    expect(onRefreshTasks).toHaveBeenCalledTimes(1);
  });

  it('deletes a recurring template with ?cascade=recurring', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        tasks: [
          { id: 'r1', text: 'Water plants', taskType: 'recurring_template' },
          { id: 'i1', text: 'Water plants', taskType: 'recurring_instance', sourceId: 'r1' },
        ],
      },
    });
    apiClient.delete.mockResolvedValue({ data: {} });

    renderPanel();
    await screen.findByText('Recurrings (1)');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await flush();

    expect(apiClient.delete).toHaveBeenCalledWith('/tasks/r1?cascade=recurring');
    // Template row and its counted instances both leave local state
    expect(screen.queryByText('Water plants')).toBeNull();
    expect(screen.getByText('No disabled items')).toBeInTheDocument();
  });

  it('cancelling the ConfirmDialog does not delete', async () => {
    apiClient.get.mockResolvedValue({
      data: { tasks: [{ id: 't1', text: 'Fix sink', taskType: 'task' }] },
    });

    renderPanel();
    await screen.findByText('Fix sink');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect(apiClient.delete).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Fix sink')).toBeInTheDocument();
  });

  it('closes via footer Close button, header ×, and overlay click', async () => {
    apiClient.get.mockResolvedValue({ data: { tasks: [] } });
    const onClose = jest.fn();

    const { container } = renderPanel({ onClose });
    await screen.findByText('No disabled items');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close disabled items' }));
    fireEvent.click(container.firstChild); // overlay
    expect(onClose).toHaveBeenCalledTimes(3);

    // Clicking inside the card does NOT close
    onClose.mockClear();
    fireEvent.click(screen.getByText('Disabled Items'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

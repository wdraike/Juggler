/**
 * DependencyView loading gate (999.2122) — the async ELK layout window used to
 * render a silently EMPTY graph. It must show brand skeleton rows while the
 * layout computes, and must NOT stick on the skeleton if layout fails.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

// DependencyView constructs its ELK instance at MODULE level, so the mock
// must hand out one stable instance whose layout impl we re-arm per test
// (CRA resetMocks wipes jest.fn impls before each test — see
// cra-resetmocks-wipes-factory-impls trap).
jest.mock('elkjs/lib/elk.bundled.js', () => {
  const layout = jest.fn();
  const Ctor = jest.fn(() => ({ layout }));
  Ctor.__layout = layout;
  return Ctor;
});

const ELK = require('elkjs/lib/elk.bundled.js');
const DependencyView = require('../DependencyView').default;

const MOCK_TASKS = [
  { id: 'task1', text: 'Design schema', date: '2026-06-15', project: 'backend', pri: 'P1', dependsOn: [] },
  { id: 'task2', text: 'Implement API', date: '2026-06-16', project: 'backend', pri: 'P2', dependsOn: ['task1'] },
];

function renderView() {
  return render(
    <DependencyView allTasks={MOCK_TASKS} statuses={{}} projectFilter={null} filter="all" />
  );
}

// CRA resetMocks wipes factory impls per test — re-arm in beforeEach.
const layoutImpl = ELK.__layout;

test('shows skeleton rows with sr-only status while ELK layout is pending', () => {
  layoutImpl.mockReturnValue(new Promise(() => {}));

  renderView();

  expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThanOrEqual(3);
  expect(screen.getByRole('status')).toHaveTextContent(/laying out dependencies/i);
});

test('does NOT stick on the skeleton when ELK layout rejects, and fails loud', async () => {
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  let reject;
  layoutImpl.mockReturnValue(new Promise((_res, rej) => { reject = rej; }));

  renderView();
  expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThanOrEqual(3);

  await act(async () => { reject(new Error('elk exploded')); });

  await waitFor(() => {
    expect(screen.queryAllByTestId('skeleton-row')).toHaveLength(0);
  });
  expect(errSpy).toHaveBeenCalledWith(
    expect.stringContaining('ELK layout failed'),
    expect.any(Error)
  );
  errSpy.mockRestore();
});

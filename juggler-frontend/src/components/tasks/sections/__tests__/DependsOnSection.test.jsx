import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DependsOnSection from '../DependsOnSection';

const TH = { accent: '#4f46e5', border: '#ccc', btnBorder: '#ccc', textMuted: '#888', bgCard: '#fff', text: '#000' };

it('shows dep count when deps are set', () => {
  render(<DependsOnSection task={{ id: 't1', dependsOn: ['t2', 't3'], recurring: false }}
    onShowChain={() => {}} TH={TH} isMobile={false} />);
  expect(screen.getByText(/2/)).toBeInTheDocument();
});

it('calls onShowChain when chain button clicked', () => {
  const onShowChain = jest.fn();
  render(<DependsOnSection task={{ id: 't1', dependsOn: ['t2'], recurring: false }}
    onShowChain={onShowChain} TH={TH} isMobile={false} />);
  fireEvent.click(screen.getByRole('button', { name: /Dependencies/ }));
  expect(onShowChain).toHaveBeenCalled();
});

it('renders nothing for recurring tasks (no dep chain UI)', () => {
  const { container } = render(<DependsOnSection
    task={{ id: 't1', dependsOn: [], recurring: true }}
    onShowChain={() => {}} TH={TH} isMobile={true} />);
  expect(container.firstChild).toBeNull();
});

it('renders no inline unlink lists when allTasks not provided (back-compat)', () => {
  render(<DependsOnSection task={{ id: 't1', dependsOn: ['t2'], recurring: false }}
    onShowChain={() => {}} TH={TH} isMobile={false} />);
  // Only the chain button exists
  expect(screen.getAllByRole('button')).toHaveLength(1);
});

describe('symmetric dependency break (999.672)', () => {
  const allTasks = [
    { id: 't1', text: 'Build', dependsOn: ['t2'] },         // t1 depends on t2 (upstream)
    { id: 't2', text: 'Design', dependsOn: [] },            // t2 is upstream of t1
    { id: 't3', text: 'Ship', dependsOn: ['t1'] },          // t3 depends on t1 (downstream)
  ];

  it('breaks an upstream dependency by editing THIS task', () => {
    const onUpdate = jest.fn();
    render(<DependsOnSection task={allTasks[0]} allTasks={allTasks} onUpdate={onUpdate}
      onShowChain={() => {}} TH={TH} isMobile={false} />);
    // t1 depends on t2 — unlink the "Design" upstream chip
    fireEvent.click(screen.getByTitle(/Remove dependency on .*Design/i));
    expect(onUpdate).toHaveBeenCalledWith('t1', { dependsOn: [] });
  });

  it('breaks a downstream dependency by editing the OTHER task', () => {
    const onUpdate = jest.fn();
    render(<DependsOnSection task={allTasks[0]} allTasks={allTasks} onUpdate={onUpdate}
      onShowChain={() => {}} TH={TH} isMobile={false} />);
    // t3 depends on t1 — unlink from t1's panel edits t3's dependsOn
    fireEvent.click(screen.getByTitle(/Remove dependency from .*Ship/i));
    expect(onUpdate).toHaveBeenCalledWith('t3', { dependsOn: [] });
  });

  it('lists both upstream and downstream relationships', () => {
    render(<DependsOnSection task={allTasks[0]} allTasks={allTasks} onUpdate={() => {}}
      onShowChain={() => {}} TH={TH} isMobile={false} />);
    expect(screen.getByText(/Design/)).toBeInTheDocument(); // upstream
    expect(screen.getByText(/Ship/)).toBeInTheDocument();   // downstream
  });
});

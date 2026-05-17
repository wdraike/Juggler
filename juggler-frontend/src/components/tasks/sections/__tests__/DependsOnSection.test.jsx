import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DependsOnSection from '../DependsOnSection';

const TH = { accent: '#4f46e5', border: '#ccc', btnBorder: '#ccc', textMuted: '#888', bgCard: '#fff', text: '#000' };

it('shows dep count when deps are set', () => {
  render(<DependsOnSection task={{ id: 't1', dependsOn: ['t2', 't3'], recurring: false }}
    onShowChain={() => {}} TH={TH} isMobile={false} />);
  expect(screen.getByText(/2/)).toBeInTheDocument();
});

it('calls onShowChain when button clicked', () => {
  const onShowChain = jest.fn();
  render(<DependsOnSection task={{ id: 't1', dependsOn: ['t2'], recurring: false }}
    onShowChain={onShowChain} TH={TH} isMobile={false} />);
  fireEvent.click(screen.getByRole('button'));
  expect(onShowChain).toHaveBeenCalled();
});

it('renders nothing for recurring tasks (no dep chain UI)', () => {
  const { container } = render(<DependsOnSection
    task={{ id: 't1', dependsOn: [], recurring: true }}
    onShowChain={() => {}} TH={TH} isMobile={false} />);
  expect(container.firstChild).toBeNull();
});

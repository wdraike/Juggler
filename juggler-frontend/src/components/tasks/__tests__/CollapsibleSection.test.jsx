// src/components/tasks/__tests__/CollapsibleSection.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CollapsibleSection from '../CollapsibleSection';

const TH = { border: '#ccc', accent: '#4f46e5', text: '#000', textMuted: '#888', bgCard: '#fff' };

it('shows children when open', () => {
  render(
    <CollapsibleSection id="when" label="When" isOpen={true} onToggle={() => {}} TH={TH}>
      <span>inner content</span>
    </CollapsibleSection>
  );
  expect(screen.getByText('inner content')).toBeInTheDocument();
});

it('hides children when closed', () => {
  render(
    <CollapsibleSection id="when" label="When" isOpen={false} onToggle={() => {}} TH={TH}>
      <span>inner content</span>
    </CollapsibleSection>
  );
  expect(screen.queryByText('inner content')).not.toBeInTheDocument();
});

it('shows badge when provided', () => {
  render(
    <CollapsibleSection id="when" label="When" isOpen={false} onToggle={() => {}} badge="Today · 2:00 PM" TH={TH}>
      <span>inner</span>
    </CollapsibleSection>
  );
  expect(screen.getByText('Today · 2:00 PM')).toBeInTheDocument();
});

it('calls onToggle with id when header is clicked', () => {
  const toggle = jest.fn();
  render(
    <CollapsibleSection id="where" label="Where" isOpen={false} onToggle={toggle} TH={TH}>
      <span>inner</span>
    </CollapsibleSection>
  );
  fireEvent.click(screen.getByRole('button'));
  expect(toggle).toHaveBeenCalledWith('where');
});

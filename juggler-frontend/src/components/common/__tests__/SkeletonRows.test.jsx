/**
 * SkeletonRows (999.2121) — shared brand skeleton list rows for panel/list
 * loading states, per the "Loading & Busy-State Standard".
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import SkeletonRows from '../SkeletonRows';

describe('SkeletonRows', () => {
  it('renders rows with the correct label', () => {
    const { container } = render(<SkeletonRows rows={3} label="Fetching details…" />);
    const rows = screen.getAllByTestId('skeleton-row');
    expect(rows).toHaveLength(3);
    expect(screen.getByRole('status')).toHaveTextContent('Fetching details…');
  });

  it('is accessible: role=status is a sibling of the aria-busy region, not nested inside it', () => {
    const { container } = render(<SkeletonRows rows={2} />);
    const busyRegion = container.querySelector('[aria-busy="true"]');
    expect(busyRegion).toBeInTheDocument();
    const statusRegion = screen.getByRole('status');
    expect(busyRegion.contains(statusRegion)).toBe(false);
  });
});

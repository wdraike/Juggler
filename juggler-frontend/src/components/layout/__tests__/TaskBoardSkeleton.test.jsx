/**
 * TaskBoardSkeleton (999.2119) — brand Loading & Busy-State Standard skeleton
 * for the task board / calendar grid initial load (replaces the full-page
 * shared spinner gate in AppLayout).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import TaskBoardSkeleton from '../TaskBoardSkeleton';

const theme = { bg: '#0F1520', text: '#F5F0E8', textMuted: '#8b93a3' };

describe('TaskBoardSkeleton', () => {
  it('renders a header strip and a 7-day column grid of blocks', () => {
    render(<TaskBoardSkeleton theme={theme} />);
    expect(screen.getByTestId('board-skeleton-header')).toBeInTheDocument();
    expect(screen.getAllByTestId('board-skeleton-day')).toHaveLength(7);
    expect(screen.getAllByTestId('board-skeleton-block').length).toBeGreaterThanOrEqual(14);
  });

  it('renders a single day column on mobile (matches the mobile board layout)', () => {
    render(<TaskBoardSkeleton theme={theme} isMobile />);
    expect(screen.getAllByTestId('board-skeleton-day')).toHaveLength(1);
  });

  it('is accessible: aria-busy region, and the ONLY loading text is screen-reader-only', () => {
    render(<TaskBoardSkeleton theme={theme} />);
    const region = screen.getByTestId('board-skeleton');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(/loading tasks/i);
    // Every loading-text node is the sr-only status span — nothing visible.
    screen.getAllByText(/loading/i).forEach((el) => {
      expect(el).toHaveStyle({ position: 'absolute' });
    });
  });

  it('disables shimmer under prefers-reduced-motion via its style block', () => {
    const { container } = render(<TaskBoardSkeleton theme={theme} />);
    const styleTag = container.querySelector('style');
    expect(styleTag.textContent).toMatch(/prefers-reduced-motion/);
  });
});

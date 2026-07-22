/**
 * AuthBootstrapScreen (999.2120) — brand-compliant sanctioned full-page
 * auth-bootstrap wait (replaces the bare 'Loading...' text div in App.js).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import AuthBootstrapScreen from '../AuthBootstrapScreen';

describe('AuthBootstrapScreen', () => {
  it('renders an aria-busy region with a polite role=status message', () => {
    const { container } = render(<AuthBootstrapScreen />);
    const busyRegion = screen.getByTestId('auth-bootstrap');
    expect(busyRegion).toHaveAttribute('aria-busy', 'true');
    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toHaveTextContent(/loading/i);
    expect(busyRegion.contains(statusRegion)).toBe(false);
  });

  it('accepts a custom message', () => {
    render(<AuthBootstrapScreen message="Checking session…" />);
    expect(screen.getByRole('status')).toHaveTextContent(/checking session/i);
  });

  it('shows the gold indeterminate bar and disables it under prefers-reduced-motion', () => {
    const { container } = render(<AuthBootstrapScreen />);
    expect(screen.getByTestId('auth-bootstrap-bar')).toBeInTheDocument();
    expect(container.querySelector('style').textContent).toMatch(/prefers-reduced-motion/);
  });
});

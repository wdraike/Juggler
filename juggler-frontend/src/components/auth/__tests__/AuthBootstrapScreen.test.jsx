/**
 * AuthBootstrapScreen (999.2120) — brand-compliant sanctioned full-page
 * auth-bootstrap wait (replaces the bare 'Loading...' text div in App.js).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import AuthBootstrapScreen from '../AuthBootstrapScreen';

describe('AuthBootstrapScreen', () => {
  it('renders an aria-busy region with a polite role=status message', () => {
    render(<AuthBootstrapScreen />);
    expect(screen.getByTestId('auth-bootstrap')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
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

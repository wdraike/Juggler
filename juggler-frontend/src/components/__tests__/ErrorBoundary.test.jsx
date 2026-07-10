/**
 * ErrorBoundary tests (999.1211).
 *
 * Pins: children render untouched when healthy; a throwing child renders the
 * branded fallback (never a white screen); the fallback surfaces the error
 * message; "Reload App" is the only recovery path (full page reload — the
 * boundary has no soft reset); componentDidCatch logs with the
 * '[ErrorBoundary]' prefix.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

function Bomb({ message }) {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    // React logs caught render errors + the boundary logs via componentDidCatch;
    // silence both while keeping them observable.
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">app content</div>
      </ErrorBoundary>
    );

    expect(screen.getByTestId('child')).toHaveTextContent('app content');
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('renders the fallback (not a white screen) when a child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb message="kaboom from render" />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/encountered an unexpected error\. Your data is safe\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload App' })).toBeInTheDocument();
  });

  it('surfaces the thrown error message in the fallback', () => {
    render(
      <ErrorBoundary>
        <Bomb message="kaboom from render" />
      </ErrorBoundary>
    );

    expect(screen.getByText('kaboom from render')).toBeInTheDocument();
  });

  it('falls back to "Unknown error" when the error has no message', () => {
    render(
      <ErrorBoundary>
        <Bomb message="" />
      </ErrorBoundary>
    );

    expect(screen.getByText('Unknown error')).toBeInTheDocument();
  });

  it('logs the caught error with the [ErrorBoundary] prefix', () => {
    render(
      <ErrorBoundary>
        <Bomb message="logged error" />
      </ErrorBoundary>
    );

    const boundaryLog = consoleErrorSpy.mock.calls.find((args) => args[0] === '[ErrorBoundary]');
    expect(boundaryLog).toBeTruthy();
    expect(boundaryLog[1]).toBeInstanceOf(Error);
    expect(boundaryLog[1].message).toBe('logged error');
  });

  it('"Reload App" triggers a full page reload', () => {
    const originalLocation = window.location;
    delete window.location;
    window.location = { ...originalLocation, reload: jest.fn() };

    try {
      render(
        <ErrorBoundary>
          <Bomb message="needs reload" />
        </ErrorBoundary>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Reload App' }));
      expect(window.location.reload).toHaveBeenCalledTimes(1);
    } finally {
      window.location = originalLocation;
    }
  });

  it('stays in the fallback state after re-render with healthy children (no soft reset)', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Bomb message="sticky error" />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    rerender(
      <ErrorBoundary>
        <div data-testid="healthy">recovered content</div>
      </ErrorBoundary>
    );

    // Current behavior: hasError is never cleared — recovery is reload-only.
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.queryByTestId('healthy')).toBeNull();
  });
});

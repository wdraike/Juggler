/**
 * LoginPage sign-in busy state (999.2123) — clicking Sign In must give
 * immediate feedback (in-button spinner + disabled) during the window
 * between click and the Google OAuth redirect; a failed start re-enables.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../AuthProvider', () => ({ useAuth: jest.fn() }));
const { useAuth } = require('../AuthProvider');
const LoginPage = require('../LoginPage').default;

function arm(loginImpl) {
  useAuth.mockReturnValue({ login: loginImpl });
}

test('click → both Sign In buttons disable and show the busy spinner', () => {
  arm(jest.fn(() => new Promise(() => {})));
  render(<LoginPage />);

  const buttons = screen.getAllByRole('button', { name: /sign/i });
  expect(buttons.length).toBeGreaterThanOrEqual(2);
  fireEvent.click(buttons[0]);

  screen.getAllByRole('button', { name: /sign/i }).forEach((b) => {
    expect(b).toBeDisabled();
  });
  expect(screen.getAllByTestId('signin-spinner').length).toBeGreaterThanOrEqual(1);
});

// harrison INFO: after the first click both buttons are disabled, so this is
// pinned by the disabled attribute; the handleLogin signingIn guard is
// defense-in-depth behind it (unreachable via UI once disabled applies).
test('second click while pending is a no-op (login called once)', () => {
  const login = jest.fn(() => new Promise(() => {}));
  arm(login);
  render(<LoginPage />);

  const buttons = screen.getAllByRole('button', { name: /sign/i });
  fireEvent.click(buttons[0]);
  fireEvent.click(buttons[1]);

  expect(login).toHaveBeenCalledTimes(1);
});

test('failed sign-in start re-enables the buttons and shows the error', async () => {
  arm(jest.fn(() => Promise.reject(new Error('no crypto.subtle'))));
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  render(<LoginPage />);

  fireEvent.click(screen.getAllByRole('button', { name: /sign/i })[0]);

  await waitFor(() => {
    expect(screen.getByText(/could not be started/i)).toBeInTheDocument();
  });
  screen.getAllByRole('button', { name: /sign/i }).forEach((b) => {
    expect(b).not.toBeDisabled();
  });
  errSpy.mockRestore();
});

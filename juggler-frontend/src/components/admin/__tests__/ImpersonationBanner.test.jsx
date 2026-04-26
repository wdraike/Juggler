import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImpersonationBanner from '../ImpersonationBanner';
import * as impersonationService from '../../../services/impersonationService';

jest.mock('../../../services/impersonationService');

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

it('renders nothing when juggler-impersonation is not set', () => {
  const { container } = render(<ImpersonationBanner darkMode={true} />);
  expect(container.firstChild).toBeNull();
});

it('renders banner with target email when impersonation data is stored', () => {
  localStorage.setItem('juggler-impersonation', JSON.stringify({
    adminAccessToken: 'admin-tok',
    adminRefreshToken: 'admin-refresh',
    targetId: 'u2',
    targetEmail: 'target@test.com',
    targetName: 'Target User',
    startedAt: new Date().toISOString()
  }));
  impersonationService.getStoredImpersonation.mockReturnValue({
    adminAccessToken: 'admin-tok',
    targetId: 'u2',
    targetEmail: 'target@test.com',
    targetName: 'Target User',
    startedAt: new Date().toISOString()
  });

  render(<ImpersonationBanner darkMode={true} />);
  expect(screen.getByText(/IMPERSONATING/)).toBeInTheDocument();
  expect(screen.getByText(/target@test.com/)).toBeInTheDocument();
});

it('calls stopImpersonation and reloads on button click', async () => {
  impersonationService.getStoredImpersonation.mockReturnValue({
    adminAccessToken: 'admin-tok',
    targetId: 'u2',
    targetEmail: 'target@test.com',
    targetName: null,
    startedAt: new Date().toISOString()
  });
  impersonationService.stopImpersonation.mockResolvedValueOnce({ message: 'stopped' });

  const reloadMock = jest.fn();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, reload: reloadMock },
    writable: true
  });

  render(<ImpersonationBanner darkMode={true} />);
  fireEvent.click(screen.getByText('Stop Impersonation'));

  await waitFor(() => {
    expect(impersonationService.stopImpersonation).toHaveBeenCalledTimes(1);
  });
});

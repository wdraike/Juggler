import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ImpersonationPage from '../ImpersonationPage';
import * as impersonationService from '../../../services/impersonationService';

jest.mock('../../../services/impersonationService');

beforeEach(() => {
  jest.clearAllMocks();
});

it('shows admin access denied when API returns 403 error', async () => {
  impersonationService.getImpersonationTargets.mockRejectedValueOnce(new Error('403 Forbidden'));
  impersonationService.getImpersonationLog.mockResolvedValueOnce({ logs: [], pagination: { total: 0, limit: 20, offset: 0, hasMore: false } });

  render(<ImpersonationPage darkMode={true} />);

  await waitFor(() => {
    expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
  });
});

it('renders user list and log sections', async () => {
  impersonationService.getImpersonationTargets.mockResolvedValueOnce({
    users: [{ id: 'u1', email: 'user@test.com', created_at: '2026-01-01' }],
    pagination: { total: 1, limit: 20, offset: 0, hasMore: false }
  });
  impersonationService.getImpersonationLog.mockResolvedValueOnce({
    logs: [{ id: 1, action: 'start_impersonation', admin_email: 'admin@test.com', target_user_id: 'u1', created_at: new Date().toISOString() }],
    pagination: { total: 1, limit: 20, offset: 0, hasMore: false }
  });

  render(<ImpersonationPage darkMode={true} />);

  await waitFor(() => {
    expect(screen.getByText('user@test.com')).toBeInTheDocument();
  });
  expect(screen.getByText('start_impersonation')).toBeInTheDocument();
});

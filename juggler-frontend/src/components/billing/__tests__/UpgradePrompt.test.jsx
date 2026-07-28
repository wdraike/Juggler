/**
 * UpgradePrompt tests (999.1211 — billing/plan-gating UI).
 *
 * Pins the real gating behavior:
 *  - proactive /my-plan check on mount gates (402) or dismisses (success)
 *  - 'subscription:required' / 'plan:limit-reached' window events open the modal
 *  - subscription gate is NON-dismissible (no "Not Now", overlay click ignored)
 *  - limit gate IS dismissible (overlay click + "Not Now")
 *  - "View Plans" opens the billing frontend /plans page in a new tab
 *  - a successful /my-plan re-check dismisses an already-open gate
 *  - visibilitychange re-runs the subscription check
 *  - a non-402 /my-plan failure (transport/server) shows a BLOCKING error
 *    state with Retry — never a silent null (999.4733)
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import UpgradePrompt from '../UpgradePrompt';
import apiClient from '../../../services/apiClient';

jest.mock('../../../services/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

async function flush() {
  await act(async () => {});
}

describe('UpgradePrompt', () => {
  let openSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    openSpy = jest.spyOn(window, 'open').mockImplementation(() => {});
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('renders nothing when the /my-plan check succeeds', async () => {
    apiClient.get.mockResolvedValue({ data: { plan: 'pro' } });

    const { container } = render(<UpgradePrompt darkMode={false} />);
    await flush();

    expect(apiClient.get).toHaveBeenCalledWith('/my-plan', expect.objectContaining({ timeout: expect.any(Number) }));
    expect(container.firstChild).toBeNull();
  });

  it('shows a non-dismissible subscription gate when /my-plan returns 402', async () => {
    apiClient.get.mockRejectedValue({ response: { status: 402 } });

    const { container } = render(<UpgradePrompt darkMode={false} />);

    expect(await screen.findByText('Subscription Required')).toBeInTheDocument();
    expect(screen.getByText(/You need an active subscription to use StriveRS/)).toBeInTheDocument();

    // No "Not Now" escape hatch for the subscription gate
    expect(screen.queryByText('Not Now')).toBeNull();

    // Overlay click must NOT dismiss a subscription gate
    fireEvent.click(container.firstChild);
    expect(screen.getByText('Subscription Required')).toBeInTheDocument();
  });

  it('shows a BLOCKING error state (not silent null) when /my-plan fails with a non-402 server error (999.4733)', async () => {
    apiClient.get.mockRejectedValue({ response: { status: 500 } });

    const { container } = render(<UpgradePrompt darkMode={false} />);

    expect(await screen.findByText("We can't verify your plan right now")).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
  });

  it('shows the same BLOCKING error state on a network/transport failure (no response object at all)', async () => {
    apiClient.get.mockRejectedValue(new Error('Network Error'));

    render(<UpgradePrompt darkMode={false} />);

    expect(await screen.findByText("We can't verify your plan right now")).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('error gate is non-dismissible (no "Not Now", overlay click ignored)', async () => {
    apiClient.get.mockRejectedValue({ response: { status: 500 } });

    const { container } = render(<UpgradePrompt darkMode={false} />);
    await screen.findByText("We can't verify your plan right now");

    expect(screen.queryByText('Not Now')).toBeNull();
    fireEvent.click(container.firstChild);
    expect(screen.getByText("We can't verify your plan right now")).toBeInTheDocument();
  });

  it('a plan:limit-reached event CANNOT displace the blocking error gate', async () => {
    // Regression (999.4733 review): handleLimit used to overwrite `detail`
    // unconditionally, so a background limit response arriving while the error
    // gate was up swapped it for the DISMISSIBLE limit modal — one "Not Now"
    // click and the app was fully unblocked on a plan we never verified.
    apiClient.get.mockRejectedValue({ response: { status: 500 } });

    render(<UpgradePrompt darkMode={false} />);
    await screen.findByText("We can't verify your plan right now");

    await act(async () => {
      window.dispatchEvent(new CustomEvent('plan:limit-reached', {
        detail: { limit_key: 'projects', limit: 3, used: 3 },
      }));
    });

    // Still the error gate, still no escape hatch.
    expect(screen.getByText("We can't verify your plan right now")).toBeInTheDocument();
    expect(screen.queryByText('Not Now')).toBeNull();
  });

  it('a STALE in-flight check that resolves last cannot clear the error gate', async () => {
    // Regression (999.4733 review): the checks were last-writer-wins, so an
    // older request resolving after a newer failure would clear the gate and
    // unblock the app on out-of-date information.
    let resolveStale;
    apiClient.get
      .mockReturnValueOnce(new Promise((r) => { resolveStale = r; }))  // mount: hangs
      .mockRejectedValueOnce({ response: { status: 500 } });           // visibility: fails

    render(<UpgradePrompt darkMode={false} />);

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await screen.findByText("We can't verify your plan right now");

    // The stale mount check now succeeds — it must NOT win.
    await act(async () => { resolveStale({ data: { plan: 'pro' } }); });

    expect(screen.getByText("We can't verify your plan right now")).toBeInTheDocument();
  });

  it('Retry re-runs the /my-plan check and clears the error state on success', async () => {
    apiClient.get.mockRejectedValueOnce({ response: { status: 500 } });

    render(<UpgradePrompt darkMode={false} />);
    await screen.findByText("We can't verify your plan right now");

    apiClient.get.mockResolvedValueOnce({ data: { plan: 'pro' } });
    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => expect(screen.queryByText("We can't verify your plan right now")).toBeNull());
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('opens the billing /plans page in a new tab from "View Plans"', async () => {
    apiClient.get.mockRejectedValue({ response: { status: 402 } });

    render(<UpgradePrompt darkMode={false} />);
    await screen.findByText('Subscription Required');

    fireEvent.click(screen.getByText('View Plans'));

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('/plans'), '_blank');
  });

  it('shows the subscription gate on a subscription:required event', async () => {
    apiClient.get.mockReturnValue(new Promise(() => {})); // keep mount check pending

    render(<UpgradePrompt darkMode={false} />);
    await flush();

    act(() => {
      window.dispatchEvent(new CustomEvent('subscription:required', { detail: { product: 'juggler' } }));
    });

    expect(screen.getByText('Subscription Required')).toBeInTheDocument();
    expect(screen.queryByText('Not Now')).toBeNull();
  });

  it('maps a known limit key to its human title/description and usage line', async () => {
    apiClient.get.mockReturnValue(new Promise(() => {}));

    render(<UpgradePrompt darkMode={false} />);
    await flush();

    act(() => {
      window.dispatchEvent(new CustomEvent('plan:limit-reached', {
        detail: { limit_key: 'limits.active_tasks', current_count: 25, limit: 25, code: 'ENTITY_LIMIT_REACHED' },
      }));
    });

    expect(screen.getByText('Task Limit Reached')).toBeInTheDocument();
    expect(screen.getByText(/maximum number of active tasks on your plan/)).toBeInTheDocument();
    expect(screen.getByText('Currently using 25 of 25.')).toBeInTheDocument();
    // Limit gate keeps the escape hatch
    expect(screen.getByText('Not Now')).toBeInTheDocument();
  });

  it('shows the reset date for usage limits (resets_at)', async () => {
    apiClient.get.mockReturnValue(new Promise(() => {}));
    const resetsAt = '2026-07-15T12:00:00Z';
    const expected = new Date(resetsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    render(<UpgradePrompt darkMode={false} />);
    await flush();

    act(() => {
      window.dispatchEvent(new CustomEvent('plan:limit-reached', {
        detail: { limit_key: 'ai_commands_per_month', code: 'USAGE_LIMIT_REACHED', resets_at: resetsAt },
      }));
    });

    expect(screen.getByText('AI Commands Used Up')).toBeInTheDocument();
    expect(screen.getByText(new RegExp('Resets ' + expected + '\\.'))).toBeInTheDocument();
  });

  it('falls back to a generic upgrade message for an unknown limit key', async () => {
    apiClient.get.mockReturnValue(new Promise(() => {}));

    render(<UpgradePrompt darkMode={false} />);
    await flush();

    act(() => {
      window.dispatchEvent(new CustomEvent('plan:limit-reached', {
        detail: { limit_key: 'limits.some_unknown_thing' },
      }));
    });

    expect(screen.getByText('Upgrade Your Plan')).toBeInTheDocument();
    expect(screen.getByText('Upgrade to unlock more features and higher limits.')).toBeInTheDocument();
  });

  it('limit gate dismisses via "Not Now"', async () => {
    apiClient.get.mockReturnValue(new Promise(() => {}));

    render(<UpgradePrompt darkMode={false} />);
    await flush();

    act(() => {
      window.dispatchEvent(new CustomEvent('plan:limit-reached', {
        detail: { limit_key: 'limits.projects' },
      }));
    });
    expect(screen.getByText('Project Limit Reached')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Not Now'));
    expect(screen.queryByText('Project Limit Reached')).toBeNull();
  });

  it('limit gate dismisses via overlay click', async () => {
    apiClient.get.mockReturnValue(new Promise(() => {}));

    const { container } = render(<UpgradePrompt darkMode={false} />);
    await flush();

    act(() => {
      window.dispatchEvent(new CustomEvent('plan:limit-reached', {
        detail: { limit_key: 'limits.locations' },
      }));
    });
    expect(screen.getByText('Location Limit Reached')).toBeInTheDocument();

    fireEvent.click(container.firstChild);
    expect(screen.queryByText('Location Limit Reached')).toBeNull();
  });

  it('a successful /my-plan check dismisses an already-open gate', async () => {
    let resolvePlan;
    apiClient.get.mockReturnValue(new Promise((resolve) => { resolvePlan = resolve; }));

    render(<UpgradePrompt darkMode={false} />);
    await flush();

    act(() => {
      window.dispatchEvent(new CustomEvent('plan:limit-reached', {
        detail: { limit_key: 'limits.active_tasks' },
      }));
    });
    expect(screen.getByText('Task Limit Reached')).toBeInTheDocument();

    // The proactive subscription check resolving success dismisses ANY open gate
    await act(async () => { resolvePlan({ data: { plan: 'pro' } }); });
    expect(screen.queryByText('Task Limit Reached')).toBeNull();
  });

  it('re-checks the subscription when the tab becomes visible again', async () => {
    apiClient.get.mockResolvedValue({ data: { plan: 'pro' } });

    render(<UpgradePrompt darkMode={false} />);
    await flush();
    expect(apiClient.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(apiClient.get).toHaveBeenCalledTimes(2);
    expect(apiClient.get).toHaveBeenLastCalledWith('/my-plan', expect.objectContaining({ timeout: expect.any(Number) }));
  });
});

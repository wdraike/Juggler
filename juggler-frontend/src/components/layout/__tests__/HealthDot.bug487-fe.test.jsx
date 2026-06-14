/**
 * BUG-487 (I2) — Regression: HealthDot renders detail values without a type guard.
 *
 * ROOT CAUSE: HealthDot.jsx ~line 193 — renders `{detail || ''}` directly as a React
 * child. When the backend returns `detail.weather = { fetchedAt: '...' }` (an object),
 * React throws "Objects are not valid as a React child".
 *
 * This test is RED on pre-fix code (the component throws on render with a non-string
 * detail value). It becomes GREEN after bert's fix adds a type guard so objects
 * are coerced or omitted before being rendered as React children.
 *
 * Pattern: matches NavigationBar.tc-w001.test.jsx — RTL unit test, no live server.
 * apiClient is mocked so the module-level axios.create + localStorage reads don't run.
 * Uses fireEvent (available in @testing-library/react) — user-event is not installed.
 *
 * RED-CAPABILITY PROOF (W1 fix):
 *   The original `.not.toThrow()` wrapper was tautological — React surfaces child-render
 *   errors via console.error, NOT via a synchronous throw out of `act`. The wrapper
 *   observed nothing and would pass even with the guard reverted.
 *
 *   Fix: each crash-detection test now:
 *     1. Spies on console.error.
 *     2. Renders / interacts.
 *     3. Asserts the spy was NOT called with /Objects are not valid as a React child/.
 *
 *   With the guard at HealthDot.jsx:193 reverted to `{detail || ''}`, React fires
 *   console.error("Objects are not valid as a React child") for the object-valued
 *   weather detail — the spy captures it and the assertion FAILS (RED). With the
 *   guard `{typeof detail === 'string' ? detail : ''}`, no such error is emitted
 *   and the assertion PASSES (GREEN). Proven by the RED→GREEN cycle run documented
 *   in the telly review for leg D re-review 2026-06-14.
 */

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';

// Mock apiClient BEFORE importing HealthDot so the module-level axios.create
// and localStorage.getItem in apiClient.js do not execute in jsdom.
jest.mock('../../../services/apiClient', () => ({
  get: jest.fn()
}));

import HealthDot from '../HealthDot';
import apiClient from '../../../services/apiClient';

// ---------------------------------------------------------------------------
// Helper: build a /health/detailed response where detail.weather is an OBJECT
// (the buggy shape returned by the pre-fix backend).
// ---------------------------------------------------------------------------
function makeOperationalDataWithObjectDetail() {
  return {
    status: 'OK',
    uptime: 120,
    services: {
      server: 'operational',
      database: 'operational',
      scheduler: 'operational',
      sse: 'operational',
      weather: 'operational'
    },
    detail: {
      sse: '0 active',
      // BUG: this is an object, not a string — pre-fix backend shape
      weather: { fetchedAt: '2026-06-14T00:00:00Z' }
    }
  };
}

// ---------------------------------------------------------------------------
// Shared spy setup: capture React console.error calls so we can assert that
// "Objects are not valid as a React child" is NOT emitted. This is the
// mechanism that makes crash-detection tests RED-capable (unlike .not.toThrow()
// which is blind to React child-render errors surfaced via console.error).
// ---------------------------------------------------------------------------
function spyOnConsoleError() {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  return spy;
}

function assertNoReactChildObjectError(spy) {
  const objectChildErrors = spy.mock.calls.filter(
    (args) => typeof args[0] === 'string' && /Objects are not valid as a React child/i.test(args[0])
  );
  expect(objectChildErrors).toHaveLength(0);
  spy.mockRestore();
}

// ---------------------------------------------------------------------------
// BUG-487 (I2): HealthDot must not throw when detail.* contains a non-string value
// ---------------------------------------------------------------------------
describe('BUG-487 (I2): HealthDot — non-string detail value must not crash render', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: apiClient.get resolves immediately so we control when the popover renders.
    apiClient.get.mockResolvedValue({ data: makeOperationalDataWithObjectDetail() });
  });

  test('BUG-487-FE: component renders without React child error when detail.weather is an object', async () => {
    // RED-CAPABLE (W1 fix): spies on console.error and asserts React did NOT emit
    // "Objects are not valid as a React child". With `{detail || ''}` (pre-fix), React
    // fires console.error for the object-valued weather — spy catches it → FAIL.
    // With `{typeof detail === 'string' ? detail : ''}` (post-fix) → no error → PASS.
    const spy = spyOnConsoleError();

    await act(async () => {
      render(<HealthDot darkMode={false} theme={null} />);
    });

    assertNoReactChildObjectError(spy);
  });

  test('BUG-487-FE: health dot button is present in the DOM after first poll resolves', async () => {
    await act(async () => {
      render(<HealthDot darkMode={false} theme={null} />);
    });

    // The button is always rendered (status dot). If this throws, the crash is upstream.
    expect(screen.getByRole('button', { name: /backend health status/i })).toBeInTheDocument();
  });

  test('BUG-487-FE: opening the popover does not cause a React child error when detail.weather is an object', async () => {
    await act(async () => {
      render(<HealthDot darkMode={false} theme={null} />);
    });

    // Wait for the first poll to complete so state.data is populated
    await act(async () => {});

    const dotButton = screen.getByRole('button', { name: /backend health status/i });

    // RED-CAPABLE (W1 fix): clicking opens the popover which renders the service table.
    // With `{detail || ''}` (pre-fix), React emits console.error for the object weather
    // detail → spy catches it → FAIL.
    // With the type guard (post-fix), no error is emitted → PASS.
    const spy = spyOnConsoleError();

    await act(async () => {
      fireEvent.click(dotButton);
    });

    assertNoReactChildObjectError(spy);
  });

  test('BUG-487-FE: weather row detail cell is empty (not "[object Object]") when detail.weather is an object', async () => {
    await act(async () => {
      render(<HealthDot darkMode={false} theme={null} />);
    });

    await act(async () => {});

    const dotButton = screen.getByRole('button', { name: /backend health status/i });
    await act(async () => {
      fireEvent.click(dotButton);
    });

    // W3 fix: positively assert the weather row's detail <td> has empty textContent.
    // "weather" appears as text in the first <td> of its row (via textTransform:capitalize).
    // We locate that cell, walk to its parent <tr>, and assert the third <td> (the detail
    // cell) is empty. This FAILS pre-fix ({detail || ''} renders '[object Object]') and
    // PASSES post-fix ({typeof detail === 'string' ? detail : ''} renders '').
    const weatherNameCell = screen.getByText('weather', { selector: 'td' });
    const weatherRow = weatherNameCell.closest('tr');
    const detailCell = weatherRow.querySelectorAll('td')[2];
    expect(detailCell.textContent).toBe('');
  });

  test('BUG-487-FE: string detail values (e.g. sse) render correctly after fix', async () => {
    await act(async () => {
      render(<HealthDot darkMode={false} theme={null} />);
    });

    await act(async () => {});

    const dotButton = screen.getByRole('button', { name: /backend health status/i });
    await act(async () => {
      fireEvent.click(dotButton);
    });

    // The SSE detail value '0 active' is a valid string — it must appear in the popover.
    expect(screen.getByText('0 active')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Confirming the invariant: every detail value that HealthDot renders must be
// a primitive-safe type — objects must be guarded before reaching React children.
// These are structural/baseline tests: they confirm the component handles
// non-bug inputs cleanly. They are NOT regression guards for BUG-487 (the
// regression guard is the object-detail test above). The console.error spy
// makes them honest: they verify no React child errors are emitted for benign
// inputs, unlike the prior .not.toThrow() which observed nothing.
// ---------------------------------------------------------------------------
describe('BUG-487 (I2): HealthDot — detail value type-guard invariant', () => {

  test('renders without React child error when ALL detail values are strings (baseline — must stay green)', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        status: 'OK',
        uptime: 60,
        services: { weather: 'operational', database: 'operational' },
        detail: { weather: 'fetched 5 min ago', database: 'connected' }
      }
    });

    // Structural baseline: all-string detail values never trigger the bug, so this
    // passes both pre-fix and post-fix. The spy assertion is honest (not tautological)
    // — it verifies no React child error is emitted for the benign input, which is
    // a meaningful quality check regardless of fix state.
    const spy = spyOnConsoleError();

    await act(async () => {
      render(<HealthDot darkMode={false} theme={null} />);
    });

    assertNoReactChildObjectError(spy);
  });

  test('renders without React child error when detail is an empty object (no detail entries)', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        status: 'OK',
        uptime: 60,
        services: { database: 'operational' },
        detail: {}
      }
    });

    // Structural baseline: empty detail means no detail values to render — the cell
    // renders undefined → '' via either the old `{detail || ''}` or the new type guard.
    // Passes both pre-fix and post-fix. Spy assertion is honest.
    const spy = spyOnConsoleError();

    await act(async () => {
      render(<HealthDot darkMode={false} theme={null} />);
    });

    assertNoReactChildObjectError(spy);
  });
});

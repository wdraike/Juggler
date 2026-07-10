/**
 * PreferencesTab tests (999.1211 — settings persistence).
 *
 * Two layers:
 *  1. Unit (fake config): every control change calls its optimistic setter AND
 *     config.updatePreferences with the FULL 8-key snapshot (unchanged fields
 *     carry the current config values — the savePrefs merge contract).
 *     (999.1223: pullForwardDampening dial + key dropped entirely.)
 *  2. Integration (real useConfig + mocked apiClient): a change lands as
 *     PUT /config/preferences { value: {...} }; a rejected save reports through
 *     the onSaveError channel (999.1225 — no silent optimistic-only state).
 *
 * Copy note: control labels/time-option copy are volatile (concurrent
 * formatter work), so controls are located structurally — range bounds
 * (font 80–140, zoom 30–120), option values, input types — which are
 * themselves part of the pinned behavior.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PreferencesTab from '../tabs/PreferencesTab';
import useConfig from '../../../hooks/useConfig';
import apiClient from '../../../services/apiClient';
import { getTheme } from '../../../theme/colors';

jest.mock('../../../services/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), post: jest.fn(), delete: jest.fn(), patch: jest.fn() },
  TZ_OVERRIDE_KEY: 'juggler-tz-override',
  USER_TZ_KEY: 'juggler-user-tz',
}));

const theme = getTheme(false);

// Current-value snapshot the component must echo back for unchanged fields.
const PREF_FIELDS = {
  gridZoom: 60,
  splitDefault: false,
  splitMinDefault: 15,
  schedFloor: 480,
  schedCeiling: 1380,
  fontSize: 100,
  timezoneOverride: null,
  calCompletedBehavior: 'update',
};

function makeConfig(overrides = {}) {
  return {
    ...PREF_FIELDS,
    tempUnitPref: 'F',
    userTimezone: null,
    setFontSize: jest.fn(),
    setGridZoom: jest.fn(),
    setSplitDefault: jest.fn(),
    setSplitMinDefault: jest.fn(),
    setSchedFloor: jest.fn(),
    setSchedCeiling: jest.fn(),
    setTimezoneOverride: jest.fn(),
    setCalCompletedBehavior: jest.fn(),
    updatePreferences: jest.fn(),
    updateTempUnitPref: jest.fn(),
    updateUserTimezone: jest.fn(),
    ...overrides,
  };
}

/** Full expected updatePreferences payload = current snapshot + patch. */
function payload(patch) {
  return { ...PREF_FIELDS, ...patch };
}

// Structural locators — each is pinned behavior, not styling:
const fontSlider = (c) => c.querySelector('input[type="range"][min="80"][max="140"]');
const zoomSlider = (c) => c.querySelector('input[type="range"][min="30"][max="120"]');
const minChunkInput = (c) => c.querySelector('input[type="number"]');
const floorSelect = (c) =>
  Array.from(c.querySelectorAll('select')).find((s) => s.querySelector('option[value="360"]'));
const ceilingSelect = (c) =>
  Array.from(c.querySelectorAll('select')).find((s) => s.querySelector('option[value="1440"]'));
const calBehaviorSelect = (c) =>
  Array.from(c.querySelectorAll('select')).find((s) => s.querySelector('option[value="keep"]'));
const checkboxes = (c) => Array.from(c.querySelectorAll('input[type="checkbox"]'));
const tzInput = () => screen.getByPlaceholderText(/^Browser/);

describe('PreferencesTab (unit — savePrefs contract)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('font size slider: optimistic setter + full persisted snapshot', () => {
    const config = makeConfig();
    const { container } = render(<PreferencesTab config={config} theme={theme} />);

    fireEvent.change(fontSlider(container), { target: { value: '120' } });

    expect(config.setFontSize).toHaveBeenCalledWith(120);
    expect(config.updatePreferences).toHaveBeenCalledTimes(1);
    expect(config.updatePreferences).toHaveBeenCalledWith(payload({ fontSize: 120 }));
  });

  it('grid zoom slider persists as a number within the full snapshot', () => {
    const config = makeConfig();
    const { container } = render(<PreferencesTab config={config} theme={theme} />);

    fireEvent.change(zoomSlider(container), { target: { value: '90' } });

    expect(config.setGridZoom).toHaveBeenCalledWith(90);
    expect(config.updatePreferences).toHaveBeenCalledWith(payload({ gridZoom: 90 }));
  });

  it('split-by-default checkbox persists the toggle (999.1223: the ONLY checkbox — dampening dial removed)', () => {
    const config = makeConfig();
    const { container } = render(<PreferencesTab config={config} theme={theme} />);
    const boxes = checkboxes(container);
    expect(boxes).toHaveLength(1); // pins the dampening dial's removal

    fireEvent.click(boxes[0]);

    expect(config.setSplitDefault).toHaveBeenCalledWith(true);
    expect(config.updatePreferences).toHaveBeenCalledWith(
      payload({ splitDefault: true })
    );
  });

  it('min chunk input persists parsed minutes; empty input falls back to 15', () => {
    const config = makeConfig();
    const { container } = render(<PreferencesTab config={config} theme={theme} />);
    const input = minChunkInput(container);

    fireEvent.change(input, { target: { value: '45' } });
    expect(config.setSplitMinDefault).toHaveBeenCalledWith(45);
    expect(config.updatePreferences).toHaveBeenCalledWith(payload({ splitMinDefault: 45 }));

    // Current behavior: unparseable input coerces to 15 (parseInt(...) || 15).
    fireEvent.change(input, { target: { value: '' } });
    expect(config.setSplitMinDefault).toHaveBeenLastCalledWith(15);
    expect(config.updatePreferences).toHaveBeenLastCalledWith(payload({ splitMinDefault: 15 }));
  });

  it('scheduling floor/ceiling selects persist numeric minutes', () => {
    const config = makeConfig();
    const { container } = render(<PreferencesTab config={config} theme={theme} />);

    fireEvent.change(floorSelect(container), { target: { value: '600' } });
    expect(config.setSchedFloor).toHaveBeenCalledWith(600);
    expect(config.updatePreferences).toHaveBeenLastCalledWith(payload({ schedFloor: 600 }));

    fireEvent.change(ceilingSelect(container), { target: { value: '1200' } });
    expect(config.setSchedCeiling).toHaveBeenCalledWith(1200);
    expect(config.updatePreferences).toHaveBeenLastCalledWith(payload({ schedCeiling: 1200 }));
  });

  it('calendar completed-behavior select persists the choice', () => {
    const config = makeConfig();
    const { container } = render(<PreferencesTab config={config} theme={theme} />);
    const select = calBehaviorSelect(container);
    expect(select.value).toBe('update');

    fireEvent.change(select, { target: { value: 'delete' } });

    expect(config.setCalCompletedBehavior).toHaveBeenCalledWith('delete');
    expect(config.updatePreferences).toHaveBeenCalledWith(payload({ calCompletedBehavior: 'delete' }));
  });

  it('temperature unit goes through updateTempUnitPref, NOT the preferences payload', () => {
    const config = makeConfig();
    render(<PreferencesTab config={config} theme={theme} />);

    fireEvent.click(screen.getByRole('button', { name: '°C' }));

    expect(config.updateTempUnitPref).toHaveBeenCalledWith('C');
    expect(config.updatePreferences).not.toHaveBeenCalled();
  });

  it('valid timezone entry (spaces tolerated) sets override, persists it, and mirrors to localStorage', () => {
    const config = makeConfig();
    render(<PreferencesTab config={config} theme={theme} />);

    fireEvent.change(tzInput(), { target: { value: 'America/New York' } });

    expect(config.setTimezoneOverride).toHaveBeenCalledWith('America/New_York');
    expect(config.updatePreferences).toHaveBeenCalledWith(payload({ timezoneOverride: 'America/New_York' }));
    expect(localStorage.getItem('juggler-tz-override')).toBe('America/New_York');
  });

  it('clearing the timezone input removes the override and the localStorage mirror', () => {
    localStorage.setItem('juggler-tz-override', 'Europe/London');
    const config = makeConfig({ timezoneOverride: 'Europe/London' });
    render(<PreferencesTab config={config} theme={theme} />);

    expect(tzInput().value).toBe('Europe/London');
    expect(screen.getByText('Manual override active.')).toBeInTheDocument();

    fireEvent.change(tzInput(), { target: { value: '' } });

    expect(config.setTimezoneOverride).toHaveBeenCalledWith(null);
    expect(config.updatePreferences).toHaveBeenCalledWith(payload({ timezoneOverride: null }));
    expect(localStorage.getItem('juggler-tz-override')).toBeNull();
  });

  it('an unrecognized timezone string neither sets nor persists anything', () => {
    const config = makeConfig();
    render(<PreferencesTab config={config} theme={theme} />);

    fireEvent.change(tzInput(), { target: { value: 'Not/A Zone' } });

    expect(config.setTimezoneOverride).not.toHaveBeenCalled();
    expect(config.updatePreferences).not.toHaveBeenCalled();
    expect(localStorage.getItem('juggler-tz-override')).toBeNull();
  });
});

// 999.1447 — the "Configured timezone" field (users.timezone writer), distinct
// from the "Timezone" override field above (display-only, user_config).
describe('PreferencesTab (unit — configured timezone / 999.1447)', () => {
  const configuredTzInput = (c) => c.querySelectorAll('input[list="tz-list"]')[0];

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('shows the current configured timezone and a valid correction saves via updateUserTimezone', () => {
    const config = makeConfig({ userTimezone: 'America/New_York' });
    const { container } = render(<PreferencesTab config={config} theme={theme} />);

    const input = configuredTzInput(container);
    expect(input.value).toBe('America/New_York'.replace(/_/g, ' '));
    expect(screen.getByText('Currently: America/New_York.')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Europe/Berlin' } });
    fireEvent.blur(input);

    expect(config.updateUserTimezone).toHaveBeenCalledWith('Europe/Berlin');
  });

  it('an invalid configured-timezone entry shows an error and does not call updateUserTimezone', () => {
    const config = makeConfig({ userTimezone: 'America/New_York' });
    const { container } = render(<PreferencesTab config={config} theme={theme} />);

    const input = configuredTzInput(container);
    fireEvent.change(input, { target: { value: 'Not/A Zone' } });
    fireEvent.blur(input);

    expect(config.updateUserTimezone).not.toHaveBeenCalled();
    expect(screen.getByText('Not a recognized timezone.')).toBeInTheDocument();
  });

  it('unset configured timezone shows "Not yet set."', () => {
    const config = makeConfig({ userTimezone: null });
    render(<PreferencesTab config={config} theme={theme} />);

    expect(screen.getByText('Not yet set.')).toBeInTheDocument();
  });
});

describe('PreferencesTab (integration — real useConfig → apiClient)', () => {
  function Harness({ onSaveError }) {
    const config = useConfig(onSaveError);
    return <PreferencesTab config={config} theme={theme} />;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('a font-size change lands as PUT /config/preferences with the full default snapshot', async () => {
    apiClient.put.mockResolvedValue({ data: { ok: true } });

    const { container } = render(<Harness />);
    fireEvent.change(fontSlider(container), { target: { value: '110' } });
    await act(async () => {});

    expect(apiClient.put).toHaveBeenCalledTimes(1);
    expect(apiClient.put).toHaveBeenCalledWith('/config/preferences', {
      value: {
        gridZoom: 60,
        splitDefault: false,
        splitMinDefault: 15,
        schedFloor: 480,
        schedCeiling: 1380,
        fontSize: 110,
        timezoneOverride: null,
        calCompletedBehavior: 'update',
      },
    });
  });

  it('a rejected save reports through onSaveError (999.1225 — never silent)', async () => {
    apiClient.put.mockRejectedValue(new Error('network down'));
    const onSaveError = jest.fn();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { container } = render(<Harness onSaveError={onSaveError} />);
      fireEvent.change(zoomSlider(container), { target: { value: '80' } });
      await act(async () => {});

      expect(onSaveError).toHaveBeenCalledTimes(1);
      expect(onSaveError).toHaveBeenCalledWith(
        'Failed to save preferences — your change was not persisted',
        expect.any(Error)
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('a rejected save surfaces the server-provided error message when present', async () => {
    apiClient.put.mockRejectedValue({ response: { data: { error: 'quota exceeded' } } });
    const onSaveError = jest.fn();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { container } = render(<Harness onSaveError={onSaveError} />);
      fireEvent.change(calBehaviorSelect(container), { target: { value: 'keep' } });
      await act(async () => {});

      expect(onSaveError).toHaveBeenCalledWith('quota exceeded', expect.anything());
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('999.1447: correcting the configured timezone lands as PATCH /config/timezone, not PUT /config/:key', async () => {
    apiClient.patch.mockResolvedValue({ data: { timezone: 'Europe/Berlin' } });

    const { container } = render(<Harness />);
    const input = container.querySelectorAll('input[list="tz-list"]')[0];
    fireEvent.change(input, { target: { value: 'Europe/Berlin' } });
    fireEvent.blur(input);
    await act(async () => {});

    expect(apiClient.patch).toHaveBeenCalledWith('/config/timezone', { timezone: 'Europe/Berlin' });
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  it('999.1447: a rejected timezone save rolls the input back to the pre-edit value (not the rejected one)', async () => {
    apiClient.patch.mockRejectedValue(new Error('network down'));
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { container } = render(<Harness />);
      const input = container.querySelectorAll('input[list="tz-list"]')[0];
      expect(input.value).toBe(''); // starts unset

      fireEvent.change(input, { target: { value: 'Europe/Berlin' } });
      fireEvent.blur(input);
      await act(async () => {});

      // The remounted (key={config.userTimezone}) input reflects the rolled-back
      // state, not the rejected in-progress edit — the uncontrolled-input/state
      // desync ernie flagged.
      const inputAfter = container.querySelectorAll('input[list="tz-list"]')[0];
      expect(inputAfter.value).toBe('');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

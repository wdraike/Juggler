/**
 * UnifiedTemplateTab tests (999.2145 — Templates tab destroys templates fix).
 *
 * Root cause pinned here: the OLD implementation read the derived-legacy
 * `locSchedules` shape (useConfig.js deriveLocSchedules), which has no
 * `blocks` key — so `currentTemplate.blocks || []` was always empty (looked
 * "deleted"), and every paint rewrote blocks as a `tag:'custom'/name:'Custom'`
 * lump, wiped locOverrides, and saved through the LEGACY `updateLocSchedules`
 * writer — which `initFromConfig` discards in favor of canonical
 * `scheduleTemplates` on the next load, so edits silently vanished.
 *
 * This suite pins the fix: canonical read (scheduleTemplates/templateDefaults),
 * paint preserves block identity via config.updateScheduleTemplates ONLY
 * (never updateLocSchedules — not even present on the fake config double),
 * full template CRUD, delete reassigning day/override refs to 'weekday', and
 * the reset-to-defaults flow applying the server response into state.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import UnifiedTemplateTab from '../tabs/UnifiedTemplateTab';
import { getTheme } from '../../../theme/colors';

jest.mock('../../../services/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), post: jest.fn(), delete: jest.fn(), patch: jest.fn() },
  TZ_OVERRIDE_KEY: 'juggler-tz-override',
  USER_TZ_KEY: 'juggler-user-tz',
}));

import apiClient from '../../../services/apiClient';

const theme = getTheme(false);

const LOCATIONS = [
  { id: 'home', name: 'Home', icon: '🏠' },
  { id: 'work', name: 'Work', icon: '🏢' },
  { id: 'gym', name: 'Gym', icon: '🏋️' },
];

const WEEKDAY_BLOCKS = [
  { id: 'b1', tag: 'morning', name: 'Morning', start: 360, end: 480, color: '#111111', icon: '☀️', loc: 'home' },
  { id: 'b2', tag: 'biz', name: 'Biz', start: 480, end: 720, color: '#222222', icon: '💼', loc: 'work' },
];

function baseTemplates() {
  return {
    weekday: { name: 'Weekday', icon: '🏢', system: true, blocks: WEEKDAY_BLOCKS, locOverrides: {} },
    weekend: {
      name: 'Weekend', icon: '🏠', system: true,
      blocks: [{ id: 'w1', tag: 'morning', name: 'Morning', start: 420, end: 720, color: '#333333', icon: '☀️', loc: 'home' }],
      locOverrides: {},
    },
  };
}

function baseDefaults() {
  return { Mon: 'weekday', Tue: 'weekday', Wed: 'weekday', Thu: 'weekday', Fri: 'weekday', Sat: 'weekend', Sun: 'weekend' };
}

function makeConfig(overrides) {
  return Object.assign({
    locations: LOCATIONS,
    scheduleTemplates: baseTemplates(),
    templateDefaults: baseDefaults(),
    templateOverrides: {},
    updateScheduleTemplates: jest.fn(),
    updateTemplateDefaults: jest.fn(),
    updateTemplateOverrides: jest.fn(),
    setScheduleTemplates: jest.fn(),
    setTemplateDefaults: jest.fn(),
    setTemplateOverrides: jest.fn(),
    applyScheduleTemplatesResponse: jest.fn(),
  }, overrides);
}

/** Fix the schedule bar's layout so clientX maps 1:1 onto (minute - startMin). */
function mockBarRect(startMin, endMin) {
  var totalMin = endMin - startMin;
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, right: totalMin, width: totalMin, top: 0, bottom: 40, height: 40, x: 0, y: 0, toJSON: function () {},
  });
}

describe('UnifiedTemplateTab', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('canonical read (999.2145 root cause)', () => {
    it('renders template blocks from canonical scheduleTemplates, ignoring a stale/empty legacy locSchedules prop', () => {
      const config = makeConfig({
        // The exact pre-fix shape: legacy locSchedules with no `blocks` key at
        // all. If the component ever reads this instead, the bar is empty.
        locSchedules: { weekday: { name: 'Weekday', icon: '🏢', system: true, hours: {} } },
      });
      const { container } = render(<UnifiedTemplateTab config={config} theme={theme} showToast={jest.fn()} />);

      expect(screen.getByText('Uses template:')).toBeInTheDocument();
      expect(container.querySelectorAll('[data-testid="template-block"]').length).toBe(2);
    });

    it('a genuinely empty scheduleTemplates.blocks renders zero blocks — never a fabricated Custom block', () => {
      const config = makeConfig({
        scheduleTemplates: Object.assign(baseTemplates(), {
          weekday: { name: 'Weekday', icon: '🏢', system: true, blocks: [], locOverrides: {} },
        }),
      });
      const { container } = render(<UnifiedTemplateTab config={config} theme={theme} showToast={jest.fn()} />);
      expect(container.querySelectorAll('[data-testid="template-block"]').length).toBe(0);
      expect(screen.queryByText(/Custom/)).toBeNull();
    });
  });

  describe('painting preserves block structure', () => {
    it('painting a single slot updates locOverrides only — blocks (ids/tags/names/icons) pass through untouched, template never renamed to Custom, write goes through updateScheduleTemplates', () => {
      const config = makeConfig();
      const { container } = render(<UnifiedTemplateTab config={config} theme={theme} showToast={jest.fn()} />);

      // weekday range: earliest 360 -> floor((360-60)/60)*60=300; latest 720 -> ceil((720+60)/60)*60=780
      mockBarRect(300, 780);

      fireEvent.click(screen.getByRole('button', { name: /Gym/ }));
      const bar = container.querySelector('[data-testid="schedule-template-bar"]');
      fireEvent.mouseDown(bar, { button: 0, clientX: 195 }); // -> minute 495 (300+195), inside the Biz block (loc: work)
      fireEvent.mouseUp(document);

      expect(config.updateScheduleTemplates).toHaveBeenCalledTimes(1);
      const [nextTemplates, nextDefaults, nextOverrides] = config.updateScheduleTemplates.mock.calls[0];

      expect(nextTemplates.weekday.blocks).toBe(WEEKDAY_BLOCKS); // same reference — never rebuilt/renamed
      expect(nextTemplates.weekday.name).toBe('Weekday'); // never renamed to 'Custom'
      expect(nextTemplates.weekday.blocks[0].tag).toBe('morning');
      expect(nextTemplates.weekday.blocks[1].tag).toBe('biz');
      expect(nextTemplates.weekday.locOverrides).toEqual({ 495: 'gym' });
      expect(nextDefaults).toBe(config.templateDefaults);
      expect(nextOverrides).toBe(config.templateOverrides);
      expect(config.updateTemplateDefaults).not.toHaveBeenCalled();
    });

    it('painting back to a block\'s own base location clears any prior override at that slot', () => {
      const config = makeConfig({
        scheduleTemplates: Object.assign(baseTemplates(), {
          weekday: { name: 'Weekday', icon: '🏢', system: true, blocks: WEEKDAY_BLOCKS, locOverrides: { 495: 'gym' } },
        }),
      });
      const { container } = render(<UnifiedTemplateTab config={config} theme={theme} showToast={jest.fn()} />);
      mockBarRect(300, 780);

      fireEvent.click(screen.getByRole('button', { name: /Work/ }));
      const bar = container.querySelector('[data-testid="schedule-template-bar"]');
      fireEvent.mouseDown(bar, { button: 0, clientX: 195 }); // minute 495, painting back to 'work' (its base loc)
      fireEvent.mouseUp(document);

      const [nextTemplates] = config.updateScheduleTemplates.mock.calls[0];
      expect(nextTemplates.weekday.locOverrides).toEqual({});
    });
  });

  describe('assign template to day', () => {
    it('changing the day-assignment select persists via updateTemplateDefaults with the day patched, others unchanged', () => {
      const config = makeConfig();
      render(<UnifiedTemplateTab config={config} theme={theme} showToast={jest.fn()} />);

      const select = screen.getByLabelText('Template for Mon');
      expect(select.value).toBe('weekday');

      fireEvent.change(select, { target: { value: 'weekend' } });

      expect(config.updateTemplateDefaults).toHaveBeenCalledTimes(1);
      expect(config.updateTemplateDefaults).toHaveBeenCalledWith(
        Object.assign({}, baseDefaults(), { Mon: 'weekend' })
      );
      expect(config.updateScheduleTemplates).not.toHaveBeenCalled();
    });
  });

  describe('template CRUD', () => {
    it('system templates (Weekday/Weekend) offer rename but never a delete button', () => {
      const config = makeConfig();
      render(<UnifiedTemplateTab config={config} theme={theme} showToast={jest.fn()} />);

      expect(screen.getByRole('button', { name: 'Rename template Weekday' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Rename template Weekend' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete template Weekday' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Delete template Weekend' })).toBeNull();
    });

    it('renaming a system template persists the new name, blocks/system untouched', () => {
      const config = makeConfig();
      render(<UnifiedTemplateTab config={config} theme={theme} showToast={jest.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Rename template Weekday' }));
      const input = screen.getByLabelText('Rename template Weekday');
      fireEvent.change(input, { target: { value: 'Work Days' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(config.updateScheduleTemplates).toHaveBeenCalledTimes(1);
      const [nextTemplates] = config.updateScheduleTemplates.mock.calls[0];
      expect(nextTemplates.weekday.name).toBe('Work Days');
      expect(nextTemplates.weekday.system).toBe(true);
      expect(nextTemplates.weekday.blocks).toBe(WEEKDAY_BLOCKS);
    });

    it('duplicating a template creates a new non-system entry with deep-copied blocks/locOverrides', () => {
      const config = makeConfig();
      render(<UnifiedTemplateTab config={config} theme={theme} showToast={jest.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Duplicate template Weekday' }));

      expect(config.updateScheduleTemplates).toHaveBeenCalledTimes(1);
      const [nextTemplates] = config.updateScheduleTemplates.mock.calls[0];
      const dup = nextTemplates.weekday_copy;
      expect(dup).toBeDefined();
      expect(dup.name).toBe('Weekday copy');
      expect(dup.system).toBe(false);
      expect(dup.blocks).toEqual(WEEKDAY_BLOCKS);
      expect(dup.blocks).not.toBe(WEEKDAY_BLOCKS);
      expect(dup.blocks[0]).not.toBe(WEEKDAY_BLOCKS[0]);
    });

    it('creating a new template copies weekday\'s blocks under the user-entered name', () => {
      const config = makeConfig();
      render(<UnifiedTemplateTab config={config} theme={theme} showToast={jest.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'New template' }));
      fireEvent.change(screen.getByLabelText('New template name'), { target: { value: 'Focus Days' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));

      expect(config.updateScheduleTemplates).toHaveBeenCalledTimes(1);
      const [nextTemplates] = config.updateScheduleTemplates.mock.calls[0];
      const created = nextTemplates.focus_days;
      expect(created).toBeDefined();
      expect(created.name).toBe('Focus Days');
      expect(created.system).toBe(false);
      expect(created.blocks).toEqual(WEEKDAY_BLOCKS);
      expect(created.blocks).not.toBe(WEEKDAY_BLOCKS);
    });

    it('delete reassigns days AND date-overrides pointing at the deleted template to weekday, behind a confirm dialog', () => {
      const templates = Object.assign(baseTemplates(), {
        custom1: { name: 'Custom One', icon: '📅', system: false, blocks: [], locOverrides: {} },
      });
      const defaults = Object.assign(baseDefaults(), { Tue: 'custom1' });
      const overridesIn = { '2026-08-01': 'custom1', '2026-09-01': 'weekend' };
      const config = makeConfig({ scheduleTemplates: templates, templateDefaults: defaults, templateOverrides: overridesIn });
      render(<UnifiedTemplateTab config={config} theme={theme} showToast={jest.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Delete template Custom One' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(config.updateScheduleTemplates).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      expect(config.updateScheduleTemplates).toHaveBeenCalledTimes(1);
      const [nextTemplates, nextDefaults, nextOverrides] = config.updateScheduleTemplates.mock.calls[0];
      expect(nextTemplates.custom1).toBeUndefined();

      expect(config.updateTemplateDefaults).toHaveBeenCalledTimes(1);
      expect(nextDefaults).toEqual(Object.assign({}, defaults, { Tue: 'weekday' }));
      expect(config.updateTemplateDefaults).toHaveBeenCalledWith(nextDefaults);

      expect(config.updateTemplateOverrides).toHaveBeenCalledTimes(1);
      expect(nextOverrides).toEqual({ '2026-08-01': 'weekday', '2026-09-01': 'weekend' });
      expect(config.updateTemplateOverrides).toHaveBeenCalledWith(nextOverrides);

      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('delete does not call updateTemplateOverrides when no override referenced the deleted template', () => {
      const templates = Object.assign(baseTemplates(), {
        custom1: { name: 'Custom One', icon: '📅', system: false, blocks: [], locOverrides: {} },
      });
      const config = makeConfig({ scheduleTemplates: templates });
      render(<UnifiedTemplateTab config={config} theme={theme} showToast={jest.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Delete template Custom One' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      expect(config.updateTemplateOverrides).not.toHaveBeenCalled();
    });

    it('cancelling the delete confirm dialog persists nothing', () => {
      const templates = Object.assign(baseTemplates(), {
        custom1: { name: 'Custom One', icon: '📅', system: false, blocks: [], locOverrides: {} },
      });
      const config = makeConfig({ scheduleTemplates: templates });
      render(<UnifiedTemplateTab config={config} theme={theme} showToast={jest.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Delete template Custom One' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(config.updateScheduleTemplates).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Delete template Custom One' })).toBeInTheDocument();
    });
  });

  describe('reset to defaults', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('confirms, POSTs /config/templates/reset, and applies the response via applyScheduleTemplatesResponse', async () => {
      const serverTrio = {
        scheduleTemplates: baseTemplates(),
        templateDefaults: baseDefaults(),
        templateOverrides: {},
      };
      apiClient.post.mockResolvedValue({ data: serverTrio });
      const config = makeConfig();
      render(<UnifiedTemplateTab config={config} theme={theme} showToast={jest.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Reset templates to defaults' }));
      expect(screen.getByText('Reset templates?')).toBeInTheDocument();
      expect(apiClient.post).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
      await act(async () => {});

      expect(apiClient.post).toHaveBeenCalledWith('/config/templates/reset');
      expect(config.applyScheduleTemplatesResponse).toHaveBeenCalledWith(serverTrio);
      expect(screen.queryByText('Reset templates?')).toBeNull();
    });

    it('cancelling the reset confirm dialog never calls the API', () => {
      const config = makeConfig();
      render(<UnifiedTemplateTab config={config} theme={theme} showToast={jest.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Reset templates to defaults' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('a rejected reset surfaces the server error + validation details as PLAIN TEXT via showToast', async () => {
      apiClient.post.mockRejectedValue({
        response: { data: { error: 'Invalid schedule_templates', details: ['schedule_templates.weekday.blocks[0].loc must be a non-empty string'] } },
      });
      const showToast = jest.fn();
      const config = makeConfig();
      render(<UnifiedTemplateTab config={config} theme={theme} showToast={showToast} />);

      fireEvent.click(screen.getByRole('button', { name: 'Reset templates to defaults' }));
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
      await act(async () => {});

      expect(showToast).toHaveBeenCalledTimes(1);
      const [msg, type] = showToast.mock.calls[0];
      expect(typeof msg).toBe('string');
      expect(msg).toBe('Invalid schedule_templates: schedule_templates.weekday.blocks[0].loc must be a non-empty string');
      expect(type).toBe('error');
      expect(config.applyScheduleTemplatesResponse).not.toHaveBeenCalled();
    });

    it('a rejected reset with no response body falls back to a generic message', async () => {
      apiClient.post.mockRejectedValue(new Error('network down'));
      const showToast = jest.fn();
      const config = makeConfig();
      render(<UnifiedTemplateTab config={config} theme={theme} showToast={showToast} />);

      fireEvent.click(screen.getByRole('button', { name: 'Reset templates to defaults' }));
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
      await act(async () => {});

      expect(showToast).toHaveBeenCalledWith('Failed to reset templates', 'error');
    });
  });
});

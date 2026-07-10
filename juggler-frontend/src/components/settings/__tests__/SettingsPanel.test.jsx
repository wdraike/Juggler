/**
 * SettingsPanel tests (999.1211 — settings surface).
 *
 * SettingsPanel is a thin orchestrator (999.965): this suite pins the
 * orchestration contract — tab list + selection state, which tab component
 * mounts for each tab, the props each tab receives (config/showToast/allTasks
 * pass-through, ProjectsTab's allTasks || [] guard), and modal close wiring
 * (overlay click closes, card click doesn't, × closes).
 *
 * All 7 tab components are stubbed: their internals (incl. ProjectsTab copy,
 * changing concurrently) are out of scope here.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// CRA's jest config runs with resetMocks:true, which strips implementations
// passed to jest.fn() in module factories before every test — so the factories
// only create bare jest.fn()s and the stub renderers are (re)installed in
// beforeEach below.
jest.mock('../tabs/LocationsTab', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../tabs/ToolsTab', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../tabs/MatrixTab', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../tabs/ProjectsTab', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../tabs/PreferencesTab', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../tabs/NotificationsTab', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../tabs/UnifiedTemplateTab', () => ({ __esModule: true, default: jest.fn() }));

import SettingsPanel from '../SettingsPanel';
import LocationsTab from '../tabs/LocationsTab';
import ToolsTab from '../tabs/ToolsTab';
import MatrixTab from '../tabs/MatrixTab';
import ProjectsTab from '../tabs/ProjectsTab';
import PreferencesTab from '../tabs/PreferencesTab';
import NotificationsTab from '../tabs/NotificationsTab';
import UnifiedTemplateTab from '../tabs/UnifiedTemplateTab';

const TAB_STUBS = [
  [LocationsTab, 'locations-tab'],
  [ToolsTab, 'tools-tab'],
  [MatrixTab, 'matrix-tab'],
  [ProjectsTab, 'projects-tab'],
  [PreferencesTab, 'preferences-tab'],
  [NotificationsTab, 'notifications-tab'],
  [UnifiedTemplateTab, 'templates-tab'],
];

const TAB_LABELS = ['Locations', 'Tools', 'Tool Matrix', 'Templates', 'Projects', 'Preferences', 'Notifications'];

function renderPanel(props = {}) {
  return render(
    <SettingsPanel
      onClose={props.onClose || jest.fn()}
      darkMode={false}
      config={props.config || { marker: 'config-object' }}
      allProjectNames={props.allProjectNames || ['work']}
      allTasks={props.allTasks}
      isMobile={false}
      onRenameProject={props.onRenameProject}
      showToast={props.showToast}
    />
  );
}

function lastProps(mockComponent) {
  const calls = mockComponent.mock.calls;
  return calls[calls.length - 1][0];
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // (Re)install stub renderers — resetMocks:true wiped them (see note above).
    TAB_STUBS.forEach(([Tab, testid]) => {
      Tab.mockImplementation(() => <div data-testid={testid} />);
    });
  });

  it('renders a modal dialog with all 7 tabs, Locations selected by default', () => {
    renderPanel();

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual(TAB_LABELS);

    expect(screen.getByRole('tab', { name: 'Locations' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('locations-tab')).toBeInTheDocument();
    // Only one tab panel mounted at a time
    expect(screen.queryByTestId('preferences-tab')).toBeNull();
  });

  it('switches the mounted tab component and aria-selected on tab click', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('tab', { name: 'Preferences' }));

    expect(screen.getByTestId('preferences-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('locations-tab')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Preferences' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Locations' })).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }));
    expect(screen.getByTestId('templates-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('preferences-tab')).toBeNull();
  });

  it('passes the config object through to tab components by identity', () => {
    const config = { marker: 'config-object' };
    renderPanel({ config });

    expect(lastProps(LocationsTab).config).toBe(config);

    fireEvent.click(screen.getByRole('tab', { name: 'Preferences' }));
    expect(lastProps(PreferencesTab).config).toBe(config);
  });

  it('routes showToast and allTasks to the tabs that use them', () => {
    const showToast = jest.fn();
    const allTasks = [{ id: 't1' }];
    renderPanel({ showToast, allTasks });

    fireEvent.click(screen.getByRole('tab', { name: 'Notifications' }));
    expect(lastProps(NotificationsTab).showToast).toBe(showToast);

    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }));
    expect(lastProps(UnifiedTemplateTab).showToast).toBe(showToast);
    expect(lastProps(UnifiedTemplateTab).allTasks).toBe(allTasks);
  });

  it('ProjectsTab receives project wiring; missing allTasks degrades to [] (approved guard)', () => {
    const onRenameProject = jest.fn();
    renderPanel({ allProjectNames: ['work', 'home'], onRenameProject, allTasks: undefined });

    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));

    const props = lastProps(ProjectsTab);
    expect(props.allProjectNames).toEqual(['work', 'home']);
    expect(props.onRenameProject).toBe(onRenameProject);
    expect(props.allTasks).toEqual([]);
  });

  it('closes on overlay click and the × button, but not on clicks inside the card', () => {
    const onClose = jest.fn();
    renderPanel({ onClose });

    // Click inside the card (header text) — must NOT close
    fireEvent.click(screen.getByText('Settings'));
    expect(onClose).not.toHaveBeenCalled();

    // × header button closes
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Overlay (the dialog backdrop itself) closes
    fireEvent.click(screen.getByRole('dialog', { name: 'Settings' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

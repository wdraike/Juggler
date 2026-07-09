/**
 * SettingsPanel — thin orchestrator over extracted tab components (999.965).
 */
import React, { useState } from 'react';
import { getTheme } from '../../theme/colors';
import HelpIcon from './HelpIcon';
import LocationsTab from './tabs/LocationsTab';
import ToolsTab from './tabs/ToolsTab';
import MatrixTab from './tabs/MatrixTab';
import ProjectsTab from './tabs/ProjectsTab';
import PreferencesTab from './tabs/PreferencesTab';
import NotificationsTab from './tabs/NotificationsTab';
import UnifiedTemplateTab from './tabs/UnifiedTemplateTab';

var TABS = [
  { id: 'locations', label: 'Locations', tip: 'Locations — define places you work (home, office, gym, etc.)' },
  { id: 'tools', label: 'Tools', tip: 'Tools — define tools you use (laptop, phone, etc.)' },
  { id: 'matrix', label: 'Tool Matrix', tip: 'Tool Matrix — which tools are available at each location' },
  { id: 'templates', label: 'Templates', tip: 'Templates — define daily time blocks, locations, and schedule structure' },
  { id: 'projects', label: 'Projects', tip: 'Projects — manage project names and colors' },
  { id: 'preferences', label: 'Preferences', tip: 'Preferences — font size, grid zoom, task defaults' },
  { id: 'notifications', label: 'Notifications', tip: 'Notifications — enable browser push notifications for task reminders' },
];

export default function SettingsPanel({ onClose, darkMode, config, allProjectNames, allTasks, isMobile, onRenameProject, showToast }) {
  var theme = getTheme(darkMode);
  var [tab, setTab] = useState('locations');

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex',
      alignItems: 'center', justifyContent: 'center'
    }} onClick={onClose} role="dialog" aria-modal="true" aria-label="Settings">
      <div style={{
        background: theme.bgSecondary, borderRadius: isMobile ? 0 : 12,
        width: isMobile ? '100%' : 700, maxWidth: isMobile ? '100%' : '95vw',
        height: isMobile ? '100%' : undefined, maxHeight: isMobile ? '100%' : '85vh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: isMobile ? 'none' : `0 8px 32px ${theme.shadow}`
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: `1px solid ${theme.border}`
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: theme.text }}>Settings</div>
          <button onClick={onClose} style={{
            border: 'none', background: 'transparent', color: theme.textMuted,
            fontSize: 20, cursor: 'pointer'
          }} aria-label="Close settings">&times;</button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: 2, padding: '8px 16px',
          borderBottom: `1px solid ${theme.border}`, overflowX: 'auto'
        }} role="tablist" aria-label="Settings tabs">
          {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} title={t.tip} role="tab" aria-selected={tab === t.id} aria-label={t.label} style={{
            border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
            background: tab === t.id ? theme.accent : 'transparent',
            color: tab === t.id ? '#FDFAF5' : theme.textSecondary,
            fontSize: 12, fontWeight: tab === t.id ? 600 : 400, fontFamily: 'inherit',
            whiteSpace: 'nowrap'
          }}>
            <HelpIcon text={t.tip} theme={theme} style={{ display: 'inline-flex', marginRight: 4, verticalAlign: 'middle' }}>
              <span>{t.label}</span>
            </HelpIcon>
          </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {tab === 'locations' && <LocationsTab config={config} theme={theme} darkMode={darkMode} isMobile={isMobile} />}
          {tab === 'tools' && <ToolsTab config={config} theme={theme} darkMode={darkMode} isMobile={isMobile} />}
          {tab === 'matrix' && <MatrixTab config={config} theme={theme} />}
          {tab === 'projects' && <ProjectsTab config={config} theme={theme} darkMode={darkMode} isMobile={isMobile} allProjectNames={allProjectNames} allTasks={allTasks || []} onRenameProject={onRenameProject} />}
          {tab === 'preferences' && <PreferencesTab config={config} theme={theme} />}
          {tab === 'notifications' && <NotificationsTab theme={theme} showToast={showToast} />}
          {tab === 'templates' && <UnifiedTemplateTab config={config} theme={theme} showToast={showToast} allTasks={allTasks} />}
        </div>
      </div>
    </div>
  );
}

/**
 * PreferencesTab — extracted from SettingsPanel (999.965).
 * Stub — full implementation was in SettingsPanel.jsx.
 */
import React from 'react';
import { TZ_OVERRIDE_KEY } from '../../services/apiClient';
import HelpIcon from '../HelpIcon';

var commonTimezones = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'America/Phoenix',
  'America/Toronto', 'America/Vancouver', 'America/Edmonton',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Asia/Dubai',
  'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland',
  'America/Sao_Paulo', 'America/Mexico_City', 'America/Bogota'
];

export default function PreferencesTab({ config, theme }) {
  function savePrefs(patch) {
    config.updatePreferences({
      gridZoom: config.gridZoom, splitDefault: config.splitDefault,
      splitMinDefault: config.splitMinDefault, schedFloor: config.schedFloor, schedCeiling: config.schedCeiling,
      fontSize: config.fontSize, pullForwardDampening: config.pullForwardDampening,
      timezoneOverride: config.timezoneOverride, calCompletedBehavior: config.calCompletedBehavior,
      ...patch
    });
  }

  var allTimezones = commonTimezones;
  try { if (typeof Intl !== 'undefined' && Intl.supportedValuesOf) { allTimezones = Intl.supportedValuesOf('timeZone'); } } catch (e) { /* ignore */ }

  var browserTz = null;
  try { browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* ignore */ }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 12 }}>
        <HelpIcon text="Preferences — font size, grid zoom, task defaults, timezone, and scheduling behavior." theme={theme}><span>Preferences</span></HelpIcon>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12, color: theme.text }}>
          <HelpIcon text="Override the auto-detected timezone." theme={theme}><div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><span style={{ fontWeight: 500 }}>Timezone:</span></div></HelpIcon>
          <div style={{ flex: 1, position: 'relative' }}>
            <input list="tz-list" value={config.timezoneOverride ? config.timezoneOverride.replace(/_/g, ' ') : ''}
              onChange={function(e) { var raw = e.target.value.replace(/ /g, '_'); var match = allTimezones.find(function(tz) { return tz === raw; }); if (match) { config.setTimezoneOverride(match); savePrefs({ timezoneOverride: match }); try { localStorage.setItem(TZ_OVERRIDE_KEY, match); } catch (err) { /* ignore */ } } else if (!e.target.value) { config.setTimezoneOverride(null); savePrefs({ timezoneOverride: null }); try { localStorage.removeItem(TZ_OVERRIDE_KEY); } catch (err) { /* ignore */ } } }}
              placeholder={'Browser' + (browserTz ? ' (' + browserTz + ')' : '')}
              style={{ width: '100%', boxSizing: 'border-box', padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12, fontFamily: 'inherit' }} />
            <datalist id="tz-list">{allTimezones.map(function(tz) { return <option key={tz} value={tz.replace(/_/g, ' ')} />; })}</datalist>
          </div>
          <div style={{ fontSize: 10, color: theme.textMuted }}>{config.timezoneOverride ? 'Manual override active.' : browserTz ? 'Auto-detected: ' + browserTz + '.' : 'No timezone detected.'}</div>
        </div>
        <label style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          <HelpIcon text="Scale the entire UI font size." theme={theme}><span>Font size:</span></HelpIcon>
          <input type="range" min={80} max={140} value={config.fontSize} onChange={e => { var v = parseInt(e.target.value); config.setFontSize(v); savePrefs({ fontSize: v }); }} />
          <span style={{ fontSize: 11, color: theme.textMuted }}>{config.fontSize}%</span>
        </label>
        <label style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          <HelpIcon text="Height in pixels per hour on the timeline grid." theme={theme}><span>Grid zoom (px/hour):</span></HelpIcon>
          <input type="range" min={30} max={120} value={config.gridZoom} onChange={e => { var v = parseInt(e.target.value); config.setGridZoom(v); savePrefs({ gridZoom: v }); }} />
          <span style={{ fontSize: 11, color: theme.textMuted }}>{config.gridZoom}px</span>
        </label>
        <label style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          <HelpIcon text="When enabled, new tasks default to splittable." theme={theme}><span>Split tasks by default</span></HelpIcon>
          <input type="checkbox" checked={config.splitDefault} onChange={e => { var v = e.target.checked; config.setSplitDefault(v); savePrefs({ splitDefault: v }); }} />
        </label>
        <label style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          <HelpIcon text="Smallest chunk size when splitting tasks (minutes)." theme={theme}><span>Min chunk (min):</span></HelpIcon>
          <input type="number" value={config.splitMinDefault} onChange={e => { var v = parseInt(e.target.value) || 15; config.setSplitMinDefault(v); savePrefs({ splitMinDefault: v }); }} style={{ width: 60, padding: '4px 6px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        </label>
        <label style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          <HelpIcon text="The scheduler won't place tasks earlier than this time." theme={theme}><span>Earliest scheduling time:</span></HelpIcon>
          <select value={config.schedFloor} onChange={e => { var v = parseInt(e.target.value); config.setSchedFloor(v); savePrefs({ schedFloor: v }); }} style={{ padding: '4px 6px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }}>
            {[360,420,480,540,600,660,720].map(m => (<option key={m} value={m}>{Math.floor(m/60) % 12 || 12}:{(m%60) < 10 ? '0' : ''}{m%60} {m < 720 ? 'AM' : 'PM'}</option>))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          <HelpIcon text="The scheduler won't place tasks later than this time." theme={theme}><span>Latest scheduling time:</span></HelpIcon>
          <select value={config.schedCeiling} onChange={e => { var v = parseInt(e.target.value); config.setSchedCeiling(v); savePrefs({ schedCeiling: v }); }} style={{ padding: '4px 6px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }}>
            {[1080,1140,1200,1260,1320,1380,1440].map(m => (<option key={m} value={m}>{m === 1440 ? '12:00 AM' : (Math.floor(m/60) % 12 || 12) + ':' + ((m%60) < 10 ? '0' : '') + (m%60) + (m < 720 ? ' AM' : ' PM')}</option>))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          <HelpIcon text="When enabled, tasks pull forward less aggressively." theme={theme}>
            <input type="checkbox" checked={config.pullForwardDampening || false} onChange={e => { var v = e.target.checked; config.setPullForwardDampening(v); savePrefs({ pullForwardDampening: v }); }} />
            <span>Dampen pull-forward</span>
          </HelpIcon>
        </label>
        <div style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          <HelpIcon text="Display unit for weather temperatures." theme={theme}><span style={{ fontWeight: 500 }}>Temperature unit:</span></HelpIcon>
          <div style={{ display: 'flex', gap: 4 }}>{['F', 'C'].map(function(u) { var active = (config.tempUnitPref || 'F') === u; return (<button key={u} onClick={function() { config.updateTempUnitPref(u); }} style={{ padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer', border: '1px solid ' + (active ? theme.accent : theme.inputBorder), background: active ? theme.accent : theme.input, color: active ? '#FDFAF5' : theme.text, fontFamily: 'inherit', fontWeight: active ? 600 : 400 }}>&deg;{u}</button>); })}</div>
        </div>
        <div style={{ fontSize: 12, color: theme.text }}>
          <HelpIcon text="Controls what happens to calendar events when a synced task is marked done." theme={theme}><span style={{ fontWeight: 500 }}>Done tasks on calendar:</span></HelpIcon>
          <select value={config.calCompletedBehavior || 'update'} onChange={function(e) { var v = e.target.value; config.setCalCompletedBehavior(v); savePrefs({ calCompletedBehavior: v }); }} style={{ marginLeft: 8, padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12, fontFamily: 'inherit' }}>
            <option value="update">Mark as done</option><option value="delete">Remove from calendar</option><option value="keep">Keep as-is</option>
          </select>
        </div>
      </div>
    </div>
  );
}

/**
 * CompletionTimePicker — when marking a task done, let the user choose
 * the completion time: scheduled time, now, or a custom date/time.
 */

import React, { useState } from 'react';
import { getTheme } from '../../theme/colors';

export default function CompletionTimePicker({ task, onConfirm, onCancel, darkMode, isMobile }) {
  var theme = getTheme(darkMode);

  // Format the task's scheduled time for display
  var scheduledLabel = '';
  if (task && task.date) {
    scheduledLabel = task.date;
    if (task.time) scheduledLabel += ' ' + task.time;
  }

  // For tasks whose scheduled time is in the past, default to "Scheduled time":
  // the user most likely did the task at (or near) its planned slot, and the
  // calendar is already showing them that time. Skips the extra click for
  // overdue recurring instances.
  var scheduledInPast = false;
  if (task && task.scheduledAt) {
    scheduledInPast = new Date(task.scheduledAt) < new Date();
  }
  var defaultMode = (scheduledInPast && scheduledLabel) ? 'scheduled' : 'now';
  var [mode, setMode] = useState(defaultMode);
  var [customValue, setCustomValue] = useState(function() {
    // Default the custom picker to now in local time
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });

  var iStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 4,
    border: '1px solid ' + theme.border, background: theme.inputBg,
    color: theme.inputText, fontSize: 14, fontFamily: 'inherit',
    boxSizing: 'border-box', outline: 'none'
  };

  var optStyle = function(active) {
    return {
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      borderRadius: 8, cursor: 'pointer', fontSize: 14, color: theme.text,
      background: active ? (theme.accent + '18') : 'transparent',
      border: '1px solid ' + (active ? theme.accent : theme.border),
      transition: 'all 0.15s'
    };
  };

  function handleConfirm() {
    if (mode === 'now') onConfirm('now');
    else if (mode === 'scheduled') onConfirm('scheduled');
    else onConfirm(customValue);
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 400, display: 'flex',
      alignItems: 'center', justifyContent: 'center'
    }} onClick={onCancel}>
      <div style={{
        background: theme.bgSecondary, borderRadius: isMobile ? 0 : 12,
        width: isMobile ? '100%' : 340, maxWidth: isMobile ? '100%' : '90vw',
        height: isMobile ? '100%' : undefined,
        padding: 24, boxShadow: isMobile ? 'none' : ('0 8px 32px ' + theme.shadow),
        display: isMobile ? 'flex' : undefined, flexDirection: isMobile ? 'column' : undefined,
        justifyContent: isMobile ? 'center' : undefined
      }} onClick={function(e) { e.stopPropagation(); }}>

        <div style={{ fontSize: 15, fontWeight: 600, color: theme.text, marginBottom: 4 }}>
          Mark as Complete
        </div>
        <div style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 16 }}>
          When was this completed?
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <div style={optStyle(mode === 'now')} onClick={function() { setMode('now'); }}>
            <span style={{ fontSize: 16 }}>Now</span>
          </div>

          {scheduledLabel && (
            <div style={optStyle(mode === 'scheduled')} onClick={function() { setMode('scheduled'); }}>
              <span style={{ fontSize: 16 }}>Scheduled time</span>
              <span style={{ fontSize: 12, color: theme.textSecondary, marginLeft: 'auto' }}>{scheduledLabel}</span>
            </div>
          )}

          <div style={optStyle(mode === 'custom')} onClick={function() { setMode('custom'); }}>
            <span style={{ fontSize: 16 }}>Other</span>
          </div>

          {mode === 'custom' && (
            <div style={{ paddingLeft: 4, marginTop: 4 }}>
              <input type="datetime-local" value={customValue} style={iStyle}
                onChange={function(e) { setCustomValue(e.target.value); }} />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            border: '1px solid ' + theme.border, borderRadius: 8, padding: '8px 20px',
            background: 'transparent', color: theme.textSecondary, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit'
          }}>Cancel</button>
          <button onClick={handleConfirm} style={{
            border: 'none', borderRadius: 8, padding: '8px 20px',
            background: theme.accent, color: '#FDFAF5', fontWeight: 600, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit'
          }}>Mark Complete</button>
        </div>
      </div>
    </div>
  );
}

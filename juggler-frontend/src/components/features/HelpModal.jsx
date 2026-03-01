/**
 * HelpModal — keyboard shortcuts and help reference
 */

import React from 'react';
import { getTheme } from '../../theme/colors';

var SHORTCUTS = [
  { key: '\u2190 / \u2192', desc: 'Navigate days' },
  { key: 'Shift + \u2190 / \u2192', desc: 'Navigate weeks' },
  { key: 'J / K', desc: 'Navigate tasks' },
  { key: 'S', desc: 'Cycle task status' },
  { key: 'Ctrl/Cmd + Z', desc: 'Undo' },
  { key: 'Esc', desc: 'Close expanded panel' },
];

export default function HelpModal({ onClose, darkMode }) {
  var theme = getTheme(darkMode);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex',
      alignItems: 'center', justifyContent: 'center'
    }} onClick={onClose}>
      <div style={{
        background: theme.bgSecondary, borderRadius: 12, width: 480, maxWidth: '95vw',
        maxHeight: '80vh', overflow: 'auto', padding: 20,
        boxShadow: '0 8px 32px ' + theme.shadow
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: theme.text }}>Help & Shortcuts</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: theme.textMuted, fontSize: 20, cursor: 'pointer' }}>&times;</button>
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Keyboard Shortcuts</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20 }}>
          {SHORTCUTS.map(function(s, i) {
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 8px', background: theme.bgTertiary, borderRadius: 6 }}>
                <kbd style={{
                  background: darkMode ? '#334155' : '#E2E8F0', color: theme.text,
                  padding: '2px 8px', borderRadius: 4, fontSize: 12, fontFamily: 'monospace',
                  fontWeight: 600, minWidth: 120, textAlign: 'center',
                  border: '1px solid ' + theme.border
                }}>{s.key}</kbd>
                <span style={{ fontSize: 12, color: theme.textSecondary }}>{s.desc}</span>
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Views</div>
        <div style={{ fontSize: 12, color: theme.textSecondary, lineHeight: 1.6, marginBottom: 16 }}>
          <strong>Day/3-Day/Week:</strong> Calendar grid views with drag-and-drop scheduling<br />
          <strong>Month:</strong> Monthly calendar overview, drag tasks between dates<br />
          <strong>List:</strong> All tasks grouped by date with inline status controls<br />
          <strong>Priority:</strong> Kanban-style P1-P4 columns with drag between priorities<br />
          <strong>Issues:</strong> Unplaced tasks, conflicts, and deadline misses
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Filters</div>
        <div style={{ fontSize: 12, color: theme.textSecondary, lineHeight: 1.6, marginBottom: 16 }}>
          <strong>Open:</strong> Tasks not done/cancelled/skipped<br />
          <strong>Action:</strong> Open + WIP tasks combined<br />
          <strong>Blocked:</strong> Tasks waiting on incomplete dependencies<br />
          <strong>Unplaced:</strong> Tasks the scheduler couldn't place<br />
          <strong>Hide Habits:</strong> Toggle to hide recurring habit tasks
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Tips</div>
        <div style={{ fontSize: 12, color: theme.textSecondary, lineHeight: 1.6 }}>
          Click hour labels in Day view to cycle location for that hour.<br />
          Use the \uD83D\uDD04 button in the header to manually reschedule.<br />
          Click \u2713hab to batch-mark all habits done for the day.<br />
          Drag tasks between days, times, or priority columns.
        </div>
      </div>
    </div>
  );
}

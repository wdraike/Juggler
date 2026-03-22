/**
 * QuickAddTask — inline quick-add for a given date
 */

import React, { useState } from 'react';
import { getTheme } from '../../theme/colors';
import { formatDateKey, getDayName } from '../../scheduler/dateHelpers';
import { applyDefaults } from '../../state/constants';

export default function QuickAddTask({ date, onCreate, darkMode, isMobile, todayDate }) {
  var theme = getTheme(darkMode);
  var [text, setText] = useState('');
  var [expanded, setExpanded] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    var dateKey = date ? formatDateKey(date) : (todayDate ? formatDateKey(todayDate) : formatDateKey(new Date()));
    var id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    var task = applyDefaults({
      id,
      text: text.trim(),
      date: dateKey,
      day: getDayName(dateKey),
      pri: 'P3',
      dur: 30,
      project: ''
    });
    onCreate(task);
    setText('');
    setExpanded(false);
  }

  if (!expanded) {
    return (
      <button onClick={() => setExpanded(true)} style={{
        border: `1px dashed ${theme.border}`, borderRadius: 8, padding: '6px 12px',
        background: 'transparent', color: theme.textMuted, fontSize: 12,
        cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit'
      }}>
        + Add task
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{
      display: 'flex', gap: 6, padding: '4px 0'
    }}>
      <input
        value={text} onChange={e => setText(e.target.value)}
        placeholder="Task name..."
        autoFocus
        onBlur={() => { if (!text.trim()) setExpanded(false); }}
        style={{
          flex: 1, padding: '6px 10px', border: `1px solid ${theme.inputBorder}`,
          borderRadius: 6, background: theme.input, color: theme.text,
          fontSize: isMobile ? 16 : 13, fontFamily: 'inherit', outline: 'none',
          minHeight: isMobile ? 44 : undefined
        }}
      />
      <button type="submit" style={{
        border: 'none', borderRadius: 6, padding: '6px 12px',
        background: theme.accent, color: '#FDFAF5', fontSize: isMobile ? 14 : 12,
        fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        minHeight: isMobile ? 44 : undefined
      }}>Add</button>
    </form>
  );
}

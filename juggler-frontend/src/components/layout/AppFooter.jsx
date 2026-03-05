/**
 * AppFooter — minimal app footer with branding and version
 */

import React from 'react';
import { getTheme } from '../../theme/colors';

export default function AppFooter({ darkMode }) {
  var theme = getTheme(darkMode);
  var year = new Date().getFullYear();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: '4px 16px', flexShrink: 0, flexWrap: 'wrap',
      borderTop: '1px solid ' + theme.border,
      background: darkMode ? '#0F172A' : '#F8FAFC',
      fontSize: 11, color: theme.textMuted
    }}>
      <span style={{ fontWeight: 600, color: darkMode ? '#94A3B8' : '#475569' }}>
        &#x1F939; Juggler
      </span>
      <span style={{ color: theme.border }}>&middot;</span>
      <span>Smart task scheduling</span>
      <span style={{ color: theme.border }}>&middot;</span>
      <span>&copy; {year}</span>
      <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: darkMode ? '#475569' : '#94A3B8' }}>
        v1.0.0
      </span>
    </div>
  );
}

/**
 * AppFooter — brand footer with vintage styling
 */

import React from 'react';
import { getTheme } from '../../theme/colors';

export default function AppFooter({ darkMode }) {
  var theme = getTheme(darkMode);
  var year = new Date().getFullYear();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: '6px 16px', flexShrink: 0, flexWrap: 'wrap',
      borderTop: '1px solid ' + (darkMode ? '#2E4A7A' : '#E8E0D0'),
      background: darkMode ? '#0F1520' : '#2C2B28',
      fontSize: 11, color: darkMode ? '#8A8070' : '#E8E0D0'
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.1em' }}>
        <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, color: '#C8942A', fontSize: 11 }}>Raike</span>
        <span style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontWeight: 300, color: '#C8942A', fontSize: 13 }}>&amp;</span>
        <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400, color: '#C8942A', fontSize: 11 }}>Sons</span>
      </span>
      <span style={{ color: darkMode ? '#2E4A7A' : '#5C5A55' }}>&middot;</span>
      <span style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: 12, opacity: 0.6 }}>Old school hustle. New school AI.</span>
      <span style={{ color: darkMode ? '#2E4A7A' : '#5C5A55' }}>&middot;</span>
      <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#C8942A', opacity: 0.6 }}>Est. 2025</span>
      <span style={{ color: darkMode ? '#2E4A7A' : '#5C5A55' }}>&middot;</span>
      <span>&copy; {year}</span>
    </div>
  );
}

/**
 * AppFooter — brand footer with vintage styling
 */

import React from 'react';
import { getTheme, BRAND } from '../../theme/colors';

export default function AppFooter({ darkMode }) {
  var theme = getTheme(darkMode);
  var year = new Date().getFullYear();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: '6px 16px', flexShrink: 0, flexWrap: 'wrap',
      borderTop: '1px solid ' + theme.border,
      background: darkMode ? theme.bg : BRAND.charcoal,
      fontSize: 11, color: darkMode ? theme.textMuted : BRAND.parchmentDark
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.1em' }}>
        <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, color: BRAND.gold, fontSize: 11 }}>Raike</span>
        <span style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontWeight: 300, color: BRAND.gold, fontSize: 13 }}>&amp;</span>
        <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400, color: BRAND.gold, fontSize: 11 }}>Sons</span>
      </span>
      <span style={{ color: theme.borderLight }}>&middot;</span>
      <span style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: 12, opacity: 0.6 }}>Old school hustle. New school AI.</span>
      <span style={{ color: theme.borderLight }}>&middot;</span>
      <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: BRAND.gold, opacity: 0.6 }}>Est. 2025</span>
      <span style={{ color: theme.borderLight }}>&middot;</span>
      <span>&copy; {year}</span>
    </div>
  );
}

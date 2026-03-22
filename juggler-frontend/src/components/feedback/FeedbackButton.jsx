/**
 * FeedbackButton — trigger button for the feedback dialog
 * Matches Juggler's inline style + getTheme pattern
 */

import React, { useState } from 'react';
import FeedbackDialog from './FeedbackDialog';

export default function FeedbackButton({ darkMode, theme, isMobile }) {
  var [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={function() { setOpen(true); }}
        style={{
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: theme.headerTextMuted, fontSize: 16,
          padding: isMobile ? '8px' : '4px 6px',
          borderRadius: 2, fontFamily: "'Inter', sans-serif",
          minWidth: isMobile ? 36 : undefined,
          minHeight: isMobile ? 36 : undefined
        }}
        title="Report an issue or request a feature"
      >
        {'\uD83D\uDC1B'}
      </button>
      {open && (
        <FeedbackDialog
          open={open}
          onClose={function() { setOpen(false); }}
          darkMode={darkMode}
          theme={theme}
        />
      )}
    </>
  );
}

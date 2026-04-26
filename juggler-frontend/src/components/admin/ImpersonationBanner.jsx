import React, { useState, useEffect } from 'react';
import { getStoredImpersonation, stopImpersonation } from '../../services/impersonationService';

export default function ImpersonationBanner({ darkMode }) {
  const [info, setInfo] = useState(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    setInfo(getStoredImpersonation());
  }, []);

  if (!info) return null;

  const handleStop = async () => {
    setStopping(true);
    try {
      await stopImpersonation();
      window.location.reload();
    } catch (err) {
      console.error('[juggler/impersonation] stop failed:', err);
      setStopping(false);
    }
  };

  const displayName = info.targetName && info.targetName !== 'null'
    ? `${info.targetName} (${info.targetEmail})`
    : (info.targetEmail || info.targetId || 'Unknown User');

  return (
    <div style={{
      position: 'sticky',
      top: 0,
      zIndex: 1200,
      backgroundColor: '#7C4A00',
      color: '#FFD580',
      borderBottom: '2px solid #C8942A',
      padding: '8px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: 13
    }}>
      <span>
        <strong>IMPERSONATING:</strong> You are viewing Juggler as{' '}
        <strong>{displayName}</strong>
      </span>
      <button
        onClick={handleStop}
        disabled={stopping}
        style={{
          marginLeft: 16,
          padding: '4px 12px',
          borderRadius: 4,
          border: '1px solid #C8942A',
          background: stopping ? '#5a3500' : '#9c5f00',
          color: '#FFD580',
          cursor: stopping ? 'not-allowed' : 'pointer',
          fontSize: 12,
          fontWeight: 600
        }}
      >
        {stopping ? 'Stopping...' : 'Stop Impersonation'}
      </button>
    </div>
  );
}

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

// Ported from resume-optimizer-frontend (999.5016). Juggler's HealthDot already
// polls /health/detailed — this context lets other components react to connection
// loss, and the GlobalConnectionModal shows after 2 consecutive failures.

const ConnectionContext = createContext();

export const useConnection = () => {
  const context = useContext(ConnectionContext);
  if (!context) {
    throw new Error('useConnection must be used within a ConnectionProvider');
  }
  return context;
};

export const ConnectionProvider = ({ children }) => {
  const [isConnected, setIsConnected] = useState(true);
  const [connectionError, setConnectionError] = useState(null);

  const setConnectionStatus = useCallback((connected, error = null) => {
    setIsConnected(connected);
    setConnectionError(error);
  }, []);

  const value = useMemo(() => ({
    isConnected,
    connectionError,
    setConnectionStatus,
  }), [isConnected, connectionError, setConnectionStatus]);

  return (
    <ConnectionContext.Provider value={value}>
      {children}
    </ConnectionContext.Provider>
  );
};
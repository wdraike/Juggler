import React, { useState, useEffect, useCallback } from 'react';
import {
  getImpersonationTargets,
  getImpersonationLog,
  startImpersonation,
  isImpersonating
} from '../../services/impersonationService';

export default function ImpersonationPage({ darkMode }) {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [userPagination, setUserPagination] = useState(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState(null);

  const [logs, setLogs] = useState([]);
  const [logPagination, setLogPagination] = useState(null);
  const [logOffset, setLogOffset] = useState(0);

  const [starting, setStarting] = useState(null);
  const [startError, setStartError] = useState(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const loadUsers = useCallback(async (q = '', offset = 0) => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const data = await getImpersonationTargets(q, 20, offset);
      setUsers(data.users);
      setUserPagination(data.pagination);
    } catch (err) {
      if (err.message.includes('403') || err.message.toLowerCase().includes('admin')) {
        setAccessDenied(true);
      } else {
        setUsersError(err.message);
      }
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadLog = useCallback(async (offset = 0) => {
    try {
      const data = await getImpersonationLog({ limit: 20, offset });
      setLogs(data.logs);
      setLogPagination(data.pagination);
    } catch (err) {
      console.warn('[ImpersonationPage] log load failed:', err.message);
    }
  }, []);

  useEffect(() => {
    loadUsers('', 0);
    loadLog(0);
  }, [loadUsers, loadLog]);

  const handleSearch = (e) => {
    const q = e.target.value;
    setSearch(q);
    loadUsers(q, 0);
  };

  const handleStart = async (userId) => {
    setStarting(userId);
    setStartError(null);
    try {
      if (isImpersonating()) {
        setStartError('Stop the current impersonation session before starting a new one.');
        setStarting(null);
        return;
      }
      await startImpersonation(userId);
      window.location.reload();
    } catch (err) {
      setStartError(err.message);
      setStarting(null);
    }
  };

  const baseStyle = {
    minHeight: '100vh',
    background: darkMode ? '#1A2B4A' : '#f5f5f5',
    color: darkMode ? '#E8E0D0' : '#333',
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: 14,
    padding: 24
  };

  if (accessDenied) {
    return (
      <div style={baseStyle}>
        <h2 style={{ color: darkMode ? '#8899BB' : '#666' }}>Admin access required</h2>
        <p style={{ color: darkMode ? '#8899BB' : '#666' }}>Your account does not have impersonation permissions.</p>
      </div>
    );
  }

  const borderColor = darkMode ? '#2D4A7A' : '#ddd';
  const cardBg = darkMode ? '#1E3354' : '#fff';

  return (
    <div style={baseStyle}>
      <h2 style={{ marginTop: 0, marginBottom: 24 }}>Admin: User Impersonation</h2>

      {startError && (
        <div style={{ background: '#3B0A0A', color: '#FF8080', borderRadius: 6, padding: '10px 14px', marginBottom: 16 }}>
          {startError}
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 10, fontWeight: 600 }}>Select a user to impersonate</div>
        <input
          type="text"
          value={search}
          onChange={handleSearch}
          placeholder="Search by email..."
          style={{
            width: '100%',
            maxWidth: 400,
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid ' + borderColor,
            background: cardBg,
            color: darkMode ? '#E8E0D0' : '#333',
            fontSize: 14,
            marginBottom: 12,
            boxSizing: 'border-box'
          }}
        />

        {usersLoading && <div style={{ color: darkMode ? '#8899BB' : '#888' }}>Loading users...</div>}
        {usersError && <div style={{ color: '#FF8080' }}>Error: {usersError}</div>}
        {!usersLoading && users.length === 0 && !usersError && (
          <div style={{ color: darkMode ? '#8899BB' : '#888' }}>No users found.</div>
        )}

        {users.map(u => (
          <div key={u.id} style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderRadius: 6,
            marginBottom: 4,
            background: cardBg,
            border: '1px solid ' + borderColor
          }}>
            <span>{u.email}</span>
            <button
              onClick={() => handleStart(u.id)}
              disabled={starting === u.id}
              style={{
                padding: '4px 12px',
                borderRadius: 4,
                border: 'none',
                background: starting === u.id ? '#5a3500' : '#7C4A00',
                color: '#FFD580',
                cursor: starting === u.id ? 'not-allowed' : 'pointer',
                fontSize: 12,
                fontWeight: 600
              }}
            >
              {starting === u.id ? 'Starting...' : 'Impersonate'}
            </button>
          </div>
        ))}

        {userPagination && userPagination.hasMore && (
          <button
            onClick={() => loadUsers(search, (userPagination.offset || 0) + userPagination.limit)}
            style={{ marginTop: 8, color: '#FFD580', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}
          >
            Load more
          </button>
        )}
      </div>

      <div>
        <div style={{ marginBottom: 10, fontWeight: 600 }}>Impersonation Log</div>
        {logs.length === 0 && (
          <div style={{ color: darkMode ? '#8899BB' : '#888' }}>No impersonation events recorded.</div>
        )}
        {logs.map(log => (
          <div key={log.id} style={{
            padding: '8px 12px',
            borderRadius: 6,
            marginBottom: 4,
            background: cardBg,
            border: '1px solid ' + borderColor,
            fontSize: 12,
            color: darkMode ? '#8899BB' : '#666'
          }}>
            <span style={{ color: darkMode ? '#E8E0D0' : '#333', fontWeight: 600 }}>{log.action}</span>
            {' — admin: '}{log.admin_email || log.admin_user_id}
            {log.target_user_id && <span>{' → target: '}{log.target_user_id}</span>}
            <span style={{ float: 'right' }}>{new Date(log.created_at).toLocaleString()}</span>
          </div>
        ))}
        {logPagination && logPagination.hasMore && (
          <button
            onClick={() => {
              const next = logOffset + (logPagination.limit || 20);
              setLogOffset(next);
              loadLog(next);
            }}
            style={{ marginTop: 8, color: '#FFD580', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}
          >
            Load more
          </button>
        )}
      </div>
    </div>
  );
}

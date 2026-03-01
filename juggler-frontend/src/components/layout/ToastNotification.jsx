/**
 * Toast notification with history
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';

export function useToast() {
  const [toast, setToast] = useState(null);
  const [toastHistory, setToastHistory] = useState([]);
  const timerRef = useRef(null);

  const showToast = useCallback((msg, type) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    var entry = { msg, type: type || "success", ts: Date.now() };
    setToast(entry);
    setToastHistory(prev => {
      var tenMinAgo = Date.now() - 10 * 60 * 1000;
      var pruned = prev.filter(t => t.ts > tenMinAgo);
      return [entry, ...pruned].slice(0, 50);
    });
    timerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    var iv = setInterval(() => {
      setToastHistory(prev => {
        var tenMinAgo = Date.now() - 10 * 60 * 1000;
        var pruned = prev.filter(t => t.ts > tenMinAgo);
        return pruned.length === prev.length ? prev : pruned;
      });
    }, 60000);
    return () => clearInterval(iv);
  }, []);

  return { toast, toastHistory, showToast };
}

export default function ToastNotification({ toast, toastHistory, showHistory, onToggleHistory }) {
  if (!toast && !showHistory) return null;

  var colors = {
    success: { bg: '#065F46', border: '#10B981' },
    error: { bg: '#991B1B', border: '#EF4444' },
    info: { bg: '#1E3A5F', border: '#3B82F6' }
  };

  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999 }}>
      {toast && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          background: (colors[toast.type] || colors.info).bg,
          border: `1px solid ${(colors[toast.type] || colors.info).border}`,
          color: '#E2E8F0', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          marginBottom: showHistory ? 8 : 0, cursor: 'pointer'
        }} onClick={onToggleHistory}>
          {toast.msg}
        </div>
      )}
      {showHistory && toastHistory.length > 0 && (
        <div style={{
          background: '#1E293B', border: '1px solid #334155', borderRadius: 8,
          padding: 8, maxHeight: 200, overflow: 'auto', fontSize: 11
        }}>
          {toastHistory.map((t, i) => (
            <div key={i} style={{ color: '#94A3B8', padding: '2px 0' }}>
              {new Date(t.ts).toLocaleTimeString()} — {t.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

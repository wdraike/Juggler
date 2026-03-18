/**
 * Toast notification with history
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import useIsMobile from '../../hooks/useIsMobile';
import { BRAND, THEME_DARK } from '../../theme/colors';

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
  var isMobile = useIsMobile();

  if (!toast && !showHistory) return null;

  var colors = {
    success: { bg: THEME_DARK.greenBg, border: THEME_DARK.greenBorder },
    error: { bg: THEME_DARK.redBg, border: THEME_DARK.redBorder },
    info: { bg: BRAND.navy, border: BRAND.navyLight }
  };

  return (
    <div style={{
      position: 'fixed', bottom: isMobile ? 10 : 20, right: isMobile ? 10 : 20,
      left: isMobile ? 10 : undefined,
      zIndex: 9999
    }}>
      {toast && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          background: (colors[toast.type] || colors.info).bg,
          border: `1px solid ${(colors[toast.type] || colors.info).border}`,
          color: THEME_DARK.text, boxShadow: '0 4px 12px ' + THEME_DARK.shadow,
          marginBottom: showHistory ? 8 : 0, cursor: 'pointer'
        }} onClick={onToggleHistory}>
          {toast.msg}
        </div>
      )}
      {showHistory && toastHistory.length > 0 && (
        <div style={{
          background: THEME_DARK.bgSecondary, border: '1px solid ' + THEME_DARK.border, borderRadius: 8,
          padding: 8, maxHeight: 200, overflow: 'auto', fontSize: 11
        }}>
          {toastHistory.map((t, i) => (
            <div key={i} style={{ color: THEME_DARK.badgeText, padding: '2px 0' }}>
              {new Date(t.ts).toLocaleTimeString()} — {t.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

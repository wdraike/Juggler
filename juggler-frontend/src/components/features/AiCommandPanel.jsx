/**
 * AiCommandPanel — inline AI input for the header bar with dropdown chat log
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getTheme } from '../../theme/colors';
import apiClient from '../../services/apiClient';

export default function AiCommandPanel({
  darkMode, isMobile, allTasks, statuses, config,
  onApplyOps, showToast
}) {
  var theme = getTheme(darkMode);
  var [showLog, setShowLog] = useState(false);
  var [aiCmd, setAiCmd] = useState('');
  var [aiLog, setAiLog] = useState([]);
  var [aiLoading, setAiLoading] = useState(false);
  var [dropdownPos, setDropdownPos] = useState(null);
  var autoHideRef = useRef(null);
  var logRef = useRef(null);
  var panelRef = useRef(null);

  useEffect(function() {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [aiLog]);

  // Track panel position for portal dropdown; recalculate on resize
  useEffect(function() {
    if (!showLog) { setDropdownPos(null); return; }
    function updatePos() {
      if (panelRef.current) {
        var rect = panelRef.current.getBoundingClientRect();
        setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.right - rect.left });
      }
    }
    updatePos();
    window.addEventListener('resize', updatePos);
    return function() { window.removeEventListener('resize', updatePos); };
  }, [showLog]);

  // Close dropdown on outside click — check both the input panel and the portal dropdown
  useEffect(function() {
    if (!showLog) return;
    function handleClick(e) {
      var inPanel = panelRef.current && panelRef.current.contains(e.target);
      var inPortal = logRef.current && logRef.current.contains(e.target);
      if (!inPanel && !inPortal) setShowLog(false);
    }
    document.addEventListener('mousedown', handleClick);
    return function() { document.removeEventListener('mousedown', handleClick); };
  }, [showLog]);

  // Local location shortcut patterns (no API needed)
  function tryLocalCommand(msg) {
    var locWord = null, dayWord = null, dateStr = null;
    var wfhMatch = msg.match(/^wfh(?:\s+(?:on\s+)?(?:(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|weekdays?|all week)|([\d]{1,2}\/[\d]{1,2})))?$/i);
    if (wfhMatch) { locWord = 'home'; dayWord = (wfhMatch[1] || '').toLowerCase(); dateStr = wfhMatch[2] || ''; if (!dayWord && !dateStr) dayWord = 'weekdays'; }
    if (!locWord) {
      var offMatch = msg.match(/^(?:in |at )?office(?:\s+(?:on\s+)?(?:(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|weekdays?|all week)|([\d]{1,2}\/[\d]{1,2})))?$/i);
      if (offMatch) { locWord = 'work'; dayWord = (offMatch[1] || '').toLowerCase(); dateStr = offMatch[2] || ''; if (!dayWord && !dateStr) dayWord = 'weekdays'; }
    }
    if (!locWord) {
      var locMatch = msg.match(/(?:i(?:'m| am| will be|'ll be) (?:going to be )?(?:at )?)(?:the )?(home|work|office|downtown|gym|transit|commute|commuting|errand)(?:\s+(?:on\s+|all\s+)?(?:(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|weekdays?|all week)|([\d]{1,2}\/[\d]{1,2})))?/i);
      if (locMatch) { locWord = (locMatch[1] || '').toLowerCase(); dayWord = (locMatch[2] || '').toLowerCase(); dateStr = locMatch[3] || ''; }
    }
    if (locWord) {
      var locId = locWord === 'office' ? 'work' : locWord === 'commute' || locWord === 'commuting' ? 'transit' : locWord;
      var locs = (config && config.locations) || [];
      if (!locs.find(function(l) { return l.id === locId; })) locId = 'home';
      var locObj = locs.find(function(l) { return l.id === locId; });
      var locName = locObj ? locObj.name : locId;
      var locIcon = locObj ? locObj.icon : '';
      var ops = [];
      if (dateStr) {
        ops.push({ op: 'set_date_location', date: dateStr, location: locId });
        return { msg: 'Set ' + dateStr + ' location to ' + locIcon + ' ' + locName, ops: ops, local: true };
      }
      if (dayWord) {
        var dayMap = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
        var targetDays = [];
        if (dayWord === 'weekdays' || dayWord === 'weekday' || dayWord === 'all week') targetDays = ['Mon','Tue','Wed','Thu','Fri'];
        else if (dayMap[dayWord]) targetDays = [dayMap[dayWord]];
        if (targetDays.length > 0) {
          targetDays.forEach(function(dn) { ops.push({ op: 'set_weekly', day: dn, location: locId }); });
          var label = targetDays.length > 1 ? targetDays.join(',') : targetDays[0];
          return { msg: 'Set ' + label + ' all blocks to ' + locIcon + ' ' + locName, ops: ops, local: true };
        }
      }
    }
    return null;
  }

  var handleSend = async function() {
    var text = aiCmd.trim();
    if (!text || aiLoading) return;
    setAiCmd('');
    setAiLoading(true);
    setShowLog(true);
    setAiLog(function(prev) { return prev.concat([{ role: 'user', text: text }]); });
    if (autoHideRef.current) clearTimeout(autoHideRef.current);

    var local = tryLocalCommand(text);
    if (local) {
      if (onApplyOps) onApplyOps(local.ops, local.msg);
      setAiLog(function(prev) { return prev.concat([{ role: 'ai', text: local.msg, ops: local.ops }]); });
      setAiLoading(false);
      autoHideRef.current = setTimeout(function() { setShowLog(false); }, 8000);
      return;
    }

    try {
      var mentionedIds = (text.match(/[td]h?\d{1,4}|ai\d{3}/gi) || []).map(function(s) { return s.toLowerCase(); });
      var relevantTasks = (allTasks || []).filter(function(t) {
        var st = (statuses || {})[t.id] || '';
        if (mentionedIds.some(function(mid) { return t.id.toLowerCase() === mid; })) return true;
        if (st === 'done' || st === 'cancel' || st === 'skip') return false;
        return true;
      });
      var resp = await apiClient.post('/ai/command', {
        command: text,
        tasks: relevantTasks,
        statuses: statuses || {},
        config: {
          locations: config.locations, tools: config.tools, toolMatrix: config.toolMatrix,
          timeBlocks: config.timeBlocks, locSchedules: config.locSchedules,
          locScheduleDefaults: config.locScheduleDefaults, locScheduleOverrides: config.locScheduleOverrides
        }
      }, { timeout: 55000 });
      var data = resp.data;
      if (!data.unsupported && onApplyOps && data.ops && data.ops.length > 0) onApplyOps(data.ops, data.msg);
      setAiLog(function(prev) { return prev.concat([{ role: 'ai', text: data.msg || 'Done.', ops: data.unsupported ? [] : (data.ops || []), unsupported: !!data.unsupported }]); });
      var hideDelay = (data.ops || []).some(function(o) { return o.op === 'add'; }) ? 30000 : 8000;
      autoHideRef.current = setTimeout(function() { setShowLog(false); }, hideDelay);
    } catch (err) {
      var errMsg = (err.response && err.response.data && err.response.data.error) || err.message || 'API call failed';
      setAiLog(function(prev) { return prev.concat([{ role: 'ai', text: 'Error: ' + errMsg }]); });
      autoHideRef.current = setTimeout(function() { setShowLog(false); }, 8000);
    }
    setAiLoading(false);
  };

  return (
    <div ref={panelRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, flex: 1, maxWidth: isMobile ? undefined : 320 }}>
      <input
        value={aiCmd}
        onChange={function(e) { setAiCmd(e.target.value); }}
        onClick={function(e) { e.stopPropagation(); if (aiLog.length > 0) setShowLog(true); if (autoHideRef.current) clearTimeout(autoHideRef.current); }}
        onFocus={function(e) { e.stopPropagation(); if (autoHideRef.current) clearTimeout(autoHideRef.current); }}
        onKeyDown={function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
        placeholder={aiLoading ? 'Thinking...' : 'Ask AI: "reschedule my day", "wfh"...'}
        title='AI commands — type "wfh", "office", or natural language like "move groceries to Friday"'
        autoComplete="off" autoCorrect="off" spellCheck="false"
        style={{
          flex: 1, background: theme.input,
          color: theme.inputText,
          border: '1px solid ' + theme.inputBorder,
          borderRadius: 2, padding: isMobile ? '8px 10px' : '5px 10px',
          fontSize: isMobile ? 16 : 12, outline: 'none',
          fontFamily: "'Inter', system-ui, sans-serif",
          WebkitAppearance: 'none', minHeight: isMobile ? 36 : 28
        }}
      />
      {aiCmd.trim() && (
        <>
          <button
            onClick={function(e) { e.stopPropagation(); setAiCmd(''); }}
            style={{
              background: 'transparent', color: theme.textMuted, border: 'none',
              borderRadius: 6, padding: '4px 6px', fontSize: 14, cursor: 'pointer',
              flexShrink: 0, lineHeight: 1, fontFamily: 'inherit'
            }}
            title="Clear command input"
          >&times;</button>
          <button
            onClick={function(e) { e.stopPropagation(); handleSend(); }}
            disabled={aiLoading}
            title="Send command"
            style={{
              background: aiLoading ? theme.bgTertiary : theme.accent, color: 'white', border: 'none',
              borderRadius: 6, padding: isMobile ? '8px 12px' : '4px 10px', fontSize: 12, fontWeight: 600,
              cursor: aiLoading ? 'wait' : 'pointer', flexShrink: 0, minHeight: isMobile ? 36 : 28
            }}
          >{aiLoading ? '...' : '⏎'}</button>
        </>
      )}
      {!aiCmd.trim() && aiLog.length > 0 && (
        <button
          onClick={function(e) { e.stopPropagation(); setShowLog(!showLog); if (autoHideRef.current) clearTimeout(autoHideRef.current); }}
          title={showLog ? 'Hide command history' : 'Show command history'}
          style={{
            background: showLog ? theme.accent : 'transparent', color: showLog ? 'white' : theme.textMuted,
            border: 'none', borderRadius: 6, padding: '4px 6px', fontSize: 12,
            cursor: 'pointer', flexShrink: 0
          }}
        >{'💬'}</button>
      )}

      {/* Dropdown chat log — portal to document.body escapes header overflow/stacking-context clipping */}
      {showLog && dropdownPos && createPortal(
        <div ref={logRef} style={{
          position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width,
          maxHeight: '50vh', overflowY: 'auto', zIndex: 9000,
          background: theme.bgSecondary,
          border: '1px solid ' + theme.border,
          borderRadius: 8, boxShadow: '0 8px 24px ' + theme.shadow,
          padding: 8, minWidth: 280
        }}>
          {aiLog.length === 0 && (
            <div style={{ fontSize: 11, color: theme.textMuted, padding: 8, textAlign: 'center' }}>
              Try: "Move groceries to Friday" or "I'm wfh today"
            </div>
          )}
          {aiLog.map(function(entry, i) {
            var isUser = entry.role === 'user';
            var isUnsupported = !isUser && entry.unsupported;
            return (
              <div key={i} style={{
                marginBottom: 4, padding: '5px 8px', borderRadius: 6,
                fontSize: 11, lineHeight: 1.4, maxWidth: '90%',
                background: isUser ? theme.accent : (isUnsupported ? (darkMode ? '#3a2e1a' : '#fff8e6') : theme.badgeBg),
                color: isUser ? 'white' : (isUnsupported ? (darkMode ? '#f0b429' : '#92600a') : theme.text),
                border: isUser ? 'none' : ('1px solid ' + (isUnsupported ? (darkMode ? '#6b4a10' : '#f0c060') : theme.border)),
                marginLeft: isUser ? 'auto' : undefined,
                textAlign: isUser ? 'right' : undefined
              }}>
                {entry.text}
                {!isUnsupported && entry.ops && entry.ops.length > 0 && (
                  <div style={{ fontSize: 9, color: theme.textMuted, marginTop: 2 }}>
                    {entry.ops.length} change{entry.ops.length !== 1 ? 's' : ''} applied
                  </div>
                )}
              </div>
            );
          })}
          {aiLoading && (
            <div style={{ fontSize: 11, color: theme.textMuted, padding: '4px 8px', fontStyle: 'italic' }}>
              Thinking...
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

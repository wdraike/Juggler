/**
 * AiCommandPanel — inline AI input for the header bar with dropdown chat log
 */

import React, { useState, useRef, useEffect } from 'react';
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
  var autoHideRef = useRef(null);
  var logRef = useRef(null);
  var panelRef = useRef(null);

  useEffect(function() {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [aiLog]);

  // Close dropdown on outside click
  useEffect(function() {
    if (!showLog) return;
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setShowLog(false);
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
      if (onApplyOps && data.ops && data.ops.length > 0) onApplyOps(data.ops, data.msg);
      setAiLog(function(prev) { return prev.concat([{ role: 'ai', text: data.msg || 'Done.', ops: data.ops || [] }]); });
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
        title='AI commands \u2014 type "wfh", "office", or natural language like "move groceries to Friday"'
        autoComplete="off" autoCorrect="off" spellCheck="false"
        style={{
          flex: 1, background: darkMode ? '#0F172A' : '#F1F5F9',
          color: darkMode ? '#E8E0D0' : '#1A2B4A',
          border: '1px solid ' + (darkMode ? '#2E4A7A' : '#E8E0D0'),
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
              background: aiLoading ? theme.bgTertiary : '#3B82F6', color: 'white', border: 'none',
              borderRadius: 6, padding: isMobile ? '8px 12px' : '4px 10px', fontSize: 12, fontWeight: 600,
              cursor: aiLoading ? 'wait' : 'pointer', flexShrink: 0, minHeight: isMobile ? 36 : 28
            }}
          >{aiLoading ? '...' : '\u23CE'}</button>
        </>
      )}
      {!aiCmd.trim() && aiLog.length > 0 && (
        <button
          onClick={function(e) { e.stopPropagation(); setShowLog(!showLog); if (autoHideRef.current) clearTimeout(autoHideRef.current); }}
          title={showLog ? 'Hide command history' : 'Show command history'}
          style={{
            background: showLog ? '#3B82F6' : 'transparent', color: showLog ? 'white' : theme.textMuted,
            border: 'none', borderRadius: 6, padding: '4px 6px', fontSize: 12,
            cursor: 'pointer', flexShrink: 0
          }}
        >{'\uD83D\uDCAC'}</button>
      )}

      {/* Dropdown chat log */}
      {showLog && (
        <div ref={logRef} style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          maxHeight: '50vh', overflowY: 'auto', zIndex: 200,
          background: darkMode ? '#0F172A' : '#FFFFFF',
          border: '1px solid ' + (darkMode ? '#334155' : '#CBD5E1'),
          borderRadius: 8, boxShadow: '0 8px 24px ' + (darkMode ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.15)'),
          padding: 8, minWidth: 280
        }}>
          {aiLog.length === 0 && (
            <div style={{ fontSize: 11, color: theme.textMuted, padding: 8, textAlign: 'center' }}>
              Try: "Move groceries to Friday" or "I'm wfh today"
            </div>
          )}
          {aiLog.map(function(entry, i) {
            return (
              <div key={i} style={{
                marginBottom: 4, padding: '5px 8px', borderRadius: 6,
                fontSize: 11, lineHeight: 1.4, maxWidth: '90%',
                background: entry.role === 'user' ? '#3B82F6' : (darkMode ? '#1E293B' : '#F1F5F9'),
                color: entry.role === 'user' ? 'white' : theme.text,
                border: entry.role === 'user' ? 'none' : '1px solid ' + theme.border,
                marginLeft: entry.role === 'user' ? 'auto' : undefined,
                textAlign: entry.role === 'user' ? 'right' : undefined
              }}>
                {entry.text}
                {entry.ops && entry.ops.length > 0 && (
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
        </div>
      )}
    </div>
  );
}

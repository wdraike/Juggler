/**
 * AiCommandPanel — bottom bar with AI chat for natural language task commands
 */

import React, { useState, useRef, useEffect } from 'react';
import { getTheme } from '../../theme/colors';
import { DAY_NAMES } from '../../state/constants';
import apiClient from '../../services/apiClient';

export default function AiCommandPanel({
  darkMode, isMobile, allTasks, statuses, config,
  onApplyOps, showToast
}) {
  var theme = getTheme(darkMode);
  var [showAi, setShowAi] = useState(false);
  var [aiCmd, setAiCmd] = useState('');
  var [aiLog, setAiLog] = useState([]);
  var [aiLoading, setAiLoading] = useState(false);
  var autoHideRef = useRef(null);
  var logRef = useRef(null);

  useEffect(function() {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [aiLog]);

  // Local location shortcut patterns (no API needed)
  function tryLocalCommand(msg) {
    var locWord = null, dayWord = null, dateStr = null;
    // "wfh [day]"
    var wfhMatch = msg.match(/^wfh(?:\s+(?:on\s+)?(?:(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|weekdays?|all week)|([\d]{1,2}\/[\d]{1,2})))?$/i);
    if (wfhMatch) { locWord = 'home'; dayWord = (wfhMatch[1] || '').toLowerCase(); dateStr = wfhMatch[2] || ''; if (!dayWord && !dateStr) dayWord = 'weekdays'; }
    // "in office [day]"
    if (!locWord) {
      var offMatch = msg.match(/^(?:in |at )?office(?:\s+(?:on\s+)?(?:(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|weekdays?|all week)|([\d]{1,2}\/[\d]{1,2})))?$/i);
      if (offMatch) { locWord = 'work'; dayWord = (offMatch[1] || '').toLowerCase(); dateStr = offMatch[2] || ''; if (!dayWord && !dateStr) dayWord = 'weekdays'; }
    }
    // "I'm at home/work on [day]"
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
        // Build a set_block_loc for the date
        ops.push({ op: 'set_date_location', date: dateStr, location: locId });
        return { msg: 'Set ' + dateStr + ' location to ' + locIcon + ' ' + locName, ops: ops, local: true };
      }
      if (dayWord) {
        var dayMap = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
        var targetDays = [];
        if (dayWord === 'weekdays' || dayWord === 'weekday' || dayWord === 'all week') targetDays = ['Mon','Tue','Wed','Thu','Fri'];
        else if (dayMap[dayWord]) targetDays = [dayMap[dayWord]];
        if (targetDays.length > 0) {
          targetDays.forEach(function(dn) {
            ops.push({ op: 'set_weekly', day: dn, location: locId });
          });
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
    setShowAi(true);
    setAiLog(function(prev) { return prev.concat([{ role: 'user', text: text }]); });
    if (autoHideRef.current) clearTimeout(autoHideRef.current);

    // Try local shortcut first
    var local = tryLocalCommand(text);
    if (local) {
      if (onApplyOps) onApplyOps(local.ops, local.msg);
      setAiLog(function(prev) { return prev.concat([{ role: 'ai', text: local.msg, ops: local.ops }]); });
      setAiLoading(false);
      autoHideRef.current = setTimeout(function() { setShowAi(false); }, 10000);
      return;
    }

    // Send to backend Gemini API
    try {
      // Filter to relevant tasks (open/wip + any mentioned by ID)
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
          locations: config.locations,
          tools: config.tools,
          toolMatrix: config.toolMatrix,
          timeBlocks: config.timeBlocks,
          locSchedules: config.locSchedules,
          locScheduleDefaults: config.locScheduleDefaults,
          locScheduleOverrides: config.locScheduleOverrides
        }
      });

      var data = resp.data;
      if (onApplyOps && data.ops && data.ops.length > 0) {
        onApplyOps(data.ops, data.msg);
      }
      setAiLog(function(prev) { return prev.concat([{ role: 'ai', text: data.msg || 'Done.', ops: data.ops || [] }]); });
    } catch (err) {
      var errMsg = (err.response && err.response.data && err.response.data.error) || err.message || 'API call failed';
      setAiLog(function(prev) { return prev.concat([{ role: 'ai', text: 'Error: ' + errMsg }]); });
    }
    setAiLoading(false);
    autoHideRef.current = setTimeout(function() { setShowAi(false); }, 10000);
  };

  return (
    <div style={{
      background: darkMode ? 'linear-gradient(135deg, #0F172A, #1E293B)' : 'linear-gradient(135deg, #1E293B, #334155)',
      borderTop: '1px solid #334155',
      padding: showAi ? '0' : '8px 12px',
      flexShrink: 0
    }}>
      {showAi && (
        <div ref={logRef} style={{ maxHeight: '40vh', overflowY: 'auto', padding: '8px 12px', borderBottom: '1px solid #334155' }}>
          {aiLog.length === 0 && (
            <div style={{ fontSize: 12, color: '#94A3B8', padding: '8px 10px', textAlign: 'center' }}>
              Try: "Mark t01 done" or "Move t93 to Monday at 10am" or "Add a task: call dentist Wed 2pm"
            </div>
          )}
          {aiLog.map(function(entry, i) {
            return (
              <div key={i} style={{
                marginBottom: 6, padding: '6px 10px', borderRadius: 8,
                fontSize: 12, lineHeight: 1.4, maxWidth: '85%',
                background: entry.role === 'user' ? '#3B82F6' : (darkMode ? '#1E293B' : '#334155'),
                color: entry.role === 'user' ? 'white' : '#E2E8F0',
                border: entry.role === 'user' ? 'none' : '1px solid #475569',
                marginLeft: entry.role === 'user' ? 'auto' : undefined,
                textAlign: entry.role === 'user' ? 'right' : undefined
              }}>
                {entry.text}
                {entry.ops && entry.ops.length > 0 && (
                  <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 3 }}>
                    {entry.ops.length} change{entry.ops.length !== 1 ? 's' : ''} applied
                  </div>
                )}
              </div>
            );
          })}
          {aiLoading && (
            <div style={{ fontSize: 11, color: '#94A3B8', padding: '4px 10px', fontStyle: 'italic' }}>
              Thinking...
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: showAi ? '8px 12px' : '0' }}>
        <button
          onClick={function() { if (autoHideRef.current) clearTimeout(autoHideRef.current); setShowAi(!showAi); }}
          style={{
            background: showAi ? '#3B82F6' : '#334155', color: 'white', border: 'none',
            borderRadius: 6, width: 32, height: 32, fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
          }}
        >{showAi ? '\u2715' : '\uD83E\uDD16'}</button>
        <input
          value={aiCmd}
          onChange={function(e) { setAiCmd(e.target.value); }}
          onClick={function(e) { e.stopPropagation(); }}
          onFocus={function(e) { e.stopPropagation(); if (autoHideRef.current) clearTimeout(autoHideRef.current); }}
          onKeyDown={function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder={showAi ? 'Tell me what to do with your tasks...' : 'AI command...'}
          autoComplete="off" autoCorrect="off" spellCheck="false"
          style={{
            flex: 1, background: '#0F172A', color: 'white', border: '1px solid #475569',
            borderRadius: 8, padding: '10px 12px', fontSize: isMobile ? 16 : 14, outline: 'none',
            fontFamily: "'DM Sans', system-ui, sans-serif",
            WebkitAppearance: 'none', minHeight: 44
          }}
        />
        <button
          onClick={function(e) { e.stopPropagation(); handleSend(); }}
          disabled={aiLoading || !aiCmd.trim()}
          style={{
            background: aiLoading ? '#475569' : '#3B82F6', color: 'white', border: 'none',
            borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 600,
            cursor: aiLoading ? 'wait' : 'pointer', flexShrink: 0, minHeight: 44
          }}
        >{aiLoading ? '...' : 'Send'}</button>
      </div>
    </div>
  );
}

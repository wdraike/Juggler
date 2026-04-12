/**
 * SCurveView — S-Curve timeline for a single day.
 * Same header chrome as TimelineView (date, location, progress, recurringTasks, template).
 */

import React, { useRef, useState, useEffect } from 'react';
import SCurveTimeline from '../schedule/SCurveTimeline';
import { getTheme } from '../../theme/colors';
import { MONTH_NAMES, DAY_NAMES_FULL, DAY_NAMES } from '../../state/constants';
import { getLocationForDatePure } from '../../scheduler/locationHelpers';

export default function SCurveView({ selectedDate, selectedDateKey, placements, statuses, onStatusChange, onExpand, darkMode, schedCfg, nowMins, isToday, blockedTaskIds, isMobile, locSchedules, onUpdateLocScheduleOverrides, allTasks, onBatchRecurringsDone }) {
  var theme = getTheme(darkMode);
  var loc = getLocationForDatePure(selectedDateKey, schedCfg);
  var wrapperRef = useRef(null);
  var headerRef = useRef(null);
  var [viewportSize, setViewportSize] = useState(null);

  useEffect(function() {
    function measure() {
      if (!wrapperRef.current) return;
      // Measure the overflow:hidden wrapper (flex-constrained, definite height)
      // and subtract the fixed header to get the available scroll area.
      var wW = wrapperRef.current.clientWidth;
      var wH = wrapperRef.current.clientHeight;
      var hH = headerRef.current ? headerRef.current.offsetHeight : 0;
      var w = wW;
      var h = Math.max(0, wH - hH);
      setViewportSize(function(prev) {
        if (prev && prev.width === w && prev.height === h) return prev;
        return { width: w, height: h };
      });
    }
    measure();
    // ResizeObserver on the wrapper catches ALL size changes (window resize,
    // sidebar toggle, font-size change, etc.)
    var ro = new ResizeObserver(measure);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    // Belt-and-suspenders: also listen for window resize
    window.addEventListener('resize', measure);
    return function() {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Template override state
  var dayName = DAY_NAMES[selectedDate.getDay()];
  var defaultTemplate = (schedCfg.locScheduleDefaults || {})[dayName] || 'weekday';
  var overrideTemplate = (schedCfg.locScheduleOverrides || {})[selectedDateKey];
  var activeTemplate = overrideTemplate || defaultTemplate;
  var isOverridden = !!overrideTemplate;
  var templateEntries = locSchedules ? Object.entries(locSchedules) : [];

  var handleTemplateChange = function(e) {
    var val = e.target.value;
    var overrides = Object.assign({}, schedCfg.locScheduleOverrides || {});
    if (val === defaultTemplate) {
      delete overrides[selectedDateKey];
    } else {
      overrides[selectedDateKey] = val;
    }
    if (onUpdateLocScheduleOverrides) onUpdateLocScheduleOverrides(overrides);
  };

  return (
    <div ref={wrapperRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Fixed header — matches TimelineView exactly */}
      <div ref={headerRef} style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid ' + theme.border, background: theme.bg, flexShrink: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: theme.text }}>
          {DAY_NAMES_FULL[selectedDate.getDay()]}, {MONTH_NAMES[selectedDate.getMonth()]} {selectedDate.getDate()}
        </div>
        <div style={{ fontSize: 12, color: theme.textMuted }}>
          {loc.icon} {loc.name}
        </div>
        {/* Progress bar */}
        {(function() {
          var dayTasks = placements.map(function(p) { return p.task; });
          var total = dayTasks.filter(function(t) { return (statuses[t.id] || '') !== 'cancel' && (statuses[t.id] || '') !== 'skip'; }).length;
          var done = dayTasks.filter(function(t) { return statuses[t.id] === 'done'; }).length;
          var doneDur = dayTasks.filter(function(t) { return statuses[t.id] === 'done'; }).reduce(function(s, t) { return s + (t.dur || 0); }, 0);
          var totalDur = dayTasks.reduce(function(s, t) { return s + (t.dur || 0); }, 0);
          var pct = total > 0 ? Math.round(done / total * 100) : 0;
          return (
            <div title={done + ' of ' + total + ' tasks done (' + Math.round(doneDur / 60 * 10) / 10 + 'h / ' + Math.round(totalDur / 60 * 10) / 10 + 'h)'} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: theme.textMuted }}>
              <div style={{ width: 60, height: 5, background: theme.bgTertiary, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: pct + '%', height: '100%', background: pct >= 100 ? '#2D6A4F' : '#2E4A7A', borderRadius: 3 }} />
              </div>
              <span>{done}/{total}</span>
              <span>({Math.round(doneDur / 60 * 10) / 10}h / {Math.round(totalDur / 60 * 10) / 10}h)</span>
            </div>
          );
        })()}
        {templateEntries.length > 0 && (
          <select
            value={activeTemplate}
            onChange={handleTemplateChange}
            title={isOverridden ? 'Schedule template (overridden for this date)' : 'Schedule template (day default: ' + defaultTemplate + ')'}
            style={{
              fontSize: 11, padding: '2px 4px', borderRadius: 4, cursor: 'pointer',
              background: isOverridden ? theme.accent + '20' : theme.bgCard,
              color: isOverridden ? theme.accent : theme.textMuted,
              border: '1px solid ' + (isOverridden ? theme.accent : theme.border),
              outline: 'none', marginLeft: 4
            }}
          >
            {templateEntries.map(function(entry) {
              var id = entry[0], tmpl = entry[1];
              return (
                <option key={id} value={id}>
                  {(tmpl.icon || '') + ' ' + tmpl.name + (id === defaultTemplate ? ' (default)' : '')}
                </option>
              );
            })}
          </select>
        )}
      </div>
      {/* Scrollable S-Curve timeline */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {viewportSize && <SCurveTimeline
          dateKey={selectedDateKey}
          schedCfg={schedCfg}
          placements={placements}
          statuses={statuses}

          onStatusChange={onStatusChange}
          onExpand={onExpand}
          darkMode={darkMode}
          nowMins={nowMins}
          isToday={isToday}
          blockedTaskIds={blockedTaskIds}
          isMobile={isMobile}
          viewportWidth={viewportSize.width}
          viewportHeight={viewportSize.height}
        />}
      </div>
    </div>
  );
}

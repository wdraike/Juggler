import React from 'react';
import CollapsibleSection from '../CollapsibleSection';
import { getTimezoneAbbr, getUtcOffset } from '../../../utils/timezone';

var ALL_TIMEZONES = (function() {
  try {
    if (typeof Intl !== 'undefined' && Intl.supportedValuesOf) return Intl.supportedValuesOf('timeZone');
  } catch (e) { /* ignore */ }
  return [
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Anchorage', 'America/Phoenix', 'Pacific/Honolulu',
    'America/Toronto', 'America/Vancouver', 'America/Edmonton', 'America/Halifax',
    'America/Mexico_City', 'America/Bogota', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
    'Europe/Amsterdam', 'Europe/Moscow', 'Europe/Istanbul',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Kolkata', 'Asia/Dubai',
    'Asia/Singapore', 'Asia/Seoul', 'Asia/Bangkok',
    'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth',
    'Pacific/Auckland', 'Pacific/Fiji',
    'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos',
  ];
})();

export function addMinutesTo24h(hhmm, mins) {
  if (!hhmm) return '';
  var parts = String(hhmm).split(':');
  var h = parseInt(parts[0], 10); if (isNaN(h)) return '';
  var m = parseInt(parts[1], 10); if (isNaN(m)) m = 0;
  var total = h * 60 + m + (Number(mins) || 0);
  if (total < 0) total = 0;
  if (total > 23 * 60 + 59) total = 23 * 60 + 59;
  var nh = Math.floor(total / 60), nm = total % 60;
  return (nh < 10 ? '0' : '') + nh + ':' + (nm < 10 ? '0' : '') + nm;
}

export function minutesFrom24h(hhmm) {
  if (!hhmm) return null;
  var parts = String(hhmm).split(':');
  var h = parseInt(parts[0], 10); if (isNaN(h)) return null;
  var m = parseInt(parts[1], 10); if (isNaN(m)) m = 0;
  return h * 60 + m;
}

function TimezoneSelector({ taskTz, onChangeTz, TH }) {
  var [tzSearch, setTzSearch] = React.useState('');
  var [tzOpen, setTzOpen] = React.useState(false);
  var dropdownRef = React.useRef(null);

  React.useEffect(function() {
    if (!tzOpen) return;
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setTzOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return function() { document.removeEventListener('mousedown', handleClick); };
  }, [tzOpen]);

  var searchLower = tzSearch.toLowerCase();
  var filteredTzs = searchLower
    ? ALL_TIMEZONES.filter(function(tz) { return tz.toLowerCase().includes(searchLower); })
    : ALL_TIMEZONES;
  var displayTzs = filteredTzs.slice(0, 50);

  function selectTz(tz) {
    onChangeTz(tz);
    setTzOpen(false);
    setTzSearch('');
  }

  var tzAbbr = getTimezoneAbbr(taskTz);
  var utcOff = getUtcOffset(taskTz);

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={function() { setTzOpen(!tzOpen); setTzSearch(''); }}
        style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
          border: '1px solid ' + TH.inputBorder, background: TH.inputBg, color: TH.text,
          fontFamily: 'inherit', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4
        }}
      >
        {'🌐'} {tzAbbr} <span style={{ fontSize: 9, color: TH.textMuted, fontFamily: 'monospace' }}>{utcOff}</span> {'▾'}
      </button>
      {tzOpen && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, zIndex: 200, width: 280,
          background: TH.bgCard, border: '1px solid ' + TH.inputBorder, borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
        }}>
          <div style={{ padding: 6 }}>
            <input
              type="text" autoFocus
              value={tzSearch}
              placeholder="Search timezones..."
              onChange={function(e) { setTzSearch(e.target.value); }}
              style={{
                width: '100%', fontSize: 12, padding: '5px 8px',
                border: '1px solid ' + TH.inputBorder, borderRadius: 4,
                background: TH.inputBg, color: TH.text, boxSizing: 'border-box'
              }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {displayTzs.length === 0 && (
              <div style={{ padding: '8px 10px', fontSize: 11, color: TH.textMuted }}>No timezones match</div>
            )}
            {displayTzs.map(function(tz) {
              var off = getUtcOffset(tz);
              var isSelected = tz === taskTz;
              return (
                <div key={tz}
                  onClick={function() { selectTz(tz); }}
                  style={{
                    padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                    background: isSelected ? TH.accent + '22' : 'transparent',
                    color: TH.text,
                    borderBottom: '1px solid ' + TH.inputBorder + '33',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}
                  onMouseEnter={function(e) { e.currentTarget.style.background = TH.accent + '15'; }}
                  onMouseLeave={function(e) { e.currentTarget.style.background = isSelected ? TH.accent + '22' : 'transparent'; }}
                >
                  <span style={{ fontWeight: isSelected ? 600 : 400 }}>{tz.replace(/_/g, ' ')}</span>
                  <span style={{ fontSize: 10, color: TH.textMuted, fontFamily: 'monospace' }}>{off}</span>
                </div>
              );
            })}
            {filteredTzs.length > 50 && (
              <div style={{ padding: '6px 10px', fontSize: 10, color: TH.textMuted, textAlign: 'center' }}>
                Type to narrow {filteredTzs.length} results...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function WhenSection(props) {
  var {
    date, onDateChange,
    time, onTimeChange,
    endTime, onEndTimeChange, endTimeError,
    dur, onDurChange,
    recurring, rigid, onRigidChange,
    timeFlex, onTimeFlexChange,
    recurType, onRecurTypeChange,
    recurDays, onRecurDaysChange,
    recurEvery, onRecurEveryChange,
    recurTpc, onRecurTpcChange,
    recurStart, onRecurStartChange,
    recurEnd, onRecurEndChange,
    deadline, onDeadlineChange,
    startAfter, onStartAfterChange,
    split, onSplitChange,
    splitMin, onSplitMinChange,
    travelBefore, onTravelBeforeChange,
    travelAfter, onTravelAfterChange,
    marker, onMarkerChange,
    flexWhen, onFlexWhenChange,
    datePinned, onDatePinnedChange,
    dayReq, onDayReqChange,
    when, onWhenChange,
    timeRemaining, onTimeRemainingChange,
    taskTz, onChangeTz,
    task, isCreate, isMobile, TH,
    scheduleTemplates, templateDefaults,
    uniqueTags,
    collapse, toggleCollapse,
  } = props;

  var BTN_H = isMobile ? 30 : 26;
  var iStyle = {
    fontSize: isMobile ? 13 : 11, padding: isMobile ? '6px 8px' : '3px 4px',
    border: '1px solid ' + TH.inputBorder, borderRadius: 4,
    background: TH.inputBg, color: TH.inputText, fontFamily: 'inherit',
    height: BTN_H, boxSizing: 'border-box', maxWidth: '100%'
  };
  var lStyle = { fontSize: 9, color: TH.textMuted, display: 'flex', flexDirection: 'column', gap: 2, fontWeight: 600 };
  function togStyle(on, color) {
    return {
      height: BTN_H, padding: '0 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
      fontWeight: on ? 600 : 400, fontFamily: 'inherit', boxSizing: 'border-box',
      border: on ? '2px solid ' + (color || TH.accent) : '1px solid ' + TH.btnBorder,
      background: on ? (color || TH.accent) + '22' : TH.bgCard,
      color: on ? (color || TH.accent) : TH.textMuted,
    };
  }

  var isRecurring = !!recurring;

  var tier1 = (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 }}>
        <label style={lStyle}>
          Date
          <input type="date" value={date} onChange={e => onDateChange(e.target.value)}
            style={{ ...iStyle, width: 130 }} />
        </label>
        <label style={lStyle}>
          Start
          <input type="time" value={time} onChange={e => {
            onTimeChange(e.target.value);
            if (e.target.value && dur) onEndTimeChange(addMinutesTo24h(e.target.value, dur));
          }} style={{ ...iStyle, width: 90 }} />
        </label>
        <label style={lStyle}>
          End
          <input type="time" value={endTime} onChange={e => {
            onEndTimeChange(e.target.value);
            if (e.target.value && time) {
              var startMins = minutesFrom24h(time);
              var endMins = minutesFrom24h(e.target.value);
              if (startMins !== null && endMins !== null && endMins > startMins) {
                onDurChange(endMins - startMins);
              }
            }
          }} style={{ ...iStyle, width: 90 }} />
        </label>
        <label style={lStyle}>
          Duration
          <input type="number" min={1} value={dur} onChange={e => {
            var v = Math.max(1, parseInt(e.target.value, 10) || 1);
            onDurChange(v);
            if (time) onEndTimeChange(addMinutesTo24h(time, v));
          }} style={{ ...iStyle, width: 65 }} />
        </label>
      </div>
      {endTimeError && <div style={{ fontSize: 9, color: TH.amberText, marginBottom: 4 }}>{endTimeError}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
        <TimezoneSelector taskTz={taskTz} onChangeTz={onChangeTz} TH={TH} />
        <button onClick={() => onRigidChange(!rigid)} style={{ ...togStyle(rigid, '#2D6A4F'), fontSize: 9 }}>
          {rigid ? '📌 Fixed' : '🔀 Float'}
        </button>
      </div>
    </div>
  );

  var recurBadge = recurType && recurType !== 'none' ? recurType.charAt(0).toUpperCase() + recurType.slice(1) : 'none';
  var tier2 = (
    <CollapsibleSection
      id="when_recurrence" label="Recurrence"
      isOpen={!!collapse.when_recurrence}
      onToggle={toggleCollapse}
      badge={recurBadge}
      TH={TH}
    >
      <div>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 6 }}>
          {['none', 'daily', 'weekly', 'weekdays', 'custom'].map(function(rt) {
            return (
              <button key={rt} onClick={() => onRecurTypeChange(rt)} style={togStyle(recurType === rt)}>
                {rt.charAt(0).toUpperCase() + rt.slice(1)}
              </button>
            );
          })}
        </div>
        {recurType !== 'none' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={lStyle}>
              Every
              <input type="number" min={1} value={recurEvery} onChange={e => onRecurEveryChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
                style={{ ...iStyle, width: 55 }} />
            </label>
            <label style={lStyle}>
              Times/cycle
              <input type="number" min={1} value={recurTpc} onChange={e => onRecurTpcChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
                style={{ ...iStyle, width: 55 }} />
            </label>
            <label style={lStyle}>
              Start
              <input type="date" value={recurStart} onChange={e => onRecurStartChange(e.target.value)}
                style={{ ...iStyle, width: 130 }} />
            </label>
            <label style={lStyle}>
              End
              <input type="date" value={recurEnd} onChange={e => onRecurEndChange(e.target.value)}
                style={{ ...iStyle, width: 130 }} />
            </label>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );

  var constraintsBadge = deadline ? 'deadline set' : '';
  var tier3 = (
    <CollapsibleSection
      id="when_constraints" label="Constraints"
      isOpen={!!collapse.when_constraints}
      onToggle={toggleCollapse}
      badge={constraintsBadge}
      TH={TH}
    >
      <div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 }}>
          <label style={lStyle}>
            Deadline
            <input type="date" value={deadline} onChange={e => onDeadlineChange(e.target.value)}
              style={{ ...iStyle, width: 130 }} />
          </label>
          <label style={lStyle}>
            Start after
            <input type="date" value={startAfter} onChange={e => onStartAfterChange(e.target.value)}
              style={{ ...iStyle, width: 130 }} />
          </label>
        </div>
        {!marker && !isRecurring && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 }}>
            <label style={lStyle}>
              Travel before (min)
              <input type="number" min={0} value={travelBefore} onChange={e => onTravelBeforeChange(parseInt(e.target.value, 10) || 0)}
                style={{ ...iStyle, width: 80 }} />
            </label>
            <label style={lStyle}>
              Travel after (min)
              <input type="number" min={0} value={travelAfter} onChange={e => onTravelAfterChange(parseInt(e.target.value, 10) || 0)}
                style={{ ...iStyle, width: 80 }} />
            </label>
          </div>
        )}
        {!marker && !isRecurring && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ ...lStyle, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <input type="checkbox" checked={!!split} onChange={e => onSplitChange(e.target.checked)} />
              Allow split
            </label>
            {split && (
              <label style={lStyle}>
                Min chunk (min)
                <input type="number" min={5} value={splitMin} onChange={e => onSplitMinChange(parseInt(e.target.value, 10) || 15)}
                  style={{ ...iStyle, width: 65 }} />
              </label>
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );

  return (
    <div>
      {tier1}
      {tier2}
      {tier3}
    </div>
  );
}

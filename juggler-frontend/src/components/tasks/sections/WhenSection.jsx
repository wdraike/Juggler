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
          position: 'absolute', top: '100%', left: 0, zIndex: 200, width: 280,
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
    endTime, onEndTimeChange, endTimeError, onEndTimeErrorChange,
    dur, onDurChange,
    recurring, rigid, onRigidChange,
    timeFlex, onTimeFlexChange,
    hasPreferredTime, onHasPreferredTimeChange,
    recurType, onRecurTypeChange,
    recurDays, onRecurDaysChange,
    recurEvery, onRecurEveryChange,
    recurTpc, onRecurTpcChange,
    recurFillPolicy, onRecurFillPolicyChange,
    recurUnit, onRecurUnitChange,
    recurMonthDays, onRecurMonthDaysChange,
    recurStart, onRecurStartChange,
    recurEnd, onRecurEndChange,
    recurIsAnchorDependent,
    configWarnings,
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

  function FillPolicyBlock(cycleLabel) {
    return (
      <div style={{ marginTop: 6, paddingLeft: 6, borderLeft: '2px solid ' + TH.border, fontSize: 11 }}>
        <div style={{ fontSize: 10, color: TH.textMuted, marginBottom: 3 }}>When you skip or miss a session:</div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 4, cursor: 'pointer', marginBottom: 2 }}>
          <input type="radio" checked={recurFillPolicy !== 'backfill'} onChange={function() { onRecurFillPolicyChange('keep'); }} style={{ marginTop: 2 }} />
          <span><strong>Keep the schedule</strong><span style={{ color: TH.textMuted, fontSize: 10 }}> — skipped sessions stay skipped; the {cycleLabel}'s count may end below the target.</span></span>
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 4, cursor: 'pointer' }}>
          <input type="radio" checked={recurFillPolicy === 'backfill'} onChange={function() { onRecurFillPolicyChange('backfill'); }} style={{ marginTop: 2 }} />
          <span><strong>Backfill missed slots</strong><span style={{ color: TH.textMuted, fontSize: 10 }}> — the scheduler picks a new date to replace each skipped session.</span></span>
        </label>
      </div>
    );
  }

  var isRecurring = !!recurring;
  var whenPartsLocal = when ? when.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
  var isAllDay = whenPartsLocal.indexOf('allday') !== -1;
  var isFixed = !!datePinned || whenPartsLocal.indexOf('fixed') !== -1;
  var activeTags = whenPartsLocal.filter(function(p) { return p !== 'anytime' && p !== 'allday' && p !== 'fixed'; });
  var isWindows = activeTags.length > 0;
  var isAnytime = !isAllDay && !isFixed && !isWindows;
  var isAnytimeMode = !hasPreferredTime && activeTags.length === 0;
  var isBlocksMode = !hasPreferredTime && activeTags.length > 0;

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
            if (onEndTimeErrorChange) onEndTimeErrorChange(null);
            if (e.target.value && dur) onEndTimeChange(addMinutesTo24h(e.target.value, dur));
          }} style={{ ...iStyle, width: 90 }} />
        </label>
        <label style={lStyle}>
          End
          <input type="time" value={endTime} onChange={e => {
            var v = e.target.value;
            onEndTimeChange(v);
            if (v && time) {
              var startMins = minutesFrom24h(time);
              var endMins = minutesFrom24h(v);
              if (startMins !== null && endMins !== null && endMins > startMins) {
                if (onEndTimeErrorChange) onEndTimeErrorChange(null);
                onDurChange(endMins - startMins);
              } else if (startMins !== null && endMins !== null) {
                if (onEndTimeErrorChange) onEndTimeErrorChange('Finish must be after start');
              } else {
                if (onEndTimeErrorChange) onEndTimeErrorChange(null);
              }
            } else {
              if (onEndTimeErrorChange) onEndTimeErrorChange(null);
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

      {!marker && !isRecurring && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 9, color: TH.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, opacity: isFixed ? 0.4 : 1 }}>Scheduling mode</div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 8, opacity: isFixed ? 0.35 : 1, pointerEvents: isFixed ? 'none' : undefined }}>
            <button title="No time restriction — the scheduler can place this in any available slot"
              onClick={function() { onDatePinnedChange(false); onWhenChange(''); }}
              style={togStyle(isAnytime, '#2D6A4F')}>🔄 Anytime</button>
            <button title="Spans the entire day"
              onClick={function() { onDatePinnedChange(false); onWhenChange('allday'); onSplitChange(false); onTravelBeforeChange(0); onTravelAfterChange(0); }}
              style={togStyle(isAllDay, '#C8942A')}>☀️ All Day</button>
          </div>
          <div style={{ fontSize: 9, color: TH.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, opacity: isFixed ? 0.4 : 1 }}>Preferred time windows</div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 6, opacity: isFixed ? 0.35 : 1, pointerEvents: isFixed ? 'none' : undefined }}>
            {(uniqueTags || []).map(function(tb) {
              var isOn = activeTags.indexOf(tb.tag) !== -1;
              return (
                <button key={tb.tag}
                  title={isAllDay ? tb.name + ' time window — clicking will switch out of All Day mode' : tb.name + ' time window — selecting any window disables Anytime'}
                  onClick={function() {
                    if (isAllDay) {
                      onDatePinnedChange(false);
                      onWhenChange(tb.tag);
                    } else {
                      var cur = activeTags.slice();
                      if (isOn) { cur = cur.filter(function(v) { return v !== tb.tag; }); }
                      else { cur.push(tb.tag); }
                      onWhenChange(cur.length === 0 ? '' : cur.join(','));
                    }
                  }} style={{ ...togStyle(isOn && !isAllDay, tb.color), opacity: isAllDay ? 0.55 : 1 }}>
                  {tb.icon} {tb.name}
                </button>
              );
            })}
            {isWindows && (
              <>
                <span style={{ width: 1, height: 18, background: TH.border, margin: '0 2px' }} />
                <button title={flexWhen ? 'Flex: scheduler tries other slots if selected windows are full' : 'Strict: only placed in selected windows'}
                  onClick={function() { onFlexWhenChange(!flexWhen); }}
                  style={togStyle(flexWhen, '#C8942A')}>
                  {flexWhen ? '~ Flex' : 'Strict'}
                </button>
              </>
            )}
          </div>
          {!isFixed && (
            <label style={{ ...lStyle, marginBottom: 5 }}>
              <span title="Restrict which days the scheduler can place this task.">Day requirement</span>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                <button title="No day restriction" onClick={function() { onDayReqChange('any'); }} style={togStyle(dayReq === 'any', '#2D6A4F')}>Any</button>
                <button title="Monday through Friday only" onClick={function() { onDayReqChange(dayReq === 'weekday' ? 'any' : 'weekday'); }} style={togStyle(dayReq === 'weekday', '#4338CA')}>Wkday</button>
                <button title="Saturday or Sunday only" onClick={function() { onDayReqChange(dayReq === 'weekend' ? 'any' : 'weekend'); }} style={togStyle(dayReq === 'weekend', '#4338CA')}>Wkend</button>
                {[['Su','Su'],['M','Mo'],['T','Tu'],['W','We'],['R','Th'],['F','Fr'],['Sa','Sa']].map(function(pair) {
                  var code = pair[0], label = pair[1];
                  var selected = dayReq ? dayReq.split(',') : [];
                  var isOn = selected.indexOf(code) >= 0;
                  return (
                    <button key={code} title={({Su:'Sunday',M:'Monday',T:'Tuesday',W:'Wednesday',R:'Thursday',F:'Friday',Sa:'Saturday'})[code]}
                      onClick={function() {
                        var cur = dayReq && dayReq !== 'any' && dayReq !== 'weekday' && dayReq !== 'weekend' ? dayReq.split(',') : [];
                        if (isOn) { cur = cur.filter(function(v) { return v !== code; }); }
                        else { cur.push(code); }
                        onDayReqChange(cur.length === 0 ? 'any' : cur.join(','));
                      }}
                      style={togStyle(isOn)}>{label}</button>
                  );
                })}
              </div>
            </label>
          )}
        </div>
      )}

      {recurring && !marker && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
            <button onClick={function() {
              onHasPreferredTimeChange(false);
              onTimeChange('');
              onRigidChange(false);
              onWhenChange('');
            }} style={togStyle(isAnytimeMode, '#2D6A4F')}>🔄 Anytime</button>
            <button onClick={function() {
              onHasPreferredTimeChange(true);
              if (activeTags.length !== 1) onWhenChange('morning');
            }} style={togStyle(hasPreferredTime, '#C8942A')}>⏰ Time window</button>
            <button onClick={function() {
              onHasPreferredTimeChange(false);
              onTimeChange('');
              onRigidChange(false);
              if (activeTags.length <= 1) onWhenChange('morning,lunch,afternoon,evening,night');
            }} style={togStyle(isBlocksMode, '#4338CA')}>📅 Time blocks</button>
          </div>

          {hasPreferredTime ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={lStyle}>
                ⏰ Time
                <input type="time" value={time || ''} onChange={function(e) { onTimeChange(e.target.value || ''); }}
                  style={{ ...iStyle, minWidth: 90 }} />
              </label>
              <label style={lStyle}>
                ± Window
                <select value={rigid ? 0 : (timeFlex || 60)} onChange={function(e) {
                  var v = parseInt(e.target.value);
                  if (v === 0) { onRigidChange(true); onTimeFlexChange(0); } else { onRigidChange(false); onTimeFlexChange(v); }
                }} style={{ ...iStyle, minWidth: 80 }}>
                  <option value={0}>exact</option>
                  <option value={15}>±15m</option>
                  <option value={30}>±30m</option>
                  <option value={60}>±1hr</option>
                  <option value={90}>±1.5hr</option>
                  <option value={120}>±2hr</option>
                </select>
              </label>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
              {(uniqueTags || []).map(function(tb) {
                var isOn = activeTags.indexOf(tb.tag) !== -1;
                return (
                  <button key={tb.tag} title={tb.name + ' time window'} onClick={function() {
                    var cur = activeTags.slice();
                    if (isOn) { cur = cur.filter(function(v) { return v !== tb.tag; }); } else { cur.push(tb.tag); }
                    onWhenChange(cur.length === 0 ? '' : cur.join(','));
                  }} style={togStyle(isOn, tb.color)}>{tb.icon} {tb.name}</button>
                );
              })}
            </div>
          )}
        </div>
      )}
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          <label style={lStyle}>
            <span title="Automatically generate copies of this task on a schedule.">🔁 Recurrence</span>
            <select value={recurType} onChange={function(e) { onRecurTypeChange(e.target.value); }} style={{ ...iStyle, width: 'auto' }}>
              <option value="none">None</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly (pick days)</option>
              <option value="interval">Every N (days/wks/mo/yr)</option>
            </select>
          </label>

          {(recurType === 'weekly' || recurType === 'biweekly') && (function() {
            var selectedCount = recurDays ? recurDays.length : 0;
            return (
              <label style={lStyle}>
                Days
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button onClick={function() { onRecurDaysChange('MTWRF'); }} style={togStyle(recurDays === 'MTWRF', '#4338CA')}>Wkday</button>
                  <button onClick={function() { onRecurDaysChange('SU'); }} style={togStyle(recurDays === 'SU' || recurDays === 'US', '#4338CA')}>Wkend</button>
                  <span style={{ width: 1, height: 18, background: TH.border, margin: '0 1px' }} />
                  {[['U','Su'],['M','Mo'],['T','Tu'],['W','We'],['R','Th'],['F','Fr'],['S','Sa']].map(function(pair) {
                    var code = pair[0], label = pair[1];
                    var active = recurDays && recurDays.includes(code);
                    return (
                      <button key={code} onClick={function() {
                        onRecurDaysChange(active ? (recurDays || '').replace(code, '') : (recurDays || '') + code);
                      }} style={togStyle(active)}>{label}</button>
                    );
                  })}
                </div>
                {selectedCount > 1 && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: TH.textMuted }}>Times per {recurType === 'biweekly' ? '2 weeks' : 'week'}:</span>
                    <select value={recurTpc || selectedCount} onChange={function(e) { onRecurTpcChange(parseInt(e.target.value)); }}
                      style={{ ...iStyle, width: 'auto', minWidth: 50 }}>
                      {Array.from({ length: selectedCount }, function(_, i) { return i + 1; }).map(function(n) {
                        return <option key={n} value={n}>{n}{n === selectedCount ? ' (all)' : ''}</option>;
                      })}
                    </select>
                    {(recurTpc > 0 && recurTpc < selectedCount) && (
                      <span style={{ fontSize: 9, color: '#C8942A' }}>≈every {Math.round((recurType === 'biweekly' ? 14 : 7) / recurTpc * 10) / 10} days</span>
                    )}
                  </div>
                )}
                {(recurTpc > 0 && recurTpc < selectedCount) && FillPolicyBlock('week')}
              </label>
            );
          })()}

          {recurType === 'monthly' && (function() {
            var mdArr = Array.isArray(recurMonthDays) ? recurMonthDays : Object.keys(recurMonthDays || {});
            var mdCount = mdArr.length;
            return (
              <label style={lStyle}>
                Days of month
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, maxWidth: 260 }}>
                  {[['first', '1st'], ['last', 'Last']].concat(
                    Array.from({ length: 28 }, function(_, i) { return [String(i + 1), String(i + 1)]; })
                  ).map(function(pair) {
                    var val = pair[0], lab = pair[1];
                    var active = mdArr.indexOf(val) >= 0 || mdArr.indexOf(Number(val)) >= 0;
                    return (
                      <button key={val} onClick={function() {
                        var arr = Array.isArray(recurMonthDays) ? recurMonthDays : Object.keys(recurMonthDays || {});
                        var norm = arr.map(String);
                        var sv = String(val);
                        onRecurMonthDaysChange(norm.indexOf(sv) >= 0 ? arr.filter(function(d) { return String(d) !== sv; }) : arr.concat([val]));
                      }} style={{ ...togStyle(active), minWidth: lab.length > 2 ? 32 : 22, fontSize: 9 }}>{lab}</button>
                    );
                  })}
                </div>
                {mdCount > 1 && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: TH.textMuted }}>Times per month:</span>
                    <select value={recurTpc || mdCount} onChange={function(e) { onRecurTpcChange(parseInt(e.target.value)); }}
                      style={{ ...iStyle, width: 'auto', minWidth: 50 }}>
                      {Array.from({ length: mdCount }, function(_, i) { return i + 1; }).map(function(n) {
                        return <option key={n} value={n}>{n}{n === mdCount ? ' (all)' : ''}</option>;
                      })}
                    </select>
                    {(recurTpc > 0 && recurTpc < mdCount) && (
                      <span style={{ fontSize: 9, color: '#C8942A' }}>≈every {Math.round(30 / recurTpc * 10) / 10} days</span>
                    )}
                  </div>
                )}
                {(recurTpc > 0 && recurTpc < mdCount) && FillPolicyBlock('month')}
              </label>
            );
          })()}

          {recurType === 'interval' && (
            <label style={lStyle}>
              Interval
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, color: TH.text }}>Every</span>
                <input type="number" value={recurEvery} onChange={function(e) { onRecurEveryChange(e.target.value); }} min={1}
                  style={{ ...iStyle, width: 50 }} />
                <select value={recurUnit} onChange={function(e) { onRecurUnitChange(e.target.value); }} style={{ ...iStyle, width: 'auto' }}>
                  <option value="days">day(s)</option>
                  <option value="weeks">week(s)</option>
                  <option value="months">month(s)</option>
                  <option value="years">year(s)</option>
                </select>
              </div>
            </label>
          )}
        </div>

        {!!recurring && recurType !== 'none' && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
            <label style={lStyle}>
              <span title={recurIsAnchorDependent ? 'Required for biweekly, interval, or times-per-cycle patterns — the scheduler measures cycles from this date.' : 'Date to start generating instances for this recurring task'}>
                ⏯ Recurrence starts{recurIsAnchorDependent && <span style={{ color: TH.redText, marginLeft: 2 }}>*</span>}
              </span>
              <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                <input type="date" value={recurStart || ''} onChange={function(e) { onRecurStartChange(e.target.value || ''); }}
                  style={{ ...iStyle, width: 130 }} required={recurIsAnchorDependent} />
                {recurStart && !recurIsAnchorDependent && (
                  <button onClick={function() { onRecurStartChange(''); }} style={{ fontSize: 9, background: 'none', border: 'none', color: TH.redText, cursor: 'pointer', padding: 0, fontWeight: 700 }}>✕</button>
                )}
              </div>
            </label>
            <label style={lStyle}>
              <span title="Date to stop generating new instances">⏹ Recurrence ends</span>
              <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                <input type="date" value={recurEnd || ''} onChange={function(e) { onRecurEndChange(e.target.value || ''); }}
                  style={{ ...iStyle, width: 130 }} />
                {recurEnd && (
                  <button onClick={function() { onRecurEndChange(''); }} style={{ fontSize: 9, background: 'none', border: 'none', color: TH.redText, cursor: 'pointer', padding: 0, fontWeight: 700 }}>✕</button>
                )}
              </div>
            </label>
          </div>
        )}

        {configWarnings && configWarnings.length > 0 && (
          <div style={{ background: TH.amberBg, border: '1px solid ' + TH.amberBorder, borderRadius: 4, padding: '4px 8px', marginTop: 5, fontSize: 10, color: TH.amberText, lineHeight: 1.4 }}>
            {configWarnings.map(function(w, i) { return <div key={i}>⚠️ {w}</div>; })}
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

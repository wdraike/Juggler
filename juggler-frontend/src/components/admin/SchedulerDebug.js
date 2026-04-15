/**
 * SchedulerDebug — Admin-only waterfall visualization
 *
 * Shows the scheduler's decision process phase-by-phase:
 * each phase adds/moves colored blocks on a time grid.
 * Click any block to see full task details.
 *
 * Access: /admin/scheduler-debug (hidden route)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import apiClient from '../../services/apiClient';

const PHASE_COLORS = {
  fixed: '#E53935',
  recurring: '#F9A825',
  deadline: '#1E88E5',
  flexRecurring: '#AB47BC',
  flexible: '#43A047',
  marker: '#78909C',
};

const GRID_START = 6;
const GRID_END = 23;
const MINS_PER_HOUR = 60;
const TOTAL_MINS = (GRID_END - GRID_START) * MINS_PER_HOUR;
const PX_PER_MIN = 1.8;
const COL_WIDTH = 90;

function formatTime(mins) {
  var h = Math.floor(mins / 60);
  var m = mins % 60;
  var ampm = h >= 12 ? 'p' : 'a';
  var h12 = h % 12 || 12;
  return h12 + (m > 0 ? ':' + (m < 10 ? '0' : '') + m : '') + ampm;
}

function parseDateKey(dk) {
  var parts = dk.split('/');
  return new Date(2026, parseInt(parts[0]) - 1, parseInt(parts[1]));
}

var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Detail Panel ─────────────────────────────────────────────────

function DetailPanel({ item, onClose }) {
  if (!item) return null;
  var bg = PHASE_COLORS[item.type] || '#555';

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 340, height: '100vh',
      background: '#0d1b2a', borderLeft: '2px solid #C8942A', zIndex: 1000,
      overflow: 'auto', padding: 20, boxShadow: '-4px 0 20px rgba(0,0,0,0.5)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 14, height: 14, background: bg, borderRadius: 3, display: 'inline-block' }} />
          <span style={{ fontSize: 10, color: '#8899aa', textTransform: 'uppercase', letterSpacing: 1 }}>{item.type}</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#667', fontSize: 18, cursor: 'pointer' }}>&times;</button>
      </div>

      <h2 style={{ margin: '0 0 4px', fontSize: 16, color: '#E8E0D0', fontWeight: 600 }}>{item.text}</h2>
      <div style={{ fontSize: 11, color: '#667', marginBottom: 16 }}>{item.id}</div>

      <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '6px 12px', fontSize: 12 }}>
        <Row label="Time" value={formatTime(item.start) + ' \u2013 ' + formatTime(item.start + item.dur)} />
        <Row label="Duration" value={item.dur + 'm'} />
        <Row label="Priority" value={item.pri} highlight={item.pri === 'P1'} />
        {item.preferredTime && <Row label="Preferred" value={item.preferredTime + (item.timeFlex ? ' (\u00b1' + item.timeFlex + 'm)' : ' (\u00b160m default)')} />}
        {item.deadline && <Row label="Deadline" value={item.deadline} highlight />}
        {item.project && <Row label="Project" value={item.project} />}
        {item.when && <Row label="When" value={item.when} />}
        {item.dayReq && item.dayReq !== 'any' && <Row label="Day Req" value={item.dayReq} />}
        {item.startAfter && <Row label="Start After" value={item.startAfter} />}
        {item.location && item.location.length > 0 && <Row label="Location" value={item.location.join(', ')} />}
        {item.tools && item.tools.length > 0 && <Row label="Tools" value={item.tools.join(', ')} />}
        {item.split && <Row label="Split" value={item.splitPart ? ('Part ' + item.splitPart + '/' + item.splitTotal) : 'Yes'} />}
        {item.flexWhen && <Row label="Flex When" value="Yes" />}
        {item.datePinned && <Row label="Date Pinned" value="Yes" />}
        <Row label="Locked" value={item.locked ? 'Yes' : 'No'} />
        {item.recurring && <Row label="Recurring" value={item.rigid ? 'Rigid' : 'Flexible'} />}
      </div>

      {item.dependsOn && item.dependsOn.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10, color: '#8899aa', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Dependencies</div>
          {item.dependsOn.map(function(dep, i) {
            return <div key={i} style={{ fontSize: 12, color: '#cba', marginBottom: 2 }}>{'\u2192 '}{dep}</div>;
          })}
        </div>
      )}

      {(item._conflict || item._whenRelaxed || item._moveReason) && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 10, color: '#8899aa', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Flags</div>
          {item._conflict && <Flag text="Conflict \u2014 overlaps with another task" color="#ff0" />}
          {item._whenRelaxed && <Flag text="When-window relaxed \u2014 preferred blocks were full" color="#AB47BC" />}
          {item._moveReason && <Flag text={'\u2192 ' + item._moveReason} color="#C8942A" />}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, highlight }) {
  return (
    <>
      <div style={{ color: '#667' }}>{label}</div>
      <div style={{ color: highlight ? '#F9A825' : '#E8E0D0' }}>{value}</div>
    </>
  );
}

function Flag({ text, color }) {
  return <div style={{ fontSize: 11, color: color, marginBottom: 3 }}>{text}</div>;
}

// ─── Day Column ───────────────────────────────────────────────────

function DayColumn({ dateKey, items, isToday, onSelect, selectedId }) {
  var d = parseDateKey(dateKey);
  var dayName = DAY_NAMES[d.getDay()];
  var isWeekend = d.getDay() === 0 || d.getDay() === 6;

  return (
    <div style={{
      position: 'relative', width: COL_WIDTH, minHeight: TOTAL_MINS * PX_PER_MIN,
      borderRight: '1px solid ' + (isWeekend ? '#1a2540' : '#2a3a5a'), flexShrink: 0,
      background: isToday ? 'rgba(200,148,42,0.05)' : isWeekend ? 'rgba(0,0,0,0.15)' : 'transparent'
    }}>
      <div style={{
        textAlign: 'center', fontSize: 10, padding: '3px 0',
        color: isToday ? '#F9A825' : isWeekend ? '#556' : '#8899aa',
        fontWeight: isToday ? 700 : 400, borderBottom: '1px solid #2a3a5a',
        position: 'sticky', top: 0, background: isToday ? '#121e30' : '#0d1b2a', zIndex: 2
      }}>
        <div>{dayName}</div>
        <div style={{ fontSize: 9 }}>{dateKey}</div>
      </div>
      {(items || []).map(function(item, i) {
        var top = (item.start - GRID_START * 60) * PX_PER_MIN;
        var height = Math.max(item.dur * PX_PER_MIN, 10);
        var bg = PHASE_COLORS[item.type] || '#555';
        var isSelected = selectedId && item.id === selectedId;
        return (
          <div key={i} onClick={function() { onSelect(item); }} style={{
            position: 'absolute', top: top, left: 2, right: 2, height: height,
            background: bg, opacity: item._conflict ? 0.6 : 0.85, borderRadius: 2,
            overflow: 'hidden', fontSize: 8, color: '#fff', padding: '1px 2px',
            lineHeight: '10px', cursor: 'pointer',
            border: isSelected ? '2px solid #fff' : item._conflict ? '2px dashed #ff0' : 'none',
            boxShadow: isSelected ? '0 0 8px rgba(255,255,255,0.4)' : 'none',
          }}>
            {item.text.substring(0, 18)}
          </div>
        );
      })}
    </div>
  );
}

// ─── Phase Panel ──────────────────────────────────────────────────

function PhasePanel({ snapshot, todayKey, onSelect, selectedId }) {
  var days = Object.keys(snapshot.days || {}).sort(function(a, b) {
    return parseDateKey(a) - parseDateKey(b);
  });

  if (days.length === 0) {
    return (
      <div style={{ marginBottom: 24 }}>
        <PhaseHeader snapshot={snapshot} />
        <div style={{ padding: '20px 40px', color: '#556', fontSize: 12, fontStyle: 'italic', background: '#0d1b2a', borderRadius: 6, border: '1px solid #1e2e4a' }}>
          No tasks placed in this phase
        </div>
      </div>
    );
  }

  var totalItems = days.reduce(function(s, dk) { return s + (snapshot.days[dk] || []).length; }, 0);

  return (
    <div style={{ marginBottom: 24 }}>
      <PhaseHeader snapshot={snapshot} itemCount={totalItems} dayCount={days.length} />
      <div style={{ overflowX: 'auto', borderRadius: 6, border: '1px solid #1e2e4a' }}>
        <div style={{ display: 'flex', position: 'relative', background: '#0d1b2a', minWidth: 'max-content' }}>
          {/* Time axis */}
          <div style={{ width: 36, flexShrink: 0, borderRight: '1px solid #2a3a5a', position: 'sticky', left: 0, zIndex: 3, background: '#0d1b2a' }}>
            <div style={{ height: 34, borderBottom: '1px solid #2a3a5a' }} />
            {Array.from({ length: GRID_END - GRID_START }, function(_, i) {
              var hr = GRID_START + i;
              return (
                <div key={hr} style={{
                  height: MINS_PER_HOUR * PX_PER_MIN, fontSize: 8, color: '#445',
                  textAlign: 'right', paddingRight: 3, borderBottom: '1px solid #111a28'
                }}>
                  {formatTime(hr * 60)}
                </div>
              );
            })}
          </div>
          {days.map(function(dk) {
            return <DayColumn key={dk} dateKey={dk} items={snapshot.days[dk]} isToday={dk === todayKey} onSelect={onSelect} selectedId={selectedId} />;
          })}
        </div>
      </div>
    </div>
  );
}

function PhaseHeader({ snapshot, itemCount, dayCount }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
      <h3 style={{ margin: 0, color: '#E8E0D0', fontSize: 14, fontWeight: 600 }}>{snapshot.phase}</h3>
      <span style={{ fontSize: 11, color: '#556' }}>{snapshot.timestamp}ms</span>
      {itemCount != null && <span style={{ fontSize: 11, color: '#43A047' }}>{itemCount} items</span>}
      {dayCount != null && <span style={{ fontSize: 11, color: '#556' }}>{dayCount} days</span>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────

export default function SchedulerDebug() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedPhase, setSelectedPhase] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);

  const runDebug = useCallback(async function() {
    setLoading(true);
    setError(null);
    setSelectedItem(null);
    try {
      var res = await apiClient.post('/schedule/debug');
      setData(res.data);
      setSelectedPhase(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(function() { runDebug(); }, [runDebug]);

  var handleSelect = useCallback(function(item) {
    setSelectedItem(function(prev) { return prev && prev.id === item.id ? null : item; });
  }, []);

  if (!user) return <div style={{ padding: 40, color: '#E8E0D0' }}>Not authenticated</div>;

  var snapshots = data?.phaseSnapshots || [];

  return (
    <div style={{ minHeight: '100vh', background: '#0a1628', color: '#E8E0D0', fontFamily: "'Inter', system-ui, sans-serif", padding: 24, paddingRight: selectedItem ? 364 : 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#C8942A' }}>Scheduler Debug</h1>
        <button onClick={runDebug} disabled={loading} style={{
          background: '#1e3a5f', color: '#E8E0D0', border: '1px solid #2a4a7a', borderRadius: 4,
          padding: '6px 16px', fontSize: 12, cursor: loading ? 'wait' : 'pointer'
        }}>
          {loading ? 'Running...' : 'Re-run Scheduler'}
        </button>
        <a href="/" style={{ color: '#667', fontSize: 12, textDecoration: 'none' }}>{'\u2190'} Back to app</a>
      </div>

      {error && <div style={{ color: '#E53935', padding: 12, background: '#1a0000', borderRadius: 4, marginBottom: 16 }}>{error}</div>}

      {data && (
        <div style={{ display: 'flex', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
          <Stat label="Tasks" value={data.taskCount} />
          <Stat label="Placed" value={data.placedCount} color="#43A047" />
          <Stat label="Unplaced" value={data.unplacedCount} color={data.unplacedCount > 0 ? '#E53935' : '#43A047'} />
          <Stat label="Score" value={Math.round(data.score?.total || 0)} />
          <Stat label="Warnings" value={(data.warnings || []).length} color={(data.warnings || []).length > 0 ? '#F9A825' : '#43A047'} />
          <Stat label="Phases" value={snapshots.length} />
        </div>
      )}

      {data?.score?.breakdown && (
        <div style={{ marginBottom: 24, padding: 12, background: '#0d1b2a', borderRadius: 6, border: '1px solid #1e2e4a' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 13, color: '#8899aa' }}>Score Breakdown</h3>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {Object.entries(data.score.breakdown).map(function([key, val]) {
              return <span key={key} style={{ fontSize: 11, color: val > 0 ? '#F9A825' : '#556' }}>{key}: {Math.round(val)}</span>;
            })}
          </div>
        </div>
      )}

      {snapshots.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          <button onClick={function() { setSelectedPhase(null); }} style={{
            background: selectedPhase === null ? '#C8942A' : '#1e3a5f', color: '#E8E0D0',
            border: '1px solid #2a4a7a', borderRadius: 4, padding: '4px 10px', fontSize: 10, cursor: 'pointer'
          }}>All Phases</button>
          {snapshots.map(function(s, i) {
            var itemCount = Object.values(s.days).reduce(function(sum, d) { return sum + d.length; }, 0);
            return (
              <button key={i} onClick={function() { setSelectedPhase(i); }} style={{
                background: selectedPhase === i ? '#C8942A' : '#1e3a5f', color: '#E8E0D0',
                border: '1px solid #2a4a7a', borderRadius: 4, padding: '4px 10px', fontSize: 10, cursor: 'pointer'
              }}>{s.phase.replace(/^Phase \d+:?\s*/, '')} ({itemCount})</button>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        {Object.entries(PHASE_COLORS).map(function([type, color]) {
          return (
            <span key={type} style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, height: 10, background: color, borderRadius: 2, display: 'inline-block' }} />
              {type}
            </span>
          );
        })}
        <span style={{ fontSize: 10, color: '#556' }}>| Click a block for details</span>
      </div>

      {selectedPhase !== null ? (
        <PhasePanel snapshot={snapshots[selectedPhase]} todayKey={data?.todayKey} onSelect={handleSelect} selectedId={selectedItem?.id} />
      ) : (
        snapshots.map(function(s, i) {
          return <PhasePanel key={i} snapshot={s} todayKey={data?.todayKey} onSelect={handleSelect} selectedId={selectedItem?.id} />;
        })
      )}

      {data?.warnings?.length > 0 && (
        <div style={{ marginTop: 24, padding: 12, background: '#1a1500', borderRadius: 6, border: '1px solid #4a3a00' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 13, color: '#F9A825' }}>Warnings ({data.warnings.length})</h3>
          {data.warnings.map(function(w, i) {
            return <div key={i} style={{ fontSize: 11, color: '#cba', marginBottom: 4 }}>{w.type}: {w.message}</div>;
          })}
        </div>
      )}

      {selectedItem && <DetailPanel item={selectedItem} onClose={function() { setSelectedItem(null); }} />}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || '#E8E0D0' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#667', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
    </div>
  );
}

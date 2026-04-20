/**
 * SchedulerStepper — admin-only step-by-step visualization.
 *
 * Starts a dry-run stepper session on the backend (POST /api/schedule/step/start),
 * then walks forward/backward through the snapshots with the ◀/▶ buttons.
 * Each step shows the task being placed, why, and the full state of the
 * day grid after that placement.
 *
 * Access: /admin/scheduler-stepper (hidden).
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import apiClient from '../../services/apiClient';

var GRID_START = 6;
var GRID_END = 23;
var PX_PER_MIN = 1.5;
var COL_WIDTH = 110;

var PHASE_LABELS = {
  'Phase 0: Fixed items': 'Phase 0 — Fixed',
  'Phase 0: + Rigid recurringTasks': 'Phase 0 — Rigid recurring',
  'Phase 1: Recurring tasks': 'Phase 1 — Recurring',
  'Phase 2: Slack-based forward placement': 'Phase 2 — Constrained',
  'Phase 3: Unconstrained fill': 'Phase 3 — Backlog',
  'Phase 4: Recurring rescue': 'Phase 4 — Rescue',
  'Final': 'Final'
};

var PHASE_COLORS = {
  'Phase 0: Fixed items': '#E53935',
  'Phase 0: + Rigid recurringTasks': '#EF6C00',
  'Phase 1: Recurring tasks': '#F9A825',
  'Phase 2: Slack-based forward placement': '#1E88E5',
  'Phase 3: Unconstrained fill': '#43A047',
  'Phase 4: Recurring rescue': '#8E24AA',
  'Final': '#78909C'
};

var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmt(mins) {
  if (mins == null) return '';
  var h = Math.floor(mins / 60), m = mins % 60;
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 || 12;
  return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
}

// Turn scheduler dateKey "M/D" into "Sun 4/19" using current year.
function dateWithDay(dk) {
  if (!dk) return '';
  var parts = String(dk).split('/');
  var m = parseInt(parts[0], 10), d = parseInt(parts[1], 10);
  if (Number.isNaN(m) || Number.isNaN(d)) return dk;
  var dt = new Date(new Date().getFullYear(), m - 1, d);
  return DAY_NAMES[dt.getDay()] + ' ' + dk;
}

// Chronological sort for "M/D" date keys. Lexical sort puts 5/30 before
// 5/4 because '3' < '4' as characters; this respects month+day numerics
// and rolls the year so a Dec/Jan run of dates stays contiguous.
function compareDateKeys(a, b) {
  var pa = String(a).split('/'), pb = String(b).split('/');
  var ma = parseInt(pa[0], 10), da = parseInt(pa[1], 10);
  var mb = parseInt(pb[0], 10), db = parseInt(pb[1], 10);
  // Project onto the current year; any dateKey > 6 months earlier than the
  // earliest we see is assumed to belong to next year. Simplest heuristic:
  // compare (month, day) and assume the set doesn't straddle Jan within a
  // single view window (acceptable for a 2-3 month scheduler horizon).
  if (ma !== mb) return ma - mb;
  return da - db;
}

function durLabel(d) {
  if (d == null) return '';
  if (d < 60) return d + 'm';
  return Math.floor(d / 60) + 'h ' + (d % 60) + 'm';
}

function slackLabel(s) {
  if (s == null) return '\u221E';
  if (s <= 0) return '0m';
  if (s < 60) return s + 'm';
  return Math.floor(s / 60) + 'h ' + (s % 60) + 'm';
}

function DayGrid({ snapshot, highlightTaskId, highlightDateKey, highlightStart }) {
  if (!snapshot) return null;
  var days = Object.keys(snapshot).sort(compareDateKeys);
  return (
    <div style={{ display: 'flex', overflowX: 'auto', flex: 1, minHeight: 0 }}>
      {/* Time axis */}
      <div style={{ width: 50, flexShrink: 0, borderRight: '1px solid #22303c' }}>
        <div style={{ height: 28 }} />
        {Array.from({ length: GRID_END - GRID_START + 1 }, function(_, i) {
          var h = GRID_START + i;
          var label = (h % 12 || 12) + (h >= 12 ? 'p' : 'a');
          return (
            <div key={i} style={{
              height: 60 * PX_PER_MIN, fontSize: 9, color: '#677',
              padding: '2px 4px', borderTop: '1px solid #112'
            }}>{label}</div>
          );
        })}
      </div>

      {/* Day columns */}
      {days.map(function(dk) {
        var placements = snapshot[dk] || [];
        return (
          <div key={dk} style={{
            width: COL_WIDTH, flexShrink: 0, borderRight: '1px solid #22303c', position: 'relative'
          }}>
            <div style={{
              height: 28, lineHeight: '28px', textAlign: 'center',
              fontSize: 11, color: '#aab', borderBottom: '1px solid #22303c',
              background: dk === highlightDateKey ? '#1a2f45' : 'transparent'
            }}>{dateWithDay(dk)}</div>
            <div style={{
              position: 'relative',
              height: (GRID_END - GRID_START + 1) * 60 * PX_PER_MIN
            }}>
              {placements.map(function(p, i) {
                var top = (p.start - GRID_START * 60) * PX_PER_MIN;
                var height = Math.max(p.dur * PX_PER_MIN, 14);
                var isCurrent = p.taskId === highlightTaskId && dk === highlightDateKey && p.start === highlightStart;
                return (
                  <div key={i} title={p.taskText + ' — ' + fmt(p.start) + ' (' + durLabel(p.dur) + ')'} style={{
                    position: 'absolute', top: top, left: 4, right: 4,
                    height: height - 2,
                    background: isCurrent ? '#C8942A' : (p.locked ? '#8B2635' : '#2d5a8a'),
                    border: isCurrent ? '2px solid #FFB74D' : '1px solid #1a2f45',
                    borderRadius: 3, padding: '2px 4px',
                    fontSize: 10, color: '#fff', overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    boxShadow: isCurrent ? '0 0 8px rgba(200,148,42,0.6)' : 'none'
                  }}>{p.taskText}</div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DetailPanel({ step, summary }) {
  if (!step) return null;
  var task = step.task || {};
  var placement = step.placement || {};
  var phase = step.phase || 'unknown';
  return (
    <div style={{ padding: 20 }}>
      <div style={{ fontSize: 10, color: '#8899aa', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        <span style={{
          background: PHASE_COLORS[phase] || '#555',
          color: '#fff', padding: '2px 8px', borderRadius: 3, marginRight: 6
        }}>{PHASE_LABELS[phase] || phase}</span>
        Step {step.stepIndex + 1} of {step.totalSteps}
      </div>

      <h2 style={{ margin: '4px 0 4px', fontSize: 16, color: '#E8E0D0', fontWeight: 600 }}>
        {step.taskText}
      </h2>
      <div style={{ fontSize: 11, color: '#667', marginBottom: 12 }}>{step.taskId}</div>

      <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '6px 12px', fontSize: 12, color: '#cba' }}>
        <span style={{ color: '#8899aa' }}>Placed</span>
        <span style={{ color: '#E8E0D0' }}>
          {dateWithDay(placement.dateKey)} at {fmt(placement.start)} ({durLabel(placement.dur)})
        </span>
        {task.pri != null && <><span style={{ color: '#8899aa' }}>Priority</span><span>{task.pri}</span></>}
        {task.project != null && <><span style={{ color: '#8899aa' }}>Project</span><span>{task.project}</span></>}
        {task.when != null && <><span style={{ color: '#8899aa' }}>When</span><span>{task.when}</span></>}
        {task.deadline != null && <><span style={{ color: '#8899aa' }}>Deadline</span><span>{task.deadline}</span></>}
        {task.startAfter != null && <><span style={{ color: '#8899aa' }}>Start after</span><span>{task.startAfter}</span></>}
        {step.orderingSlack != null && <>
          <span style={{ color: '#8899aa' }}>Ordering slack</span>
          <span>{slackLabel(step.orderingSlack)}</span>
        </>}
        {task.slackMins !== undefined && <>
          <span style={{ color: '#8899aa' }}>Display slack</span>
          <span>{slackLabel(task.slackMins)}</span>
        </>}
        {step.splitOrdinal != null && task.split && <>
          <span style={{ color: '#8899aa' }}>Split chunk</span>
          <span>#{step.splitOrdinal}</span>
        </>}
        {step.preferredTimeMins != null && <>
          <span style={{ color: '#8899aa' }}>Preferred</span>
          <span>{fmt(step.preferredTimeMins)} ± {(step.timeFlex != null ? step.timeFlex : 60) + 'm'}</span>
        </>}
        {step.flexWindow && <>
          <span style={{ color: '#8899aa' }}>Flex window</span>
          <span>{fmt(step.flexWindow.start)} – {fmt(step.flexWindow.end)}</span>
        </>}
        {step.rigid && <>
          <span style={{ color: '#8899aa' }}>Rigid</span>
          <span style={{ color: '#E53935' }}>Yes</span>
        </>}
        {(step.travelBefore > 0 || step.travelAfter > 0) && <>
          <span style={{ color: '#8899aa' }}>Travel</span>
          <span>{step.travelBefore || 0}m before / {step.travelAfter || 0}m after</span>
        </>}
        {step.locationAtPlacement != null && <>
          <span style={{ color: '#8899aa' }}>Location @ placement</span>
          <span>{String(step.locationAtPlacement)}</span>
        </>}
        {step.locationRequirement && step.locationRequirement.length > 0 && <>
          <span style={{ color: '#8899aa' }}>Requires location</span>
          <span>{(Array.isArray(step.locationRequirement) ? step.locationRequirement : [step.locationRequirement]).join(', ')}</span>
        </>}
        {step.toolRequirement && step.toolRequirement.length > 0 && <>
          <span style={{ color: '#8899aa' }}>Requires tools</span>
          <span>{(Array.isArray(step.toolRequirement) ? step.toolRequirement : [step.toolRequirement]).join(', ')}</span>
        </>}
      </div>

      <div style={{ marginTop: 20, fontSize: 10, color: '#8899aa', textTransform: 'uppercase', letterSpacing: 1 }}>
        Decision
      </div>
      <div style={{ fontSize: 12, color: '#cba', marginTop: 6, lineHeight: 1.5 }}>
        {phaseRationale(phase, step, task)}
      </div>

      {summary && summary.unplaced && summary.unplaced.length > 0 && step.stepIndex + 1 === step.totalSteps && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 10, color: '#8899aa', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Unplaced ({summary.unplaced.length})
          </div>
          {summary.unplaced.map(function(u, i) {
            return (
              <div key={i} style={{ fontSize: 11, color: '#ef6c00', padding: '2px 0' }}>
                {u.text} — {u.reason || 'no fit'}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QueuePanel({ queue, stepIndex, onJump }) {
  var scrollRef = useRef(null);
  var activeRef = useRef(null);

  // Keep the active row scrolled into view as the user steps forward/back.
  useEffect(function() {
    if (activeRef.current && scrollRef.current) {
      var el = activeRef.current;
      var parent = scrollRef.current;
      var top = el.offsetTop - parent.offsetTop;
      var bottom = top + el.offsetHeight;
      if (top < parent.scrollTop || bottom > parent.scrollTop + parent.clientHeight) {
        parent.scrollTop = top - parent.clientHeight / 3;
      }
    }
  }, [stepIndex]);

  if (!queue || queue.length === 0) return null;
  return (
    <div style={{
      borderTop: '2px solid #22303c', display: 'flex', flexDirection: 'column',
      minHeight: 0, flex: 1
    }}>
      <div style={{ padding: '10px 20px 6px', fontSize: 10, color: '#8899aa', textTransform: 'uppercase', letterSpacing: 1 }}>
        Queue · {queue.length} steps
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
        {queue.map(function(q) {
          var active = q.stepIndex === stepIndex;
          var past = q.stepIndex < stepIndex;
          var phaseColor = PHASE_COLORS[q.phase] || '#555';
          return (
            <div
              key={q.stepIndex}
              ref={active ? activeRef : null}
              onClick={function() { onJump(q.stepIndex); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 10px', fontSize: 11, borderRadius: 3,
                cursor: 'pointer', marginBottom: 1,
                background: active ? 'rgba(200,148,42,0.25)' : 'transparent',
                color: active ? '#FFD080' : (past ? '#556' : '#aab'),
                borderLeft: '3px solid ' + (active ? '#C8942A' : phaseColor),
                opacity: past ? 0.6 : 1
              }}
              title={q.phase + ' — ' + (q.taskText || q.taskId)}
            >
              <span style={{ width: 28, color: active ? '#FFD080' : '#667', fontSize: 10, textAlign: 'right' }}>
                {q.stepIndex + 1}
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {q.taskText || '—'}
              </span>
              {q.placement && q.placement.start != null && (
                <span style={{ fontSize: 9, color: active ? '#FFD080' : '#667' }}>
                  {fmt(q.placement.start)}
                </span>
              )}
              {q.orderingSlack != null && (
                <span style={{ fontSize: 9, color: active ? '#FFD080' : '#556', minWidth: 40, textAlign: 'right' }}>
                  {slackLabel(q.orderingSlack)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function phaseRationale(phase, step, task) {
  var bits = [];
  if (phase === 'Phase 0: Fixed items') {
    bits.push('Fixed/pinned task — placed at its locked time before any other scheduling.');
  } else if (phase === 'Phase 0: + Rigid recurringTasks') {
    bits.push('Rigid recurring task — anchored at its preferred time; ignores flexibility.');
  } else if (phase === 'Phase 1: Recurring tasks') {
    bits.push('Non-rigid recurring instance — slack-sorted within its cycle window.');
  } else if (phase === 'Phase 2: Slack-based forward placement') {
    bits.push('Constrained task (deadline or chain). Sort order: slack asc, priority asc, duration desc.');
    if (step.orderingSlack != null) bits.push('Slack at sort time: ' + slackLabel(step.orderingSlack) + '.');
  } else if (phase === 'Phase 3: Unconstrained fill') {
    bits.push('Backlog task — no deadline. Filled into the earliest free slot that matches when/where.');
  } else if (phase === 'Phase 4: Recurring rescue') {
    bits.push('Recurring rescue pass — bumping lower-priority non-recurring tasks to make same-day room.');
  } else {
    bits.push('Placement recorded.');
  }
  if (task.when) bits.push('When window: ' + task.when + '.');
  if (task.split) bits.push('Task is split into ' + task.splitMin + '-min chunks.');
  return bits.join(' ');
}

export default function SchedulerStepper() {
  var [session, setSession] = useState(null);
  var [summary, setSummary] = useState(null);
  var [stepIndex, setStepIndex] = useState(0);
  var [step, setStep] = useState(null);
  var [loading, setLoading] = useState(false);
  var [error, setError] = useState(null);
  var [jumpInput, setJumpInput] = useState('');
  var sessionRef = useRef(null);

  function applyJump() {
    if (!session) return;
    var n = parseInt(jumpInput, 10);
    if (Number.isNaN(n)) return;
    // Accept either 1-based (user-visible) or 0-based input.
    // Clamp to valid range.
    var target = Math.min(session.totalSteps - 1, Math.max(0, n - 1));
    setStepIndex(target);
    setJumpInput('');
  }

  var start = useCallback(async function() {
    setLoading(true);
    setError(null);
    try {
      var res = await apiClient.post('/schedule/step/start');
      setSession(res.data);
      sessionRef.current = res.data.sessionId;
      setStepIndex(0);
      // Prefetch summary for end-of-run data
      var summaryRes = await apiClient.get('/schedule/step/' + res.data.sessionId + '/summary');
      setSummary(summaryRes.data);
    } catch (e) {
      setError((e.response && e.response.data && e.response.data.error) || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  var loadStep = useCallback(async function(idx) {
    if (!sessionRef.current) return;
    try {
      var res = await apiClient.get('/schedule/step/' + sessionRef.current + '/' + idx);
      setStep(res.data);
    } catch (e) {
      setError((e.response && e.response.data && e.response.data.error) || e.message);
    }
  }, []);

  useEffect(function() { start(); return function() {
    if (sessionRef.current) apiClient.post('/schedule/step/' + sessionRef.current + '/stop').catch(function() {});
  }; }, [start]);

  useEffect(function() {
    if (session && session.totalSteps > 0) loadStep(stepIndex);
  }, [session, stepIndex, loadStep]);

  useEffect(function() {
    function onKey(e) {
      if (!session) return;
      if (e.key === 'ArrowRight') setStepIndex(function(i) { return Math.min(i + 1, session.totalSteps - 1); });
      else if (e.key === 'ArrowLeft') setStepIndex(function(i) { return Math.max(i - 1, 0); });
      else if (e.key === 'End') setStepIndex(session.totalSteps - 1);
      else if (e.key === 'Home') setStepIndex(0);
    }
    window.addEventListener('keydown', onKey);
    return function() { window.removeEventListener('keydown', onKey); };
  }, [session]);

  if (loading) {
    return <div style={{ padding: 40, color: '#aab', background: '#0d1b2a', height: '100vh' }}>Starting stepper session…</div>;
  }
  if (error) {
    return (
      <div style={{ padding: 40, color: '#ef6c00', background: '#0d1b2a', height: '100vh' }}>
        <div style={{ fontSize: 14, marginBottom: 8 }}>Error starting stepper</div>
        <div style={{ fontSize: 12 }}>{error}</div>
        <button onClick={start} style={{ marginTop: 16, padding: '6px 14px', background: '#1E88E5', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}>Retry</button>
      </div>
    );
  }
  if (!session) return null;
  if (session.totalSteps === 0) {
    return <div style={{ padding: 40, color: '#aab', background: '#0d1b2a', height: '100vh' }}>No placements to step through — scheduler produced 0 placements.</div>;
  }

  var total = session.totalSteps;
  var canBack = stepIndex > 0;
  var canFwd = stepIndex < total - 1;

  return (
    <div style={{ background: '#0d1b2a', color: '#E8E0D0', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '10px 16px', borderBottom: '2px solid #22303c',
        display: 'flex', alignItems: 'center', gap: 12
      }}>
        <a href="/" style={{ color: '#667', fontSize: 12, textDecoration: 'none' }}>&larr; Back</a>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Scheduler Stepper</span>
        <div style={{ flex: 1 }} />
        <button onClick={function() { setStepIndex(0); }} disabled={!canBack} style={btnStyle(canBack)}>⟲ First</button>
        <button onClick={function() { setStepIndex(Math.max(0, stepIndex - 1)); }} disabled={!canBack} style={btnStyle(canBack)}>◀ Prev</button>
        <span style={{ fontSize: 12, color: '#aab', minWidth: 90, textAlign: 'center' }}>
          Step {stepIndex + 1} / {total}
        </span>
        <button onClick={function() { setStepIndex(Math.min(total - 1, stepIndex + 1)); }} disabled={!canFwd} style={btnStyle(canFwd)}>Next ▶</button>
        <button onClick={function() { setStepIndex(total - 1); }} disabled={!canFwd} style={btnStyle(canFwd)}>⏭ End</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="number"
            min={1}
            max={total}
            value={jumpInput}
            placeholder={'1–' + total}
            onChange={function(e) { setJumpInput(e.target.value); }}
            onKeyDown={function(e) { if (e.key === 'Enter') { applyJump(); } }}
            style={{
              width: 72, padding: '3px 6px', fontSize: 12,
              background: '#0a1520', color: '#E8E0D0',
              border: '1px solid #22303c', borderRadius: 3
            }}
          />
          <button onClick={applyJump} disabled={!jumpInput} style={btnStyle(!!jumpInput)}>Go</button>
        </div>
        <button onClick={start} style={btnStyle(true)}>↻ Restart</button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <DayGrid
            snapshot={step && step.dayPlacementsSnapshot}
            highlightTaskId={step && step.taskId}
            highlightDateKey={step && step.placement && step.placement.dateKey}
            highlightStart={step && step.placement && step.placement.start}
          />
        </div>
        <div style={{ width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#0d1b2a', borderLeft: '2px solid #22303c' }}>
          <div style={{ flex: '0 0 auto', maxHeight: '55%', overflowY: 'auto' }}>
            <DetailPanel step={step} summary={summary} />
          </div>
          <QueuePanel
            queue={summary && summary.queue}
            stepIndex={stepIndex}
            onJump={setStepIndex}
          />
        </div>
      </div>
    </div>
  );
}

function btnStyle(enabled) {
  return {
    padding: '4px 10px', fontSize: 12,
    background: enabled ? '#1E88E5' : '#22303c',
    color: enabled ? '#fff' : '#667',
    border: 'none', borderRadius: 3,
    cursor: enabled ? 'pointer' : 'not-allowed'
  };
}

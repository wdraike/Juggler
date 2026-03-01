/**
 * DependencyChainPopup — visual dependency graph with drag reorder, SVG arrows
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getTheme } from '../../theme/colors';
import { getTaskDeps, topoSortTasks } from '../../scheduler/dependencyHelpers';
import { PRI_COLORS, STATUS_MAP } from '../../state/constants';

var STATUS_ICONS = { done: '\u2705', wip: '\u{1F7E1}', cancel: '\u274C', skip: '\u23ED\uFE0F', other: '\u27A1\uFE0F', '': '\u26AA' };
var ARROW_COLORS = ['#3B82F6', '#7C3AED', '#059669', '#DC2626', '#D97706', '#DB2777', '#0891B2'];

export default function DependencyChainPopup({ focusTaskId, allTasks, statuses, onUpdate, onClose, darkMode }) {
  var theme = getTheme(darkMode);
  var bodyRef = useRef(null);

  // Build chain data: ancestors + descendants of focus task
  var chainData = useMemo(() => {
    if (!focusTaskId) return null;
    var MAX_CHAIN = 60;
    var chainIds = {};
    chainIds[focusTaskId] = true;

    function addAnc(id, depth) {
      if (depth > 30 || Object.keys(chainIds).length > MAX_CHAIN) return;
      var tt = allTasks.find(x => x.id === id);
      if (!tt || !tt.dependsOn) return;
      getTaskDeps(tt).forEach(pid => {
        if (!chainIds[pid]) { chainIds[pid] = true; addAnc(pid, depth + 1); }
      });
    }
    function addDesc(id, depth) {
      if (depth > 30 || Object.keys(chainIds).length > MAX_CHAIN) return;
      allTasks.forEach(tt => {
        if (tt.dependsOn && getTaskDeps(tt).indexOf(id) >= 0 && !chainIds[tt.id]) {
          chainIds[tt.id] = true; addDesc(tt.id, depth + 1);
        }
      });
    }
    addAnc(focusTaskId, 0);
    addDesc(focusTaskId, 0);

    var chainTasks = allTasks.filter(t => chainIds[t.id]);
    var sorted = topoSortTasks(chainTasks);
    return { tasks: sorted, focusId: focusTaskId };
  }, [focusTaskId, allTasks]);

  // Chain order and deps state
  var [chainOrder, setChainOrder] = useState(null);
  var [chainDeps, setChainDeps] = useState({});
  var [chainDirty, setChainDirty] = useState(false);
  var [chainAddDepFor, setChainAddDepFor] = useState(null);
  var [chainDragIdx, setChainDragIdx] = useState(null);
  var [chainDropIdx, setChainDropIdx] = useState(null);
  var [chainArrows, setChainArrows] = useState([]);

  // Sync when popup opens
  useEffect(() => {
    if (chainData) {
      var ids = chainData.tasks.map(t => t.id);
      setChainOrder(ids);
      var chainSet = {};
      ids.forEach(id => { chainSet[id] = true; });
      var deps = {};
      chainData.tasks.forEach(t => {
        var taskDeps = getTaskDeps(t);
        deps[t.id] = taskDeps.filter(d => chainSet[d]);
      });
      setChainDeps(deps);
      setChainDirty(false);
      setChainAddDepFor(null);
    } else {
      setChainOrder(null);
      setChainDeps({});
      setChainDirty(false);
      setChainAddDepFor(null);
    }
  }, [chainData]);

  // Reorder
  var chainReorder = useCallback((fromIdx, toIdx) => {
    setChainOrder(prev => {
      if (!prev) return prev;
      var arr = prev.slice();
      var item = arr.splice(fromIdx, 1)[0];
      arr.splice(toIdx, 0, item);
      return arr;
    });
    setChainDirty(true);
  }, []);

  // Add dep
  var chainAddDep = useCallback((taskId, depId) => {
    setChainOrder(prev => {
      if (!prev) return prev;
      if (prev.indexOf(depId) >= 0) return prev;
      var tIdx = prev.indexOf(taskId);
      var arr = prev.slice();
      arr.splice(tIdx >= 0 ? tIdx : 0, 0, depId);
      return arr;
    });
    setChainDeps(prev => {
      var next = { ...prev };
      if (!next[depId]) {
        var dt = allTasks.find(x => x.id === depId);
        next[depId] = dt ? getTaskDeps(dt).filter(d => next[d] !== undefined) : [];
      }
      var cur = (next[taskId] || []).slice();
      if (cur.indexOf(depId) < 0) cur.push(depId);
      next[taskId] = cur;
      return next;
    });
    setChainDirty(true);
    setChainAddDepFor(null);
  }, [allTasks]);

  // Remove dep
  var chainRemoveDep = useCallback((taskId, depId) => {
    setChainDeps(prev => {
      var cur = (prev[taskId] || []).slice();
      var idx = cur.indexOf(depId);
      if (idx >= 0) cur.splice(idx, 1);
      return { ...prev, [taskId]: cur };
    });
    setChainDirty(true);
  }, []);

  // Save
  var chainSave = useCallback(() => {
    if (!chainOrder || chainOrder.length === 0) return;
    var chainSet = {};
    chainOrder.forEach(id => { chainSet[id] = true; });

    chainOrder.forEach(id => {
      var task = allTasks.find(t => t.id === id);
      if (!task) return;
      var inChainDeps = chainDeps[id] || [];
      var oldDeps = getTaskDeps(task);
      var externalDeps = oldDeps.filter(d => !chainSet[d]);
      var finalDeps = externalDeps.concat(inChainDeps);
      onUpdate(id, { dependsOn: finalDeps.length > 0 ? finalDeps : [] });
    });
    setChainDirty(false);
  }, [chainOrder, chainDeps, allTasks, onUpdate]);

  // Compute SVG arrows after render
  useEffect(() => {
    if (!focusTaskId || !chainOrder || !bodyRef.current) {
      setChainArrows(prev => prev.length === 0 ? prev : []);
      return;
    }
    var raf = requestAnimationFrame(() => {
      var body = bodyRef.current;
      if (!body) return;
      var cards = body.querySelectorAll('[data-chain-id]');
      if (!cards.length) return;
      var bodyRect = body.getBoundingClientRect();
      var bodyScrollTop = body.scrollTop;
      var posMap = {};
      cards.forEach(el => {
        var id = el.getAttribute('data-chain-id');
        var r = el.getBoundingClientRect();
        posMap[id] = {
          top: r.top - bodyRect.top + bodyScrollTop,
          bottom: r.bottom - bodyRect.top + bodyScrollTop,
          midY: (r.top + r.bottom) / 2 - bodyRect.top + bodyScrollTop,
          height: r.height
        };
      });
      var arrows = [];
      var colorIdx = 0;
      chainOrder.forEach((taskId, idx) => {
        var deps = (chainDeps[taskId] || []).filter(d => chainOrder.indexOf(d) >= 0);
        deps.forEach(depId => {
          var fromPos = posMap[taskId];
          var depIdx = chainOrder.indexOf(depId);
          var toPos = posMap[depId];
          if (!fromPos || !toPos) return;
          var distance = Math.abs(idx - depIdx);
          if (distance <= 1) return;
          arrows.push({
            fromY: fromPos.top + 18, toY: toPos.bottom - 10,
            fromIdx: idx, toIdx: depIdx, distance: distance,
            color: ARROW_COLORS[colorIdx++ % ARROW_COLORS.length]
          });
        });
      });
      setChainArrows(arrows);
    });
    return () => cancelAnimationFrame(raf);
  }, [focusTaskId, chainOrder, chainDeps]);

  if (!chainData || !chainOrder) return null;

  var orderedTasks = chainOrder.map(id => allTasks.find(t => t.id === id)).filter(Boolean);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 350, display: 'flex',
      alignItems: 'center', justifyContent: 'center'
    }} onClick={onClose}>
      <div style={{
        background: theme.bgSecondary, borderRadius: 12, width: 520, maxWidth: '95vw',
        maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: `0 8px 32px ${theme.shadow}`
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', borderBottom: `1px solid ${theme.border}`
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
            Dependency Chain ({orderedTasks.length} tasks)
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {chainDirty && (
              <button onClick={chainSave} style={{
                border: 'none', borderRadius: 6, padding: '4px 12px',
                background: '#10B981', color: '#FFF', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit'
              }}>Save Changes</button>
            )}
            <button onClick={onClose} style={{
              border: 'none', background: 'transparent', color: theme.textMuted,
              fontSize: 20, cursor: 'pointer'
            }}>&times;</button>
          </div>
        </div>

        {/* Body */}
        <div ref={bodyRef} style={{ flex: 1, overflow: 'auto', padding: 16, position: 'relative' }}>
          {/* SVG arrows for non-adjacent deps */}
          {chainArrows.length > 0 && (
            <svg style={{
              position: 'absolute', top: 0, left: 0, width: 30,
              height: bodyRef.current ? bodyRef.current.scrollHeight : 1000,
              pointerEvents: 'none', overflow: 'visible'
            }}>
              {chainArrows.map((a, i) => {
                var x = 20 - (a.distance % 4) * 4;
                return (
                  <g key={i}>
                    <path
                      d={`M ${x} ${a.fromY} C ${x - 12} ${a.fromY} ${x - 12} ${a.toY} ${x} ${a.toY}`}
                      fill="none" stroke={a.color} strokeWidth={1.5}
                      strokeDasharray="4,3" opacity={0.6}
                    />
                    <polygon
                      points={`${x - 3},${a.toY - 5} ${x + 3},${a.toY - 5} ${x},${a.toY}`}
                      fill={a.color} opacity={0.7}
                    />
                  </g>
                );
              })}
            </svg>
          )}

          {orderedTasks.map((ct, idx) => {
            var st = statuses[ct.id] || '';
            var isFocus = ct.id === chainData.focusId;
            var isDone = st === 'done';
            var isClosed = isDone || st === 'skip' || st === 'cancel';
            var icon = STATUS_ICONS[st] || '\u26AA';
            var dateLabel = ct.date && ct.date !== 'TBD' ? ct.date + (ct.day ? ' ' + ct.day : '') : 'TBD';
            var isDragging = chainDragIdx === idx;
            var isDropTarget = chainDropIdx === idx && chainDragIdx !== null && chainDragIdx !== idx;

            return (
              <div key={ct.id + '-wrap'}>
                {/* Drop zone above */}
                {isDropTarget && chainDragIdx > idx && (
                  <div style={{ height: 3, background: theme.accent, borderRadius: 2, marginBottom: 4 }} />
                )}
                {/* Connector */}
                {idx > 0 && !isDropTarget && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: 22, justifyContent: 'center' }}>
                    <div style={{ width: 2, height: 10, background: (chainDirty ? '#F59E0B' : theme.accent) + '55' }} />
                    <div style={{ fontSize: 8, color: (chainDirty ? '#F59E0B' : theme.accent) + '88', lineHeight: '8px' }}>{'\u25BC'}</div>
                    <div style={{ width: 2, height: 2, background: (chainDirty ? '#F59E0B' : theme.accent) + '55' }} />
                  </div>
                )}
                {/* Task card */}
                <div
                  data-chain-id={ct.id}
                  draggable
                  onDragStart={e => { setChainDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); }}
                  onDragEnd={() => { setChainDragIdx(null); setChainDropIdx(null); }}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (chainDragIdx !== null && chainDragIdx !== idx) setChainDropIdx(idx); }}
                  onDragLeave={() => setChainDropIdx(prev => prev === idx ? null : prev)}
                  onDrop={e => { e.preventDefault(); if (chainDragIdx !== null && chainDragIdx !== idx) chainReorder(chainDragIdx, idx); setChainDragIdx(null); setChainDropIdx(null); }}
                  style={{
                    padding: '10px 12px', borderRadius: 10, cursor: chainDirty ? 'grab' : 'pointer',
                    border: isFocus ? `2px solid ${theme.accent}` : isDropTarget ? `2px dashed ${theme.accent}` : `1px solid ${isClosed ? theme.border + '88' : theme.border}`,
                    background: isDragging ? theme.accent + '18' : isFocus ? theme.accent + '12' : isClosed ? theme.bgSecondary + '88' : theme.bgSecondary,
                    opacity: isDragging ? 0.5 : isClosed && !isFocus ? 0.65 : 1,
                    transition: 'all 0.15s ease', userSelect: 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    {/* Drag handle */}
                    <div style={{ width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.textMuted + '88', fontSize: 10, cursor: 'grab', flexShrink: 0, paddingTop: 6 }}>{'\u2261'}</div>
                    {/* Status circle */}
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13,
                      background: isDone ? '#10B98120' : isFocus ? theme.accent + '22' : theme.bgTertiary,
                      border: `1px solid ${isDone ? '#10B981' : isFocus ? theme.accent : theme.border}`
                    }}>{icon}</div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: isFocus ? 700 : 600, color: isClosed ? theme.textMuted : theme.text, textDecoration: isClosed ? 'line-through' : 'none', lineHeight: '16px' }}>
                        {ct.text}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: theme.bgTertiary, color: theme.textMuted, fontWeight: 500 }}>{dateLabel}</span>
                        {ct.time && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: theme.bgTertiary, color: theme.textMuted, fontWeight: 500 }}>{ct.time}</span>}
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: (PRI_COLORS[ct.pri] || '#6B7280') + '18', color: PRI_COLORS[ct.pri] || '#6B7280', fontWeight: 600 }}>{ct.project}</span>
                        <span style={{ fontSize: 8, color: theme.textMuted + '88' }}>{ct.id}</span>
                        {isFocus && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: theme.accent, color: 'white', fontWeight: 700 }}>VIEWING</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: 9, color: theme.textMuted, fontWeight: 600, flexShrink: 0, paddingTop: 2 }}>#{idx + 1}</div>
                  </div>

                  {/* Dependency chips */}
                  <div style={{ marginTop: 6, marginLeft: 52 }}>
                    {(() => {
                      var myDeps = (chainDeps[ct.id] || []).filter(d => chainOrder.indexOf(d) >= 0);
                      return (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
                          {myDeps.length > 0 && <span style={{ fontSize: 8, color: theme.textMuted, marginRight: 2 }}>depends on:</span>}
                          {myDeps.map(depId => {
                            var depTask = allTasks.find(x => x.id === depId);
                            var depDone = (statuses[depId] || '') === 'done';
                            return (
                              <span key={depId} onClick={e => { e.stopPropagation(); chainRemoveDep(ct.id, depId); }} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, padding: '1px 6px', borderRadius: 4,
                                background: depDone ? '#10B98120' : '#F59E0B20', color: depDone ? '#10B981' : '#F59E0B',
                                fontWeight: 500, cursor: 'pointer'
                              }}>
                                {depDone ? '\u2713 ' : '\u23F3 '}
                                {depTask ? depTask.text.substring(0, 20) : depId}
                                <span style={{ marginLeft: 3, opacity: 0.6, fontSize: 8 }}>{'\u2715'}</span>
                              </span>
                            );
                          })}
                          <button onClick={e => { e.stopPropagation(); setChainAddDepFor(chainAddDepFor === ct.id ? null : ct.id); }} style={{
                            fontSize: 8, padding: '1px 6px', borderRadius: 4,
                            border: `1px dashed ${chainAddDepFor === ct.id ? theme.accent : theme.border}`,
                            background: chainAddDepFor === ct.id ? theme.accent + '15' : 'transparent',
                            color: chainAddDepFor === ct.id ? theme.accent : theme.textMuted,
                            cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit'
                          }}>{chainAddDepFor === ct.id ? 'cancel' : '+ dep'}</button>
                        </div>
                      );
                    })()}

                    {/* Add dep dropdown */}
                    {chainAddDepFor === ct.id && (() => {
                      var myDeps = chainDeps[ct.id] || [];
                      var inChain = chainOrder.filter(oid => oid !== ct.id && myDeps.indexOf(oid) < 0)
                        .map(oid => allTasks.find(x => x.id === oid)).filter(Boolean);
                      var sameProj = allTasks.filter(ot => {
                        if (!ot.project || ot.project !== ct.project) return false;
                        if (ot.id === ct.id) return false;
                        if (chainOrder.indexOf(ot.id) >= 0) return false;
                        if (myDeps.indexOf(ot.id) >= 0) return false;
                        var st2 = statuses[ot.id] || '';
                        return st2 !== 'done' && st2 !== 'cancel';
                      });

                      var renderRow = (ot, isExternal) => (
                        <div key={ot.id} onClick={() => chainAddDep(ct.id, ot.id)} style={{
                          padding: '3px 6px', borderRadius: 4, cursor: 'pointer', fontSize: 10,
                          display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2
                        }}>
                          <span style={{ fontSize: 9, opacity: 0.7 }}>{(statuses[ot.id] || '') === 'done' ? '\u2705' : '\u26AA'}</span>
                          <span style={{ fontWeight: 500, color: theme.text, flex: 1 }}>{ot.text.substring(0, 32)}</span>
                          <span style={{ fontSize: 8, color: theme.textMuted }}>{ot.id}</span>
                          {isExternal && <span style={{ fontSize: 7, padding: '0 3px', borderRadius: 3, background: '#F59E0B20', color: '#F59E0B', fontWeight: 600 }}>NEW</span>}
                        </div>
                      );

                      return (
                        <div onClick={e => e.stopPropagation()} style={{
                          marginTop: 4, padding: '6px 8px', background: theme.bgTertiary,
                          borderRadius: 6, border: `1px solid ${theme.border}`, maxHeight: 180, overflowY: 'auto'
                        }}>
                          {inChain.length > 0 && (
                            <div>
                              <div style={{ fontSize: 8, color: theme.textMuted, marginBottom: 3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>In chain</div>
                              {inChain.map(ot => renderRow(ot, false))}
                            </div>
                          )}
                          {sameProj.length > 0 && (
                            <div>
                              {inChain.length > 0 && <div style={{ height: 1, background: theme.border, margin: '6px 0' }} />}
                              <div style={{ fontSize: 8, color: theme.textMuted, marginBottom: 3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Same project</div>
                              {sameProj.map(ot => renderRow(ot, true))}
                            </div>
                          )}
                          {inChain.length === 0 && sameProj.length === 0 && (
                            <div style={{ fontSize: 10, color: theme.textMuted, padding: 8, textAlign: 'center' }}>No candidates available</div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                {/* Drop zone below */}
                {isDropTarget && chainDragIdx < idx && (
                  <div style={{ height: 3, background: theme.accent, borderRadius: 2, marginTop: 4 }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

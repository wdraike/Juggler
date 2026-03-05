/**
 * DependencyChainPopup — dagre layout + SVG edges for dependency chain visualization
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dagre from 'dagre';
import { getTheme } from '../../theme/colors';
import { getTaskDeps, topoSortTasks } from '../../scheduler/dependencyHelpers';
import { PRI_COLORS, STATUS_MAP } from '../../state/constants';

var STATUS_ICONS = { done: '\u2705', wip: '\u{1F7E1}', cancel: '\u274C', skip: '\u23ED\uFE0F', other: '\u27A1\uFE0F', '': '\u26AA' };
var ARROW_COLORS = ['#3B82F6', '#7C3AED', '#059669', '#DC2626', '#D97706', '#DB2777', '#0891B2'];
var NODE_W = 190;
var NODE_H = 54;

/** Use dagre to compute node positions for a top-to-bottom DAG */
function computeDagreLayout(taskIds, deps) {
  if (!taskIds || !taskIds.length) return { positions: {}, width: 0, height: 0 };
  var g = new dagre.graphlib.Graph().setDefaultEdgeLabel(function() { return {}; });
  g.setGraph({ rankdir: 'TB', nodesep: 28, ranksep: 56, marginx: 16, marginy: 16 });
  taskIds.forEach(function(id) { g.setNode(id, { width: NODE_W, height: NODE_H }); });
  taskIds.forEach(function(id) {
    (deps[id] || []).filter(function(d) { return taskIds.indexOf(d) >= 0; }).forEach(function(d) {
      g.setEdge(d, id);
    });
  });
  dagre.layout(g);
  var positions = {};
  var maxX = 0, maxY = 0;
  taskIds.forEach(function(id) {
    var n = g.node(id);
    if (n) {
      positions[id] = { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2 };
      if (n.x + NODE_W / 2 > maxX) maxX = n.x + NODE_W / 2;
      if (n.y + NODE_H / 2 > maxY) maxY = n.y + NODE_H / 2;
    }
  });
  return { positions: positions, width: maxX + 16, height: maxY + 16 };
}

export default function DependencyChainPopup({ focusTaskId, allTasks, statuses, onUpdate, onClose, darkMode, isMobile }) {
  var theme = getTheme(darkMode);
  var bodyRef = useRef(null);

  // Build chain data: BFS to find all tasks connected to focus (both directions)
  var chainData = useMemo(function() {
    if (!focusTaskId) return null;
    var MAX_CHAIN = 60;
    var chainIds = {};
    chainIds[focusTaskId] = true;
    var queue = [focusTaskId];
    while (queue.length > 0 && Object.keys(chainIds).length < MAX_CHAIN) {
      var id = queue.shift();
      var tt = allTasks.find(function(x) { return x.id === id; });
      if (tt && tt.dependsOn) {
        getTaskDeps(tt).forEach(function(pid) {
          if (!chainIds[pid]) { chainIds[pid] = true; queue.push(pid); }
        });
      }
      allTasks.forEach(function(ct) {
        if (ct.dependsOn && getTaskDeps(ct).indexOf(id) >= 0 && !chainIds[ct.id]) {
          chainIds[ct.id] = true; queue.push(ct.id);
        }
      });
    }
    var seen = {};
    var chainTasks = allTasks.filter(function(t) {
      if (!chainIds[t.id] || seen[t.id]) return false;
      seen[t.id] = true;
      return true;
    });
    var sorted = topoSortTasks(chainTasks);
    return { tasks: sorted, focusId: focusTaskId };
  }, [focusTaskId, allTasks]);

  // Chain order and deps state
  var [chainOrder, setChainOrder] = useState(null);
  var [chainDeps, setChainDeps] = useState({});
  var [chainDirty, setChainDirty] = useState(false);
  var [chainAddDepFor, setChainAddDepFor] = useState(null);
  var [chainDropIdx, setChainDropIdx] = useState(null);
  var [linkDragId, setLinkDragId] = useState(null);
  var dragModeRef = useRef(null);
  var justSavedRef = useRef(false);

  useEffect(function() {
    if (justSavedRef.current) { justSavedRef.current = false; return; }
    if (chainData) {
      var ids = chainData.tasks.map(function(t) { return t.id; });
      setChainOrder(ids);
      var chainSet = {};
      ids.forEach(function(id) { chainSet[id] = true; });
      var deps = {};
      chainData.tasks.forEach(function(t) {
        var taskDeps = getTaskDeps(t);
        deps[t.id] = taskDeps.filter(function(d) { return chainSet[d]; });
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

  var wouldCycle = useCallback(function(deps, taskId, depId) {
    var visited = {};
    function walk(id) {
      if (id === taskId) return true;
      if (visited[id]) return false;
      visited[id] = true;
      var d = deps[id] || [];
      for (var i = 0; i < d.length; i++) { if (walk(d[i])) return true; }
      return false;
    }
    return walk(depId);
  }, []);

  var chainAddDep = useCallback(function(taskId, depId) {
    if (taskId === depId) return;
    if (wouldCycle(chainDeps, taskId, depId)) return;
    setChainOrder(function(prev) {
      if (!prev) return prev;
      var arr = prev.slice();
      var hasTask = arr.indexOf(taskId) >= 0;
      var hasDep = arr.indexOf(depId) >= 0;
      if (hasTask && hasDep) return arr;
      var tIdx = arr.indexOf(taskId);
      if (!hasDep) arr.splice(tIdx >= 0 ? tIdx : 0, 0, depId);
      if (!hasTask) arr.push(taskId);
      return arr;
    });
    setChainDeps(function(prev) {
      var next = { ...prev };
      if (!next[depId]) {
        var dt = allTasks.find(function(x) { return x.id === depId; });
        next[depId] = dt ? getTaskDeps(dt).filter(function(d) { return next[d] !== undefined; }) : [];
      }
      if (!next[taskId]) {
        var tt = allTasks.find(function(x) { return x.id === taskId; });
        next[taskId] = tt ? getTaskDeps(tt).filter(function(d) { return next[d] !== undefined; }) : [];
      }
      var cur = (next[taskId] || []).slice();
      if (cur.indexOf(depId) < 0) cur.push(depId);
      next[taskId] = cur;
      return next;
    });
    setChainDirty(true);
    setChainAddDepFor(null);
  }, [allTasks, wouldCycle, chainDeps]);

  var chainRemoveDep = useCallback(function(taskId, depId) {
    setChainDeps(function(prev) {
      var cur = (prev[taskId] || []).slice();
      var idx = cur.indexOf(depId);
      if (idx >= 0) cur.splice(idx, 1);
      return { ...prev, [taskId]: cur };
    });
    setChainDirty(true);
  }, []);

  var chainSave = useCallback(function() {
    if (!chainOrder || chainOrder.length === 0) return;
    justSavedRef.current = true;
    var cs = {};
    chainOrder.forEach(function(id) { cs[id] = true; });
    chainOrder.forEach(function(id) {
      var task = allTasks.find(function(t) { return t.id === id; });
      if (!task) return;
      var inChainDeps = chainDeps[id] || [];
      var oldDeps = getTaskDeps(task);
      var externalDeps = oldDeps.filter(function(d) { return !cs[d]; });
      var finalDeps = externalDeps.concat(inChainDeps);
      var oldSorted = oldDeps.slice().sort().join(',');
      var newSorted = finalDeps.slice().sort().join(',');
      if (oldSorted === newSorted) return;
      onUpdate(id, { dependsOn: finalDeps.length > 0 ? finalDeps : [] });
    });
    setChainDirty(false);
  }, [chainOrder, chainDeps, allTasks, onUpdate]);

  var chainSet = useMemo(function() {
    var s = {};
    if (chainOrder) chainOrder.forEach(function(id) { s[String(id)] = true; });
    return s;
  }, [chainOrder]);

  if (!chainData || !chainOrder) return null;

  var orderedTasks = chainOrder.map(function(id) { return allTasks.find(function(t) { return t.id === id; }); }).filter(Boolean);
  var focusTask = allTasks.find(function(t) { return t.id === focusTaskId; });
  var focusProject = focusTask ? focusTask.project : null;

  var poolTasks = allTasks.filter(function(t) {
    if (!focusProject || t.project !== focusProject) return false;
    if (chainSet[String(t.id)]) return false;
    var st = statuses[t.id] || '';
    return st !== 'done' && st !== 'cancel';
  });

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 350, display: 'flex',
      alignItems: 'center', justifyContent: 'center'
    }} onClick={onClose}>
      <div style={{
        background: theme.bgSecondary, borderRadius: isMobile ? 0 : 12,
        width: isMobile ? '100%' : 960, maxWidth: isMobile ? '100%' : '95vw',
        height: isMobile ? '100%' : '90vh', maxHeight: isMobile ? '100%' : '90vh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: isMobile ? 'none' : '0 8px 32px ' + theme.shadow
      }} onClick={function(e) { e.stopPropagation(); }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', borderBottom: '1px solid ' + theme.border
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
        <TreeColumn
          bodyRef={bodyRef}
          chainOrder={chainOrder}
          chainDeps={chainDeps}
          chainData={chainData}
          chainAddDepFor={chainAddDepFor}
          setChainAddDepFor={setChainAddDepFor}
          chainDropIdx={chainDropIdx}
          wouldCycle={wouldCycle}
          setChainDropIdx={setChainDropIdx}
          linkDragId={linkDragId}
          setLinkDragId={setLinkDragId}
          dragModeRef={dragModeRef}
          chainAddDep={chainAddDep}
          chainRemoveDep={chainRemoveDep}
          allTasks={allTasks}
          statuses={statuses}
          theme={theme}
          focusTaskId={focusTaskId}
          poolTasks={poolTasks}
          focusProject={focusProject}
        />
      </div>
    </div>
  );
}

/** Tree column: dagre-positioned divs + SVG edge overlay */
function TreeColumn({ bodyRef, chainOrder, chainDeps, chainData, chainAddDepFor, setChainAddDepFor, chainDropIdx, setChainDropIdx, wouldCycle, linkDragId, setLinkDragId, dragModeRef, chainAddDep, chainRemoveDep, allTasks, statuses, theme, focusTaskId, poolTasks, focusProject }) {

  // Dagre layout
  var layout = useMemo(function() {
    if (!chainOrder) return { positions: {}, width: 0, height: 0 };
    // Only include tasks that participate in deps (or all if none have deps)
    var inTree = {};
    chainOrder.forEach(function(taskId) {
      var deps = (chainDeps[taskId] || []).filter(function(d) { return chainOrder.indexOf(d) >= 0; });
      if (deps.length > 0) {
        inTree[taskId] = true;
        deps.forEach(function(d) { inTree[d] = true; });
      }
    });
    if (Object.keys(inTree).length === 0) {
      chainOrder.forEach(function(id) { inTree[id] = true; });
    }
    var treeIds = chainOrder.filter(function(id) { return inTree[id]; });
    return computeDagreLayout(treeIds, chainDeps);
  }, [chainOrder, chainDeps]);

  var treeIds = useMemo(function() {
    return Object.keys(layout.positions);
  }, [layout]);

  // Build SVG edge paths
  var edgePaths = useMemo(function() {
    if (!chainOrder) return [];
    var paths = [];
    var colorIdx = 0;
    chainOrder.forEach(function(taskId) {
      if (!layout.positions[taskId]) return;
      (chainDeps[taskId] || []).filter(function(d) { return layout.positions[d]; }).forEach(function(depId) {
        var from = layout.positions[depId];
        var to = layout.positions[taskId];
        // From bottom-center of parent to top-center of child
        var x1 = from.x + NODE_W / 2;
        var y1 = from.y + NODE_H;
        var x2 = to.x + NODE_W / 2;
        var y2 = to.y;
        // Cubic bezier for smooth curve
        var midY = (y1 + y2) / 2;
        var d = 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + midY + ', ' + x2 + ' ' + midY + ', ' + x2 + ' ' + y2;
        var color = ARROW_COLORS[colorIdx % ARROW_COLORS.length];
        paths.push({ d: d, color: color, key: depId + '->' + taskId, x2: x2, y2: y2 });
        colorIdx++;
      });
    });
    return paths;
  }, [chainOrder, chainDeps, layout]);

  // Auto-scroll
  var scrollRafRef = useRef(null);
  var handleBodyDragOver = useCallback(function(e) {
    if (!bodyRef.current) return;
    var body = bodyRef.current;
    var rect = body.getBoundingClientRect();
    var y = e.clientY;
    var edge = 50;
    var speed = 0;
    if (y < rect.top + edge) {
      speed = -Math.max(3, ((rect.top + edge - y) / edge) * 12);
    } else if (y > rect.bottom - edge) {
      speed = Math.max(3, ((y - (rect.bottom - edge)) / edge) * 12);
    }
    if (speed !== 0) {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = requestAnimationFrame(function() { body.scrollTop += speed; });
    }
  }, [bodyRef]);

  useEffect(function() {
    return function() { if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current); };
  }, []);

  return (
    <div ref={bodyRef} onDragOver={handleBodyDragOver} style={{ flex: 1, overflow: 'auto', padding: 16, position: 'relative', minWidth: 0 }}>
      {/* Graph container: positioned nodes + SVG edges */}
      <div style={{ position: 'relative', width: layout.width, height: layout.height, margin: '0 auto' }}>
        {/* SVG edge layer — behind nodes */}
        <svg style={{ position: 'absolute', top: 0, left: 0, width: layout.width, height: layout.height, pointerEvents: 'none', overflow: 'visible' }}>
          <defs>
            {ARROW_COLORS.map(function(color, i) {
              return (
                <marker key={i} id={'arrow-' + i} viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 4 L 0 8 z" fill={color} />
                </marker>
              );
            })}
          </defs>
          {edgePaths.map(function(ep, idx) {
            var colorIdx = ARROW_COLORS.indexOf(ep.color);
            if (colorIdx < 0) colorIdx = idx % ARROW_COLORS.length;
            return (
              <path key={ep.key} d={ep.d} fill="none" stroke={ep.color} strokeWidth={1.8} opacity={0.5}
                markerEnd={'url(#arrow-' + colorIdx + ')'} />
            );
          })}
        </svg>

        {/* Node layer — absolutely positioned divs */}
        {treeIds.map(function(taskId) {
          var pos = layout.positions[taskId];
          if (!pos) return null;
          var ct = allTasks.find(function(t) { return t.id === taskId; });
          if (!ct) return null;
          var st = statuses[ct.id] || '';
          var isFocus = ct.id === chainData.focusId;
          var isDone = st === 'done';
          var isClosed = isDone || st === 'skip' || st === 'cancel';
          var icon = STATUS_ICONS[st] || '\u26AA';
          var dateLabel = ct.date && ct.date !== 'TBD' ? ct.date : null;
          var isDragging = linkDragId === ct.id;
          var isLinkDropTarget = linkDragId && linkDragId !== ct.id && chainDropIdx === ct.id;
          var dropWouldCycle = isLinkDropTarget && wouldCycle(chainDeps, ct.id, linkDragId);

          return (
            <div
              key={ct.id}
              data-chain-id={ct.id}
              draggable
              onDragStart={function(e) {
                dragModeRef.current = 'link';
                setLinkDragId(ct.id);
                e.dataTransfer.effectAllowed = 'link';
                e.dataTransfer.setData('text/plain', ct.id);
              }}
              onDragEnd={function() { setChainDropIdx(null); setLinkDragId(null); dragModeRef.current = null; }}
              onDragOver={function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'link';
                if (linkDragId && linkDragId !== ct.id) setChainDropIdx(ct.id);
              }}
              onDragLeave={function() { setChainDropIdx(function(prev) { return prev === ct.id ? null : prev; }); }}
              onDrop={function(e) {
                e.preventDefault();
                if (linkDragId && linkDragId !== ct.id && (chainDeps[ct.id] || []).indexOf(linkDragId) < 0) {
                  chainAddDep(ct.id, linkDragId);
                }
                setChainDropIdx(null); setLinkDragId(null); dragModeRef.current = null;
              }}
              style={{
                position: 'absolute', left: pos.x, top: pos.y, width: NODE_W,
                padding: '4px 7px', borderRadius: 6, cursor: 'grab',
                border: isFocus ? '2px solid ' + theme.accent
                  : isLinkDropTarget ? (dropWouldCycle ? '2px dashed #DC2626' : '2px dashed #3B82F6')
                  : '1px solid ' + (isClosed ? theme.border + '88' : theme.border),
                background: isDragging ? theme.accent + '18' : isFocus ? theme.accent + '12' : isClosed ? theme.bgSecondary + '88' : theme.bgSecondary,
                opacity: isDragging ? 0.5 : isClosed && !isFocus ? 0.65 : 1,
                transition: 'all 0.15s ease', userSelect: 'none',
                display: 'flex', flexDirection: 'column', gap: 2, boxSizing: 'border-box',
                zIndex: 1
              }}
            >
              {/* Row 1: status + name */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
                <span style={{ fontSize: 10, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                <div style={{
                  fontSize: 10, fontWeight: isFocus ? 700 : 600,
                  color: isClosed ? theme.textMuted : theme.text,
                  textDecoration: isClosed ? 'line-through' : 'none',
                  lineHeight: '13px', minWidth: 0
                }}>
                  {ct.text}
                </div>
              </div>
              {/* Row 2: badges + dep chips */}
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                {dateLabel && <span style={{ fontSize: 9, padding: '0px 4px', borderRadius: 3, background: theme.bgTertiary, color: theme.textMuted, fontWeight: 500 }}>{dateLabel}</span>}
                {isFocus && <span style={{ fontSize: 8, padding: '0px 4px', borderRadius: 3, background: theme.accent, color: 'white', fontWeight: 700 }}>FOCUS</span>}
                {(function() {
                  var myDeps = (chainDeps[ct.id] || []).filter(function(d) { return chainOrder.indexOf(d) >= 0; });
                  return myDeps.map(function(depId) {
                    var depTask = allTasks.find(function(x) { return x.id === depId; });
                    var depDone = (statuses[depId] || '') === 'done';
                    return (
                      <span key={depId} onClick={function(e) { e.stopPropagation(); chainRemoveDep(ct.id, depId); }} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, padding: '0px 4px', borderRadius: 3,
                        background: depDone ? '#10B98118' : '#F59E0B18', color: depDone ? '#10B981' : '#D97706',
                        fontWeight: 500, cursor: 'pointer'
                      }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                          {depDone ? '\u2713' : '\u23F3'} {depTask ? depTask.text.substring(0, 20) : depId}
                        </span>
                        <span style={{ opacity: 0.5, fontSize: 8, flexShrink: 0 }}>{'\u2715'}</span>
                      </span>
                    );
                  });
                })()}
                <button onClick={function(e) { e.stopPropagation(); setChainAddDepFor(chainAddDepFor === ct.id ? null : ct.id); }} style={{
                  fontSize: 8, padding: '0px 4px', borderRadius: 3,
                  border: '1px dashed ' + (chainAddDepFor === ct.id ? theme.accent : theme.border),
                  background: chainAddDepFor === ct.id ? theme.accent + '15' : 'transparent',
                  color: chainAddDepFor === ct.id ? theme.accent : theme.textMuted,
                  cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit'
                }}>{chainAddDepFor === ct.id ? 'cancel' : '+ dep'}</button>
              </div>
              {/* Link drop indicator */}
              {isLinkDropTarget && (function() {
                var draggedTask = allTasks.find(function(x) { return x.id === linkDragId; });
                var alreadyDep = (chainDeps[ct.id] || []).indexOf(linkDragId) >= 0;
                if (alreadyDep) return null;
                var isCycle = wouldCycle(chainDeps, ct.id, linkDragId);
                return (
                  <div style={{ fontSize: 9, color: isCycle ? '#DC2626' : '#3B82F6', padding: '2px 0', borderTop: '1px dashed ' + (isCycle ? '#DC262644' : '#3B82F644') }}>
                    {isCycle
                      ? '\u26D4 circular dependency!'
                      : '\u21B3 depends on \u201C' + (draggedTask ? draggedTask.text.substring(0, 22) : linkDragId) + '\u201D'}
                  </div>
                );
              })()}
              {/* Add dep dropdown */}
              {chainAddDepFor === ct.id && (function() {
                var myDeps = chainDeps[ct.id] || [];
                var inChain = chainOrder.filter(function(oid) { return oid !== ct.id && myDeps.indexOf(oid) < 0; })
                  .map(function(oid) { return allTasks.find(function(x) { return x.id === oid; }); }).filter(Boolean);
                var sameProj = allTasks.filter(function(ot) {
                  if (!ot.project || ot.project !== ct.project) return false;
                  if (ot.id === ct.id) return false;
                  if (chainOrder.indexOf(ot.id) >= 0) return false;
                  if (myDeps.indexOf(ot.id) >= 0) return false;
                  var st2 = statuses[ot.id] || '';
                  return st2 !== 'done' && st2 !== 'cancel';
                });

                var renderRow = function(ot, isExternal) {
                  return (
                    <div key={ot.id} onClick={function() { chainAddDep(ct.id, ot.id); }} style={{
                      padding: '4px 5px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                      display: 'flex', gap: 5, alignItems: 'center', marginBottom: 1
                    }}>
                      <span style={{ fontSize: 9, opacity: 0.7 }}>{(statuses[ot.id] || '') === 'done' ? '\u2705' : '\u26AA'}</span>
                      <span style={{ fontWeight: 500, color: theme.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ot.text}</span>
                      {isExternal && <span style={{ fontSize: 8, padding: '0 3px', borderRadius: 2, background: '#F59E0B20', color: '#F59E0B', fontWeight: 600 }}>NEW</span>}
                    </div>
                  );
                };

                return (
                  <div onClick={function(e) { e.stopPropagation(); }} style={{
                    padding: '6px 8px', background: theme.bgTertiary,
                    borderRadius: 6, border: '1px solid ' + theme.border, maxHeight: 200, overflowY: 'auto',
                    position: 'absolute', bottom: '100%', left: 0, width: 260, marginBottom: 4,
                    zIndex: 100, boxShadow: '0 4px 16px rgba(0,0,0,0.18)'
                  }}>
                    {inChain.length > 0 && (
                      <div>
                        <div style={{ fontSize: 9, color: theme.textMuted, marginBottom: 3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>In chain</div>
                        {inChain.map(function(ot) { return renderRow(ot, false); })}
                      </div>
                    )}
                    {sameProj.length > 0 && (
                      <div>
                        {inChain.length > 0 && <div style={{ height: 1, background: theme.border, margin: '4px 0' }} />}
                        <div style={{ fontSize: 9, color: theme.textMuted, marginBottom: 3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Same project</div>
                        {sameProj.map(function(ot) { return renderRow(ot, true); })}
                      </div>
                    )}
                    {inChain.length === 0 && sameProj.length === 0 && (
                      <div style={{ fontSize: 9, color: theme.textMuted, padding: 6, textAlign: 'center' }}>No candidates</div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* Pool: available tasks not yet in chain */}
      {poolTasks && poolTasks.length > 0 && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0 12px',
            color: theme.textMuted, fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase'
          }}>
            <div style={{ flex: 1, height: 1, background: theme.border }} />
            <span>Available tasks</span>
            <div style={{ flex: 1, height: 1, background: theme.border }} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
            {poolTasks.map(function(pt) {
              var ptSt = statuses[pt.id] || '';
              var ptIcon = STATUS_ICONS[ptSt] || '\u26AA';
              var isPoolDragging = linkDragId === pt.id;
              var isPoolDropTarget = linkDragId && linkDragId !== pt.id && chainDropIdx === pt.id;
              return (
                <div
                  key={pt.id}
                  data-chain-id={pt.id}
                  draggable
                  onMouseDown={function() { dragModeRef.current = 'link'; }}
                  onDragStart={function(e) {
                    dragModeRef.current = 'link';
                    setLinkDragId(pt.id);
                    e.dataTransfer.effectAllowed = 'link';
                    e.dataTransfer.setData('text/plain', pt.id);
                  }}
                  onDragEnd={function() { setLinkDragId(null); setChainDropIdx(null); dragModeRef.current = null; }}
                  onDragOver={function(e) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'link';
                    if (linkDragId && linkDragId !== pt.id) setChainDropIdx(pt.id);
                  }}
                  onDragLeave={function() { setChainDropIdx(function(prev) { return prev === pt.id ? null : prev; }); }}
                  onDrop={function(e) {
                    e.preventDefault();
                    if (linkDragId && linkDragId !== pt.id) {
                      chainAddDep(pt.id, linkDragId);
                    }
                    setChainDropIdx(null); setLinkDragId(null); dragModeRef.current = null;
                  }}
                  style={{
                    width: 155, flexShrink: 0, padding: '4px 7px', borderRadius: 6, cursor: 'grab',
                    border: isPoolDropTarget ? '2px dashed #3B82F6'
                      : '1px solid ' + (isPoolDragging ? '#3B82F6' : theme.border),
                    background: isPoolDragging ? '#3B82F620' : isPoolDropTarget ? '#3B82F610' : theme.bgTertiary,
                    opacity: isPoolDragging ? 0.6 : 1,
                    transition: 'all 0.15s ease', userSelect: 'none',
                    display: 'flex', flexDirection: 'column', gap: 2
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
                    <span style={{ fontSize: 10, flexShrink: 0, marginTop: 1 }}>{ptIcon}</span>
                    <div style={{ fontSize: 10, fontWeight: 600, color: theme.text, flex: 1, minWidth: 0, lineHeight: '13px' }}>
                      {pt.text}
                    </div>
                  </div>
                  {isPoolDropTarget && (function() {
                    var draggedTask = allTasks.find(function(x) { return x.id === linkDragId; });
                    var isCycle = wouldCycle(chainDeps, pt.id, linkDragId);
                    return (
                      <div style={{ fontSize: 8, color: isCycle ? '#DC2626' : '#3B82F6', padding: '2px 0', marginTop: 2, borderTop: '1px dashed ' + (isCycle ? '#DC262644' : '#3B82F644') }}>
                        {isCycle
                          ? '\u26D4 circular dependency!'
                          : '\u21B3 depends on \u201C' + (draggedTask ? draggedTask.text.substring(0, 18) : linkDragId) + '\u201D'}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

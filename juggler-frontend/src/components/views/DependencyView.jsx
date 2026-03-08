/**
 * DependencyView — full-screen dagre-layout dependency graph.
 * Shows all tasks that have dependencies (or belong to the selected project).
 * Uses the project filter from NavigationBar to focus on specific projects.
 * Arrow-drag from connector handles to create new dependency links.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dagre from 'dagre';
import { getTheme } from '../../theme/colors';
import { getTaskDeps, topoSortTasks } from '../../scheduler/dependencyHelpers';
import { PRI_COLORS } from '../../state/constants';

var STATUS_ICONS = { done: '\u2705', wip: '\u{1F7E1}', cancel: '\u274C', skip: '\u23ED\uFE0F', other: '\u27A1\uFE0F', '': '\u26AA' };
var ARROW_COLORS = ['#3B82F6', '#7C3AED', '#059669', '#DC2626', '#D97706', '#DB2777', '#0891B2'];
var NODE_W = 180;
var NODE_H = 48;
var HANDLE_R = 5;

function computeDagreLayout(taskIds, deps) {
  if (!taskIds || !taskIds.length) return { positions: {}, width: 0, height: 0 };
  var g = new dagre.graphlib.Graph().setDefaultEdgeLabel(function() { return {}; });
  g.setGraph({ rankdir: 'TB', nodesep: 16, ranksep: 40, marginx: 16, marginy: 16 });
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

/** Find which task node (if any) is under a point, given layout positions.
 *  Expands hit area by PAD pixels for easier targeting during arrow drag. */
function hitTestNode(x, y, positions) {
  var PAD = 6;
  var ids = Object.keys(positions);
  for (var i = 0; i < ids.length; i++) {
    var p = positions[ids[i]];
    if (x >= p.x - PAD && x <= p.x + NODE_W + PAD && y >= p.y - PAD && y <= p.y + NODE_H + PAD) {
      return ids[i];
    }
  }
  return null;
}

export default function DependencyView({ allTasks, statuses, projectFilter, filter, search, hideHabits, onUpdate, onExpand, darkMode, isMobile }) {
  var theme = getTheme(darkMode);
  var bodyRef = useRef(null);
  var graphRef = useRef(null);
  var svgRef = useRef(null);

  // Zoom state
  var [zoom, setZoom] = useState(1);
  var MIN_ZOOM = 0.25;
  var MAX_ZOOM = 2;
  var ZOOM_STEP = 0.1;

  // Wheel zoom on the graph body
  useEffect(function() {
    var el = bodyRef.current;
    if (!el) return;
    function onWheel(e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      var delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom(function(z) { return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((z + delta) * 100) / 100)); });
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return function() { el.removeEventListener('wheel', onWheel); };
  }, []);

  // Arrow-drag state (mouse-based, not HTML5 drag)
  var [arrowDrag, setArrowDrag] = useState(null); // { fromId, fromX, fromY, toX, toY }
  var [arrowHoverId, setArrowHoverId] = useState(null);
  var arrowDragRef = useRef(null);

  // Build the set of tasks to display, applying all active filters
  var graphData = useMemo(function() {
    // Helper: does a task match the status filter?
    function matchesStatus(t) {
      var s = statuses[t.id] || '';
      if (filter === 'all') return true;
      if (filter === 'open') return s !== 'done' && s !== 'cancel' && s !== 'skip';
      if (filter === 'done') return s === 'done';
      if (filter === 'wip') return s === 'wip';
      if (filter === 'blocked') return s !== 'done' && s !== 'cancel';
      if (filter === 'action') return s !== 'done' && s !== 'cancel' && s !== 'skip';
      if (filter === 'unplaced') return !t.date && s !== 'done' && s !== 'cancel' && s !== 'skip';
      return true;
    }

    // Helper: does a task match the search query?
    var searchLower = search ? search.toLowerCase() : '';
    function matchesSearch(t) {
      if (!searchLower) return true;
      return (t.text && t.text.toLowerCase().indexOf(searchLower) >= 0)
        || (t.project && t.project.toLowerCase().indexOf(searchLower) >= 0)
        || (t.notes && t.notes.toLowerCase().indexOf(searchLower) >= 0);
    }

    // Step 1: Start with base candidates (project or has-deps)
    var candidateTasks;
    if (projectFilter) {
      candidateTasks = allTasks.filter(function(t) { return t.project === projectFilter; });
    } else {
      var hasDeps = {};
      allTasks.forEach(function(t) {
        var deps = getTaskDeps(t);
        if (deps.length > 0) {
          hasDeps[t.id] = true;
          deps.forEach(function(d) { hasDeps[d] = true; });
        }
      });
      candidateTasks = allTasks.filter(function(t) { return hasDeps[t.id]; });
    }

    // Step 2: Apply filters (status, search, hideHabits) to find matching tasks
    var matchingIds = {};
    candidateTasks.forEach(function(t) {
      if (hideHabits && t.habit) return;
      if (!matchesStatus(t)) return;
      if (!matchesSearch(t)) return;
      matchingIds[t.id] = true;
    });

    // Step 3: Pull in connected tasks (deps/dependents) of matching tasks so the graph stays connected
    var visibleIds = {};
    Object.keys(matchingIds).forEach(function(id) { visibleIds[id] = true; });

    // Pull in direct dependencies
    candidateTasks.forEach(function(t) {
      if (!visibleIds[t.id]) return;
      getTaskDeps(t).forEach(function(depId) {
        visibleIds[depId] = true;
      });
    });
    // Pull in dependents pointing to visible tasks
    allTasks.forEach(function(t) {
      if (visibleIds[t.id]) return;
      var deps = getTaskDeps(t);
      for (var i = 0; i < deps.length; i++) {
        if (visibleIds[deps[i]]) { visibleIds[t.id] = true; break; }
      }
    });

    // Collect visible tasks, deduplicate
    var seen = {};
    var visibleTasks = allTasks.filter(function(t) {
      if (!visibleIds[t.id] || seen[t.id]) return false;
      seen[t.id] = true;
      return true;
    });

    return { tasks: topoSortTasks(visibleTasks), matchingIds: matchingIds };
  }, [allTasks, statuses, projectFilter, filter, search, hideHabits]);

  // Chain order and deps state
  var [chainOrder, setChainOrder] = useState(null);
  var [chainDeps, setChainDeps] = useState({});
  var [chainAddDepFor, setChainAddDepFor] = useState(null);
  var justSavedRef = useRef(false);

  useEffect(function() {
    if (justSavedRef.current) { justSavedRef.current = false; return; }
    if (graphData && graphData.tasks.length > 0) {
      var ids = graphData.tasks.map(function(t) { return t.id; });
      setChainOrder(ids);
      var chainSet = {};
      ids.forEach(function(id) { chainSet[id] = true; });
      var deps = {};
      graphData.tasks.forEach(function(t) {
        var taskDeps = getTaskDeps(t);
        deps[t.id] = taskDeps.filter(function(d) { return chainSet[d]; });
      });
      setChainDeps(deps);
      setChainAddDepFor(null);
    } else {
      setChainOrder(null);
      setChainDeps({});
      setChainAddDepFor(null);
    }
  }, [graphData]);

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

  /** Persist deps for a single task immediately */
  var persistDeps = useCallback(function(taskId, newLocalDeps) {
    justSavedRef.current = true;
    var task = allTasks.find(function(t) { return t.id === taskId; });
    if (!task) return;
    var cs = {};
    if (chainOrder) chainOrder.forEach(function(id) { cs[id] = true; });
    var oldDeps = getTaskDeps(task);
    var externalDeps = oldDeps.filter(function(d) { return !cs[d]; });
    var finalDeps = externalDeps.concat(newLocalDeps);
    onUpdate(taskId, { dependsOn: finalDeps.length > 0 ? finalDeps : [] });
  }, [allTasks, chainOrder, onUpdate]);

  var chainAddDep = useCallback(function(taskId, depId) {
    if (taskId === depId) return;
    if (wouldCycle(chainDeps, taskId, depId)) return;
    var newDeps;
    setChainDeps(function(prev) {
      var next = Object.assign({}, prev);
      var cur = (next[taskId] || []).slice();
      if (cur.indexOf(depId) < 0) cur.push(depId);
      next[taskId] = cur;
      newDeps = cur;
      return next;
    });
    setChainAddDepFor(null);
    // Auto-save
    var cur = (chainDeps[taskId] || []).slice();
    if (cur.indexOf(depId) < 0) cur.push(depId);
    persistDeps(taskId, cur);
  }, [wouldCycle, chainDeps, persistDeps]);

  var chainRemoveDep = useCallback(function(taskId, depId) {
    var newDeps;
    setChainDeps(function(prev) {
      var cur = (prev[taskId] || []).slice();
      var idx = cur.indexOf(depId);
      if (idx >= 0) cur.splice(idx, 1);
      newDeps = cur;
      return Object.assign({}, prev, { [taskId]: cur });
    });
    // Auto-save
    var cur = (chainDeps[taskId] || []).slice();
    var idx = cur.indexOf(depId);
    if (idx >= 0) cur.splice(idx, 1);
    persistDeps(taskId, cur);
  }, [chainDeps, persistDeps]);

  // Dagre layout
  var layout = useMemo(function() {
    if (!chainOrder) return { positions: {}, width: 0, height: 0 };
    return computeDagreLayout(chainOrder, chainDeps);
  }, [chainOrder, chainDeps]);

  var treeIds = useMemo(function() {
    return Object.keys(layout.positions);
  }, [layout]);

  // SVG edge paths
  var edgePaths = useMemo(function() {
    if (!chainOrder) return [];
    var paths = [];
    var colorIdx = 0;
    chainOrder.forEach(function(taskId) {
      if (!layout.positions[taskId]) return;
      (chainDeps[taskId] || []).filter(function(d) { return layout.positions[d]; }).forEach(function(depId) {
        var from = layout.positions[depId];
        var to = layout.positions[taskId];
        var x1 = from.x + NODE_W / 2;
        var y1 = from.y + NODE_H;
        var x2 = to.x + NODE_W / 2;
        var y2 = to.y;
        var midY = (y1 + y2) / 2;
        var d = 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + midY + ', ' + x2 + ' ' + midY + ', ' + x2 + ' ' + y2;
        var color = ARROW_COLORS[colorIdx % ARROW_COLORS.length];
        paths.push({ d: d, color: color, key: depId + '->' + taskId });
        colorIdx++;
      });
    });
    return paths;
  }, [chainOrder, chainDeps, layout]);

  // ── Arrow-drag: mousedown on handle → mousemove draws arrow → mouseup on target creates dep ──

  /** Convert client (viewport) coords to graph-container-relative coords.
   *  Uses graphRef (the positioned container) so margin:auto centering is handled.
   *  Divides by zoom since the container is CSS-scaled. */
  var clientToGraph = useCallback(function(clientX, clientY) {
    if (!graphRef.current) return { x: clientX, y: clientY };
    var rect = graphRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / zoom,
      y: (clientY - rect.top) / zoom
    };
  }, [zoom]);

  var handleConnectorMouseDown = useCallback(function(taskId, e) {
    e.preventDefault();
    e.stopPropagation();
    var pos = layout.positions[taskId];
    if (!pos) return;
    var startX = pos.x + NODE_W / 2;
    var startY = pos.y + NODE_H;
    var gPt = clientToGraph(e.clientX, e.clientY);
    var state = { fromId: taskId, fromX: startX, fromY: startY, toX: gPt.x, toY: gPt.y };
    arrowDragRef.current = state;
    setArrowDrag(state);
    setArrowHoverId(null);
  }, [layout.positions, clientToGraph]);

  useEffect(function() {
    function onMouseMove(e) {
      if (!arrowDragRef.current) return;
      var gPt = clientToGraph(e.clientX, e.clientY);
      var next = Object.assign({}, arrowDragRef.current, { toX: gPt.x, toY: gPt.y });
      arrowDragRef.current = next;
      setArrowDrag(next);
      // Hit-test for hover highlight
      var hitId = hitTestNode(gPt.x, gPt.y, layout.positions);
      setArrowHoverId(hitId && hitId !== arrowDragRef.current.fromId ? hitId : null);
    }
    function onMouseUp(e) {
      if (!arrowDragRef.current) return;
      var gPt = clientToGraph(e.clientX, e.clientY);
      var hitId = hitTestNode(gPt.x, gPt.y, layout.positions);
      if (hitId && hitId !== arrowDragRef.current.fromId) {
        // fromId → hitId means hitId depends on fromId
        chainAddDep(hitId, arrowDragRef.current.fromId);
      }
      arrowDragRef.current = null;
      setArrowDrag(null);
      setArrowHoverId(null);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return function() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [layout.positions, clientToGraph, chainAddDep]);

  // Build the live drag arrow path — arrow tip lands at cursor (or target top-center)
  var dragArrowPath = useMemo(function() {
    if (!arrowDrag) return null;
    var x1 = arrowDrag.fromX, y1 = arrowDrag.fromY;
    var x2 = arrowDrag.toX, y2 = arrowDrag.toY;
    // When hovering a target, snap arrow tip to its top-center
    if (arrowHoverId && layout.positions[arrowHoverId]) {
      var tp = layout.positions[arrowHoverId];
      x2 = tp.x + NODE_W / 2;
      y2 = tp.y;
    }
    // Control points: cp1 leaves the source downward, cp2 arrives at the
    // endpoint from the source direction so the arrowhead points correctly.
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var pull = Math.min(len * 0.35, 60); // how far control points pull away
    // cp1: depart source going straight down
    var cp1x = x1;
    var cp1y = y1 + pull;
    // cp2: arrive at endpoint from behind (along the source→endpoint direction)
    // This makes the tangent at the tip point from source toward endpoint
    var cp2x = x2 - (dx / len) * pull;
    var cp2y = y2 - (dy / len) * pull;
    var d = 'M ' + x1 + ' ' + y1 + ' C ' + cp1x + ' ' + cp1y + ', ' + cp2x + ' ' + cp2y + ', ' + x2 + ' ' + y2;
    var isCycle = arrowHoverId && wouldCycle(chainDeps, arrowHoverId, arrowDrag.fromId);
    return { d: d, isCycle: isCycle };
  }, [arrowDrag, arrowHoverId, layout.positions, chainDeps, wouldCycle]);

  if (!chainOrder || chainOrder.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.textMuted, fontSize: 14 }}>
        {projectFilter
          ? 'No tasks in project "' + projectFilter + '"'
          : 'No tasks with dependencies. Use the project filter to view a project\'s tasks.'}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 12px', borderBottom: '1px solid ' + theme.border, flexShrink: 0
      }}>
        <div style={{ fontSize: 11, color: theme.textMuted }}>
          {treeIds.length} tasks{projectFilter ? ' in ' + projectFilter : ' with dependencies'}
          {search ? ' matching "' + search + '"' : ''}
          {' \u2014 drag the handle below a card to draw an arrow'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={function() { setZoom(function(z) { return Math.max(MIN_ZOOM, Math.round((z - ZOOM_STEP) * 100) / 100); }); }}
            style={{ border: '1px solid ' + theme.border, borderRadius: 4, width: 22, height: 22, cursor: 'pointer', background: theme.bgSecondary, color: theme.text, fontSize: 13, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Zoom out">&minus;</button>
          <span onClick={function() { setZoom(1); }} style={{ fontSize: 10, color: theme.textMuted, cursor: 'pointer', minWidth: 32, textAlign: 'center' }} title="Reset zoom">
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={function() { setZoom(function(z) { return Math.min(MAX_ZOOM, Math.round((z + ZOOM_STEP) * 100) / 100); }); }}
            style={{ border: '1px solid ' + theme.border, borderRadius: 4, width: 22, height: 22, cursor: 'pointer', background: theme.bgSecondary, color: theme.text, fontSize: 13, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Zoom in">+</button>
        </div>
      </div>

      {/* Graph body */}
      <div ref={bodyRef} style={{
        flex: 1, overflow: 'auto', padding: 16, position: 'relative', minWidth: 0,
        cursor: arrowDrag ? 'crosshair' : undefined
      }}>
        {/* Spacer sized to the scaled graph so scroll area is correct */}
        <div style={{ width: layout.width * zoom, height: layout.height * zoom, margin: '0 auto', position: 'relative' }}>
        <div ref={graphRef} style={{
          position: 'absolute', top: 0, left: 0,
          width: layout.width, height: layout.height,
          transform: 'scale(' + zoom + ')',
          transformOrigin: '0 0'
        }}>
          {/* SVG edge layer */}
          <svg ref={svgRef} style={{ position: 'absolute', top: 0, left: 0, width: Math.max(layout.width, 1), height: Math.max(layout.height, 1), pointerEvents: 'none', overflow: 'visible' }}>
            <defs>
              {ARROW_COLORS.map(function(color, i) {
                return (
                  <marker key={i} id={'dep-arrow-' + i} viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 4 L 0 8 z" fill={color} />
                  </marker>
                );
              })}
              <marker id="dep-arrow-drag" viewBox="0 0 10 8" refX="10" refY="4" markerWidth="10" markerHeight="8" orient="auto-start-reverse">
                <path d="M 0 0 L 10 4 L 0 8 z" fill="#3B82F6" />
              </marker>
              <marker id="dep-arrow-drag-err" viewBox="0 0 10 8" refX="10" refY="4" markerWidth="10" markerHeight="8" orient="auto-start-reverse">
                <path d="M 0 0 L 10 4 L 0 8 z" fill="#DC2626" />
              </marker>
            </defs>
            {/* Existing edges */}
            {edgePaths.map(function(ep, idx) {
              var ci = ARROW_COLORS.indexOf(ep.color);
              if (ci < 0) ci = idx % ARROW_COLORS.length;
              return (
                <path key={ep.key} d={ep.d} fill="none" stroke={ep.color} strokeWidth={1.8} opacity={0.5}
                  markerEnd={'url(#dep-arrow-' + ci + ')'} />
              );
            })}
            {/* Live drag arrow */}
            {dragArrowPath && (
              <path d={dragArrowPath.d} fill="none"
                stroke={dragArrowPath.isCycle ? '#DC2626' : '#3B82F6'}
                strokeWidth={2.2}
                strokeDasharray={arrowHoverId ? 'none' : '6 4'}
                opacity={0.8}
                markerEnd={dragArrowPath.isCycle ? 'url(#dep-arrow-drag-err)' : 'url(#dep-arrow-drag)'}
                style={{ transition: arrowHoverId ? 'none' : undefined }}
              />
            )}
          </svg>

          {/* Nodes */}
          {treeIds.map(function(taskId) {
            var pos = layout.positions[taskId];
            if (!pos) return null;
            var ct = allTasks.find(function(t) { return t.id === taskId; });
            if (!ct) return null;
            var st = statuses[ct.id] || '';
            var isDone = st === 'done';
            var isClosed = isDone || st === 'skip' || st === 'cancel';
            var icon = STATUS_ICONS[st] || '\u26AA';
            var dateLabel = ct.date && ct.date !== 'TBD' ? ct.date : null;
            var isExternal = projectFilter && ct.project !== projectFilter;
            var isMatched = graphData.matchingIds[ct.id];
            var isDimmed = (filter !== 'all' || search || hideHabits) && !isMatched;
            var isHoverTarget = arrowHoverId === ct.id;
            var isCycleDrop = isHoverTarget && arrowDrag && wouldCycle(chainDeps, ct.id, arrowDrag.fromId);
            var isArrowSource = arrowDrag && arrowDrag.fromId === ct.id;

            return (
              <div key={ct.id} onClick={function(e) { e.stopPropagation(); if (onExpand) onExpand(ct.id); }}
                style={{ position: 'absolute', left: pos.x, top: pos.y, width: NODE_W }}>
                {/* Card */}
                <div
                  style={{
                    padding: '4px 6px', borderRadius: 5, cursor: 'pointer',
                    border: isHoverTarget
                      ? '2px solid ' + (isCycleDrop ? '#DC2626' : '#3B82F6')
                      : isArrowSource ? '2px solid ' + theme.accent
                      : isMatched && !isDimmed && (filter !== 'all' || search || hideHabits) ? '2px solid ' + theme.accent
                      : '1px solid ' + (isClosed ? theme.border + '88' : theme.border),
                    background: isHoverTarget ? (isCycleDrop ? '#DC262612' : '#3B82F612')
                      : isMatched && !isDimmed && (filter !== 'all' || search || hideHabits) ? theme.accent + '12'
                      : isExternal ? (darkMode ? '#1E293B' : '#F8FAFC')
                      : isClosed ? theme.bgSecondary + '88' : theme.bgSecondary,
                    opacity: isDimmed ? 0.3 : isClosed ? 0.6 : isExternal ? 0.75 : 1,
                    transition: 'border 0.1s, background 0.1s, opacity 0.2s', userSelect: 'none',
                    display: 'flex', flexDirection: 'column', gap: 1, boxSizing: 'border-box'
                  }}
                >
                  {/* Row 1: status + name */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
                    <span style={{ fontSize: 9, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                    <div style={{
                      fontSize: 10, fontWeight: 600,
                      color: isClosed ? theme.textMuted : theme.text,
                      textDecoration: isClosed ? 'line-through' : 'none',
                      lineHeight: '12px', minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
                    }}>
                      {ct.text}
                    </div>
                  </div>
                  {/* Row 2: badges + dep chips */}
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                    {ct.project && (
                      <span style={{ fontSize: 7, padding: '0px 3px', borderRadius: 2, background: theme.accent + '18', color: theme.accent, fontWeight: 600 }}>{ct.project}</span>
                    )}
                    {dateLabel && <span style={{ fontSize: 7, padding: '0px 3px', borderRadius: 2, background: theme.bgTertiary, color: theme.textMuted, fontWeight: 500 }}>{dateLabel}</span>}
                    {ct.pri && ct.pri !== 'P3' && (
                      <span style={{ fontSize: 7, padding: '0px 3px', borderRadius: 2, background: (PRI_COLORS[ct.pri] || '#888') + '20', color: PRI_COLORS[ct.pri] || '#888', fontWeight: 600 }}>{ct.pri}</span>
                    )}
                    {(function() {
                      var myDeps = (chainDeps[ct.id] || []).filter(function(d) { return chainOrder.indexOf(d) >= 0; });
                      return myDeps.map(function(depId) {
                        var depTask = allTasks.find(function(x) { return x.id === depId; });
                        var depDone = (statuses[depId] || '') === 'done';
                        return (
                          <span key={depId} onClick={function(e) { e.stopPropagation(); chainRemoveDep(ct.id, depId); }} title={'Remove dep on \u201C' + (depTask ? depTask.text : depId) + '\u201D'} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 1, fontSize: 7, padding: '0px 3px', borderRadius: 2,
                            background: depDone ? '#10B98118' : '#F59E0B18', color: depDone ? '#10B981' : '#D97706',
                            fontWeight: 500, cursor: 'pointer'
                          }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 55 }}>
                              {depDone ? '\u2713' : '\u23F3'} {depTask ? depTask.text.substring(0, 12) : depId}
                            </span>
                            <span style={{ opacity: 0.5, fontSize: 6, flexShrink: 0 }}>{'\u2715'}</span>
                          </span>
                        );
                      });
                    })()}
                    <button onClick={function(e) { e.stopPropagation(); setChainAddDepFor(chainAddDepFor === ct.id ? null : ct.id); }} style={{
                      fontSize: 7, padding: '0px 3px', borderRadius: 2,
                      border: '1px dashed ' + (chainAddDepFor === ct.id ? theme.accent : theme.border),
                      background: chainAddDepFor === ct.id ? theme.accent + '15' : 'transparent',
                      color: chainAddDepFor === ct.id ? theme.accent : theme.textMuted,
                      cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit'
                    }}>{chainAddDepFor === ct.id ? 'cancel' : '+ dep'}</button>
                  </div>
                  {/* Hover label during arrow drag */}
                  {isHoverTarget && (
                    <div style={{ fontSize: 8, color: isCycleDrop ? '#DC2626' : '#3B82F6', marginTop: 1 }}>
                      {isCycleDrop ? '\u26D4 cycle!' : '\u21B3 will depend on source'}
                    </div>
                  )}
                  {/* Add dep dropdown */}
                  {chainAddDepFor === ct.id && (function() {
                    var myDeps = chainDeps[ct.id] || [];
                    var candidates = chainOrder.filter(function(oid) { return oid !== ct.id && myDeps.indexOf(oid) < 0; })
                      .map(function(oid) { return allTasks.find(function(x) { return x.id === oid; }); }).filter(Boolean);

                    return (
                      <div onClick={function(e) { e.stopPropagation(); }} style={{
                        padding: '4px 6px', background: theme.bgTertiary,
                        borderRadius: 5, border: '1px solid ' + theme.border, maxHeight: 180, overflowY: 'auto',
                        position: 'absolute', bottom: '100%', left: 0, width: 240, marginBottom: 4,
                        zIndex: 100, boxShadow: '0 4px 16px rgba(0,0,0,0.18)'
                      }}>
                        {candidates.length > 0 ? candidates.slice(0, 30).map(function(ot) {
                          return (
                            <div key={ot.id} onClick={function() { chainAddDep(ct.id, ot.id); }} style={{
                              padding: '3px 4px', borderRadius: 3, cursor: 'pointer', fontSize: 10,
                              display: 'flex', gap: 4, alignItems: 'center', marginBottom: 1
                            }}>
                              <span style={{ fontSize: 8, opacity: 0.7 }}>{(statuses[ot.id] || '') === 'done' ? '\u2705' : '\u26AA'}</span>
                              <span style={{ fontWeight: 500, color: theme.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ot.text}</span>
                            </div>
                          );
                        }) : (
                          <div style={{ fontSize: 9, color: theme.textMuted, padding: 4, textAlign: 'center' }}>No candidates</div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Connector handle: circle at bottom-center of card */}
                <div
                  onMouseDown={function(e) { handleConnectorMouseDown(ct.id, e); }}
                  title="Drag to connect"
                  style={{
                    position: 'absolute',
                    left: NODE_W / 2 - HANDLE_R,
                    bottom: -HANDLE_R,
                    width: HANDLE_R * 2, height: HANDLE_R * 2,
                    borderRadius: '50%',
                    background: isArrowSource ? theme.accent : (darkMode ? '#475569' : '#94A3B8'),
                    border: '2px solid ' + (isArrowSource ? theme.accent : theme.bgSecondary),
                    cursor: 'crosshair',
                    zIndex: 2,
                    transition: 'background 0.15s, transform 0.15s'
                  }}
                  onMouseEnter={function(e) { e.currentTarget.style.transform = 'scale(1.4)'; e.currentTarget.style.background = theme.accent; }}
                  onMouseLeave={function(e) { if (!arrowDrag) { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = darkMode ? '#475569' : '#94A3B8'; } }}
                />
              </div>
            );
          })}
        </div>
        </div>{/* spacer */}
      </div>
    </div>
  );
}

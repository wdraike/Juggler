/**
 * AnnotationCanvas — screenshot annotation tool for Juggler (StriveRS)
 *
 * Port of resume-optimizer's AnnotationCanvas, rewritten without MUI.
 * Uses Juggler's inline style pattern with theme prop.
 * Core konva/react-konva drawing logic is the same.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Arrow, Text, Rect } from 'react-konva';

var TOOLS = [
  { value: 'pen', label: 'Draw', icon: '\u270F\uFE0F' },
  { value: 'arrow', label: 'Arrow', icon: '\u27A1\uFE0F' },
  { value: 'text', label: 'Text', icon: '\uD83D\uDCC4' },
  { value: 'blur', label: 'Hide', icon: '\u2B1B' }
];

var COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#000000'];

export default function AnnotationCanvas({ screenshot, onComplete, onCancel, theme }) {
  var [image, setImage] = useState(null);
  var [tool, setTool] = useState('pen');
  var [lines, setLines] = useState([]);
  var [arrows, setArrows] = useState([]);
  var [texts, setTexts] = useState([]);
  var [blurs, setBlurs] = useState([]);
  var [isDrawing, setIsDrawing] = useState(false);
  var [color, setColor] = useState('#FF0000');
  var [lineWidth, setLineWidth] = useState(3);
  var [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  var stageRef = useRef(null);
  var containerRef = useRef(null);

  // Load image
  useEffect(function() {
    var img = new window.Image();
    img.src = screenshot;
    img.onload = function() {
      setImage(img);
      if (containerRef.current) {
        var containerWidth = containerRef.current.clientWidth;
        var scale = Math.min(1, containerWidth / img.width);
        setCanvasSize({ width: img.width * scale, height: img.height * scale });
      }
    };
  }, [screenshot]);

  function handleMouseDown(e) {
    setIsDrawing(true);
    var pos = e.target.getStage().getPointerPosition();

    if (tool === 'pen') {
      setLines(lines.concat([{ points: [pos.x, pos.y], color: color, width: lineWidth }]));
    } else if (tool === 'arrow') {
      setArrows(arrows.concat([{ points: [pos.x, pos.y, pos.x, pos.y], color: color, width: lineWidth }]));
    } else if (tool === 'blur') {
      setBlurs(blurs.concat([{ x: pos.x, y: pos.y, width: 0, height: 0 }]));
    } else if (tool === 'text') {
      var text = prompt('Enter text:');
      if (text) {
        setTexts(texts.concat([{ x: pos.x, y: pos.y, text: text, color: color, fontSize: 20 }]));
      }
      setIsDrawing(false);
    }
  }

  function handleMouseMove(e) {
    if (!isDrawing) return;
    var pos = e.target.getStage().getPointerPosition();

    if (tool === 'pen') {
      var lastLine = lines[lines.length - 1];
      lastLine.points = lastLine.points.concat([pos.x, pos.y]);
      lines.splice(lines.length - 1, 1, lastLine);
      setLines(lines.concat());
    } else if (tool === 'arrow') {
      var lastArrow = arrows[arrows.length - 1];
      lastArrow.points = [lastArrow.points[0], lastArrow.points[1], pos.x, pos.y];
      arrows.splice(arrows.length - 1, 1, lastArrow);
      setArrows(arrows.concat());
    } else if (tool === 'blur') {
      var lastBlur = blurs[blurs.length - 1];
      lastBlur.width = pos.x - lastBlur.x;
      lastBlur.height = pos.y - lastBlur.y;
      blurs.splice(blurs.length - 1, 1, lastBlur);
      setBlurs(blurs.concat());
    }
  }

  function handleMouseUp() {
    setIsDrawing(false);
  }

  function handleUndo() {
    if (tool === 'pen' && lines.length > 0) {
      setLines(lines.slice(0, -1));
    } else if (tool === 'arrow' && arrows.length > 0) {
      setArrows(arrows.slice(0, -1));
    } else if (tool === 'text' && texts.length > 0) {
      setTexts(texts.slice(0, -1));
    } else if (tool === 'blur' && blurs.length > 0) {
      setBlurs(blurs.slice(0, -1));
    } else {
      if (lines.length > 0) setLines(lines.slice(0, -1));
      else if (arrows.length > 0) setArrows(arrows.slice(0, -1));
      else if (texts.length > 0) setTexts(texts.slice(0, -1));
      else if (blurs.length > 0) setBlurs(blurs.slice(0, -1));
    }
  }

  function handleClear() {
    if (window.confirm('Clear all annotations?')) {
      setLines([]);
      setArrows([]);
      setTexts([]);
      setBlurs([]);
    }
  }

  function handleComplete() {
    if (!stageRef.current) return;
    var dataUrl = stageRef.current.toDataURL({ pixelRatio: 2 });
    onComplete(dataUrl);
  }

  if (!image) {
    return <div style={{ textAlign: 'center', padding: '24px 0', color: theme.textMuted }}>Loading image...</div>;
  }

  var toolBtnStyle = function(isActive) {
    return {
      border: '1px solid ' + (isActive ? theme.accent : theme.border),
      borderRadius: 4, padding: '6px 10px', cursor: 'pointer',
      background: isActive ? theme.accent : 'transparent',
      color: isActive ? '#1A2B4A' : theme.text, fontSize: 13,
      fontFamily: "'Inter', sans-serif", fontWeight: isActive ? 600 : 400
    };
  };

  var actionBtn = {
    border: '1px solid ' + theme.border, borderRadius: 4, padding: '6px 10px',
    background: 'transparent', cursor: 'pointer', color: theme.text,
    fontSize: 16, fontFamily: "'Inter', sans-serif"
  };

  return (
    <div ref={containerRef}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
        padding: '10px 12px', marginBottom: 8, borderRadius: 4,
        background: theme.bgTertiary, border: '1px solid ' + theme.border
      }}>
        {/* Tool selector */}
        <div style={{ display: 'flex', gap: 4 }}>
          {TOOLS.map(function(t) {
            return (
              <button key={t.value} onClick={function() { setTool(t.value); }}
                style={toolBtnStyle(tool === t.value)} title={t.label}>
                {t.icon}
              </button>
            );
          })}
        </div>

        {/* Color picker */}
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginLeft: 8 }}>
          <span style={{ fontSize: 11, color: theme.textMuted }}>Color:</span>
          {COLORS.map(function(c) {
            return (
              <button key={c} onClick={function() { setColor(c); }} style={{
                width: 22, height: 22, borderRadius: 3, cursor: 'pointer',
                background: c, border: color === c ? '2px solid white' : '1px solid ' + theme.border,
                boxShadow: color === c ? '0 0 0 1px #000' : 'none'
              }} />
            );
          })}
        </div>

        {/* Line width */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 8 }}>
          <span style={{ fontSize: 11, color: theme.textMuted }}>Width:</span>
          <input type="range" min={1} max={10} step={1} value={lineWidth}
            onChange={function(e) { setLineWidth(parseInt(e.target.value)); }}
            style={{ width: 80 }} />
          <span style={{ fontSize: 11, color: theme.textMuted, minWidth: 16 }}>{lineWidth}</span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <button onClick={handleUndo} style={actionBtn} title="Undo">{'\u21A9'}</button>
          <button onClick={handleClear} style={{ ...actionBtn, color: theme.error }} title="Clear All">{'\u2715'}</button>
        </div>
      </div>

      {/* Canvas */}
      <div style={{ marginBottom: 8, border: '1px solid ' + theme.border, borderRadius: 4, overflow: 'hidden' }}>
        <Stage
          width={canvasSize.width} height={canvasSize.height}
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
          onTouchStart={handleMouseDown} onTouchMove={handleMouseMove} onTouchEnd={handleMouseUp}
          ref={stageRef}
        >
          <Layer>
            <KonvaImage image={image} width={canvasSize.width} height={canvasSize.height} />
            {lines.map(function(line, i) {
              return <Line key={'line-' + i} points={line.points} stroke={line.color} strokeWidth={line.width} tension={0.5} lineCap="round" lineJoin="round" />;
            })}
            {arrows.map(function(arrow, i) {
              return <Arrow key={'arrow-' + i} points={arrow.points} stroke={arrow.color} strokeWidth={arrow.width} fill={arrow.color} pointerLength={10} pointerWidth={10} />;
            })}
            {texts.map(function(text, i) {
              return <Text key={'text-' + i} x={text.x} y={text.y} text={text.text} fontSize={text.fontSize} fill={text.color} stroke="#FFFFFF" strokeWidth={1} fontFamily="Arial" fontStyle="bold" />;
            })}
            {blurs.map(function(blur, i) {
              return <Rect key={'blur-' + i} x={blur.x} y={blur.y} width={blur.width} height={blur.height} fill="rgba(0,0,0,0.8)" stroke="#000000" strokeWidth={2} />;
            })}
          </Layer>
        </Stage>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{
          border: '1px solid ' + theme.border, borderRadius: 4, padding: '8px 16px',
          background: 'transparent', cursor: 'pointer', color: theme.text,
          fontSize: 14, fontFamily: "'Inter', sans-serif"
        }}>Cancel</button>
        <button onClick={handleComplete} style={{
          border: 'none', borderRadius: 4, padding: '8px 16px',
          background: theme.accent, cursor: 'pointer', color: '#1A2B4A',
          fontSize: 14, fontWeight: 600, fontFamily: "'Inter', sans-serif"
        }}>Use This Screenshot</button>
      </div>
    </div>
  );
}

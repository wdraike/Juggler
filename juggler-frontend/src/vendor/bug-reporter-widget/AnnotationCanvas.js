import { jsx, jsxs } from "react/jsx-runtime";
import React, { useState, useRef, useEffect } from "react";
import { Stage, Layer, Image as KonvaImage, Line, Arrow, Text, Rect } from "react-konva";
import "./widget.css";
const TOOLS = [
  { value: "pen", label: "Draw", icon: "\u270F\uFE0F" },
  { value: "arrow", label: "Arrow", icon: "\u27A1\uFE0F" },
  { value: "text", label: "Text", icon: "\u{1F4C4}" },
  { value: "blur", label: "Hide", icon: "\u2B1B" }
];
const COLORS = ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#000000"];
function AnnotationCanvas({ screenshot, onComplete, onCancel }) {
  const [image, setImage] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [tool, setTool] = useState("pen");
  const [lines, setLines] = useState([]);
  const [arrows, setArrows] = useState([]);
  const [texts, setTexts] = useState([]);
  const [blurs, setBlurs] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState("#FF0000");
  const [lineWidth, setLineWidth] = useState(3);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const stageRef = useRef(null);
  const containerRef = useRef(null);
  useEffect(() => {
    const img = new window.Image();
    img.src = screenshot;
    img.onload = () => {
      setImage(img);
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const scale = Math.min(1, containerWidth / img.width);
        setCanvasSize({ width: img.width * scale, height: img.height * scale });
      }
    };
  }, [screenshot]);
  function handleMouseDown(e) {
    setIsDrawing(true);
    const pos = e.target.getStage().getPointerPosition();
    if (tool === "pen") {
      setLines(lines.concat([{ points: [pos.x, pos.y], color, width: lineWidth }]));
    } else if (tool === "arrow") {
      setArrows(arrows.concat([{ points: [pos.x, pos.y, pos.x, pos.y], color, width: lineWidth }]));
    } else if (tool === "blur") {
      setBlurs(blurs.concat([{ x: pos.x, y: pos.y, width: 0, height: 0 }]));
    } else if (tool === "text") {
      const text = window.prompt("Enter text:");
      if (text) {
        setTexts(texts.concat([{ x: pos.x, y: pos.y, text, color, fontSize: 20 }]));
      }
      setIsDrawing(false);
    }
  }
  function handleMouseMove(e) {
    if (!isDrawing) return;
    const pos = e.target.getStage().getPointerPosition();
    if (tool === "pen") {
      const lastLine = lines[lines.length - 1];
      lastLine.points = lastLine.points.concat([pos.x, pos.y]);
      lines.splice(lines.length - 1, 1, lastLine);
      setLines(lines.concat());
    } else if (tool === "arrow") {
      const lastArrow = arrows[arrows.length - 1];
      lastArrow.points = [lastArrow.points[0], lastArrow.points[1], pos.x, pos.y];
      arrows.splice(arrows.length - 1, 1, lastArrow);
      setArrows(arrows.concat());
    } else if (tool === "blur") {
      const lastBlur = blurs[blurs.length - 1];
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
    if (tool === "pen" && lines.length > 0) setLines(lines.slice(0, -1));
    else if (tool === "arrow" && arrows.length > 0) setArrows(arrows.slice(0, -1));
    else if (tool === "text" && texts.length > 0) setTexts(texts.slice(0, -1));
    else if (tool === "blur" && blurs.length > 0) setBlurs(blurs.slice(0, -1));
    else if (lines.length > 0) setLines(lines.slice(0, -1));
    else if (arrows.length > 0) setArrows(arrows.slice(0, -1));
    else if (texts.length > 0) setTexts(texts.slice(0, -1));
    else if (blurs.length > 0) setBlurs(blurs.slice(0, -1));
  }
  function doClear() {
    setLines([]);
    setArrows([]);
    setTexts([]);
    setBlurs([]);
    setConfirmClear(false);
  }
  function handleComplete() {
    if (!stageRef.current) return;
    onComplete(stageRef.current.toDataURL({ pixelRatio: 2 }));
  }
  if (!image) {
    return /* @__PURE__ */ jsx("p", { className: "brfw-hint", children: "Loading image\u2026" });
  }
  return /* @__PURE__ */ jsxs("div", { ref: containerRef, children: [
    /* @__PURE__ */ jsxs("div", { className: "brfw-canvas-toolbar", children: [
      /* @__PURE__ */ jsx("div", { className: "brfw-canvas-group", role: "group", "aria-label": "Drawing tool", children: TOOLS.map((t) => /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => setTool(t.value),
          className: `brfw-tool-button${tool === t.value ? " brfw-tool-button--active" : ""}`,
          title: t.label,
          "aria-label": t.label,
          "aria-pressed": tool === t.value,
          children: t.icon
        },
        t.value
      )) }),
      /* @__PURE__ */ jsx("div", { className: "brfw-canvas-group", role: "group", "aria-label": "Marker color", children: COLORS.map((c) => /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => setColor(c),
          className: `brfw-swatch${color === c ? " brfw-swatch--active" : ""}`,
          style: { background: c },
          "aria-label": `Color ${c}`,
          "aria-pressed": color === c
        },
        c
      )) }),
      /* @__PURE__ */ jsxs("div", { className: "brfw-canvas-group", children: [
        /* @__PURE__ */ jsx("label", { className: "brfw-canvas-label", htmlFor: "brfw-line-width", children: "Width" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            id: "brfw-line-width",
            type: "range",
            min: 1,
            max: 10,
            step: 1,
            value: lineWidth,
            onChange: (e) => setLineWidth(parseInt(e.target.value, 10))
          }
        ),
        /* @__PURE__ */ jsx("span", { className: "brfw-canvas-label", children: lineWidth })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "brfw-canvas-group brfw-canvas-group--end", children: [
        /* @__PURE__ */ jsx("button", { type: "button", className: "brfw-button", onClick: handleUndo, "aria-label": "Undo", children: "\u21A9" }),
        /* @__PURE__ */ jsx("button", { type: "button", className: "brfw-button", onClick: () => setConfirmClear(true), "aria-label": "Clear all annotations", children: "\u2715" })
      ] })
    ] }),
    confirmClear && /* @__PURE__ */ jsxs("div", { className: "brfw-footer brfw-confirm-discard", children: [
      /* @__PURE__ */ jsx("span", { children: "Clear all annotations? This cannot be undone." }),
      /* @__PURE__ */ jsx("button", { type: "button", className: "brfw-button", onClick: () => setConfirmClear(false), children: "Keep" }),
      /* @__PURE__ */ jsx("button", { type: "button", className: "brfw-button brfw-button--danger", onClick: doClear, children: "Clear" })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "brfw-canvas-frame", children: /* @__PURE__ */ jsx(
      Stage,
      {
        width: canvasSize.width,
        height: canvasSize.height,
        onMouseDown: handleMouseDown,
        onMouseMove: handleMouseMove,
        onMouseUp: handleMouseUp,
        onTouchStart: handleMouseDown,
        onTouchMove: handleMouseMove,
        onTouchEnd: handleMouseUp,
        ref: stageRef,
        children: /* @__PURE__ */ jsxs(Layer, { children: [
          /* @__PURE__ */ jsx(KonvaImage, { image, width: canvasSize.width, height: canvasSize.height }),
          lines.map((line, i) => /* @__PURE__ */ jsx(Line, { points: line.points, stroke: line.color, strokeWidth: line.width, tension: 0.5, lineCap: "round", lineJoin: "round" }, `line-${i}`)),
          arrows.map((arrow, i) => /* @__PURE__ */ jsx(Arrow, { points: arrow.points, stroke: arrow.color, strokeWidth: arrow.width, fill: arrow.color, pointerLength: 10, pointerWidth: 10 }, `arrow-${i}`)),
          texts.map((text, i) => /* @__PURE__ */ jsx(Text, { x: text.x, y: text.y, text: text.text, fontSize: text.fontSize, fill: text.color, stroke: "#FFFFFF", strokeWidth: 1, fontFamily: "Arial", fontStyle: "bold" }, `text-${i}`)),
          blurs.map((blur, i) => /* @__PURE__ */ jsx(Rect, { x: blur.x, y: blur.y, width: blur.width, height: blur.height, fill: "rgba(0,0,0,0.8)", stroke: "#000000", strokeWidth: 2 }, `blur-${i}`))
        ] })
      }
    ) }),
    /* @__PURE__ */ jsxs("div", { className: "brfw-footer", children: [
      /* @__PURE__ */ jsx("button", { type: "button", className: "brfw-button", onClick: onCancel, children: "Cancel" }),
      /* @__PURE__ */ jsx("button", { type: "button", className: "brfw-button brfw-button--primary", onClick: handleComplete, children: "Use this screenshot" })
    ] })
  ] });
}
export {
  AnnotationCanvas as default
};

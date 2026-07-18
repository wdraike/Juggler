var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var stdin_exports = {};
__export(stdin_exports, {
  STEP_LABELS: () => STEP_LABELS,
  TYPE_OPTIONS: () => TYPE_OPTIONS,
  default: () => FeedbackDialog
});
module.exports = __toCommonJS(stdin_exports);
var import_jsx_runtime = require("react/jsx-runtime");
var import_react = __toESM(require("react"));
var import_html2canvas = __toESM(require("html2canvas"));
var import_feedbackMachine = require("./feedbackMachine");
var import_widget = require("./widget.css");
const TYPE_OPTIONS = [
  { value: "bug", emoji: "\u{1F41B}", label: "Bug report" },
  { value: "feature", emoji: "\u2728", label: "Feature request" },
  { value: "question", emoji: "\u2753", label: "Question" },
  { value: "other", emoji: "\u{1F4AC}", label: "Something else" }
];
const STEP_LABELS = ["Details", "Screenshot", "Review"];
const SUCCESS_AUTO_CLOSE_MS = 2e3;
async function defaultCapture() {
  const canvas = await (0, import_html2canvas.default)(document.body, {
    useCORS: true,
    logging: false,
    scale: window.devicePixelRatio > 1 ? 1 : window.devicePixelRatio
  });
  return canvas.toDataURL("image/png");
}
function FeedbackDialog({
  open,
  onClose,
  client,
  user,
  AnnotationCanvas,
  capture = defaultCapture
}) {
  const [state, dispatch] = (0, import_react.useReducer)(
    import_feedbackMachine.transition,
    { email: user && user.email || "" },
    import_feedbackMachine.initialState
  );
  const dialogRef = (0, import_react.useRef)(null);
  const rootRef = (0, import_react.useRef)(null);
  const firstFieldRef = (0, import_react.useRef)(null);
  const previousFocusRef = (0, import_react.useRef)(null);
  const liveRegionRef = (0, import_react.useRef)(null);
  const prevOpenRef = (0, import_react.useRef)(false);
  (0, import_react.useEffect)(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (open && !wasOpen) {
      previousFocusRef.current = document.activeElement;
      dispatch({ type: "OPEN" });
    }
  }, [open]);
  const prevStatusRef = (0, import_react.useRef)(state.status);
  (0, import_react.useEffect)(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = state.status;
    if (prev === "closed" || state.status !== "closed") return;
    if (previousFocusRef.current && previousFocusRef.current.focus) {
      previousFocusRef.current.focus();
    }
    onClose();
  }, [state.status, onClose]);
  const prefillEmail = user && user.email || "";
  (0, import_react.useEffect)(() => {
    if (prefillEmail) dispatch({ type: "PREFILL", email: prefillEmail });
  }, [prefillEmail]);
  (0, import_react.useEffect)(() => {
    if (state.status === "editing" && state.step === import_feedbackMachine.STEPS.DETAILS && firstFieldRef.current) {
      firstFieldRef.current.focus();
    }
  }, [state.status, state.step]);
  (0, import_react.useEffect)(() => {
    if (state.status !== "success") return void 0;
    const t = setTimeout(() => dispatch({ type: "DISMISS", source: "button" }), SUCCESS_AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [state.status]);
  const handleKeyDown = (0, import_react.useCallback)((e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      dispatch({ type: "DISMISS", source: "esc" });
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusables = dialogRef.current.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);
  const handleCapture = async () => {
    dispatch({ type: "CAPTURE_START" });
    const root = rootRef.current;
    if (root) root.style.visibility = "hidden";
    try {
      const shot = await capture();
      dispatch({ type: "CAPTURE_DONE", screenshot: shot });
    } catch (err) {
      dispatch({ type: "CAPTURE_FAIL", message: "Screenshot capture failed. You can still submit without one." });
    } finally {
      if (root) root.style.visibility = "";
    }
  };
  const handleSubmit = async () => {
    const before = state;
    dispatch({ type: "SUBMIT" });
    if (!(0, import_feedbackMachine.canSubmit)(before)) return;
    try {
      await client.submitFeedback({
        type: before.form.type,
        subject: before.form.subject.trim(),
        description: before.form.description.trim(),
        email: before.form.email.trim(),
        screenshot: before.screenshot || void 0,
        user
      });
      dispatch({ type: "SUBMIT_OK" });
    } catch (err) {
      dispatch({ type: "SUBMIT_FAIL", message: err.message || "Submitting failed. Please try again." });
    }
  };
  if (!open || state.status === "closed") return null;
  if (state.status === "annotating" && AnnotationCanvas) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "brfw-backdrop", ref: rootRef, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "brfw-dialog brfw-dialog--wide", role: "dialog", "aria-modal": "true", "aria-label": "Annotate screenshot", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      AnnotationCanvas,
      {
        screenshot: state.screenshot,
        onComplete: (shot) => dispatch({ type: "ANNOTATE_DONE", screenshot: shot }),
        onCancel: () => dispatch({ type: "ANNOTATE_CANCEL" })
      }
    ) }) });
  }
  const { form, step, status } = state;
  const submitting = status === "submitting";
  const capturing = status === "capturing";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "div",
    {
      className: "brfw-backdrop",
      ref: rootRef,
      onMouseDown: (e) => {
        if (e.target === e.currentTarget) dispatch({ type: "DISMISS", source: "backdrop" });
      },
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "div",
        {
          className: "brfw-dialog",
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": "brfw-title",
          ref: dialogRef,
          onKeyDown: handleKeyDown,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "brfw-header", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { id: "brfw-title", className: "brfw-title", children: "Tell us what happened" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "button",
                {
                  type: "button",
                  className: "brfw-icon-button",
                  "aria-label": "Close feedback dialog",
                  onClick: () => dispatch({ type: "DISMISS", source: "button" }),
                  children: "\xD7"
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { "aria-live": "polite", className: "brfw-visually-hidden", ref: liveRegionRef, children: [
              status === "success" && "Thanks \u2014 your feedback is in. This dialog closes itself in a moment.",
              state.error && `Error: ${state.error}`
            ] }),
            status === "success" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "brfw-success", role: "status", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "brfw-success-title", children: "Thanks \u2014 your feedback is in." }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "brfw-success-body", children: "We read every report. This closes itself in a moment." })
            ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", { className: "brfw-steps", "aria-label": "Progress", children: STEP_LABELS.map((label, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "li",
                {
                  className: `brfw-step${i === step ? " brfw-step--active" : ""}${i < step ? " brfw-step--done" : ""}`,
                  "aria-current": i === step ? "step" : void 0,
                  children: label
                },
                label
              )) }),
              state.error && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "brfw-alert brfw-alert--error", role: "alert", children: [
                state.error,
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "brfw-icon-button", "aria-label": "Dismiss error", onClick: () => dispatch({ type: "CLEAR_ERROR" }), children: "\xD7" })
              ] }),
              state.validationError && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "brfw-alert brfw-alert--error", role: "alert", children: state.validationError }),
              step === import_feedbackMachine.STEPS.DETAILS && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "brfw-body", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "brfw-label", htmlFor: "brfw-type", children: "What kind of feedback?" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "select",
                  {
                    id: "brfw-type",
                    className: "brfw-input",
                    value: form.type,
                    onChange: (e) => dispatch({ type: "CHANGE", field: "type", value: e.target.value }),
                    children: TYPE_OPTIONS.map((o) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: o.value, children: `${o.emoji} ${o.label}` }, o.value))
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "brfw-label", htmlFor: "brfw-subject", children: "Subject" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    id: "brfw-subject",
                    ref: firstFieldRef,
                    className: "brfw-input",
                    value: form.subject,
                    maxLength: 200,
                    onChange: (e) => dispatch({ type: "CHANGE", field: "subject", value: e.target.value })
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "brfw-label", htmlFor: "brfw-description", children: "What happened?" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "textarea",
                  {
                    id: "brfw-description",
                    className: "brfw-input brfw-textarea",
                    rows: 5,
                    value: form.description,
                    onChange: (e) => dispatch({ type: "CHANGE", field: "description", value: e.target.value })
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "brfw-label", htmlFor: "brfw-email", children: "Email for follow-up" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    id: "brfw-email",
                    type: "email",
                    className: "brfw-input",
                    value: form.email,
                    onChange: (e) => dispatch({ type: "CHANGE", field: "email", value: e.target.value })
                  }
                )
              ] }),
              step === import_feedbackMachine.STEPS.SCREENSHOT && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "brfw-body", children: state.screenshot ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { src: state.screenshot, alt: "Captured screenshot preview", className: "brfw-preview" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "brfw-row", children: [
                  AnnotationCanvas && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "brfw-button", onClick: () => dispatch({ type: "ANNOTATE_START" }), children: "Annotate" }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "brfw-button", onClick: () => dispatch({ type: "SET_SCREENSHOT", screenshot: null }), children: "Remove" })
                ] })
              ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "brfw-hint", children: "A screenshot helps us see what you saw. Optional." }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "brfw-button", onClick: handleCapture, disabled: capturing, children: capturing ? "Capturing\u2026" : "Capture screenshot" })
              ] }) }),
              step === import_feedbackMachine.STEPS.REVIEW && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "brfw-body", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", { className: "brfw-review", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Type" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: (TYPE_OPTIONS.find((o) => o.value === form.type) || TYPE_OPTIONS[0]).label }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Subject" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: form.subject }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Description" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { className: "brfw-review-description", children: form.description }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Email" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: form.email }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Screenshot" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: state.screenshot ? "Attached" : "None" })
              ] }) }),
              state.confirmDiscard ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "brfw-footer brfw-confirm-discard", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Discard what you've written?" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "brfw-button", onClick: () => dispatch({ type: "CANCEL_DISCARD" }), children: "Keep editing" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "brfw-button brfw-button--danger", onClick: () => dispatch({ type: "CONFIRM_DISCARD" }), children: "Discard" })
              ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "brfw-footer", children: [
                step > import_feedbackMachine.STEPS.DETAILS && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "brfw-button", onClick: () => dispatch({ type: "BACK" }), disabled: submitting, children: "Back" }),
                step < import_feedbackMachine.STEPS.REVIEW && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    className: "brfw-button brfw-button--primary",
                    onClick: () => dispatch({ type: "NEXT" }),
                    disabled: !(0, import_feedbackMachine.canNext)(state) && step === import_feedbackMachine.STEPS.DETAILS,
                    children: "Next"
                  }
                ),
                step === import_feedbackMachine.STEPS.REVIEW && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    className: "brfw-button brfw-button--primary",
                    onClick: handleSubmit,
                    disabled: submitting,
                    children: submitting ? "Sending\u2026" : "Send feedback"
                  }
                )
              ] })
            ] })
          ]
        }
      )
    }
  );
}

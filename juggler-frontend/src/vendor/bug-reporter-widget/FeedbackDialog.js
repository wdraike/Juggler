import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import React, { useEffect, useReducer, useRef, useCallback } from "react";
import html2canvas from "html2canvas";
import {
  STEPS,
  initialState,
  transition,
  canNext,
  canSubmit
} from "./feedbackMachine";
import AnnotationCanvas from "./AnnotationCanvas";
import "./widget.css";
const TYPE_OPTIONS = [
  { value: "bug", emoji: "\u{1F41B}", label: "Bug report" },
  { value: "feature", emoji: "\u2728", label: "Feature request" },
  { value: "question", emoji: "\u2753", label: "Question" },
  { value: "other", emoji: "\u{1F4AC}", label: "Something else" }
];
const STEP_LABELS = ["Details", "Screenshot", "Review"];
const SUCCESS_AUTO_CLOSE_MS = 2e3;
async function defaultCapture() {
  const canvas = await html2canvas(document.body, {
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
  capture = defaultCapture
}) {
  const [state, dispatch] = useReducer(
    transition,
    { email: user && user.email || "" },
    initialState
  );
  const dialogRef = useRef(null);
  const rootRef = useRef(null);
  const firstFieldRef = useRef(null);
  const previousFocusRef = useRef(null);
  const liveRegionRef = useRef(null);
  const prevOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (open && !wasOpen) {
      previousFocusRef.current = document.activeElement;
      dispatch({ type: "OPEN" });
    }
  }, [open]);
  const prevStatusRef = useRef(state.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = state.status;
    if (prev === "closed" || state.status !== "closed") return;
    if (previousFocusRef.current && previousFocusRef.current.focus) {
      previousFocusRef.current.focus();
    }
    onClose();
  }, [state.status, onClose]);
  const prefillEmail = user && user.email || "";
  useEffect(() => {
    if (prefillEmail) dispatch({ type: "PREFILL", email: prefillEmail });
  }, [prefillEmail]);
  useEffect(() => {
    if (state.status === "editing" && state.step === STEPS.DETAILS && firstFieldRef.current) {
      firstFieldRef.current.focus();
    }
  }, [state.status, state.step]);
  useEffect(() => {
    if (state.status !== "success") return void 0;
    const t = setTimeout(() => dispatch({ type: "DISMISS", source: "button" }), SUCCESS_AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [state.status]);
  const handleKeyDown = useCallback((e) => {
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
    if (!canSubmit(before)) return;
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
  if (state.status === "annotating") {
    return /* @__PURE__ */ jsx("div", { className: "brfw-backdrop", ref: rootRef, children: /* @__PURE__ */ jsx("div", { className: "brfw-dialog brfw-dialog--wide", role: "dialog", "aria-modal": "true", "aria-label": "Annotate screenshot", children: /* @__PURE__ */ jsx(
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
  return /* @__PURE__ */ jsx(
    "div",
    {
      className: "brfw-backdrop",
      ref: rootRef,
      onMouseDown: (e) => {
        if (e.target === e.currentTarget) dispatch({ type: "DISMISS", source: "backdrop" });
      },
      children: /* @__PURE__ */ jsxs(
        "div",
        {
          className: "brfw-dialog",
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": "brfw-title",
          ref: dialogRef,
          onKeyDown: handleKeyDown,
          children: [
            /* @__PURE__ */ jsxs("div", { className: "brfw-header", children: [
              /* @__PURE__ */ jsx("h2", { id: "brfw-title", className: "brfw-title", children: "Tell us what happened" }),
              /* @__PURE__ */ jsx(
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
            /* @__PURE__ */ jsxs("div", { "aria-live": "polite", className: "brfw-visually-hidden", ref: liveRegionRef, children: [
              status === "success" && "Thanks \u2014 your feedback is in. This dialog closes itself in a moment.",
              state.error && `Error: ${state.error}`
            ] }),
            status === "success" ? /* @__PURE__ */ jsxs("div", { className: "brfw-success", role: "status", children: [
              /* @__PURE__ */ jsx("p", { className: "brfw-success-title", children: "Thanks \u2014 your feedback is in." }),
              /* @__PURE__ */ jsx("p", { className: "brfw-success-body", children: "We read every report. This closes itself in a moment." })
            ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx("ol", { className: "brfw-steps", "aria-label": "Progress", children: STEP_LABELS.map((label, i) => /* @__PURE__ */ jsx(
                "li",
                {
                  className: `brfw-step${i === step ? " brfw-step--active" : ""}${i < step ? " brfw-step--done" : ""}`,
                  "aria-current": i === step ? "step" : void 0,
                  children: label
                },
                label
              )) }),
              state.error && /* @__PURE__ */ jsxs("div", { className: "brfw-alert brfw-alert--error", role: "alert", children: [
                state.error,
                /* @__PURE__ */ jsx("button", { type: "button", className: "brfw-icon-button", "aria-label": "Dismiss error", onClick: () => dispatch({ type: "CLEAR_ERROR" }), children: "\xD7" })
              ] }),
              state.validationError && /* @__PURE__ */ jsx("div", { className: "brfw-alert brfw-alert--error", role: "alert", children: state.validationError }),
              step === STEPS.DETAILS && /* @__PURE__ */ jsxs("div", { className: "brfw-body", children: [
                /* @__PURE__ */ jsx("label", { className: "brfw-label", htmlFor: "brfw-type", children: "What kind of feedback?" }),
                /* @__PURE__ */ jsx(
                  "select",
                  {
                    id: "brfw-type",
                    className: "brfw-input",
                    value: form.type,
                    onChange: (e) => dispatch({ type: "CHANGE", field: "type", value: e.target.value }),
                    children: TYPE_OPTIONS.map((o) => /* @__PURE__ */ jsx("option", { value: o.value, children: `${o.emoji} ${o.label}` }, o.value))
                  }
                ),
                /* @__PURE__ */ jsx("label", { className: "brfw-label", htmlFor: "brfw-subject", children: "Subject" }),
                /* @__PURE__ */ jsx(
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
                /* @__PURE__ */ jsx("label", { className: "brfw-label", htmlFor: "brfw-description", children: "What happened?" }),
                /* @__PURE__ */ jsx(
                  "textarea",
                  {
                    id: "brfw-description",
                    className: "brfw-input brfw-textarea",
                    rows: 5,
                    value: form.description,
                    onChange: (e) => dispatch({ type: "CHANGE", field: "description", value: e.target.value })
                  }
                ),
                /* @__PURE__ */ jsx("label", { className: "brfw-label", htmlFor: "brfw-email", children: "Email for follow-up" }),
                /* @__PURE__ */ jsx(
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
              step === STEPS.SCREENSHOT && /* @__PURE__ */ jsx("div", { className: "brfw-body", children: state.screenshot ? /* @__PURE__ */ jsxs(Fragment, { children: [
                /* @__PURE__ */ jsx("img", { src: state.screenshot, alt: "Captured screenshot preview", className: "brfw-preview" }),
                /* @__PURE__ */ jsxs("div", { className: "brfw-row", children: [
                  /* @__PURE__ */ jsx("button", { type: "button", className: "brfw-button", onClick: () => dispatch({ type: "ANNOTATE_START" }), children: "Annotate" }),
                  /* @__PURE__ */ jsx("button", { type: "button", className: "brfw-button", onClick: () => dispatch({ type: "SET_SCREENSHOT", screenshot: null }), children: "Remove" })
                ] })
              ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
                /* @__PURE__ */ jsx("p", { className: "brfw-hint", children: "A screenshot helps us see what you saw. Optional." }),
                /* @__PURE__ */ jsx("button", { type: "button", className: "brfw-button", onClick: handleCapture, disabled: capturing, children: capturing ? "Capturing\u2026" : "Capture screenshot" })
              ] }) }),
              step === STEPS.REVIEW && /* @__PURE__ */ jsx("div", { className: "brfw-body", children: /* @__PURE__ */ jsxs("dl", { className: "brfw-review", children: [
                /* @__PURE__ */ jsx("dt", { children: "Type" }),
                /* @__PURE__ */ jsx("dd", { children: (TYPE_OPTIONS.find((o) => o.value === form.type) || TYPE_OPTIONS[0]).label }),
                /* @__PURE__ */ jsx("dt", { children: "Subject" }),
                /* @__PURE__ */ jsx("dd", { children: form.subject }),
                /* @__PURE__ */ jsx("dt", { children: "Description" }),
                /* @__PURE__ */ jsx("dd", { className: "brfw-review-description", children: form.description }),
                /* @__PURE__ */ jsx("dt", { children: "Email" }),
                /* @__PURE__ */ jsx("dd", { children: form.email }),
                /* @__PURE__ */ jsx("dt", { children: "Screenshot" }),
                /* @__PURE__ */ jsx("dd", { children: state.screenshot ? "Attached" : "None" })
              ] }) }),
              state.confirmDiscard ? /* @__PURE__ */ jsxs("div", { className: "brfw-footer brfw-confirm-discard", children: [
                /* @__PURE__ */ jsx("span", { children: "Discard what you've written?" }),
                /* @__PURE__ */ jsx("button", { type: "button", className: "brfw-button", onClick: () => dispatch({ type: "CANCEL_DISCARD" }), children: "Keep editing" }),
                /* @__PURE__ */ jsx("button", { type: "button", className: "brfw-button brfw-button--danger", onClick: () => dispatch({ type: "CONFIRM_DISCARD" }), children: "Discard" })
              ] }) : /* @__PURE__ */ jsxs("div", { className: "brfw-footer", children: [
                step > STEPS.DETAILS && /* @__PURE__ */ jsx("button", { type: "button", className: "brfw-button", onClick: () => dispatch({ type: "BACK" }), disabled: submitting, children: "Back" }),
                step < STEPS.REVIEW && /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    className: "brfw-button brfw-button--primary",
                    onClick: () => dispatch({ type: "NEXT" }),
                    disabled: !canNext(state) && step === STEPS.DETAILS,
                    children: "Next"
                  }
                ),
                step === STEPS.REVIEW && /* @__PURE__ */ jsx(
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
export {
  STEP_LABELS,
  TYPE_OPTIONS,
  FeedbackDialog as default
};

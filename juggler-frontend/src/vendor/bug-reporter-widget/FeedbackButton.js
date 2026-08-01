import { jsx, jsxs } from "react/jsx-runtime";
import React from "react";
import "./widget.css";
function FeedbackButton({ onClick, label = "Send feedback" }) {
  return /* @__PURE__ */ jsxs("button", { type: "button", className: "brfw-fab", onClick, "aria-label": label, children: [
    /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: "brfw-fab-icon", children: "\u{1F4AC}" }),
    /* @__PURE__ */ jsx("span", { className: "brfw-fab-label", children: label })
  ] });
}
export {
  FeedbackButton as default
};

import React from 'react';
import ReactDOM from 'react-dom/client';
import { polyfill } from 'mobile-drag-drop';
import { scrollBehaviourDragImageTranslateOverride } from 'mobile-drag-drop/scroll-behaviour';
import App from './App';
import { installErrorReporter } from './bugminerReporter';

// Passive browser-error capture → POST /api/client-errors → log-triage backlog. Fail-silent.
installErrorReporter({ app: 'juggler' });

polyfill({
  dragImageTranslateOverride: scrollBehaviourDragImageTranslateOverride,
  dragStartConditionOverride: function(e) {
    // Don't start drag when touching interactive elements (buttons, inputs, links)
    var el = e.target;
    while (el) {
      if (el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'A' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return false;
      if (el.hasAttribute && el.hasAttribute('draggable')) break;
      el = el.parentElement;
    }
    return true;
  }
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

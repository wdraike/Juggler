// Ported from resume-optimizer-frontend (999.5016). Standalone DOM-level modal
// that manages its own visibility without React state to avoid re-render issues.
// Shown after 2 consecutive health-check failures via showConnectionModal().

import { useEffect } from 'react';

let globalModalElement = null;
let retryCallback = null;
let retryCount = 0;

const createModalElement = () => {
  const modal = document.createElement('div');
  modal.id = 'global-connection-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 999999;
    display: none;
    pointer-events: none;
  `;

  modal.innerHTML = `
    <div class="connection-modal-overlay" style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      pointer-events: none;
    ">
      <div class="connection-modal" style="
        background: #1A2B4A;
        border-radius: 8px;
        padding: 32px;
        max-width: 500px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        color: #E8E0D0;
        font-family: 'Inter', system-ui, sans-serif;
      ">
        <div class="connection-modal-icon" style="text-align: center; font-size: 48px; margin-bottom: 16px;">
          <span class="warning-icon">🔌</span>
        </div>

        <h2 class="connection-modal-title" style="text-align: center; margin: 0 0 16px 0; color: #E8E0D0;">Connection Interrupted</h2>

        <div class="connection-modal-content">
          <p class="connection-modal-message" style="text-align: center; color: #A0A0A0;">
            We're having trouble connecting to the server.
          </p>

          <div class="connection-modal-status" style="text-align: center; margin: 24px 0;">
            <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
              <div style="
                width: 8px;
                height: 8px;
                min-width: 8px;
                min-height: 8px;
                background-color: #ff6b6b;
                border-radius: 50%;
                flex-shrink: 0;
              "></div>
              <span id="connection-status-text" style="line-height: 1;">Not connected</span>
            </div>
          </div>

          <div class="connection-modal-actions" style="text-align: center;">
            <button
              id="retry-button"
              style="
                background: #4A90D9;
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 16px;
                font-family: 'Inter', system-ui, sans-serif;
              "
              onclick="window.globalRetryConnection()"
            >
              Retry Now
            </button>
          </div>

          <p class="connection-modal-footer" style="text-align: center; color: #888; margin-top: 16px; font-size: 14px;">
            <span id="retry-count-text">Waiting for connection...</span>
          </p>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
};

window.globalRetryConnection = () => {
  retryCount++;
  const countText = document.getElementById('retry-count-text');
  if (countText) {
    countText.textContent = `Manual retry attempt ${retryCount}`;
  }
  if (retryCallback) {
    retryCallback();
  }
};

export const showConnectionModal = () => {
  if (!globalModalElement || !globalModalElement.isConnected) {
    globalModalElement = createModalElement();
  }
  globalModalElement.style.display = 'block';
  globalModalElement.style.pointerEvents = 'auto';
  const overlay = globalModalElement.querySelector('.connection-modal-overlay');
  if (overlay) overlay.style.pointerEvents = 'auto';
  document.body.style.overflow = 'hidden';
};

export const hideConnectionModal = () => {
  if (globalModalElement) {
    globalModalElement.style.display = 'none';
    globalModalElement.style.pointerEvents = 'none';
    document.body.style.overflow = '';
  }
};

export const setRetryCallback = (callback) => {
  retryCallback = callback;
};

// Component that sets up the retry callback but renders nothing.
const GlobalConnectionModal = ({ onRetry }) => {
  useEffect(() => {
    setRetryCallback(onRetry);
    return () => {
      setRetryCallback(null);
    };
  }, [onRetry]);

  return null;
};

export default GlobalConnectionModal;
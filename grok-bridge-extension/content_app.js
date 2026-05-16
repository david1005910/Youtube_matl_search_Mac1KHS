// ── Grok Bridge — localhost:8765 Content Script ─────────────────────────────
// 역할: 웹앱(window.postMessage) ↔ background.js 사이의 다리

(function() {
  'use strict';

  // 웹앱에 Extension 존재 알림
  window.postMessage({ type: 'GROK_BRIDGE_READY', version: '1.0.0' }, '*');

  // ── 웹앱 → Extension ──────────────────────────────────────────────────────
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (!msg.type?.startsWith('GROK_')) return;

    try {
      const response = await chrome.runtime.sendMessage(msg);
      window.postMessage({
        type: 'GROK_BRIDGE_RESPONSE',
        requestType: msg.type,
        jobId: msg.jobId,
        ...response,
      }, '*');
    } catch (e) {
      window.postMessage({
        type: 'GROK_BRIDGE_RESPONSE',
        requestType: msg.type,
        error: e.message,
      }, '*');
    }
  });

  // ── background → 웹앱 (push 알림) ────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'GROK_RESULT_PUSH') {
      window.postMessage(msg, '*');
    }
  });

  console.log('[GrokBridge] content_app.js loaded on', location.href);
})();

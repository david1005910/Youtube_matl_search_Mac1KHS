// ── Flow Bridge — localhost:8765 Content Script ──────────────────────────────
(function() {
  'use strict';

  window.postMessage({ type: 'FLOW_BRIDGE_READY', version: '1.0.0' }, '*');

  // 웹앱 → Extension
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (!msg.type?.startsWith('FLOW_')) return;

    try {
      const response = await chrome.runtime.sendMessage(msg);
      window.postMessage({
        type: 'FLOW_BRIDGE_RESPONSE',
        requestType: msg.type,
        jobId: msg.jobId,
        ...response,
      }, '*');
    } catch (e) {
      window.postMessage({
        type: 'FLOW_BRIDGE_RESPONSE',
        requestType: msg.type,
        error: e.message,
      }, '*');
    }
  });

  // background → 웹앱 (결과 push)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'FLOW_RESULT_PUSH') {
      window.postMessage(msg, '*');
    }
  });

  console.log('[FlowBridge] content_app.js loaded on', location.href);
})();

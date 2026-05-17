'use strict';

// ── Flow Bridge — Background Service Worker ───────────────────────────────────
let flowTabId   = null;
let appTabId    = null;
const pendingJobs = new Map(); // jobId → { resolve, reject }

// ── 탭 감지 ──────────────────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const url = tab.url || '';
  if (url.includes('labs.google')) {
    flowTabId = tabId;
  } else if (url.includes('localhost:8765') || url.includes('localhost')) {
    appTabId = tabId;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === flowTabId) flowTabId = null;
  if (tabId === appTabId)  appTabId  = null;
});

// ── 초기 탭 스캔 ─────────────────────────────────────────────────────────────
async function scanExistingTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    const url = tab.url || '';
    if (url.includes('labs.google'))                           flowTabId = tab.id;
    else if (url.includes('localhost:8765') || url.includes('localhost')) appTabId = tab.id;
  }
}
scanExistingTabs();

// ── Google Flow 탭 열기 ──────────────────────────────────────────────────────
async function ensureFlowTab() {
  if (flowTabId) {
    try {
      await chrome.tabs.get(flowTabId);
      await chrome.tabs.update(flowTabId, { active: true });
      return flowTabId;
    } catch { flowTabId = null; }
  }
  const tab = await chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow', active: true });
  flowTabId = tab.id;
  await new Promise(r => setTimeout(r, 4000));
  return flowTabId;
}

// ── 메시지 핸들러 ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // 상태 조회
  if (msg.type === 'GET_STATUS') {
    sendResponse({
      flowTabId,
      appTabId,
      pendingCount: pendingJobs.size,
    });
    return true;
  }

  // Flow 탭 열기
  if (msg.type === 'OPEN_FLOW') {
    ensureFlowTab().then(id => sendResponse({ tabId: id }));
    return true;
  }

  // 영상 생성 요청 (웹앱 → background → content_flow.js)
  if (msg.type === 'FLOW_GENERATE') {
    const { jobId, prompt, imageDataUrl, mode } = msg;
    ensureFlowTab().then(async tabId => {
      try {
        // content_flow.js에 생성 지시
        await chrome.tabs.sendMessage(tabId, {
          type: 'DO_GENERATE',
          jobId, prompt, imageDataUrl, mode,
        });
        sendResponse({ ok: true, queued: true });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    });
    return true;
  }

  // content_flow.js → background: 진행상황
  if (msg.type === 'GENERATE_PROGRESS') {
    // 팝업에 로그 전달
    chrome.runtime.sendMessage({ type: 'POPUP_LOG', message: msg.message }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  // content_flow.js → background: 생성 완료
  if (msg.type === 'GENERATE_RESULT') {
    const { jobId, url, mediaType, error } = msg;
    // 웹앱 탭으로 푸시
    if (appTabId) {
      chrome.tabs.sendMessage(appTabId, {
        type: 'FLOW_RESULT_PUSH',
        jobId, url, mediaType, error,
      }).catch(() => {});
    }
    // 팝업에도 결과 전달
    chrome.runtime.sendMessage({ type: 'POPUP_RESULT', jobId, url, mediaType, error }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  // DOM 검사
  if (msg.type === 'INSPECT_DOM') {
    if (!flowTabId) { sendResponse({ error: 'Flow 탭 없음' }); return true; }
    chrome.tabs.sendMessage(flowTabId, { type: 'INSPECT_DOM' })
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
});

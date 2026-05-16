// ── Grok Bridge Background Service Worker ──────────────────────────────────
// 역할: content_app.js ↔ content_grok.js 사이의 메시지 라우터 + 작업 큐 관리

const GROK_URL = 'https://grok.com';
let grokTabId  = null;  // grok.com 탭 ID
let appTabId   = null;  // localhost 탭 ID

// 진행중인 작업 {jobId → {resolve, reject, timeout}}
const pendingJobs = new Map();

// ── 탭 추적 ─────────────────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url?.startsWith(GROK_URL)) grokTabId = tabId;
  if (tab.url?.startsWith('http://localhost')) appTabId = tabId;
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === grokTabId) grokTabId = null;
  if (tabId === appTabId)  appTabId  = null;
});

// 기존 탭 스캔
async function scanExistingTabs() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (t.url?.startsWith(GROK_URL))      grokTabId = t.id;
    if (t.url?.startsWith('http://localhost')) appTabId  = t.id;
  }
}
scanExistingTabs();

// ── grok.com 탭 열기/포커스 ─────────────────────────────────────────────────
async function ensureGrokTab() {
  if (grokTabId) {
    try {
      const tab = await chrome.tabs.get(grokTabId);
      if (tab) {
        await chrome.tabs.update(grokTabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return grokTabId;
      }
    } catch {}
  }
  // 새 탭 열기
  const tab = await chrome.tabs.create({ url: GROK_URL, active: true });
  grokTabId = tab.id;
  // 페이지 로드 대기
  await new Promise(resolve => {
    const listener = (tabId, changeInfo) => {
      if (tabId === grokTabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
  await new Promise(r => setTimeout(r, 2000)); // React 초기화 대기
  return grokTabId;
}

// ── 메시지 핸들러 ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch(e => sendResponse({ error: e.message }));
  return true; // async
});

async function handleMessage(msg, sender) {
  switch (msg.type) {

    // 앱에서 생성 요청
    case 'GROK_GENERATE': {
      const tabId = await ensureGrokTab();
      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      // grok content script에 작업 전달
      await chrome.tabs.sendMessage(tabId, {
        type: 'DO_GENERATE',
        jobId,
        mode:   msg.mode,   // 'text_to_video' | 'frame_to_video' | 'text_to_image' | 'image_to_image'
        prompt: msg.prompt,
        imageDataUrl: msg.imageDataUrl || null,
      });

      // 결과 대기 (최대 5분)
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingJobs.delete(jobId);
          reject(new Error('생성 시간 초과 (5분)'));
        }, 5 * 60 * 1000);
        pendingJobs.set(jobId, { resolve, reject, timeout });
      });
    }

    // grok content script에서 결과 도착
    case 'GENERATE_RESULT': {
      const job = pendingJobs.get(msg.jobId);
      if (!job) return { ok: false };
      clearTimeout(job.timeout);
      pendingJobs.delete(msg.jobId);
      if (msg.error) job.reject(new Error(msg.error));
      else           job.resolve({ url: msg.url, type: msg.mediaType });
      // 앱 탭에도 push 알림
      if (appTabId) {
        chrome.tabs.sendMessage(appTabId, {
          type: 'GROK_RESULT_PUSH',
          jobId: msg.jobId,
          url: msg.url,
          mediaType: msg.mediaType,
          error: msg.error || null,
        }).catch(() => {});
      }
      return { ok: true };
    }

    // 상태 조회
    case 'GET_STATUS': {
      return {
        grokTabId,
        appTabId,
        pendingCount: pendingJobs.size,
      };
    }

    // grok.com 탭 열기
    case 'OPEN_GROK': {
      await ensureGrokTab();
      return { ok: true };
    }

    default:
      return { error: 'unknown message type' };
  }
}

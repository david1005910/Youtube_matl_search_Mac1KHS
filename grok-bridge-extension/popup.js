const logArea     = document.getElementById('logArea');
const connDot     = document.getElementById('connDot');
const connLabel   = document.getElementById('connLabel');
const appBadge    = document.getElementById('appBadge');
const grokBadge   = document.getElementById('grokBadge');
const pendingEl   = document.getElementById('pendingCount');

function addLog(msg, type = 'normal') {
  const span = document.createElement('span');
  span.className = type === 'error' ? 'log-err' : type === 'info' ? 'log-info' : type === 'warn' ? 'log-warn' : '';
  span.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  logArea.appendChild(span);
  logArea.scrollTop = logArea.scrollHeight;
  // 최대 50줄
  while (logArea.children.length > 50) logArea.removeChild(logArea.firstChild);
}

async function refreshStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    const appOk  = !!status.appTabId;
    const grokOk = !!status.grokTabId;
    const allOk  = appOk && grokOk;

    connDot.className   = `dot ${allOk ? 'green' : appOk ? 'yellow' : 'red'}`;
    connLabel.textContent = allOk ? '✅ 모두 연결됨' : appOk ? '⚠️ grok.com 미연결' : '❌ 연결 안 됨';

    appBadge.className  = `badge ${appOk ? 'green' : 'gray'}`;
    appBadge.textContent = appOk ? `탭 #${status.appTabId}` : '없음';

    grokBadge.className  = `badge ${grokOk ? 'green' : 'gray'}`;
    grokBadge.textContent = grokOk ? `탭 #${status.grokTabId}` : '없음';

    pendingEl.textContent = status.pendingCount;
  } catch (e) {
    connDot.className = 'dot red';
    connLabel.textContent = '❌ 백그라운드 오류';
    addLog(e.message, 'error');
  }
}

document.getElementById('openGrokBtn').addEventListener('click', async () => {
  addLog('grok.com 탭 열기...', 'info');
  await chrome.runtime.sendMessage({ type: 'OPEN_GROK' });
  await refreshStatus();
  addLog('grok.com 탭 열림', 'info');
});

document.getElementById('openAppBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://localhost:8765' });
});

document.getElementById('refreshBtn').addEventListener('click', () => {
  addLog('상태 새로고침', 'info');
  refreshStatus();
});

document.getElementById('inspectLink').addEventListener('click', async (e) => {
  e.preventDefault();
  // grok.com 탭에서 셀렉터 검사 실행
  const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  if (!status.grokTabId) {
    addLog('grok.com 탭이 없습니다. 먼저 열어주세요.', 'warn');
    return;
  }
  await chrome.scripting.executeScript({
    target: { tabId: status.grokTabId },
    func: () => {
      const results = {
        inputs: [...document.querySelectorAll('textarea, div[contenteditable]')].map(el => ({
          tag: el.tagName, placeholder: el.getAttribute('placeholder'), id: el.id, classes: el.className.slice(0, 60)
        })),
        buttons: [...document.querySelectorAll('button')].slice(0, 10).map(el => ({
          text: el.textContent.trim().slice(0, 40), ariaLabel: el.getAttribute('aria-label'), type: el.type
        })),
        videos: document.querySelectorAll('video').length,
      };
      console.log('[GrokBridge DOM Inspect]', JSON.stringify(results, null, 2));
      alert('[GrokBridge] DOM 검사 결과를 DevTools 콘솔(F12)에서 확인하세요.');
    }
  });
  addLog('DevTools 콘솔에서 DOM 정보 확인하세요', 'info');
});

// 초기화
refreshStatus();
addLog('Grok Bridge 팝업 열림', 'info');
setInterval(refreshStatus, 5000);

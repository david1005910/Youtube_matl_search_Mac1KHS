'use strict';

// ── 탭 전환 ─────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ── 로그 ─────────────────────────────────────────────────────────────────────
const logArea = document.getElementById('logArea');
function addLog(msg, type = '') {
  const span = document.createElement('span');
  span.className = type;
  const time = new Date().toLocaleTimeString('ko', { hour12: false });
  span.textContent = `[${time}] ${msg}\n`;
  logArea.appendChild(span);
  logArea.scrollTop = logArea.scrollHeight;
  while (logArea.children.length > 100) logArea.removeChild(logArea.firstChild);
}
document.getElementById('clearLogBtn').addEventListener('click', () => logArea.innerHTML = '');

// ── 상태 조회 ─────────────────────────────────────────────────────────────────
const connDot   = document.getElementById('connDot');
const connLabel = document.getElementById('connLabel');

async function refreshStatus() {
  try {
    const s = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    const appOk  = !!s.appTabId;
    const grokOk = !!s.grokTabId;

    connDot.className = `dot ${appOk && grokOk ? 'green' : appOk ? 'yellow' : 'red'}`;
    connLabel.textContent = appOk && grokOk ? '✅ 모두 연결됨'
                          : appOk ? '⚠️ grok.com 탭 필요'
                          : '❌ 웹앱 탭 없음';

    const appBadge  = document.getElementById('appBadge');
    const grokBadge = document.getElementById('grokBadge');
    appBadge.className  = `badge ${appOk  ? 'green' : 'gray'}`;
    appBadge.textContent = appOk  ? `탭 #${s.appTabId}`  : '미감지';
    grokBadge.className  = `badge ${grokOk ? 'green' : 'gray'}`;
    grokBadge.textContent = grokOk ? `탭 #${s.grokTabId}` : '미감지';
    document.getElementById('pendingCount').textContent = s.pendingCount;
  } catch (e) {
    connDot.className = 'dot red';
    connLabel.textContent = '❌ 백그라운드 연결 오류';
    addLog(e.message, 'err');
  }
}

// ── 버튼 이벤트 ───────────────────────────────────────────────────────────────
document.getElementById('openGrokBtn').addEventListener('click', async () => {
  addLog('grok.com 탭 열기...', 'info');
  await chrome.runtime.sendMessage({ type: 'OPEN_GROK' });
  await refreshStatus();
  addLog('grok.com 열림', 'ok');
});

document.getElementById('openAppBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://localhost:8765' });
  addLog('웹앱 열기 요청', 'info');
});

document.getElementById('refreshBtn').addEventListener('click', () => {
  refreshStatus();
  addLog('상태 새로고침', 'info');
});

// ── 테스트 생성 ───────────────────────────────────────────────────────────────
document.getElementById('testGenerateBtn').addEventListener('click', async () => {
  const btn      = document.getElementById('testGenerateBtn');
  const mode     = document.getElementById('testMode').value;
  const prompt   = document.getElementById('testPrompt').value.trim();
  const resultEl = document.getElementById('testResult');

  if (!prompt) { addLog('프롬프트를 입력하세요', 'warn'); return; }

  btn.textContent = '⏳ 실행 중...';
  btn.disabled    = true;
  resultEl.style.display = 'block';
  resultEl.style.color   = '#fbbf24';
  resultEl.textContent   = 'grok.com으로 전송 중...';
  addLog(`테스트 시작: ${mode} — ${prompt.slice(0,40)}`, 'info');

  try {
    const s = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (!s.grokTabId) {
      addLog('grok.com 탭이 없어 자동으로 엽니다', 'warn');
      await chrome.runtime.sendMessage({ type: 'OPEN_GROK' });
      await new Promise(r => setTimeout(r, 3000));
    }

    const jobId = `popup_test_${Date.now()}`;
    const res   = await chrome.runtime.sendMessage({ type: 'GROK_GENERATE', jobId, mode, prompt, imageDataUrl: null });

    if (res?.error) throw new Error(res.error);
    if (res?.url) {
      resultEl.style.color = '#4ade80';
      resultEl.innerHTML   = `✅ 완료! <a href="${res.url}" target="_blank" style="color:#818cf8">결과 보기</a>`;
      addLog(`생성 완료: ${res.mediaType} — ${res.url.slice(0,60)}`, 'ok');
    } else {
      resultEl.style.color = '#94a3b8';
      resultEl.textContent = '완료 (URL 없음 — grok.com 탭 직접 확인)';
    }
  } catch (e) {
    resultEl.style.color = '#f87171';
    resultEl.textContent = '❌ ' + e.message;
    addLog('오류: ' + e.message, 'err');
  } finally {
    btn.textContent = '▶ 테스트 실행';
    btn.disabled    = false;
  }
});

// ── DOM 검사 ──────────────────────────────────────────────────────────────────
document.getElementById('inspectBtn').addEventListener('click', async () => {
  const resultEl = document.getElementById('domResult');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div style="color:#fbbf24">스캔 중...</div>';
  addLog('DOM 스캔 시작', 'info');

  try {
    const s = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (!s.grokTabId) { resultEl.innerHTML = '<div style="color:#f87171">grok.com 탭이 없습니다. 먼저 열어주세요.</div>'; return; }

    const snapshot = await chrome.tabs.sendMessage(s.grokTabId, { type: 'INSPECT_DOM' });
    addLog(`DOM 스캔 완료 — 인풋 ${snapshot.inputs.length}개, 버튼 ${snapshot.buttons.length}개`, 'ok');

    let html = `<div style="color:#4ade80;margin-bottom:6px;font-size:10px">📍 ${snapshot.url}</div>`;

    if (snapshot.inputs.length) {
      html += `<div style="color:#818cf8;font-size:10px;margin-bottom:4px">🔤 인풋 요소 (${snapshot.inputs.length}개)</div>`;
      snapshot.inputs.forEach((el, i) => {
        const desc = el.placeholder || el.ariaLabel || el.dataTestId || el.class.slice(0,30) || '(unknown)';
        const visIcon = el.visible ? '👁' : '🙈';
        html += `<div class="dom-item" data-sel='${buildSelector(el)}'>
          <span class="tag">${el.tag}</span>
          <span class="label"> ${desc.slice(0,50)}</span>
          <span class="visible"> ${visIcon}</span>
        </div>`;
      });
    }

    if (snapshot.buttons.length) {
      html += `<div style="color:#fb923c;font-size:10px;margin:6px 0 4px">🔘 버튼 (${snapshot.buttons.length}개)</div>`;
      snapshot.buttons.filter(b => b.visible).slice(0, 8).forEach(b => {
        const label = b.ariaLabel || b.text || '(no label)';
        html += `<div class="dom-item"><span class="tag">BTN</span> <span class="label">${label.slice(0,60)}</span></div>`;
      });
    }

    if (snapshot.videos.length) {
      html += `<div style="color:#4ade80;margin-top:6px;font-size:10px">🎥 비디오 ${snapshot.videos.length}개 감지됨</div>`;
    }

    resultEl.innerHTML = html;

    // 클릭 시 해당 요소 강조
    resultEl.querySelectorAll('.dom-item[data-sel]').forEach(item => {
      item.addEventListener('click', async () => {
        const sel = item.dataset.sel;
        const r   = await chrome.tabs.sendMessage(s.grokTabId, { type: 'HIGHLIGHT_EL', selector: sel });
        addLog(`강조: ${sel} → ${r.found ? '찾음' : '없음'}`, r.found ? 'ok' : 'warn');
      });
    });

  } catch (e) {
    resultEl.innerHTML = `<div style="color:#f87171">오류: ${e.message}<br>content_grok.js가 grok.com에 로드됐는지 확인하세요.</div>`;
    addLog('DOM 검사 오류: ' + e.message, 'err');
  }
});

document.getElementById('clearDomBtn').addEventListener('click', () => {
  const el = document.getElementById('domResult');
  el.innerHTML = '';
  el.style.display = 'none';
});

function buildSelector(el) {
  if (el.id) return `#${el.id}`;
  if (el.dataTestId) return `[data-testid="${el.dataTestId}"]`;
  if (el.ariaLabel) return `${el.tag.toLowerCase()}[aria-label="${el.ariaLabel}"]`;
  if (el.placeholder) return `${el.tag.toLowerCase()}[placeholder="${el.placeholder.slice(0,30)}"]`;
  if (el.contentEditable === 'true') return 'div[contenteditable=true]';
  return el.tag.toLowerCase();
}

// ── 초기화 ────────────────────────────────────────────────────────────────────
refreshStatus();
setInterval(refreshStatus, 5000);
addLog('Grok Bridge 팝업 시작', 'info');

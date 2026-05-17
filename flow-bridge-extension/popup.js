'use strict';

// ── 탭 전환 ──────────────────────────────────────────────────────────────────
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
async function refreshStatus() {
  try {
    const s = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    const appOk  = !!s.appTabId;
    const flowOk = !!s.flowTabId;

    const dot   = document.getElementById('connDot');
    const label = document.getElementById('connLabel');
    dot.className = `dot ${appOk && flowOk ? 'green' : appOk ? 'yellow' : 'red'}`;
    label.textContent = appOk && flowOk ? '✅ 모두 연결됨'
                      : appOk ? '⚠️ Google Flow 탭 필요'
                      : '❌ 웹앱 탭 없음';

    const appBadge  = document.getElementById('appBadge');
    const flowBadge = document.getElementById('flowBadge');
    appBadge.className  = `badge ${appOk  ? 'green' : 'gray'}`;
    appBadge.textContent = appOk  ? `탭 #${s.appTabId}`  : '미감지';
    flowBadge.className  = `badge ${flowOk ? 'green' : 'gray'}`;
    flowBadge.textContent = flowOk ? `탭 #${s.flowTabId}` : '미감지';
    document.getElementById('pendingCount').textContent = s.pendingCount;
  } catch (e) {
    document.getElementById('connDot').className = 'dot red';
    document.getElementById('connLabel').textContent = '❌ 백그라운드 연결 오류';
    addLog(e.message, 'err');
  }
}

// ── 버튼 이벤트 ───────────────────────────────────────────────────────────────
document.getElementById('openFlowBtn').addEventListener('click', async () => {
  addLog('Google Flow 탭 열기...', 'info');
  await chrome.runtime.sendMessage({ type: 'OPEN_FLOW' });
  await refreshStatus();
  addLog('Google Flow 열림', 'ok');
});

document.getElementById('openAppBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://localhost:8765' });
  addLog('웹앱 열기', 'info');
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
  resultEl.textContent   = 'Google Flow로 전송 중...';
  addLog(`테스트 시작: ${mode} — ${prompt.slice(0, 40)}`, 'info');

  try {
    const s = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (!s.flowTabId) {
      addLog('Flow 탭 없어 자동으로 엽니다', 'warn');
      await chrome.runtime.sendMessage({ type: 'OPEN_FLOW' });
      await new Promise(r => setTimeout(r, 4000));
    }

    const jobId = `popup_test_${Date.now()}`;
    const res   = await chrome.runtime.sendMessage({ type: 'FLOW_GENERATE', jobId, mode, prompt, imageDataUrl: null });

    if (res?.error) throw new Error(res.error);
    resultEl.style.color = '#94a3b8';
    resultEl.textContent = '⏳ 생성 중... Google Flow 탭을 확인하세요';
    addLog('생성 요청 전송됨 — Flow 탭에서 진행 상황 확인', 'ok');
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
    if (!s.flowTabId) {
      resultEl.innerHTML = '<div style="color:#f87171">Google Flow 탭이 없습니다. 먼저 열어주세요.</div>';
      return;
    }

    const snapshot = await chrome.tabs.sendMessage(s.flowTabId, { type: 'INSPECT_DOM' });
    addLog(`DOM 스캔 완료 — 인풋 ${snapshot.inputs?.length || 0}개, 버튼 ${snapshot.buttons?.length || 0}개, 타일 ${snapshot.tiles || 0}개`, 'ok');

    let html = `<div style="color:#4ade80;margin-bottom:6px;font-size:10px">📍 ${snapshot.url}</div>`;

    const sc = snapshot.confirmedSelectors || {};
    const isEditor = snapshot.isEditorPage ? '✅ 편집페이지' : '⚠️ 목록페이지';
    html += `<div style="color:#34d399;font-size:10px;margin-bottom:4px">
      ${isEditor} &nbsp;|&nbsp;
      ${sc.promptTextarea      ? '✅' : '❌'} 프롬프트 &nbsp;
      ${sc.submitButton        ? '✅' : '❌'} 전송버튼 &nbsp;
      ${sc.createProjectButton ? '✅' : '❌'} 새프로젝트 &nbsp;
      타일: ${sc.outputItems || 0}개
    </div>`;

    if (snapshot.materialIcons?.length) {
      html += `<div style="color:#64748b;font-size:9px;margin-bottom:4px">아이콘: ${snapshot.materialIcons.join(', ')}</div>`;
    }

    if (snapshot.inputs?.length) {
      html += `<div style="color:#818cf8;font-size:10px;margin-bottom:4px">🔤 인풋 (${snapshot.inputs.length}개)</div>`;
      snapshot.inputs.forEach(el => {
        const desc = el.placeholder || el.ariaLabel || el.role || '(unknown)';
        html += `<div class="dom-item"><span class="tag">${el.tag}</span> <span class="label">${desc.slice(0,50)}</span></div>`;
      });
    }

    if (snapshot.buttons?.length) {
      html += `<div style="color:#fb923c;font-size:10px;margin:6px 0 4px">🔘 버튼 (${snapshot.buttons.length}개)</div>`;
      snapshot.buttons.forEach(b => {
        const label = b.ariaLabel || b.text || '(no label)';
        html += `<div class="dom-item"><span class="tag">BTN</span> <span class="label">${label.slice(0,60)}</span></div>`;
      });
    }

    if (snapshot.videos?.length) {
      html += `<div style="color:#4ade80;margin-top:6px;font-size:10px">🎥 비디오 ${snapshot.videos.length}개</div>`;
    }

    resultEl.innerHTML = html;
  } catch (e) {
    resultEl.innerHTML = `<div style="color:#f87171">오류: ${e.message}<br>content_flow.js가 로드됐는지 확인하세요.</div>`;
    addLog('DOM 검사 오류: ' + e.message, 'err');
  }
});

document.getElementById('clearDomBtn').addEventListener('click', () => {
  const el = document.getElementById('domResult');
  el.innerHTML = '';
  el.style.display = 'none';
});

// ── background → 팝업 실시간 로그/결과 수신 ─────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'POPUP_LOG') {
    addLog(msg.message, msg.message.startsWith('✅') ? 'ok' : msg.message.startsWith('❌') ? 'err' : 'info');
  }
  if (msg.type === 'POPUP_RESULT') {
    const resultEl = document.getElementById('testResult');
    if (resultEl) {
      if (msg.error) {
        resultEl.style.color = '#f87171';
        resultEl.textContent = '❌ ' + msg.error;
        addLog('생성 실패: ' + msg.error, 'err');
      } else if (msg.url) {
        resultEl.style.color = '#4ade80';
        resultEl.innerHTML = `✅ 완료! <a href="${msg.url}" target="_blank" style="color:#34d399">결과 보기</a>`;
        addLog('생성 완료: ' + msg.mediaType + ' — ' + (msg.url || '').slice(0, 60), 'ok');
      } else {
        resultEl.style.color = '#94a3b8';
        resultEl.textContent = '✅ 완료 (URL 없음 — Flow 탭 직접 확인)';
        addLog('생성 완료 (URL 미감지)', 'ok');
      }
    }
  }
});

// ── 초기화 ────────────────────────────────────────────────────────────────────
refreshStatus();
setInterval(refreshStatus, 5000);
addLog('Flow Bridge 팝업 시작', 'info');

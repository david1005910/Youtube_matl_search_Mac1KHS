// ── Flow Bridge v1.2 — content_flow.js (에디터 전용) ────────────────────────
// navigation은 background.js가 담당. 이 스크립트는 fill+submit+detect만 처리.
(function () {
  'use strict';

  console.log('[FlowBridge v1.2] content_flow.js @', location.href);

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function log(...a)  { console.log('[FlowBridge]', ...a); }

  // ── 셀렉터 ───────────────────────────────────────────────────────────────
  function qBtn(iconName) {
    return [...document.querySelectorAll('button')].find(b =>
      [...b.querySelectorAll('i')].some(i => i.textContent.trim() === iconName)
    ) || null;
  }
  function qTextbox() {
    return document.querySelector('div[role="textbox"]') ||
           document.querySelector('[contenteditable="true"][data-slate-editor="true"]') ||
           null;
  }

  async function waitForTextbox(ms = 15000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const el = qTextbox();
      if (el) return el;
      await sleep(400);
    }
    return null;
  }

  // ── Flow Factory page-bridge 연동 ─────────────────────────────────────────
  let _ffReady = false;

  window.addEventListener('__flowBridgeReady', () => {
    _ffReady = true;
    log('Flow Factory page-bridge ✅');
  });

  function pingFlowFactory(timeoutMs = 2000) {
    return new Promise(resolve => {
      const onPong = (e) => {
        window.removeEventListener('__flowFillPromptDone', onPong);
        if (e.detail?.ok) { _ffReady = true; resolve(true); }
        else resolve(false);
      };
      window.addEventListener('__flowFillPromptDone', onPong);
      window.dispatchEvent(new CustomEvent('__flowFillPrompt', { detail: {} }));
      setTimeout(() => { window.removeEventListener('__flowFillPromptDone', onPong); resolve(false); }, timeoutMs);
    });
  }

  // 로드 시 즉시 ping
  pingFlowFactory(2000).then(ok => { if (ok) log('Flow Factory ping ✅'); });

  // ── 프롬프트 입력 ─────────────────────────────────────────────────────────
  async function fillPrompt(text) {
    // 사용 직전 Flow Factory 재확인
    if (!_ffReady) {
      log('Flow Factory 재ping...');
      await pingFlowFactory(3000);
    }

    if (_ffReady) {
      log('Flow Factory __flowFillPrompt 사용');
      const ok = await new Promise(resolve => {
        const onDone = (e) => {
          window.removeEventListener('__flowFillPromptDone', onDone);
          resolve(e.detail?.ok === true);
        };
        window.addEventListener('__flowFillPromptDone', onDone);
        window.dispatchEvent(new CustomEvent('__flowFillPrompt', { detail: { text, replaceAll: true } }));
        setTimeout(() => { window.removeEventListener('__flowFillPromptDone', onDone); resolve(false); }, 5000);
      });

      if (ok) {
        // 입력 확인
        const box = qTextbox();
        const filled = box?.textContent?.trim() || '';
        log('프롬프트 확인:', filled.slice(0, 60) || '(비어있음)');
        await sleep(500);
        return true;
      }
      log('Flow Factory 실패 → DOM 폴백');
    }

    // DOM 폴백
    const el = await waitForTextbox(5000);
    if (!el) throw new Error('프롬프트 입력창 없음');
    el.focus();
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    document.execCommand('insertText', false, text);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    await sleep(600);
    return true;
  }

  // ── 전송 ─────────────────────────────────────────────────────────────────
  async function submit() {
    sendProgress('전송 버튼 대기 중...');

    // 최대 10초 대기: 버튼 활성화
    let btn = null;
    for (let i = 0; i < 33; i++) {
      btn = qBtn('arrow_forward');
      if (btn && btn.getAttribute('aria-disabled') !== 'true') break;
      await sleep(300);
    }

    if (btn) {
      log('전송 버튼 클릭 시도 1: click()');
      btn.click();
      await sleep(800);

      // 버튼이 여전히 있고 화면이 그대로면 mouse event 시도
      const stillSame = qBtn('arrow_forward');
      if (stillSame) {
        log('전송 버튼 클릭 시도 2: MouseEvent');
        btn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        btn.dispatchEvent(new MouseEvent('pointerup',   { bubbles: true }));
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await sleep(800);
      }
    }

    // Enter 키 폴백
    const box = qTextbox();
    if (box) {
      log('Enter 키 폴백 시도');
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
      box.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      await sleep(500);
    }

    if (!btn && !box) throw new Error('전송 버튼과 입력창 모두 없음');
    log('전송 완료');
  }

  // ── 진행상황 ──────────────────────────────────────────────────────────────
  function sendProgress(msg) {
    log(msg);
    chrome.runtime.sendMessage({ type: 'GENERATE_PROGRESS', message: msg }).catch(() => {});
  }

  // ── 결과 대기 ─────────────────────────────────────────────────────────────
  function waitForResult(timeoutMs = 5 * 60 * 1000) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      let lastTileCount = document.querySelectorAll('[data-tile-id]').length;
      let resolved = false;
      let tickCount = 0;

      function done(result) {
        if (resolved) return;
        resolved = true;
        obs.disconnect();
        clearInterval(timer);
        resolve(result);
      }

      const check = () => {
        if (resolved) return;
        if (Date.now() > deadline) {
          obs.disconnect(); clearInterval(timer);
          return reject(new Error('생성 시간 초과 (5분)'));
        }
        tickCount++;
        if (tickCount % 5 === 0) sendProgress(`⏳ 생성 중... (${Math.round((Date.now()-(deadline-timeoutMs))/1000)}초)`);

        for (const v of document.querySelectorAll('[data-tile-id] video, video')) {
          const src = v.src || v.currentSrc || '';
          if (src && src.length > 10 && !src.endsWith('#')) {
            return done({ url: src, mediaType: 'video' });
          }
        }
        const tiles = document.querySelectorAll('[data-tile-id]').length;
        if (tiles > lastTileCount) {
          lastTileCount = tiles;
          sendProgress(`🔲 새 타일 감지 (${tiles}개)`);
          const imgs = [...document.querySelectorAll('[data-tile-id] img[src]')]
            .map(i => i.src).filter(s => s.length > 30 && !s.includes('icon'));
          if (imgs.length) return done({ url: imgs[imgs.length - 1], mediaType: 'image' });
        }
      };

      const obs = new MutationObserver(check);
      obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-tile-id'] });
      const timer = setInterval(check, 2000);
      check();
    });
  }

  // ── 생성 실행 ─────────────────────────────────────────────────────────────
  async function doGenerate({ jobId, mode, prompt, imageDataUrl }) {
    log(`[${jobId}] 생성 시작 — "${prompt.slice(0, 50)}"`);
    try {
      // 에디터 확인 (background가 이미 이동했지만 혹시 모를 경우 대비)
      sendProgress('✏️ 프롬프트 입력 중...');
      const el = await waitForTextbox(10000);
      if (!el) throw new Error('에디터 로드 실패 (textbox 없음)');

      await fillPrompt(prompt);
      sendProgress('📤 전송 중...');
      await submit();
      sendProgress('⏳ 생성 시작 — 결과 대기...');

      await sleep(3000);
      const result = await waitForResult();
      sendProgress(`✅ 완료: ${result.mediaType}`);
      return { jobId, ...result };
    } catch (e) {
      log('❌', e.message);
      return { jobId, error: e.message };
    }
  }

  // ── 프롬프트만 채우기 (수동 모드) ────────────────────────────────────────
  async function doFillOnly({ prompt }) {
    const el = await waitForTextbox(10000);
    if (!el) throw new Error('textbox 없음');
    await fillPrompt(prompt);
    // 전송 버튼에 포커스 (사용자가 Enter/클릭하기 쉽도록)
    const btn = qBtn('arrow_forward');
    if (btn) btn.focus();
    sendProgress('✏️ 프롬프트 입력 완료 — Flow에서 생성 버튼을 클릭하세요');
  }

  // ── DOM 스냅샷 ────────────────────────────────────────────────────────────
  function snapshotDOM() {
    const hasPrompt = !!qTextbox();
    const hasSubmit = !!qBtn('arrow_forward');
    return {
      url: location.href,
      isEditorPage: hasPrompt,
      inputs: [...document.querySelectorAll('textarea, div[role=textbox], [contenteditable=true]')].map(el => ({
        tag: el.tagName, role: el.getAttribute('role') || '',
        placeholder: (el.getAttribute('placeholder') || '').slice(0, 60),
        visible: el.offsetParent !== null,
      })),
      buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).slice(0, 20).map(b => ({
        text: b.textContent.trim().slice(0, 50),
        icons: [...b.querySelectorAll('i')].map(i => i.textContent.trim()).filter(Boolean),
      })),
      tiles: document.querySelectorAll('[data-tile-id]').length,
      videos: [...document.querySelectorAll('video')].map(v => v.src || v.currentSrc).filter(Boolean),
      materialIcons: [...new Set([...document.querySelectorAll('i')].map(i => i.textContent.trim()).filter(Boolean))].slice(0, 30),
      confirmedSelectors: { promptTextarea: hasPrompt, submitButton: hasSubmit, outputItems: document.querySelectorAll('[data-tile-id]').length },
      flowFactoryReady: _ffReady,
      version: 'v1.2',
    };
  }

  // ── 메시지 수신 ───────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'DO_GENERATE') {
      doGenerate(msg).then(result => {
        chrome.runtime.sendMessage({ type: 'GENERATE_RESULT', ...result });
        sendResponse({ ok: true });
      });
      return true;
    }
    if (msg.type === 'DO_FILL_ONLY') {
      doFillOnly(msg).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
      return true;
    }
    if (msg.type === 'INSPECT_DOM') {
      sendResponse(snapshotDOM());
      return true;
    }
  });

  log('✅ 준비 완료. Flow Factory:', _ffReady ? '연결됨' : '대기 중');
})();

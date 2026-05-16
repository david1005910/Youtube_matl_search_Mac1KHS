// ── Grok Bridge — grok.com Content Script ───────────────────────────────────
(function () {
  'use strict';

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function log(...a) { console.log('[GrokBridge]', ...a); }

  // ── DOM 감지 (여러 전략 순서대로 시도) ────────────────────────────────────
  async function findEl(strategies, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const sel of strategies) {
        try {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) return el; // 보이는 것만
        } catch {}
      }
      await sleep(400);
    }
    return null;
  }

  // ── 페이지 DOM 구조 스냅샷 (팝업 디버그용) ────────────────────────────────
  function snapshotDOM() {
    const inputs = [...document.querySelectorAll(
      'textarea, input[type=text], div[contenteditable=true], div[contenteditable=""]'
    )].map(el => ({
      tag: el.tagName,
      id: el.id || '',
      name: el.getAttribute('name') || '',
      placeholder: el.getAttribute('placeholder') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      dataTestId: el.getAttribute('data-testid') || '',
      class: el.className?.toString().slice(0, 80) || '',
      visible: el.offsetParent !== null,
      contentEditable: el.contentEditable,
    }));

    const buttons = [...document.querySelectorAll('button')].slice(0, 20).map(b => ({
      text: b.textContent.trim().slice(0, 40),
      ariaLabel: b.getAttribute('aria-label') || '',
      type: b.type,
      dataTestId: b.getAttribute('data-testid') || '',
      disabled: b.disabled,
      visible: b.offsetParent !== null,
    }));

    const videos = [...document.querySelectorAll('video')].map(v => v.src || v.currentSrc).filter(Boolean);
    const url = location.href;

    return { url, inputs, buttons, videos, ts: Date.now() };
  }

  // ── React 인풋에 값 주입 ──────────────────────────────────────────────────
  function setInputValue(el, value) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.isContentEditable) {
      el.focus();
      document.execCommand('selectAll', false);
      document.execCommand('delete', false);
      document.execCommand('insertText', false, value);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    }
  }

  // ── 전송 버튼 클릭 ────────────────────────────────────────────────────────
  function clickSubmit(inputEl) {
    // 1) 인풋 근처의 버튼 찾기
    let btn = inputEl?.closest('form')?.querySelector('button[type=submit]')
           || inputEl?.parentElement?.querySelector('button:not([disabled])')
           || inputEl?.closest('[role=form]')?.querySelector('button');

    // 2) 전역 전송 버튼 후보
    if (!btn) {
      const candidates = [...document.querySelectorAll('button')].filter(b => {
        const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
        return (label.includes('send') || label.includes('submit') || label.includes('전송') || label.includes('보내')) && !b.disabled;
      });
      btn = candidates[0];
    }

    // 3) SVG 화살표 버튼 (많은 AI 채팅 앱에서 사용)
    if (!btn) {
      btn = [...document.querySelectorAll('button')].find(b =>
        b.querySelector('svg') && !b.disabled && b.offsetParent !== null
      );
    }

    if (btn) {
      btn.removeAttribute('disabled');
      btn.click();
      log('전송 버튼 클릭:', btn.getAttribute('aria-label') || btn.textContent.slice(0,20));
      return true;
    }

    // 4) Enter 키 이벤트로 전송
    if (inputEl) {
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      log('Enter 키로 전송 시도');
      return true;
    }
    return false;
  }

  // ── 이미지 업로드 ─────────────────────────────────────────────────────────
  async function uploadImage(dataUrl) {
    const res  = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' });

    const fileInput = document.querySelector('input[type=file][accept*=image], input[type=file]');
    if (fileInput) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(1500);
      log('파일 인풋 업로드 완료');
      return true;
    }

    // 드래그앤드롭 fallback
    const dropZone = document.querySelector(
      '[data-testid*=upload], [class*=upload], [class*=drop], [aria-label*=upload], [aria-label*=image]'
    );
    if (dropZone) {
      const dt = new DataTransfer();
      dt.items.add(file);
      ['dragenter','dragover','drop'].forEach(type =>
        dropZone.dispatchEvent(new DragEvent(type, { bubbles: true, dataTransfer: dt }))
      );
      await sleep(1500);
      log('드래그앤드롭 업로드 완료');
      return true;
    }

    log('⚠️ 업로드 영역을 찾지 못함');
    return false;
  }

  // ── 결과 감지 ─────────────────────────────────────────────────────────────
  function waitForNewResult(beforeVideos, beforeImgs, timeoutMs = 4 * 60 * 1000) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;

      const check = () => {
        if (Date.now() > deadline) return reject(new Error('생성 시간 초과 (4분)'));

        const videos = [...document.querySelectorAll('video')].map(v => v.src || v.currentSrc).filter(Boolean);
        const imgs   = [...document.querySelectorAll('img[src]')].map(i => i.src).filter(s =>
          s && s.length > 60 && !s.includes('icon') && !s.includes('logo') && !s.includes('avatar')
        );

        if (videos.length > beforeVideos) return resolve({ videos, imgs, type: 'video' });
        if (imgs.length > beforeImgs)     return resolve({ videos, imgs, type: 'image' });
      };

      const obs = new MutationObserver(check);
      obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      const timer = setInterval(() => {
        check();
        if (Date.now() > deadline) { clearInterval(timer); obs.disconnect(); reject(new Error('시간 초과')); }
      }, 2000);

      // 즉시 한 번 확인
      check();
    }).then(r => { return r; });
  }

  // ── 메인 생성 로직 ────────────────────────────────────────────────────────
  async function doGenerate(job) {
    const { jobId, mode, prompt, imageDataUrl } = job;
    log('작업 시작', jobId, mode);

    // grok.com 인풋 셀렉터 (우선순위 순)
    const INPUT_SELS = [
      'textarea[placeholder*="Grok"]',
      'textarea[placeholder*="grok"]',
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Type"]',
      'textarea[placeholder*="Enter"]',
      'textarea[placeholder*="Generate"]',
      'textarea[aria-label*="message"]',
      'textarea[aria-label*="input"]',
      'textarea[aria-label*="prompt"]',
      'div[contenteditable=true][aria-label*="message"]',
      'div[contenteditable=true][aria-label*="input"]',
      'div[contenteditable=true][data-testid*="input"]',
      'div[contenteditable=true][data-testid*="message"]',
      'div[contenteditable=true][placeholder]',
      // 마지막 수단: 가장 큰 contenteditable
      'div[contenteditable=true]',
      'textarea',
    ];

    try {
      // 1. React 초기화 대기
      await sleep(1500);

      // 2. 인풋 찾기
      let inputEl = await findEl(INPUT_SELS, 10000);
      if (!inputEl) throw new Error('grok.com 입력창 감지 실패. DOM 검사 모드로 확인해주세요.');
      log('인풋 찾음:', inputEl.tagName, inputEl.placeholder || inputEl.getAttribute('aria-label'));

      // 3. 이미지 업로드 (frame_to_video / image_to_image)
      if (imageDataUrl && ['frame_to_video', 'image_to_image'].includes(mode)) {
        await uploadImage(imageDataUrl);
        inputEl = await findEl(INPUT_SELS, 5000) || inputEl; // 업로드 후 재탐색
      }

      // 4. 현재 미디어 수 기록
      const beforeVideos = document.querySelectorAll('video[src]').length;
      const beforeImgs   = [...document.querySelectorAll('img[src]')].filter(i =>
        i.src.length > 60 && !i.src.includes('icon') && !i.src.includes('logo')
      ).length;

      // 5. 프롬프트 입력
      setInputValue(inputEl, prompt);
      await sleep(600);

      // 6. 전송
      if (!clickSubmit(inputEl)) throw new Error('전송 버튼을 찾지 못했습니다.');
      log('전송 완료, 결과 대기 중...');

      // 7. 결과 대기
      await sleep(3000); // 로딩 시작 대기
      const result = await waitForNewResult(beforeVideos, beforeImgs);

      const url = result.type === 'video'
        ? result.videos[result.videos.length - 1]
        : result.imgs[result.imgs.length - 1];

      log('완료', { url: url?.slice(0, 80), type: result.type });
      return { jobId, url, mediaType: result.type };

    } catch (e) {
      log('오류:', e.message);
      return { jobId, error: e.message };
    }
  }

  // ── background 메시지 수신 ───────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'DO_GENERATE') {
      doGenerate(msg).then(result => {
        chrome.runtime.sendMessage({ type: 'GENERATE_RESULT', ...result });
        sendResponse({ ok: true });
      });
      return true;
    }

    if (msg.type === 'INSPECT_DOM') {
      sendResponse(snapshotDOM());
      return true;
    }

    if (msg.type === 'HIGHLIGHT_EL') {
      // 셀렉터 강조 표시 (디버그용)
      document.querySelectorAll('[data-grok-bridge-highlight]').forEach(el => {
        el.style.outline = '';
        delete el.dataset.grokBridgeHighlight;
      });
      try {
        const el = document.querySelector(msg.selector);
        if (el) {
          el.style.outline = '3px solid #22c55e';
          el.dataset.grokBridgeHighlight = '1';
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          sendResponse({ found: true, tag: el.tagName, text: el.textContent.slice(0, 50) });
        } else {
          sendResponse({ found: false });
        }
      } catch (e) {
        sendResponse({ found: false, error: e.message });
      }
      return true;
    }
  });

  log('content_grok.js loaded @', location.href);
})();

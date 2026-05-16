// ── Grok Bridge — grok.com Content Script ───────────────────────────────────
// DOM 셀렉터는 playwright로 grok.com 실제 스캔하여 확인된 값 사용
(function () {
  'use strict';

  // ── 확인된 실제 셀렉터 ──────────────────────────────────────────────────
  const SEL = {
    // 메인 텍스트 입력 (확인됨)
    input: [
      'textarea[placeholder="What do you want to know?"]',
      '[aria-label="Ask Grok anything"]',
      'textarea[placeholder*="want to know"]',
      'textarea[placeholder*="Ask"]',
      'div[contenteditable=true][aria-label*="Ask"]',
      'div[contenteditable=true]',
      'textarea',
    ],
    // 미디어 생성 모드 전환 버튼 (확인됨: aria-label="Imagine")
    imagineBtn: [
      'button[aria-label="Imagine"]',
      'button[aria-label*="Imagine"]',
      'button[aria-label*="imagine"]',
      'a[aria-label="Imagine"]',
      '[aria-label="Imagine"]',
    ],
    // 파일 첨부 버튼 (확인됨)
    attachBtn: [
      'button[aria-label="Attach"]',
      'button[aria-label*="Attach"]',
      '[aria-label="Attach"]',
    ],
    // 드롭 업로드 영역 (확인됨)
    dropZone: [
      '[data-testid="drop-container"]',
      '[data-testid="drop-ui"]',
      '[data-testid*="drop"]',
    ],
    // 전송 버튼 (aria-label 미확인 → 여러 전략)
    submit: [
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
      'button[type=submit]',
      'button[data-testid*="send"]',
    ],
    // 생성된 비디오/이미지
    video: 'video[src], video source[src]',
    image: 'img[src]',
  };

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function log(...a) { console.log('[GrokBridge]', ...a); }

  // ── 요소 탐색 (가시성 체크, 최대 대기) ────────────────────────────────
  async function waitFor(selList, timeoutMs = 10000) {
    const sels = Array.isArray(selList) ? selList : [selList];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const sel of sels) {
        try {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) return el;
        } catch {}
      }
      await sleep(300);
    }
    // 마지막 시도 — 비가시 요소도 허용
    for (const sel of sels) {
      try { const el = document.querySelector(sel); if (el) return el; } catch {}
    }
    return null;
  }

  // ── React 인풋 값 주입 ────────────────────────────────────────────────
  function setInputValue(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto  = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.isContentEditable) {
      document.execCommand('selectAll', false);
      document.execCommand('delete', false);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    log(`입력 완료: "${text.slice(0, 40)}..."`);
  }

  // ── 전송 버튼 찾아 클릭 ───────────────────────────────────────────────
  async function sendPrompt(inputEl) {
    // 1) 확정 셀렉터
    let btn = await waitFor(SEL.submit, 3000);

    // 2) 인풋 근처 버튼
    if (!btn) {
      btn = inputEl?.closest('form')?.querySelector('button:not([disabled])')
         || inputEl?.parentElement?.querySelector('button:not([disabled])')
         || inputEl?.parentElement?.parentElement?.querySelector('button:not([disabled])');
    }

    // 3) SVG 버튼 (화살표 아이콘)
    if (!btn) {
      btn = [...document.querySelectorAll('button')].find(b =>
        b.querySelector('svg') && !b.disabled && b.offsetParent !== null &&
        !b.getAttribute('aria-label')?.match(/attach|model|dictation|voice|notification/i)
      );
    }

    if (btn) {
      btn.removeAttribute('disabled');
      btn.click();
      log('전송 버튼 클릭:', btn.getAttribute('aria-label') || btn.textContent.slice(0, 20));
      return true;
    }

    // 4) Enter 키 fallback
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, bubbles:true }));
    log('Enter 키로 전송');
    return true;
  }

  // ── 이미지 업로드 ────────────────────────────────────────────────────
  async function uploadImage(dataUrl) {
    const res  = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' });

    // 1) Attach 버튼 클릭
    const attachBtn = await waitFor(SEL.attachBtn, 3000);
    if (attachBtn) {
      attachBtn.click();
      await sleep(1000);
    }

    // 2) 파일 인풋
    const fileInput = document.querySelector('input[type=file]');
    if (fileInput) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      log('파일 인풋으로 업로드');
      await sleep(2000);
      return true;
    }

    // 3) 드롭존
    const dropZone = await waitFor(SEL.dropZone, 3000);
    if (dropZone) {
      const dt = new DataTransfer();
      dt.items.add(file);
      ['dragenter','dragover','drop'].forEach(t =>
        dropZone.dispatchEvent(new DragEvent(t, { bubbles: true, dataTransfer: dt }))
      );
      log('드래그앤드롭으로 업로드');
      await sleep(2000);
      return true;
    }

    log('⚠️ 업로드 영역 미발견');
    return false;
  }

  // ── 결과 감지 ─────────────────────────────────────────────────────────
  function waitForNewContent(snap) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 4 * 60 * 1000;

      const check = () => {
        if (Date.now() > deadline) { obs.disconnect(); return reject(new Error('생성 시간 초과 (4분)')); }

        const videos = [...document.querySelectorAll('video')].map(v => v.src || v.currentSrc).filter(Boolean);
        const imgs   = [...document.querySelectorAll('img[src]')].map(i => i.src).filter(s =>
          s.length > 60 &&
          !s.includes('icon') && !s.includes('logo') && !s.includes('avatar') &&
          !s.includes('grok.com/favicon') && !s.includes('x.com/favicon')
        );

        if (videos.length > snap.videos) {
          obs.disconnect();
          return resolve({ url: videos[videos.length - 1], mediaType: 'video' });
        }
        if (imgs.length > snap.imgs) {
          obs.disconnect();
          return resolve({ url: imgs[imgs.length - 1], mediaType: 'image' });
        }
      };

      const obs = new MutationObserver(check);
      obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      setInterval(check, 2000);
      check();
    });
  }

  // ── 메인 생성 플로우 ──────────────────────────────────────────────────
  async function doGenerate(job) {
    const { jobId, mode, prompt, imageDataUrl } = job;
    log(`작업 시작 [${mode}]: "${prompt.slice(0, 50)}"`);

    try {
      // 1. 페이지 준비 대기
      await sleep(1500);

      // 2. 이미지/영상 생성 모드: "Imagine" 버튼 클릭 (확인된 aria-label)
      if (['text_to_image', 'text_to_video', 'frame_to_video', 'image_to_image'].includes(mode)) {
        const imagineBtn = await waitFor(SEL.imagineBtn, 5000);
        if (imagineBtn) {
          imagineBtn.click();
          log('"Imagine" 버튼 클릭 → 미디어 모드 전환');
          await sleep(1500);
        } else {
          log('⚠️ Imagine 버튼 미발견 — 채팅 모드로 진행');
        }
      }

      // 3. 이미지 업로드 (frame_to_video / image_to_image)
      if (imageDataUrl && ['frame_to_video', 'image_to_image'].includes(mode)) {
        await uploadImage(imageDataUrl);
      }

      // 4. 입력창 찾기
      const inputEl = await waitFor(SEL.input, 10000);
      if (!inputEl) throw new Error('입력창을 찾지 못했습니다. grok.com에 로그인 했는지 확인해주세요.');
      log(`입력창 발견: ${inputEl.tagName} placeholder="${inputEl.placeholder || inputEl.getAttribute('aria-label')}"`);

      // 5. 현재 미디어 개수 스냅샷
      const snap = {
        videos: document.querySelectorAll('video[src]').length,
        imgs:   [...document.querySelectorAll('img[src]')].filter(i => i.src.length > 60).length,
      };

      // 6. 프롬프트 입력
      setInputValue(inputEl, prompt);
      await sleep(800);

      // 7. 전송
      await sendPrompt(inputEl);
      log('전송 완료. 결과 대기 중...');

      // 8. 결과 대기
      await sleep(3000);
      const result = await waitForNewContent(snap);

      log(`✅ 생성 완료: ${result.mediaType} — ${result.url.slice(0, 80)}`);
      return { jobId, url: result.url, mediaType: result.mediaType };

    } catch (e) {
      log('❌ 오류:', e.message);
      return { jobId, error: e.message };
    }
  }

  // ── DOM 스냅샷 (팝업 DOM 검사용) ──────────────────────────────────────
  function snapshotDOM() {
    const q = sel => [...document.querySelectorAll(sel)];
    return {
      url: location.href,
      inputs: q('textarea, input[type=text], div[contenteditable=true]').map(el => ({
        tag: el.tagName,
        id: el.id || '',
        placeholder: (el.getAttribute('placeholder') || '').slice(0, 60),
        ariaLabel: (el.getAttribute('aria-label') || '').slice(0, 60),
        dataTestId: el.getAttribute('data-testid') || '',
        visible: el.offsetParent !== null,
        className: (el.className?.toString() || '').slice(0, 80),
      })),
      buttons: q('button').filter(b => b.offsetParent !== null).slice(0, 20).map(b => ({
        text: b.textContent.trim().slice(0, 50),
        ariaLabel: (b.getAttribute('aria-label') || '').slice(0, 50),
        dataTestId: b.getAttribute('data-testid') || '',
        disabled: b.disabled,
      })),
      videos: q('video').map(v => v.src || v.currentSrc).filter(Boolean),
      ts: Date.now(),
    };
  }

  // ── 메시지 수신 ───────────────────────────────────────────────────────
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
      document.querySelectorAll('[data-grok-hi]').forEach(el => {
        el.style.outline = '';
        delete el.dataset.grokHi;
      });
      try {
        const el = document.querySelector(msg.selector);
        if (el) {
          el.style.outline = '3px solid #22c55e';
          el.dataset.grokHi = '1';
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          sendResponse({ found: true, tag: el.tagName, text: el.textContent.slice(0, 50) });
        } else {
          sendResponse({ found: false });
        }
      } catch (e) { sendResponse({ found: false, error: e.message }); }
      return true;
    }
  });

  log('✅ content_grok.js 로드됨 @', location.href);
  log('확인된 셀렉터: textarea[placeholder="What do you want to know?"], button[aria-label="Imagine"]');
})();

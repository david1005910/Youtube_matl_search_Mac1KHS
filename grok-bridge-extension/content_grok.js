// ── Grok Bridge — grok.com Content Script ───────────────────────────────────
// 셀렉터 출처: Grok Automation v2.3.9 remote config (configs.kylenguyen.me)
(function () {
  'use strict';

  // ── 실제 검증된 셀렉터 ──────────────────────────────────────────────────
  const SEL = {
    imagineLink:      `a[href="/imagine"]`,
    promptEditable:   `form div[contenteditable='true']`,   // :eq(0) → first()
    promptDropArea:   `div[data-testid='drop-ui'] textarea`, // drop-ui 모드
    submitBtn:        `button.rounded-full:has(path[d="M6 11L12 5M12 5L18 11M12 5V19"])`,
    fileInput:        `input[type="file"]`,
    videoModeBtn:     `button:has(path[d^="M12 4C14.4853 4 16.5 6.01472"])`,
    imageModeBtn:     `button:has(path[d^="M14.0996 2.5"])`,
    modeSelectTrigger:`#model-select-trigger, button[aria-expanded]:has(svg.transition-transform)`,
    mainArticle:      `div[id^="imagine-masonry-section-"], main article`,
    downloadBtn:      `button:has(path[d^="M11.996 3v12m0 0-5-5m5 5"])`,
    imageUploading:   `span.animate-pulse, div.animate-spin`,
    percentageDiv:    `button div`,
    generateVideoBtn: `button[data-filmstrip-item="true"]:has(div.animate-spin)`,
  };

  // 비디오 URL 패턴 (confirmed)
  const VIDEO_SRC_REGEX = /generated\/([^/]+)\/generated_video(_hd)?\.mp4/;
  const VIDEO_SHARE_TPL = 'https://imagine-public.x.ai/imagine-public/share-videos/{uuid}.mp4';

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function log(...a)  { console.log('[GrokBridge]', ...a); }

  // ── 요소 찾기 (표준 CSS + :eq() 에뮬레이션) ──────────────────────────
  function qFirst(sel) {
    // :eq(n) 에뮬레이션
    const eqMatch = sel.match(/^(.*):eq\((\d+)\)(.*)$/);
    if (eqMatch) {
      const [, base, idx, rest] = eqMatch;
      const els = [...document.querySelectorAll(base + rest)];
      return els[parseInt(idx)] || null;
    }
    return document.querySelector(sel);
  }

  function qAll(sel) {
    const eqMatch = sel.match(/^(.*):eq\((\d+)\)(.*)$/);
    if (eqMatch) {
      const [, base, idx, rest] = eqMatch;
      return [document.querySelectorAll(base + rest)[parseInt(idx)]].filter(Boolean);
    }
    return [...document.querySelectorAll(sel)];
  }

  async function waitFor(sel, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const el = qFirst(sel);
      if (el && el.offsetParent !== null) return el;
      await sleep(300);
    }
    return qFirst(sel); // 마지막 시도 (비가시 허용)
  }

  // ── 1단계: /imagine 페이지로 이동 ────────────────────────────────────
  async function redirectToImagine() {
    if (location.href.includes('/imagine') && !location.href.includes('/imagine/')) {
      log('이미 /imagine 페이지');
      return true;
    }
    const link = await waitFor(SEL.imagineLink, 8000);
    if (link) {
      link.click();
      log('/imagine 링크 클릭');
      await sleep(2000);
      return true;
    }
    // fallback: 직접 이동
    location.href = 'https://grok.com/imagine';
    await sleep(3000);
    return location.href.includes('/imagine');
  }

  // ── 2단계: 모드 선택 (Video / Image) ─────────────────────────────────
  async function selectMode(mode) {
    // 모드 셀렉터 트리거 열기
    const trigger = await waitFor(SEL.modeSelectTrigger, 5000);
    if (trigger) {
      trigger.click();
      await sleep(800);
    }

    if (mode === 'text_to_video' || mode === 'frame_to_video') {
      const btn = await waitFor(SEL.videoModeBtn, 3000);
      if (btn) { btn.click(); log('Video 모드 선택'); await sleep(800); }
    } else {
      const btn = await waitFor(SEL.imageModeBtn, 3000);
      if (btn) { btn.click(); log('Image 모드 선택'); await sleep(800); }
    }
  }

  // ── 3단계: 이미지 업로드 ─────────────────────────────────────────────
  async function uploadImage(dataUrl) {
    const res  = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], `image_${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });

    const fileInput = await waitFor(SEL.fileInput, 5000);
    if (fileInput) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      log('파일 인풋 업로드 완료');
      // 업로드 완료 대기 (animate-pulse 사라질 때까지)
      for (let i = 0; i < 20; i++) {
        await sleep(500);
        if (!document.querySelector(SEL.imageUploading)) break;
      }
      await sleep(500);
      return true;
    }

    // 드래그앤드롭 fallback
    const dropZone = document.querySelector('[data-testid="drop-ui"], [data-testid="drop-container"]');
    if (dropZone) {
      const dt = new DataTransfer();
      dt.items.add(file);
      ['dragenter', 'dragover', 'drop'].forEach(t =>
        dropZone.dispatchEvent(new DragEvent(t, { bubbles: true, dataTransfer: dt }))
      );
      log('드래그앤드롭 업로드');
      await sleep(2000);
      return true;
    }

    log('⚠️ 업로드 방법 없음');
    return false;
  }

  // ── 4단계: 프롬프트 입력 ─────────────────────────────────────────────
  async function fillPrompt(text) {
    // drop-ui 모드 우선, 없으면 contenteditable
    let inputEl = qFirst(SEL.promptDropArea) || await waitFor(SEL.promptEditable, 8000);
    if (!inputEl) throw new Error('프롬프트 입력창을 찾지 못했습니다');

    inputEl.focus();
    await sleep(200);

    if (inputEl.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(inputEl, text); else inputEl.value = text;
      inputEl.dispatchEvent(new Event('input',  { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (inputEl.isContentEditable) {
      document.execCommand('selectAll', false);
      document.execCommand('delete',    false);
      document.execCommand('insertText', false, text);
      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }

    log(`프롬프트 입력 완료: "${text.slice(0, 50)}"`);
    await sleep(500);
    return inputEl;
  }

  // ── 5단계: 전송 ──────────────────────────────────────────────────────
  async function submit(inputEl) {
    const btn = await waitFor(SEL.submitBtn, 3000);
    if (btn) {
      btn.removeAttribute('disabled');
      btn.click();
      log('전송 버튼 클릭 (SVG rounded-full)');
      return;
    }
    // fallback: Enter 키
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    log('Enter 키 전송');
  }

  // ── 6단계: 결과 대기 ────────────────────────────────────────────────
  function waitForResult(timeoutMs = 4 * 60 * 1000) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      let lastArticle = document.querySelectorAll('main article, div[id^="imagine-masonry-section-"]').length;

      const check = () => {
        if (Date.now() > deadline) { obs.disconnect(); return reject(new Error('생성 시간 초과')); }

        // 비디오 URL 감지 (src 패턴으로)
        const videos = [...document.querySelectorAll('video[src]')].map(v => v.src).filter(s => VIDEO_SRC_REGEX.test(s));
        if (videos.length) { obs.disconnect(); return resolve({ url: videos[videos.length-1], mediaType: 'video' }); }

        // source 태그
        const sources = [...document.querySelectorAll('video source[src]')].map(s => s.src).filter(s => VIDEO_SRC_REGEX.test(s));
        if (sources.length) { obs.disconnect(); return resolve({ url: sources[sources.length-1], mediaType: 'video' }); }

        // 새 article (이미지)
        const arts = document.querySelectorAll('main article, div[id^="imagine-masonry-section-"]').length;
        if (arts > lastArticle) {
          lastArticle = arts;
          const imgs = [...document.querySelectorAll('main article img[src], div[id^="imagine-masonry-section-"] img[src]')]
            .map(i => i.src).filter(s => s.length > 60 && !s.includes('icon'));
          if (imgs.length) { obs.disconnect(); return resolve({ url: imgs[imgs.length-1], mediaType: 'image' }); }
        }

        // 생성 % 완료 감지
        const pctEl = document.querySelector(SEL.percentageDiv);
        if (pctEl?.textContent?.includes('100%')) {
          // 비디오 완료
          setTimeout(() => {
            const v = [...document.querySelectorAll('video source[src], video[src]')]
              .map(el => el.src).filter(s => s.length > 30)[0];
            obs.disconnect();
            resolve({ url: v || '', mediaType: 'video' });
          }, 2000);
        }
      };

      const obs = new MutationObserver(check);
      obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      const timer = setInterval(() => {
        check();
        if (Date.now() > deadline) clearInterval(timer);
      }, 2000);
    });
  }

  // ── 메인 생성 플로우 ─────────────────────────────────────────────────
  async function doGenerate(job) {
    const { jobId, mode, prompt, imageDataUrl } = job;
    log(`[${jobId}] 시작 — mode=${mode}, prompt="${prompt.slice(0, 50)}"`);

    try {
      // 1. /imagine 페이지로 이동
      const redirected = await redirectToImagine();
      if (!redirected) throw new Error('/imagine 페이지로 이동 실패');
      await sleep(1500);

      // 2. 모드 선택
      await selectMode(mode);

      // 3. 이미지 업로드 (frame_to_video / image_to_image)
      if (imageDataUrl && ['frame_to_video', 'image_to_image'].includes(mode)) {
        await uploadImage(imageDataUrl);
      }

      // 4. 프롬프트 입력
      const inputEl = await fillPrompt(prompt);

      // 5. 현재 상태 스냅샷
      const beforeArts = document.querySelectorAll('main article, div[id^="imagine-masonry-section-"]').length;

      // 6. 전송
      await submit(inputEl);
      log('전송 완료. 결과 대기 중...');

      // 7. 결과 대기
      await sleep(3000);
      const result = await waitForResult();

      log(`✅ 완료: ${result.mediaType} — ${result.url.slice(0, 80)}`);
      return { jobId, url: result.url, mediaType: result.mediaType };

    } catch (e) {
      log('❌ 오류:', e.message);
      return { jobId, error: e.message };
    }
  }

  // ── DOM 스냅샷 (팝업 검사용) ─────────────────────────────────────────
  function snapshotDOM() {
    return {
      url: location.href,
      isImaginePage: location.href.includes('/imagine'),
      inputs: [...document.querySelectorAll('textarea, input[type=text], div[contenteditable=true]')].map(el => ({
        tag: el.tagName,
        id: el.id || '',
        placeholder: (el.getAttribute('placeholder') || '').slice(0, 60),
        ariaLabel: (el.getAttribute('aria-label') || '').slice(0, 60),
        dataTestId: el.getAttribute('data-testid') || '',
        visible: el.offsetParent !== null,
        className: (el.className?.toString() || '').slice(0, 80),
      })),
      buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).slice(0, 20).map(b => ({
        text: b.textContent.trim().slice(0, 50),
        ariaLabel: (b.getAttribute('aria-label') || '').slice(0, 50),
        dataTestId: b.getAttribute('data-testid') || '',
        disabled: b.disabled,
      })),
      videos: [...document.querySelectorAll('video')].map(v => v.src || v.currentSrc).filter(Boolean),
      confirmedSelectors: {
        imagineLink:    !!document.querySelector(`a[href="/imagine"]`),
        promptEditable: !!document.querySelector(`form div[contenteditable='true']`),
        submitBtn:      !!document.querySelector(`button.rounded-full`),
        fileInput:      !!document.querySelector(`input[type="file"]`),
      },
      ts: Date.now(),
    };
  }

  // ── 메시지 수신 ──────────────────────────────────────────────────────
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
        el.style.outline = ''; delete el.dataset.grokHi;
      });
      try {
        const el = qFirst(msg.selector);
        if (el) {
          el.style.outline = '3px solid #22c55e';
          el.dataset.grokHi = '1';
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          sendResponse({ found: true, tag: el.tagName });
        } else { sendResponse({ found: false }); }
      } catch (e) { sendResponse({ found: false, error: e.message }); }
      return true;
    }
  });

  log('✅ content_grok.js 로드됨 @', location.href);
  log('검증된 셀렉터: imagineLink, promptContentEditable, submitBtn(SVG), fileInput');
})();

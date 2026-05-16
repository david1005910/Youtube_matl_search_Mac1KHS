// ── Grok Bridge — grok.com Content Script ───────────────────────────────────
// 역할: grok.com DOM 자동화 (프롬프트 입력 → 생성 → 결과 URL 캡처)

(function () {
  'use strict';

  // ── DOM 셀렉터 전략 (grok.com UI가 바뀌면 여기만 수정) ─────────────────
  const SEL = {
    // 메인 텍스트 입력
    input: [
      'textarea[placeholder]',
      'div[contenteditable="true"][data-lexical-editor]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    // 전송 버튼
    submit: [
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
      'button[aria-label*="Submit"]',
      'button[type="submit"]',
      'button[data-testid*="send"]',
      'button svg[data-icon="arrow-up"]',  // 화살표 아이콘 버튼
    ],
    // 생성된 비디오
    video: [
      'video[src]',
      'video source[src]',
      '[data-testid*="video"] video',
    ],
    // 생성된 이미지
    image: [
      'img[src*="blob:"]',
      'img[src*="grok"]',
      '[data-testid*="image-result"] img',
      '.generated-image img',
    ],
    // 로딩/생성중 표시
    loading: [
      '[data-testid*="loading"]',
      '.loading-indicator',
      'div[aria-label*="loading"]',
      'button[aria-label*="Stop"]',
      'button[aria-label*="stop"]',
    ],
  };

  // ── 유틸 ────────────────────────────────────────────────────────────────
  function $(selectors) {
    if (typeof selectors === 'string') return document.querySelector(selectors);
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function $$(selectors) {
    if (typeof selectors === 'string') return [...document.querySelectorAll(selectors)];
    for (const s of selectors) {
      const els = [...document.querySelectorAll(s)];
      if (els.length) return els;
    }
    return [];
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function log(...args) { console.log('[GrokBridge]', ...args); }

  // React input에 값 주입 (합성이벤트 우회)
  function setInputValue(el, value) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const setter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input',  { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    } else if (el.contentEditable === 'true') {
      // Lexical / contenteditable
      el.textContent = '';
      el.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, value);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
    }
  }

  // 버튼 클릭 (disabled 무시)
  function clickEl(el) {
    if (!el) return false;
    el.removeAttribute('disabled');
    el.click();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }

  // 결과 비디오/이미지 URL 추출
  function extractResults() {
    const videos = $$('video').map(v => v.src || v.querySelector('source')?.src).filter(Boolean);
    const images = $$('img').map(i => i.src).filter(src =>
      src && !src.includes('icon') && !src.includes('avatar') &&
      !src.includes('logo') && src.length > 50
    );
    return { videos, images };
  }

  // ── 이미지 업로드 (Frame to Video / Image to Image) ─────────────────────
  async function uploadImage(dataUrl) {
    // base64 → Blob
    const res  = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], 'card.jpg', { type: blob.type || 'image/jpeg' });

    // 파일 인풋 찾기
    const fileInput = document.querySelector('input[type="file"][accept*="image"]')
                   || document.querySelector('input[type="file"]');
    if (fileInput) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      log('이미지 파일 인풋으로 업로드');
      await sleep(1500);
      return true;
    }

    // 드래그 앤 드롭 fallback
    const dropZone = document.querySelector('[data-testid*="upload"]')
                  || document.querySelector('[class*="upload"]')
                  || document.querySelector('[class*="drop"]');
    if (dropZone) {
      const dt = new DataTransfer();
      dt.items.add(file);
      dropZone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
      dropZone.dispatchEvent(new DragEvent('dragover',  { bubbles: true, dataTransfer: dt }));
      dropZone.dispatchEvent(new DragEvent('drop',      { bubbles: true, dataTransfer: dt }));
      log('드래그앤드롭으로 이미지 업로드');
      await sleep(1500);
      return true;
    }

    log('⚠️ 이미지 업로드 영역을 찾지 못했습니다');
    return false;
  }

  // ── 생성 완료 감지 (MutationObserver + polling) ───────────────────────────
  function waitForResult(timeoutMs = 4 * 60 * 1000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let lastVideoCount = $$('video').length;
      let lastImgCount   = $$('img').length;

      const timer = setInterval(() => {
        if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          observer.disconnect();
          reject(new Error('생성 시간 초과'));
          return;
        }
        const { videos, images } = extractResults();
        const newVideo = videos.length > lastVideoCount;
        const newImage = images.length > lastImgCount;

        if (newVideo || newImage) {
          clearInterval(timer);
          observer.disconnect();
          resolve({ videos, images });
        }
      }, 1500);

      // MutationObserver로 빠른 감지
      const observer = new MutationObserver(() => {
        const { videos, images } = extractResults();
        if (videos.length > lastVideoCount || images.length > lastImgCount) {
          clearInterval(timer);
          observer.disconnect();
          resolve({ videos, images });
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    });
  }

  // ── 메인 생성 로직 ────────────────────────────────────────────────────────
  async function doGenerate(job) {
    const { jobId, mode, prompt, imageDataUrl } = job;
    log('작업 시작', { jobId, mode, prompt: prompt.slice(0, 50) });

    try {
      // 1. 입력창 찾기 (최대 10초 대기)
      let inputEl = null;
      for (let i = 0; i < 20; i++) {
        inputEl = $(SEL.input);
        if (inputEl) break;
        await sleep(500);
      }
      if (!inputEl) throw new Error('grok.com 입력창을 찾지 못했습니다. 페이지를 확인해주세요.');

      // 2. 이미지 업로드 (Frame to Video / Image to Image)
      if (imageDataUrl && (mode === 'frame_to_video' || mode === 'image_to_image')) {
        await uploadImage(imageDataUrl);
      }

      // 3. 프롬프트 입력 (짧게 끊어서 자연스럽게)
      setInputValue(inputEl, '');
      await sleep(300);
      setInputValue(inputEl, prompt);
      await sleep(500);

      // 4. 전송 버튼 클릭
      const submitBtn = $(SEL.submit)
                     || inputEl.closest('form')?.querySelector('button[type="submit"]')
                     || inputEl.parentElement?.querySelector('button');
      if (!submitBtn) throw new Error('전송 버튼을 찾지 못했습니다.');
      clickEl(submitBtn);
      log('전송 완료, 결과 대기 중...');

      // 5. 결과 대기
      const before = { v: $$('video').length, i: $$('img').length };
      await sleep(2000); // 로딩 시작 대기

      const result = await waitForResult();

      const url = result.videos[result.videos.length - 1]
               || result.images[result.images.length - 1]
               || '';

      const mediaType = result.videos.length > before.v ? 'video' : 'image';
      log('생성 완료', { url: url.slice(0, 80), mediaType });

      return { jobId, url, mediaType };

    } catch (e) {
      log('오류', e.message);
      return { jobId, error: e.message };
    }
  }

  // ── background 메시지 수신 ───────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'DO_GENERATE') return;

    doGenerate(msg).then(result => {
      chrome.runtime.sendMessage({ type: 'GENERATE_RESULT', ...result });
      sendResponse({ ok: true });
    });

    return true; // async
  });

  log('content_grok.js loaded on', location.href);
})();

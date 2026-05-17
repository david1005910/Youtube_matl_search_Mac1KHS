// ── Flow Bridge — labs.google Content Script ────────────────────────────────
// 셀렉터 출처: VEO Automation remote config (configs.kylenguyen.me/config/flow-automation)
(function () {
  'use strict';

  // ── 검증된 셀렉터 (remote config v2.9.4) ────────────────────────────────
  const SEL = {
    createProjectButton:  `button:has(i:text("add_2")):first`,
    promptTextarea:       `div[role="textbox"]`,
    submitButton:         `button:has(i:text("arrow_forward"))`,
    configVideoButton:    `button[color="BLURPLE"][aria-haspopup="dialog"]`,
    configImageButton:    `button:has(i:text("tune"))`,
    selectVideoMode:      `div[data-state="open"] div[role="tablist"]:eq(0) button:eq(1)`,
    selectImageMode:      `div[data-state="open"] div[role="tablist"]:eq(0) button:eq(0)`,
    textToVideoMode:      `div[data-state="open"] div[role="tablist"]:eq(1) button:eq(1)`,
    imageToVideoMode:     `div[data-state="open"] div[role="tablist"]:eq(1) button:eq(0)`,
    fileInput:            `input[type="file"]`,
    addImageButton:       `div[aria-haspopup="dialog"][data-state="closed"], button:has(i:text("add_2"))`,
    outputItems:          `div[data-tile-id]:has(div)`,
    downloadButton:       `button[aria-haspopup="menu"]:has(i:text("download"))`,
    downloadDoneButton:   `button:has(i:text("check"))`,
    quality1080Option:    `button:has(span:text("1080p"))`,
  };

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function log(...a)  { console.log('[FlowBridge]', ...a); }
  function warn(...a) { console.warn('[FlowBridge]', ...a); }

  // ── 셀렉터 엔진 (:eq/:first/:last + i:text 에뮬레이션) ──────────────────
  function resolveSelector(sel) {
    // :first → :eq(0)
    sel = sel.replace(/:first\b/g, ':eq(0)').replace(/:last\b/g, ':eq(-1)');
    return sel;
  }

  function textMatcher(el, text) {
    const t = el.textContent?.trim() || '';
    return t === text || t.includes(text);
  }

  // i:text("…") 또는 span:text("…") 를 처리하는 커스텀 파서
  function qCustom(sel) {
    // i:text("X") 패턴
    const iTextMatch = sel.match(/^(.*?)i:text\("([^"]+)"\)(.*?)$/);
    if (iTextMatch) {
      const [, pre, txt, post] = iTextMatch;
      const baseEls = pre ? [...document.querySelectorAll(pre.replace(/:has\($/, '').trim())] : [...document.querySelectorAll('i')];
      const matchingIs = baseEls.filter ? baseEls.filter(el => el.tagName === 'I' && textMatcher(el, txt))
        : [...document.querySelectorAll('i')].filter(el => textMatcher(el, txt));

      if (pre.includes(':has(')) {
        // button:has(i:text("X")) → find buttons containing matching i
        const parentSel = pre.replace(/:has\($/, '').trim();
        const parents = parentSel ? [...document.querySelectorAll(parentSel)] : [...document.querySelectorAll('*')];
        return parents.filter(p => [...p.querySelectorAll('i')].some(i => textMatcher(i, txt)));
      }
      return matchingIs;
    }

    // span:text("X") 패턴
    const spanTextMatch = sel.match(/^(.*?)span:text\("([^"]+)"\)(.*?)$/);
    if (spanTextMatch) {
      const [, pre, txt] = spanTextMatch;
      const parentSel = pre.replace(/:has\($/, '').trim();
      const parents = parentSel ? [...document.querySelectorAll(parentSel)] : [...document.querySelectorAll('*')];
      return parents.filter(p => [...p.querySelectorAll('span')].some(s => textMatcher(s, txt)));
    }

    return null;
  }

  function qFirst(sel) {
    sel = resolveSelector(sel);

    // 커스텀 :text 처리
    const custom = qCustom(sel);
    if (custom !== null) {
      const eqMatch = sel.match(/:eq\((-?\d+)\)/);
      if (eqMatch) {
        const n = parseInt(eqMatch[1]);
        return n < 0 ? custom[custom.length + n] || null : custom[n] || null;
      }
      return custom[0] || null;
    }

    // :eq(n) 에뮬레이션
    const eqMatch = sel.match(/^(.*):eq\((-?\d+)\)(.*)$/);
    if (eqMatch) {
      const [, base, idx, rest] = eqMatch;
      const els = [...document.querySelectorAll(base + (rest || ''))];
      const n = parseInt(idx);
      return (n < 0 ? els[els.length + n] : els[n]) || null;
    }

    try { return document.querySelector(sel); } catch { return null; }
  }

  function qAll(sel) {
    sel = resolveSelector(sel);
    const custom = qCustom(sel);
    if (custom !== null) return custom;
    const eqMatch = sel.match(/^(.*):eq\((-?\d+)\)(.*)$/);
    if (eqMatch) {
      const [, base, idx, rest] = eqMatch;
      const els = [...document.querySelectorAll(base + (rest || ''))];
      const n = parseInt(idx);
      const el = n < 0 ? els[els.length + n] : els[n];
      return el ? [el] : [];
    }
    try { return [...document.querySelectorAll(sel)]; } catch { return []; }
  }

  async function waitFor(sel, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const el = qFirst(sel);
      if (el && el.offsetParent !== null) return el;
      await sleep(400);
    }
    return qFirst(sel);
  }

  // ── React controlled input 값 설정 ───────────────────────────────────────
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── contenteditable 텍스트 입력 ──────────────────────────────────────────
  function fillContentEditable(el, text) {
    el.focus();
    // 기존 내용 지우기
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    // 텍스트 입력
    document.execCommand('insertText', false, text);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  // ── 편집 페이지 여부 판단 ────────────────────────────────────────────────
  function isEditorPage() {
    // 편집 페이지: /flow/editor/ 또는 프롬프트 박스가 DOM에 있음
    return location.href.includes('/flow/editor') ||
           location.href.includes('/flow/project') ||
           !!document.querySelector('div[role="textbox"]') ||
           !!document.querySelector('button[color="BLURPLE"]');
  }

  // ── 1단계: Flow 메인 페이지 이동 ────────────────────────────────────────
  async function ensureFlowPage() {
    const url = location.href;
    // /fx/tools/flow 또는 /fx/ko/tools/flow 등 언어 변형 포함
    if (url.includes('/tools/flow')) {
      log('이미 Flow 페이지:', url);
      return true;
    }
    location.href = 'https://labs.google/fx/tools/flow';
    await sleep(4000);
    return location.href.includes('flow');
  }

  // ── 2단계: 새 프로젝트 버튼 찾기 ────────────────────────────────────────
  async function createProject() {
    // 이미 편집 화면이면 스킵
    if (isEditorPage()) {
      log('이미 편집 페이지 — 새 프로젝트 생성 스킵');
      return true;
    }

    // 방법 1: Material Icon "add_2" 버튼
    let btn = qFirst(SEL.createProjectButton);

    // 방법 2: 텍스트 "새 프로젝트" / "New project" / "Create"
    if (!btn) {
      btn = [...document.querySelectorAll('button')].find(b => {
        const t = b.textContent.trim();
        return t.includes('새 프로젝트') || t.includes('New project') ||
               t.includes('Create') || t.includes('새로 만들기');
      }) || null;
    }

    // 방법 3: add / add_circle 계열 아이콘
    if (!btn) {
      btn = [...document.querySelectorAll('button')].find(b =>
        [...b.querySelectorAll('i')].some(i => {
          const t = i.textContent.trim();
          return t === 'add' || t === 'add_2' || t === 'add_circle' || t.startsWith('add');
        })
      ) || null;
    }

    if (btn) {
      btn.click();
      log('새 프로젝트 버튼 클릭');
      await sleep(3000);
      return true;
    }

    // 방법 4: div/role=button 포함 모든 클릭 가능 요소
    if (!btn) {
      const clickables = [...document.querySelectorAll('button, [role="button"], a')];
      btn = clickables.find(el => {
        const t = el.textContent.trim();
        return t.includes('새 프로젝트') || t.includes('New project') || t === '+';
      }) || null;
    }

    if (btn) {
      btn.click();
      log('새 프로젝트 클릭: ' + btn.tagName + ' "' + btn.textContent.trim().slice(0,20) + '"');
      await sleep(3000);
      return true;
    }

    // 마지막 수단: 첫 번째 기존 프로젝트 카드 클릭
    const projectCard = document.querySelector('a[href*="/flow/project/"]');
    if (projectCard) {
      projectCard.click();
      log('기존 프로젝트 카드 클릭');
      await sleep(3000);
      return true;
    }

    log('⚠️ 프로젝트 진입 불가 — 편집 페이지 대기 중');
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      if (isEditorPage()) { log('편집 페이지 진입 감지'); return true; }
    }
    return false;
  }

  // ── 3단계: 모드 선택 (video / image) ────────────────────────────────────
  async function selectMode(mode) {
    // config 버튼 클릭 (비디오 또는 이미지 모드 설정 패널)
    const cfgBtn = await waitFor(mode === 'image' ? SEL.configImageButton : SEL.configVideoButton, 5000);
    if (cfgBtn) {
      cfgBtn.click();
      await sleep(800);
      log(`모드 설정 패널 열기: ${mode}`);
    }

    if (mode === 'video' || mode === 'text_to_video') {
      const vtBtn = qFirst(SEL.selectVideoMode);
      if (vtBtn) { vtBtn.click(); log('Video 모드 선택'); await sleep(600); }
      const t2v = qFirst(SEL.textToVideoMode);
      if (t2v) { t2v.click(); log('Text-to-Video 선택'); await sleep(600); }
    } else if (mode === 'image_to_video') {
      const vtBtn = qFirst(SEL.selectVideoMode);
      if (vtBtn) { vtBtn.click(); await sleep(600); }
      const i2v = qFirst(SEL.imageToVideoMode);
      if (i2v) { i2v.click(); log('Image-to-Video 선택'); await sleep(600); }
    }
  }

  // ── 4단계: 이미지 업로드 (image_to_video) ───────────────────────────────
  async function uploadImage(dataUrl) {
    const res  = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], `frame_${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });

    const addBtn = qFirst(SEL.addImageButton);
    if (addBtn) { addBtn.click(); await sleep(800); }

    const fileInput = await waitFor(SEL.fileInput, 5000);
    if (fileInput) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      log('이미지 업로드 완료');
      await sleep(2000);
      return true;
    }
    warn('파일 인풋 없음');
    return false;
  }

  // ── 5단계: 프롬프트 입력 ────────────────────────────────────────────────
  async function fillPrompt(text) {
    const el = await waitFor(SEL.promptTextarea, 10000);
    if (!el) throw new Error('프롬프트 입력창을 찾지 못했습니다 (div[role="textbox"])');

    if (el.isContentEditable) {
      fillContentEditable(el, text);
    } else if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      setNativeValue(el, text);
    } else {
      el.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
    }

    log(`프롬프트 입력: "${text.slice(0, 60)}"`);
    await sleep(500);
    return el;
  }

  // ── 6단계: 전송 ─────────────────────────────────────────────────────────
  async function submit() {
    const btn = await waitFor(SEL.submitButton, 5000);
    if (btn) {
      btn.removeAttribute('disabled');
      btn.click();
      log('전송 버튼 클릭 (arrow_forward)');
      return;
    }
    throw new Error('전송 버튼을 찾지 못했습니다');
  }

  // ── 진행상황 로그 전송 ──────────────────────────────────────────────────
  function sendProgress(msg) {
    log(msg);
    chrome.runtime.sendMessage({ type: 'GENERATE_PROGRESS', message: msg }).catch(() => {});
  }

  // ── 7단계: 결과 대기 (Google Flow 특화) ────────────────────────────────
  function waitForResult(timeoutMs = 5 * 60 * 1000) {
    return new Promise((resolve, reject) => {
      const deadline  = Date.now() + timeoutMs;
      let lastTileCount = document.querySelectorAll('[data-tile-id]').length;
      let resolved    = false;
      let tickCount   = 0;

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
        if (tickCount % 5 === 0) sendProgress(`⏳ 생성 중... (${Math.round((Date.now()-(deadline-timeoutMs))/1000)}초 경과)`);

        // ① 완성된 타일 내 video 태그 (src 있음)
        const tileVideos = [...document.querySelectorAll('[data-tile-id] video')];
        for (const v of tileVideos) {
          const src = v.src || v.currentSrc || '';
          if (src && src.length > 10) { sendProgress('✅ 비디오 타일 감지'); return done({ url: src, mediaType: 'video' }); }
          // source 태그
          const src2 = v.querySelector('source')?.src || '';
          if (src2) { sendProgress('✅ 비디오 source 감지'); return done({ url: src2, mediaType: 'video' }); }
        }

        // ② 페이지 전체 video (blob 포함)
        const allVideos = [...document.querySelectorAll('video')];
        for (const v of allVideos) {
          const src = v.src || v.currentSrc || '';
          if (src && src.length > 10 && !src.endsWith('#')) {
            sendProgress('✅ 비디오 감지: ' + src.slice(0, 60));
            return done({ url: src, mediaType: 'video' });
          }
        }

        // ③ 새 타일 등장 (이미지/영상 완료 시 타일 수 증가)
        const tiles = document.querySelectorAll('[data-tile-id]').length;
        if (tiles > lastTileCount) {
          lastTileCount = tiles;
          sendProgress(`🔲 새 타일 감지 (${tiles}개)`);
          // 타일 안 img
          const tileImgs = [...document.querySelectorAll('[data-tile-id] img[src]')]
            .map(i => i.src).filter(s => s.length > 30 && !s.includes('icon') && !s.includes('svg'));
          if (tileImgs.length) { sendProgress('✅ 이미지 타일 감지'); return done({ url: tileImgs[tileImgs.length - 1], mediaType: 'image' }); }
        }

        // ④ 로딩 스피너 없어짐 감지 (생성 완료 신호)
        const hasSpinner = !!document.querySelector('[data-tile-id] [role="progressbar"], [data-tile-id] .animate-spin');
        if (!hasSpinner && lastTileCount > 0) {
          const anyVideo = document.querySelector('[data-tile-id] video, [data-tile-id] img[src]');
          if (anyVideo) {
            const src = anyVideo.tagName === 'VIDEO'
              ? (anyVideo.src || anyVideo.currentSrc || '')
              : anyVideo.src || '';
            if (src) { sendProgress('✅ 스피너 종료 후 미디어 감지'); return done({ url: src, mediaType: anyVideo.tagName === 'VIDEO' ? 'video' : 'image' }); }
          }
        }
      };

      const obs = new MutationObserver(check);
      obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-tile-id', 'data-state'] });
      const timer = setInterval(check, 2000);
      check(); // 즉시 1회 실행
    });
  }

  // ── 메인 생성 플로우 ─────────────────────────────────────────────────────
  async function doGenerate(job) {
    const { jobId, mode, prompt, imageDataUrl } = job;
    log(`[${jobId}] 시작 — mode=${mode}, prompt="${prompt.slice(0, 50)}"`);

    try {
      await ensureFlowPage();
      await sleep(1500);

      await createProject();

      await selectMode(mode || 'text_to_video');

      if (imageDataUrl && mode === 'image_to_video') {
        await uploadImage(imageDataUrl);
      }

      await fillPrompt(prompt);
      await submit();
      log('전송 완료. 결과 대기...');

      await sleep(3000);
      const result = await waitForResult();
      log(`✅ 완료: ${result.mediaType} — ${result.url.slice(0, 80)}`);
      return { jobId, url: result.url, mediaType: result.mediaType };

    } catch (e) {
      warn('❌ 오류:', e.message);
      return { jobId, error: e.message };
    }
  }

  // ── DOM 스냅샷 ───────────────────────────────────────────────────────────
  function snapshotDOM() {
    // Material Icons i 태그 수집
    const allIcons = [...document.querySelectorAll('i')].map(i => i.textContent.trim()).filter(Boolean);
    const uniqueIcons = [...new Set(allIcons)].slice(0, 30);

    return {
      url: location.href,
      isFlowPage: location.href.includes('flow'),
      isEditorPage: isEditorPage(),
      inputs: [...document.querySelectorAll('textarea, input[type=text], div[role=textbox], [contenteditable=true]')].map(el => ({
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        placeholder: (el.getAttribute('placeholder') || '').slice(0, 60),
        ariaLabel: (el.getAttribute('aria-label') || '').slice(0, 60),
        dataTestId: el.getAttribute('data-testid') || '',
        visible: el.offsetParent !== null,
      })),
      buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).slice(0, 20).map(b => ({
        text: b.textContent.trim().slice(0, 50),
        ariaLabel: (b.getAttribute('aria-label') || '').slice(0, 50),
        color: b.getAttribute('color') || '',
        ariaHaspopup: b.getAttribute('aria-haspopup') || '',
        icons: [...b.querySelectorAll('i')].map(i => i.textContent.trim()).filter(Boolean),
      })),
      tiles: [...document.querySelectorAll('[data-tile-id]')].length,
      videos: [...document.querySelectorAll('video')].map(v => v.src || v.currentSrc).filter(Boolean),
      materialIcons: uniqueIcons,
      confirmedSelectors: {
        promptTextarea:      !!qFirst(SEL.promptTextarea),
        submitButton:        !!qFirst(SEL.submitButton),
        createProjectButton: !!qFirst(SEL.createProjectButton),
        outputItems:         document.querySelectorAll('[data-tile-id]').length,
      },
      ts: Date.now(),
    };
  }

  // ── 메시지 수신 ──────────────────────────────────────────────────────────
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
  });

  log('✅ content_flow.js 로드됨 @', location.href);
})();

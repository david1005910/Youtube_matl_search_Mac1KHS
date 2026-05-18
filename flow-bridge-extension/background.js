'use strict';
// ── Flow Bridge v1.3 — Background ────────────────────────────────────────────
// chrome.scripting.executeScript(world:'MAIN')으로 Flow Factory page-bridge와
// 동일한 방식으로 React Fiber 직접 접근
let flowTabId = null;
let appTabId  = null;

// ── 탭 감지 ──────────────────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const url = tab.url || '';
  if (url.includes('labs.google'))  flowTabId = tabId;
  else if (url.includes('localhost')) appTabId = tabId;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === flowTabId) flowTabId = null;
  if (tabId === appTabId)  appTabId  = null;
});
(async () => {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if ((t.url||'').includes('labs.google'))  flowTabId = t.id;
    if ((t.url||'').includes('localhost'))     appTabId  = t.id;
  }
})();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function popupLog(msg) { chrome.runtime.sendMessage({ type:'POPUP_LOG', message: msg }).catch(()=>{}); }

// ── Flow 탭 확보 ──────────────────────────────────────────────────────────────
async function ensureFlowTab() {
  if (flowTabId) {
    try { await chrome.tabs.get(flowTabId); await chrome.tabs.update(flowTabId,{active:true}); return flowTabId; }
    catch { flowTabId = null; }
  }
  const tab = await chrome.tabs.create({ url:'https://labs.google/fx/tools/flow', active:true });
  flowTabId = tab.id;
  await sleep(5000);
  return flowTabId;
}

// ── URL 대기 ─────────────────────────────────────────────────────────────────
function waitForTabUrl(tabId, pred, ms=20000) {
  return new Promise(res => {
    const dl = Date.now()+ms;
    const t = setInterval(async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (pred(tab.url||'')) { clearInterval(t); res(true); }
        if (Date.now()>dl)     { clearInterval(t); res(false); }
      } catch { clearInterval(t); res(false); }
    }, 500);
  });
}

// ── 텍스트박스 대기 (executeScript polling) ───────────────────────────────────
async function waitForTextbox(tabId, ms=15000) {
  const dl = Date.now()+ms;
  while (Date.now()<dl) {
    try {
      const r = await chrome.scripting.executeScript({
        target:{tabId},
        func: () => !!(document.querySelector('div[role="textbox"]') ||
                       document.querySelector('[contenteditable="true"][data-slate-editor="true"]'))
      });
      if (r?.[0]?.result) return true;
    } catch {}
    await sleep(600);
  }
  return false;
}

// ── 에디터로 이동 ─────────────────────────────────────────────────────────────
async function navigateToEditor(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url||'';

  // 이미 에디터 URL
  if (url.includes('/flow/project/')||url.includes('/flow/editor')) {
    if (await waitForTextbox(tabId, 5000)) { popupLog('✅ 에디터 확인'); return true; }
  }

  // Flow 홈이 아니면 이동
  if (!url.includes('labs.google')) {
    await chrome.tabs.update(tabId,{url:'https://labs.google/fx/tools/flow'});
    await waitForTabUrl(tabId, u=>u.includes('/tools/flow'), 10000);
    await sleep(2000);
  }

  // 새 프로젝트 클릭
  popupLog('🔄 새 프로젝트 생성 중...');
  await chrome.scripting.executeScript({
    target:{tabId},
    func: () => {
      const btn = [...document.querySelectorAll('button,[role="button"],a')].find(el=>{
        const t = el.textContent.trim();
        return t.includes('새 프로젝트')||t.includes('New project')||t.includes('Create project');
      }) || [...document.querySelectorAll('button')].find(b=>
        [...b.querySelectorAll('i')].some(i=>i.textContent.trim()==='add_2')
      );
      if (btn) { btn.click(); return true; }
      // 기존 프로젝트 진입
      const card = document.querySelector('a[href*="/flow/project/"]');
      if (card) { card.click(); return true; }
      return false;
    }
  });

  await waitForTabUrl(tabId, u=>u.includes('/flow/project/')||u.includes('/flow/editor'), 20000);
  const ok = await waitForTextbox(tabId, 12000);
  if (ok) popupLog('✅ 에디터 준비 완료');
  else    popupLog('⚠️ 에디터 textbox 미감지 — 계속 진행');
  return ok;
}

// ── 프롬프트 입력 (MAIN world — Flow Factory __flowFillPrompt) ────────────────
async function fillPrompt(tabId, text) {
  popupLog('✏️ 프롬프트 입력 중 (Flow Factory React Fiber)...');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world:  'MAIN',
    func: (txt) => {
      return new Promise((resolve) => {
        // Flow Factory page-bridge ping → 있으면 __flowFillPrompt 사용
        const onPong = (e) => {
          window.removeEventListener('__flowFillPromptDone', onPong);
          if (!e.detail?.ok) { resolve({ method:'none', ok:false }); return; }

          // 실제 fill
          const onFill = (ev) => {
            window.removeEventListener('__flowFillPromptDone', onFill);
            const box = document.querySelector('div[role="textbox"]') ||
                        document.querySelector('[contenteditable="true"]');
            resolve({ method:'flowFactory', ok: ev.detail?.ok===true, text: box?.textContent?.trim()||'' });
          };
          window.addEventListener('__flowFillPromptDone', onFill);
          window.dispatchEvent(new CustomEvent('__flowFillPrompt',{detail:{text:txt,replaceAll:true}}));
          setTimeout(()=>{ window.removeEventListener('__flowFillPromptDone',onFill); resolve({method:'flowFactory',ok:false,text:''}); }, 6000);
        };
        window.addEventListener('__flowFillPromptDone', onPong);
        window.dispatchEvent(new CustomEvent('__flowFillPrompt', {detail:{}})); // ping
        setTimeout(()=>{ window.removeEventListener('__flowFillPromptDone',onPong); resolve({method:'none',ok:false}); }, 3000);
      });
    },
    args: [text]
  });

  const r = results?.[0]?.result;
  if (r?.method === 'flowFactory' && r?.ok) {
    popupLog(`✅ Flow Factory 입력 완료: "${r.text?.slice(0,40)}"`);
    return true;
  }

  // 폴백: DOM 직접 입력
  popupLog('⚠️ Flow Factory 미응답 — DOM execCommand 폴백');
  await chrome.scripting.executeScript({
    target:{tabId},
    world:'MAIN',
    func:(txt) => {
      const el = document.querySelector('div[role="textbox"]') ||
                 document.querySelector('[contenteditable="true"]');
      if (!el) return false;
      el.focus();
      document.execCommand('selectAll', false);
      document.execCommand('delete', false);
      document.execCommand('insertText', false, txt);
      el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:txt}));
      return true;
    },
    args:[text]
  });
  return false;
}

// ── 전송 (MAIN world — React Fiber onClick 직접 호출) ────────────────────────
async function submitFlow(tabId) {
  popupLog('📤 생성 버튼 클릭 중 (React Fiber)...');
  await sleep(800); // React 상태 반영 대기

  const result = await chrome.scripting.executeScript({
    target:{tabId},
    world:'MAIN',
    func: () => {
      const btn = [...document.querySelectorAll('button')].find(b=>
        [...b.querySelectorAll('i')].some(i=>i.textContent.trim()==='arrow_forward')
      );
      if (!btn) return {ok:false, reason:'button not found'};

      // React Fiber에서 onClick 직접 호출 (Flow Factory page-bridge 동일 방식)
      const fk = Object.keys(btn).find(k=>k.startsWith('__reactFiber'));
      if (fk) {
        let fiber = btn[fk];
        while (fiber) {
          if (fiber.memoizedProps?.onClick) {
            try {
              fiber.memoizedProps.onClick({
                preventDefault:()=>{}, stopPropagation:()=>{},
                target:btn, currentTarget:btn, bubbles:true, type:'click'
              });
              return {ok:true, method:'reactFiber'};
            } catch(e) { return {ok:false, reason:e.message}; }
          }
          fiber = fiber.return;
        }
      }

      // 폴백: 일반 click + MouseEvent
      btn.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      btn.click();
      return {ok:true, method:'click'};
    }
  });

  const r = result?.[0]?.result;
  if (r?.ok) popupLog(`✅ 전송 완료 (${r.method})`);
  else       popupLog(`⚠️ 전송 오류: ${r?.reason}`);
  return r?.ok;
}

// ── 결과 감지기 주입 (isolated world — chrome.runtime 사용 가능) ──────────────
async function injectResultDetector(tabId, jobId) {
  await chrome.scripting.executeScript({
    target:{tabId},
    func: (jobId) => {
      if (window['__fbDetect_'+jobId]) return;
      window['__fbDetect_'+jobId] = true;
      const t0 = Date.now();
      const baseTiles = document.querySelectorAll('[data-tile-id]').length;

      const check = () => {
        // video
        for (const v of document.querySelectorAll('video,[data-tile-id] video')) {
          const src = v.src||v.currentSrc||'';
          if (src&&src.length>10&&!src.endsWith('#')) {
            clearInterval(timer);
            chrome.runtime.sendMessage({type:'GENERATE_RESULT',jobId,url:src,mediaType:'video'});
            return;
          }
        }
        // new tile
        const tiles = document.querySelectorAll('[data-tile-id]').length;
        if (tiles > baseTiles) {
          const imgs = [...document.querySelectorAll('[data-tile-id] img[src]')]
            .map(i=>i.src).filter(s=>s.length>30&&!s.includes('icon'));
          if (imgs.length) {
            clearInterval(timer);
            chrome.runtime.sendMessage({type:'GENERATE_RESULT',jobId,url:imgs[0],mediaType:'image'});
            return;
          }
        }
        // timeout
        if (Date.now()-t0 > 300000) {
          clearInterval(timer);
          chrome.runtime.sendMessage({type:'GENERATE_RESULT',jobId,error:'생성 시간 초과(5분)'});
        }
      };
      const timer = setInterval(check, 2000);
    },
    args:[jobId]
  });
}

// ── 메시지 핸들러 ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === 'GET_STATUS') {
    sendResponse({flowTabId, appTabId, pendingCount:0});
    return true;
  }

  if (msg.type === 'OPEN_FLOW') {
    ensureFlowTab().then(id=>sendResponse({tabId:id}));
    return true;
  }

  // ── 자동 생성 ─────────────────────────────────────────────────────────────
  if (msg.type === 'FLOW_GENERATE') {
    const {jobId, prompt, imageDataUrl, mode} = msg;
    popupLog(`🚀 생성 시작 [${jobId}]`);
    (async () => {
      try {
        const tabId = await ensureFlowTab();
        await navigateToEditor(tabId);
        await sleep(1500);
        await fillPrompt(tabId, prompt);
        await sleep(500);
        await submitFlow(tabId);
        popupLog('⏳ 생성 중 — 결과 감시 시작');
        await injectResultDetector(tabId, jobId);
        sendResponse({ok:true});
      } catch(e) {
        popupLog('❌ '+e.message);
        sendResponse({error:e.message});
      }
    })();
    return true;
  }

  // ── 채우기만 (수동 모드) ──────────────────────────────────────────────────
  if (msg.type === 'FILL_ONLY') {
    const {prompt} = msg;
    (async () => {
      try {
        const tabId = await ensureFlowTab();
        popupLog('🔄 에디터 확인 중...');
        await navigateToEditor(tabId);
        await sleep(1500);
        const ok = await fillPrompt(tabId, prompt);
        // 전송 버튼에 포커스
        await chrome.scripting.executeScript({
          target:{tabId},
          world:'MAIN',
          func:()=>{
            const btn = [...document.querySelectorAll('button')].find(b=>
              [...b.querySelectorAll('i')].some(i=>i.textContent.trim()==='arrow_forward')
            );
            if (btn) btn.focus();
          }
        });
        popupLog(ok ? '✅ 프롬프트 완료 — Flow에서 생성 버튼 클릭하세요' : '⚠️ DOM 폴백 입력 — Flow에서 확인 후 생성하세요');
        sendResponse({ok:true});
      } catch(e) {
        popupLog('❌ '+e.message);
        sendResponse({error:e.message});
      }
    })();
    return true;
  }

  if (msg.type === 'GENERATE_PROGRESS') {
    popupLog(msg.message);
    sendResponse({ok:true});
    return true;
  }

  if (msg.type === 'GENERATE_RESULT') {
    const {jobId,url,mediaType,error} = msg;
    if (appTabId) chrome.tabs.sendMessage(appTabId,{type:'FLOW_RESULT_PUSH',jobId,url,mediaType,error}).catch(()=>{});
    chrome.runtime.sendMessage({type:'POPUP_RESULT',jobId,url,mediaType,error}).catch(()=>{});
    sendResponse({ok:true});
    return true;
  }

  if (msg.type === 'INSPECT_DOM') {
    if (!flowTabId) { sendResponse({error:'Flow 탭 없음'}); return true; }
    chrome.tabs.sendMessage(flowTabId,{type:'INSPECT_DOM'})
      .then(r=>sendResponse(r)).catch(e=>sendResponse({error:e.message}));
    return true;
  }
});

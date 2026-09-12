
  // ─── JSON 안전 파서 (Gemini 응답 정제 - 배열 및 객체 지원) ────────────
  function safeParseJSON(raw) {
    if (!raw || typeof raw !== 'string') return null;
    // 1) ```json ... ``` 코드블록 추출
    const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    let src = (codeBlock ? codeBlock[1] : raw).trim();

    // 2) 직접 파싱 시도
    try { return JSON.parse(src); } catch (_) {}

    // 3) 시작과 끝 기호 ([ ... ] 또는 { ... }) 감지 및 추출
    const firstBrace = src.indexOf('{');
    const firstBracket = src.indexOf('[');
    const lastBrace = src.lastIndexOf('}');
    const lastBracket = src.lastIndexOf(']');

    let start = -1;
    let end = -1;
    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      start = firstBracket;
      end = lastBracket;
    } else if (firstBrace !== -1) {
      start = firstBrace;
      end = lastBrace;
    }

    if (start !== -1 && end !== -1 && end > start) {
      src = src.slice(start, end + 1);
    }
    try { return JSON.parse(src); } catch (_) {}

    // 4) 일반적인 Gemini JSON 오류 수정 (후행 콤마, 따옴표 없는 키 등)
    const fixed = src
      .replace(/,\s*([}\]])/g, '$1')              // 후행 콤마 제거
      .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')     // 따옴표 없는 키 수정
      .replace(/:\s*'([^']*)'/g, ': "$1"')        // 단따옴표 → 이중따옴표
      .replace(/[\x00-\x1f\x7f]/g, ' ');          // 제어문자 제거

    try { return JSON.parse(fixed); } catch (_) {}
    return null;
  }

  // ─── 상태 ───────────────────────────────────────
  let YOUTUBE_API_KEY    = '';
  let GEMINI_API_KEY     = '';
  let GEMINI_MODEL       = 'gemini-3.1-flash-lite';
  let TRANSCRIPT_API_KEY = '';
  let XAI_API_KEY        = '';
  let IMGBB_API_KEY      = '';
  let IMAGE_MODEL        = 'comfyui';  // 'comfyui' (기본 로컬 AI), 'pollinations' (무료), 'local-sd', 'imagen', 'stability'
  let SELECTED_IMAGE_STYLE = localStorage.getItem('yt_image_style') || 'none';
  let _globalSubtitleOverlay = (localStorage.getItem('yt_global_subtitle') !== 'false'); // 기본값: ON (true)
  window._globalSubtitleOverlay = _globalSubtitleOverlay;
  let _cachedAnalysis = null;   // 분석 결과 캐시
  let _cachedVideoTitle = '';
  let _flowBridgeReady = false;  // Flow Bridge Extension 상태

  // ─── 🎨 이미지 스타일 프리셋 (12종 + 기본) ─────────────────────
  const IMAGE_STYLE_PRESETS = {
    'none': {
      id: 'none',
      name: '기본 (원본)',
      icon: '🔘',
      promptSuffix: '',
      negativePrompt: ''
    },
    'cinematic': {
      id: 'cinematic',
      name: '실사 시네마틱',
      icon: '🎬',
      promptSuffix: 'photorealistic, highly detailed, 8k cinematic film still, shot on 35mm lens, depth of field, dramatic cinematic lighting, award-winning cinematography, photorealism',
      negativePrompt: 'cartoon, anime, 3d render, painting, drawing, illustration, low quality, flat lighting'
    },
    'anime': {
      id: 'anime',
      name: '애니메이션/웹툰',
      icon: '🎨',
      promptSuffix: 'anime style, modern webtoon aesthetic, vibrant colors, clean crisp lineart, Makoto Shinkai lighting, Studio Ghibli inspired, 2D illustration, beautiful detailed anime art',
      negativePrompt: 'photorealistic, real life photo, 3d render, noisy, messy lines'
    },
    'pixar3d': {
      id: 'pixar3d',
      name: '3D 픽사/디즈니',
      icon: '🧸',
      promptSuffix: '3D Disney Pixar animation style, cute character design, subsurface scattering, octane render, vivid color palette, soft rim lighting, Unreal Engine 5 render, cinematic 3D',
      negativePrompt: 'flat 2d, sketchy, realistic photograph, gritty, harsh lines, ugly'
    },
    'cyberpunk': {
      id: 'cyberpunk',
      name: '사이버펑크',
      icon: '🌆',
      promptSuffix: 'cyberpunk aesthetic, glowing neon lights, futuristic high-tech metropolis, magenta and cyan color palette, holographic reflections, moody atmospheric volumetric fog, 8k',
      negativePrompt: 'pastoral, natural daylight, historical, rustic, medieval, earthy'
    },
    'watercolor': {
      id: 'watercolor',
      name: '수채화아트',
      icon: '🖌️',
      promptSuffix: 'delicate watercolor painting, wet-on-wet technique, soft pigment bleeding, textured cold-press paper background, artistic brush strokes, pastel aesthetic, fine ink contours',
      negativePrompt: 'photorealistic, 3d render, harsh neon, sharp digital lines, plastic'
    },
    'retro_film': {
      id: 'retro_film',
      name: '90s 레트로 필름',
      icon: '📷',
      promptSuffix: '90s vintage film photography, 35mm kodachrome, nostalgic film grain, warm analog color tones, subtle light leaks, disposable camera aesthetic, authentic retro look',
      negativePrompt: 'modern digital photo, crisp 3d render, oversaturated modern digital, high-tech'
    },
    'pen_sketch': {
      id: 'pen_sketch',
      name: '펜&잉크 스케치',
      icon: '✒️',
      promptSuffix: 'hand-drawn pen and ink illustration, intricate cross-hatching, fine line art sketch, vintage engraving style, monochrome with subtle ink wash, high contrast artistic sketch',
      negativePrompt: 'full color photograph, 3d render, smooth gradient, blur, photo'
    },
    'fantasy': {
      id: 'fantasy',
      name: '판타지 컨셉아트',
      icon: '🧙‍♂️',
      promptSuffix: 'epic fantasy concept art, highly detailed digital painting, magical ambient glow, Artstation trending, grand mythic scale, ethereal fantasy atmosphere, dramatic lighting',
      negativePrompt: 'modern cityscape, photographic snapshot, low quality, flat, mundane'
    },
    'scifi_space': {
      id: 'scifi_space',
      name: '우주&SF',
      icon: '🚀',
      promptSuffix: 'epic sci-fi space aesthetic, deep cosmic nebula background, glowing interstellar starfield, futuristic high-tech architecture, breathtaking space vista, cinematic sci-fi lighting',
      negativePrompt: 'historical, rustic, earthy landscape, medieval, mundane'
    },
    'vector': {
      id: 'vector',
      name: '미니멀 벡터',
      icon: '📐',
      promptSuffix: 'minimalist vector illustration, clean geometric shapes, modern flat design, sleek graphic design style, bold solid colors, crisp vector contours, elegant simplicity',
      negativePrompt: 'complex photo texture, photographic realism, messy noise, 3d skin pore'
    },
    'clay': {
      id: 'clay',
      name: '점토아트',
      icon: '🏺',
      promptSuffix: 'claymation style, plasticine clay texture, handcrafted stop-motion sculpture aesthetic, subtle fingerprint marks on clay, Aardman inspired, soft studio miniature lighting',
      negativePrompt: 'flat 2d drawing, sleek metal, sharp digital render, realistic human photo'
    },
    'whiteboard': {
      id: 'whiteboard',
      name: '화이트보드 애니메이션',
      icon: '📋',
      promptSuffix: 'whiteboard animation doodle style, bold black marker illustration on clean white background, minimalist marker sketch, educational explainer video graphic style, crisp clean lines',
      negativePrompt: 'dark background, complex photographic gradient, 3d render, real photo'
    }
  };

  window.IMAGE_STYLE_PRESETS = IMAGE_STYLE_PRESETS;
  window.SELECTED_IMAGE_STYLE = SELECTED_IMAGE_STYLE;

  // ─── 🎨 스타일별 전문 프롬프트 작성 지침 가이드 ─────────────────────
  const STYLE_PROMPT_GUIDES = {
    'cinematic': {
      name: '실사 시네마틱',
      guide: 'Ultra-photorealistic cinematic film still, shot on 35mm Arri Alexa or RED camera, anamorphic lens, shallow depth of field, dramatic cinematic lighting, authentic textures, natural skin details, 8K resolution, award-winning cinematography, photorealism.'
    },
    'anime': {
      name: '애니메이션/웹툰',
      guide: 'Japanese anime and Korean webtoon masterpiece aesthetic, vibrant dynamic colors, clean delicate lineart, Makoto Shinkai atmospheric lighting, Studio Ghibli inspired emotional scenery, high-end 2D key visual animation illustration.'
    },
    'pixar3d': {
      name: '3D 픽사/디즈니',
      guide: '3D Disney Pixar animation feature film style, lovable stylized character design, subsurface scattering on skin, Octane and Unreal Engine 5 render, warm vivid color palette, soft volumetric lighting, Pixar movie still.'
    },
    'cyberpunk': {
      name: '사이버펑크',
      guide: 'Cyberpunk 2077 aesthetic, futuristic high-tech dystopian cityscape, glowing neon signs in magenta, cyan, and violet, wet asphalt reflections, holographic displays, volumetric fog, moody dark atmosphere.'
    },
    'watercolor': {
      name: '수채화아트',
      guide: 'Artistic watercolor painting on textured cold-press grain paper, wet-on-wet pigment bleeding, soft color gradients, delicate ink contour outlines, expressive loose brushstrokes, serene pastel aesthetic.'
    },
    'retro_film': {
      name: '90s 레트로 필름',
      guide: 'Authentic 1990s vintage film photography, 35mm Kodachrome and Fujifilm tones, nostalgic film grain, warm analog color cast, subtle light leaks, disposable camera snapshot aesthetic, candid retro vibe.'
    },
    'pen_sketch': {
      name: '펜&잉크 스케치',
      guide: 'Detailed hand-drawn pen and black ink illustration, fine cross-hatching shading, vintage etching engraving style, stark high contrast, artistic monochrome line art on archival paper.'
    },
    'fantasy': {
      name: '판타지 컨셉아트',
      guide: 'Epic fantasy game concept art, trending on Artstation, glowing magical aura and runes, grand mythical architecture, atmospheric volumetric fog, dramatic hero lighting, intricate digital painting.'
    },
    'scifi_space': {
      name: '우주&SF',
      guide: 'Epic hard sci-fi and deep space aesthetic, vast swirling colorful nebula and starfield, giant futuristic interstellar spaceships and megastructures, sleek metallic materials, cinematic cosmic scale.'
    },
    'vector': {
      name: '미니멀 벡터',
      guide: 'Modern minimalist vector illustration, flat design with elegant geometric shapes, bold harmonious solid colors, clean crisp vector outlines, trendy tech editorial graphic style.'
    },
    'clay': {
      name: '점토아트',
      guide: 'Handcrafted plasticine claymation style, stop-motion animation aesthetic like Aardman, subtle real fingerprint textures on colored clay, soft studio macro lighting, miniature world charm.'
    },
    'whiteboard': {
      name: '화이트보드 애니메이션',
      guide: 'Whiteboard explainer animation style, bold black dry-erase marker drawing on clean bright white background, minimalist doodle illustration, clear educational infographic art.'
    },
    'none': {
      name: '기본 (원본)',
      guide: 'High quality, clear, balanced, natural visual representation of the scene.'
    }
  };
  window.STYLE_PROMPT_GUIDES = STYLE_PROMPT_GUIDES;

  // 스타일 프리셋 변경 및 UI 동기화
  window.setImageStyle = (styleKey) => {
    if (!IMAGE_STYLE_PRESETS[styleKey]) styleKey = 'none';
    SELECTED_IMAGE_STYLE = styleKey;
    window.SELECTED_IMAGE_STYLE = styleKey;
    try { localStorage.setItem('yt_image_style', styleKey); } catch (e) {}

    // 모달 상단 뱃지 갱신
    const badge = document.getElementById('globalStyleBadge');
    if (badge) {
      const p = IMAGE_STYLE_PRESETS[styleKey];
      badge.textContent = `${p.icon} ${p.name}`;
      if (styleKey === 'none') {
        badge.className = 'text-[10px] font-bold text-amber-300 bg-amber-950/60 border border-amber-700/50 px-1.5 py-0.5 rounded';
      } else {
        badge.className = 'text-[10px] font-bold text-cyan-300 bg-cyan-950/70 border border-cyan-500/60 px-1.5 py-0.5 rounded shadow-sm';
      }
    }

    // 일괄 변환 버튼 라벨 갱신
    const btnLabel = document.getElementById('transformStyleBtnLabel');
    if (btnLabel && IMAGE_STYLE_PRESETS[styleKey]) {
      const p = IMAGE_STYLE_PRESETS[styleKey];
      btnLabel.textContent = `[${p.icon} ${p.name}] 맞춤 AI 프롬프트 일괄 재작성`;
    }

    // 스타일 프리셋 버튼 목록 재렌더링
    window.renderStylePresets();

    // 씬 카드별 드롭다운의 '전역 상속' 텍스트 갱신
    const cards = (_imageCards && _imageCards.length > 0) ? _imageCards : (window._imageCards || []);
    cards.forEach((_, i) => {
      const sel = document.getElementById(`img-style-${i}`);
      if (sel) {
        const inheritOpt = sel.querySelector('option[value="inherit"]');
        if (inheritOpt) {
          inheritOpt.textContent = `🌐 전역 (${IMAGE_STYLE_PRESETS[styleKey].icon} ${IMAGE_STYLE_PRESETS[styleKey].name})`;
        }
      }
    });
  };

  window.renderStylePresets = () => {
    const container = document.getElementById('stylePresetContainer');
    if (!container) return;

    const onClass = 'flex-shrink-0 px-2 py-1 text-[11px] font-bold rounded-lg transition bg-gradient-to-r from-indigo-600 to-purple-600 text-white border border-indigo-400 shadow-md flex items-center gap-1';
    const offClass = 'flex-shrink-0 px-2 py-1 text-[11px] font-semibold rounded-lg transition bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 hover:border-slate-500 flex items-center gap-1';

    container.innerHTML = Object.entries(IMAGE_STYLE_PRESETS).map(([key, p]) => {
      const isActive = (key === SELECTED_IMAGE_STYLE);
      return `<button type="button" onclick="setImageStyle('${key}')" class="${isActive ? onClass : offClass}" title="${p.name}">
        <span>${p.icon}</span>
        <span>${p.name}</span>
      </button>`;
    }).join('');

    const badge = document.getElementById('globalStyleBadge');
    if (badge && IMAGE_STYLE_PRESETS[SELECTED_IMAGE_STYLE]) {
      const p = IMAGE_STYLE_PRESETS[SELECTED_IMAGE_STYLE];
      badge.textContent = `${p.icon} ${p.name}`;
      if (SELECTED_IMAGE_STYLE === 'none') {
        badge.className = 'text-[10px] font-bold text-amber-300 bg-amber-950/60 border border-amber-700/50 px-1.5 py-0.5 rounded';
      } else {
        badge.className = 'text-[10px] font-bold text-cyan-300 bg-cyan-950/70 border border-cyan-500/60 px-1.5 py-0.5 rounded shadow-sm';
      }
    }

    const btnLabel = document.getElementById('transformStyleBtnLabel');
    if (btnLabel && IMAGE_STYLE_PRESETS[SELECTED_IMAGE_STYLE]) {
      const p = IMAGE_STYLE_PRESETS[SELECTED_IMAGE_STYLE];
      btnLabel.textContent = `[${p.icon} ${p.name}] 맞춤 AI 프롬프트 일괄 재작성`;
    }
  };

  window.getStyleName = (styleKey) => {
    return IMAGE_STYLE_PRESETS[styleKey]?.name || '기본 (원본)';
  };

  window.applyStylePreset = (prompt, styleKey) => {
    if (!prompt) return prompt;
    const key = (styleKey && styleKey !== 'inherit') ? styleKey : SELECTED_IMAGE_STYLE;
    const preset = IMAGE_STYLE_PRESETS[key];
    if (!preset || key === 'none' || !preset.promptSuffix) {
      return prompt;
    }
    const cleanPrompt = prompt.trim().replace(/,\s*$/, '');
    return `${cleanPrompt}, ${preset.promptSuffix}`;
  };

  window.getStyleNegativePrompt = (styleKey) => {
    const key = (styleKey && styleKey !== 'inherit') ? styleKey : SELECTED_IMAGE_STYLE;
    const preset = IMAGE_STYLE_PRESETS[key];
    const baseNeg = window.NO_TEXT_NEGATIVE || 'text, watermark, low quality, blurry';
    if (!preset || key === 'none' || !preset.negativePrompt) {
      return baseNeg;
    }
    return `${baseNeg}, ${preset.negativePrompt}`;
  };

  window.setCardStyle = (cardIdx, styleKey) => {
    if (_imageCards && _imageCards[cardIdx]) {
      _imageCards[cardIdx].stylePreset = styleKey;
    }
    if (window._imageCards && window._imageCards[cardIdx]) {
      window._imageCards[cardIdx].stylePreset = styleKey;
    }
  };

  // ─── 💬 자막 텍스트 오버레이 ON / OFF 관리 ─────────────────────────
  window.toggleGlobalSubtitleOverlay = () => {
    _globalSubtitleOverlay = !_globalSubtitleOverlay;
    window._globalSubtitleOverlay = _globalSubtitleOverlay;
    try { localStorage.setItem('yt_global_subtitle', _globalSubtitleOverlay ? 'true' : 'false'); } catch (e) {}
    window.updateSubtitleToggleUI();

    // 모든 카드의 자막 체크박스 및 상태 동기화
    const cards = (_imageCards && _imageCards.length > 0) ? _imageCards : (window._imageCards || []);
    cards.forEach((card, i) => {
      card.subtitleDisabled = !_globalSubtitleOverlay;
      const chk = document.getElementById(`sub-enabled-${i}`);
      if (chk) chk.checked = _globalSubtitleOverlay;
    });
  };

  window.updateSubtitleToggleUI = () => {
    const btn = document.getElementById('globalSubtitleToggleBtn');
    const icon = document.getElementById('globalSubIcon');
    const label = document.getElementById('globalSubLabel');
    if (!btn || !label) return;

    if (_globalSubtitleOverlay) {
      btn.className = 'bg-emerald-700/80 hover:bg-emerald-600 text-emerald-100 border border-emerald-500/60 text-[11px] font-bold px-3 py-1.5 rounded-lg transition shadow-sm flex items-center gap-1.5 whitespace-nowrap';
      if (icon) icon.textContent = '💬';
      label.textContent = '자막 텍스트 삽입: ON';
    } else {
      btn.className = 'bg-slate-700/90 hover:bg-slate-600 text-slate-300 border border-slate-600 text-[11px] font-bold px-3 py-1.5 rounded-lg transition shadow-sm flex items-center gap-1.5 whitespace-nowrap';
      if (icon) icon.textContent = '🔇';
      label.textContent = '자막 텍스트 삽입: OFF';
    }
  };

  window.toggleCardSubEnabled = (idx, checked) => {
    const cards = (_imageCards && _imageCards.length > 0) ? _imageCards : (window._imageCards || []);
    if (cards[idx]) {
      cards[idx].subtitleDisabled = !checked;
    }
  };

  // 개별 생성된 이미지의 자막 즉시 On/Off 토글
  window.toggleImageSubtitleOverlay = async (idx) => {
    const imgEl = document.getElementById(`grok-img-el-${idx}`);
    const dlEl = document.getElementById(`grok-dl-${idx}`);
    const remotionBtn = document.getElementById(`grok-remotion-${idx}`);
    const toggleBtn = document.getElementById(`sub-toggle-btn-${idx}`);
    if (!imgEl || !imgEl.src || imgEl.src === window.location.href) return;

    const rawSrc = imgEl.dataset.rawSrc || imgEl.src;
    imgEl.dataset.rawSrc = rawSrc;

    const hasSub = imgEl.dataset.hasSubtitle === 'true';

    if (hasSub) {
      // 자막 OFF -> 원본(rawSrc) 복원
      imgEl.src = rawSrc;
      dlEl.href = rawSrc;
      if (remotionBtn) remotionBtn.dataset.src = rawSrc;
      imgEl.dataset.hasSubtitle = 'false';
      if (toggleBtn) {
        toggleBtn.textContent = '💬 자막 삽입';
        toggleBtn.className = 'text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold px-3 py-1 rounded-lg transition';
      }
    } else {
      // 자막 ON -> 자막 텍스트 오버레이 합성
      const subEl = document.getElementById(`img-sub-${idx}`);
      let subText = (subEl?.value ?? _imageCards[idx]?.subtitles ?? '').trim();
      if (!subText) {
        alert('삽입할 자막 텍스트가 없습니다. 아래 [자막 텍스트] 입력란을 작성해주세요.');
        return;
      }
      if (toggleBtn) toggleBtn.textContent = '⏳ 자막 합성 중…';
      try {
        subText = await translateSubtitleToKorean(subText);
        if (window.validateKoreanText && subText) subText = window.validateKoreanText(subText);
        const subMax = parseInt(document.getElementById(`sub-max-${idx}`)?.value || '30', 10);
        const finalSrc = await overlaySubtitle(rawSrc, subText, subMax);
        imgEl.src = finalSrc;
        dlEl.href = finalSrc;
        if (remotionBtn) remotionBtn.dataset.src = finalSrc;
        imgEl.dataset.hasSubtitle = 'true';
        if (toggleBtn) {
          toggleBtn.textContent = '💬 자막 제거';
          toggleBtn.className = 'text-xs bg-indigo-700/80 hover:bg-indigo-600 text-indigo-100 font-bold px-3 py-1 rounded-lg transition';
        }
      } catch (err) {
        alert('자막 합성 실패: ' + err.message);
        if (toggleBtn) toggleBtn.textContent = '💬 자막 토글';
      }
    }
  };

  // ─── ✨ 단일 카드에 선택된 스타일에 맞는 AI 영문 프롬프트 자동 작성 ───
  window.generateStylePromptForCard = async (idx, targetStyleKey = null, showVisual = true) => {
    const cards = (_imageCards && _imageCards.length > 0) ? _imageCards : (window._imageCards || []);
    const card = cards[idx];
    if (!card) return;

    const styleKey = targetStyleKey || document.getElementById(`img-style-${idx}`)?.value || card.stylePreset || SELECTED_IMAGE_STYLE || 'cinematic';
    const effectiveKey = (styleKey === 'inherit') ? SELECTED_IMAGE_STYLE : styleKey;
    const styleInfo = IMAGE_STYLE_PRESETS[effectiveKey] || IMAGE_STYLE_PRESETS['none'];
    const guide = STYLE_PROMPT_GUIDES[effectiveKey]?.guide || styleInfo.promptSuffix || '';

    const btn = document.getElementById(`ai-prompt-btn-${idx}`);
    const origText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 작성 중…'; }

    const cut = (document.getElementById(`img-cut-${idx}`)?.value || card.cutDescription || '').trim();
    const curPrompt = (document.getElementById(`img-prompt-${idx}`)?.value || card.prompt || '').trim();
    const sub = (document.getElementById(`img-sub-${idx}`)?.value || card.subtitles || '').trim();
    const title = card.chapterTitle || `장면 ${idx + 1}`;

    try {
      const singleReq = `당신은 AI 이미지 생성(Midjourney, Flux, Stable Diffusion, DALL-E) 프롬프트 전문 엔지니어입니다.
아래 장면 정보에 맞추어, **[${styleInfo.name}]** 스타일에 최적화된 영문 이미지 생성 프롬프트를 1개 작성하세요.

[선택된 스타일 가이드]
스타일: ${styleInfo.name}
렌더링 및 미학 특성: ${guide}

[장면 정보]
- 챕터: ${title}
- 컷 묘사: ${cut || curPrompt || title}
- 자막/메시지: ${sub}

[작성 규칙]
1. 해당 스타일의 화풍, 조명, 구도, 피사체 질감, 색상 팔레트가 극대화된 60~120단어의 완성도 높은 영문 프롬프트 1개만 작성하세요.
2. 텍스트/문자 관련 단어(text, words, letters, watermark, typography, logo)는 절대 포함하지 마세요.
3. 한국/동양인 인물(Korean/East Asian) 컨텍스트가 자연스럽게 유지되도록 하세요.
4. 부연 설명이나 마크다운 없이 오직 완성된 영어 프롬프트 본문만 출력하세요.`;

      const raw = await callGemini(singleReq);
      const cleaned = raw.replace(/^```[a-z]*\n?|```$/gm, '').replace(/^"|"$/g, '').trim();
      if (cleaned && cleaned.length > 10) {
        card.prompt = cleaned;
        const ta = document.getElementById(`img-prompt-${idx}`);
        if (ta) {
          ta.value = cleaned;
          if (showVisual) {
            ta.classList.add('border-indigo-500', 'bg-indigo-950/40');
            setTimeout(() => ta.classList.remove('bg-indigo-950/40'), 1500);
          }
        }
      }
    } catch (e) {
      console.error(`장면 ${idx + 1} 스타일 프롬프트 생성 실패:`, e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origText || '🪄 AI 맞춤 작성'; }
    }
  };

  // ─── ✨ 모든 장면에 선택된 스타일에 맞는 AI 영문 프롬프트 일괄 재작성 ───
  window.transformAllPromptsForStyle = async (styleKey = null) => {
    const cards = (_imageCards && _imageCards.length > 0) ? _imageCards : (window._imageCards || []);
    if (!cards.length) {
      alert('변환할 장면 카드가 없습니다.');
      return;
    }
    const key = styleKey || SELECTED_IMAGE_STYLE || 'cinematic';
    const styleInfo = IMAGE_STYLE_PRESETS[key] || IMAGE_STYLE_PRESETS['none'];
    const guide = STYLE_PROMPT_GUIDES[key]?.guide || styleInfo.promptSuffix || '';

    const btn = document.getElementById('transformStyleAllBtn');
    const origBtnText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span>⏳</span><span>[${styleInfo.name}] 프롬프트 AI 일괄 작성 중…</span>`;
    }

    try {
      const scenesList = cards.map((c, i) => {
        const cut = (document.getElementById(`img-cut-${i}`)?.value || c.cutDescription || '').trim();
        const curPrompt = (document.getElementById(`img-prompt-${i}`)?.value || c.prompt || '').trim();
        const sub = (document.getElementById(`img-sub-${i}`)?.value || c.subtitles || '').trim();
        const title = c.chapterTitle || `장면 ${i + 1}`;
        return `[장면 ${i + 1}]
- 챕터: ${title}
- 장면 내용/컷 묘사: ${cut || curPrompt || title}
- 자막/메시지: ${sub}`;
      }).join('\n\n');

      const promptText = `당신은 세계 최고 수준의 AI 이미지 생성(Midjourney, Flux, Stable Diffusion, DALL-E) 프롬프트 엔지니어입니다.
아래 총 ${cards.length}개의 각 장면에 대해, 선택된 **[${styleInfo.name}]** 스타일에 완벽히 특화된 고품질 영문 이미지 생성 프롬프트를 작성해주세요.

[선택된 스타일 가이드]
스타일: ${styleInfo.name}
스타일 특성 및 렌더링 지침: ${guide}

[작성 규칙]
1. 각 장면마다 해당 스타일의 미학(화풍, 피사체 질감, 조명, 구도, 색감, 렌더링 엔진 특성)을 완벽히 살린 60~120단어의 영문 프롬프트를 작성하세요.
2. 텍스트/글자/워터마크를 유발하는 단어(text, letters, words, logo, typography)는 절대 넣지 마세요.
3. 한국/동양인 맥락(Korean/East Asian)을 자연스럽게 반영하세요.
4. 반드시 아래 JSON 배열 형식으로만 출력하세요 (설명, 마크다운 없이 순수 JSON):

[
  {
    "sceneIndex": 1,
    "prompt": "English image prompt tailored for ${styleInfo.name} style..."
  }
]

[장면 목록]
${scenesList}`;

      const raw = await callGemini(promptText, { jsonMode: true });
      let parsed = safeParseJSON(raw);
      if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') {
        parsed = parsed.scenes || parsed.cards || parsed.items || Object.values(parsed);
      }
      let updatedCount = 0;

      if (Array.isArray(parsed) && parsed.length > 0) {
        parsed.forEach(item => {
          if (!item || typeof item !== 'object') return;
          let idx = -1;
          if (item.sceneIndex !== undefined || item.scene !== undefined || item.index !== undefined) {
            const rawNum = item.sceneIndex ?? item.scene ?? item.index;
            const num = typeof rawNum === 'number' ? rawNum : parseInt(String(rawNum).replace(/[^\d]/g, ''), 10);
            if (!isNaN(num) && num > 0 && num <= cards.length) idx = num - 1;
          }
          const newPrompt = (item.prompt || item.imagePrompt || '').trim();
          if (idx >= 0 && idx < cards.length && newPrompt) {
            cards[idx].prompt = newPrompt;
            const ta = document.getElementById(`img-prompt-${idx}`);
            if (ta) {
              ta.value = newPrompt;
              ta.classList.add('border-indigo-500', 'bg-indigo-950/40');
              setTimeout(() => ta.classList.remove('bg-indigo-950/40'), 1500);
            }
            updatedCount++;
          }
        });
      }

      // 파싱 실패 또는 누락 카드 개별 보완
      if (updatedCount < cards.length) {
        for (let i = 0; i < cards.length; i++) {
          if (!parsed || !Array.isArray(parsed) || !parsed.some(p => (p.sceneIndex - 1) === i)) {
            await window.generateStylePromptForCard(i, key, false);
            updatedCount++;
          }
        }
      }

      const statusMsg = document.getElementById('styleTransformStatus');
      if (statusMsg) {
        statusMsg.textContent = `✨ ${updatedCount}개 장면에 [${styleInfo.icon} ${styleInfo.name}] 맞춤 프롬프트 작성 완료!`;
        statusMsg.classList.remove('hidden');
        setTimeout(() => statusMsg.classList.add('hidden'), 4000);
      }
    } catch (err) {
      console.error('스타일 프롬프트 일괄 변환 실패:', err);
      alert('프롬프트 변환 중 오류가 발생했습니다: ' + err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origBtnText || `<span>🪄</span><span>[${styleInfo.icon} ${styleInfo.name}] 맞춤 AI 프롬프트 일괄 재작성</span>`;
      }
    }
  };

  const YT_BASE = '/api/proxy/youtube'; // 서버 프록시 경유 (CORS 우회)
  const SHORT_MAX_SEC = 180;    // 3분 기준

  // ─── Gemini Gem 패널 토글 ──────────────────────
  window.toggleGemPanel = () => {
    const body = document.getElementById('gemPanelBody');
    const icon = document.getElementById('gemToggleIcon');
    const hidden = body.classList.toggle('hidden');
    icon.textContent = hidden ? '▼ 펼치기' : '▲ 접기';
  };

  // ─── 바이럴 패널 토글 ───────────────────────────
  window.toggleViralPanel = () => {
    const body = document.getElementById('viralPanelBody');
    const icon = document.getElementById('viralToggleIcon');
    const hidden = body.classList.toggle('hidden');
    icon.textContent = hidden ? '▼ 펼치기' : '▲ 접기';
  };

  // ─── .env에서 API 키 자동 로드 ─────────────────────
  (async () => {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error('서버 연결 실패');
      const cfg = await res.json();
      YOUTUBE_API_KEY    = cfg.YOUTUBE_API_KEY    || '';
      GEMINI_API_KEY     = cfg.GEMINI_API_KEY     || '';
      GEMINI_MODEL       = cfg.GEMINI_MODEL       || 'gemini-3.1-flash-lite';
      TRANSCRIPT_API_KEY = cfg.TRANSCRIPT_API_KEY || '';
      XAI_API_KEY        = cfg.XAI_API_KEY        || '';
      IMGBB_API_KEY      = cfg.IMGBB_API_KEY       || '';
      STABILITY_API_KEY  = cfg.STABILITY_API_KEY  || '';

      // 상태 표시 업데이트
      const set = (id, ok, label) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = ok ? `✅ ${label}` : `❌ ${label} 없음`;
        el.className   = ok ? 'text-xs text-green-400' : 'text-xs text-red-400';
      };
      set('apiStatusYt',  !!YOUTUBE_API_KEY,    'YouTube');
      set('apiStatusGem', !!GEMINI_API_KEY,      'Gemini');
      set('apiStatusTr',  !!TRANSCRIPT_API_KEY,  'Transcript');
      set('apiStatusXai', !!XAI_API_KEY,         'xAI');
      set('apiStatusStability', !!STABILITY_API_KEY, 'Stability');

      // Local SD (MPS / GPU) 상태 확인
      fetch('/api/proxy/local-sd-status')
        .then(r => r.json())
        .then(sd => {
          const el = document.getElementById('apiStatusLocalSd');
          if (el) {
            if (sd.online) {
              el.textContent = `✅ Local SD (${sd.device ? sd.device.toUpperCase() : 'MPS'})`;
              el.className   = 'text-xs text-green-400 font-semibold';
            } else {
              el.textContent = '⚪ Local SD (대기)';
              el.className   = 'text-xs text-slate-500';
            }
          }
        })
        .catch(() => {});

      // ComfyUI (로컬 AI) 상태 확인
      fetch('/api/comfyui/health')
        .then(r => r.json())
        .then(res => {
          const el = document.getElementById('apiStatusComfyui');
          if (el) {
            if (res.ok) {
              el.textContent = '✅ ⚙️ ComfyUI (연결됨)';
              el.className   = 'text-xs text-green-400 font-semibold';
            } else {
              el.textContent = '⚪ ⚙️ ComfyUI (미실행)';
              el.className   = 'text-xs text-slate-500';
            }
          }
        })
        .catch(() => {});

      // Phosphene (로컬 MLX 비디오 생성) 상태 확인
      fetch('/api/phosphene/health')
        .then(r => r.json())
        .then(res => {
          const el = document.getElementById('apiStatusPhosphene');
          if (el) {
            if (res.ok) {
              el.textContent = '✅ 🎬 Phosphene (연결됨)';
              el.className   = 'text-xs text-green-400 font-semibold';
            } else {
              el.textContent = '⚪ 🎬 Phosphene (대기)';
              el.className   = 'text-xs text-slate-500';
            }
          }
        })
        .catch(() => {});

      // 스타일 프리셋 UI 초기화
      if (window.renderStylePresets) window.renderStylePresets();
    } catch (e) {
      const bar = document.getElementById('apiStatusBar');
      if (bar) bar.innerHTML = `<span class="text-xs text-red-400">⚠️ 서버 미연결 — python3 server.py 실행 후 새로고침</span>`;
    }
  })();

  // ─── 유틸리티 함수들 ───────────────────────────────────────
  // YouTube API 호출 헬퍼 함수
  async function apiFetch(url) {
    if (!YOUTUBE_API_KEY) {
      throw new Error('YouTube API 키가 설정되지 않았습니다.');
    }
    
    // 서버 프록시를 통한 호출 - API 키는 서버에서 추가됨
    const res = await fetch(url);
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      const message = error?.error?.message || `HTTP ${res.status}`;
      throw new Error(`YouTube API 오류: ${message}`);
    }
    
    return await res.json();
  }

  // 검색 로딩 상태 설정
  function setSearchLoading(loading) {
    const btn = document.querySelector('button[onclick="runSearch()"]');
    if (btn) {
      btn.disabled = loading;
      btn.textContent = loading ? '🔍 검색 중...' : '🔍 검색';
    }
  }

  // 에러 메시지 표시
  function showError(message) {
    const container = document.getElementById('results');
    if (container) {
      container.innerHTML = `
        <div class="text-red-400 text-sm p-4">
          <p class="font-semibold mb-2">⚠️ 오류</p>
          <p class="text-xs">${message.replace(/\n/g, '<br>')}</p>
        </div>
      `;
    }
  }

  // HTML 이스케이프
  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Duration 범위 설정
  function getDurationRange(formType) {
    const ranges = {
      'short': [0, 180],       // 0-3분
      '3-5': [180, 300],       // 3-5분
      '5-7': [300, 420],       // 5-7분
      '7-9': [420, 540],       // 7-9분
      '9-11': [540, 660],      // 9-11분
      '11-13': [660, 780],     // 11-13분
      '13-15': [780, 900],     // 13-15분
      '15+': [900, null],      // 15분+
    };
    return ranges[formType] || [null, null];
  }

  // 숫자 포맷팅
  function fmt(n) {
    if (n >= 100000000) return Math.floor(n / 100000000) + '억';
    if (n >= 10000) return Math.floor(n / 10000) + '만';
    if (n >= 1000) return Math.floor(n / 1000) + '천';
    return String(n);
  }

  // Duration 포맷팅
  function fmtDuration(sec) {
    if (!sec) return '-';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  // 모달 관련 함수들
  function openModalLoading(title, loadingText) {
    const modal = document.getElementById('modal');
    const heading = document.getElementById('modalHeading');
    const videoTitle = document.getElementById('modalVideoTitle');
    const body = document.getElementById('modalBody');
    
    if (modal) modal.classList.remove('hidden');
    if (heading) heading.textContent = '🔍 분석';
    if (videoTitle) videoTitle.textContent = title;
    if (body && loadingText) {
      body.innerHTML = `
        <div class="flex items-center gap-3 p-4">
          <div class="spinner"></div>
          <span class="text-slate-300 text-sm">${loadingText}</span>
        </div>
      `;
    }
  }

  function closeModal() {
    const modal = document.getElementById('modal');
    if (modal) modal.classList.add('hidden');
  }

  // ─── 검색 ───────────────────────────────────────
  window.runSearch = async () => {
    const keyword    = document.getElementById('keyword').value.trim();
    const formType   = document.getElementById('videoType').value;   // '' | 'short' | 'long'
    const minRatio   = Number(document.getElementById('minRatio').value);
    const period     = Number(document.getElementById('period').value);
    const maxResults = Number(document.getElementById('maxResults').value);

    if (!keyword) { alert('검색 키워드를 입력해주세요.'); return; }

    setSearchLoading(true);
    document.getElementById('results').innerHTML =
      '<div class="text-slate-400 text-sm p-4">🔍 검색 중...</div>';

    try {
      const videoIds = await searchVideos(keyword, formType, period, maxResults);
      if (!videoIds.length) { showError('검색 결과가 없습니다. 다른 키워드를 시도해보세요.'); return; }

      document.getElementById('results').innerHTML =
        '<div class="text-slate-400 text-sm p-4">📊 영상 통계 수집 중...</div>';

      const { videos, channelMap } = await fetchVideosWithChannels(videoIds);

      // 실제 재생 시간 기준 클라이언트 필터
      let items = combineAndSort(videos, channelMap);
      const [minSec, maxSec] = getDurationRange(formType);
      if (minSec !== null || maxSec !== null) {
        items = items.filter(v => {
          const s = v.durationSec;
          if (minSec !== null && s < minSec) return false;
          if (maxSec !== null && s >= maxSec) return false;
          return true;
        });
      }

      // 바이럴 비율 필터
      if (minRatio > 0) items = items.filter(v => v.ratio >= minRatio);

      if (!items.length) {
        showError(`바이럴 비율 ${minRatio}% 이상인 영상이 없습니다.\n[최소 바이럴 비율] 필터를 낮추거나 "제한 없음"으로 변경해보세요.`);
        return;
      }

      renderResults(items);
    } catch (e) {
      const msg = e.message || String(e);
      showError('검색 오류: ' + msg);
      alert('검색 오류가 발생했습니다:\n\n' + msg + '\n\n브라우저 콘솔(F12)에서 상세 내용을 확인하세요.');
      console.error('[Search Error]', e);
    } finally {
      setSearchLoading(false);
    }
  };

  // ─── YouTube API ─────────────────────────────────
  async function searchVideos(keyword, formType, periodMonths, maxResults) {
    const since = new Date();
    since.setMonth(since.getMonth() - periodMonths);

    // YouTube API duration 힌트: short(<4분) / medium(4~20분) / long(>20분)
    // 3분 기준 정밀 필터는 contentDetails로 클라이언트에서 처리
    const apiDuration = formType === 'short'                    ? 'short'
                      : ['5-7','7-9','9-11','11-13','13-15'].includes(formType) ? 'medium'
                      : formType === '15+'                      ? 'long'
                      : '';   // 전체 또는 3-5분(4분 경계 걸침)은 API 필터 없음
    const durationParam = apiDuration ? `&videoDuration=${apiDuration}` : '';

    const url = `${YT_BASE}/search?part=snippet`
      + `&q=${encodeURIComponent(keyword)}`
      + `&type=video&order=viewCount`
      + `&maxResults=${maxResults}`
      + `&publishedAfter=${since.toISOString()}`
      + `&regionCode=KR&relevanceLanguage=ko`
      + durationParam;

    const res = await apiFetch(url);
    return res.items.map(i => i.id.videoId);
  }

  async function fetchVideosWithChannels(videoIds) {
    const ids  = videoIds.join(',');
    // contentDetails 추가로 실제 길이 가져오기
    const vUrl = `${YT_BASE}/videos?part=snippet,statistics,contentDetails&id=${ids}`;
    const vRes = await apiFetch(vUrl);
    const videos = vRes.items;

    const channelIds = [...new Set(videos.map(v => v.snippet.channelId))];
    const chUrl = `${YT_BASE}/channels?part=statistics&id=${channelIds.join(',')}`;
    const chRes = await apiFetch(chUrl);

    const channelMap = {};
    chRes.items.forEach(ch => { channelMap[ch.id] = Number(ch.statistics.subscriberCount || 0); });

    return { videos, channelMap };
  }

  function parseDuration(iso = '') {
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
  }

  function combineAndSort(videos, channelMap) {
    return videos
      .map(v => {
        const views       = Number(v.statistics.viewCount || 0);
        const subs        = channelMap[v.snippet.channelId] || 1;
        const ratio       = (views / subs) * 100;
        const durationSec = parseDuration(v.contentDetails?.duration);
        return {
          id: v.id, title: v.snippet.title,
          channel: v.snippet.channelTitle, channelId: v.snippet.channelId,
          thumbnail: v.snippet.thumbnails?.medium?.url || '',
          views, subs, ratio, durationSec,
          published: v.snippet.publishedAt.slice(0, 10),
        };
      })
      .sort((a, b) => b.ratio - a.ratio);
  }

  // ─── 결과 렌더링 ─────────────────────────────────
  function renderResults(items) {
    const maxRatio  = items[0]?.ratio || 1;
    const container = document.getElementById('results');

    container.innerHTML = `
      <div class="text-xs text-slate-500 mb-2 px-1">
        <span class="text-slate-300 font-medium">${items.length}개</span> 영상 · 바이럴 비율 높은 순 정렬
      </div>`;

    items.forEach((v, idx) => {
      const barW = Math.min(100, (v.ratio / maxRatio) * 100).toFixed(1);
      const ratioColor = v.ratio >= 1000 ? 'text-yellow-300' :
                         v.ratio >= 500  ? 'text-orange-400' :
                         v.ratio >= 200  ? 'text-green-400'  : 'text-indigo-300';
      const formTag = v.durationSec > 0
        ? (v.durationSec < SHORT_MAX_SEC
            ? '<span class="bg-pink-900/50 text-pink-300 text-[10px] px-1.5 py-0.5 rounded font-medium">숏폼</span>'
            : '<span class="bg-blue-900/50 text-blue-300 text-[10px] px-1.5 py-0.5 rounded font-medium">롱폼</span>')
        : '';

      const card = document.createElement('div');
      card.className = 'bg-slate-800 border border-slate-700 rounded-xl p-4 hover:border-indigo-600 transition';
      card.innerHTML = `
        <div class="flex gap-4">
          <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener" class="flex-shrink-0">
            <img src="${v.thumbnail}" alt="썸네일" class="w-36 h-24 object-cover rounded-lg hover:opacity-80 transition" />
          </a>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2 mb-1">
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-bold text-indigo-400 bg-indigo-900/40 px-2 py-0.5 rounded">#${idx + 1}</span>
                ${formTag}
                <span class="text-[10px] text-slate-500">${fmtDuration(v.durationSec)}</span>
              </div>
              <span class="text-xs text-slate-500">${v.published}</span>
            </div>
            <a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener"
              class="font-semibold text-sm text-slate-100 hover:text-indigo-300 transition line-clamp-2 block mb-1.5">
              ${escHtml(v.title)}
            </a>
            <p class="text-xs text-slate-400 mb-2.5">${escHtml(v.channel)}</p>
            <div class="grid grid-cols-3 gap-2 text-xs mb-2">
              <div class="flex flex-col gap-0.5">
                <span class="text-[10px] text-slate-500">👁 조회수</span>
                <span class="text-slate-200 font-medium">${fmt(v.views)}</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-[10px] text-slate-500">👥 구독자수</span>
                <span class="text-slate-200 font-medium">${fmt(v.subs)}</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-[10px] text-slate-500">📈 바이럴 비율</span>
                <span class="font-bold ${ratioColor}">${v.ratio.toFixed(0)}%</span>
              </div>
            </div>
            <div class="mb-3 bg-slate-700/40 rounded-full overflow-hidden" style="height:4px">
              <div class="ratio-bar h-full" style="width:${barW}%"></div>
            </div>
            <button class="comment-analysis-btn bg-slate-700 hover:bg-indigo-700 text-xs text-slate-200 px-3 py-1.5 rounded-lg transition flex items-center gap-1.5"
              id="btn-${v.id}"
              data-video-id="${v.id}"
              data-video-title="${escHtml(v.title)}">
              <span>💬 댓글 수집 및 AI 분석</span>
              <span id="spin-${v.id}" class="spinner hidden" style="width:13px;height:13px;border-width:2px"></span>
            </button>
          </div>
        </div>`;
      container.appendChild(card);
    });
    
    // 댓글 분석 버튼 이벤트 리스너 추가
    document.querySelectorAll('.comment-analysis-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const videoId = btn.dataset.videoId;
        const videoTitle = btn.dataset.videoTitle;
        window.startCommentAnalysis(videoId, videoTitle);
      });
    });
  }

  // ─── 댓글 수집 & 분석 ───────────────────────────
  window.startCommentAnalysis = async (videoId, title) => {
    if (!GEMINI_API_KEY) {
      alert('Gemini API 키가 설정되지 않았습니다.\n키 설정 패널에서 저장해주세요.');
      return;
    }
    if (!YOUTUBE_API_KEY) {
      alert('YouTube API 키가 설정되지 않았습니다.\n키 설정 패널에서 저장해주세요.');
      return;
    }

    const btn  = document.getElementById(`btn-${videoId}`);
    const spin = document.getElementById(`spin-${videoId}`);
    btn.disabled = true;
    spin.classList.remove('hidden');

    try {
      const comments = await fetchComments(videoId);
      if (!comments.length) {
        openModalLoading(title, '');
        document.getElementById('modalBody').innerHTML =
          `<p class="text-yellow-400 p-4">이 영상은 댓글이 비활성화되어 있거나 댓글이 없습니다.</p>`;
        return;
      }
      openModalLoading(title, `댓글 ${comments.length}개를 AI가 분석하고 있습니다...`);
      const analysis = await callGeminiAnalysis(title, comments);
      _cachedAnalysis   = analysis;
      _cachedVideoTitle = title;
      renderStage1(analysis, title);
    } catch (e) {
      console.error('댓글 분석 오류:', e);
      openModalLoading(title, '');
      document.getElementById('modalBody').innerHTML =
        `<div class="p-4 space-y-2">
           <p class="text-red-400 font-semibold">오류 발생</p>
           <p class="text-slate-300 text-xs">${escHtml(e.message)}</p>
         </div>`;
    } finally {
      btn.disabled = false;
      spin.classList.add('hidden');
    }
  };

  async function fetchComments(videoId) {
    const url = `${YT_BASE}/commentThreads?part=snippet&videoId=${videoId}&maxResults=50&order=relevance`;
    const res = await apiFetch(url);
    return (res.items || []).map(i => {
      const s = i.snippet.topLevelComment.snippet;
      return { text: s.textDisplay, likes: s.likeCount || 0 };
    });
  }

  // ─── Gemini REST API 공통 호출 ──────────────────
  async function callGemini(prompt, options = {}) {
    const jsonMode = typeof options === 'object' ? (options.jsonMode || false) : false;
    const retries  = (typeof options === 'object' && options.retries) ? options.retries : 3;
    const apiKey   = GEMINI_API_KEY || window.GEMINI_API_KEY || '';
    const useProxy = window.location.protocol === 'http:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    const reqBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
        temperature: options.temperature || 0.7,
        maxOutputTokens: options.maxTokens || 8192,
        topP: options.topP || 0.95,
        topK: options.topK || 40
      }
    };

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        let res;
        if (useProxy) {
          res = await fetch('/api/proxy/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody)
          });
        } else {
          // Direct fallback models
          const models = [GEMINI_MODEL || 'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-3.5-flash-lite'];
          let lastDirectError = null;
          for (const m of models) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
            const dRes = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(reqBody)
            });
            if (dRes.ok) {
              res = dRes;
              break;
            } else {
              const err = await dRes.json().catch(() => ({}));
              lastDirectError = err?.error?.message || `HTTP ${dRes.status}`;
            }
          }
          if (!res) throw new Error(lastDirectError || 'Gemini 호출 실패');
        }

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const errMsg = err?.error?.message || `HTTP ${res.status}`;
          if (res.status === 429 && attempt < retries - 1) {
            console.warn(`Gemini 429 rate limit hit, retrying in ${(attempt + 1) * 2}s...`);
            await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
            continue;
          }
          throw new Error(errMsg);
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('AI 응답이 비어 있습니다.');
        return text;
      } catch (e) {
        if (attempt >= retries - 1) throw e;
        await new Promise(r => setTimeout(r, (attempt + 1) * 1500));
      }
    }
  }
  window.callGemini = callGemini;

  // ─── Gemini: 댓글 분석 (JSON) ───────────────────
  async function callGeminiAnalysis(title, comments) {
    const commentText = comments
      .map((c, i) => `${i + 1}. [좋아요 ${c.likes}개] ${c.text}`)
      .join('\n');

    const prompt = `
당신은 유튜브 콘텐츠 전략 전문가입니다.
아래 유튜브 영상 제목과 상위 댓글을 분석해주세요.

[영상 제목]
${title}

[댓글 ${comments.length}개]
${commentText}

반드시 아래 JSON 형식으로만 응답하세요. 마크다운 코드블록 없이 순수 JSON만 출력하세요.

{
  "reactions": ["시청자가 열광하는 포인트 1","포인트 2","포인트 3"],
  "painPoints": ["아쉬운 점 또는 추가 궁금증 1","2","3"],
  "topKeywords": [
    {"word":"키워드1","reason":"자주 언급된 맥락"},
    {"word":"키워드2","reason":"자주 언급된 맥락"},
    {"word":"키워드3","reason":"자주 언급된 맥락"},
    {"word":"키워드4","reason":"자주 언급된 맥락"},
    {"word":"키워드5","reason":"자주 언급된 맥락"}
  ],
  "viralFactors": {
    "ctr": {
      "score": "높음 또는 보통 또는 낮음",
      "analysis": "댓글 반응을 근거로, 제목·썸네일이 클릭을 유도한 요인 또는 부족한 점 분석",
      "tips": ["CTR 개선 팁1", "CTR 개선 팁2"]
    },
    "avd": {
      "score": "높음 또는 보통 또는 낮음",
      "analysis": "특정 구간 언급, 끝까지 봤다는 반응, 이탈 유발 요소 등 댓글 기반 시청 지속 시간 분석",
      "tips": ["AVD 개선 팁1", "AVD 개선 팁2"]
    },
    "engagement": {
      "score": "높음 또는 보통 또는 낮음",
      "analysis": "댓글 활발도, 좋아요·공유·구독 언급 여부, 시청자 상호작용 분석",
      "tips": ["참여도 개선 팁1", "참여도 개선 팁2"]
    }
  },
  "recommendedTopics": [
    {"keyword":"주제 키워드1","description":"이 주제를 선택해야 하는 이유와 기획 방향","titleIdea":"예상 영상 제목"},
    {"keyword":"주제 키워드2","description":"이유와 기획 방향","titleIdea":"예상 영상 제목"},
    {"keyword":"주제 키워드3","description":"이유와 기획 방향","titleIdea":"예상 영상 제목"},
    {"keyword":"주제 키워드4","description":"이유와 기획 방향","titleIdea":"예상 영상 제목"},
    {"keyword":"주제 키워드5","description":"이유와 기획 방향","titleIdea":"예상 영상 제목"}
  ]
}`.trim();

    const raw = await callGemini(prompt, { jsonMode: true });
    try { return safeParseJSON(raw); }
    catch(e) { throw new Error('AI 응답 파싱 실패. 다시 시도해주세요. (' + e.message + ')'); }
  }

  // ─── Gemini: 대본 목차 (JSON) ───────────────────
  async function callGeminiOutline(keyword, videoTitle, wordCount) {

    const { guide, chapters } = {
      500:  { guide: '각 섹션 1~3문장 핵심만 (총 500자 내외)',          chapters: '6~8개' },
      1000: { guide: '각 섹션 3~5문장 (총 1,000자 내외)',               chapters: '8~10개' },
      2000: { guide: '각 섹션 5~8문장 상세 내용 (총 2,000자 내외)',     chapters: '10~14개' },
      3000: { guide: '실제 말할 완전한 대본 형식 (총 3,000자 내외)',    chapters: '14~18개' },
    }[wordCount] || { guide: '각 섹션 3~5문장', chapters: '8~10개' };

    const prompt = `
당신은 유튜브 영상 대본 전문 작가입니다.
참고 영상: "${videoTitle}"
선택 주제: "${keyword}"

분량 기준: ${guide}
챕터 수: 반드시 ${chapters} 범위 내에서 작성하세요. 최소 개수 이상 반드시 작성! 절대 4개 이하로 줄이지 마세요.

아래 JSON 형식으로만 응답하세요. 마크다운 코드블록 없이 순수 JSON만 출력하세요.

{
  "titleCandidates": ["제목 후보1","제목 후보2","제목 후보3"],
  "thumbnailConcept": "썸네일에 들어갈 이미지 컨셉, 텍스트, 색상을 구체적으로 설명 (한국어)",
  "thumbnailImagePrompt": "A photorealistic cinematic YouTube thumbnail image: [describe the exact visual scene, subject, lighting, background, mood, colors, and composition in English. Include text overlay space. Max 200 words. Optimized for Imagen 4.]",
  "openingHook": "시청자를 15~30초 안에 붙잡는 오프닝 스크립트",
  "chapters": [
    {"no":1,"title":"챕터 제목","points":["핵심 포인트1","핵심 포인트2"],"script":"이 챕터에서 실제로 할 말"}
  ],
  "closing": "구독·좋아요·댓글 CTA가 포함된 클로징 스크립트",
  "productionTips": ["제작 팁1","제작 팁2","제작 팁3"]
}

chapters 배열에 ${chapters} 범위의 챕터를 채워주세요. 예시는 1개이지만 실제로는 ${chapters} 작성해야 합니다.
⚠️ 중요: 챕터 수가 부족하면 이미지 생성에 문제가 됩니다. 반드시 최소 개수 이상 작성하세요!`.trim();

    const raw = await callGemini(prompt, { jsonMode: true });
    try { return safeParseJSON(raw); }
    catch(e) { throw new Error('대본 목차 파싱 실패. 다시 시도해주세요. (' + e.message + ')'); }
  }

  // ─── 모달 스테이지 렌더러 ───────────────────────

  function openModalLoading(title, msg) {
    document.getElementById('modalHeading').textContent   = '분석 중...';
    document.getElementById('modalVideoTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = `
      <div class="flex flex-col items-center justify-center py-14 gap-4">
        <div class="spinner" style="width:36px;height:36px;border-width:4px"></div>
        <p class="text-slate-400 text-sm">${escHtml(msg)}</p>
      </div>`;
    document.getElementById('modal').classList.remove('hidden');
  }

  // ─── 바이럴 3대 요소 렌더링 ─────────────────────
  function renderViralFactors(vf) {
    if (!vf) return '';

    const scoreColor = s =>
      s === '높음' ? 'text-green-400 bg-green-900/40 border-green-700' :
      s === '낮음' ? 'text-red-400 bg-red-900/30 border-red-800' :
                    'text-yellow-400 bg-yellow-900/30 border-yellow-700';

    const scoreBar = s =>
      s === '높음' ? 'w-full bg-green-500' :
      s === '낮음' ? 'w-1/3 bg-red-500' :
                    'w-2/3 bg-yellow-500';

    const card = (icon, label, sub, color, factor) => {
      if (!factor) return '';
      const sc   = factor.score || '보통';
      const tips = (factor.tips || []).map(t =>
        `<li class="flex gap-1.5 text-xs text-slate-400"><span class="flex-shrink-0 text-indigo-400">▸</span>${escHtml(t)}</li>`
      ).join('');
      return `
        <div class="bg-slate-700/40 border border-slate-600 rounded-xl p-4">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <span class="text-lg">${icon}</span>
              <div>
                <p class="text-xs font-bold text-white">${label}</p>
                <p class="text-[10px] ${color}">${sub}</p>
              </div>
            </div>
            <span class="text-xs font-bold px-2 py-0.5 rounded-full border ${scoreColor(sc)}">${sc}</span>
          </div>
          <div class="h-1 rounded-full bg-slate-600 mb-3 overflow-hidden">
            <div class="h-full rounded-full transition-all ${scoreBar(sc)}"></div>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed mb-2">${escHtml(factor.analysis)}</p>
          ${tips ? `<ul class="space-y-1">${tips}</ul>` : ''}
        </div>`;
    };

    return `
      <div class="script-section">
        <h4 class="text-purple-300 mb-3">🚀 바이럴 비율 3대 핵심 요소 분석</h4>
        <div class="grid grid-cols-1 gap-3">
          ${card('🎯', '클릭률 (CTR)', 'Click-Through Rate', 'text-indigo-400', vf.ctr)}
          ${card('⏱️', '평균 시청 지속 시간 (AVD)', 'Average View Duration', 'text-green-400', vf.avd)}
          ${card('💬', '참여도 (Engagement)', 'Likes · Comments · Shares', 'text-orange-400', vf.engagement)}
        </div>
      </div>`;
  }

  // 1단계: 분석 결과
  function renderStage1(data, title) {
    document.getElementById('modalHeading').textContent = '📊 댓글 분석 결과';

    const reactions  = data.reactions.map(r =>
      `<li class="flex gap-2 text-slate-300"><span class="text-green-400 flex-shrink-0 mt-0.5">✓</span>${escHtml(r)}</li>`).join('');
    const pains      = data.painPoints.map(p =>
      `<li class="flex gap-2 text-slate-300"><span class="text-yellow-400 flex-shrink-0 mt-0.5">?</span>${escHtml(p)}</li>`).join('');
    const keywords   = data.topKeywords.map(k => `
      <div class="bg-slate-700/50 rounded-lg p-3">
        <div class="text-indigo-300 font-bold text-sm mb-0.5">#${escHtml(k.word)}</div>
        <div class="text-xs text-slate-400">${escHtml(k.reason)}</div>
      </div>`).join('');
    const topics     = data.recommendedTopics.map((t, i) => `
      <button onclick="showWordCountSelector(${i})"
        id="topic-btn-${i}"
        class="topic-btn"
        data-keyword="${escHtml(t.keyword)}"
        data-description="${escHtml(t.description)}"
        data-title-idea="${escHtml(t.titleIdea)}">
        <div class="flex items-center gap-2 mb-1">
          <span class="bg-indigo-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">${i + 1}</span>
          <span class="font-bold text-indigo-300 text-sm">${escHtml(t.keyword)}</span>
        </div>
        <p class="text-xs text-slate-300 mb-1">${escHtml(t.description)}</p>
        <p class="text-xs text-slate-500">💡 예상 제목: ${escHtml(t.titleIdea)}</p>
      </button>`).join('');

    document.getElementById('modalBody').innerHTML = `
      <div class="space-y-5">
        <!-- 시청자 반응 -->
        <div class="script-section">
          <h4 class="text-green-400">✅ 시청자들이 열광하는 포인트</h4>
          <ul class="space-y-1.5">${reactions}</ul>
        </div>
        <!-- Pain Points -->
        <div class="script-section">
          <h4 class="text-yellow-400">❓ 아쉬운 점 &amp; 추가 궁금증</h4>
          <ul class="space-y-1.5">${pains}</ul>
        </div>
        <!-- 자주 언급된 키워드 -->
        <div class="script-section">
          <h4 class="text-slate-300">🏷️ 자주 언급된 키워드 TOP 5</h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${keywords}</div>
        </div>
        <!-- 바이럴 3대 핵심 요소 분석 -->
        ${renderViralFactors(data.viralFactors)}

        <!-- 추천 주제 -->
        <div>
          <h4 class="text-sm font-bold text-indigo-300 mb-2">🎬 추천 영상 주제 키워드 — 클릭하면 대본 목차를 작성합니다</h4>
          <div class="space-y-2">${topics}</div>
        </div>
        <!-- 글자 수 선택 영역 (초기 숨김) -->
        <div id="wordCountPanel" class="hidden bg-indigo-900/20 border border-indigo-700 rounded-xl p-4">
          <p class="text-sm font-semibold text-indigo-300 mb-3">✍️ 대본 분량을 선택해주세요</p>
          <div class="flex flex-wrap gap-2 mb-4">
            <button onclick="setWordCount(500)"  id="wc-500"  class="wordcount-btn">짧게 (~500자)</button>
            <button onclick="setWordCount(1000)" id="wc-1000" class="wordcount-btn active">보통 (~1,000자)</button>
            <button onclick="setWordCount(2000)" id="wc-2000" class="wordcount-btn">상세 (~2,000자)</button>
            <button onclick="setWordCount(3000)" id="wc-3000" class="wordcount-btn">완전 대본 (~3,000자)</button>
          </div>
          <button onclick="generateOutline()"
            class="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold py-2.5 rounded-lg transition">
            📝 대본 목차 생성하기
          </button>
        </div>
      </div>`;
  }

  // 1.5단계: 글자 수 선택
  let _selectedTopicIdx  = -1;
  let _selectedWordCount = 1000;

  window.showWordCountSelector = (idx) => {
    // 이전 선택 해제
    document.querySelectorAll('.topic-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById(`topic-btn-${idx}`).classList.add('selected');
    _selectedTopicIdx = idx;

    // 패널 표시
    const panel = document.getElementById('wordCountPanel');
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  window.setWordCount = (n) => {
    _selectedWordCount = n;
    [500, 1000, 2000, 3000].forEach(v => {
      document.getElementById(`wc-${v}`)?.classList.toggle('active', v === n);
    });
  };

  window.generateOutline = async () => {
    if (_selectedTopicIdx < 0) return;
    const btn     = document.getElementById(`topic-btn-${_selectedTopicIdx}`);
    const keyword = btn.dataset.keyword;

    openModalLoading(_cachedVideoTitle, `"${keyword}" 주제로 대본 목차를 작성하고 있습니다...`);

    try {
      const outline = await callGeminiOutline(keyword, _cachedVideoTitle, _selectedWordCount);
      renderStage2(outline, keyword);
    } catch (e) {
      openModalLoading(_cachedVideoTitle, '');
      document.getElementById('modalBody').innerHTML =
        `<p class="text-red-400 p-4">오류: ${escHtml(e.message)}</p>`;
    }
  };

  // 분석 결과로 돌아가기
  window.backToAnalysis = () => {
    if (_cachedAnalysis) {
      renderStage1(_cachedAnalysis, _cachedVideoTitle);
    }
  };

  // ⚙️ ComfyUI Text-to-Image 공통 함수
  async function generateComfyUIImage(prompt, options = {}) {
    const width = options.width || 768;
    const height = options.height || 448;
    const steps = options.steps || 20;
    const cfg = options.cfg || 7.0;
    const negativePrompt = options.negative_prompt || 'blurry, low quality, distorted, extra limbs, bad anatomy, ugly, watermark, text, signature';
    const onProgress = options.onProgress || (() => {});

    // 1. Health check
    onProgress('⚙️ ComfyUI 로컬 서버 확인 중…');
    const healthRes = await fetch('/api/comfyui/health');
    const healthData = await healthRes.json();
    if (!healthData.ok) {
      throw new Error('ComfyUI 서버(포트 8188)가 실행 중이지 않습니다.');
    }

    // 2. Check available checkpoints
    let ckpt = 'v1-5-pruned-emaonly.safetensors';
    try {
      const ckptRes = await fetch('/api/proxy/comfyui/object_info/CheckpointLoaderSimple');
      if (ckptRes.ok) {
        const ckptData = await ckptRes.json();
        const list = ckptData?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
        if (Array.isArray(list) && list.length > 0) {
          // Mac GPU 속도를 위해 SD 1.5 우선 선택
          const v15 = list.find(name => name.includes('v1-5') || name.includes('1.5') || name.includes('pruned'));
          ckpt = v15 || list[0];
        }
      }
    } catch (e) {
      console.warn('Failed to get checkpoint info:', e);
    }

    // 3. Construct workflow
    const seed = Math.floor(Math.random() * 1000000000);
    const workflow = {
      "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": ckpt } },
      "5": { "class_type": "EmptyLatentImage", "inputs": { "width": width, "height": height, "batch_size": 1 } },
      "6": { "class_type": "CLIPTextEncode", "inputs": { "text": prompt, "clip": ["4", 1] } },
      "7": { "class_type": "CLIPTextEncode", "inputs": { "text": negativePrompt, "clip": ["4", 1] } },
      "3": {
        "class_type": "KSampler",
        "inputs": {
          "seed": seed,
          "steps": steps,
          "cfg": cfg,
          "sampler_name": "euler",
          "scheduler": "normal",
          "denoise": 1.0,
          "model": ["4", 0],
          "positive": ["6", 0],
          "negative": ["7", 0],
          "latent_image": ["5", 0]
        }
      },
      "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
      "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": "ComfyUI_Thumbnail", "images": ["8", 0] } }
    };

    onProgress('⚙️ ComfyUI 작업 큐 등록 중…');
    const promptRes = await fetch('/api/proxy/comfyui/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow })
    });

    if (!promptRes.ok) {
      const errData = await promptRes.json().catch(() => ({}));
      throw new Error(errData.error || `ComfyUI 큐 등록 실패 (${promptRes.status})`);
    }

    const promptData = await promptRes.json();
    const promptId = promptData.prompt_id;
    if (!promptId) throw new Error('ComfyUI 작업 ID를 수신하지 못했습니다.');

    // 4. Poll history
    let attempts = 0;
    const maxAttempts = 120; // 2 minutes
    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
      onProgress(`⏳ ComfyUI 로컬 이미지 렌더링 중… (${attempts}초)`);

      try {
        const histRes = await fetch(`/api/proxy/comfyui/history?prompt_id=${promptId}`);
        if (!histRes.ok) continue;
        const history = await histRes.json();
        if (history[promptId]) {
          const outputs = history[promptId].outputs;
          for (const nid in outputs) {
            if (outputs[nid].images && outputs[nid].images.length > 0) {
              const imgInfo = outputs[nid].images[0];
              onProgress('✅ ComfyUI 이미지 수신 중…');
              const viewUrl = `/api/proxy/comfyui/view?filename=${encodeURIComponent(imgInfo.filename)}&subfolder=${encodeURIComponent(imgInfo.subfolder || '')}&type=${encodeURIComponent(imgInfo.type || 'output')}`;
              const viewRes = await fetch(viewUrl);
              if (!viewRes.ok) throw new Error('ComfyUI 이미지 다운로드 실패');
              const blob = await viewRes.blob();
              return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
            }
          }
        }
      } catch (e) {
        console.warn('ComfyUI polling error:', e);
      }
    }
    throw new Error('ComfyUI 이미지 생성 대기 시간 초과');
  }

  // 썸네일 엔진 설정 (기본값: ⚙️ ComfyUI 로컬 AI)
  let _currentThumbnailEngine = 'comfyui';

  window.setThumbnailEngine = (engine) => {
    _currentThumbnailEngine = engine;
    ['comfyui', 'pollinations', 'imagen', 'stability'].forEach(eng => {
      const btn = document.getElementById(`tnEngine${eng.charAt(0).toUpperCase() + eng.slice(1)}`);
      if (btn) {
        if (eng === engine) {
          btn.className = 'px-2.5 py-1 rounded font-bold transition text-pink-200 bg-pink-800/80 shadow-sm border border-pink-500/50';
        } else {
          btn.className = 'px-2.5 py-1 rounded font-medium transition text-slate-400 hover:text-slate-200 border border-transparent';
        }
      }
    });
  };

  let _cachedOutline = null;
  let _cachedOutlineKeyword = '';

  // 2단계: 대본 목차
  function renderStage2(data, keyword) {
    _cachedOutline        = data;
    _cachedOutlineKeyword = keyword;
    // 이미지 스크립트 채팅 위젯에 공유 + 뱃지 표시
    window._sharedOutline        = data;
    window._sharedOutlineKeyword = keyword;
    // 이미지 스크립트 채팅 초기화
    sibHistory = [];
    document.getElementById('scriptImgChatMessages').innerHTML = '';
    document.getElementById('scriptImgChatWindow').classList.add('hidden');
    document.getElementById('scriptImgBadge').style.display = 'block';
    document.getElementById('modalHeading').textContent = `✍️ 대본 목차`;
    document.getElementById('modalVideoTitle').textContent = `주제: ${keyword}`;

    const titles = data.titleCandidates.map((t, i) => `
      <div class="flex gap-2 items-start">
        <span class="text-indigo-400 font-bold flex-shrink-0">${i + 1}.</span>
        <span class="text-slate-200">${escHtml(t)}</span>
      </div>`).join('');

    const chapters = (data.chapters || []).map(ch => `
      <div class="script-section">
        <h4 class="text-indigo-300">📌 챕터 ${ch.no}. ${escHtml(ch.title)}</h4>
        <ul class="mb-3 space-y-1">
          ${(ch.points || []).map(p => `<li class="text-xs text-slate-400 flex gap-1.5"><span class="text-indigo-500">▸</span>${escHtml(p)}</li>`).join('')}
        </ul>
        <div class="border-t border-slate-600 pt-3 mt-2">
          <p class="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">대본</p>
          <p class="text-slate-300 whitespace-pre-line">${escHtml(ch.script)}</p>
        </div>
      </div>`).join('');

    const tips = (data.productionTips || []).map(t =>
      `<li class="flex gap-2 text-slate-300"><span class="text-indigo-400 flex-shrink-0">•</span>${escHtml(t)}</li>`).join('');

    document.getElementById('modalBody').innerHTML = `
      <!-- 뒤로 가기 -->
      <button onclick="backToAnalysis()"
        class="text-xs text-slate-400 hover:text-indigo-300 transition flex items-center gap-1 mb-5">
        ← 분석 결과로 돌아가기
      </button>

      <!-- 제목 후보 -->
      <div class="script-section">
        <h4 class="text-yellow-300">🏆 영상 제목 후보 3개</h4>
        <div class="space-y-2">${titles}</div>
      </div>

      <!-- 썸네일 -->
      <div class="script-section bg-gradient-to-br from-pink-950/30 via-slate-800/60 to-slate-800/80 border border-pink-700/40 rounded-xl p-4 shadow-lg">
        <div class="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="text-xl">🖼️</span>
            <div>
              <h4 class="text-pink-300 font-bold mb-0 text-sm">썸네일 기획 &amp; AI 이미지 생성</h4>
              <p class="text-[11px] text-slate-400">CTR 최적화 16:9 유튜브 썸네일 이미지 자동 생성 (1280×720)</p>
            </div>
          </div>
          <!-- 이미지 엔진 선택기 및 생성 버튼 -->
          <div class="flex items-center gap-2 flex-wrap">
            <div class="flex bg-slate-900/90 rounded-lg p-0.5 border border-slate-700 text-xs">
              <button type="button" onclick="setThumbnailEngine('comfyui')" id="tnEngineComfyui"
                class="px-2.5 py-1 rounded font-bold transition text-pink-200 bg-pink-800/80 shadow-sm border border-pink-500/50">
                ⚙️ ComfyUI (로컬 AI)
              </button>
              <button type="button" onclick="setThumbnailEngine('pollinations')" id="tnEnginePollinations"
                class="px-2.5 py-1 rounded font-medium transition text-slate-400 hover:text-slate-200 border border-transparent">
                🌸 Pollinations (무료 Flux)
              </button>
              <button type="button" onclick="setThumbnailEngine('imagen')" id="tnEngineImagen"
                class="px-2.5 py-1 rounded font-medium transition text-slate-400 hover:text-slate-200 border border-transparent">
                🌈 Gemini Imagen
              </button>
              <button type="button" onclick="setThumbnailEngine('stability')" id="tnEngineStability"
                class="px-2.5 py-1 rounded font-medium transition text-slate-400 hover:text-slate-200 border border-transparent">
                🎨 Stable Diffusion
              </button>
            </div>
            <button onclick="generateThumbnailFromConcept()" id="thumbnailGenBtn"
              class="text-xs bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500
                     text-white font-bold px-3.5 py-1.5 rounded-lg transition shadow-md flex items-center gap-1.5 flex-shrink-0">
              🎨 썸네일 이미지 생성
            </button>
          </div>
        </div>

        <div class="bg-slate-800/70 rounded-lg p-3 border border-pink-900/30 mb-2">
          <p class="text-[11px] text-pink-300 font-semibold mb-1">💡 썸네일 기획 컨셉</p>
          <p id="thumbnailConceptText" class="text-xs text-slate-200 leading-relaxed">${escHtml(data.thumbnailConcept || '')}</p>
        </div>

        <div class="bg-slate-800/70 rounded-lg p-3 border border-slate-700/60 mb-2">
          <div class="flex justify-between items-center mb-1">
            <p class="text-[10px] text-pink-400 font-bold">🖼️ 썸네일 AI 프롬프트 (영어)</p>
            <span class="text-[10px] text-slate-400">직접 수정 가능</span>
          </div>
          <textarea id="thumbnailImagePromptText" rows="2"
            class="w-full bg-slate-900/90 border border-slate-700 rounded p-2 text-[11px] text-slate-300 focus:outline-none focus:border-pink-500 leading-relaxed">${escHtml(data.thumbnailImagePrompt || '')}</textarea>
        </div>

        <!-- 썸네일 로딩 스피너 -->
        <div id="thumbnailSpinner" class="hidden flex items-center gap-2 p-3 bg-pink-950/30 border border-pink-900/50 rounded-lg mt-3">
          <div class="spinner" style="width:18px;height:18px;border-width:2px;border-top-color:#ec4899"></div>
          <span id="thumbnailSpinnerText" class="text-xs text-pink-300 font-medium">AI 썸네일 생성 중입니다… (잠시만 기다려주세요)</span>
        </div>

        <!-- 생성된 썸네일 결과 -->
        <div id="thumbnailResult" class="hidden mt-3 space-y-2 bg-slate-900/90 p-3 rounded-xl border border-pink-800/40">
          <div class="relative group overflow-hidden rounded-lg border border-pink-800/60 shadow-xl aspect-video bg-black flex items-center justify-center">
            <img id="thumbnailImg" class="w-full h-full object-cover" alt="생성된 썸네일" />
            <div class="absolute bottom-2 right-2 bg-black/75 backdrop-blur-sm text-[10px] text-pink-200 px-2 py-0.5 rounded font-mono border border-pink-900/50">
              1280 × 720 (16:9)
            </div>
          </div>
          <div class="flex gap-2 flex-wrap items-center justify-between pt-1">
            <div class="flex gap-2">
              <a id="thumbnailDl" download="thumbnail.jpg"
                class="text-xs bg-pink-600 hover:bg-pink-500 text-white font-bold px-3 py-1.5 rounded-lg transition flex items-center gap-1 shadow">
                ⬇ 썸네일 다운로드 (1280×720)
              </a>
              <button onclick="generateThumbnailFromConcept()"
                class="text-xs bg-slate-700 hover:bg-slate-600 text-pink-300 font-bold px-3 py-1.5 rounded-lg transition flex items-center gap-1 border border-slate-600">
                🔄 재생성
              </button>
            </div>
            <p id="thumbnailStatus" class="text-[11px] text-slate-300 font-medium"></p>
          </div>
        </div>
      </div>

      <!-- 오프닝 훅 -->
      <div class="script-section">
        <h4 class="text-green-300">🎬 오프닝 훅 (첫 15~30초)</h4>
        <p class="text-slate-300 whitespace-pre-line">${escHtml(data.openingHook)}</p>
      </div>

      <!-- 챕터 목차 -->
      <div>
        <h4 class="text-sm font-bold text-slate-300 mb-3">📋 챕터별 대본</h4>
        ${chapters}
      </div>

      <!-- 클로징 -->
      <div class="script-section">
        <h4 class="text-blue-300">🔚 클로징 &amp; CTA</h4>
        <p class="text-slate-300 whitespace-pre-line">${escHtml(data.closing)}</p>
      </div>

      <!-- 제작 팁 -->
      <div class="script-section">
        <h4 class="text-orange-300">💡 제작 팁</h4>
        <ul class="space-y-1.5">${tips}</ul>
      </div>

      <!-- 이미지 스크립트 생성 버튼 -->
      <button id="imgScriptGenBtn" class="w-full mt-2 bg-gradient-to-r from-violet-700 to-purple-700 hover:from-violet-600 hover:to-purple-600
               text-white text-sm font-bold py-3 rounded-xl transition flex items-center justify-center gap-2">
        🖼️ 이 대본으로 이미지 스크립트 생성
      </button>`;
    // 버튼 직접 바인딩 (innerHTML 설정 후 즉시)
    document.getElementById('imgScriptGenBtn').addEventListener('click', openScriptImgChat);
  }

  window.backToAnalysis = () => {
    if (_cachedAnalysis) renderStage1(_cachedAnalysis, _cachedVideoTitle);
  };

  // ─── 썸네일 이미지 생성 ──────────────────────────────
  window.generateThumbnailFromConcept = async () => {
    const promptInput = document.getElementById('thumbnailImagePromptText');
    const conceptEl   = document.getElementById('thumbnailConceptText');
    const spinner     = document.getElementById('thumbnailSpinner');
    const spinnerText = document.getElementById('thumbnailSpinnerText');
    const result      = document.getElementById('thumbnailResult');
    const statusEl    = document.getElementById('thumbnailStatus');
    const genBtn      = document.getElementById('thumbnailGenBtn');

    let imagePrompt = promptInput?.value.trim()
                   || promptInput?.textContent.trim()
                   || _cachedOutline?.thumbnailImagePrompt?.trim()
                   || '';

    const concept = conceptEl?.textContent.trim() || _cachedOutline?.thumbnailConcept || '';

    if (spinner) spinner.classList.remove('hidden');
    if (result)  result.classList.add('hidden');
    if (genBtn)  genBtn.disabled = true;

    try {
      if (!imagePrompt) {
        if (!concept) throw new Error('썸네일 컨셉이 없습니다. 대본을 먼저 생성해주세요.');
        if (spinnerText) spinnerText.textContent = '🌏 썸네일 영문 프롬프트 생성 중…';
        imagePrompt = await callGemini(
          `Convert this YouTube thumbnail concept to an English AI image generation prompt for a viral YouTube thumbnail. Output ONLY the English prompt (max 150 words), no markdown, no Korean explanation.\nThumbnail concept: ${concept}`
        );
        imagePrompt = imagePrompt.replace(/^```[a-z]*\n?|```$/gm, '').trim();
        if (promptInput) {
          if ('value' in promptInput) promptInput.value = imagePrompt;
          else promptInput.textContent = imagePrompt;
        }
      }

      if (spinnerText) spinnerText.textContent = `🎨 AI 썸네일 이미지 생성 중… (${_currentThumbnailEngine})`;

      let rawSrc = null;
      let usedEngineName = '';

      // 프롬프트에 썸네일 품질 키워드 및 텍스트 제외 규칙 적용
      let finalPrompt = window.applyNoText ? window.applyNoText(imagePrompt) : imagePrompt;
      if (!finalPrompt.toLowerCase().includes('thumbnail')) {
        finalPrompt += ', YouTube thumbnail style, high contrast, vivid lighting, eye-catching composition';
      }

      const cfgRes = await fetch('/api/config').catch(() => ({ json: () => ({}) }));
      const cfg    = await cfgRes.json().catch(() => ({}));
      const geminiKey = document.getElementById('geminiApiKey')?.value.trim() || cfg.GEMINI_API_KEY || '';

      if (_currentThumbnailEngine === 'comfyui') {
        try {
          if (spinnerText) spinnerText.textContent = '⚙️ ComfyUI (로컬 AI)로 썸네일 생성 중…';
          rawSrc = await generateComfyUIImage(finalPrompt, {
            width: 768,
            height: 448,
            steps: 20,
            cfg: 7.0,
            negative_prompt: window.NO_TEXT_NEGATIVE || 'text, watermark, blurry, ugly, low quality, distorted, extra limbs',
            onProgress: (status) => {
              if (spinnerText) spinnerText.textContent = status;
            }
          });
          if (rawSrc) {
            usedEngineName = 'ComfyUI (로컬 AI)';
          }
        } catch (err) {
          console.warn('ComfyUI thumbnail generation error:', err);
          if (spinnerText) spinnerText.textContent = `⚠️ ComfyUI 오류 (${err.message}) → 🌸 Pollinations로 자동 폴백…`;
        }
      }

      if (!rawSrc && _currentThumbnailEngine === 'stability' && (cfg.STABILITY_API_KEY || STABILITY_API_KEY)) {
        try {
          const res = await fetch('/api/proxy/stability-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: finalPrompt,
              negative_prompt: window.NO_TEXT_NEGATIVE || 'text, watermark, blurry',
              model: 'sd3.5-large',
              aspect_ratio: '16:9'
            })
          });
          const data = await res.json();
          if (res.ok && data.image) {
            rawSrc = 'data:image/png;base64,' + data.image;
            usedEngineName = 'Stable Diffusion (SD3.5)';
          } else {
            console.warn('Stability image failed, falling back to Pollinations:', data.error || data.errors);
          }
        } catch (err) {
          console.warn('Stability request error:', err);
        }
      }

      if (!rawSrc && _currentThumbnailEngine === 'imagen' && geminiKey) {
        try {
          const res = await fetch('/api/proxy/gemini-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: finalPrompt,
              width: 1280,
              height: 720,
              geminiApiKey: geminiKey
            }),
          });
          const json = await res.json();
          const b64 = json.predictions?.[0]?.bytesBase64Encoded
                   || json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
                   || json.image;
          if (res.ok && b64) {
            rawSrc = `data:${json.mimeType || 'image/png'};base64,${b64}`;
            usedEngineName = 'Gemini Imagen';
          } else {
            console.warn('Gemini Imagen failed, falling back to Pollinations:', json.error);
          }
        } catch (err) {
          console.warn('Gemini Imagen request error:', err);
        }
      }

      // Default / Fallback: Pollinations.ai (Flux)
      if (!rawSrc) {
        if (spinnerText) spinnerText.textContent = '🌸 Pollinations(고화질 Flux)로 썸네일 생성 중…';
        const res = await fetch('/api/proxy/pollinations-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: finalPrompt,
            width: 1280,
            height: 720,
            model: 'flux'
          })
        });
        const data = await res.json();
        const b64 = data.image || data.predictions?.[0]?.bytesBase64Encoded;
        if (res.ok && b64) {
          rawSrc = 'data:image/jpeg;base64,' + b64;
          usedEngineName = _currentThumbnailEngine === 'pollinations' ? 'Pollinations (Flux)' : 'Pollinations (자동 폴백)';
        } else {
          throw new Error(data.error || '이미지 생성 서버 응답 실패');
        }
      }

      const imgEl  = document.getElementById('thumbnailImg');
      const dlEl   = document.getElementById('thumbnailDl');
      if (imgEl) imgEl.src = rawSrc;
      if (dlEl) {
        dlEl.href = rawSrc;
        const topicSlug = (_cachedOutlineKeyword || 'youtube').replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
        dlEl.download = `thumbnail_${topicSlug}.jpg`;
      }
      if (statusEl) {
        statusEl.textContent = `✅ ${usedEngineName}으로 썸네일 생성 완료!`;
      }
      if (result) result.classList.remove('hidden');

    } catch (e) {
      if (statusEl) statusEl.textContent = '❌ 오류: ' + (e.message || String(e));
      if (result)  result.classList.remove('hidden');
    } finally {
      if (spinner) spinner.classList.add('hidden');
      if (genBtn)  genBtn.disabled = false;
    }
  };

  // ─── 댓글 분석 버튼 이벤트 위임 ────────────────────
  document.getElementById('results').addEventListener('click', e => {
    const btn = e.target.closest('.comment-analysis-btn');
    if (!btn) return;
    const videoId = btn.dataset.videoId;
    const title   = btn.dataset.videoTitle;
    window.startCommentAnalysis(videoId, title);
  });

  // ─── 모달 제어 ──────────────────────────────────
  window.closeModal = () => {
    document.getElementById('modal').classList.add('hidden');
    _selectedTopicIdx = -1;
  };
  document.getElementById('modal').addEventListener('click', e => {
    if (e.target === document.getElementById('modal')) closeModal();
  });

  // ─── 유틸 ────────────────────────────────────────
  async function apiFetch(url) {
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // formType 값 → [최소초, 최대초] (null = 제한 없음)
  function getDurationRange(formType) {
    const map = {
      'short': [null, 180],
      '3-5':   [180,  300],
      '5-7':   [300,  420],
      '7-9':   [420,  540],
      '9-11':  [540,  660],
      '11-13': [660,  780],
      '13-15': [780,  900],
      '15+':   [900,  null],
    };
    return map[formType] ?? [null, null];
  }

  function fmt(n) {
    if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + '억';
    if (n >= 10_000)      return (n / 10_000).toFixed(1) + '만';
    if (n >= 1_000)       return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }

  function escHtml(s = '') {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escJs(s = '') {
    return String(s).replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$/g,'\\$');
  }

  function setSearchLoading(on) {
    document.getElementById('searchBtn').disabled = on;
    document.getElementById('searchBtnText').textContent = on ? '검색 중...' : '검색';
    document.getElementById('searchSpinner').classList.toggle('hidden', !on);
  }

  function showError(msg) {
    document.getElementById('results').innerHTML =
      `<div class="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-xl p-4">${escHtml(msg)}</div>`;
  }

  // ────────────────────────────────────────────────────────
  // 채팅 위젯 초기화 (DOM 준비 후 실행)
  // ────────────────────────────────────────────────────────
  // ── 공통 버블 헬퍼 ────────────────────────────────
  let _bid = 0;
  function chatBubble(containerId, role, text) {
    const id  = 'b' + (++_bid);
    const el  = document.createElement('div');
    el.id        = id;
    el.className = role === 'user' ? 'chat-bubble-user' : 'chat-bubble-ai';
    el.textContent = text;
    const box = document.getElementById(containerId);
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return id;
  }
  function chatUpdateBubble(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.parentElement?.scrollTo({ top: 99999, behavior: 'smooth' });
  }
  async function geminiChat(systemPrompt, history, retries = 3) {
    const body = JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: history
    });
    const useProxy = window.location.protocol === 'http:' || window.location.hostname === 'localhost';

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        let res;
        if (useProxy) {
          res = await fetch('/api/proxy/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
          });
        } else {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
          res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const errMsg = err?.error?.message || `HTTP ${res.status}`;
          if (res.status === 429 && attempt < retries - 1) {
            console.warn(`geminiChat 429 rate limit hit, retrying in ${(attempt + 1) * 2}s...`);
            await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
            continue;
          }
          throw new Error(errMsg);
        }
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '응답 없음';
      } catch (e) {
        if (attempt >= retries - 1) throw e;
        await new Promise(r => setTimeout(r, (attempt + 1) * 1500));
      }
    }
  }

  // ── 🖼️ 이미지 스크립트 채팅 ───────────────────────
  const SCRIPT_IMG_PROMPT = `당신은 유튜브 영상 대본을 챕터별 이미지 스크립트로 변환하는 전문가입니다.

⚠️⚠️⚠️ 최우선 규칙 ⚠️⚠️⚠️
대본에 챕터가 N개 있으면 반드시 N개의 📌 블록을 출력해야 합니다!
절대로 챕터를 합치거나 생략하지 마세요. 3개 이하로 줄이면 안 됩니다!

각 챕터 출력 형식 (이 형식을 챕터 수만큼 반복):
📌 챕터 N. 챕터 제목
🎥 컷 묘사: 화면에 보여줄 장면을 구체적으로 묘사 (한 줄)
🖼️ AI 프롬프트 (영어): [영어 프롬프트 한 줄, 줄바꿈 금지, 반드시 Korean Asian person 포함]
📹 촬영/편집 방향: B-roll, 텍스트 오버레이, 효과 등 (한 줄)

⚠️ 반드시 지켜야 할 규칙:
- 대본의 모든 챕터를 빠짐없이 처리 (절대 생략 금지!)
- 최소 6개 이상의 📌 블록 생성 필수
- 챕터 블록 사이에만 빈 줄 1개 허용
- 절대로 ** 마크다운 볼드 사용 금지
- 🖼️ AI 프롬프트는 반드시 한 줄로 작성 (줄바꿈 금지)

【AI 프롬프트 작성 규칙 — 한국인 중심 이미지】
- 반드시 영어로만 작성
- 주제 + 스타일 + 구도 + 조명 + 분위기를 모두 포함 (40~80 단어 권장)
- 스타일: photorealistic, cinematic, 4K, dramatic lighting
- ⭐ 인물 표현 필수 규칙 (매우 중요!):
  · 모든 인물은 반드시 "Korean Asian"을 앞에 붙일 것
  · 예시: "Korean Asian businessman", "Korean Asian woman professional", "Korean Asian student"
  · 서양 배경(뉴욕, 할리우드 등)이 명시된 경우에만 Western 사용
- 금지: 저작권 캐릭터, 유명인 이름 직접 언급, 갈등·폭력·부정적 표현

추가로 마지막에 썸네일용 AI 프롬프트 1개를 별도로 제안하세요.`;

  let sibHistory = [];

  function openScriptImgChat() {
    if (!_cachedOutline) { alert('먼저 대본을 생성해주세요.'); return; }
    document.getElementById('scriptImgChatWindow').classList.remove('hidden');
    document.getElementById('scriptImgBadge').style.display = 'none';
    document.getElementById('scriptImgChatSubtitle').textContent = `주제: ${_cachedOutlineKeyword}`;
    if (sibHistory.length === 0) {
      const txt = buildScriptText(_cachedOutline);
      const msg = `다음 대본으로 챕터별 이미지 스크립트를 생성해주세요.\n\n${txt}`;
      chatBubble('scriptImgChatMessages', 'user', msg);
      sibHistory.push({ role: 'user', parts: [{ text: msg }] });
      sendSib();
    }
  }

  async function sendSib() {
    const btn = document.getElementById('scriptImgChatSendBtn');
    btn.disabled = true; btn.textContent = '…';
    const tid = chatBubble('scriptImgChatMessages', 'ai', '생성 중...');
    try {
      const reply = await geminiChat(SCRIPT_IMG_PROMPT, sibHistory);
      sibHistory.push({ role: 'model', parts: [{ text: reply }] });
      chatUpdateBubble(tid, reply);
    } catch (e) { chatUpdateBubble(tid, '오류: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '전송'; }
  }

  function buildScriptText(o) {
    const l = [];
    if (o.titleCandidates?.length) l.push(`[제목 후보]\n${o.titleCandidates.join(' / ')}`);
    if (o.thumbnailConcept)        l.push(`[썸네일 컨셉]\n${o.thumbnailConcept}`);
    if (o.openingHook)             l.push(`[오프닝 훅]\n${o.openingHook}`);
    (o.chapters||[]).forEach(c => l.push(`[챕터 ${c.no}. ${c.title}]\n${(c.points||[]).join(', ')}\n${c.script||''}`));
    if (o.closing) l.push(`[클로징]\n${o.closing}`);
    return l.join('\n\n');
  }

  function closeAllPanels(except) {
    const openIds   = ['ytApiChatWindow','ytChatWindow','subtitleRenderWindow','grokVideoWindow','ttsWindow'];
    const hiddenIds = ['scriptImgChatWindow','vrewModal'];
    openIds.filter(id => id !== except).forEach(id => document.getElementById(id)?.classList.remove('open'));
    hiddenIds.filter(id => id !== except).forEach(id => document.getElementById(id)?.classList.add('hidden'));
  }
  window.closeAllPanels = closeAllPanels;

  document.getElementById('scriptImgChatToggle').addEventListener('click', () => {
    const win = document.getElementById('scriptImgChatWindow');
    if (win.classList.contains('hidden')) {
      closeAllPanels('scriptImgChatWindow');
      if (_cachedOutline && sibHistory.length === 0) openScriptImgChat();
      else win.classList.remove('hidden');
    } else {
      win.classList.add('hidden');
    }
  });
  document.getElementById('scriptImgChatCloseBtn').addEventListener('click', () => {
    document.getElementById('scriptImgChatWindow').classList.add('hidden');
  });
  document.getElementById('scriptImgChatSendBtn').addEventListener('click', () => {
    const input = document.getElementById('scriptImgChatInput');
    const text  = input.value.trim(); if (!text) return;
    input.value = '';
    chatBubble('scriptImgChatMessages', 'user', text);
    sibHistory.push({ role: 'user', parts: [{ text }] });
    sendSib();
  });
  document.getElementById('scriptImgChatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('scriptImgChatSendBtn').click(); }
  });

  // ── 🎬 YouTube Creator AI 채팅 ──────────────────────
  let ytHistory = [];
  let ytSystemPrompt = '';

  const YT_GENERAL_PROMPT = `당신은 전문적인 YouTube 채널 성장 전문가이자 콘텐츠 크리에이터 AI 어시스턴트입니다.
채널 전략, SEO, 대본 작성, 썸네일 기획, 쇼츠 최적화, 수익화, 경쟁사 분석 등 유튜브 관련 모든 주제를 깊이 있게 도와드립니다.
구체적이고 실행 가능한 조언을 제공하며, 데이터와 알고리즘 원리에 기반한 전략을 제시합니다.
한국어로 답변하세요. 마크다운 형식을 활용하여 명확하게 구조화된 답변을 작성하세요.`;

  const YT_SKILL_GREETINGS = {
    '':          '안녕하세요! YouTube 채널 성장을 도와드리는 AI입니다. 위에서 스킬을 선택하거나 자유롭게 질문하세요! 🎬',
    ideate:      '영상 아이디어 발굴 모드입니다. 채널 니치와 구독자 규모를 알려주시면 검색 수요 기반의 아이디어 10개를 생성합니다! 💡',
    script:      '대본 작성 모드입니다. 영상 주제, 목표 길이(분), 채널 유형, 핵심 포인트를 알려주세요! 📝',
    hook:        '훅 작성 모드입니다. 영상 주제와 채널 니치를 알려주시면 5가지 심리 메커니즘의 30초 훅 변형을 작성합니다! 🎣',
    seo:         'SEO 최적화 모드입니다. 타겟 키워드, 채널 니치, 영상 내용 요약을 알려주세요! 🔍',
    thumbnail:   '썸네일 기획 모드입니다. 영상 주제와 채널 유형을 알려주시면 CTR 최적화된 썸네일 brief를 만듭니다! 🖼',
    strategy:    '채널 전략 모드입니다. 채널 현황(구독자·영상 수·월간 조회수)과 목표를 알려주세요! 🗺',
    calendar:    '콘텐츠 캘린더 모드입니다. 채널 니치와 업로드 빈도 목표를 알려주시면 월간 계획을 세워드립니다! 📅',
    audit:       '채널 감사 모드입니다. 채널 URL/핸들, 니치, 구독자 규모, 주요 목표를 알려주세요! 🏥',
    shorts:      '쇼츠 최적화 모드입니다. 채널 니치와 현재 쇼츠 활용 현황을 알려주세요! 📱',
    analyze:     '채널 분석 모드입니다. 분석하고 싶은 지표나 문제 상황을 알려주세요! 📊',
    monetize:    '수익화 전략 모드입니다. 채널 규모, 니치, 현재 수익원을 알려주시면 7가지 수익 스트림 전략을 안내합니다! 💰',
    competitor:  '경쟁사 분석 모드입니다. 분석할 채널 URL이나 @핸들을 알려주세요! 🕵',
    repurpose:   '콘텐츠 재가공 모드입니다. 재가공할 영상 주제와 목표 플랫폼을 알려주세요! ♻',
    metadata:    '메타데이터 최적화 모드입니다. 영상 주제, 채널 니치, 내용 요약을 알려주세요! 🏷',
  };

  async function loadYtSkill(skillName) {
    if (!skillName) { ytSystemPrompt = YT_GENERAL_PROMPT; return YT_SKILL_GREETINGS['']; }
    try {
      const res = await fetch(`/api/skill/${skillName}`);
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      ytSystemPrompt = data.content +
        '\n\n한국어로 답변하세요. 마크다운 형식을 활용하여 명확하게 구조화된 답변을 작성하세요.';
      return YT_SKILL_GREETINGS[skillName] || `${skillName} 스킬이 활성화되었습니다!`;
    } catch(e) {
      ytSystemPrompt = YT_GENERAL_PROMPT;
      return '스킬 로드 실패, 일반 모드로 시작합니다.';
    }
  }

  async function sendYtChat() {
    const input = document.getElementById('ytChatInput');
    const text = input.value.trim(); if (!text) return;
    input.value = '';
    chatBubble('ytChatMessages', 'user', text);
    ytHistory.push({ role: 'user', parts: [{ text }] });
    const btn = document.getElementById('ytChatSendBtn');
    btn.disabled = true; btn.textContent = '…';
    const tid = chatBubble('ytChatMessages', 'ai', '분석 중...');
    try {
      const reply = await geminiChat(ytSystemPrompt || YT_GENERAL_PROMPT, ytHistory);
      ytHistory.push({ role: 'model', parts: [{ text: reply }] });
      chatUpdateBubble(tid, reply);
    } catch(e) { chatUpdateBubble(tid, '오류: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '전송'; }
  }

  // ── ▶️ YouTube Skills (TranscriptAPI) 채팅 ──────────
  let ytApiHistory     = [];
  let ytApiSystemPrompt = '';

  const YT_API_GENERAL_PROMPT = `당신은 YouTube 데이터 조회 AI 어시스턴트입니다. TranscriptAPI.com을 통해 YouTube 영상 트랜스크립트, 검색, 채널 정보, 플레이리스트를 조회합니다.

데이터를 조회해야 할 때는 응답 맨 앞에 반드시 다음 형식으로 API 호출을 명시하세요:
<ACTION>{"endpoint": "/api/v2/youtube/...", "params": {"파라미터": "값"}}</ACTION>

사용 가능한 엔드포인트:
- /api/v2/youtube/transcript → params: video_url(필수), format(text/json), include_timestamp(true), send_metadata(true)
- /api/v2/youtube/search → params: q(필수), type(video/channel), limit(1-50)
- /api/v2/youtube/channel/search → params: channel(필수,@handle/URL/ID), q(필수), limit(1-50)
- /api/v2/youtube/channel/resolve → params: input(필수) [무료, 크레딧 불필요]
- /api/v2/youtube/channel/latest → params: channel(필수) [무료, 크레딧 불필요]
- /api/v2/youtube/channel/videos → params: channel(@handle/URL/ID) 또는 continuation(다음 페이지 토큰)
- /api/v2/youtube/playlist/videos → params: playlist(URL/ID) 또는 continuation(다음 페이지 토큰)

한국어로 답변하세요. 마크다운 형식으로 구조화된 답변을 제공하세요.`;

  const YT_API_SKILL_GREETINGS = {
    '':               '안녕하세요! YouTube 데이터 조회 AI입니다 ▶️\n\n예시:\n• 유튜브 링크 붙여넣기 → 트랜스크립트 자동 추출\n• "AI 관련 영상 검색해줘"\n• "@TED 최신 영상 보여줘"\n• 플레이리스트 URL → 전체 목록 조회',
    'transcript':     '트랜스크립트 모드입니다 📄\nYouTube 영상 URL이나 영상 ID를 입력하면 자막을 가져옵니다.\n\n예: https://youtube.com/watch?v=dQw4w9WgXcQ',
    'youtube-search': '검색 모드입니다 🔍\n키워드로 YouTube 영상/채널을 검색합니다.\n\n예: "파이썬 머신러닝 강의 10개 찾아줘"',
    'youtube-channels':'채널 모드입니다 📺\n@핸들이나 채널 URL로 최신 영상, 전체 목록을 불러옵니다.\n\n예: "@TED 최신 영상 목록 보여줘"',
    'youtube-playlist':'플레이리스트 모드입니다 📋\nURL이나 ID로 플레이리스트 전체 영상 목록을 가져옵니다.\n\n예: https://youtube.com/playlist?list=PL...',
  };

  function fmtTime(secs) {
    const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatTranscriptApiResult(endpoint, data) {
    const lines = [];
    if (endpoint.includes('/transcript')) {
      const meta = data.metadata || {};
      lines.push(`📄 트랜스크립트: ${meta.title || data.video_id || ''}`);
      if (meta.author_name) lines.push(`채널: ${meta.author_name}`);
      lines.push('─'.repeat(32));
      const t = data.transcript;
      if (typeof t === 'string') {
        lines.push(t.length > 2500 ? t.slice(0, 2500) + '\n...(이하 생략)' : t);
      } else if (Array.isArray(t)) {
        t.slice(0, 60).forEach(s => {
          const ts = s.start != null ? `[${fmtTime(s.start)}] ` : '';
          lines.push(ts + (s.text || ''));
        });
        if (t.length > 60) lines.push(`...(${t.length - 60}개 더 있음)`);
      }
    } else if (endpoint.includes('/search')) {
      const results = data.results || [];
      lines.push(`🔍 검색 결과 ${results.length}개`);
      lines.push('─'.repeat(32));
      results.slice(0, 12).forEach((r, i) => {
        if (r.type === 'channel') {
          lines.push(`${i+1}. 📺 ${r.title}  ${r.handle || ''}  ${r.subscriberCount || ''}`);
          lines.push(`   ${r.url || ''}`);
        } else {
          lines.push(`${i+1}. ${r.title}`);
          lines.push(`   ${r.channelTitle || ''} | ${r.viewCountText || ''} | ${r.publishedTimeText || ''}`);
          lines.push(`   https://youtu.be/${r.videoId}`);
        }
      });
      if (results.length > 12) lines.push(`... 외 ${results.length - 12}개`);
    } else if (endpoint.includes('/channel/latest')) {
      const ch = data.channel || {};
      const results = data.results || [];
      lines.push(`📺 최신 동영상: ${ch.title || ''} (${results.length}개)`);
      lines.push('─'.repeat(32));
      results.forEach((r, i) => {
        const date = (r.published || '').slice(0, 10);
        const views = Number(r.viewCount || 0).toLocaleString();
        lines.push(`${i+1}. ${r.title}`);
        lines.push(`   조회수 ${views} | ${date}`);
        lines.push(`   ${r.link || ''}`);
      });
    } else if (endpoint.includes('/channel/videos') || endpoint.includes('/channel/search')) {
      const results = data.results || [];
      const info = data.playlist_info || {};
      const total = info.numVideos ? ` / 전체 ${info.numVideos}개` : '';
      lines.push(`📺 채널 영상 (${results.length}개${total})`);
      if (info.ownerName) lines.push(`채널: ${info.ownerName}`);
      lines.push('─'.repeat(32));
      results.slice(0, 15).forEach((r, i) => {
        lines.push(`${i+1}. ${r.title}`);
        lines.push(`   ${r.viewCountText || ''} | ${r.lengthText || ''}`);
        lines.push(`   https://youtu.be/${r.videoId}`);
      });
      if (data.has_more) lines.push('\n▶ 다음 페이지 있음 (continuation_token 사용)');
    } else if (endpoint.includes('/playlist')) {
      const results = data.results || [];
      const info = data.playlist_info || {};
      const total = info.numVideos ? ` / 전체 ${info.numVideos}개` : '';
      lines.push(`📋 플레이리스트: ${info.title || ''} (${results.length}개${total})`);
      if (info.ownerName) lines.push(`소유자: ${info.ownerName}`);
      lines.push('─'.repeat(32));
      results.slice(0, 15).forEach((r, i) => {
        lines.push(`${i+1}. ${r.title}`);
        lines.push(`   ${r.viewCountText || ''} | ${r.lengthText || ''}`);
        lines.push(`   https://youtu.be/${r.videoId}`);
      });
      if (data.has_more) lines.push('\n▶ 다음 페이지 있음');
    } else if (endpoint.includes('/channel/resolve')) {
      lines.push(`✅ 채널 ID: ${data.channel_id || '알 수 없음'}`);
      if (data.resolved_from) lines.push(`입력값: ${data.resolved_from}`);
    } else {
      lines.push(JSON.stringify(data, null, 2).slice(0, 1000));
    }
    return lines.join('\n');
  }

  async function loadYtApiSkill(skillName) {
    if (!skillName) {
      ytApiSystemPrompt = YT_API_GENERAL_PROMPT;
      return YT_API_SKILL_GREETINGS[''];
    }
    try {
      const res = await fetch(`/api/yt-skill/${skillName}`);
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      ytApiSystemPrompt = data.content +
        '\n\n=== 중요 ===\n데이터를 조회해야 할 때는 응답 맨 앞에 반드시 다음 형식으로 API 호출을 명시하세요:\n<ACTION>{"endpoint": "/api/v2/youtube/...", "params": {"파라미터": "값"}}</ACTION>\n한국어로 답변하세요.';
      return YT_API_SKILL_GREETINGS[skillName] || YT_API_SKILL_GREETINGS[''];
    } catch(e) {
      ytApiSystemPrompt = YT_API_GENERAL_PROMPT;
      return YT_API_SKILL_GREETINGS[''];
    }
  }

  async function sendYtApiChat() {
    const input = document.getElementById('ytApiChatInput');
    const text  = input.value.trim(); if (!text) return;
    input.value = '';
    chatBubble('ytApiChatMessages', 'user', text);
    ytApiHistory.push({ role: 'user', parts: [{ text }] });

    const btn = document.getElementById('ytApiChatSendBtn');
    btn.disabled = true; btn.textContent = '…';

    if (!TRANSCRIPT_API_KEY) {
      chatBubble('ytApiChatMessages', 'ai',
        '⚠️ TranscriptAPI 키가 설정되지 않았습니다.\n\n설정 방법:\n1. 위 "🔑 API 키 설정" 패널 열기\n2. TranscriptAPI 키 입력 (sk_...)\n3. 키 저장 클릭\n\n무료 가입: transcriptapi.com (카드 불필요, 100 크레딧 제공)');
      btn.disabled = false; btn.textContent = '전송';
      return;
    }

    const tid = chatBubble('ytApiChatMessages', 'ai', '분석 중...');
    try {
      const sysPrompt = ytApiSystemPrompt || YT_API_GENERAL_PROMPT;
      const reply = await geminiChat(sysPrompt, ytApiHistory);

      const actionMatch = reply.match(/<ACTION>([\s\S]*?)<\/ACTION>/);
      if (actionMatch) {
        let action;
        try { action = JSON.parse(actionMatch[1].trim()); }
        catch(e) { throw new Error('ACTION JSON 파싱 실패: ' + e.message); }

        chatUpdateBubble(tid, `🔄 ${action.endpoint} 호출 중...`);

        const apiRes = await fetch('/api/proxy/transcriptapi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action)
        });
        const apiData = await apiRes.json();

        if (!apiRes.ok) {
          const errMsg = apiData.detail || apiData.message || apiData.error || `HTTP ${apiRes.status}`;
          throw new Error(`API 오류: ${errMsg}`);
        }

        const formatted = formatTranscriptApiResult(action.endpoint, apiData);

        // 결과를 Gemini에게 분석 요청
        const analyzeHistory = [
          ...ytApiHistory.slice(-3),
          { role: 'model', parts: [{ text: reply }] },
          { role: 'user', parts: [{ text: `API 조회 결과:\n${JSON.stringify(apiData).slice(0, 4000)}\n\n위 데이터를 한국어로 간결하게 요약·분석해주세요.` }] }
        ];
        let analysis = '';
        try {
          analysis = await geminiChat(sysPrompt, analyzeHistory);
          ytApiHistory.push({ role: 'model', parts: [{ text: formatted + '\n\n' + analysis }] });
          chatUpdateBubble(tid, formatted + '\n\n' + analysis);
        } catch(_) {
          ytApiHistory.push({ role: 'model', parts: [{ text: formatted }] });
          chatUpdateBubble(tid, formatted);
        }

      } else {
        const cleanReply = reply.replace(/<ACTION>[\s\S]*?<\/ACTION>/g, '').trim();
        ytApiHistory.push({ role: 'model', parts: [{ text: cleanReply }] });
        chatUpdateBubble(tid, cleanReply);
      }
    } catch(e) {
      chatUpdateBubble(tid, '오류: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = '전송';
    }
  }

  function initYtApiChatBindings() {
    const toggle = document.getElementById('ytApiChatToggle');
    if (!toggle) return;

    toggle.addEventListener('click', () => {
      const win    = document.getElementById('ytApiChatWindow');
      const willOpen = !win.classList.contains('open');
      if (willOpen) closeAllPanels('ytApiChatWindow');
      const isOpen = win.classList.toggle('open');
      if (isOpen && ytApiHistory.length === 0) {
        if (!ytApiSystemPrompt) ytApiSystemPrompt = YT_API_GENERAL_PROMPT;
        chatBubble('ytApiChatMessages', 'ai', YT_API_SKILL_GREETINGS['']);
      }
    });

    document.getElementById('ytApiChatCloseBtn').addEventListener('click', () => {
      document.getElementById('ytApiChatWindow').classList.remove('open');
    });

    document.getElementById('ytApiSkillBar').addEventListener('click', async e => {
      const pill = e.target.closest('.yt-api-skill-pill');
      if (!pill) return;
      document.querySelectorAll('.yt-api-skill-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const skillName = pill.dataset.skill;
      document.getElementById('ytApiChatSkillName').textContent =
        skillName ? pill.textContent.trim() + ' 스킬 활성화됨' : '일반 모드';
      ytApiHistory = [];
      document.getElementById('ytApiChatMessages').innerHTML = '';
      const tid = chatBubble('ytApiChatMessages', 'ai', skillName ? '스킬 로딩 중...' : YT_API_SKILL_GREETINGS['']);
      if (skillName) {
        const greeting = await loadYtApiSkill(skillName);
        chatUpdateBubble(tid, greeting);
      } else {
        loadYtApiSkill('');
      }
    });

    document.getElementById('ytApiChatSendBtn').addEventListener('click', sendYtApiChat);
    document.getElementById('ytApiChatInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendYtApiChat(); }
    });
  }

  if (document.readyState === 'loading') {
    initYtApiChatBindings();
  } else {
    initYtApiChatBindings();
  }

  // ytChat 이벤트 바인딩 — DOM이 완전히 준비된 후 실행 보장
  function initYtChatBindings() {
    const toggle = document.getElementById('ytChatToggle');
    if (!toggle) return;  // 이미 바인딩됐거나 요소 없으면 무시

    toggle.addEventListener('click', () => {
      const win = document.getElementById('ytChatWindow');
      const willOpen = !win.classList.contains('open');
      if (willOpen) closeAllPanels('ytChatWindow');
      const isOpen = win.classList.toggle('open');
      if (isOpen && ytHistory.length === 0) {
        if (!ytSystemPrompt) ytSystemPrompt = YT_GENERAL_PROMPT;
        chatBubble('ytChatMessages', 'ai', YT_SKILL_GREETINGS['']);
      }
    });

    document.getElementById('ytChatCloseBtn').addEventListener('click', () => {
      document.getElementById('ytChatWindow').classList.remove('open');
    });

    document.getElementById('ytSkillBar').addEventListener('click', async e => {
      const pill = e.target.closest('.yt-skill-pill');
      if (!pill) return;
      document.querySelectorAll('.yt-skill-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const skillName = pill.dataset.skill;
      document.getElementById('ytChatSkillName').textContent =
        skillName ? pill.textContent.trim() + ' 스킬 활성화됨' : '일반 모드';
      ytHistory = [];
      document.getElementById('ytChatMessages').innerHTML = '';
      const tid = chatBubble('ytChatMessages', 'ai', skillName ? '스킬 로딩 중...' : YT_SKILL_GREETINGS['']);
      if (skillName) {
        const greeting = await loadYtSkill(skillName);
        chatUpdateBubble(tid, greeting);
      } else {
        loadYtSkill('');
      }
    });

    document.getElementById('ytChatSendBtn').addEventListener('click', sendYtChat);
    document.getElementById('ytChatInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendYtChat(); }
    });
  }

  // 모듈 deferred 실행 + DOMContentLoaded 이중 보장
  if (document.readyState === 'loading') {
    initYtChatBindings();
  } else {
    initYtChatBindings();
  }

  // ── 🎞️ Subtitle Renderer Widget ─────────────────────
  const RENDER_URL = 'http://localhost:8766';
  let _renderSubs = [];
  let _renderTranslatedSubs = [];

  async function checkRenderServer() {
    try {
      const res = await fetch(`${RENDER_URL}/health`, {
        signal: AbortSignal.timeout(2000)
      });
      return res.ok;
    } catch { return false; }
  }

  function initSubtitleRenderWidget() {
    const toggle = document.getElementById('subtitleRenderToggle');
    if (!toggle) return;

    toggle.addEventListener('click', async () => {
      const win    = document.getElementById('subtitleRenderWindow');
      const willOpen = !win.classList.contains('open');
      if (willOpen) closeAllPanels('subtitleRenderWindow');
      const isOpen = win.classList.toggle('open');
      if (isOpen) {
        const statusEl = document.getElementById('renderServerStatus');
        statusEl.textContent = '서버 상태 확인 중...';
        statusEl.className   = 'text-[11px] text-slate-400';
        const ok = await checkRenderServer();
        statusEl.textContent = ok
          ? '✅ 렌더 서버 연결됨 (localhost:8766)'
          : '❌ 서버 오프라인 — cd remotion && npm start 필요';
        statusEl.className   = ok ? 'text-[11px] text-green-400' : 'text-[11px] text-red-400';
      }
    });

    document.getElementById('subtitleRenderCloseBtn').addEventListener('click', () => {
      document.getElementById('subtitleRenderWindow').classList.remove('open');
    });

    document.getElementById('translateToggle').addEventListener('change', function () {
      document.getElementById('translatePanel').classList.toggle('hidden', !this.checked);
    });

    document.getElementById('fetchSubsBtn').addEventListener('click', async () => {
      const ytUrl = document.getElementById('renderYtUrl').value.trim();
      if (!ytUrl) { alert('YouTube URL을 입력해주세요.'); return; }
      if (!TRANSCRIPT_API_KEY) { alert('TranscriptAPI 키를 먼저 설정해주세요.'); return; }

      const btn = document.getElementById('fetchSubsBtn');
      btn.disabled = true; btn.textContent = '로딩...';
      try {
        const res = await fetch('/api/proxy/transcriptapi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: '/api/v2/youtube/transcript',
            params: { video_url: ytUrl, format: 'json', include_timestamp: 'true', send_metadata: 'true' }
          })
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || `HTTP ${res.status}`); }
        const data = await res.json();
        _renderSubs = Array.isArray(data.transcript) ? data.transcript : [];
        _renderTranslatedSubs = [];
        if (!_renderSubs.length) throw new Error('자막이 없는 영상입니다.');

        // Auto-fill duration from last segment
        const lastSeg = _renderSubs[_renderSubs.length - 1];
        if (lastSeg) {
          document.getElementById('renderDuration').value =
            Math.ceil(lastSeg.start + (lastSeg.duration || 2));
        }

        document.getElementById('subsPreview').classList.remove('hidden');
        document.getElementById('subsCount').textContent =
          `✅ 자막 ${_renderSubs.length}개 로드됨` +
          (data.metadata?.title ? ` — ${data.metadata.title}` : '');
        document.getElementById('translateToggle').checked = false;
        document.getElementById('translatePanel').classList.add('hidden');
        document.getElementById('translateStatus').textContent = '';
        document.getElementById('translateStatus').classList.add('hidden');
      } catch (e) {
        alert('자막 가져오기 실패: ' + e.message);
      } finally {
        btn.disabled = false; btn.textContent = '자막 가져오기';
      }
    });

    document.getElementById('doTranslateBtn').addEventListener('click', async () => {
      if (!_renderSubs.length) { alert('먼저 자막을 가져오세요.'); return; }
      if (!GEMINI_API_KEY) { alert('Gemini API 키를 설정해주세요.'); return; }
      const targetLang = document.getElementById('translateLangSelect').value;
      const statusEl = document.getElementById('translateStatus');
      statusEl.textContent = `${targetLang}로 번역 중...`;
      statusEl.classList.remove('hidden');
      const btn = document.getElementById('doTranslateBtn');
      btn.disabled = true;
      try {
        const texts = _renderSubs.map(s => s.text).join('\n---SEP---\n');
        const prompt = `Translate the following subtitle lines into ${targetLang}. Lines are separated by ---SEP---. Output ONLY the translated lines keeping the same ---SEP--- separators, no other text.\n\n${texts}`;
        const result = await callGemini(prompt);
        const parts  = result.split('---SEP---').map(t => t.trim());
        _renderTranslatedSubs = _renderSubs.map((s, i) => ({ ...s, text: parts[i] || s.text }));
        statusEl.textContent = `✅ ${_renderTranslatedSubs.length}개 번역 완료 (${targetLang})`;
      } catch (e) {
        statusEl.textContent = '번역 실패: ' + e.message;
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('startRenderBtn').addEventListener('click', async () => {
      const videoSrc    = document.getElementById('renderVideoSrc').value.trim();
      const durationSec = parseFloat(document.getElementById('renderDuration').value);
      if (!videoSrc)    { alert('영상 경로 또는 URL을 입력해주세요.'); return; }
      if (!durationSec) { alert('영상 길이(초)를 입력해주세요.'); return; }
      if (!_renderSubs.length) { alert('먼저 자막을 가져오세요.'); return; }

      const btn      = document.getElementById('startRenderBtn');
      const spinner  = document.getElementById('renderSpinner');
      const txtEl    = document.getElementById('renderBtnText');
      const progress = document.getElementById('renderProgress');
      const progText = document.getElementById('renderProgressText');
      btn.disabled = true; spinner.classList.remove('hidden');
      txtEl.textContent = '렌더링 중...'; progress.classList.remove('hidden');
      progText.textContent = '렌더링 중... (영상 길이에 따라 수 분 소요)';
      progText.className = 'text-sm text-amber-300';

      try {
        const res = await fetch(`${RENDER_URL}/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoSrc,
            subtitles: _renderSubs,
            translatedSubtitles: _renderTranslatedSubs,
            durationInSeconds: durationSec,
          })
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error || `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `subtitled-${Date.now()}.mp4`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        progText.textContent = '✅ 렌더링 완료! MP4 다운로드 시작됨';
        progText.className   = 'text-sm text-green-400';
      } catch (e) {
        progText.textContent = '오류: ' + e.message;
        progText.className   = 'text-sm text-red-400';
      } finally {
        btn.disabled = false; spinner.classList.add('hidden');
        txtEl.textContent = '🎞️ 자막 렌더링 시작';
      }
    });
  }

  if (document.readyState === 'loading') {
    initSubtitleRenderWidget();
  } else {
    initSubtitleRenderWidget();
  }

  // ── 🎨 Gemini Imagen 이미지 생성 & 편집 ──────────────────────────────
  let _imageCards = [];
  window.__renderCardsForTest = (cards) => { _imageCards = cards; renderGrokModal(cards); document.getElementById('grokModal')?.classList.remove('hidden'); };   // TEMP TEST HOOK

  function parseCardsFromHistory() {
    const cards = [];
    const seen  = new Set();

    // 마크다운·특수 기호 정리 헬퍼
    const stripMd = s => (s || '')
      .replace(/\*\*/g, '').replace(/(?<!\*)\*(?!\*)/g, '')
      .replace(/^[\[【『「\s]+|[\]】』」\s]+$/gm, '')
      .trim();

    sibHistory.forEach(msg => {
      if (msg.role !== 'model') return;
      const raw  = msg.parts[0]?.text || '';
      // ** 마크다운 제거 후 파싱
      const text = raw.replace(/\*\*/g, '');

      // 챕터 단위로 분리 — 📌 앞 개행 기준
      const blocks = text.split(/\n(?=📌)/g);

      blocks.forEach(block => {
        if (!/📌/.test(block)) return;

        // 제목: 📌 챕터 N. 제목  (챕터 없이 장면 N도 허용)
        const titleM = block.match(/📌\s*(?:챕터|장면|Scene)?\s*\d+[\.．]?\s*(.+?)(?:\n|$)/i);

        // 컷 묘사: 🎥 이후 다음 이모지 섹션까지
        const cutM   = block.match(/🎥[^\n]*[:：]\s*([\s\S]+?)(?=\n🖼️|\n📹|\n📌|$)/);

        // AI 프롬프트: 🖼️ 이후 → 다음 이모지 섹션 또는 블록 끝
        // \n\n 을 터미네이터에서 제거해 멀티라인 프롬프트 허용
        const promptM = block.match(/🖼️[^\n]*[:：]\s*([\s\S]+?)(?=\n📹|\n📌|$)/);

        // 촬영/편집 방향: 📹 이후
        const dirM   = block.match(/📹[^\n]*[:：]\s*([\s\S]+?)(?=\n📌|$)/);

        const prompt = stripMd(promptM?.[1] || '');
        if (!prompt || prompt.length < 5 || seen.has(prompt)) return;
        seen.add(prompt);

        cards.push({
          chapterTitle:   stripMd(titleM?.[1]) || `장면 ${cards.length + 1}`,
          cutDescription: stripMd(cutM?.[1])   || '',
          prompt,
          direction:      stripMd(dirM?.[1])   || '',
          subtitles:      '',
        });
      });
    });
    return cards;
  }

  // ── 참조 캐릭터 관련 ──────────────────────────────────────────────
  let _refCharBase64 = '';    // base64 data URL
  let _refCharDescText = '';  // Gemini가 추출한 영문 캐릭터 묘사

  window.handleRefCharUpload = async (input) => {
    const file = input.files?.[0];
    if (!file) return;

    const statusEl = document.getElementById('refCharStatus');
    const previewEl = document.getElementById('refCharPreview');
    const imgEl = document.getElementById('refCharImg');
    const descEl = document.getElementById('refCharDesc');
    const clearBtn = document.getElementById('refCharClear');

    // Read file as base64
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
    _refCharBase64 = dataUrl;
    imgEl.src = dataUrl;
    previewEl.classList.remove('hidden');
    statusEl.textContent = '분석 중…';
    clearBtn.classList.remove('hidden');

    // Extract base64 bytes (strip data URL prefix)
    const b64 = dataUrl.split(',')[1];
    const mimeType = file.type || 'image/jpeg';

    try {
      // Use Gemini Vision to analyze the character
      const res = await fetch('/api/proxy/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: { mime_type: mimeType, data: b64 }
              },
              {
                text: 'Analyze this reference character image and write a concise English description (max 60 words) for an AI image generator. Include: gender, approximate age, hair color and style, skin tone, distinctive facial features, clothing style. Format as a comma-separated descriptor string starting with the most distinctive features. Do NOT include any copyright character names.'
              }
            ]
          }]
        }),
      });
      const data = await res.json();
      const desc = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      _refCharDescText = desc;
      descEl.textContent = desc || '(분석 실패)';
      statusEl.textContent = '✅ 참조 캐릭터 설정됨 — 모든 생성 프롬프트에 자동 적용';
    } catch (e) {
      statusEl.textContent = '분석 오류: ' + e.message;
      _refCharDescText = '';
    }
  };

  window.clearRefChar = () => {
    _refCharBase64 = '';
    _refCharDescText = '';
    document.getElementById('refCharStatus').textContent = '미설정';
    document.getElementById('refCharPreview').classList.add('hidden');
    document.getElementById('refCharClear').classList.add('hidden');
  };

  window.openGrokModal = () => {
    if (!GEMINI_API_KEY && !window.GEMINI_API_KEY) {
      alert('Gemini API 키를 먼저 설정해주세요.\n🔑 API 키 설정 → Gemini API 키 입력 → 키 저장');
      return;
    }
    let cards = (_imageCards && _imageCards.length > 0) ? _imageCards : parseCardsFromHistory();
    if (!cards.length) {
      alert('이미지 스크립트를 먼저 생성해주세요.\n🖼️ 버튼 → 대본으로 이미지 스크립트 생성 후 사용 가능합니다.');
      return;
    }
    _imageCards = cards;
    window._imageCards = cards;
    _seqIdx = -1;
    renderGrokModal(cards);
    if (window.renderStylePresets) window.renderStylePresets();
    if (window.setImageModel) window.setImageModel(IMAGE_MODEL || 'comfyui');
    if (window.updateSubtitleToggleUI) window.updateSubtitleToggleUI();
    document.getElementById('seqNavBar')?.classList.add('hidden');
    document.getElementById('grokModal').classList.remove('hidden');
  };

  window.closeGrokModal = () => {
    document.getElementById('grokModal').classList.add('hidden');
  };

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeGrokModal();
  });

  function renderGrokModal(cards) {
    document.getElementById('grokModalBody').innerHTML = `
      <!-- 참조 캐릭터 업로드 패널 -->
      <div class="mb-4 p-3 bg-slate-800/60 border border-slate-700 rounded-xl">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-[11px] font-bold text-purple-300">👤 참조 캐릭터</span>
          <label class="cursor-pointer bg-purple-800 hover:bg-purple-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition whitespace-nowrap">
            📁 이미지 업로드
            <input type="file" accept="image/*" class="hidden" onchange="handleRefCharUpload(this)">
          </label>
          <span id="refCharStatus" class="text-[11px] text-slate-400">미설정 — 모든 장면에 동일한 캐릭터를 일관되게 적용하려면 참조 이미지를 업로드하세요</span>
          <button id="refCharClear" onclick="clearRefChar()" class="hidden text-[10px] text-red-400 hover:text-red-300 underline ml-auto">지우기</button>
        </div>
        <div id="refCharPreview" class="hidden mt-2 flex gap-3 items-start">
          <img id="refCharImg" class="w-16 h-16 object-cover rounded-lg border border-purple-600/50" />
          <div class="flex-1">
            <p class="text-[10px] font-semibold text-purple-300 mb-1">추출된 캐릭터 설명 (모든 프롬프트에 자동 첨부)</p>
            <p id="refCharDesc" class="text-[10px] text-slate-300 leading-relaxed break-words"></p>
          </div>
        </div>
      </div>

      <!-- ── 워크플로우 단계 표시 ── -->
      <div class="mb-4 p-3 bg-slate-900/80 border border-slate-700 rounded-xl text-[11px] text-slate-400">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-bold text-slate-300">제작 순서:</span>
          <span class="bg-violet-900/60 text-violet-300 px-2 py-0.5 rounded font-semibold">① AI 자동 채우기</span>
          <span class="text-slate-600">→</span>
          <span class="bg-blue-900/60 text-blue-300 px-2 py-0.5 rounded font-semibold">② 이미지 생성</span>
          <span class="text-slate-600">→</span>
          <span class="bg-orange-900/60 text-orange-300 px-2 py-0.5 rounded font-semibold">③ WebM 영상 내보내기</span>
          <span class="text-slate-600">→</span>
          <span class="bg-green-900/60 text-green-300 px-2 py-0.5 rounded font-semibold">④ 편집툴에서 편집</span>
          <button onclick="runFullPipeline()" id="fullPipelineBtn"
            class="ml-auto bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-500 hover:to-orange-500
                   text-white font-bold px-3 py-1 rounded-lg transition text-[11px] whitespace-nowrap">
            ⚡ 전체 자동 실행
          </button>
        </div>
      </div>

      <div class="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <p class="text-xs text-slate-400" id="grokCardCount">${cards.length}개 장면</p>
        <div class="flex gap-2 flex-wrap">
          <!-- 나레이션 자동 분할 -->
          <button onclick="autoSplitByNarration()" id="narrationSplitBtn"
            class="bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-500 hover:to-amber-500
                   text-white text-xs font-bold px-3 py-2 rounded-lg transition whitespace-nowrap border border-yellow-500/40">
            💬 나레이션 자동 분할
          </button>
          <!-- ① AI 채우기 -->
          <button id="autoFillAllBtn" onclick="autoFillAllCards()"
            class="bg-violet-700 hover:bg-violet-600 text-white text-xs font-bold px-3 py-2 rounded-lg transition whitespace-nowrap">
            🤖 ① 전체 AI 채우기
          </button>
          <!-- ② 이미지 생성 -->
          <button onclick="startSeqGeneration()"
            class="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500
                   text-white text-xs font-bold px-3 py-2 rounded-lg transition whitespace-nowrap">
            🎨 ② 순차 생성
          </button>
          <button onclick="generateAllGrokImages()"
            class="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500
                   text-white text-xs font-bold px-3 py-2 rounded-lg transition whitespace-nowrap">
            ⚡ ② 전체 생성 (${cards.length}장)
          </button>
          <!-- ③ 내보내기 드롭다운 -->
          <div class="relative">
            <button onclick="toggleExportMenu()"
              class="bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold px-3 py-2 rounded-lg transition border border-slate-600 whitespace-nowrap flex items-center gap-1">
              📥 ③ 내보내기 ▾
            </button>
            <div id="exportMenuDropdown" class="hidden absolute right-0 top-full mt-1 z-50
                 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl min-w-[200px] overflow-hidden">
              <button onclick="exportTextScript()"
                class="w-full text-left px-4 py-2.5 text-xs text-slate-200 hover:bg-slate-700 transition flex items-center gap-2">
                📋 텍스트 대본 복사
              </button>
              <button onclick="exportImagesZip()"
                class="w-full text-left px-4 py-2.5 text-xs text-slate-200 hover:bg-slate-700 transition flex items-center gap-2 border-t border-slate-700">
                🖼️ 이미지 전체 ZIP
              </button>
              <button onclick="exportVideosZip()" id="exportVideosBtn"
                class="w-full text-left px-4 py-2.5 text-xs text-slate-200 hover:bg-slate-700 transition flex items-center gap-2 border-t border-slate-700">
                🎞️ 전체 영상 ZIP (WebM)
              </button>
              <button onclick="exportPackageZip()"
                class="w-full text-left px-4 py-2.5 text-xs text-orange-300 hover:bg-slate-700 transition flex items-center gap-2 border-t border-slate-700 font-semibold">
                📁 패키지 전체 내보내기
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="space-y-5">
        ${cards.map((card, i) => `
          <div id="grok-card-${i}" class="bg-slate-900/60 border border-slate-700 rounded-xl overflow-hidden">

            <!-- 카드 헤더 -->
            <div class="flex items-center gap-2 px-4 py-2.5 bg-slate-800/70 border-b border-slate-700/60">
              <span class="text-[10px] font-bold text-blue-400 bg-blue-900/40 px-1.5 py-0.5 rounded flex-shrink-0">${i + 1}</span>
              <span class="text-xs font-semibold text-slate-200 flex-1 truncate">${escHtml(card.chapterTitle)}</span>
            </div>

            <div class="p-4 space-y-4">
              <!-- 프롬프트 편집 -->
              <div>
                <div class="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                  <label class="block text-[11px] font-semibold text-blue-300">🖼️ 이미지 프롬프트 (영어)</label>
                  <div class="flex items-center gap-1.5">
                    <span class="text-[10px] text-slate-400">스타일:</span>
                    <select id="img-style-${i}" onchange="setCardStyle(${i}, this.value)"
                      class="bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-[10px] text-indigo-300 focus:outline-none focus:border-indigo-500">
                      <option value="inherit" ${(!card.stylePreset || card.stylePreset === 'inherit') ? 'selected' : ''}>🌐 전역 (${window.getStyleName(SELECTED_IMAGE_STYLE)})</option>
                      ${Object.entries(IMAGE_STYLE_PRESETS).map(([k, p]) => `
                        <option value="${k}" ${card.stylePreset === k ? 'selected' : ''}>${p.icon} ${p.name}</option>
                      `).join('')}
                    </select>
                    <button type="button" id="ai-prompt-btn-${i}" onclick="generateStylePromptForCard(${i})"
                      class="bg-indigo-900/80 hover:bg-indigo-700 text-indigo-200 border border-indigo-600/60 rounded px-2 py-0.5 text-[10px] font-bold transition flex items-center gap-1"
                      title="이 장면에 선택된 스타일에 맞게 영문 프롬프트 AI 자동 재작성">
                      🪄 AI 맞춤 작성
                    </button>
                  </div>
                </div>
                <textarea id="img-prompt-${i}" rows="3"
                  class="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-200
                         resize-none focus:outline-none focus:border-blue-500 font-mono leading-relaxed"
                >${escHtml(card.prompt)}</textarea>
                <div class="flex gap-2 mt-2">
                  <button onclick="generateSingleGrokImage(${i})"
                    class="grok-gen-btn flex-1 bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold py-1.5 rounded-lg transition">
                    🎨 이미지 생성
                  </button>
                  <button onclick="(async()=>{try{await navigator.clipboard.writeText(document.getElementById('img-prompt-${i}').value);this.textContent='✅';}catch(e){} setTimeout(()=>this.textContent='📋',1500)})()"
                    class="bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold px-3 py-1.5 rounded-lg transition border border-slate-600"
                    title="프롬프트 복사">📋</button>
                </div>
              </div>

              <!-- 프롬프트 검증 결과 -->
              <div id="grok-val-${i}" class="hidden rounded-lg px-3 py-2 text-xs border"></div>

              <!-- 이미지 출력 -->
              <div id="grok-spin-${i}" class="hidden flex items-center gap-2 py-2">
                <div class="spinner" style="width:18px;height:18px;border-width:2px;border-top-color:#3b82f6"></div>
                <span id="grok-spin-label-${i}" class="text-xs text-blue-400">Gemini Imagen 생성 중…</span>
              </div>
              <div id="grok-img-${i}" class="hidden">
                <img id="grok-img-el-${i}" class="w-full rounded-xl border border-slate-600" alt="Generated by Gemini" />
                <div class="mt-2 flex flex-wrap gap-2 items-center">
                  <a id="grok-dl-${i}" download="imagen-${i + 1}.png" target="_blank"
                    class="text-xs text-blue-400 hover:text-blue-300 underline font-semibold">⬇ 다운로드</a>
                  <button id="grok-remotion-${i}" data-src="" data-idx="${i}" onclick="sendToRemotion(this)"
                    class="hidden text-xs bg-orange-700 hover:bg-orange-600 text-white font-bold px-3 py-1 rounded-lg transition">
                    🎞️ WebM 내보내기
                  </button>
                  <button id="grok-xai-video-${i}" data-idx="${i}" onclick="generateGrokVideo(${i})"
                    class="hidden text-xs bg-gradient-to-r from-rose-700 to-pink-700 hover:from-rose-600 hover:to-pink-600
                           text-white font-bold px-3 py-1 rounded-lg transition">
                    🎬 Grok 영상 생성
                  </button>
                  <button id="grok-phosphene-video-${i}" data-idx="${i}" onclick="generatePhospheneVideo(${i})"
                    class="hidden text-xs bg-gradient-to-r from-indigo-700 to-violet-700 hover:from-indigo-600 hover:to-violet-600
                           text-white font-bold px-3 py-1 rounded-lg transition">
                    🎬 Phosphene 영상 생성
                  </button>
                  <button id="phos-opts-toggle-${i}" onclick="togglePhospheneOpts(${i})" title="Phosphene 옵션"
                    class="hidden text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold px-2 py-1 rounded-lg transition">⚙️</button>
                  <button id="sub-toggle-btn-${i}" onclick="toggleImageSubtitleOverlay(${i})"
                    class="text-xs bg-indigo-700/80 hover:bg-indigo-600 text-indigo-100 font-bold px-3 py-1 rounded-lg transition"
                    title="이미지에 자막을 즉시 삽입하거나 제거합니다">
                    💬 자막 토글
                  </button>
                  <button onclick="regenWithSub(${i})"
                    class="text-xs bg-yellow-700/60 hover:bg-yellow-600 text-yellow-200 font-bold px-3 py-1 rounded-lg transition">
                    🔄 자막 재적용
                  </button>
                  <div id="grok-video-status-${i}" class="hidden w-full mt-1 text-[11px] text-slate-400"></div>
                  <div id="phosphene-opts-${i}" class="hidden w-full mt-2 p-2.5 bg-slate-900/60 border border-indigo-800/50 rounded-lg">
                    <p class="text-[10px] font-bold text-indigo-300 mb-1.5">🎬 Phosphene 옵션</p>
                    <div class="grid grid-cols-3 gap-2 mb-2">
                      <div>
                        <label class="block text-[10px] text-slate-400 mb-0.5">해상도</label>
                        <select id="phos-res-${i}" class="w-full bg-slate-800 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500">
                          <option value="736x416">736×416 (빠름)</option>
                          <option value="1024x576" selected>1024×576 (기본)</option>
                          <option value="1280x720">1280×720 (HD·느림)</option>
                          <option value="576x1024">576×1024 (세로)</option>
                        </select>
                      </div>
                      <div>
                        <label class="block text-[10px] text-slate-400 mb-0.5">길이</label>
                        <select id="phos-frames-${i}" class="w-full bg-slate-800 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500">
                          <option value="121" selected>5초</option>
                          <option value="169">7초</option>
                          <option value="241">10초</option>
                        </select>
                      </div>
                      <div>
                        <label class="block text-[10px] text-slate-400 mb-0.5">품질</label>
                        <select id="phos-quality-${i}" class="w-full bg-slate-800 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500">
                          <option value="quick">quick (최속)</option>
                          <option value="balanced" selected>balanced (기본)</option>
                          <option value="standard">standard</option>
                          <option value="high">high (최고)</option>
                        </select>
                      </div>
                    </div>
                    <label class="block text-[10px] text-slate-400 mb-0.5">모션 프롬프트 <span class="text-slate-500">(비우면 이미지 프롬프트 사용)</span></label>
                    <input id="phos-prompt-${i}" type="text" placeholder="예: slow cinematic zoom, gentle camera push-in"
                      class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500">
                  </div>
                  <div id="phosphene-status-${i}" class="hidden w-full mt-1 text-[11px] text-indigo-300"></div>
                  <div id="phosphene-result-${i}" class="hidden w-full mt-2"></div>
                </div>
              </div>
              <div id="grok-err-${i}" class="hidden text-xs text-red-400 p-2 bg-red-900/20 rounded-lg"></div>

              <!-- 스크립트 & 자막 편집 (기본 펼침) -->
              <div class="border-t border-slate-700/60 pt-3">
                <div class="flex items-center gap-2 mb-3">
                  <button onclick="toggleEditPanel(${i})"
                    class="text-[11px] font-semibold text-slate-400 hover:text-slate-200 transition flex items-center gap-1.5 flex-1 text-left">
                    ✏️ 스크립트 &amp; 자막 편집
                    <span id="edit-arrow-${i}" class="text-[10px]">▴</span>
                  </button>
                  <button onclick="autoFillCard(${i})"
                    id="autofill-btn-${i}"
                    class="flex-shrink-0 text-[11px] bg-violet-700 hover:bg-violet-600 text-white font-bold px-2.5 py-1 rounded-lg transition flex items-center gap-1">
                    🤖 AI 자동 채우기
                  </button>
                </div>
                <div id="edit-panel-${i}" class="space-y-3">
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-400 mb-1">🎥 컷 묘사</label>
                    <textarea id="img-cut-${i}" rows="2"
                      class="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-300
                             resize-none focus:outline-none focus:border-slate-500"
                      placeholder="화면에 보여줄 장면을 묘사하세요…"
                    >${escHtml(card.cutDescription)}</textarea>
                  </div>
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-400 mb-1">📹 촬영/편집 방향</label>
                    <textarea id="img-dir-${i}" rows="2"
                      class="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-300
                             resize-none focus:outline-none focus:border-slate-500"
                      placeholder="B-roll, 텍스트 오버레이, 편집 효과 등…"
                    >${escHtml(card.direction)}</textarea>
                  </div>
                  <div>
                    <div class="flex items-center justify-between mb-1 gap-2 flex-wrap">
                      <div class="flex items-center gap-2">
                        <label class="text-[11px] font-semibold text-yellow-400">💬 자막 텍스트</label>
                        <label class="flex items-center gap-1 cursor-pointer text-[10px] text-slate-300 font-medium bg-slate-800/90 px-2 py-0.5 rounded border border-slate-600/70 hover:bg-slate-700">
                          <input type="checkbox" id="sub-enabled-${i}" ${(!card.subtitleDisabled) ? 'checked' : ''} onchange="toggleCardSubEnabled(${i}, this.checked)" class="rounded text-indigo-500 focus:ring-0">
                          <span>자막 삽입</span>
                        </label>
                      </div>
                      <div class="flex items-center gap-1.5 text-[10px]">
                        <span id="sub-count-${i}" class="text-slate-400">0자</span>
                        <span class="text-slate-600">/</span>
                        <span class="text-slate-500">최대</span>
                        <input id="sub-max-${i}" type="number" min="5" max="100" value="30"
                          class="w-12 bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-center text-slate-200
                                 focus:outline-none focus:border-yellow-500 text-[10px]"
                          title="최대 글자수" oninput="updateSubCount(${i})">
                        <span class="text-slate-500">자</span>
                      </div>
                    </div>
                    <textarea id="img-sub-${i}" rows="2"
                      oninput="updateSubCount(${i})"
                      class="w-full bg-slate-800 border border-yellow-700/40 rounded-lg px-3 py-2 text-xs text-slate-300
                             resize-none focus:outline-none focus:border-yellow-500"
                      placeholder="이 장면의 자막을 입력하세요…"
                    >${escHtml(card.subtitles)}</textarea>
                    <div class="mt-1 flex justify-between items-center">
                      <span id="sub-warn-${i}" class="hidden text-[10px] text-red-400">⚠ 최대 글자수 초과</span>
                      <span></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>`).join('')}
      </div>`;
    // 초기 글자수 카운터 갱신 및 스타일 프리셋 렌더링
    cards.forEach((_, i) => updateSubCount(i));
    setTimeout(() => { if (window.renderStylePresets) window.renderStylePresets(); }, 50);
  }

  window.toggleEditPanel = (idx) => {
    const panel = document.getElementById(`edit-panel-${idx}`);
    const arrow = document.getElementById(`edit-arrow-${idx}`);
    const nowHidden = panel.classList.toggle('hidden');
    if (arrow) arrow.textContent = nowHidden ? '▾' : '▴';
  };

  // ── 내보내기 드롭다운 토글 ────────────────────────────────────────
  window.toggleExportMenu = () => {
    const dd = document.getElementById('exportMenuDropdown');
    dd?.classList.toggle('hidden');
    // 외부 클릭 시 닫기
    setTimeout(() => {
      const close = (e) => {
        if (!e.target.closest('#exportMenuDropdown') && !e.target.closest('[onclick="toggleExportMenu()"]')) {
          dd?.classList.add('hidden');
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 50);
  };

  // ── ① 텍스트 대본 복사 ────────────────────────────────────────────
  window.exportTextScript = () => {
    document.getElementById('exportMenuDropdown')?.classList.add('hidden');
    const lines = [];
    _imageCards.forEach((card, i) => {
      const prompt = document.getElementById(`img-prompt-${i}`)?.value ?? card.prompt;
      const cut    = document.getElementById(`img-cut-${i}`)?.value   ?? card.cutDescription;
      const dir    = document.getElementById(`img-dir-${i}`)?.value   ?? card.direction;
      const sub    = document.getElementById(`img-sub-${i}`)?.value   ?? card.subtitles;
      lines.push(`${'━'.repeat(36)}`);
      lines.push(`📌 장면 ${i + 1}. ${card.chapterTitle}`);
      lines.push(`🖼️ AI 프롬프트 (영어): ${prompt}`);
      if (cut.trim()) lines.push(`🎥 컷 묘사: ${cut.trim()}`);
      if (dir.trim()) lines.push(`📹 촬영/편집 방향: ${dir.trim()}`);
      if (sub.trim()) lines.push(`💬 자막: ${sub.trim()}`);
      lines.push('');
    });
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => alert(`✅ ${_imageCards.length}개 장면 대본이 클립보드에 복사됐습니다.\n→ CapCut, Notion, Google Docs에 붙여넣기 하세요.`))
      .catch(() => alert('복사 실패 — 브라우저 권한을 확인해주세요.'));
  };

  // ── ② 이미지 전체 ZIP ─────────────────────────────────────────────
  window.exportImagesZip = async () => {
    document.getElementById('exportMenuDropdown')?.classList.add('hidden');
    const zip = new JSZip();
    let count = 0;
    _imageCards.forEach((card, i) => {
      const imgEl = document.getElementById(`grok-img-el-${i}`);
      if (!imgEl || !imgEl.src || imgEl.src === window.location.href) return;
      // data URL → base64
      const b64 = imgEl.src.split(',')[1];
      if (!b64) return;
      const title = card.chapterTitle.replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
      zip.file(`scene-${String(i + 1).padStart(2, '0')}-${title}.png`, b64, { base64: true });
      count++;
    });
    if (!count) { alert('생성된 이미지가 없습니다.\n먼저 ② 이미지 생성을 실행하세요.'); return; }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url; a.download = 'scenes-images.zip'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    alert(`✅ ${count}개 이미지 ZIP 다운로드 시작\n→ 압축 해제 후 영상 편집툴에 불러오세요.`);
  };

  // ── 공통: 이미지 → WebM Blob 렌더러 ─────────────────────────────
  async function renderSceneToWebM(imgSrc, subText, subMax = 30, onProgress) {
    const DURATION = 5;
    const FPS      = 30;
    const W        = 1920;
    const H        = 1080;
    const FRAMES   = DURATION * FPS;

    const img = await new Promise((resolve, reject) => {
      const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = imgSrc;
    });

    // 한글이면 영어로 자동 번역 후 Canvas에 표시
    const displayText = subText ? await toEnglishForCanvas(subText) : '';
    const segments  = displayText ? splitSubtitleSemantic(displayText, subMax) : [];
    const segFrames = segments.length > 1 ? Math.floor(FRAMES / segments.length) : FRAMES;
    const fontSize  = Math.round(H * 0.058);

    // 영문 폰트 로드
    await ensureKrFont(fontSize);

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
    const stream   = canvas.captureStream(FPS);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks   = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

    const drawSubSeg = (seg) => {
      if (!seg) return;
      drawSubtitleOnCanvas(ctx, [seg], W, H, fontSize);
    };

    await new Promise((resolve, reject) => {
      recorder.onstop = resolve; recorder.onerror = reject;
      recorder.start();
      let frame = 0;
      const drawFrame = () => {
        let alpha = 1;
        if (frame < 10) alpha = frame / 10;
        else if (frame > FRAMES - 10) alpha = (FRAMES - frame) / 10;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = alpha; ctx.drawImage(img, 0, 0, W, H); ctx.globalAlpha = 1;
        if (segments.length > 0) {
          drawSubSeg(segments[Math.min(Math.floor(frame / segFrames), segments.length - 1)]);
        }
        if (onProgress) onProgress(frame / FRAMES);
        frame++;
        if (frame <= FRAMES) requestAnimationFrame(drawFrame);
        else recorder.stop();
      };
      requestAnimationFrame(drawFrame);
    });

    return new Blob(chunks, { type: mimeType });
  }

  // ── ③ 전체 영상 ZIP (WebM) ────────────────────────────────────────
  window.exportVideosZip = async () => {
    document.getElementById('exportMenuDropdown')?.classList.add('hidden');
    const btn = document.getElementById('exportVideosBtn');
    const total = _imageCards.length;
    let hasImg = false;
    for (let i = 0; i < total; i++) {
      const el = document.getElementById(`grok-img-el-${i}`);
      if (el?.dataset?.rawSrc || (el?.src && el.src !== window.location.href)) { hasImg = true; break; }
    }
    if (!hasImg) { alert('생성된 이미지가 없습니다.\n먼저 ② 이미지 생성을 실행하세요.'); return; }

    if (btn) { btn.textContent = '🎞️ 인코딩 중… (0%)'; btn.disabled = true; }
    const zip   = new JSZip();
    let   count = 0;
    try {
      for (let i = 0; i < total; i++) {
        const imgEl  = document.getElementById(`grok-img-el-${i}`);
        const imgSrc = imgEl?.dataset?.rawSrc || imgEl?.src;
        if (!imgSrc || imgSrc === window.location.href) continue;

        const isSubEnabled = _globalSubtitleOverlay && !_imageCards[i]?.subtitleDisabled;
        const subText = isSubEnabled ? (document.getElementById(`img-sub-${i}`)?.value ?? _imageCards[i]?.subtitles ?? '').trim() : '';
        const subMax  = parseInt(document.getElementById(`sub-max-${i}`)?.value || '30', 10);
        const title   = (_imageCards[i]?.chapterTitle || `장면${i+1}`).replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);

        if (btn) btn.textContent = `🎞️ 인코딩 중… (${i+1}/${total})`;
        const blob = await renderSceneToWebM(imgSrc, subText, subMax);
        zip.file(`scene-${String(i + 1).padStart(2, '0')}-${title}.webm`, blob);
        count++;
      }
      if (!count) { alert('렌더링할 이미지가 없습니다.'); return; }
      if (btn) btn.textContent = '🎞️ ZIP 압축 중…';
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a   = document.createElement('a'); a.href = url; a.download = 'scenes-videos.zip'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      alert(`✅ ${count}개 WebM 영상 ZIP 다운로드 완료!\n\n📌 다음 단계:\n1. ZIP 압축 해제\n2. CapCut / DaVinci Resolve / Premiere 실행\n3. scene-01, scene-02… 순서대로 타임라인에 드래그\n4. 최종 편집 후 내보내기`);
    } finally {
      if (btn) { btn.textContent = '🎞️ 전체 영상 ZIP (WebM)'; btn.disabled = false; }
    }
  };

  // ── ④ 패키지 내보내기 (이미지 + 텍스트 + 영상) ───────────────────
  window.exportPackageZip = async () => {
    document.getElementById('exportMenuDropdown')?.classList.add('hidden');
    const zip   = new JSZip();
    const imgs  = zip.folder('images');
    const vids  = zip.folder('videos');
    let imgCnt = 0, vidCnt = 0;

    // 텍스트 대본
    const lines = ['유튜브 영상 제작 패키지\n' + '='.repeat(40) + '\n'];
    _imageCards.forEach((card, i) => {
      const prompt = document.getElementById(`img-prompt-${i}`)?.value ?? card.prompt;
      const cut    = document.getElementById(`img-cut-${i}`)?.value   ?? card.cutDescription;
      const dir    = document.getElementById(`img-dir-${i}`)?.value   ?? card.direction;
      const sub    = document.getElementById(`img-sub-${i}`)?.value   ?? card.subtitles;
      lines.push(`\n장면 ${i+1}. ${card.chapterTitle}`);
      lines.push(`AI 프롬프트: ${prompt}`);
      if (cut.trim()) lines.push(`컷 묘사: ${cut.trim()}`);
      if (dir.trim()) lines.push(`촬영/편집: ${dir.trim()}`);
      if (sub.trim()) lines.push(`자막: ${sub.trim()}`);
    });
    zip.file('script.txt', lines.join('\n'));

    // 이미지 & 영상
    for (let i = 0; i < _imageCards.length; i++) {
      const imgEl  = document.getElementById(`grok-img-el-${i}`);
      const title  = (_imageCards[i]?.chapterTitle || `장면${i+1}`).replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
      const fname  = `scene-${String(i+1).padStart(2,'0')}-${title}`;
      const imgSrc = imgEl?.dataset?.rawSrc || imgEl?.src;
      if (!imgSrc || imgSrc === window.location.href) continue;

      // PNG
      const b64 = imgEl.src.split(',')[1];
      if (b64) { imgs.file(`${fname}.png`, b64, { base64: true }); imgCnt++; }

      // WebM
      const isSubEnabled = _globalSubtitleOverlay && !_imageCards[i]?.subtitleDisabled;
      const subText = isSubEnabled ? (document.getElementById(`img-sub-${i}`)?.value ?? _imageCards[i]?.subtitles ?? '').trim() : '';
      const subMax  = parseInt(document.getElementById(`sub-max-${i}`)?.value || '30', 10);
      try {
        const blob = await renderSceneToWebM(imgSrc, subText, subMax);
        vids.file(`${fname}.webm`, blob); vidCnt++;
      } catch (_) {}
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a   = document.createElement('a'); a.href = url; a.download = 'youtube-package.zip'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    alert(`✅ 패키지 내보내기 완료!\n📁 포함: 대본(script.txt) + 이미지 ${imgCnt}장 + 영상 ${vidCnt}개\n\n📌 다음: ZIP 압축 해제 → 편집툴에서 videos/ 폴더 열기`);
  };

  // ── 전체 자동 파이프라인: AI채우기 → 이미지생성 → 영상ZIP ─────────
  window.runFullPipeline = async () => {
    const btn = document.getElementById('fullPipelineBtn');
    const steps = [
      '① AI 채우기 중…',
      '② 이미지 생성 중…',
      '③ 영상 인코딩 중…',
    ];
    const ok = confirm(`전체 자동 파이프라인을 실행합니다.\n\n① AI 자동 채우기 (컷묘사·자막)\n② 전체 이미지 생성 (Gemini Imagen)\n③ 전체 영상 ZIP 내보내기 (WebM)\n\n계속하시겠습니까?`);
    if (!ok) return;

    if (btn) { btn.disabled = true; btn.textContent = steps[0]; }
    try {
      await autoFillAllCards();
      if (btn) btn.textContent = steps[1];
      await generateAllGrokImages();
      if (btn) btn.textContent = steps[2];
      await exportVideosZip();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⚡ 전체 자동 실행'; }
    }
  };

  // ── AI 자동 채우기 (단일 카드: 컷묘사 / 촬영편집방향 / 자막텍스트) ────────────
  window.autoFillCard = async (idx) => {
    const cards = (_imageCards && _imageCards.length > 0) ? _imageCards : (window._imageCards || []);
    const card = cards[idx];
    if (!card) return;

    const btn = document.getElementById(`autofill-btn-${idx}`);
    const orig = btn?.textContent || '🤖 AI 자동 채우기';
    if (btn) { btn.textContent = '⏳ 생성 중…'; btn.disabled = true; }

    const prompt = (document.getElementById(`img-prompt-${idx}`)?.value || card.prompt || '').trim();
    const title  = card.chapterTitle || `장면 ${idx + 1}`;
    const cutPrev = (document.getElementById(`img-cut-${idx}`)?.value || card.cutDescription || '').trim();

    const activeStyle = card.stylePreset && card.stylePreset !== 'inherit' ? card.stylePreset : SELECTED_IMAGE_STYLE;
    const styleInfo = IMAGE_STYLE_PRESETS[activeStyle] || IMAGE_STYLE_PRESETS['none'];
    const styleGuide = (typeof STYLE_PROMPT_GUIDES !== 'undefined' && STYLE_PROMPT_GUIDES[activeStyle]?.guide) || styleInfo.promptSuffix || '';

    try {
      const singlePrompt = `당신은 유튜브 영상 연출 및 AI 이미지 프롬프트 최고 전문가입니다.
아래 단일 장면에 대한 연출 계획(컷 묘사, 촬영/편집 방향, 자막 텍스트)과 함께, 선택된 **[${styleInfo.name}]** 스타일에 완벽히 특화된 고품질 영문 이미지 생성 프롬프트를 반드시 JSON 형식으로만 작성하세요.

[선택된 이미지 스타일]
스타일: ${styleInfo.name}
스타일 렌더링 지침: ${styleGuide}

JSON 출력 형식:
{
  "cut": "화면에 보여줄 구체적인 컷 묘사 (한국어, 2~3문장)",
  "direction": "촬영/편집 연출 방향 (한국어, 1~2문장, B-roll/효과 등)",
  "subtitle": "자막 텍스트 (한국어, 15~25자 핵심 메시지 한 문장)",
  "prompt": "English image generation prompt specifically crafted for ${styleInfo.name} style (60-120 words, rich visual details, no text/watermark words)"
}

장면 정보:
- 챕터 제목: ${title}
- 기존 내용/프롬프트: ${cutPrev || prompt || title}`;

      const raw = await callGemini(singlePrompt, { jsonMode: true });
      let data = safeParseJSON(raw) || {};

      let cut = data.cut || data.cutDescription || data.cut_description || data.description || data['컷'] || data['컷묘사'] || '';
      let direction = data.direction || data.shootingDirection || data.shooting_direction || data['연출'] || data['촬영방향'] || '';
      let subtitle = data.subtitle || data.subtitles || data.caption || data['자막'] || data['자막텍스트'] || '';
      let newPrompt = data.prompt || data.imagePrompt || data.image_prompt || data['프롬프트'] || '';

      // JSON 파싱 실패 시 텍스트 태그 정규식 백업 추출
      if (!cut && !direction && !subtitle) {
        cut = (raw.match(/(?:\[CUT(?:\s*\d+)?\]|컷\s*묘사|CUT\s*:)\s*([^\n\r]+(?:\n[^\n\r]+)?)/i)?.[1] || '').trim();
        direction = (raw.match(/(?:\[DIRECTION(?:\s*\d+)?\]|촬영[\s/]*편집\s*방향|연출|DIRECTION\s*:)\s*([^\n\r]+)/i)?.[1] || '').trim();
        subtitle = (raw.match(/(?:\[SUBTITLE(?:\s*\d+)?\]|자막\s*텍스트|자막|SUBTITLE\s*:)\s*([^\n\r]+)/i)?.[1] || '').trim();
        newPrompt = (raw.match(/(?:\[PROMPT(?:\s*\d+)?\]|PROMPT\s*:)\s*([^\n\r]+(?:\n[^\n\r]+)?)/i)?.[1] || '').trim();
      }

      if (!cut && !direction && !subtitle && !newPrompt) {
        throw new Error('응답 내용을 인식하지 못했습니다.');
      }

      // 텍스트 영역에 채우기
      const cutEl = document.getElementById(`img-cut-${idx}`);
      const dirEl = document.getElementById(`img-dir-${idx}`);
      const subEl = document.getElementById(`img-sub-${idx}`);
      const promptEl = document.getElementById(`img-prompt-${idx}`);
      if (cutEl && cut)       cutEl.value = cut;
      if (dirEl && direction) dirEl.value = direction;
      if (subEl && subtitle) {
        subEl.value = subtitle;
        updateSubCount(idx);
      }
      if (promptEl && newPrompt && newPrompt.length > 10) {
        promptEl.value = newPrompt;
        promptEl.classList.add('border-indigo-500', 'bg-indigo-950/40');
        setTimeout(() => promptEl.classList.remove('bg-indigo-950/40'), 1500);
      }

      // _imageCards 및 window._imageCards에도 저장
      if (cut)       card.cutDescription = cut;
      if (direction) card.direction       = direction;
      if (subtitle)  card.subtitles       = subtitle;
      if (newPrompt && newPrompt.length > 10) card.prompt = newPrompt;

      // 패널 펼치기
      const panel = document.getElementById(`edit-panel-${idx}`);
      const arrow = document.getElementById(`edit-arrow-${idx}`);
      if (panel?.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        if (arrow) arrow.textContent = '▴';
      }
    } catch (e) {
      console.error(`장면 ${idx + 1} 자동 채우기 실패:`, e);
      if (btn) btn.textContent = '⚠️ 재시도';
    } finally {
      if (btn && btn.textContent !== '⚠️ 재시도') { btn.textContent = orig; }
      if (btn) btn.disabled = false;
    }
  };

  // ── 전체 장면 AI 일괄 자동 채우기 (단일 요청으로 Rate Limit 429 완전 방지 + 순차 보완) ──
  window.autoFillAllCards = async () => {
    const cards = (_imageCards && _imageCards.length > 0) ? _imageCards : (window._imageCards || []);
    if (!cards || cards.length === 0) {
      alert('대본 카드가 없습니다. 먼저 대본을 작성/분할해 주세요.');
      return;
    }
    _imageCards = cards;
    window._imageCards = cards;

    const btn = document.getElementById('autoFillAllBtn') || document.getElementById('fullPipelineBtn');
    const origText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ AI 전체 채우는 중…';
    }
    
    // 1단계: 전체 장면 정보를 모아서 1개의 Gemini 요청으로 일괄 생성 시도
    let batchSuccess = false;
    const filledIndices = new Set();
    try {
      const scenesInfo = cards.map((c, i) => {
        const cut = (document.getElementById(`img-cut-${i}`)?.value || c.cutDescription || '').trim();
        const p = (document.getElementById(`img-prompt-${i}`)?.value || c.prompt || '').trim();
        const t = c.chapterTitle || `장면 ${i + 1}`;
        return `[장면 ${i + 1}]\n챕터 제목: ${t}\n장면 내용/프롬프트: ${cut || p || t}`;
      }).join('\n\n');

      const activeStyle = SELECTED_IMAGE_STYLE;
      const styleInfo = IMAGE_STYLE_PRESETS[activeStyle] || IMAGE_STYLE_PRESETS['none'];
      const styleGuide = (typeof STYLE_PROMPT_GUIDES !== 'undefined' && STYLE_PROMPT_GUIDES[activeStyle]?.guide) || styleInfo.promptSuffix || '';

      const batchPrompt = `당신은 유튜브 영상 연출 및 AI 이미지 프롬프트 최고 전문가입니다.
총 ${cards.length}개의 각 장면에 대해 컷 묘사, 촬영/편집 방향, 자막 텍스트와 함께 선택된 **[${styleInfo.name}]** 스타일에 완벽히 최적화된 영문 이미지 생성 프롬프트를 작성해주세요.

[선택된 이미지 스타일]
스타일: ${styleInfo.name}
스타일 렌더링 지침: ${styleGuide}

반드시 아래 JSON 배열 형식으로만 출력하세요. 마크다운 코드블록이나 불필요한 설명 없이 순수 JSON만 출력하세요:
[
  {
    "sceneIndex": 1,
    "cut": "화면에 보여줄 구체적인 컷 묘사 (한국어, 2~3문장)",
    "direction": "촬영/편집 연출 방향 (한국어, 1~2문장)",
    "subtitle": "자막 텍스트 (한국어, 15~25자 핵심 메시지)",
    "prompt": "English image generation prompt tailored for ${styleInfo.name} style (60-120 words, rich visual details, no text/watermark words)"
  }
]

대상 장면 목록:
${scenesInfo}`;

      const raw = await callGemini(batchPrompt, { jsonMode: true });
      let parsed = safeParseJSON(raw);
      if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') {
        parsed = parsed.scenes || parsed.cards || parsed.items || Object.values(parsed);
      }

      if (Array.isArray(parsed) && parsed.length > 0) {
        parsed.forEach((item, idx) => {
          if (!item || typeof item !== 'object') return;
          let cardIdx = idx;
          if (item.sceneIndex !== undefined || item.scene !== undefined || item.index !== undefined || item.id !== undefined) {
            const rawIdx = item.sceneIndex ?? item.scene ?? item.index ?? item.id;
            const num = typeof rawIdx === 'number' ? rawIdx : parseInt(String(rawIdx).replace(/[^\d]/g, ''), 10);
            if (!isNaN(num) && num > 0 && num <= cards.length) {
              cardIdx = num - 1;
            }
          }
          if (cardIdx >= 0 && cardIdx < cards.length) {
            const cutVal = item.cut || item.cutDescription || item.cut_description || item.description || item['컷'] || item['컷묘사'] || '';
            const dirVal = item.direction || item.shootingDirection || item.shooting_direction || item['연출'] || item['촬영방향'] || '';
            const subVal = item.subtitle || item.subtitles || item.caption || item.script || item['자막'] || item['자막텍스트'] || '';
            const promptVal = item.prompt || item.imagePrompt || item.image_prompt || '';

            const card = cards[cardIdx];
            const cutEl = document.getElementById(`img-cut-${cardIdx}`);
            const dirEl = document.getElementById(`img-dir-${cardIdx}`);
            const subEl = document.getElementById(`img-sub-${cardIdx}`);
            const promptEl = document.getElementById(`img-prompt-${cardIdx}`);

            if (cutEl && cutVal) cutEl.value = cutVal;
            if (dirEl && dirVal) dirEl.value = dirVal;
            if (subEl && subVal) {
              subEl.value = subVal;
              updateSubCount(cardIdx);
            }
            if (promptEl && promptVal && promptVal.length > 10) {
              promptEl.value = promptVal;
              promptEl.classList.add('border-indigo-500', 'bg-indigo-950/40');
              setTimeout(() => promptEl.classList.remove('bg-indigo-950/40'), 1500);
            }

            if (card) {
              if (cutVal) card.cutDescription = cutVal;
              if (dirVal) card.direction = dirVal;
              if (subVal) card.subtitles = subVal;
              if (promptVal && promptVal.length > 10) card.prompt = promptVal;
            }

            // 패널 펼치기
            const panel = document.getElementById(`edit-panel-${cardIdx}`);
            const arrow = document.getElementById(`edit-arrow-${cardIdx}`);
            if (panel?.classList.contains('hidden')) {
              panel.classList.remove('hidden');
              if (arrow) arrow.textContent = '▴';
            }
            if (cutVal || dirVal || subVal || promptVal) filledIndices.add(cardIdx);
          }
        });
        if (filledIndices.size > 0) {
          batchSuccess = true;
        }
      }
    } catch (e) {
      console.warn('일괄 자동 채우기 JSON 파싱 실패, 순차 처리로 전환합니다:', e);
    }

    // 2단계: 일괄 생성에서 누락된 카드가 있거나 실패한 경우 순차 보완 실행
    for (let i = 0; i < cards.length; i++) {
      if (!filledIndices.has(i)) {
        if (btn) btn.textContent = `⏳ 장면 ${i + 1}/${cards.length} 채우는 중…`;
        await autoFillCard(i);
        if (i < cards.length - 1) {
          await new Promise(r => setTimeout(r, 400));
        }
      }
    }

    if (btn) {
      btn.textContent = '✅ 채우기 완료!';
      setTimeout(() => {
        if (btn) {
          btn.disabled = false;
          btn.textContent = origText || '🤖 ① 전체 AI 채우기';
        }
      }, 1500);
    }
  };

  window.generateSingleGrokImage = async (idx) => {
    const promptEl  = document.getElementById(`img-prompt-${idx}`);
    let prompt      = (promptEl ? promptEl.value : '').trim() || (_imageCards[idx]?.prompt ?? '');
    if (!prompt) return;

    // 참조 캐릭터 묘사가 있으면 프롬프트 앞에 자동 첨부
    if (_refCharDescText) {
      prompt = `${_refCharDescText}, ${prompt}`;
    }

    // ⭐ 한국인/아시아인 기본 적용 (서양 컨텍스트 제외)
    if (window.applyAsianDefault) {
      prompt = window.applyAsianDefault(prompt);
    }

    const cutEl    = document.getElementById(`img-cut-${idx}`);
    const cutDesc  = cutEl ? cutEl.value.trim() : (_imageCards[idx]?.cutDescription ?? '');

    const spinEl      = document.getElementById(`grok-spin-${idx}`);
    const spinLabel   = document.getElementById(`grok-spin-label-${idx}`);
    const imgWrap     = document.getElementById(`grok-img-${idx}`);
    const imgEl       = document.getElementById(`grok-img-el-${idx}`);
    const dlEl        = document.getElementById(`grok-dl-${idx}`);
    const errEl       = document.getElementById(`grok-err-${idx}`);
    const valEl       = document.getElementById(`grok-val-${idx}`);
    const btn         = document.querySelector(`#grok-card-${idx} .grok-gen-btn`);

    imgWrap.classList.add('hidden');
    errEl.classList.add('hidden');
    valEl.classList.add('hidden');
    spinEl.classList.remove('hidden');
    if (btn) { btn.disabled = true; btn.textContent = '검증 중…'; }

    try {
      // ── Step 1: 프롬프트 & 장면 매칭 검증 (보조 기능 - 실패 시에도 이미지 생성 진행) ──
      if (cutDesc) {
        try {
          if (spinLabel) spinLabel.textContent = '① 프롬프트 검증 중…';
          const valResult = await geminiChat(
            '당신은 이미지 생성 프롬프트 품질 평가 전문가입니다. 한국어 장면 묘사와 영어 AI 이미지 프롬프트의 매칭 정도를 평가하고 딱 2줄로 답변하세요: 첫 줄은 "✅ 매칭 우수" / "⚠️ 부분 매칭" / "❌ 미스매칭" 중 하나 + 점수(1-10) + 한 줄 이유, 둘째 줄은 개선 제안 (없으면 "개선 불필요").',
            [{ role: 'user', parts: [{ text: `장면 묘사 (한국어): ${cutDesc}\n\nAI 이미지 프롬프트 (영어): ${prompt}` }] }],
            1
          );
          if (valResult && valResult !== '응답 없음') {
            const isGood = valResult.includes('✅');
            const needsImprove = !isGood;
            valEl.className = `rounded-lg px-3 py-2 text-xs border ${
              isGood
                ? 'bg-green-900/20 border-green-700/50 text-green-300'
                : valResult.includes('⚠️')
                  ? 'bg-yellow-900/20 border-yellow-700/50 text-yellow-300'
                  : 'bg-red-900/20 border-red-700/50 text-red-300'
            }`;
            valEl.innerHTML =
              valResult.split('\n').map(l => `<p>${escHtml(l)}</p>`).join('') +
              (needsImprove ? `
                <div class="mt-2 pt-2 border-t border-current/20">
                  <button onclick="improvePromptFromVal(${idx})"
                    class="bg-blue-700 hover:bg-blue-600 text-white font-bold px-3 py-1 rounded-lg transition text-[11px]">
                    ✨ 개선 제안 자동 적용
                  </button>
                </div>` : '');
            valEl.classList.remove('hidden');
          }
        } catch (valErr) {
          // Gemini API 429 또는 기타 오류 시 검증만 건너뛰고 이미지 생성(ComfyUI 등)은 정상 진행
          console.warn(`장면 ${idx + 1} 프롬프트 검증 생략 (AI 한도/오류):`, valErr.message || valErr);
        }
      }

      // ── Step 2: 이미지 생성 (선택된 모델 & 스타일 프리셋 사용) ──
      const cardStyle = document.getElementById(`img-style-${idx}`)?.value || _imageCards[idx]?.stylePreset || 'inherit';
      const activeStyle = (cardStyle && cardStyle !== 'inherit') ? cardStyle : SELECTED_IMAGE_STYLE;
      const styleInfo = IMAGE_STYLE_PRESETS[activeStyle] || IMAGE_STYLE_PRESETS['none'];
      const styleName = styleInfo.name;

      // 프롬프트 및 네거티브 프롬프트에 스타일 프리셋 적용
      let styledPrompt = window.applyStylePreset(prompt, activeStyle);
      styledPrompt = window.applyNoText ? window.applyNoText(styledPrompt) : styledPrompt;
      const styleNegative = window.getStyleNegativePrompt(activeStyle);

      const modelName = IMAGE_MODEL === 'comfyui' ? '⚙️ ComfyUI (로컬 AI)' :
                        IMAGE_MODEL === 'pollinations' ? 'Pollinations (Flux)' :
                        IMAGE_MODEL === 'local-sd' ? '💻 내 PC Local SD (MPS)' :
                        IMAGE_MODEL === 'stability' ? 'Stable Diffusion (SD3.5)' : 'Gemini Imagen';
      const styleSuffixLabel = activeStyle !== 'none' ? ` [${styleInfo.icon} ${styleName}]` : '';
      if (spinLabel) spinLabel.textContent = `② ${modelName}${styleSuffixLabel} 생성 중…`;
      if (btn) btn.textContent = '생성 중…';

      let rawSrc = null;
      let currentPrompt = styledPrompt;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // 선택된 이미지 모델에 따라 분기
          if (IMAGE_MODEL === 'comfyui') {
            // ⚙️ ComfyUI 로컬 AI 가속 (MPS Apple Silicon)
            try {
              if (spinLabel) spinLabel.textContent = `② ⚙️ ComfyUI (로컬 AI 가속)${styleSuffixLabel} 생성 중…`;
              rawSrc = await generateComfyUIImage(window.applyNoText(currentPrompt), {
                width: 768,
                height: 448,
                steps: 20,
                cfg: 7.0,
                negative_prompt: styleNegative,
                onProgress: (status) => {
                  if (spinLabel) spinLabel.textContent = `② ${status}${styleSuffixLabel}`;
                }
              });
              if (rawSrc) {
                if (spinLabel) spinLabel.textContent = `✅ ComfyUI 생성 완료${styleSuffixLabel}`;
                break;
              }
              throw new Error('ComfyUI 응답 없음');
            } catch (err) {
              console.warn('ComfyUI failed, fallback to Pollinations:', err);
              if (spinLabel) spinLabel.textContent = `⚠️ ComfyUI 연결 대기 → 🌸 Pollinations(Flux)${styleSuffixLabel}로 자동 폴백…`;
              const pollRes = await fetch('/api/proxy/pollinations-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: window.applyNoText(currentPrompt), width: 1280, height: 720, model: 'flux' })
              });
              const pollData = await pollRes.json();
              const pollB64 = pollData.image || pollData.predictions?.[0]?.bytesBase64Encoded;
              if (pollRes.ok && pollB64) {
                rawSrc = `data:${pollData.mimeType || 'image/jpeg'};base64,` + pollB64;
                break;
              }
              if (attempt >= 2) throw err;
            }

          } else if (IMAGE_MODEL === 'local-sd') {
            // 💻 내 PC Local Stable Diffusion (Apple Silicon GPU / MPS)
            try {
              if (spinLabel) spinLabel.textContent = `② 💻 내 PC (Local SD - MPS 가속)${styleSuffixLabel} 생성 중…`;
              const res = await fetch('/api/proxy/local-sd', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  prompt: window.applyNoText(currentPrompt),
                  negative_prompt: styleNegative,
                  width: 768,
                  height: 432,
                  aspect_ratio: '16:9',
                  steps: 4
                })
              });
              const data = await res.json();
              if (res.ok && data.image) {
                rawSrc = 'data:image/png;base64,' + data.image;
                if (spinLabel) spinLabel.textContent = `✅ 내 PC 생성 완료 (${data.elapsed || ''}초)${styleSuffixLabel}`;
                break;
              }
              throw new Error(data.error || 'Local SD 응답 오류');
            } catch (err) {
              console.warn('Local SD failed, fallback to Pollinations:', err);
              if (spinLabel) spinLabel.textContent = `⚠️ Local SD 연결 대기 → 🌸 Pollinations(Flux)${styleSuffixLabel}로 자동 폴백…`;
              const pollRes = await fetch('/api/proxy/pollinations-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: window.applyNoText(currentPrompt), width: 1280, height: 720, model: 'flux' })
              });
              const pollData = await pollRes.json();
              const pollB64 = pollData.image || pollData.predictions?.[0]?.bytesBase64Encoded;
              if (pollRes.ok && pollB64) {
                rawSrc = `data:${pollData.mimeType || 'image/jpeg'};base64,` + pollB64;
                break;
              }
              if (attempt >= 2) throw err;
            }

          } else if (IMAGE_MODEL === 'pollinations') {
            // Pollinations (무료)
            const res = await fetch('/api/proxy/pollinations-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: window.applyNoText(currentPrompt), width: 1280, height: 720, model: 'flux' })
            });
            const data = await res.json();
            if (data.image) {
              rawSrc = 'data:image/jpeg;base64,' + data.image;
              break;
            }
            throw new Error(data.error || '이미지 생성 실패');

          } else if (IMAGE_MODEL === 'stability') {
            // Stable Diffusion (Stability AI SD 3.5)
            try {
              if (!STABILITY_API_KEY) throw new Error('STABILITY_API_KEY가 설정되지 않았습니다.');
              const res = await fetch('/api/proxy/stability-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  prompt: window.applyNoText(currentPrompt),
                  negative_prompt: styleNegative,
                  model: 'sd3.5-large',
                  aspect_ratio: '16:9'
                })
              });
              const data = await res.json();
              if (res.ok && data.image) {
                rawSrc = 'data:image/png;base64,' + data.image;
                break;
              }
              const errTxt = data.errors?.[0] || data.error || 'Stability 생성 실패';
              console.warn('Stability AI image failed, fallback to Pollinations:', errTxt);
              if (spinLabel) spinLabel.textContent = `⚠️ Stability 크레딧 부족 → 🌸 Pollinations (Flux 무료)${styleSuffixLabel}로 자동 생성 중…`;
              
              const pollRes = await fetch('/api/proxy/pollinations-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: window.applyNoText(currentPrompt), width: 1280, height: 720, model: 'flux' })
              });
              const pollData = await pollRes.json();
              const pollB64 = pollData.image || pollData.predictions?.[0]?.bytesBase64Encoded;
              if (pollRes.ok && pollB64) {
                rawSrc = `data:${pollData.mimeType || 'image/jpeg'};base64,` + pollB64;
                break;
              }
              throw new Error(errTxt);
            } catch (err) {
              if (spinLabel) spinLabel.textContent = `🌸 Pollinations(Flux)${styleSuffixLabel}로 생성 중…`;
              const pollRes = await fetch('/api/proxy/pollinations-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: window.applyNoText(currentPrompt), width: 1280, height: 720, model: 'flux' })
              });
              const pollData = await pollRes.json();
              const pollB64 = pollData.image || pollData.predictions?.[0]?.bytesBase64Encoded;
              if (pollRes.ok && pollB64) {
                rawSrc = `data:${pollData.mimeType || 'image/jpeg'};base64,` + pollB64;
                break;
              }
              if (attempt >= 2) throw err;
            }

          } else {
            // Gemini Imagen 시도 -> 실패/할당량초과 시 Pollinations 자동 폴백
            try {
              const res = await fetch('/api/proxy/gemini-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: window.applyNoText(currentPrompt) }),
              });
              const data = await res.json();
              const b64 = data.predictions?.[0]?.bytesBase64Encoded
                       || data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
                       || data.image;

              if (res.ok && b64) {
                const mime = data.mimeType || 'image/png';
                rawSrc = `data:${mime};base64,${b64}`;
                break;
              } else {
                const errMsg = typeof data.error === 'string' ? data.error : (data.error?.message || '');
                const isRAI = errMsg.includes('RAI') || errMsg.includes('safety') || errMsg.includes('policy');
                if (isRAI && attempt < 2) {
                  if (spinLabel) spinLabel.textContent = `⚠️ 안전 필터 차단 — 프롬프트 완화 중… (${attempt + 1}/2)`;
                  const saferPrompt = await geminiChat(
                    '아래 이미지 프롬프트가 안전 정책에 의해 차단됐습니다. 폭력·갈등·부정적 감정을 제거하고, 같은 장면을 중립적·긍정적으로 재작성해 주세요. 영어 프롬프트만 출력하세요.',
                    [{ role: 'user', parts: [{ text: currentPrompt }] }]
                  );
                  currentPrompt = saferPrompt.replace(/^```[a-z]*\n?|```$/gm, '').trim();
                  const promptEl2 = document.getElementById(`img-prompt-${idx}`);
                  if (promptEl2) promptEl2.value = currentPrompt;
                  continue;
                }
                
                // 429 할당량 초과 또는 API 오류 시 Pollinations (Flux)로 즉시 폴백
                if (spinLabel) spinLabel.textContent = '🌸 Pollinations (Flux 무료)로 자동 전환 생성 중…';
                const pollRes = await fetch('/api/proxy/pollinations-image', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ prompt: window.applyNoText(currentPrompt), width: 1280, height: 720, model: 'flux' })
                });
                const pollData = await pollRes.json();
                const pollB64 = pollData.image || pollData.predictions?.[0]?.bytesBase64Encoded;
                if (pollRes.ok && pollB64) {
                  rawSrc = `data:${pollData.mimeType || 'image/jpeg'};base64,${pollB64}`;
                  break;
                }
                throw new Error(pollData.error || errMsg || '이미지 생성 실패');
              }
            } catch (err) {
              // 네트워크 또는 기타 에러 시 Pollinations 재시도
              if (spinLabel) spinLabel.textContent = '🌸 Pollinations(Flux)로 생성 중…';
              const pollRes = await fetch('/api/proxy/pollinations-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: window.applyNoText(currentPrompt), width: 1280, height: 720, model: 'flux' })
              });
              const pollData = await pollRes.json();
              const pollB64 = pollData.image || pollData.predictions?.[0]?.bytesBase64Encoded;
              if (pollRes.ok && pollB64) {
                rawSrc = `data:${pollData.mimeType || 'image/jpeg'};base64,${pollB64}`;
                break;
              }
              if (attempt >= 2) throw err;
            }
          }
        } catch (e) {
          if (attempt >= 2) throw e;
          continue;
        }
      }
      if (!rawSrc) throw new Error('이미지 생성 실패');

      // 자막 삽입 여부 판단: 전역 ON + 개별 카드 활성화 상태일 때만 오버레이 합성
      const card = (_imageCards && _imageCards[idx]) || {};
      const isSubEnabled = _globalSubtitleOverlay && !card.subtitleDisabled;
      let subText  = (document.getElementById(`img-sub-${idx}`)?.value ?? card.subtitles ?? '').trim();

      let finalSrc = rawSrc;
      if (isSubEnabled && subText) {
        // 영어 자막이면 한글로 정확히 번역
        subText = await translateSubtitleToKorean(subText);
        // 한국어 문법 교정 적용
        if (window.validateKoreanText && subText) {
          subText = window.validateKoreanText(subText);
        }
        const subMax   = parseInt(document.getElementById(`sub-max-${idx}`)?.value || '30', 10);
        finalSrc = await overlaySubtitle(rawSrc, subText, subMax);
      }

      imgEl.src = finalSrc;
      imgEl.dataset.rawSrc = rawSrc; // 원본 보존 (자막 재적용 및 즉시 토글용)
      imgEl.dataset.hasSubtitle = (isSubEnabled && subText) ? 'true' : 'false';
      dlEl.href = finalSrc;
      dlEl.download = `imagen-${idx + 1}.png`;

      // 자막 토글 버튼 상태 동기화
      const toggleBtn = document.getElementById(`sub-toggle-btn-${idx}`);
      if (toggleBtn) {
        if (isSubEnabled && subText) {
          toggleBtn.textContent = '💬 자막 제거';
          toggleBtn.className = 'text-xs bg-indigo-700/80 hover:bg-indigo-600 text-indigo-100 font-bold px-3 py-1 rounded-lg transition';
        } else {
          toggleBtn.textContent = '💬 자막 삽입';
          toggleBtn.className = 'text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold px-3 py-1 rounded-lg transition';
        }
      }
      // 버튼 표시
      const remotionBtn  = document.getElementById(`grok-remotion-${idx}`);
      const grokVideoBtn = document.getElementById(`grok-xai-video-${idx}`);
      const phospheneBtn = document.getElementById(`grok-phosphene-video-${idx}`);
      if (remotionBtn)  { remotionBtn.classList.remove('hidden'); remotionBtn.dataset.src = finalSrc; }
      if (grokVideoBtn) { grokVideoBtn.classList.remove('hidden'); }
      if (phospheneBtn) { phospheneBtn.classList.remove('hidden'); }
      const phospheneOptsBtn = document.getElementById(`phos-opts-toggle-${idx}`);
      if (phospheneOptsBtn) { phospheneOptsBtn.classList.remove('hidden'); }
      imgWrap.classList.remove('hidden');
    } catch (e) {
      errEl.textContent = '오류: ' + e.message;
      errEl.classList.remove('hidden');
    } finally {
      spinEl.classList.add('hidden');
      if (spinLabel) spinLabel.textContent = 'Gemini Imagen 생성 중…';
      if (btn) { btn.disabled = false; btn.textContent = '🎨 이미지 생성'; }
    }
  };

  // ── 자막 의미 단위 분할 ─────────────────────────────────────────────
  function splitSubtitleSemantic(text, maxChars) {
    if (!text) return [];
    const t = text.trim();
    if (t.length <= maxChars) return [t];

    const segments = [];
    let s = t;

    while (s.length > maxChars) {
      let cut = -1;
      const limit = Math.min(maxChars, s.length - 1);
      const low   = Math.floor(maxChars * 0.4);

      // 1순위: 문장 끝 부호
      for (let i = limit; i >= low; i--) {
        if ('.!?。！？\n'.includes(s[i])) { cut = i + 1; break; }
      }
      // 2순위: 쉼표
      if (cut < 0) {
        for (let i = limit; i >= low; i--) {
          if (s[i] === ',' || s[i] === '，' || s[i] === '、') { cut = i + 1; break; }
        }
      }
      // 3순위: 한국어 절 경계 (앞 2글자가 고/며/서/면/데 등인 공백)
      if (cut < 0) {
        for (let i = limit; i >= low; i--) {
          if (s[i] === ' ' && i > 1) {
            const prev = s.slice(Math.max(0, i - 3), i);
            if (/[고며서면데]$/.test(prev) || /지만$/.test(prev) || /는데$/.test(prev)) {
              cut = i + 1; break;
            }
          }
        }
      }
      // 4순위: 공백
      if (cut < 0) {
        for (let i = limit; i >= low; i--) {
          if (s[i] === ' ') { cut = i + 1; break; }
        }
      }
      // 최후: 강제 분리
      if (cut < 0) cut = maxChars;

      segments.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (s) segments.push(s);
    return segments;
  }

  // ── Canvas 자막 오버레이 (의미 단위 분할 + 다중 줄 렌더링) ──────────
  // 한글 포함 여부 체크
  function hasKorean(text) { return /[가-힣ᄀ-ᇿ㄰-㆏]/.test(text); }

  // 한글 텍스트 → 영어 번역 (Canvas 표시용)
  //  [변경] 예전엔 한글 자막을 영어로 번역해 캔버스에 그렸으나(영어 자막 원인),
  //  drawSubtitleOnCanvas 가 한글 폰트(Noto Sans KR / Apple SD Gothic Neo)를 쓰므로
  //  이제 한글 원문을 그대로 그린다. (영어 자막은 앞단 translateSubtitleToKorean 에서 한글화)
  async function toEnglishForCanvas(text) {
    return text;
  }

  // 한글 Canvas 폰트 사전 로드 (최초 1회)
  const KR_FONT_FAMILY = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  let _krFontLoaded = false;
  async function ensureKrFont(fontSize) {
    if (_krFontLoaded) return;
    try {
      await document.fonts.load(`bold ${fontSize}px "Noto Sans KR"`);
      _krFontLoaded = true;
    } catch (_) {}
  }

  // 자막 텍스트를 Canvas에 그리는 공통 함수
  function drawSubtitleOnCanvas(ctx, segments, canvasW, canvasH, fontSize) {
    const lineH     = Math.round(fontSize * 1.65);
    const padBottom = Math.round(canvasH * 0.04);
    const bPadX = 24, bPadY = 10, bRadius = 10;
    const cx    = canvasW / 2;

    ctx.font         = `bold ${fontSize}px ${KR_FONT_FAMILY}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth    = Math.max(3, Math.round(fontSize * 0.08));

    let baseY = canvasH - padBottom;

    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      const tw  = ctx.measureText(seg).width;
      const bx  = cx - tw / 2 - bPadX;
      const bw  = tw + bPadX * 2;
      const by  = baseY - fontSize - bPadY;
      const bh  = fontSize + bPadY * 2;

      // 반투명 배경 박스
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, bRadius);
      else               ctx.rect(bx, by, bw, bh);
      ctx.fill();

      // 외곽선
      ctx.shadowColor = 'rgba(0,0,0,1)';
      ctx.shadowBlur  = 8;
      ctx.strokeStyle = '#000';
      ctx.strokeText(seg, cx, baseY);

      // 흰 텍스트
      ctx.shadowBlur = 0;
      ctx.fillStyle  = '#ffffff';
      ctx.fillText(seg, cx, baseY);

      baseY -= lineH;
    }
  }

  // ── 영어 자막 → 한글 정확 번역 ───────────────────────────────────────
  //  이미지에 입히기 전, 영어(라틴 문자) 자막을 자연스러운 한글로 번역한다.
  //  이미 한글이거나 빈 값이면 그대로 둔다. 번역 실패 시 원문을 유지한다.
  async function translateSubtitleToKorean(text) {
    const t = (text || '').trim();
    if (!t) return t;
    const hasLatin  = /[A-Za-z]/.test(t);
    const hasHangul = /[가-힣]/.test(t);
    if (!hasLatin || hasHangul) return t;   // 영어가 없거나 이미 한글 포함 → 번역 불필요
    try {
      const ko = await callGemini(
        '다음 영어 자막을 영상 자막으로 쓸 수 있도록 자연스럽고 정확한 한국어로 번역하세요. ' +
        '의미를 그대로 살리되 간결하게, 번역문만 출력하세요(따옴표·설명·원문 없이):\n\n' + t
      );
      const out = (ko || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
      return out || t;
    } catch (e) {
      return t;   // 번역 실패 → 원문 유지
    }
  }

  async function overlaySubtitle(imgSrc, text, maxChars = 30) {
    if (!text) return imgSrc;

    // 한글이면 영어로 자동 번역
    const displayText = await toEnglishForCanvas(text);
    const segments = splitSubtitleSemantic(displayText, maxChars);
    const img      = await new Promise((res, rej) => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => res(im); im.onerror = rej; im.src = imgSrc;
    }).catch(() => null);
    if (!img) return imgSrc;

    const fontSize = Math.round(img.height * 0.058);
    await ensureKrFont(fontSize);

    const canvas = document.createElement('canvas');
    canvas.width  = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    drawSubtitleOnCanvas(ctx, segments, img.width, img.height, fontSize);

    return canvas.toDataURL('image/png');
  }

  // ── 자막 글자수 카운터 + 분할 미리보기 ────────────────────────────
  window.updateSubCount = (idx) => {
    const ta       = document.getElementById(`img-sub-${idx}`);
    const countEl  = document.getElementById(`sub-count-${idx}`);
    const warnEl   = document.getElementById(`sub-warn-${idx}`);
    const maxEl    = document.getElementById(`sub-max-${idx}`);
    if (!ta || !countEl) return;
    const len = ta.value.length;
    const max = parseInt(maxEl?.value || '30', 10);

    countEl.textContent = `${len}자`;
    countEl.className = len > max
      ? 'text-red-400 font-semibold'
      : len > max * 0.85
        ? 'text-yellow-400'
        : 'text-slate-400';

    if (warnEl) {
      if (len > max) {
        const segs = splitSubtitleSemantic(ta.value, max);
        warnEl.innerHTML = `<span class="text-orange-400 font-semibold">→ ${segs.length}개 자막으로 분할:</span> ` +
          segs.map((s, i) =>
            `<span class="inline-block bg-slate-700 text-slate-200 rounded px-1.5 py-0.5 mr-1 mt-0.5">[${i + 1}] ${s}</span>`
          ).join('');
        warnEl.classList.remove('hidden');
      } else {
        warnEl.classList.add('hidden');
      }
    }
  };

  window.applySubLimit = (idx) => {
    updateSubCount(idx); // 이제 "자르기"는 분할 미리보기만 갱신
  };

  // ── 검증 개선 제안 자동 적용 ───────────────────────────────────────
  window.improvePromptFromVal = async (idx) => {
    const valEl    = document.getElementById(`grok-val-${idx}`);
    const promptEl = document.getElementById(`img-prompt-${idx}`);
    const cutEl    = document.getElementById(`img-cut-${idx}`);
    if (!valEl || !promptEl) return;

    const currentPrompt = promptEl.value.trim();
    const suggestion    = valEl.innerText.trim();
    const cutDesc       = cutEl?.value.trim() || (_imageCards[idx]?.cutDescription ?? '');

    const btn = valEl.querySelector('button');
    if (btn) { btn.textContent = '개선 중…'; btn.disabled = true; }

    try {
      const improved = await geminiChat(
        '당신은 AI 이미지 생성 프롬프트 최적화 전문가입니다. 아래 피드백을 반영하여 영어 프롬프트를 개선해주세요. 반드시 영어로만 작성하고, 프롬프트 텍스트만 출력하세요 (설명, 부연 없이).',
        [{ role: 'user', parts: [{ text: `현재 프롬프트:\n${currentPrompt}\n\n장면 묘사 (참고):\n${cutDesc}\n\n검증 피드백 및 개선 제안:\n${suggestion}` }] }]
      );
      const cleaned = improved.replace(/^```[a-z]*\n?|```$/gm, '').trim();
      promptEl.value = cleaned;
      // 검증창에 완료 메시지 추가
      if (btn) {
        btn.textContent = '✅ 적용 완료 — 재생성 버튼을 눌러주세요';
        btn.className = 'mt-1 text-[11px] text-green-300 font-semibold cursor-default';
        btn.onclick = null;
      }
    } catch (e) {
      if (btn) { btn.textContent = '오류: ' + e.message; btn.disabled = false; }
    }
  };

  window.regenWithSub = async (idx) => {
    const imgEl = document.getElementById(`grok-img-el-${idx}`);
    const dlEl  = document.getElementById(`grok-dl-${idx}`);
    const remotionBtn = document.getElementById(`grok-remotion-${idx}`);
    const toggleBtn = document.getElementById(`sub-toggle-btn-${idx}`);
    if (!imgEl || !imgEl.src || imgEl.src === window.location.href) return;

    const rawSrc = imgEl.dataset.rawSrc || imgEl.src;
    imgEl.dataset.rawSrc = rawSrc;

    // 자막 textarea가 비어있으면 원본 카드 자막으로 채우기
    const subEl = document.getElementById(`img-sub-${idx}`);
    if (subEl && !subEl.value.trim()) {
      subEl.value = _imageCards[idx]?.subtitles ?? '';
      updateSubCount(idx);
    }

    let subText = subEl?.value.trim() ?? '';
    if (!subText) {
      alert('적용할 자막 텍스트가 없습니다. 아래 [자막 텍스트] 입력란을 작성해주세요.');
      return;
    }
    // 영어 자막이면 한글로 정확히 번역 → 문법 교정
    subText = await translateSubtitleToKorean(subText);
    if (window.validateKoreanText && subText) subText = window.validateKoreanText(subText);
    const subMax  = parseInt(document.getElementById(`sub-max-${idx}`)?.value || '30', 10);
    const finalSrc = await overlaySubtitle(rawSrc, subText, subMax);
    imgEl.src = finalSrc;
    imgEl.dataset.hasSubtitle = 'true';
    dlEl.href = finalSrc;
    if (remotionBtn) remotionBtn.dataset.src = finalSrc;
    if (toggleBtn) {
      toggleBtn.textContent = '💬 자막 제거';
      toggleBtn.className = 'text-xs bg-indigo-700/80 hover:bg-indigo-600 text-indigo-100 font-bold px-3 py-1 rounded-lg transition';
    }
  };

  // ── 영상 내보내기 (브라우저 MediaRecorder — 세그먼트별 순차 자막) ──────
  // ── 카드별 개별 영상 내보내기 (공통 렌더러 사용) ──────────────────
  window.sendToRemotion = async (btn) => {
    const src     = btn.dataset.src;
    const idx     = Number(btn.dataset.idx);
    const subText = (document.getElementById(`img-sub-${idx}`)?.value ?? _imageCards[idx]?.subtitles ?? '').trim();
    const subMax  = parseInt(document.getElementById(`sub-max-${idx}`)?.value || '30', 10);
    const origBtn = btn.textContent;
    btn.textContent = '🎞️ 인코딩 중…'; btn.disabled = true;
    try {
      const blob = await renderSceneToWebM(src, subText, subMax);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `scene-${idx + 1}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch(e) {
      alert('영상 내보내기 실패: ' + e.message);
    } finally {
      btn.textContent = origBtn; btn.disabled = false;
    }
  };

  // Phosphene 옵션 패널 토글
  window.togglePhospheneOpts = (idx) => {
    document.getElementById(`phosphene-opts-${idx}`)?.classList.toggle('hidden');
  };

  // ── Phosphene 이미지→영상 생성 (로컬 MLX LTX-2) ─────────────────────
  //  카드의 원본 이미지를 Phosphene 패널(/upload)에 올린 뒤 /queue/add(mode=i2v)로
  //  영상 작업을 큐에 넣고, /status 를 폴링해 완료되면 mp4 를 재생/다운로드한다.
  window.generatePhospheneVideo = async (idx) => {
    const imgEl    = document.getElementById(`grok-img-el-${idx}`);
    const btn      = document.getElementById(`grok-phosphene-video-${idx}`);
    const statusEl = document.getElementById(`phosphene-status-${idx}`);
    const resultEl = document.getElementById(`phosphene-result-${idx}`);
    if (!imgEl || !imgEl.src || imgEl.src === window.location.href) return;

    // 자막 없는 원본(rawSrc) 우선 사용 — 영상엔 자막을 굽지 않는다
    const src = imgEl.dataset.rawSrc || imgEl.src;
    const b64 = (src.split(',')[1] || '').trim();
    if (!b64) { alert('이미지 데이터를 찾을 수 없습니다.'); return; }

    // ── 옵션 읽기 (옵션 UI 값 → 기본값 폴백) ──
    const [optW, optH] = (document.getElementById(`phos-res-${idx}`)?.value || '1024x576')
                         .split('x').map(n => parseInt(n, 10));
    const optFrames  = parseInt(document.getElementById(`phos-frames-${idx}`)?.value || '121', 10);
    const optQuality = document.getElementById(`phos-quality-${idx}`)?.value || 'balanced';
    const userMotion = (document.getElementById(`phos-prompt-${idx}`)?.value || '').trim();

    // i2v 모션 프롬프트: 사용자 입력 우선 → 없으면 영어 이미지 프롬프트(글자 지시 제거)
    const rawPrompt = (document.getElementById(`img-prompt-${idx}`)?.value
                       || _imageCards[idx]?.prompt || '').trim();
    const motionPrompt = userMotion
                         || (window.stripTextInstructions ? window.stripTextInstructions(rawPrompt) : rawPrompt)
                         || 'subtle cinematic camera motion, natural movement';

    const origBtn = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '영상 생성 중…'; }
    const setStatus = (msg) => { if (statusEl) { statusEl.classList.remove('hidden'); statusEl.textContent = msg; } };

    try {
      // 0) 패널 연결 확인
      const health = await fetch('/api/phosphene/health').then(r => r.json()).catch(() => ({ ok: false }));
      if (!health.ok) throw new Error('Phosphene 패널이 꺼져 있습니다. Pinokio에서 Phosphene을 실행하세요.');

      // 1) 이미지 업로드 → 패널 서버상의 경로 확보
      setStatus('① 이미지 업로드 중…');
      const up = await fetch('/api/phosphene/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: b64, filename: `card-${idx + 1}.png` }),
      }).then(r => r.json());
      if (!up.path) throw new Error(up.error || '업로드 실패');

      // 2) i2v 영상 작업 큐에 추가
      setStatus('② 영상 작업 큐 등록 중…');
      const gen = await fetch('/api/phosphene/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'i2v', image: up.path, prompt: motionPrompt,
          width: optW || 1024, height: optH || 576,
          frames: optFrames || 121, quality: optQuality,
          label: `장면 ${idx + 1}`,
        }),
      }).then(r => r.json());
      const jobId = gen.id || gen.job_id;
      if (!jobId) throw new Error(gen.error || '작업 등록 실패');

      // 3) 완료까지 /status 폴링 (로컬 MLX 생성 — 수 분 소요)
      const terminal = new Set(['done', 'failed', 'cancelled', 'error']);
      let result = null;
      for (let t = 0; t < 240; t++) {   // 최대 ~60분 (15초 간격)
        await new Promise(r => setTimeout(r, 15000));
        const raw = await fetch('/api/phosphene/status').then(r => r.text()).catch(() => '');
        let st; try { st = JSON.parse(raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ')); } catch { continue; }
        const pools = [st.current ? [st.current] : [], st.queue || [], st.history || []];
        let job = null;
        for (const pool of pools) { for (const j of pool) { if (j && j.id === jobId) { job = j; break; } } if (job) break; }
        if (!job) { setStatus('③ 대기 중…'); continue; }
        if (terminal.has(job.status)) { result = job; break; }
        const prog = job.progress?.phase_label || job.status || 'running';
        setStatus(`③ 생성 중… (${prog})`);
      }
      if (!result) throw new Error('시간 초과 — 패널의 큐를 확인하세요.');
      if (result.status !== 'done') throw new Error(result.error || `생성 실패 (${result.status})`);

      // 4) 결과 mp4 표시
      const outPath = result.output_path || result.raw_path;
      if (!outPath) throw new Error('출력 경로가 없습니다.');
      const fileUrl = `/api/phosphene/file?path=${encodeURIComponent(outPath)}`;
      setStatus(`✅ 완료 (${Math.round(result.elapsed_sec || 0)}초)`);
      if (resultEl) {
        resultEl.classList.remove('hidden');
        resultEl.innerHTML =
          `<video src="${fileUrl}" controls class="w-full rounded-xl border border-indigo-700"></video>` +
          `<a href="${fileUrl}" download="phosphene-${idx + 1}.mp4" ` +
          `class="inline-block mt-1 text-xs text-indigo-300 hover:text-indigo-200 underline font-semibold">⬇ 영상 다운로드</a>`;
      }
    } catch (e) {
      setStatus('오류: ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origBtn; }
    }
  };

  // ── Grok 이미지→영상 생성 ──────────────────────────────────────────

  // ── Grok Bridge / Flow Bridge Extension 연동 ────────────────────────────
  let _grokBridgeReady = false;
  // _flowBridgeReady는 이미 상단에 정의됨
  let _grokBridgeCallbacks = new Map(); // jobId → {resolve, reject}
  let _flowBridgeCallbacks = new Map();

  function _updateBridgeBadge() {
    const badge = document.getElementById('grokBridgeBadge');
    if (!badge) return;
    if (_flowBridgeReady) {
      badge.textContent = '🌊 Flow Bridge 연결됨 (Veo 2 사용)';
      badge.className = 'text-[10px] bg-teal-900/60 text-teal-300 px-2 py-0.5 rounded-full';
    } else if (_grokBridgeReady) {
      badge.textContent = '🌉 Grok Bridge 연결됨';
      badge.className = 'text-[10px] bg-green-900/60 text-green-400 px-2 py-0.5 rounded-full';
    } else {
      badge.textContent = '🌉 Bridge 미연결';
      badge.className = 'text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full';
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'GROK_BRIDGE_READY') {
      _grokBridgeReady = true;
      console.log('[GrokBridge] Extension 연결됨 v' + msg.version);
      _updateBridgeBadge();
    }

    if (msg.type === 'FLOW_BRIDGE_READY') {
      _flowBridgeReady = true;
      console.log('[FlowBridge] Extension 연결됨 v' + msg.version);
      _updateBridgeBadge();
    }

    if (msg.type === 'GROK_RESULT_PUSH') {
      const cb = _grokBridgeCallbacks.get(msg.jobId);
      if (cb) {
        _grokBridgeCallbacks.delete(msg.jobId);
        if (msg.error) cb.reject(new Error(msg.error));
        else           cb.resolve({ url: msg.url, mediaType: msg.mediaType });
      }
    }

    if (msg.type === 'FLOW_RESULT_PUSH') {
      const cb = _flowBridgeCallbacks.get(msg.jobId);
      if (cb) {
        _flowBridgeCallbacks.delete(msg.jobId);
        if (msg.error) cb.reject(new Error(msg.error));
        else           cb.resolve({ url: msg.url, mediaType: msg.mediaType });
      }
    }
  });

  function grokBridgeGenerate(mode, prompt, imageDataUrl = null) {
    if (!_grokBridgeReady) return Promise.reject(new Error('Grok Bridge Extension이 설치되어 있지 않습니다.'));
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      _grokBridgeCallbacks.set(jobId, { resolve, reject });
      window.postMessage({ type: 'GROK_GENERATE', jobId, mode, prompt, imageDataUrl }, '*');
      // 5분 타임아웃
      setTimeout(() => {
        if (_grokBridgeCallbacks.has(jobId)) {
          _grokBridgeCallbacks.delete(jobId);
          reject(new Error('생성 시간 초과 (5분)'));
        }
      }, 5 * 60 * 1000);
    });
  }

  window.isGrokBridgeReady  = () => _grokBridgeReady;
  window.isFlowBridgeReady  = () => _flowBridgeReady;

  function flowBridgeGenerate(mode, prompt, imageDataUrl = null) {
    if (!_flowBridgeReady) return Promise.reject(new Error('Flow Bridge Extension이 설치되어 있지 않습니다.'));
    const jobId = `flow_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      _flowBridgeCallbacks.set(jobId, { resolve, reject });
      window.postMessage({ type: 'FLOW_GENERATE', jobId, mode, prompt, imageDataUrl }, '*');
      setTimeout(() => {
        if (_flowBridgeCallbacks.has(jobId)) {
          _flowBridgeCallbacks.delete(jobId);
          reject(new Error('Flow 생성 시간 초과 (5분)'));
        }
      }, 5 * 60 * 1000);
    });
  }

window.generateGrokVideo = async (idx) => {
    const card    = _imageCards[idx];
    const btn     = document.getElementById(`grok-xai-video-${idx}`);
    const statusEl = document.getElementById(`grok-video-status-${idx}`);
    const imgEl   = document.getElementById(`grok-img-el-${idx}`);
    const origBtn = btn?.textContent;

    // Flow Bridge 우선 → Grok Bridge → xAI API
    if (_flowBridgeReady) {
      await _generateFlowVideoViaExtension(idx);
      return;
    }
    if (_grokBridgeReady) {
      await _generateGrokVideoViaExtension(idx);
      return;
    }

    if (!XAI_API_KEY) {
      alert('xAI API 키가 없습니다.\n\n✅ 권장: Flow Bridge 또는 Grok Bridge Extension 설치\n또는 api.x.ai에서 API 키를 발급하여 입력해주세요.');
      return;
    }

    // 프롬프트: 이미지 프롬프트 + 자막 내용 결합
    const imgPrompt = document.getElementById(`img-prompt-${idx}`)?.value.trim() || card?.prompt || '';
    const subText   = document.getElementById(`img-sub-${idx}`)?.value.trim()   || card?.subtitles || '';
    const cutDesc   = document.getElementById(`img-cut-${idx}`)?.value.trim()   || card?.cutDescription || '';

    // Grok 영상 프롬프트 구성 (영문)
    let videoPrompt = imgPrompt;
    if (cutDesc) videoPrompt += `. ${cutDesc}`;
    if (subText) videoPrompt += `. Show text overlay: "${subText}"`;
    videoPrompt += '. Cinematic, 4K, YouTube style, smooth camera movement.';

    if (btn)     { btn.textContent = '🎬 생성 요청 중…'; btn.disabled = true; }
    if (statusEl){ statusEl.classList.remove('hidden'); statusEl.textContent = '⏳ Grok에 영상 생성 요청 중…'; }

    try {
      // 이미지→영상: imgbb로 업로드해 공개 URL 확보 (IMGBB_API_KEY 있을 때)
      let image_url = null;
      const rawSrc = imgEl?.dataset?.rawSrc || imgEl?.src;
      if (rawSrc && rawSrc.startsWith('data:') && IMGBB_API_KEY) {
        if (statusEl) statusEl.textContent = '⏳ 이미지 업로드 중 (imgbb)…';
        const b64 = rawSrc.split(',')[1];
        const upRes = await fetch('/api/proxy/imgbb-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: b64 }),
        });
        const upData = await upRes.json();
        image_url = upData?.data?.url || null;
      }

      // Grok 영상 생성 요청
      if (statusEl) statusEl.textContent = image_url
        ? '⏳ Grok 이미지→영상 생성 중 (약 30~60초)…'
        : '⏳ Grok 텍스트→영상 생성 중 (약 30~60초)…';

      const res = await fetch('/api/proxy/grok-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: videoPrompt,
          duration: 10,
          aspect_ratio: '16:9',
          resolution: '720p',
          ...(image_url ? { image_url } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || JSON.stringify(data).slice(0, 200));

      const request_id = data.request_id || data.id;
      if (!request_id) throw new Error('request_id 없음: ' + JSON.stringify(data).slice(0, 200));

      // 폴링 (3초마다, 최대 3분)
      if (statusEl) statusEl.textContent = `⏳ 영상 생성 중… (ID: ${request_id.slice(0, 8)}…)`;
      let videoUrl = null;
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise(r => setTimeout(r, 3000));
        const pollRes  = await fetch(`/api/proxy/grok-video/${request_id}`);
        const pollData = await pollRes.json();
        if (statusEl) statusEl.textContent = `⏳ 생성 중… (${attempt + 1}/60) — 상태: ${pollData.status || '?'}`;
        if (pollData.status === 'done' && pollData.video?.url) {
          videoUrl = pollData.video.url; break;
        }
        if (pollData.status === 'failed' || pollData.status === 'expired') {
          throw new Error(`생성 실패: ${pollData.status}`);
        }
      }
      if (!videoUrl) throw new Error('타임아웃: 3분 내 완료되지 않았습니다.');

      // URL 저장 (concat에서 재사용)
      if (_imageCards[idx]) _imageCards[idx].grokVideoUrl = videoUrl;

      if (statusEl) statusEl.innerHTML =
        `✅ 완료! <a href="${videoUrl}" target="_blank" download="grok-scene-${idx+1}.mp4"
          class="text-rose-400 underline font-semibold">🎬 MP4 다운로드</a>
         <span class="text-slate-500 ml-2 text-[10px]">(링크 유효시간: 약 24시간)</span>`;

    } catch (e) {
      if (statusEl) statusEl.innerHTML = `<span class="text-red-400">❌ 오류: ${e.message}</span>`;
    } finally {
      if (btn) { btn.textContent = origBtn; btn.disabled = false; }
    }
  };

  window.generateAllGrokImages = async () => {
    for (let i = 0; i < _imageCards.length; i++) {
      await generateSingleGrokImage(i);
    }
  };

  // ── 전체 카드 Grok 영상 생성 → ffmpeg concat ────────────────────
  window.generateAllGrokAndConcat = async () => {
    if (!XAI_API_KEY) {
      alert('xAI API 키가 필요합니다.\n.env 파일의 XAI_API_KEY를 확인하세요.'); return;
    }
    if (!_imageCards.length) {
      alert('먼저 이미지 카드를 생성해주세요.'); return;
    }

    const btn = document.getElementById('grokConcatBtn');
    const logEl = document.getElementById('grokConcatLog');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 처리 중…'; }
    const log = (msg) => { if (logEl) logEl.textContent = msg; };

    try {
      const videoUrls = [];

      for (let i = 0; i < _imageCards.length; i++) {
        const card = _imageCards[i];

        // 이미 생성된 URL 재사용
        if (card.grokVideoUrl) {
          log(`[${i+1}/${_imageCards.length}] 장면 ${i+1}: 기존 URL 재사용`);
          videoUrls.push(card.grokVideoUrl);
          continue;
        }

        log(`[${i+1}/${_imageCards.length}] 장면 ${i+1}: 이미지 업로드 중…`);

        // 이미지 URL 확보 (imgbb 업로드)
        let image_url = null;
        const imgEl = document.getElementById(`grok-img-el-${i}`);
        const rawSrc = imgEl?.dataset?.rawSrc || imgEl?.src;
        if (rawSrc && rawSrc.startsWith('data:') && IMGBB_API_KEY) {
          const b64 = rawSrc.split(',')[1];
          const upRes = await fetch('/api/proxy/imgbb-upload', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: b64 }),
          });
          const upData = await upRes.json();
          image_url = upData?.data?.url || null;
        }

        // 프롬프트 구성
        const imgPrompt = document.getElementById(`img-prompt-${i}`)?.value.trim() || card.prompt || '';
        const subText   = document.getElementById(`img-sub-${i}`)?.value.trim()    || card.subtitles || '';
        const cutDesc   = document.getElementById(`img-cut-${i}`)?.value.trim()    || card.cutDescription || '';
        let videoPrompt = imgPrompt;
        if (cutDesc) videoPrompt += `. ${cutDesc}`;
        if (subText) videoPrompt += `. Show text overlay: "${subText}"`;
        videoPrompt += '. Cinematic, 4K, YouTube style, smooth camera movement.';

        log(`[${i+1}/${_imageCards.length}] 장면 ${i+1}: Grok 영상 요청 중…`);

        const res = await fetch('/api/proxy/grok-video', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: videoPrompt, duration: 10, aspect_ratio: '16:9', resolution: '720p',
            ...(image_url ? { image_url } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`장면 ${i+1} 요청 실패: ${data.error || JSON.stringify(data).slice(0,100)}`);

        const request_id = data.request_id || data.id;
        if (!request_id) throw new Error(`장면 ${i+1}: request_id 없음`);

        // 폴링
        let videoUrl = null;
        for (let attempt = 0; attempt < 60; attempt++) {
          await new Promise(r => setTimeout(r, 3000));
          const pollRes  = await fetch(`/api/proxy/grok-video/${request_id}`);
          const pollData = await pollRes.json();
          log(`[${i+1}/${_imageCards.length}] 장면 ${i+1}: 생성 중 (${attempt+1}/60) — ${pollData.status || '?'}`);
          if (pollData.status === 'done' && pollData.video?.url) { videoUrl = pollData.video.url; break; }
          if (pollData.status === 'failed' || pollData.status === 'expired')
            throw new Error(`장면 ${i+1} 생성 실패: ${pollData.status}`);
        }
        if (!videoUrl) throw new Error(`장면 ${i+1}: 타임아웃`);

        card.grokVideoUrl = videoUrl;
        const statusEl = document.getElementById(`grok-video-status-${i}`);
        if (statusEl) {
          statusEl.classList.remove('hidden');
          statusEl.innerHTML = `✅ <a href="${videoUrl}" target="_blank" download="grok-scene-${i+1}.mp4"
            class="text-rose-400 underline font-semibold">🎬 개별 다운로드</a>`;
        }
        videoUrls.push(videoUrl);
      }

      // 모든 영상 concat
      log(`✅ 전체 ${videoUrls.length}개 영상 준비 완료. ffmpeg concat 중…`);
      const concatRes = await fetch('/api/proxy/grok-video-concat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_urls: videoUrls }),
      });

      if (!concatRes.ok) {
        const err = await concatRes.json();
        throw new Error(err.error || 'concat 실패');
      }

      const blob = await concatRes.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl; a.download = `grok_concat_${Date.now()}.mp4`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

      log(`🎉 완료! ${videoUrls.length}개 영상이 하나의 MP4로 합쳐졌습니다.`);

    } catch (e) {
      log(`❌ 오류: ${e.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🎬 전체 영상 생성 + 합치기'; }
    }
  };

  // ── 전체 카드 일괄 Phosphene 영상화 → ffmpeg concat ──────────────────
  //  모든 카드 이미지를 순차로 i2v 영상화(Phosphene은 단일 큐라 자연히 직렬)한 뒤,
  //  로컬 mp4 경로들을 /api/phosphene/concat 로 이어붙여 하나의 MP4로 내려받는다.
  window.generateAllPhospheneVideos = async () => {
    if (!_imageCards.length) { alert('먼저 이미지 카드를 생성해주세요.'); return; }

    // concat 안정성을 위해 모든 클립을 동일 설정으로 생성
    const BATCH = { width: 736, height: 416, frames: 121, quality: 'balanced' };
    const ok = confirm(
      `전체 ${_imageCards.length}개 카드를 Phosphene으로 영상화합니다.\n` +
      `설정: ${BATCH.width}×${BATCH.height} · 5초 · ${BATCH.quality}\n` +
      `로컬 MLX 렌더라 카드당 수 분 걸립니다 (순차 처리).\n\n계속하시겠습니까?`);
    if (!ok) return;

    const btn   = document.getElementById('phospheneConcatBtn');
    const logEl = document.getElementById('phospheneConcatLog');
    const log = (m) => { if (logEl) logEl.textContent = m; };
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 처리 중…'; }

    try {
      const health = await fetch('/api/phosphene/health').then(r => r.json()).catch(() => ({ ok: false }));
      if (!health.ok) throw new Error('Phosphene 패널이 꺼져 있습니다. Pinokio에서 실행하세요.');

      const outPaths = [];
      const total = _imageCards.length;
      for (let i = 0; i < total; i++) {
        const card = _imageCards[i];

        // 이미 만든 클립 재사용
        if (card.phospheneOutputPath) {
          log(`[${i+1}/${total}] 장면 ${i+1}: 기존 클립 재사용`);
          outPaths.push(card.phospheneOutputPath);
          continue;
        }

        const imgEl = document.getElementById(`grok-img-el-${i}`);
        const src = imgEl?.dataset?.rawSrc || imgEl?.src;
        if (!src || !src.startsWith('data:')) { log(`[${i+1}/${total}] 장면 ${i+1}: 이미지 없음 — 건너뜀`); continue; }
        const b64 = src.split(',')[1];

        // 업로드
        log(`[${i+1}/${total}] 장면 ${i+1}: 이미지 업로드 중…`);
        const up = await fetch('/api/phosphene/upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: b64, filename: `card-${i+1}.png` }),
        }).then(r => r.json());
        if (!up.path) throw new Error(`장면 ${i+1} 업로드 실패: ${up.error || ''}`);

        // 모션 프롬프트 (사용자 옵션 입력 우선 → 이미지 프롬프트)
        const userMotion = (document.getElementById(`phos-prompt-${i}`)?.value || '').trim();
        const rawPrompt  = (document.getElementById(`img-prompt-${i}`)?.value || card.prompt || '').trim();
        const motion = userMotion
          || (window.stripTextInstructions ? window.stripTextInstructions(rawPrompt) : rawPrompt)
          || 'subtle cinematic camera motion, natural movement';

        // i2v 작업 등록
        log(`[${i+1}/${total}] 장면 ${i+1}: 영상 작업 큐 등록…`);
        const gen = await fetch('/api/phosphene/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'i2v', image: up.path, prompt: motion, label: `장면 ${i+1}`, ...BATCH }),
        }).then(r => r.json());
        const jobId = gen.id || gen.job_id;
        if (!jobId) throw new Error(`장면 ${i+1} 작업 등록 실패: ${gen.error || ''}`);

        // 폴링 (완료까지)
        const terminal = new Set(['done', 'failed', 'cancelled', 'error']);
        let result = null;
        for (let t = 0; t < 240; t++) {
          await new Promise(r => setTimeout(r, 15000));
          const raw = await fetch('/api/phosphene/status').then(r => r.text()).catch(() => '');
          let st; try { st = JSON.parse(raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ')); } catch { continue; }
          let job = null;
          for (const pool of [st.current ? [st.current] : [], st.queue || [], st.history || []]) {
            for (const j of pool) { if (j && j.id === jobId) { job = j; break; } } if (job) break;
          }
          if (!job) { log(`[${i+1}/${total}] 장면 ${i+1}: 대기 중…`); continue; }
          if (terminal.has(job.status)) { result = job; break; }
          log(`[${i+1}/${total}] 장면 ${i+1}: 생성 중… (${job.progress?.phase_label || job.status})`);
        }
        if (!result || result.status !== 'done') throw new Error(`장면 ${i+1} 실패: ${result?.error || result?.status || '타임아웃'}`);

        const out = result.output_path || result.raw_path;
        card.phospheneOutputPath = out;
        outPaths.push(out);
        log(`[${i+1}/${total}] 장면 ${i+1}: ✅ 완료`);
      }

      if (!outPaths.length) throw new Error('영상화된 클립이 없습니다.');

      // concat
      log(`전체 ${outPaths.length}개 클립 합치는 중 (ffmpeg)…`);
      const concatRes = await fetch('/api/phosphene/concat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: outPaths }),
      });
      if (!concatRes.ok) {
        const err = await concatRes.json().catch(() => ({}));
        throw new Error(err.error || 'concat 실패 (ffmpeg 설치 확인)');
      }
      const blob = await concatRes.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl; a.download = `phosphene_concat_${outPaths.length}scenes.mp4`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      log(`🎉 완료! ${outPaths.length}개 영상이 하나의 MP4로 합쳐졌습니다.`);
    } catch (e) {
      log(`❌ 오류: ${e.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🎬 전체 카드 영상 생성 + 합치기 (Phosphene 로컬 · ffmpeg)'; }
    }
  };

  // ── 순차 생성 모드 ────────────────────────────────────
  let _seqIdx = -1;

  function scrollToCard(idx) {
    const el = document.getElementById(`grok-card-${idx}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateSeqNav(idx) {
    const total   = _imageCards.length;
    const card    = _imageCards[idx] || {};
    const navBar  = document.getElementById('seqNavBar');
    const progEl  = document.getElementById('seqProgress');
    const titleEl = document.getElementById('seqTitle');
    const nextBtn = document.getElementById('seqNextBtn');

    navBar.classList.remove('hidden');
    if (progEl)  progEl.textContent  = `${idx + 1} / ${total}`;
    if (titleEl) titleEl.textContent = card.chapterTitle || `장면 ${idx + 1}`;

    if (nextBtn) {
      const isLast = idx >= total - 1;
      nextBtn.textContent = isLast ? '✅ 완료' : `다음 장 생성 (${idx + 2}/${total}) →`;
      nextBtn.className   = isLast
        ? 'bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold px-4 py-2 rounded-lg transition whitespace-nowrap'
        : 'bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition whitespace-nowrap';
    }
  }

  window.startSeqGeneration = async () => {
    _seqIdx = 0;
    updateSeqNav(0);
    await generateSingleGrokImage(0);
    scrollToCard(0);
  };

  window.nextSeqCard = async () => {
    if (_seqIdx >= _imageCards.length - 1) {
      // 완료
      document.getElementById('seqNavBar').classList.add('hidden');
      _seqIdx = -1;
      return;
    }
    _seqIdx++;
    updateSeqNav(_seqIdx);
    await generateSingleGrokImage(_seqIdx);
    scrollToCard(_seqIdx);
  };


  // ── Grok 영상 생성 패널 ─────────────────────────────────────
  (() => {
    const toggle   = document.getElementById('grokVideoToggle');
    const win      = document.getElementById('grokVideoWindow');
    const closeBtn = document.getElementById('grokVideoCloseBtn');
    if (toggle)   toggle.addEventListener('click', () => {
      const willOpen = !win.classList.contains('open');
      if (willOpen) {
        closeAllPanels('grokVideoWindow');
        // 이미지 미선택 상태면 텍스트 탭으로 초기화
        if (!_grokVideoImgData) switchGrokVideoTab('text');
        refreshGrokCardThumbs();
      }
      win.classList.toggle('open');
    });
    if (closeBtn) closeBtn.addEventListener('click', () => win.classList.remove('open'));

    ['grok-dur', 'grok-ratio', 'grok-res'].forEach(cls => {
      document.querySelectorAll('.' + cls).forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.' + cls).forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    });
  })();

  let _grokVideoTab     = 'text';
  let _grokVideoImgData = null;

  // 카드 이미지 썸네일 자동 불러오기
  function refreshGrokCardThumbs() {
    const strip    = document.getElementById('grokCardThumbStrip');
    const thumbsEl = document.getElementById('grokCardThumbs');
    if (!strip || !thumbsEl || !_imageCards?.length) return;

    const available = _imageCards
      .map((card, i) => ({ card, i, src: document.getElementById(`grok-img-el-${i}`)?.src }))
      .filter(({ src }) => src && src.startsWith('data:'));

    if (!available.length) { strip.classList.add('hidden'); return; }

    strip.classList.remove('hidden');
    thumbsEl.innerHTML = '';

    available.forEach(({ card, i, src }) => {
      const btn = document.createElement('button');
      btn.title = card.chapterTitle || `장면 ${i + 1}`;
      btn.className = 'flex-shrink-0 w-14 h-10 rounded-lg border-2 border-slate-600 hover:border-rose-400 overflow-hidden transition focus:outline-none';
      btn.innerHTML = `<img src="${src}" class="w-full h-full object-cover" />`;
      btn.addEventListener('click', () => {
        // 선택 표시
        thumbsEl.querySelectorAll('button').forEach(b => b.classList.replace('border-rose-400', 'border-slate-600'));
        btn.classList.replace('border-slate-600', 'border-rose-400');

        // 이미지→영상 탭으로 전환 & 이미지 세팅
        switchGrokVideoTab('image');
        _grokVideoImgData = src;

        const nameEl    = document.getElementById('grokVideoImgName');
        const previewEl = document.getElementById('grokVideoImgPreview');
        const imgEl     = document.getElementById('grokVideoImgEl');
        const labelEl   = document.getElementById('grokVideoImgLabel');
        if (nameEl)    nameEl.textContent = card.chapterTitle || `장면 ${i + 1}`;
        if (imgEl)     imgEl.src = src;
        if (labelEl)   labelEl.textContent = `장면 ${i + 1}: ${card.chapterTitle || ''}`;
        if (previewEl) previewEl.classList.remove('hidden');

        // 프롬프트 자동 채우기
        const promptEl = document.getElementById('grokVideoPrompt');
        if (promptEl && !promptEl.value.trim()) {
          const imgPrompt = document.getElementById(`img-prompt-${i}`)?.value.trim() || card.prompt || '';
          const cutDesc   = document.getElementById(`img-cut-${i}`)?.value.trim()    || card.cutDescription || '';
          promptEl.value  = [imgPrompt, cutDesc].filter(Boolean).join('. ');
        }
      });
      thumbsEl.appendChild(btn);
    });
  }
  window.refreshGrokCardThumbs = refreshGrokCardThumbs;

  // 전역 API 키 로드 함수
  async function loadApiKeys() {
    if (!window.GEMINI_API_KEY) {
      try {
        const response = await fetch('/api/config');
        if (response.ok) {
          const config = await response.json();
          window.GEMINI_API_KEY = config.GEMINI_API_KEY;
          window.YOUTUBE_API_KEY = config.YOUTUBE_API_KEY;
          window.GEMINI_MODEL = config.GEMINI_MODEL || 'gemini-3.1-flash-lite';
          console.log('✅ 서버에서 API 키를 로드했습니다.');
        }
      } catch (e) {
        console.log('⚠️ 서버에서 API 키를 가져오지 못했습니다:', e);
      }
    }
  }
  
  // 페이지 로드 시 API 키 자동 로드
  loadApiKeys();

  // window.callGemini는 상단 공통 callGemini 함수 사용

  // 스크립트 이미지 전체 다운로드 함수 (API 키 필요 없음)
  window.downloadAllScriptImages = async () => {
    try {
    // 모든 생성된 이미지 찾기
    const images = [];
    const imageElements = document.querySelectorAll('img[id^="grok-img-el-"], img[src^="data:image"]');
    
    imageElements.forEach((img, index) => {
      if (img.src && img.src.startsWith('data:')) {
        images.push({
          src: img.src,
          index: index
        });
      }
    });
    
    if (images.length === 0) {
      alert('다운로드할 이미지가 없습니다.');
      return;
    }
    
    // JSZip 로드
    if (!window.JSZip) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      document.head.appendChild(script);
      await new Promise(resolve => script.onload = resolve);
    }
    
    const zip = new window.JSZip();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const timeStr = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
    
    // 이미지 추가 (1.png, 2.png, ...)
    images.forEach((image, i) => {
      const base64 = image.src.split(',')[1];
      zip.file(`${i + 1}.png`, base64, { base64: true });
    });
    
    // 스크립트 정보 추가
    const scriptTitle = document.querySelector('h3')?.textContent || '스크립트';
    const scriptInfo = `생성 일시: ${new Date().toLocaleString('ko-KR')}\n` +
                      `스크립트 제목: ${scriptTitle}\n` +
                      `이미지 개수: ${images.length}개\n\n` +
                      `참고: 각 이미지는 스크립트의 각 장면에 해당합니다.`;
    zip.file('info.txt', scriptInfo);
    
    // ZIP 생성 및 다운로드
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `script_images_${timestamp}_${timeStr}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log(`✅ ${images.length}개 이미지가 ZIP으로 다운로드되었습니다.`);
    } catch (error) {
      console.error('이미지 다운로드 오류:', error);
      alert('이미지 다운로드 중 오류가 발생했습니다.');
    }
  };

  // 간단한 이미지 다운로드 함수 (API 키 불필요)
  window.quickDownloadImages = () => {
    const images = Array.from(document.querySelectorAll('img[src^="data:"]'));
    if (images.length === 0) {
      alert('다운로드할 이미지가 없습니다.');
      return;
    }
    
    images.forEach((img, i) => {
      const a = document.createElement('a');
      a.href = img.src;
      a.download = `image_${i + 1}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
    
    alert(`${images.length}개 이미지를 다운로드했습니다.`);
  };

  // 스크립트 페이지에 다운로드 버튼 추가
  window.addScriptImageDownloadButton = () => {
    // 기존 버튼이 있으면 제거
    const existingBtn = document.getElementById('downloadAllScriptImagesBtn');
    if (existingBtn) existingBtn.remove();
    
    // AI 자동 채우기 버튼 찾기
    const aiButton = document.querySelector('button[class*="AI"], button:has(.text-purple-400)');
    const targetContainer = aiButton ? aiButton.parentElement : document.querySelector('.flex.items-center.gap-2');
    
    if (targetContainer) {
      // ZIP 다운로드 버튼 생성
      const zipBtn = document.createElement('button');
      zipBtn.id = 'zipDownloadBtn';
      zipBtn.className = 'text-xs font-bold px-3 py-1.5 bg-blue-700/50 hover:bg-blue-600 text-blue-200 border border-blue-700/60 rounded-lg transition';
      zipBtn.innerHTML = '📦 ZIP 다운로드';
      zipBtn.onclick = window.downloadAllScriptImages;
      
      // 개별 다운로드 버튼 생성
      const quickBtn = document.createElement('button');
      quickBtn.id = 'quickDownloadBtn';
      quickBtn.className = 'text-xs font-bold px-3 py-1.5 bg-green-700/50 hover:bg-green-600 text-green-200 border border-green-700/60 rounded-lg transition';
      quickBtn.innerHTML = '📥 개별 다운로드';
      quickBtn.onclick = window.quickDownloadImages;
      
      // 버튼 추가
      if (aiButton) {
        aiButton.parentElement.insertBefore(zipBtn, aiButton.nextSibling);
        aiButton.parentElement.insertBefore(quickBtn, zipBtn.nextSibling);
      } else {
        targetContainer.appendChild(zipBtn);
        targetContainer.appendChild(quickBtn);
      }
      
      console.log('✅ 이미지 다운로드 버튼들이 추가되었습니다.');
    } else {
      console.log('⚠️ 버튼을 추가할 위치를 찾을 수 없습니다.');
      // 대체 위치에 버튼 추가 시도
      const body = document.body;
      const floatingDiv = document.createElement('div');
      floatingDiv.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;gap:10px;';
      
      const zipBtn = document.createElement('button');
      zipBtn.className = 'text-xs font-bold px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white border border-blue-700 rounded-lg transition';
      zipBtn.innerHTML = '📦 ZIP';
      zipBtn.onclick = window.downloadAllScriptImages;
      
      const quickBtn = document.createElement('button');
      quickBtn.className = 'text-xs font-bold px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white border border-green-700 rounded-lg transition';
      quickBtn.innerHTML = '📥 개별';
      quickBtn.onclick = window.quickDownloadImages;
      
      floatingDiv.appendChild(zipBtn);
      floatingDiv.appendChild(quickBtn);
      body.appendChild(floatingDiv);
      
      console.log('✅ 우측 상단에 다운로드 버튼을 추가했습니다.');
    }
  };

  // 페이지가 로드되면 자동으로 버튼 추가 시도
  setTimeout(() => {
    const scriptContainer = document.querySelector('[class*="스크립트"], [class*="script"]');
    if (scriptContainer) {
      window.addScriptImageDownloadButton();
    }
    // Remotion 편집기 버튼도 자동 추가
    window.addRemotionEditorButton();
  }, 2000);
  
  // Remotion 편집기 열기 함수
  window.openRemotionEditor = () => {
    // 현재 페이지의 모든 이미지 수집
    const images = [];
    document.querySelectorAll('img[src^="data:"]').forEach((img, index) => {
      // 이미지 주변의 텍스트 찾기 (선택사항)
      const caption = img.closest('div')?.querySelector('textarea, input[type="text"], p')?.textContent || `장면 ${index + 1}`;
      images.push({
        src: img.src,
        caption: caption.slice(0, 100), // 길이 제한
        duration: 5
      });
    });
    
    // 새 창으로 편집기 열기
    const editorWindow = window.open(
      '/remotion-editor.html',
      'RemotionEditor',
      'width=1400,height=900,menubar=no,toolbar=no,location=no,status=no'
    );
    
    if (editorWindow) {
      // 편집기가 준비되면 이미지 전송
      setTimeout(() => {
        if (images.length > 0) {
          editorWindow.postMessage({
            type: 'ADD_IMAGES',
            images: images
          }, '*');
          console.log(`📤 ${images.length}개 이미지를 편집기로 전송했습니다.`);
        }
      }, 2000);
      
      console.log('🎬 Remotion 편집기를 열었습니다.');
    } else {
      alert('팝업 차단이 해제되어 있는지 확인해주세요.');
    }
  };
  
  // 편집기 버튼 추가 함수
  window.addRemotionEditorButton = () => {
    const existingBtn = document.getElementById('remotionEditorBtn');
    if (existingBtn) existingBtn.remove();
    
    // 화면 우측 하단에 크고 눈에 잘 띄는 버튼 추가
    const floatingBtn = document.createElement('button');
    floatingBtn.id = 'remotionEditorBtn';
    floatingBtn.style.cssText = `
      position: fixed;
      bottom: 30px;
      right: 30px;
      z-index: 99999;
      padding: 16px 24px;
      background: linear-gradient(135deg, #ff6b6b 0%, #feca57 100%);
      color: white;
      border: 3px solid white;
      border-radius: 50px;
      font-weight: bold;
      font-size: 16px;
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.4);
      cursor: pointer;
      transition: all 0.3s ease;
      animation: pulse 2s infinite;
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    floatingBtn.innerHTML = '🎬 <span style="font-size: 18px;">영상 편집기</span>';
    floatingBtn.onclick = window.openRemotionEditor;
    
    // CSS 애니메이션 추가
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.05); }
        100% { transform: scale(1); }
      }
      #remotionEditorBtn:hover {
        transform: scale(1.1) !important;
        box-shadow: 0 12px 35px rgba(0, 0, 0, 0.5) !important;
        background: linear-gradient(135deg, #ff5252 0%, #ffb142 100%) !important;
      }
    `;
    document.head.appendChild(style);
    
    // hover 효과
    floatingBtn.onmouseover = () => {
      floatingBtn.style.transform = 'scale(1.05)';
      floatingBtn.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.6)';
    };
    floatingBtn.onmouseout = () => {
      floatingBtn.style.transform = 'scale(1)';
      floatingBtn.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4)';
    };
    
    document.body.appendChild(floatingBtn);
    console.log('✅ Remotion 편집기 버튼이 추가되었습니다.');
  };

  // Remotion을 사용한 이미지 슬라이드쇼 영상 생성
  window.createVideoFromImages = async () => {
    // 모든 생성된 이미지 수집
    const images = [];
    const imageElements = document.querySelectorAll('img[src^="data:"]');
    
    imageElements.forEach((img, index) => {
      if (img.src && img.src.startsWith('data:')) {
        // 각 이미지에 대한 설명 추가 (선택사항)
        const captionEl = img.closest('div')?.querySelector('textarea, input[type="text"]');
        const caption = captionEl?.value || `장면 ${index + 1}`;
        
        images.push({
          src: img.src,
          caption: caption,
          duration: 5 // 각 이미지 5초
        });
      }
    });
    
    if (images.length === 0) {
      alert('영상으로 변환할 이미지가 없습니다.');
      return;
    }
    
    // 영상 제목 가져오기
    const title = document.querySelector('h3')?.textContent || 
                  document.querySelector('h2')?.textContent || 
                  '스크립트 영상';
    
    console.log(`🎬 ${images.length}개 이미지로 영상을 생성합니다...`);
    
    // Remotion 서버로 요청
    try {
      const response = await fetch('http://localhost:8766/render-slideshow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          composition: 'ImageSlideshow',
          images: images,
          title: title,
          transitionDuration: 15, // 0.5초 트랜지션
          outputPath: `output/slideshow_${Date.now()}.mp4`
        })
      });
      
      if (!response.ok) {
        throw new Error(`Remotion 서버 오류: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      // 영상 다운로드
      if (result.videoUrl) {
        const a = document.createElement('a');
        a.href = result.videoUrl;
        a.download = `${title.replace(/[^a-z0-9]/gi, '_')}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        console.log('✅ 영상이 성공적으로 생성되었습니다!');
        alert(`영상이 생성되었습니다!\n${images.length}개 이미지, 총 ${images.length * 5}초`);
      }
      
    } catch (error) {
      console.error('영상 생성 오류:', error);
      
      // Remotion 서버가 없으면 안내
      if (error.message.includes('fetch')) {
        alert('Remotion 서버가 실행되지 않았습니다.\n\n실행 방법:\ncd remotion && npm start');
      } else {
        alert(`영상 생성 중 오류가 발생했습니다: ${error.message}`);
      }
    }
  };

  // 이미지에서 영상 생성 버튼 추가
  window.addVideoGenerationButton = () => {
    const existingBtn = document.getElementById('generateVideoBtn');
    if (existingBtn) existingBtn.remove();
    
    // 버튼을 추가할 위치 찾기
    const targetContainer = document.querySelector('.flex.items-center.gap-2') || 
                          document.querySelector('[class*="button"]')?.parentElement;
    
    if (targetContainer) {
      const videoBtn = document.createElement('button');
      videoBtn.id = 'generateVideoBtn';
      videoBtn.className = 'text-xs font-bold px-3 py-1.5 bg-purple-700/50 hover:bg-purple-600 text-purple-200 border border-purple-700/60 rounded-lg transition flex items-center gap-1.5';
      videoBtn.innerHTML = '🎬 영상 생성 (Remotion)';
      videoBtn.onclick = window.createVideoFromImages;
      
      targetContainer.appendChild(videoBtn);
      console.log('✅ 영상 생성 버튼이 추가되었습니다.');
    } else {
      // 대체 위치에 floating 버튼 추가
      const floatingBtn = document.createElement('button');
      floatingBtn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;';
      floatingBtn.className = 'text-xs font-bold px-4 py-2 bg-purple-700 hover:bg-purple-600 text-white rounded-lg shadow-lg transition';
      floatingBtn.innerHTML = '🎬 영상 생성';
      floatingBtn.onclick = window.createVideoFromImages;
      document.body.appendChild(floatingBtn);
    }
  };

  // 한국어 문법 검증 함수
  window.validateKoreanText = (text) => {
    if (!text) return text;
    
    // 기본적인 한국어 문법 규칙 검사
    const commonErrors = {
      // 잘못된 조사 사용
      '를을': '를',
      '을를': '을',
      '이가': '이',
      '가이': '가',
      '와과': '와',
      '과와': '과',
      // 잘못된 어미
      '습니다니다': '습니다',
      '니다습니다': '니다',
      // 띄어쓰기 오류
      '안 녕': '안녕',
      '감 사': '감사',
      '고 마': '고마',
      // 흔한 맞춤법 오류
      '되요': '돼요',
      '되서': '돼서',
      '됼다': '됐다',
      '됼어': '됐어',
      '안되요': '안 돼요',
      '안되서': '안 돼서'
    };
    
    let result = text;
    
    // 공통 오류 수정
    for (const [error, correction] of Object.entries(commonErrors)) {
      const regex = new RegExp(error.replace(/[\[\](){}*+?.^$|]/g, '\\$&'), 'gi');
      result = result.replace(regex, correction);
    }
    
    // 여러 공백을 하나로 통합
    result = result.replace(/\s+/g, ' ');
    
    // 한글과 영문 사이 적절한 띄어쓰기
    result = result.replace(/([A-Za-z])([\uac00-\ud7a3])/g, '$1 $2');
    result = result.replace(/([\uac00-\ud7a3])([A-Za-z])/g, '$1 $2');
    
    // 숫자와 한글은 붙여쓰기
    result = result.replace(/([0-9])\s+([\uac00-\ud7a3])/g, '$1$2');
    result = result.replace(/([\uac00-\ud7a3])\s+([0-9])/g, '$1$2');
    
    return result.trim();
  };

  // ── 생성 이미지에서 글자/자막 아티팩트 억제 ──────────────────────────
  //  AI가 이미지 안에 멋대로 그려넣는 글자·워터마크를 없애 "글자 없는" 깨끗한
  //  이미지를 만든다. 실제 자막은 나중에 overlaySubtitle()로 따로 삽입한다.
  const NO_TEXT_DIRECTIVE = 'No text, no words, no letters, no captions, no subtitles, no typography, no watermark, no logo, no signature — a clean image with absolutely no writing of any kind';
  const NO_TEXT_NEGATIVE  = 'text, words, letters, captions, subtitles, typography, watermark, logo, signature, writing, fonts, numbers, gibberish text';
  //  프롬프트 안에 들어간 "텍스트/자막/제목을 화면에 배치"하라는 지시를 제거한다.
  //  (이게 남아 있으면 Imagen 등이 글자를 이미지에 구워버린다 — 예: text overlay "Re-vote?")
  const _Q = '"\'“”‘’';   // 직선/곡선 따옴표
  function stripTextInstructions(input) {
    let s = input || '';
    // 1) "...text/caption/title/words... '인용문'" 형태의 텍스트 지시 + 따옴표 내용 제거
    s = s.replace(
      new RegExp(
        '\\b(?:bold |large |big |small |the |a |an |with |without |add(?:ing)? |adds? |featuring |including |display(?:ing)? |showing |place(?:d|s)? |put(?:ting)? |overlay(?:ing|s)? )*' +
        '(?:text overlays?|on-?screen text|overlay text|caption text|title text|text|captions?|subtitles?|titles?|headlines?|words?|letters?|typography|lettering|writing|inscriptions?|sign(?:age)?|labels?|banners?)' +
        '\\b[^.,;!?' + _Q + ']{0,40}[' + _Q + '][^' + _Q + ']*[' + _Q + ']',
        'gi'
      ), ''
    );
    // 2) "that reads/says '...'" 형태 제거
    s = s.replace(
      new RegExp('\\b(?:that |which )?(?:reads?|says?|saying|stating|spelling(?: out)?|displaying)\\b[^.,;!?' + _Q + ']{0,20}[' + _Q + '][^' + _Q + ']*[' + _Q + ']', 'gi'),
      ''
    );
    // 3) 따옴표 없이 남은 "text overlay / caption text / on-screen text ..." 절 제거
    s = s.replace(/\b(?:with |add(?:ing)? |featuring |including |bold |large )?(?:text overlays?|on-?screen text|overlay text|caption text|title text)\b[^.,;!?]*/gi, '');
    // 정리: 중복 공백/구두점 앞 공백/앞뒤 구두점
    return s.replace(/\s{2,}/g, ' ').replace(/\s+([.,;!?])/g, '$1').replace(/^[\s,;.]+|[\s,]+$/g, '').trim();
  }
  function applyNoText(prompt) {
    let p = (prompt || '').trim();
    const cleaned = stripTextInstructions(p);
    if (cleaned) p = cleaned;                     // 과도 제거로 비면 원문 유지
    if (/no text, no words/i.test(p)) return p;   // 이미 적용됨 → 중복 방지
    return p ? `${p}. ${NO_TEXT_DIRECTIVE}` : NO_TEXT_DIRECTIVE;
  }
  window.applyNoText = applyNoText;
  window.stripTextInstructions = stripTextInstructions;
  window.NO_TEXT_NEGATIVE = NO_TEXT_NEGATIVE;

  // 이미지 생성 (Local SD, Imagen, Stable Diffusion, 또는 Pollinations)
  async function generateImageWithGemini(prompt, size = '1280x768', styleKey = null) {
    // 아시아인/한국인 기본 적용 (서양인 컨텍스트 제외)
    let processedPrompt = window.applyAsianDefault ? window.applyAsianDefault(prompt) : prompt;
    processedPrompt = window.applyStylePreset(processedPrompt, styleKey);

    // IMAGE_MODEL에 따라 분기
    if (IMAGE_MODEL === 'comfyui') {
      try {
        const [width, height] = size.split('x').map(Number);
        return await generateComfyUIImage(processedPrompt, {
          width: width || 768,
          height: height || 448,
          steps: 20,
          cfg: 7.0,
          negative_prompt: window.getStyleNegativePrompt(styleKey)
        });
      } catch (e) {
        console.warn('ComfyUI failed, falling back to Pollinations:', e);
      }
    }
    if (IMAGE_MODEL === 'local-sd') {
      try {
        return await generateImageWithLocalSD(processedPrompt, size, styleKey);
      } catch (e) {
        console.warn('Local SD failed, falling back to Pollinations:', e);
      }
    }
    if (IMAGE_MODEL === 'stability' && STABILITY_API_KEY) {
      try {
        return await generateImageWithStability(processedPrompt, size, styleKey);
      } catch (e) {
        console.warn('Stability AI image failed, falling back to Pollinations:', e);
      }
    }
    if (IMAGE_MODEL === 'pollinations') {
      return await generateImageWithPollinations(processedPrompt, size, styleKey);
    }
    // 기본: Gemini Imagen 시도 후 실패 시 자동 폴백
    try {
      const response = await fetch('/api/proxy/gemini-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: window.applyNoText(processedPrompt),
          model: 'imagen-3.0-generate-002'
        })
      });

      if (response.ok) {
        const data = await response.json();
        const b64 = data.predictions?.[0]?.bytesBase64Encoded || data.image;
        if (b64) {
          return `data:${data.mimeType || 'image/png'};base64,` + b64;
        }
      }
    } catch (e) {
      console.warn('Gemini image failed, falling back to Pollinations:', e);
    }

    // 폴백: Pollinations
    return await generateImageWithPollinations(processedPrompt, size, styleKey);
  }

  // 내 PC Local Stable Diffusion으로 이미지 생성 (MPS Apple Silicon GPU)
  async function generateImageWithLocalSD(prompt, size = '1280x768', styleKey = null) {
    const [width, height] = size.split('x').map(Number);
    let aspectRatio = '16:9';
    if (size === '1024x1024') aspectRatio = '1:1';
    else if (size === '768x1280' || size === '720x1280') aspectRatio = '9:16';

    const styledPrompt = window.applyStylePreset(prompt, styleKey);
    const negativePrompt = window.getStyleNegativePrompt(styleKey);

    const response = await fetch('/api/proxy/local-sd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: window.applyNoText(styledPrompt),
        negative_prompt: negativePrompt,
        width: width || 768,
        height: height || 432,
        aspect_ratio: aspectRatio,
        steps: 4
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error('Local SD 이미지 생성 실패: ' + error);
    }

    const data = await response.json();
    if (data.image) {
      return 'data:image/png;base64,' + data.image;
    }
    return null;
  }

  // Stable Diffusion (Stability AI)으로 이미지 생성
  async function generateImageWithStability(prompt, size = '1280x768', styleKey = null) {
    // size를 aspect_ratio로 변환
    let aspectRatio = '16:9';
    if (size === '1024x1024') aspectRatio = '1:1';
    else if (size === '768x1280' || size === '720x1280') aspectRatio = '9:16';
    else if (size === '1280x768' || size === '1920x1080') aspectRatio = '16:9';

    const styledPrompt = window.applyStylePreset(prompt, styleKey);
    const negativePrompt = window.getStyleNegativePrompt(styleKey);

    const response = await fetch('/api/proxy/stability-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: window.applyNoText(styledPrompt),
        negative_prompt: negativePrompt,
        model: 'sd3.5-large',
        aspect_ratio: aspectRatio,
        output_format: 'png'
      })
    });

    if (!response.ok) {
      let errText = '';
      try {
        const errJson = await response.json();
        errText = errJson.errors?.[0] || errJson.error || errJson.message || JSON.stringify(errJson);
      } catch (_) {
        errText = await response.text();
      }
      throw new Error(`Stable Diffusion (Stability AI) 오류 (${response.status}): ${errText}`);
    }

    const data = await response.json();
    // Stability API는 image를 base64로 반환
    if (data.image) {
      return 'data:image/png;base64,' + data.image;
    }
    return null;
  }

  // Pollinations.ai로 이미지 생성 (무료, API 키 불필요)
  async function generateImageWithPollinations(prompt, size = '1280x768', styleKey = null) {
    const [width, height] = size.split('x').map(Number);
    const styledPrompt = window.applyStylePreset(prompt, styleKey);

    const response = await fetch('/api/proxy/pollinations-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: window.applyNoText(styledPrompt),
        width: width || 1280,
        height: height || 720,
        model: 'flux'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error('Pollinations 이미지 생성 실패: ' + error);
    }

    const data = await response.json();
    if (data.image) {
      return 'data:image/jpeg;base64,' + data.image;
    }
    return null;
  }

  // 이미지 모델 변경 함수
  window.setImageModel = (model) => {
    IMAGE_MODEL = model;
    const btnComfyui = document.getElementById('imgModelComfyui');
    const btnImagen = document.getElementById('imgModelImagen');
    const btnStability = document.getElementById('imgModelStability');
    const btnPollinations = document.getElementById('imgModelPollinations');
    const btnLocalSd = document.getElementById('imgModelLocalSd');
    const onClass = 'py-1.5 px-2 text-xs font-bold rounded-lg transition bg-blue-600 text-white border-blue-500 truncate';
    const offClass = 'py-1.5 px-2 text-xs font-bold rounded-lg transition bg-slate-700 text-slate-300 border-slate-600 truncate';

    const buttons = [
      { el: btnComfyui, name: 'comfyui' },
      { el: btnPollinations, name: 'pollinations' },
      { el: btnLocalSd, name: 'local-sd' },
      { el: btnImagen, name: 'imagen' },
      { el: btnStability, name: 'stability' }
    ];

    buttons.forEach(btn => {
      if (btn.el) {
        const isActive = btn.name === model;
        btn.el.className = isActive ? onClass : offClass;
      }
    });
  };

  // 이미지 다운로드
  window.downloadImage = (dataUrl, filename) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // 전체 이미지 다운로드
  window.downloadAllImages = async () => {
    if (!window._imageCards || window._imageCards.length === 0) {
      alert('다운로드할 이미지가 없습니다.');
      return;
    }
    
    // JSZip 로드
    if (!window.JSZip) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      document.head.appendChild(script);
      await new Promise(resolve => script.onload = resolve);
    }
    
    const zip = new window.JSZip();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const timeStr = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
    
    // 이미지를 순서대로 번호 파일명으로 저장 (1.png, 2.png, ...)
    window._imageCards.forEach((card, i) => {
      if (card.imageSrc && card.imageSrc.startsWith('data:')) {
        const base64 = card.imageSrc.split(',')[1];
        zip.file(`${i + 1}.png`, base64, { base64: true });
      }
    });
    
    // 프롬프트 정보를 텍스트 파일로 추가
    if (window._imageCards.length > 0 && window._imageCards[0].koreanPrompt) {
      const promptInfo = `생성 일시: ${new Date().toLocaleString('ko-KR')}\n\n` +
                        `한국어 프롬프트: ${window._imageCards[0].koreanPrompt}\n\n` +
                        `영어 프롬프트: ${window._imageCards[0].prompt}\n\n` +
                        `이미지 개수: ${window._imageCards.length}개`;
      zip.file('prompt.txt', promptInfo);
    }
    
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `images_${timestamp}_${timeStr}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  window.switchGrokVideoTab = (tab) => {
    _grokVideoTab = tab;
    const tText  = document.getElementById('grokVideoTabText');
    const tImg   = document.getElementById('grokVideoTabImg');
    const imgPnl = document.getElementById('grokVideoImgPanel');
    const on  = 'flex-1 py-2 text-xs font-bold rounded-lg bg-rose-700 text-white border border-rose-600 transition';
    const off = 'flex-1 py-2 text-xs font-bold rounded-lg bg-slate-700 text-slate-300 border border-slate-600 transition';
    if (tab === 'text') {
      tText.className = on; tImg.className = off;
      imgPnl.classList.add('hidden');
    } else {
      tImg.className = on; tText.className = off;
      imgPnl.classList.remove('hidden');
    }
  };

  window.handleGrokVideoImgUpload = (input) => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      _grokVideoImgData = e.target.result;
      const nameEl    = document.getElementById('grokVideoImgName');
      const previewEl = document.getElementById('grokVideoImgPreview');
      const imgEl     = document.getElementById('grokVideoImgEl');
      if (nameEl)    nameEl.textContent = file.name;
      if (imgEl)     imgEl.src = _grokVideoImgData;
      if (previewEl) previewEl.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  };

  window.startGrokVideoGenerate = async () => {
    const promptKo = document.getElementById('grokVideoPrompt')?.value.trim();
    if (!promptKo) { alert('프롬프트를 입력해주세요.'); return; }
    if (_grokVideoTab === 'image' && !_grokVideoImgData) {
      alert('이미지를 먼저 업로드하세요.'); return;
    }
    if (!_flowBridgeReady && !XAI_API_KEY) {
      alert('영상 생성 방법을 선택하세요:\n① Flow Bridge Extension 설치 후 Google Flow 탭 열기 (무료, Veo 2)\n② .env의 XAI_API_KEY 설정 (xAI Grok)');
      return;
    }

    const duration    = document.querySelector('.grok-dur.active')?.dataset.val   || '10';
    const aspectRatio = document.querySelector('.grok-ratio.active')?.dataset.val || '16:9';
    const resolution  = document.querySelector('.grok-res.active')?.dataset.val   || '720p';

    const jobId   = Date.now();
    const queueEl = document.getElementById('grokVideoQueue');
    const jobEl   = document.createElement('div');
    jobEl.id        = 'grok-job-' + jobId;
    jobEl.className = 'bg-slate-900/60 border border-slate-700 rounded-xl p-3';
    jobEl.innerHTML = `
      <div class="flex items-start justify-between gap-2 mb-2">
        <p class="text-[11px] font-semibold text-rose-300 line-clamp-2">${promptKo.slice(0, 70)}${promptKo.length > 70 ? '\u2026' : ''}</p>
        <span class="text-[10px] text-slate-500 whitespace-nowrap flex-shrink-0">${duration}초 · ${aspectRatio}</span>
      </div>
      <p id="grok-job-status-${jobId}" class="text-[11px] text-slate-400">\u23f3 시작 중\u2026</p>
    `;
    queueEl.insertBefore(jobEl, queueEl.firstChild);

    const setStatus = (html) => {
      const el = document.getElementById('grok-job-status-' + jobId);
      if (el) el.innerHTML = html;
    };

    const genBtn = document.getElementById('grokVideoGenerateBtn');
    if (genBtn) { genBtn.disabled = true; genBtn.textContent = '⏳ 생성 중…'; }

    try {
      let videoPrompt = promptKo;
      try {
        setStatus('⏳ 프롬프트 번역 중…');
        const translated = await callGemini(
          'Translate this Korean video prompt into English for an AI video generator.\nOutput ONLY the English prompt, no extra text.\nKorean: ' + promptKo
        );
        videoPrompt = translated.trim();
      } catch (_) {}

      // ── Flow Factory (Google Veo 2) 경로 ─────────────────────────────────
      if (_flowBridgeReady) {
        const mode = (_grokVideoTab === 'image' && _grokVideoImgData) ? 'image_to_video' : 'text_to_video';
        setStatus('⏳ Google Flow (Veo 2) 생성 중… — Flow 탭에서 진행 확인');
        const result = await flowBridgeGenerate(mode, videoPrompt, mode === 'image_to_video' ? _grokVideoImgData : null);
        const videoUrl = result.url;
        const isExternal = !videoUrl.startsWith('blob:') && !videoUrl.includes('labs.google');
        setStatus(
          '✅ Flow Factory 완료! <a href="' + videoUrl + '" target="_blank"' +
          ' class="text-teal-400 underline font-semibold ml-1">🎬 Flow에서 열기</a>' +
          (isExternal ? '<video src="' + videoUrl + '" controls playsinline class="w-full mt-2 rounded-lg border border-slate-700" style="max-height:180px"></video>' : '')
        );
        return;
      }

      // ── xAI Grok 폴백 ────────────────────────────────────────────────────
      let image_url = null;
      if (_grokVideoTab === 'image' && _grokVideoImgData) {
        setStatus('⏳ 이미지 업로드 중…');
        const b64   = _grokVideoImgData.split(',')[1];
        const upRes = await fetch('/api/proxy/imgbb-upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: b64 }),
        });
        const upData = await upRes.json();
        image_url = upData?.data?.url || null;
        if (!image_url) throw new Error('이미지 업로드 실패');
      }

      setStatus(image_url ? '⏳ Grok 이미지→영상 생성 요청 중…' : '⏳ Grok 텍스트→영상 생성 요청 중…');

      const res  = await fetch('/api/proxy/grok-video', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: videoPrompt,
          duration: parseInt(duration),
          aspect_ratio: aspectRatio,
          resolution,
          ...(image_url ? { image_url } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || JSON.stringify(data).slice(0, 200));

      const request_id = data.request_id || data.id;
      if (!request_id) throw new Error('request_id 없음: ' + JSON.stringify(data).slice(0, 200));

      let videoUrl = null;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const pollRes  = await fetch('/api/proxy/grok-video/' + request_id);
        const pollData = await pollRes.json();
        setStatus('⏳ 생성 중… (' + (i + 1) + '/60) — 상태: ' + (pollData.status || '?'));
        if (pollData.status === 'done' && pollData.video?.url) {
          videoUrl = pollData.video.url; break;
        }
        if (pollData.status === 'failed' || pollData.status === 'expired') {
          throw new Error('생성 실패: ' + pollData.status);
        }
      }
      if (!videoUrl) throw new Error('타임아웃: 3분 내 완료되지 않았습니다.');

      setStatus(
        '✅ 완료! <a href="' + videoUrl + '" target="_blank" download="grok-' + jobId + '.mp4"' +
        ' class="text-rose-400 underline font-semibold ml-1">🎬 다운로드</a>' +
        '<video src="' + videoUrl + '" controls playsinline class="w-full mt-2 rounded-lg border border-slate-700" style="max-height:180px"></video>' +
        '<span class="text-[10px] text-slate-500 block mt-1">링크 유효: 약 24시간</span>'
      );

    } catch (e) {
      setStatus('<span class="text-red-400">❌ 오류: ' + e.message + '</span>');
    } finally {
      if (genBtn) { genBtn.disabled = false; genBtn.textContent = '🎥 영상 생성 시작'; }
    }
  };

  // ── 나레이션 TTS ─────────────────────────────────────────────
  (() => {
    const toggle = document.getElementById('ttsToggle');
    const win    = document.getElementById('ttsWindow');
    const closeBtn = document.getElementById('ttsCloseBtn');
    if (toggle) toggle.addEventListener('click', () => {
      const willOpen = !win.classList.contains('open');
      if (willOpen) {
        closeAllPanels('ttsWindow');
        // 카드가 있으면 자동으로 나레이션 불러오기
        setTimeout(() => {
          if (_imageCards?.length && !document.getElementById('ttsSegments')?.children.length) {
            loadNarrationFromCards();
          }
        }, 50);
      }
      win.classList.toggle('open');
    });
    if (closeBtn) closeBtn.addEventListener('click', () => win.classList.remove('open'));
  })();

  // ── TTS 헬퍼 ──────────────────────────────────────────────────
  function _pcmToWav(pcmB64) {
    const pcm = Uint8Array.from(atob(pcmB64), c => c.charCodeAt(0));
    const sr = 24000, ch = 1;
    const buf = new ArrayBuffer(44 + pcm.length);
    const v = new DataView(buf);
    const ws = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    ws(0,'RIFF'); v.setUint32(4, 36 + pcm.length, true); ws(8,'WAVE'); ws(12,'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true);
    v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    ws(36,'data'); v.setUint32(40, pcm.length, true);
    new Uint8Array(buf).set(pcm, 44);
    return new Blob([buf], { type: 'audio/wav' });
  }

  let _ttsAudioBlob = null;
  let _ttsAudioB64  = null;
  let _ttsSegTexts  = [];   // 장면별 편집된 텍스트

  // ── Gemini TTS 음성 샘플 테스트 ──────────────────────────────
  window.testTTSVoice = async () => {
    const voice  = document.getElementById('ttsVoice')?.value || 'Kore';
    const logEl  = document.getElementById('ttsLog');
    const btn    = document.querySelector('button[onclick="testTTSVoice()"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 로딩…'; }
    if (logEl) logEl.textContent = `⏳ ${voice} 음성 샘플 생성 중…`;
    try {
      const res = await fetch('/api/proxy/gemini-tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '안녕하세요. 저는 유튜브 나레이션 음성입니다. 이 목소리가 마음에 드시나요?', voice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '샘플 생성 실패');
      const part = data.candidates?.[0]?.content?.parts?.[0];
      if (!part?.inlineData?.data) throw new Error('오디오 없음');
      const mime = part.inlineData.mimeType || 'audio/pcm';
      const blob = mime.includes('pcm') || mime.includes('l16')
        ? _pcmToWav(part.inlineData.data)
        : new Blob([Uint8Array.from(atob(part.inlineData.data), c => c.charCodeAt(0))], { type: mime });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
      if (logEl) logEl.textContent = `🔊 ${voice} 음성 샘플 재생 중…`;
    } catch (e) {
      if (logEl) logEl.textContent = `❌ 샘플 오류: ${e.message}`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔊 이 음성으로 5초 테스트'; }
    }
  };

  // ── Web Speech API 미리듣기 ────────────────────────────────────
  function _speakText(text) {
    if (!window.speechSynthesis) { alert('이 브라우저는 미리듣기를 지원하지 않습니다.'); return; }
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const rate  = parseFloat(document.getElementById('ttsPreviewRate')?.value || '1.0');
    utter.rate  = rate;
    utter.lang  = 'ko-KR';
    const voices = speechSynthesis.getVoices();
    const kor = voices.find(v => v.lang.startsWith('ko'));
    if (kor) utter.voice = kor;
    speechSynthesis.speak(utter);
  }
  window.previewFullTTS = () => {
    const text = document.getElementById('ttsText')?.value.trim();
    if (!text) { alert('텍스트를 먼저 입력하세요.'); return; }
    _speakText(text);
  };
  window.stopTTSPreview = () => speechSynthesis?.cancel();
  window.previewSegment = (idx) => {
    const ta = document.getElementById(`tts-seg-ta-${idx}`);
    if (ta?.value.trim()) _speakText(ta.value.trim());
  };

  // ── 장면별 세그먼트 렌더링 ────────────────────────────────────
  function renderTtsSegments(lines) {
    const container = document.getElementById('ttsSegments');
    const emptyEl   = document.getElementById('ttsSegEmpty');
    if (!container) return;
    _ttsSegTexts = [...lines];
    container.innerHTML = '';
    if (!lines.length) { emptyEl?.classList.remove('hidden'); return; }
    emptyEl?.classList.add('hidden');

    lines.forEach((text, i) => {
      const title = _imageCards?.[i]?.chapterTitle || `장면 ${i + 1}`;
      const div = document.createElement('div');
      div.className = 'bg-slate-900/60 border border-slate-700 rounded-xl p-2.5';
      div.innerHTML = `
        <div class="flex items-center justify-between mb-1.5 gap-2">
          <span class="text-[10px] font-bold text-slate-400 truncate">${i+1}. ${escHtml(title)}</span>
          <div class="flex gap-1 flex-shrink-0">
            <button onclick="previewSegment(${i})"
              class="text-[10px] bg-emerald-800/50 hover:bg-emerald-700 text-emerald-300 font-bold px-2 py-0.5 rounded-lg transition">
              🔊
            </button>
            <button onclick="stopTTSPreview()"
              class="text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-300 px-1.5 py-0.5 rounded-lg transition">
              ⏹
            </button>
          </div>
        </div>
        <textarea id="tts-seg-ta-${i}" rows="2"
          class="w-full bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-[11px] text-slate-200
                 resize-none focus:outline-none focus:border-emerald-500"
          oninput="syncSegmentsToText()"
        >${escHtml(text)}</textarea>`;
      container.appendChild(div);
    });
    syncSegmentsToText();
  }

  // 세그먼트 → 전체 텍스트 동기화
  window.syncSegmentsToText = () => {
    const lines = [];
    let i = 0;
    while (document.getElementById(`tts-seg-ta-${i}`)) {
      lines.push(document.getElementById(`tts-seg-ta-${i}`).value);
      i++;
    }
    const ta = document.getElementById('ttsText');
    if (ta) ta.value = lines.filter(Boolean).join('\n');
  };

  // 전체 텍스트 → 세그먼트 동기화 (수동 편집 시)
  window.syncTextToSegments = () => {
    const text  = document.getElementById('ttsText')?.value || '';
    const lines = text.split('\n').filter(Boolean);
    lines.forEach((line, i) => {
      const ta = document.getElementById(`tts-seg-ta-${i}`);
      if (ta) ta.value = line;
    });
  };

  // ── 카드 자막 불러오기 ────────────────────────────────────────
  function _getCardNarration(card, i) {
    // 1순위: 이미지 패널의 자막 textarea (직접 입력값 포함)
    const fromTA = document.getElementById(`img-sub-${i}`)?.value.trim();
    if (fromTA) return fromTA;
    // 2순위: _imageCards에 저장된 subtitles (autoFillCard 결과)
    if (card.subtitles?.trim()) return card.subtitles.trim();
    // 3순위: 컷 묘사를 나레이션으로 활용
    if (card.cutDescription?.trim()) return card.cutDescription.trim();
    // 4순위: 챕터 제목
    return card.chapterTitle || `장면 ${i + 1}`;
  }

  window.loadNarrationFromCards = () => {
    if (!_imageCards?.length) {
      alert('이미지 카드가 없습니다.\n대본을 먼저 생성하고 🎨 이미지 생성 패널을 열어주세요.');
      return;
    }
    const lines = _imageCards.map((card, i) => _getCardNarration(card, i));
    renderTtsSegments(lines);
    const logEl = document.getElementById('ttsLog');
    if (logEl) logEl.textContent = `✅ ${lines.length}개 장면 나레이션 불러오기 완료`;
  };

  // ── Gemini TTS 음성 생성 ──────────────────────────────────────
  window.generateTTS = async () => {
    const text  = document.getElementById('ttsText')?.value.trim();
    if (!text) { alert('나레이션 텍스트를 입력하세요.'); return; }
    const voice = document.getElementById('ttsVoice')?.value || 'Kore';
    const btn   = document.getElementById('ttsGenerateBtn');
    const logEl = document.getElementById('ttsLog');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 생성 중…'; }
    if (logEl) logEl.textContent = `⏳ Gemini TTS (${voice}) 음성 생성 중…`;
    try {
      const res = await fetch('/api/proxy/gemini-tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || JSON.stringify(data).slice(0, 200));
      const part = data.candidates?.[0]?.content?.parts?.[0];
      if (!part?.inlineData?.data) throw new Error('오디오 데이터 없음: ' + JSON.stringify(data).slice(0,200));
      const mime = part.inlineData.mimeType || 'audio/pcm';
      const b64  = part.inlineData.data;
      const blob = mime.includes('pcm') || mime.includes('l16') ? _pcmToWav(b64)
        : new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: mime });
      _ttsAudioBlob = blob;
      const abuf = await blob.arrayBuffer();
      // 청크 단위 변환 — 스프레드 오버플로우 방지
      const bytes = new Uint8Array(abuf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      _ttsAudioB64 = btoa(binary);
      const url   = URL.createObjectURL(blob);
      const audioEl  = document.getElementById('ttsAudio');
      const dlEl     = document.getElementById('ttsDownload');
      const section  = document.getElementById('ttsAudioSection');
      const labelEl  = document.getElementById('ttsVoiceLabel');
      if (audioEl)  { audioEl.src = url; audioEl.play(); }
      if (dlEl)     { dlEl.href = url; dlEl.download = `narration_${voice}.wav`; }
      if (section)  section.classList.remove('hidden');
      if (labelEl)  labelEl.textContent = `음성: ${voice}`;
      if (logEl) logEl.textContent = `✅ 음성 생성 완료 (${voice}) — 플레이어에서 확인하세요`;
    } catch (e) {
      if (logEl) logEl.textContent = `❌ 오류: ${e.message}`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🎙️ Gemini TTS 음성 생성'; }
    }
  };

  // ── 영상 + 음성 + 자막 병합 ──────────────────────────────────
  let _mergeInProgress = false;
  window.mergeVideoWithTTS = async () => {
    if (_mergeInProgress) return;
    const btn   = document.getElementById('ttsMergeBtn');
    const logEl = document.getElementById('ttsLog');

    if (!_ttsAudioB64) { alert('먼저 🎙️ 음성 생성을 실행하세요.'); return; }
    const videoUrls = (_imageCards || []).map(c => String(c.grokVideoUrl || '')).filter(Boolean);
    if (!videoUrls.length) {
      alert('Grok 영상이 없습니다.\n🎥 Grok 패널에서 먼저 영상을 생성하세요.'); return;
    }
    const clipDurMs = parseInt(document.getElementById('ttsClipDur')?.value || '10000');
    const subtitles = (_imageCards || []).map((card, i) => {
      const raw = document.getElementById(`tts-seg-ta-${i}`)?.value
        || document.getElementById(`img-sub-${i}`)?.value
        || (typeof card.subtitles === 'string' ? card.subtitles : '') || '';
      const text = String(raw).trim();
      return text ? {
        start_ms: i * clipDurMs,
        end_ms:   (i + 1) * clipDurMs,
        text,
      } : null;
    }).filter(Boolean);

    // Serialize before touching UI — catches circular-ref / stack errors early
    let bodyStr;
    try {
      bodyStr = JSON.stringify({
        video_urls: videoUrls,
        audio_b64:  String(_ttsAudioB64),
        subtitles,
      });
    } catch (serErr) {
      if (logEl) logEl.textContent = `❌ 직렬화 오류: ${serErr.message}`;
      console.error('[merge] serialize failed', serErr);
      return;
    }

    _mergeInProgress = true;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 병합 중…'; }
    if (logEl) logEl.textContent = `⏳ ${videoUrls.length}개 영상 + 음성 + 자막 병합 중… (ffmpeg)`;
    try {
      console.log('[merge] step1: fetch 시작, bodyStr 길이=', bodyStr.length);
      const res = await fetch('/api/proxy/video-audio-merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
      });
      console.log('[merge] step2: fetch 완료, status=', res.status);
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `HTTP ${res.status}`); }
      console.log('[merge] step3: blob 읽기');
      const blob    = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      console.log('[merge] step4: 다운로드 링크 생성');
      const a = document.createElement('a');
      a.href = blobUrl; a.download = `narration_merged_${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.dispatchEvent(new MouseEvent('click', { bubbles: false }));
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      if (logEl) logEl.textContent = `🎉 병합 완료! MP4 다운로드됨`;
    } catch (e) {
      if (logEl) logEl.textContent = `❌ 오류: ${e.message}`;
      console.error('[merge] 오류 발생:', e);
      console.error('[merge] 스택:', e.stack);
    } finally {
      _mergeInProgress = false;
      if (btn) { btn.disabled = false; btn.textContent = '🎬 영상 + 음성 병합 (ffmpeg)'; }
    }
  };

  // ── 경량 Vrew ────────────────────────────────────────────────
  (() => {
    const toggle = document.getElementById('vrewToggle');
    if (toggle) toggle.addEventListener('click', () => openVrewModal());
  })();

  window.openVrewModal  = () => { closeAllPanels('vrewModal'); document.getElementById('vrewModal').classList.remove('hidden'); };
  window.closeVrewModal = () => document.getElementById('vrewModal').classList.add('hidden');
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeVrewModal(); });

  let _vrewSegs  = [];   // {text, start, duration}
  let _vrewTrans = [];   // {text, start, duration}

  function vrewExtractId(input) {
    const m = input.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : input.trim();
  }

  function vrewFmt(sec) {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  }

  window.vrewFetchSubtitles = async () => {
    const raw    = document.getElementById('vrewYtUrl')?.value.trim();
    const lang   = document.getElementById('vrewLangSelect')?.value || 'ko';
    const statusEl = document.getElementById('vrewFetchStatus');
    const btn    = document.getElementById('vrewFetchBtn');
    if (!raw) { if (statusEl) statusEl.textContent = 'URL 또는 영상 ID를 입력하세요.'; return; }
    if (!TRANSCRIPT_API_KEY) { if (statusEl) statusEl.textContent = '❌ TRANSCRIPT_API_KEY 없음'; return; }

    const videoId = vrewExtractId(raw);
    if (statusEl) statusEl.textContent = '⏳ 자막 가져오는 중…';
    if (btn) { btn.disabled = true; btn.textContent = '로딩 중…'; }

    try {
      const res = await fetch('/api/proxy/transcriptapi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: '/api/v2/youtube/transcript',
          params: { video_url: raw.includes('youtube') || raw.includes('youtu.be')
              ? raw : `https://www.youtube.com/watch?v=${videoId}`,
            format: 'json', include_timestamp: 'true', send_metadata: 'true' }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const segs = data.transcript || [];
      if (!segs.length) throw new Error('자막이 없는 영상입니다. 언어 설정을 확인하세요.');

      _vrewSegs  = segs.map(s => ({ text: s.text || '', start: +s.start || 0, duration: +s.duration || 2 }));
      _vrewTrans = _vrewSegs.map(s => ({ ...s, text: '' }));

      // 영상 길이 자동 계산
      const last = _vrewSegs[_vrewSegs.length - 1];
      const totalSec = Math.ceil(last.start + last.duration + 1);
      const durEl = document.getElementById('vrewDuration');
      if (durEl) durEl.value = totalSec;

      const title = data.metadata?.title ? ` — ${data.metadata.title}` : '';
      if (statusEl) statusEl.textContent = `✅ ${_vrewSegs.length}개 자막 로드${title}`;

      document.getElementById('vrewTransSection')?.classList.remove('hidden');
      document.getElementById('vrewRenderSection')?.classList.remove('hidden');
      document.getElementById('vrewEditorToolbar')?.classList.remove('hidden');
      document.getElementById('vrewEmptyHint')?.remove();
      document.getElementById('vrewSegCount').textContent = `${_vrewSegs.length}개 자막`;

      vrewRenderList();
    } catch (e) {
      if (statusEl) statusEl.textContent = '❌ ' + e.message;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📄 자막 가져오기'; }
    }
  };

  function vrewRenderList() {
    const list = document.getElementById('vrewSegList');
    if (!list) return;
    list.innerHTML = _vrewSegs.map((seg, i) => `
      <div class="vrew-row" id="vrew-row-${i}">
        <span class="text-[10px] text-slate-500 font-mono pt-1.5 text-center">${vrewFmt(seg.start)}</span>
        <input type="number" step="0.1" min="0.1" value="${seg.duration.toFixed(1)}"
          onchange="vrewSetDur(${i},this.value)"
          class="vrew-cell-num" />
        <textarea rows="2" class="vrew-cell-ta"
          onchange="vrewSetText(${i},this.value)">${escHtml(seg.text)}</textarea>
        <textarea rows="2" class="vrew-cell-ta" style="border-color:#312e81;color:#c7d2fe"
          placeholder="번역 텍스트 (선택)"
          onchange="vrewSetTrans(${i},this.value)">${escHtml(_vrewTrans[i]?.text || '')}</textarea>
        <button onclick="vrewDelSeg(${i})"
          class="text-red-500 hover:text-red-400 text-sm pt-1 leading-none">🗑</button>
      </div>`
    ).join('');
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  window.vrewSetText  = (i, v) => { _vrewSegs[i].text  = v; };
  window.vrewSetDur   = (i, v) => { _vrewSegs[i].duration = parseFloat(v) || 2; };
  window.vrewSetTrans = (i, v) => { if (_vrewTrans[i]) _vrewTrans[i].text = v; };

  window.vrewDelSeg = (i) => {
    _vrewSegs.splice(i, 1);
    _vrewTrans.splice(i, 1);
    document.getElementById('vrewSegCount').textContent = `${_vrewSegs.length}개 자막`;
    vrewRenderList();
  };

  window.vrewAddSegment = () => {
    const last  = _vrewSegs[_vrewSegs.length - 1];
    const start = last ? last.start + last.duration + 0.2 : 0;
    _vrewSegs.push({ text: '새 자막', start, duration: 2 });
    _vrewTrans.push({ text: '', start, duration: 2 });
    document.getElementById('vrewSegCount').textContent = `${_vrewSegs.length}개 자막`;
    vrewRenderList();
    const list = document.getElementById('vrewSegList');
    if (list) list.scrollTop = list.scrollHeight;
  };

  window.vrewClearAll = () => {
    if (!confirm('자막을 모두 삭제할까요?')) return;
    _vrewSegs = []; _vrewTrans = [];
    document.getElementById('vrewSegCount').textContent = '0개 자막';
    vrewRenderList();
  };

  // Gemini 번역 (배치 20개씩)
  window.vrewTranslate = async () => {
    if (!GEMINI_API_KEY) { alert('Gemini API 키가 필요합니다.'); return; }
    if (!_vrewSegs.length) { alert('자막을 먼저 가져오세요.'); return; }
    const targetLang = document.getElementById('vrewTransLang')?.value || 'Korean';
    const statusEl   = document.getElementById('vrewTransStatus');
    const btn        = document.getElementById('vrewTransBtn');
    if (btn) { btn.disabled = true; btn.textContent = '번역 중…'; }

    const BATCH = 20;
    try {
      for (let b = 0; b < _vrewSegs.length; b += BATCH) {
        const batch    = _vrewSegs.slice(b, b + BATCH);
        const numbered = batch.map((s, j) => `${b + j + 1}. ${s.text}`).join('\n');
        if (statusEl) statusEl.textContent = `⏳ ${Math.min(b + BATCH, _vrewSegs.length)}/${_vrewSegs.length} 번역 중…`;

        const result = await callGemini(
          `Translate these numbered subtitle lines into ${targetLang}.\n` +
          `Output ONLY the numbered lines (same format). No extra text.\n\n${numbered}`
        );
        result.split('\n').forEach(line => {
          const m = line.match(/^(\d+)\.\s*(.+)/);
          if (!m) return;
          const idx = parseInt(m[1]) - 1;
          if (idx >= 0 && idx < _vrewSegs.length) {
            _vrewTrans[idx] = { ..._vrewSegs[idx], text: m[2].trim() };
          }
        });
      }
      vrewRenderList();
      if (statusEl) statusEl.textContent = `✅ ${_vrewSegs.length}개 번역 완료`;
    } catch (e) {
      if (statusEl) statusEl.textContent = '❌ ' + e.message;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🌐 전체 번역'; }
    }
  };

  // Remotion 렌더링
  window.vrewRender = async () => {
    const videoSrc  = document.getElementById('vrewVideoSrc')?.value.trim();
    const durationV = document.getElementById('vrewDuration')?.value;
    const bilingual = document.getElementById('vrewBilingualToggle')?.checked;
    const statusEl  = document.getElementById('vrewRenderStatus');
    const btn       = document.getElementById('vrewRenderBtn');

    if (!videoSrc)  { alert('영상 파일 경로 또는 URL을 입력하세요.'); return; }
    if (!durationV) { alert('영상 길이(초)를 입력하세요.'); return; }
    if (!_vrewSegs.length) { alert('자막이 없습니다.'); return; }

    if (btn) { btn.disabled = true; btn.textContent = '⏳ 렌더링 중…'; }
    if (statusEl) statusEl.textContent = '⏳ Remotion 렌더 서버 확인 중…';

    const translatedSubtitles = bilingual
      ? _vrewTrans.filter(s => s?.text?.trim())
      : [];

    try {
      const health = await fetch('http://localhost:8766/health').catch(() => null);
      if (!health?.ok) throw new Error(
        'Remotion 렌더 서버가 꺼져 있습니다.\n터미널에서: cd remotion && npm start'
      );

      if (statusEl) statusEl.textContent = '⏳ 렌더링 중… (영상 길이에 따라 수 분 소요)';

      const res = await fetch('http://localhost:8766/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoSrc,
          subtitles: _vrewSegs,
          translatedSubtitles,
          durationInSeconds: parseFloat(durationV),
          fps: 30,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'vrew-subtitled.mp4'; a.click();
      URL.revokeObjectURL(url);
      if (statusEl) statusEl.textContent = '✅ 렌더링 완료! MP4 다운로드됨';
    } catch (e) {
      if (statusEl) statusEl.textContent = '❌ ' + e.message;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🎬 자막 렌더링 → MP4'; }
    }
  };


  // ── 나레이션 기반 자동 분할 ────────────────────────────────────
  window.autoSplitByNarration = async () => {
    if (!_cachedOutline) {
      alert('먼저 대본을 생성해주세요.\n대본 생성 후 🎨 이미지 생성 버튼을 눌러주세요.');
      return;
    }

    const btn = document.getElementById('narrationSplitBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Gemini 분석 중…'; }

    try {
      // 전체 대본 텍스트 구성
      const scriptText = buildScriptText(_cachedOutline);
      const totalChars = scriptText.replace(/\s+/g, '').length;
      const estimatedScenes = Math.max(5, Math.round(totalChars / 22));

      const prompt = `당신은 유튜브 영상 대본을 화면별 이미지 스크립트로 변환하는 전문가입니다.

아래 대본을 의미 단위로 자연스럽게 분할하여 각 장면을 만드세요.

【분할 규칙】
- 나레이션은 의미가 끊기지 않도록 자연스럽게 분리 (문장, 절, 구 단위)
- 한 장면 나레이션 권장 길이: 15~35자 (너무 짧거나 길면 자연스럽게 조절)
- 전체 대본을 빠짐없이 커버할 것 (생략 금지)
- 예상 장면 수: 약 ${estimatedScenes}개 (분량에 따라 자유롭게 조절)

【출력 형식 — 반드시 준수】
각 장면마다 아래 5줄 형식 사용 (장면 사이에만 빈 줄 1개):

📌 장면 N.
💬 나레이션: 대본에서 발췌한 실제 나레이션 텍스트
🎥 컷 묘사: 화면에 보여줄 장면을 한 줄로 구체적 묘사
🖼️ AI 프롬프트 (영어): [Imagen 4 최적화 영어 프롬프트, 반드시 한 줄, 40~70단어]
📹 촬영/편집 방향: B-roll, 텍스트 오버레이, 효과 등 한 줄

【금지 사항】
- ** 마크다운 볼드 사용 금지
- 🖼️ 프롬프트 줄바꿈 금지 (반드시 한 줄)
- 나레이션 임의 수정 금지 (원문 그대로)

[대본]
${scriptText}`;

      const reply = await callGemini(prompt);
      const cards = parseNarrationCards(reply);

      if (cards.length < 2) {
        throw new Error(`파싱된 장면이 ${cards.length}개입니다. 형식을 인식하지 못했습니다. 다시 시도해주세요.`);
      }

      // 카드 교체 & 모달 재렌더링
      _imageCards = cards;
      renderGrokModal(cards);
      document.getElementById('seqNavBar')?.classList.add('hidden');
      document.getElementById('grokModal').classList.remove('hidden');

      // 카드 수 업데이트
      const countEl = document.getElementById('grokCardCount');
      if (countEl) countEl.textContent = `${cards.length}개 장면`;

    } catch (e) {
      alert('오류: ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💬 나레이션 자동 분할'; }
    }
  };

  function parseNarrationCards(text) {
    const cards = [];
    const seen  = new Set();

    const stripMd = s => (s || '')
      .replace(/\*\*/g, '')
      .replace(/(?<!\*)\*(?!\*)/g, '')
      .replace(/^[\[【『「\s]+|[\]】』」\s]+$/gm, '')
      .trim();

    // 📌 단위로 블록 분리
    const blocks = text.replace(/\*\*/g, '').split(/\n(?=📌)/g);

    blocks.forEach(block => {
      if (!/📌/.test(block)) return;

      const narrM  = block.match(/💬[^\n]*[:：]\s*([\s\S]+?)(?=\n🎥|\n🖼️|\n📹|\n📌|$)/);
      const cutM   = block.match(/🎥[^\n]*[:：]\s*([\s\S]+?)(?=\n🖼️|\n📹|\n📌|$)/);
      const promptM = block.match(/🖼️[^\n]*[:：]\s*([\s\S]+?)(?=\n📹|\n📌|$)/);
      const dirM   = block.match(/📹[^\n]*[:：]\s*([\s\S]+?)(?=\n📌|$)/);

      const prompt    = stripMd(promptM?.[1] || '');
      const narration = stripMd(narrM?.[1]   || '');

      if (!prompt || prompt.length < 5 || seen.has(prompt)) return;
      seen.add(prompt);

      cards.push({
        chapterTitle:   `장면 ${cards.length + 1}`,
        cutDescription: stripMd(cutM?.[1]) || '',
        prompt,
        direction:      stripMd(dirM?.[1]) || '',
        subtitles:      narration,
      });
    });

    return cards;
  }

  // ── Extension 경유 영상 생성 ─────────────────────────────────────────────
  async function _generateFlowVideoViaExtension(idx) {
    const card     = _imageCards[idx];
    const btn      = document.getElementById(`grok-xai-video-${idx}`);
    const statusEl = document.getElementById(`grok-video-status-${idx}`);
    const imgEl    = document.getElementById(`grok-img-el-${idx}`);
    const origBtn  = btn?.textContent;

    const imgPrompt = document.getElementById(`img-prompt-${idx}`)?.value.trim() || card?.prompt || '';
    const subText   = document.getElementById(`img-sub-${idx}`)?.value.trim()   || card?.subtitles || '';
    const cutDesc   = document.getElementById(`img-cut-${idx}`)?.value.trim()   || card?.cutDescription || '';
    let fullPrompt  = imgPrompt;
    if (cutDesc) fullPrompt += `. ${cutDesc}`;
    if (subText) fullPrompt += `. Scene: ${subText}`;
    fullPrompt += '. Cinematic, 4K, smooth camera movement.';

    const imageDataUrl = imgEl?.src?.startsWith('data:') ? imgEl.src
      : imgEl?.src ? await fetch(imgEl.src).then(r=>r.blob()).then(b=>new Promise(res=>{const fr=new FileReader();fr.onload=e=>res(e.target.result);fr.readAsDataURL(b)})).catch(()=>null)
      : null;

    if (btn) { btn.textContent = '🌊 Flow 생성 중...'; btn.disabled = true; }
    if (statusEl) { statusEl.classList.remove('hidden'); statusEl.textContent = '⏳ Google Flow로 전송 중...'; }

    try {
      const mode = imageDataUrl ? 'image_to_video' : 'text_to_video';
      if (statusEl) statusEl.textContent = '⏳ Google Flow 생성 중... (1~3분 소요)';

      const result = await flowBridgeGenerate(mode, fullPrompt, imageDataUrl);

      const videoContainer = document.getElementById(`grok-video-container-${idx}`);
      if (videoContainer && result.url) {
        if (result.mediaType === 'video') {
          videoContainer.innerHTML = `
            <video controls class="w-full rounded-xl mt-2" src="${result.url}">
              <source src="${result.url}" type="video/mp4">
            </video>
            <a href="${result.url}" download="flow_video_${idx}.mp4"
               class="block mt-1 text-center text-xs text-teal-400 hover:text-teal-300">⬇ 다운로드</a>`;
        } else {
          videoContainer.innerHTML = `<img src="${result.url}" class="w-full rounded-xl mt-2" />`;
        }
      }
      if (statusEl) statusEl.textContent = `✅ ${result.mediaType === 'video' ? '영상' : '이미지'} 생성 완료 (Flow)`;
      _imageCards[idx].grokVideoUrl = result.url;
      _imageCards[idx].videoType    = result.mediaType;

    } catch (e) {
      if (statusEl) statusEl.textContent = '❌ 오류: ' + e.message;
    } finally {
      if (btn) { btn.textContent = origBtn; btn.disabled = false; }
    }
  }

  async function _generateGrokVideoViaExtension(idx) {
    const card     = _imageCards[idx];
    const btn      = document.getElementById(`grok-xai-video-${idx}`);
    const statusEl = document.getElementById(`grok-video-status-${idx}`);
    const imgEl    = document.getElementById(`grok-img-el-${idx}`);
    const origBtn  = btn?.textContent;

    const promptEl = document.getElementById(`prompt-${idx}`);
    const subEl    = document.getElementById(`sub-${idx}`);
    const prompt   = (promptEl?.value || card.prompt || '').trim();
    const subtitle = (subEl?.value   || card.subtitles || '').trim();
    const fullPrompt = subtitle ? `${prompt}. Scene description: ${subtitle}` : prompt;

    // 카드 이미지 DataURL (Frame to Video 용)
    const imageDataUrl = imgEl?.src?.startsWith('data:') ? imgEl.src
                       : imgEl?.src ? await fetch(imgEl.src).then(r=>r.blob()).then(b => new Promise(res=>{const fr=new FileReader();fr.onload=e=>res(e.target.result);fr.readAsDataURL(b)})).catch(()=>null)
                       : null;

    if (btn) { btn.textContent = '🌉 Bridge 생성 중...'; btn.disabled = true; }
    if (statusEl) statusEl.textContent = '⏳ grok.com으로 전송 중...';

    try {
      const mode = imageDataUrl ? 'frame_to_video' : 'text_to_video';
      if (statusEl) statusEl.textContent = '⏳ grok.com 생성 중... (1~3분 소요)';

      const result = await grokBridgeGenerate(mode, fullPrompt, imageDataUrl);

      // 결과 표시
      const videoContainer = document.getElementById(`grok-video-container-${idx}`);
      if (videoContainer && result.url) {
        if (result.mediaType === 'video') {
          videoContainer.innerHTML = `
            <video controls class="w-full rounded-xl mt-2" src="${result.url}">
              <source src="${result.url}" type="video/mp4">
            </video>
            <a href="${result.url}" download="grok_video_${idx}.mp4"
               class="block mt-1 text-center text-xs text-indigo-400 hover:text-indigo-300">⬇ 다운로드</a>`;
        } else {
          videoContainer.innerHTML = `<img src="${result.url}" class="w-full rounded-xl mt-2" />`;
        }
      }
      if (statusEl) statusEl.textContent = `✅ ${result.mediaType === 'video' ? '영상' : '이미지'} 생성 완료 (Bridge)`;
      // 카드에 결과 저장
      _imageCards[idx].videoUrl = result.url;
      _imageCards[idx].videoType = result.mediaType;

    } catch (e) {
      if (statusEl) statusEl.textContent = '❌ 오류: ' + e.message;
    } finally {
      if (btn) { btn.textContent = origBtn; btn.disabled = false; }
    }
  }

  // ── 한국어 문법 검증 함수 (강화된 버전) ──────────────────────────────────────
  window.validateKoreanText = (text) => {
    if (!text || typeof text !== 'string') return text;

    // 기본적인 한국어 문법 규칙 검사 (확장됨)
    const commonErrors = {
      // 잘못된 조사 사용
      '를을': '를', '을를': '을', '이가': '이', '가이': '가',
      '와과': '와', '과와': '과', '는은': '는', '은는': '은',
      // 잘못된 어미
      '습니다니다': '습니다', '니다습니다': '니다',
      // 띄어쓰기 오류
      '안 녕': '안녕', '감 사': '감사', '고 마': '고마',
      // 흔한 맞춤법 오류 (확장)
      '되요': '돼요', '되서': '돼서', '됬다': '됐다', '됬어': '됐어',
      '되있': '돼있', '되었': '됐', '되어서': '돼서', '되어요': '돼요',
      '않해': '안 해', '못해요': '못해요', '안되': '안 돼', '안됨': '안 됨',
      '할껀': '할 건', '할꺼': '할 거', '먹을껀': '먹을 건', '먹을꺼': '먹을 거',
      '어떻게해': '어떻게 해', '왜그래': '왜 그래', '뭐해': '뭐 해',
      '몰랐어요': '몰랐어요', '알았어요': '알았어요',
      '웬지': '왠지', '웬일': '웬일', '왠만하면': '웬만하면',
      '어의없': '어이없', '어의가없': '어이가 없',
      '몇일': '며칠', '몇월': '몇 월',
      '금새': '금세', '어디갔': '어디 갔',
      '오랫만': '오랜만', '오래간만': '오랜만',
      '설레이': '설레', '설레임': '설렘',
      '희안': '희한', '희안하': '희한하',
      // 조사 오류 수정
      '에게서': '에게서', '한테서': '한테서',
    };

    let corrected = text;

    // 1. 기본 오류 수정
    for (const [wrong, correct] of Object.entries(commonErrors)) {
      corrected = corrected.replace(new RegExp(wrong, 'g'), correct);
    }

    // 2. 여러 공백을 하나로 통합
    corrected = corrected.replace(/\s+/g, ' ');

    // 3. 한글과 영문 사이 적절한 띄어쓰기
    corrected = corrected.replace(/([A-Za-z])([가-힣])/g, '$1 $2');
    corrected = corrected.replace(/([가-힣])([A-Za-z])/g, '$1 $2');

    // 4. 숫자와 한글 단위는 붙여쓰기 (예: 123개, 5분, 10원)
    corrected = corrected.replace(/(\d+)\s+(개|명|원|분|초|시간|일|월|년|번|회|권|장|페이지|kg|km|cm|m|g)/g, '$1$2');

    // 5. 문장 부호 정리
    corrected = corrected.replace(/\s+([,.!?])/g, '$1');
    corrected = corrected.replace(/([,.!?])\s*([,.!?])/g, '$1');

    // 6. 마침표 뒤 띄어쓰기
    corrected = corrected.replace(/\.([가-힣A-Za-z])/g, '. $1');

    // 7. 물음표/느낌표 뒤 띄어쓰기
    corrected = corrected.replace(/([?!])([가-힣A-Za-z])/g, '$1 $2');

    return corrected.trim();
  };

  // ── 이미지 프롬프트에 아시아인/한국인 기본 적용 ──────────────────────────
  window.applyAsianDefault = (prompt) => {
    if (!prompt || typeof prompt !== 'string') return prompt;

    let modified = prompt;

    // 서양인이 명시적으로 필요한 컨텍스트 감지
    const westernContexts = /\b(western|european|american|british|german|french|italian|spanish|russian|australian|canadian|hollywood|wall street|silicon valley|new york|london|paris|rome|berlin|trump|biden|obama|elon|musk)\b/i;
    const hasWesternContext = westernContexts.test(prompt);

    // 이미 Korean 또는 Asian이 포함되어 있으면 건너뛰기
    const alreadyAsian = /\b(korean|asian|japanese|chinese|vietnamese|thai)\b/i.test(prompt);

    // 일반적인 인물 표현을 한국계 아시아인으로 변경 (서양 컨텍스트가 없는 경우)
    if (!hasWesternContext && !alreadyAsian) {
      // 다양한 인물 표현 패턴 감지 및 변환
      const personPatterns = [
        // 기본 인물 단어
        /\b(a |an |the )?(young |old |elderly |middle-aged |professional |business |confident |happy |serious |thoughtful |successful |elegant |stylish |modern |casual )*(person|people|man|woman|men|women|guy|girl|boy|lady|gentleman|individual|figure|speaker|presenter|host|CEO|executive|manager|employee|worker|entrepreneur|expert|specialist|doctor|lawyer|teacher|student|athlete|model)\b/gi,
        // 직업/역할 기반
        /\b(a |an |the )?(businessman|businesswoman|businessperson|office worker|professional|executive|leader|influencer|content creator|youtuber|blogger|podcaster)\b/gi,
      ];

      personPatterns.forEach(pattern => {
        modified = modified.replace(pattern, (match) => {
          // 이미 Korean/Asian이 포함되어 있으면 그대로 반환
          if (/korean|asian/i.test(match)) return match;
          // 앞에 Korean Asian 추가
          return match.replace(/^(a |an |the )?/i, '$1Korean Asian ');
        });
      });

      // portrait, face, headshot 등에 Korean Asian 추가
      modified = modified.replace(/\b(professional |business |corporate |studio |cinematic )?(portrait|face|headshot|closeup|close-up)\b/gi, (match) => {
        if (/korean|asian/i.test(match)) return match;
        return 'Korean Asian ' + match;
      });

      // 프롬프트에 인물 관련 키워드가 있지만 위 패턴에 안 걸린 경우
      // 프롬프트 맨 앞에 "Korean Asian person," 추가
      const hasPersonIndicator = /\b(speaking|talking|presenting|working|sitting|standing|walking|looking|smiling|wearing|holding|showing|demonstrating|explaining|teaching|learning)\b/i.test(modified);
      const noPersonYet = !/\b(person|people|man|woman|men|women|korean|asian)\b/i.test(modified);

      if (hasPersonIndicator && noPersonYet) {
        modified = 'Korean Asian person ' + modified;
      }
    }

    // 중복 정리
    modified = modified.replace(/Korean Asian Korean Asian/gi, 'Korean Asian');
    modified = modified.replace(/Asian Asian/gi, 'Asian');
    modified = modified.replace(/Korean Korean/gi, 'Korean');
    modified = modified.replace(/\s+/g, ' ').trim();

    return modified;
  };

  // ── 한국어 검증 포함 이미지 생성 함수 ──────────────────────────────
  window.generateImageWithKoreanCheck = async () => {
    const promptInput = document.getElementById('imagePromptInput');
    const sizeSelect = document.getElementById('imageSizeSelect');
    const styleSelect = document.getElementById('imageStyleSelect');
    const koreanCheck = document.getElementById('koreanTextCheck');
    const statusEl = document.getElementById('imageGenerationStatus');
    const container = document.getElementById('generatedImageContainer');

    if (!promptInput?.value.trim()) {
      alert('프롬프트를 입력해주세요.');
      return;
    }

    let originalPrompt = promptInput.value.trim();
    let validatedPrompt = originalPrompt;

    try {
      statusEl.textContent = '🎨 이미지 생성 시작...';

      // 1. 한국어 검증 실행 (체크박스가 활성화된 경우)
      if (koreanCheck?.checked) {
        statusEl.textContent = '✅ 한국어 텍스트 문법 검증 중...';
        validatedPrompt = validateKoreanText(originalPrompt);
        
        if (validatedPrompt !== originalPrompt) {
          statusEl.textContent = `✅ 문법 수정됨: "${originalPrompt}" → "${validatedPrompt}"`;
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          statusEl.textContent = '✅ 한국어 문법 검증 완료 (수정 없음)';
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // 2. 한국어 → 영어 번역 (Gemini 사용)
      statusEl.textContent = '🌏 한국어 → 영어 번역 중...';
      let englishPrompt = validatedPrompt;
      
      // 한국어가 포함되어 있으면 번역
      if (/[가-힣]/.test(validatedPrompt)) {
        const translateResponse = await callGemini(
          `Translate this Korean image prompt to English for AI image generation. Keep it natural and descriptive. Only output the English translation, nothing else:\n\n${validatedPrompt}`
        );
        englishPrompt = translateResponse.trim();
        statusEl.textContent = `🌏 번역 완료: "${englishPrompt}"`;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      // 3. 스타일 추가
      const style = styleSelect?.value || '';
      if (style) {
        englishPrompt += `, ${style}`;
      }

      // 4. 이미지 생성 (Gemini Imagen 또는 폴백)
      statusEl.textContent = '🎨 AI 이미지 생성 중... (10-30초 소요)';
      
      const size = sizeSelect?.value || '1024x1024';
      const [width, height] = size.split('x').map(Number);

      const imageResponse = await fetch('/api/proxy/gemini-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: englishPrompt,
          width: width || 1024,
          height: height || 1024
        })
      });

      if (!imageResponse.ok) {
        const errorData = await imageResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${imageResponse.status}`);
      }

      const imageData = await imageResponse.json();
      const imageBase64 = imageData.predictions?.[0]?.bytesBase64Encoded
                       || imageData.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
                       || imageData.image;

      if (!imageBase64) {
        throw new Error('이미지 데이터를 받지 못했습니다.');
      }

      // 5. 결과 표시
      const imageUrl = `data:${imageData.mimeType || 'image/jpeg'};base64,${imageBase64}`;
      const preview = document.getElementById('imagePreview');
      
      preview.innerHTML = `
        <img src="${imageUrl}" alt="생성된 이미지" class="max-w-full h-auto rounded-xl border border-slate-600">
        <div class="mt-3 text-xs text-slate-400">
          <p><strong>원본 프롬프트:</strong> ${originalPrompt}</p>
          ${validatedPrompt !== originalPrompt ? `<p><strong>검증된 프롬프트:</strong> ${validatedPrompt}</p>` : ''}
          <p><strong>영문 프롬프트:</strong> ${englishPrompt}</p>
          <p><strong>이미지 크기:</strong> ${size}</p>
        </div>
      `;

      // 다운로드용 데이터 저장
      window._lastGeneratedImage = {
        data: imageUrl,
        prompt: validatedPrompt,
        englishPrompt: englishPrompt,
        size: size
      };

      container.classList.remove('hidden');
      statusEl.textContent = '✅ 이미지 생성 완료!';

    } catch (error) {
      statusEl.textContent = `❌ 오류: ${error.message}`;
      console.error('이미지 생성 오류:', error);
    }
  };

  // ── 이미지 다운로드 함수 ──────────────────────────────────────
  window.downloadGeneratedImage = () => {
    if (!window._lastGeneratedImage?.data) {
      alert('다운로드할 이미지가 없습니다.');
      return;
    }

    const link = document.createElement('a');
    const fileName = `generated-image-${Date.now()}.jpg`;
    
    link.download = fileName;
    link.href = window._lastGeneratedImage.data;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── 이미지 재생성 함수 ──────────────────────────────────────
  window.regenerateImage = async () => {
    const promptInput = document.getElementById('imagePromptInput');
    if (promptInput?.value.trim()) {
      await generateImageWithKoreanCheck();
    } else {
      alert('프롬프트를 입력해주세요.');
    }
  };

  // ── Flow Bridge Extension 연동 함수들 ──────────────────────────────
  // Flow Bridge Extension과 통신하기 위한 함수
  window.flowBridgeGenerate = async (mode, prompt, imageDataUrl = null) => {
    return new Promise((resolve, reject) => {
      const messageId = 'flow-' + Date.now();
      
      // 응답 대기 리스너
      const handleMessage = (event) => {
        if (event.data?.type === 'FLOW_BRIDGE_RESULT' && event.data?.messageId === messageId) {
          window.removeEventListener('message', handleMessage);
          if (event.data.success) {
            resolve(event.data);
          } else {
            reject(new Error(event.data.error || 'Flow Bridge 생성 실패'));
          }
        }
      };
      
      window.addEventListener('message', handleMessage);
      
      // Flow Bridge Extension으로 메시지 전송
      window.postMessage({
        type: 'FLOW_BRIDGE_GENERATE',
        messageId: messageId,
        mode: mode,
        prompt: prompt,
        imageDataUrl: imageDataUrl
      }, '*');
      
      // 타임아웃 설정 (3분)
      setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        reject(new Error('Flow Bridge 응답 타임아웃 (3분)'));
      }, 180000);
    });
  };

  // Flow Bridge Extension 상태 체크
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'FLOW_BRIDGE_READY') {
      _flowBridgeReady = true;
      console.log('✅ Flow Bridge Extension 연결됨');
    }
  });

  // 페이지 로드시 Flow Bridge 상태 요청
  setTimeout(() => {
    window.postMessage({ type: 'FLOW_BRIDGE_CHECK' }, '*');
  }, 1000);

  // ── Flow Factory를 통한 영상 생성 함수들 ──────────────────────────────
  // 단일 스크립트 카드를 Flow Factory로 영상 변환
  window.generateFlowVideo = async (index) => {
    const card = window._imageCards?.[index];
    if (!card) return;
    
    const imgEl = document.getElementById(`grok-img-el-${index}`);
    if (!imgEl || !imgEl.src || !imgEl.src.startsWith('data:image/')) {
      alert('먼저 이미지를 생성해주세요.');
      return;
    }
    
    const statusEl = document.getElementById(`video-status-${index}`);
    const btn = document.getElementById(`flow-video-btn-${index}`);
    
    // Flow Bridge Extension 체크
    if (!_flowBridgeReady) {
      alert('Flow Bridge Extension이 설치되지 않았거나 Google Flow 페이지가 열려있지 않습니다.\n\n1. Flow Bridge Extension을 설치하세요\n2. https://labs.google.com/search/factory 페이지를 새 탭에서 여세요\n3. 다시 시도해주세요');
      return;
    }
    
    try {
      // UI 업데이트
      if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.textContent = '🎬 Flow Factory로 영상 변환 준비 중...';
      }
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 변환 중...';
      }
      
      // 프롬프트 준비 (한국어 → 영어 번역)
      let videoPrompt = card.prompt || card.cutDescription || `Scene ${index + 1}`;
      
      // 자막이나 나레이션 추가
      if (card.subtitles) {
        videoPrompt += `. Narration: ${card.subtitles}`;
      }
      
      // 한국어가 포함되어 있으면 번역
      if (/[가-힣]/.test(videoPrompt)) {
        if (statusEl) statusEl.textContent = '🌏 프롬프트 번역 중...';
        
        const translateResponse = await callGemini(
          `Translate this Korean video prompt to English for AI video generation. Make it descriptive and cinematic. Only output the English translation:\n\n${videoPrompt}`
        );
        videoPrompt = translateResponse.trim();
      }
      
      // 시네마틱 스타일 추가
      videoPrompt += '. Cinematic camera movement, smooth motion, high quality, 4K';
      
      if (statusEl) statusEl.textContent = '🎬 Flow Factory (Veo 2)로 영상 생성 중... (1-3분 소요)';
      
      // Flow Bridge를 통한 영상 생성 (image_to_video 모드)
      const result = await flowBridgeGenerate('image_to_video', videoPrompt, imgEl.src);
      
      // 결과 저장
      card.flowVideoUrl = result.url;
      card.flowVideoType = result.mediaType || 'video';
      
      if (statusEl) statusEl.textContent = '✅ 영상 변환 완료!';
      
      // UI 업데이트
      setTimeout(() => {
        const modalBody = document.getElementById('grokModalBody');
        if (modalBody) {
          const scriptList = document.getElementById('scriptImagesList');
          if (scriptList) {
            scriptList.innerHTML = generateScriptImagesList();
          }
        }
      }, 1000);
      
    } catch (error) {
      if (statusEl) statusEl.textContent = `❌ 오류: ${error.message}`;
      console.error('Flow 영상 생성 오류:', error);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = card.flowVideoUrl ? '🔄 영상 재생성' : '🎬 영상 변환';
      }
    }
  };

  // 전체 스크립트 카드를 일괄 영상 변환
  window.generateAllFlowVideos = async () => {
    if (!window._imageCards || _imageCards.length === 0) {
      alert('생성된 스크립트 카드가 없습니다.');
      return;
    }
    
    if (!_flowBridgeReady) {
      alert('Flow Bridge Extension이 설치되지 않았거나 Google Flow 페이지가 열려있지 않습니다.');
      return;
    }
    
    const statusEl = document.getElementById('imageGenerationStatus');
    
    // 이미지가 있는 카드만 필터링
    const cardsWithImages = _imageCards.map((_, index) => {
      const imgEl = document.getElementById(`grok-img-el-${index}`);
      const hasImage = imgEl && imgEl.src && imgEl.src.startsWith('data:image/');
      return hasImage ? index : null;
    }).filter(idx => idx !== null);
    
    if (cardsWithImages.length === 0) {
      alert('먼저 이미지를 생성해주세요.');
      return;
    }
    
    if (statusEl) statusEl.textContent = `🎬 전체 영상 변환 시작... (0/${cardsWithImages.length})`;
    
    for (let i = 0; i < cardsWithImages.length; i++) {
      const index = cardsWithImages[i];
      if (statusEl) statusEl.textContent = `🎬 영상 변환 중... (${i + 1}/${cardsWithImages.length})`;
      
      try {
        await generateFlowVideo(index);
      } catch (error) {
        console.warn(`영상 ${index + 1} 변환 실패:`, error);
      }
      
      // API 레이트 리미트 방지를 위한 대기
      if (i < cardsWithImages.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    if (statusEl) statusEl.textContent = '✅ 전체 영상 변환 완료!';
  };

  // 단일 영상 다운로드
  window.downloadSingleVideo = (index) => {
    const card = window._imageCards?.[index];
    if (!card || !card.flowVideoUrl) return;
    
    const link = document.createElement('a');
    const fileName = `video-${index + 1}-${(card?.chapterTitle || 'scene').replace(/[^a-zA-Z0-9가-힣]/g, '_')}.mp4`;
    
    link.download = fileName;
    link.href = card.flowVideoUrl;
    link.target = '_blank'; // Flow Factory URL은 외부 링크일 수 있음
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };



/* ════════════════════════════════════════════════════════════════════════
   WanGP 영상 생성 위젯 (Wan2.x · 로컬/원격 GPU)
   - server.py 프록시: /api/wangp/{api-health,models,generate,job/<id>,file}
   - 백엔드: Wan2GP-main/wangp_rest_server.py (GPU 머신에서 실행)
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  const state = {
    tab: 'text',          // 'text' | 'image'
    imageB64: null,       // i2v 시작 이미지 (data URL)
    res: '832x480',
    len: 49,
    step: 25,
    polls: {},            // job_id -> intervalId
  };

  function $(id) { return document.getElementById(id); }

  // ── 토글 열기/닫기 ──
  function openWangp() {
    const w = $('wangpVideoWindow');
    if (!w) return;
    w.classList.add('open');
    checkWangpHealth();
    loadWangpModels();
    populateWangpCardThumbs();
  }
  function closeWangp() {
    const w = $('wangpVideoWindow');
    if (w) w.classList.remove('open');
  }

  // ── 사이드카 연결 상태 배지 ──
  async function checkWangpHealth() {
    const badge = $('wangpStatusBadge');
    if (badge) { badge.textContent = '● 연결 확인 중'; badge.className = 'text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full'; }
    try {
      const r = await fetch('/api/wangp/api-health');
      const d = await r.json();
      if (!badge) return;
      if (d.ok && d.model_loaded === false && !d.busy) {
        badge.textContent = '● 연결됨 (모델 미로딩)';
        badge.className = 'text-[10px] bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded-full';
      } else if (d.ok && d.busy) {
        badge.textContent = '● 생성 중';
        badge.className = 'text-[10px] bg-amber-900 text-amber-300 px-2 py-0.5 rounded-full';
      } else if (d.ok) {
        badge.textContent = '● 연결됨';
        badge.className = 'text-[10px] bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded-full';
      } else {
        badge.textContent = '● 오프라인';
        badge.className = 'text-[10px] bg-rose-900 text-rose-300 px-2 py-0.5 rounded-full';
      }
    } catch (e) {
      if (badge) {
        badge.textContent = '● 오프라인';
        badge.className = 'text-[10px] bg-rose-900 text-rose-300 px-2 py-0.5 rounded-full';
      }
    }
  }

  // ── 모델 목록 동적 로딩 (best-effort, 실패 시 정적 옵션 유지) ──
  async function loadWangpModels() {
    try {
      const r = await fetch('/api/wangp/models');
      if (!r.ok) return;
      const d = await r.json();
      const models = (d && d.models) || [];
      if (!models.length) return;
      const sel = $('wangpModel');
      if (!sel) return;
      const prev = sel.value;
      sel.innerHTML = '';
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.model_type;
        opt.textContent = m.name || m.model_type;
        opt.dataset.kind = m.kind || '';
        sel.appendChild(opt);
      });
      // 이전 선택 유지
      if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
    } catch (e) { /* 정적 옵션 유지 */ }
  }

  // ── 탭 전환 ──
  window.switchWangpTab = function (mode) {
    state.tab = mode;
    const tabText = $('wangpTabText'), tabImg = $('wangpTabImg'), panel = $('wangpImgPanel');
    const active = 'flex-1 py-2 text-xs font-bold rounded-lg bg-indigo-700 text-white border border-indigo-600 transition';
    const idle = 'flex-1 py-2 text-xs font-bold rounded-lg bg-slate-700 text-slate-300 border border-slate-600 transition';
    if (mode === 'image') {
      tabImg.className = active; tabText.className = idle;
      panel.classList.remove('hidden');
      // i2v 모델 우선 선택
      const sel = $('wangpModel');
      const i2v = [...sel.options].find(o => (o.dataset.kind === 'i2v') || /^i2v/.test(o.value));
      if (i2v) sel.value = i2v.value;
      populateWangpCardThumbs();
    } else {
      tabText.className = active; tabImg.className = idle;
      panel.classList.add('hidden');
      const sel = $('wangpModel');
      const t2v = [...sel.options].find(o => (o.dataset.kind === 't2v') || /^t2v/.test(o.value));
      if (t2v) sel.value = t2v.value;
    }
  };

  // ── 이미지 업로드 ──
  window.handleWangpImgUpload = function (input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => setWangpImage(e.target.result, file.name);
    reader.readAsDataURL(file);
  };

  function setWangpImage(dataUrl, label) {
    state.imageB64 = dataUrl;
    $('wangpImgName').textContent = label || '선택됨';
    $('wangpImgEl').src = dataUrl;
    $('wangpImgPreview').classList.remove('hidden');
  }

  // ── 페이지에 생성된 카드 이미지 썸네일 (i2v 시작 이미지로 사용) ──
  function populateWangpCardThumbs() {
    const strip = $('wangpCardThumbStrip'), wrap = $('wangpCardThumbs');
    if (!strip || !wrap) return;
    const imgs = [...document.querySelectorAll('img[src^="data:image"]')]
      .filter(im => im.closest('#wangpVideoWindow') === null);
    if (!imgs.length) { strip.classList.add('hidden'); return; }
    wrap.innerHTML = '';
    imgs.slice(0, 12).forEach(im => {
      const t = document.createElement('img');
      t.src = im.src;
      t.className = 'w-12 h-12 object-cover rounded-lg border border-slate-600 cursor-pointer hover:border-indigo-400 flex-shrink-0';
      t.onclick = () => setWangpImage(im.src, '카드 이미지');
      wrap.appendChild(t);
    });
    strip.classList.remove('hidden');
  }

  // ── 옵션 버튼 (해상도/길이/스텝) 위임 처리 ──
  function wireOptionRow(rowId, key, parse) {
    const row = $(rowId);
    if (!row) return;
    row.addEventListener('click', ev => {
      const btn = ev.target.closest('button[data-val]');
      if (!btn) return;
      [...row.querySelectorAll('button[data-val]')].forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state[key] = parse ? parse(btn.dataset.val) : btn.dataset.val;
    });
  }

  // ── 생성 시작 ──
  window.startWangpGenerate = async function () {
    const prompt = ($('wangpPrompt').value || '').trim();
    if (!prompt) { alert('프롬프트를 입력하세요.'); return; }
    if (state.tab === 'image' && !state.imageB64) { alert('이미지→영상 모드에서는 시작 이미지를 선택하세요.'); return; }

    const body = {
      model_type: $('wangpModel').value,
      prompt: prompt,
      negative_prompt: ($('wangpNegPrompt').value || '').trim(),
      resolution: state.res,
      video_length: state.len,
      num_inference_steps: state.step,
      seed: -1,
    };
    if (state.tab === 'image' && state.imageB64) body.image_start = state.imageB64;

    const btn = $('wangpGenerateBtn');
    btn.disabled = true; btn.style.opacity = '0.6';
    try {
      const r = await fetch('/api/wangp/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
      addWangpCard(d.job_id, body);
      pollWangpJob(d.job_id);
      checkWangpHealth();
    } catch (e) {
      alert('생성 시작 실패: ' + e.message + '\n\nGPU 머신에서 wangp_rest_server.py 가 실행 중인지, .env 의 WANGP_API_URL 을 확인하세요.');
    } finally {
      btn.disabled = false; btn.style.opacity = '1';
    }
  };

  // ── 큐 카드 ──
  function addWangpCard(jobId, body) {
    const q = $('wangpQueue');
    const card = document.createElement('div');
    card.id = 'wangp-card-' + jobId;
    card.className = 'p-3 bg-slate-900/60 border border-slate-700 rounded-xl';
    card.innerHTML =
      '<div class="flex items-center justify-between mb-1.5">' +
        '<span class="text-[11px] font-bold text-indigo-300">🎬 ' + escHtml(body.model_type) + '</span>' +
        '<button class="text-[10px] text-slate-500 hover:text-rose-300" onclick="cancelWangpJob(\'' + jobId + '\')">취소</button>' +
      '</div>' +
      '<p class="text-[10px] text-slate-400 mb-2 line-clamp-2">' + escHtml(body.prompt) + '</p>' +
      '<div class="wangp-status text-[11px] text-amber-300">⏳ 대기 중…</div>' +
      '<div class="wangp-output mt-2"></div>';
    q.prepend(card);
  }

  function escHtml(s) {
    return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ── 작업 폴링 ──
  function pollWangpJob(jobId) {
    if (state.polls[jobId]) clearInterval(state.polls[jobId]);
    state.polls[jobId] = setInterval(async () => {
      try {
        const r = await fetch('/api/wangp/job/' + jobId);
        const d = await r.json();
        const card = $('wangp-card-' + jobId);
        if (!card) { stopPoll(jobId); return; }
        const statusEl = card.querySelector('.wangp-status');
        const outEl = card.querySelector('.wangp-output');

        if (d.status === 'running') {
          const p = d.progress || {};
          let txt = '🔄 생성 중';
          if (p.phase) txt += ' · ' + p.phase;
          if (p.current_step != null && p.total_steps) txt += ' (' + p.current_step + '/' + p.total_steps + ')';
          statusEl.textContent = txt;
          statusEl.className = 'wangp-status text-[11px] text-sky-300';
        } else if (d.status === 'queued') {
          statusEl.textContent = '⏳ 대기 중…';
        } else if (d.status === 'done') {
          stopPoll(jobId);
          statusEl.textContent = '✅ 완료';
          statusEl.className = 'wangp-status text-[11px] text-emerald-300';
          outEl.innerHTML = '';
          (d.files || []).forEach(name => {
            const url = '/api/wangp/file?name=' + encodeURIComponent(name);
            const v = document.createElement('video');
            v.src = url; v.controls = true; v.className = 'w-full rounded-lg border border-slate-700 mb-1';
            outEl.appendChild(v);
            const a = document.createElement('a');
            a.href = url; a.download = name; a.textContent = '⬇️ ' + name;
            a.className = 'text-[10px] text-indigo-300 hover:text-indigo-200 underline block';
            outEl.appendChild(a);
          });
          checkWangpHealth();
        } else if (d.status === 'error' || d.status === 'cancelled') {
          stopPoll(jobId);
          statusEl.textContent = (d.status === 'cancelled' ? '⛔ 취소됨' : '❌ 실패') + (d.error ? ' · ' + d.error : '');
          statusEl.className = 'wangp-status text-[11px] text-rose-300';
          checkWangpHealth();
        }
      } catch (e) { /* 일시적 네트워크 오류 무시 */ }
    }, 2000);
  }

  function stopPoll(jobId) {
    if (state.polls[jobId]) { clearInterval(state.polls[jobId]); delete state.polls[jobId]; }
  }

  window.cancelWangpJob = async function (jobId) {
    try { await fetch('/api/wangp/cancel/' + jobId, { method: 'POST' }); } catch (e) {}
  };

  // ── 초기 와이어링 ──
  function init() {
    const toggle = $('wangpVideoToggle');
    const closeBtn = $('wangpVideoCloseBtn');
    if (toggle) toggle.addEventListener('click', () => {
      const w = $('wangpVideoWindow');
      if (w && w.classList.contains('open')) closeWangp(); else openWangp();
    });
    if (closeBtn) closeBtn.addEventListener('click', closeWangp);
    wireOptionRow('wangpResRow', 'res', null);
    wireOptionRow('wangpLenRow', 'len', v => parseInt(v, 10));
    wireOptionRow('wangpStepRow', 'step', v => parseInt(v, 10));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

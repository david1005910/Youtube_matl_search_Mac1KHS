/**
 * app.js
 * WaveStudio Pro - Multi-Scene Narration Subtitles & Classic Video Studio
 */

(function () {
  'use strict';

  // Global State
  const state = {
    currentTab: 'remotion', // 'remotion' | 'scene' | 'classic'

    // Scene Studio State
    sceneAudioFile: null,
    sceneAudioDuration: 0,
    scenes: [], // [{ id, file, url, type, isVideo, duration, subtitle, imgBitmap }]
    activeSceneIndex: 0,
    subFontSize: 30,
    subFontColor: '#ffffff',
    subBgStyle: 'box', // 'box' | 'shadow'
    subPosition: 'bottom', // 'bottom' | 'center' | 'top'

    // Classic Studio State
    classicAudioFile: null,
    classicImageFile: null,
    classicImageBitmap: null,
    selectedMode: 'waveform_overlay',
    batchAll: false,
    waveColor: '#00d2ff',
    opacity: 0.7,
    waveHeight: 320,
    classicPosition: 'bottom',

    // Shared State
    activeJobId: null,
    pollTimer: null,
    sceneAudioPreviewer: null,
    classicAudioPreviewer: null
  };

  const PRESETS = [
    { name: 'Cyber Cyan', color: '#00d2ff' },
    { name: 'Neon Sunset', color: '#f97316' },
    { name: 'Violet Pulse', color: '#a855f7' },
    { name: 'Emerald Glow', color: '#10b981' },
    { name: 'Pure White', color: '#ffffff' },
    { name: 'Hot Pink', color: '#ff0080' }
  ];

  const el = {};

  document.addEventListener('DOMContentLoaded', () => {
    initDOMElements();
    initTabSwitching();
    initSceneStudio();
    initClassicStudio();
    initCommonFeatures();
    fetchLibraryFiles();

    // Determine initial tab from URL hash or localStorage, default to 'youtube' for AI Overview discovery
    const hash = (window.location.hash || '').replace('#', '').toLowerCase();
    const storedTab = localStorage.getItem('wave_active_tab');
    let initialTab = 'youtube';

    if (['youtube', 'notebooklm', 'overview'].includes(hash)) {
      initialTab = 'youtube';
    } else if (['remotion', 'scene', 'classic'].includes(hash)) {
      initialTab = hash;
    } else if (storedTab && ['youtube', 'remotion', 'scene', 'classic'].includes(storedTab)) {
      initialTab = storedTab;
    }

    setTab(initialTab);
  });

  function initDOMElements() {
    // Tabs & Viewports
    el.tabRemotion = document.getElementById('tabRemotionStudio');
    el.tabScene = document.getElementById('tabSceneStudio');
    el.tabYoutube = document.getElementById('tabYoutubeOverview');
    el.tabClassic = document.getElementById('tabClassicStudio');
    el.btnQuickNotebookLM = document.getElementById('btnQuickNotebookLM');
    el.viewRemotion = document.getElementById('remotionStudioView');
    el.viewScene = document.getElementById('sceneStudioView');
    el.viewYoutube = document.getElementById('youtubeOverviewView');
    el.viewClassic = document.getElementById('classicStudioView');
    el.standardGrid = document.getElementById('standardStudioGrid');
    el.previewColumn = document.querySelector('.preview-column');
    el.libraryPanel = document.getElementById('libraryPanel');
    el.remotionSharedAnchor = document.getElementById('remotionSharedAnchor');

    // Scene Studio
    el.sceneAudioDrop = document.getElementById('sceneAudioDrop');
    el.sceneAudioInput = document.getElementById('sceneAudioInput');
    el.sceneAudioLoadedCard = document.getElementById('sceneAudioLoadedCard');
    el.sceneAudioFileName = document.getElementById('sceneAudioFileName');
    el.sceneAudioFileSize = document.getElementById('sceneAudioFileSize');
    el.btnRemoveSceneAudio = document.getElementById('btnRemoveSceneAudio');

    el.narrationFileInput = document.getElementById('narrationFileInput');
    el.narrationText = document.getElementById('narrationText');
    el.scriptSentenceCount = document.getElementById('scriptSentenceCount');
    el.btnDistributeSubs = document.getElementById('btnDistributeSubs');
    el.btnAutoBalanceDuration = document.getElementById('btnAutoBalanceDuration');

    el.multiSceneDrop = document.getElementById('multiSceneDrop');
    el.multiSceneInput = document.getElementById('multiSceneInput');
    el.scenesContainer = document.getElementById('scenesContainer');
    el.btnAddScene = document.getElementById('btnAddScene');
    el.scenesTotalInfo = document.getElementById('scenesTotalInfo');

    el.subFontSize = document.getElementById('subFontSize');
    el.subFontSizeVal = document.getElementById('subFontSizeVal');
    el.subFontColorInput = document.getElementById('subFontColorInput');
    el.subFontColorHex = document.getElementById('subFontColorHex');
    el.subBgBox = document.getElementById('subBgBox');
    el.subBgShadow = document.getElementById('subBgShadow');
    el.subPosTop = document.getElementById('subPosTop');
    el.subPosCenter = document.getElementById('subPosCenter');
    el.subPosBottom = document.getElementById('subPosBottom');

    // Classic Studio
    el.classicAudioDrop = document.getElementById('audioDrop');
    el.classicAudioInput = document.getElementById('audioInput');
    el.classicAudioLoadedCard = document.getElementById('audioLoadedCard');
    el.classicAudioFileName = document.getElementById('audioFileName');
    el.classicAudioFileSize = document.getElementById('audioFileSize');
    el.btnRemoveClassicAudio = document.getElementById('btnRemoveAudio');

    el.classicImageDrop = document.getElementById('imageDrop');
    el.classicImageInput = document.getElementById('imageInput');
    el.classicImageLoadedCard = document.getElementById('imageLoadedCard');
    el.classicImageFileName = document.getElementById('imageFileName');
    el.classicImageFileSize = document.getElementById('imageFileSize');
    el.btnRemoveClassicImage = document.getElementById('btnRemoveImage');
    el.classicImageThumb = document.getElementById('imageThumb');

    el.classicModeCards = document.querySelectorAll('.mode-card');
    el.batchToggle = document.getElementById('batchAllToggle');
    el.classicOptionsPanel = document.getElementById('optionsPanel');
    el.presetsContainer = document.getElementById('presetsContainer');
    el.waveColorInput = document.getElementById('waveColorInput');
    el.waveColorHex = document.getElementById('waveColorHex');
    el.opacitySlider = document.getElementById('opacitySlider');
    el.opacityVal = document.getElementById('opacityVal');
    el.heightSlider = document.getElementById('heightSlider');
    el.heightVal = document.getElementById('heightVal');
    el.classicPosButtons = document.querySelectorAll('#optionsPanel .segment-btn');

    // Common Elements
    el.btnGenerate = document.getElementById('btnGenerate');
    el.btnGenerateText = document.getElementById('btnGenerateText');
    el.previewCanvas = document.getElementById('previewCanvas');
    el.previewModeBadge = document.getElementById('previewModeBadge');
    el.previewSceneIndicator = document.getElementById('previewSceneIndicator');

    el.monitorPanel = document.getElementById('monitorPanel');
    el.stageBadge = document.getElementById('stageBadge');
    el.percentageText = document.getElementById('percentageText');
    el.progressBar = document.getElementById('progressBar');
    el.btnCancel = document.getElementById('btnCancel');
    el.btnToggleLog = document.getElementById('btnToggleLog');
    el.terminalDrawer = document.getElementById('terminalDrawer');
    el.terminalLog = document.getElementById('terminalLog');
    el.stepPills = document.querySelectorAll('.step-pill');

    el.resultsContainer = document.getElementById('resultsContainer');
    el.resultsList = document.getElementById('resultsList');
    el.libraryGrid = document.getElementById('libraryGrid');

    el.videoModal = document.getElementById('videoModal');
    el.modalVideo = document.getElementById('modalVideo');
    el.modalTitle = document.getElementById('modalTitle');
    el.btnCloseModal = document.getElementById('btnCloseModal');
  }

  // ==========================================
  // Tab Switching
  // ==========================================
  function initTabSwitching() {
    if (el.tabRemotion) el.tabRemotion.addEventListener('click', () => setTab('remotion'));
    if (el.tabScene) el.tabScene.addEventListener('click', () => setTab('scene'));
    if (el.tabYoutube) el.tabYoutube.addEventListener('click', () => setTab('youtube'));
    if (el.tabClassic) el.tabClassic.addEventListener('click', () => setTab('classic'));

    if (el.btnQuickNotebookLM) {
      el.btnQuickNotebookLM.addEventListener('click', () => {
        setTab('youtube');
        const viewEl = document.getElementById('youtubeOverviewView');
        if (viewEl) viewEl.scrollIntoView({ behavior: 'smooth' });
      });
    }

    window.addEventListener('hashchange', () => {
      const h = (window.location.hash || '').replace('#', '').toLowerCase();
      if (['youtube', 'notebooklm', 'overview'].includes(h)) {
        setTab('youtube');
      } else if (['remotion', 'scene', 'classic'].includes(h)) {
        setTab(h);
      }
    });
  }

  function setTab(tab) {
    state.currentTab = tab;

    try {
      localStorage.setItem('wave_active_tab', tab);
      if (window.location.hash !== '#' + tab) {
        history.replaceState(null, '', '#' + tab);
      }
    } catch (e) {
      // Ignore storage errors
    }

    // Reset all tab active classes
    [el.tabRemotion, el.tabScene, el.tabYoutube, el.tabClassic].forEach(t => {
      if (t) t.classList.remove('active');
    });

    if (tab === 'remotion') {
      if (el.tabRemotion) el.tabRemotion.classList.add('active');
      if (el.viewRemotion) el.viewRemotion.style.display = 'block';
      if (el.viewYoutube) el.viewYoutube.style.display = 'none';
      if (el.standardGrid) el.standardGrid.style.display = 'none';

      // Move monitor, results, library to remotion shared anchor
      if (el.remotionSharedAnchor) {
        if (el.monitorPanel) el.remotionSharedAnchor.appendChild(el.monitorPanel);
        if (el.resultsContainer) el.remotionSharedAnchor.appendChild(el.resultsContainer);
        if (el.libraryPanel) el.remotionSharedAnchor.appendChild(el.libraryPanel);
      }

      if (window.remotionApp) {
        window.remotionApp.renderTimeline();
        window.remotionApp.renderCanvas();
      }
    } else if (tab === 'youtube') {
      if (el.tabYoutube) el.tabYoutube.classList.add('active');
      if (el.viewYoutube) el.viewYoutube.style.display = 'block';
      if (el.viewRemotion) el.viewRemotion.style.display = 'none';
      if (el.standardGrid) el.standardGrid.style.display = 'none';
    } else {
      if (el.viewRemotion) el.viewRemotion.style.display = 'none';
      if (el.viewYoutube) el.viewYoutube.style.display = 'none';
      if (el.standardGrid) el.standardGrid.style.display = 'grid';

      // Move monitor, results, library back to preview column
      if (el.previewColumn) {
        if (el.monitorPanel) el.previewColumn.appendChild(el.monitorPanel);
        if (el.resultsContainer) el.previewColumn.appendChild(el.resultsContainer);
        if (el.libraryPanel) el.previewColumn.appendChild(el.libraryPanel);
      }

      if (tab === 'scene') {
        if (el.tabScene) el.tabScene.classList.add('active');
        el.viewScene.style.display = 'block';
        el.viewClassic.style.display = 'none';
        el.previewModeBadge.textContent = 'SCENE PREVIEW';
        el.previewSceneIndicator.style.display = 'block';
      } else {
        if (el.tabClassic) el.tabClassic.classList.add('active');
        el.viewClassic.style.display = 'block';
        el.viewScene.style.display = 'none';
        el.previewModeBadge.textContent = 'CLASSIC PREVIEW';
        el.previewSceneIndicator.style.display = 'none';
      }
      updateGenerateButtonState();
      renderLivePreview();
    }
  }

  // ==========================================
  // Scene Studio Implementation
  // ==========================================
  function initSceneStudio() {
    state.sceneAudioPreviewer = new AudioWavePreviewer('sceneAudioWaveCanvas', 'btnPlaySceneAudio', 'sceneAudioTimeLabel');

    // Scene Audio Dropzone
    setupDropzone(el.sceneAudioDrop, el.sceneAudioInput, async (file) => {
      if (!isAudioFile(file)) {
        alert('오디오 파일(.mp3, .wav, .m4a 등)만 업로드 가능합니다.');
        return;
      }
      state.sceneAudioFile = file;
      el.sceneAudioFileName.textContent = file.name;
      el.sceneAudioFileSize.textContent = formatBytes(file.size);
      el.sceneAudioDrop.style.display = 'none';
      el.sceneAudioLoadedCard.classList.add('active');
      const dur = await state.sceneAudioPreviewer.loadFile(file);
      if (dur) state.sceneAudioDuration = dur;
      autoBalanceSceneDurations();
      updateGenerateButtonState();
    });

    el.btnRemoveSceneAudio.addEventListener('click', () => {
      state.sceneAudioFile = null;
      state.sceneAudioDuration = 0;
      el.sceneAudioInput.value = '';
      el.sceneAudioLoadedCard.classList.remove('active');
      el.sceneAudioDrop.style.display = 'flex';
      state.sceneAudioPreviewer.reset();
      updateGenerateButtonState();
    });

    // Narration Script Upload & Input
    el.narrationFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (re) => {
          el.narrationText.value = re.target.result;
          updateNarrationCount();
        };
        reader.readAsText(file);
      }
    });

    el.narrationText.addEventListener('input', () => {
      updateNarrationCount();
    });

    // Auto Distribute Subtitles
    el.btnDistributeSubs.addEventListener('click', () => {
      distributeNarrationToScenes();
    });

    // Auto Balance Duration
    el.btnAutoBalanceDuration.addEventListener('click', () => {
      autoBalanceSceneDurations();
    });

    // Multi-Scene Dropzone
    el.multiSceneDrop.addEventListener('click', () => el.multiSceneInput.click());
    el.btnAddScene.addEventListener('click', () => el.multiSceneInput.click());

    ['dragenter', 'dragover'].forEach(name => {
      el.multiSceneDrop.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.multiSceneDrop.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      el.multiSceneDrop.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.multiSceneDrop.classList.remove('drag-over');
      });
    });

    el.multiSceneDrop.addEventListener('drop', (e) => {
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        addSceneFiles(Array.from(e.dataTransfer.files));
      }
    });

    el.multiSceneInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length) {
        addSceneFiles(Array.from(e.target.files));
        el.multiSceneInput.value = '';
      }
    });

    // Subtitle Customizers
    el.subFontSize.addEventListener('input', (e) => {
      state.subFontSize = parseInt(e.target.value, 10);
      el.subFontSizeVal.textContent = `${state.subFontSize}px`;
      renderLivePreview();
    });

    el.subFontColorInput.addEventListener('input', (e) => {
      state.subFontColor = e.target.value;
      el.subFontColorHex.value = e.target.value;
      renderLivePreview();
    });

    el.subFontColorHex.addEventListener('input', (e) => {
      let val = e.target.value.trim();
      if (!val.startsWith('#')) val = '#' + val;
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        state.subFontColor = val;
        el.subFontColorInput.value = val;
        renderLivePreview();
      }
    });

    el.subBgBox.addEventListener('click', () => {
      state.subBgStyle = 'box';
      el.subBgBox.classList.add('active');
      el.subBgShadow.classList.remove('active');
      renderLivePreview();
    });

    el.subBgShadow.addEventListener('click', () => {
      state.subBgStyle = 'shadow';
      el.subBgShadow.classList.add('active');
      el.subBgBox.classList.remove('active');
      renderLivePreview();
    });

    [el.subPosTop, el.subPosCenter, el.subPosBottom].forEach(btn => {
      btn.addEventListener('click', () => {
        [el.subPosTop, el.subPosCenter, el.subPosBottom].forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.subPosition = btn.dataset.subpos;
        renderLivePreview();
      });
    });
  }

  function addSceneFiles(files) {
    const validFiles = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (!validFiles.length) {
      alert('이미지 또는 비디오 파일만 추가할 수 있습니다.');
      return;
    }

    validFiles.forEach(file => {
      const isVideo = file.type.startsWith('video/');
      const url = URL.createObjectURL(file);
      const sceneItem = {
        id: Date.now() + Math.random().toString(36).substring(2, 7),
        file: file,
        url: url,
        name: file.name,
        type: isVideo ? '동영상' : '이미지',
        isVideo: isVideo,
        duration: 3.5,
        subtitle: '',
        imgBitmap: null
      };

      if (!isVideo) {
        const img = new Image();
        img.onload = () => {
          sceneItem.imgBitmap = img;
          renderLivePreview();
        };
        img.src = url;
      }

      state.scenes.push(sceneItem);
    });

    if (state.scenes.length === validFiles.length) {
      state.activeSceneIndex = 0;
    }

    autoBalanceSceneDurations();
    renderSceneCards();
    updateGenerateButtonState();
    renderLivePreview();
  }

  function renderSceneCards() {
    el.scenesContainer.innerHTML = '';
    el.scenesTotalInfo.textContent = `총 ${state.scenes.length}개 씬 등록됨`;

    state.scenes.forEach((scene, index) => {
      const card = document.createElement('div');
      card.className = `scene-card ${index === state.activeSceneIndex ? 'active-preview' : ''}`;
      card.dataset.index = index;

      card.innerHTML = `
        <div class="scene-card-top">
          <div class="scene-badge-group">
            <span class="scene-num-badge">씬 ${index + 1}</span>
            <span class="scene-type-tag">${scene.isVideo ? '🎥 동영상' : '🖼️ 이미지'}</span>
            <div class="scene-duration-wrap">
              <span>길이:</span>
              <input type="number" min="0.5" max="300" step="0.5" class="scene-duration-input" value="${scene.duration.toFixed(1)}">
              <span>초</span>
            </div>
          </div>
          <div class="scene-actions">
            <button type="button" class="btn-scene-action btn-move-up" title="위로 이동" ${index === 0 ? 'disabled' : ''}>▲</button>
            <button type="button" class="btn-scene-action btn-move-down" title="아래로 이동" ${index === state.scenes.length - 1 ? 'disabled' : ''}>▼</button>
            <button type="button" class="btn-scene-action btn-scene-del" title="씬 삭제">🗑️</button>
          </div>
        </div>
        <div class="scene-content-row">
          <div class="scene-thumb-box" title="클릭 시 실시간 프리뷰 활성화">
            ${scene.isVideo
              ? `<video src="${scene.url}" class="scene-thumb-video" muted playsinline></video>`
              : `<img src="${scene.url}" class="scene-thumb-img" alt="미리보기">`
            }
            <span class="scene-preview-hint">미리보기</span>
          </div>
          <div class="scene-sub-input-wrap">
            <textarea class="scene-sub-textarea" placeholder="씬 ${index + 1}에 표시될 나레이션 자막을 입력하세요...">${scene.subtitle || ''}</textarea>
            <span class="scene-sub-time-hint" id="sceneTimeHint_${index}">타임라인: ${calculateSceneTimeRange(index)}</span>
          </div>
        </div>
      `;

      // Event Listeners
      const thumbBox = card.querySelector('.scene-thumb-box');
      thumbBox.addEventListener('click', () => {
        state.activeSceneIndex = index;
        document.querySelectorAll('.scene-card').forEach(c => c.classList.remove('active-preview'));
        card.classList.add('active-preview');
        renderLivePreview();
      });

      const subTextarea = card.querySelector('.scene-sub-textarea');
      subTextarea.addEventListener('input', (e) => {
        scene.subtitle = e.target.value;
        if (index === state.activeSceneIndex) {
          renderLivePreview();
        }
      });

      const durInput = card.querySelector('.scene-duration-input');
      durInput.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value) || 1.0;
        scene.duration = Math.max(0.5, val);
        updateSceneTimeHints();
      });

      const btnUp = card.querySelector('.btn-move-up');
      if (btnUp) {
        btnUp.addEventListener('click', () => {
          if (index > 0) {
            const temp = state.scenes[index];
            state.scenes[index] = state.scenes[index - 1];
            state.scenes[index - 1] = temp;
            state.activeSceneIndex = index - 1;
            renderSceneCards();
            renderLivePreview();
          }
        });
      }

      const btnDown = card.querySelector('.btn-move-down');
      if (btnDown) {
        btnDown.addEventListener('click', () => {
          if (index < state.scenes.length - 1) {
            const temp = state.scenes[index];
            state.scenes[index] = state.scenes[index + 1];
            state.scenes[index + 1] = temp;
            state.activeSceneIndex = index + 1;
            renderSceneCards();
            renderLivePreview();
          }
        });
      }

      const btnDel = card.querySelector('.btn-scene-del');
      btnDel.addEventListener('click', () => {
        state.scenes.splice(index, 1);
        if (state.activeSceneIndex >= state.scenes.length) {
          state.activeSceneIndex = Math.max(0, state.scenes.length - 1);
        }
        autoBalanceSceneDurations();
        renderSceneCards();
        updateGenerateButtonState();
        renderLivePreview();
      });

      el.scenesContainer.appendChild(card);
    });
  }

  function calculateSceneTimeRange(targetIdx) {
    let start = 0;
    for (let i = 0; i < targetIdx; i++) {
      start += state.scenes[i].duration;
    }
    const end = start + (state.scenes[targetIdx]?.duration || 0);
    return `${start.toFixed(1)}초 ~ ${end.toFixed(1)}초 (${(end - start).toFixed(1)}초간)`;
  }

  function updateSceneTimeHints() {
    state.scenes.forEach((_, idx) => {
      const hint = document.getElementById(`sceneTimeHint_${idx}`);
      if (hint) {
        hint.textContent = `타임라인: ${calculateSceneTimeRange(idx)}`;
      }
    });
  }

  function autoBalanceSceneDurations() {
    if (!state.scenes.length) return;
    if (state.sceneAudioDuration > 0) {
      const slice = state.sceneAudioDuration / state.scenes.length;
      state.scenes.forEach(s => s.duration = Math.round(slice * 10) / 10);
      updateSceneTimeHints();
      renderSceneCards();
    }
  }

  function updateNarrationCount() {
    const text = el.narrationText.value.trim();
    if (!text) {
      el.scriptSentenceCount.textContent = '0개 문장 감지됨';
      return;
    }
    const sentences = splitIntoSentences(text);
    el.scriptSentenceCount.textContent = `${sentences.length}개 문장 감지됨`;
  }

  function splitIntoSentences(text) {
    // 문장 부호(. ! ? 줄바꿈)를 기준으로 의미 있는 문장 분할
    const parts = text.split(/(?<=[.?!])\s+|\n+/);
    return parts.map(s => s.trim()).filter(s => s.length > 0);
  }

  function distributeNarrationToScenes() {
    const text = el.narrationText.value.trim();
    if (!text) {
      alert('나레이션 대본 텍스트를 먼저 입력하거나 업로드하세요.');
      return;
    }
    if (!state.scenes.length) {
      alert('자막을 배분할 씬(이미지 또는 동영상)을 먼저 1개 이상 추가해주세요.');
      return;
    }

    const sentences = splitIntoSentences(text);
    const numScenes = state.scenes.length;

    // 문장 개수와 씬 개수에 맞추어 비례 분배
    if (sentences.length <= numScenes) {
      state.scenes.forEach((scene, idx) => {
        scene.subtitle = sentences[idx] || '';
      });
    } else {
      // 문장이 더 많은 경우 씬마다 적절히 합쳐서 분배
      const sentencesPerScene = Math.ceil(sentences.length / numScenes);
      state.scenes.forEach((scene, idx) => {
        const start = idx * sentencesPerScene;
        const end = Math.min(sentences.length, start + sentencesPerScene);
        scene.subtitle = sentences.slice(start, end).join(' ');
      });
    }

    renderSceneCards();
    renderLivePreview();
    alert(`총 ${sentences.length}개의 나레이션 문장이 ${numScenes}개의 씬에 균등하게 자동 배분되었습니다!`);
  }

  // ==========================================
  // Classic Studio Implementation
  // ==========================================
  function initClassicStudio() {
    state.classicAudioPreviewer = new AudioWavePreviewer('audioWaveCanvas', 'btnPlayAudio', 'audioTimeLabel');
    initPresets();

    // Classic Audio Dropzone
    setupDropzone(el.classicAudioDrop, el.classicAudioInput, (file) => {
      if (!isAudioFile(file)) {
        alert('오디오 파일(.mp3, .wav, .m4a 등)만 업로드 가능합니다.');
        return;
      }
      state.classicAudioFile = file;
      el.classicAudioFileName.textContent = file.name;
      el.classicAudioFileSize.textContent = formatBytes(file.size);
      el.classicAudioDrop.style.display = 'none';
      el.classicAudioLoadedCard.classList.add('active');
      state.classicAudioPreviewer.loadFile(file);
      updateGenerateButtonState();
    });

    el.btnRemoveClassicAudio.addEventListener('click', () => {
      state.classicAudioFile = null;
      el.classicAudioInput.value = '';
      el.classicAudioLoadedCard.classList.remove('active');
      el.classicAudioDrop.style.display = 'flex';
      state.classicAudioPreviewer.reset();
      updateGenerateButtonState();
    });

    // Classic Image Dropzone
    setupDropzone(el.classicImageDrop, el.classicImageInput, (file) => {
      if (!file.type.startsWith('image/')) {
        alert('이미지 파일(.jpg, .png, .webp 등)만 업로드 가능합니다.');
        return;
      }
      state.classicImageFile = file;
      el.classicImageFileName.textContent = file.name;
      el.classicImageFileSize.textContent = formatBytes(file.size);
      el.classicImageDrop.style.display = 'none';
      el.classicImageLoadedCard.classList.add('active');

      const url = URL.createObjectURL(file);
      el.classicImageThumb.src = url;

      const img = new Image();
      img.onload = () => {
        state.classicImageBitmap = img;
        renderLivePreview();
      };
      img.src = url;

      updateGenerateButtonState();
    });

    el.btnRemoveClassicImage.addEventListener('click', () => {
      state.classicImageFile = null;
      state.classicImageBitmap = null;
      el.classicImageInput.value = '';
      el.classicImageLoadedCard.classList.remove('active');
      el.classicImageDrop.style.display = 'flex';
      el.classicImageThumb.src = '';
      renderLivePreview();
      updateGenerateButtonState();
    });

    // Classic Mode Cards
    el.classicModeCards.forEach(card => {
      card.addEventListener('click', () => {
        el.classicModeCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        state.selectedMode = card.dataset.mode;
        updateOptionsVisibility();
        updateGenerateButtonState();
        renderLivePreview();
      });
    });

    if (el.batchToggle) {
      el.batchToggle.addEventListener('change', (e) => {
        state.batchAll = e.target.checked;
        updateOptionsVisibility();
        updateGenerateButtonState();
      });
    }

    // Classic Customizers
    el.waveColorInput.addEventListener('input', (e) => applyClassicColor(e.target.value));
    el.waveColorHex.addEventListener('input', (e) => {
      let val = e.target.value.trim();
      if (!val.startsWith('#')) val = '#' + val;
      if (/^#[0-9a-fA-F]{6}$/.test(val)) applyClassicColor(val);
    });

    el.opacitySlider.addEventListener('input', (e) => {
      state.opacity = parseFloat(e.target.value);
      el.opacityVal.textContent = `${Math.round(state.opacity * 100)}%`;
      renderLivePreview();
    });

    el.heightSlider.addEventListener('input', (e) => {
      state.waveHeight = parseInt(e.target.value, 10);
      el.heightVal.textContent = `${state.waveHeight}px`;
      renderLivePreview();
    });

    el.classicPosButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        el.classicPosButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.classicPosition = btn.dataset.pos;
        renderLivePreview();
      });
    });
  }

  function initPresets() {
    if (!el.presetsContainer) return;
    el.presetsContainer.innerHTML = '';
    PRESETS.forEach(p => {
      const chip = document.createElement('div');
      chip.className = `preset-chip ${p.color.toLowerCase() === state.waveColor.toLowerCase() ? 'active' : ''}`;
      chip.dataset.color = p.color;
      chip.innerHTML = `<span class="preset-dot" style="background:${p.color}"></span>${p.name}`;
      chip.addEventListener('click', () => {
        applyClassicColor(p.color);
        document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
      el.presetsContainer.appendChild(chip);
    });
  }

  function applyClassicColor(hex) {
    state.waveColor = hex;
    el.waveColorInput.value = hex;
    el.waveColorHex.value = hex;
    renderLivePreview();
  }

  function updateOptionsVisibility() {
    const needOverlayOptions = state.batchAll || state.selectedMode === 'waveform_overlay' || state.selectedMode === 'waveform';
    if (el.classicOptionsPanel) {
      el.classicOptionsPanel.style.display = needOverlayOptions ? 'block' : 'none';
    }
  }

  // ==========================================
  // Live 1080p Canvas Preview Engine
  // ==========================================
  function renderLivePreview() {
    const canvas = el.previewCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width = 1920;
    const height = canvas.height = 1080;

    if (state.currentTab === 'scene') {
      // 씬 & 자막 스튜디오 프리뷰
      const curScene = state.scenes[state.activeSceneIndex];
      el.previewSceneIndicator.textContent = state.scenes.length
        ? `씬 ${state.activeSceneIndex + 1}/${state.scenes.length}`
        : '씬 없음';

      if (curScene && curScene.imgBitmap) {
        drawImageCover(ctx, curScene.imgBitmap, width, height);
      } else {
        drawDefaultVoidBackground(ctx, width, height);
      }

      // 자막 실시간 렌더링
      if (curScene && curScene.subtitle) {
        drawSubtitleOverlay(ctx, curScene.subtitle, width, height);
      }
    } else {
      // 클래식 모드 프리뷰
      if (state.classicImageBitmap && (state.selectedMode !== 'waveform' || state.batchAll)) {
        drawImageCover(ctx, state.classicImageBitmap, width, height);
      } else {
        drawDefaultVoidBackground(ctx, width, height);
      }

      if (state.selectedMode !== 'static' || state.batchAll) {
        drawWaveformSimulation(ctx, width, height);
      }
    }
  }

  function drawImageCover(ctx, img, width, height) {
    const imgAspect = img.width / img.height;
    const targetAspect = 16 / 9;
    let drawW, drawH, drawX, drawY;

    if (imgAspect > targetAspect) {
      drawH = height;
      drawW = height * imgAspect;
      drawX = (width - drawW) / 2;
      drawY = 0;
    } else {
      drawW = width;
      drawH = width / imgAspect;
      drawX = 0;
      drawY = (height - drawH) / 2;
    }
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
  }

  function drawDefaultVoidBackground(ctx, width, height) {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#0a0e18');
    grad.addColorStop(1, '#05070d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }

  function drawSubtitleOverlay(ctx, text, width, height) {
    ctx.save();
    const fontSize = state.subFontSize * 1.6; // 캔버스 1080p 해상도 비율 스케일
    ctx.font = `600 ${fontSize}px 'Inter', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 텍스트 줄바꿈 계산
    const maxWidth = width * 0.82;
    const words = text.split(' ');
    const lines = [];
    let curLine = '';

    for (const w of words) {
      const test = curLine ? curLine + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && curLine) {
        lines.push(curLine);
        curLine = w;
      } else {
        curLine = test;
      }
    }
    if (curLine) lines.push(curLine);

    const lineHeight = fontSize * 1.4;
    const totalTextHeight = lines.length * lineHeight;

    let centerY = height - 100 - (totalTextHeight / 2);
    if (state.subPosition === 'top') {
      centerY = 100 + (totalTextHeight / 2);
    } else if (state.subPosition === 'center') {
      centerY = height / 2;
    }

    const startY = centerY - (totalTextHeight / 2) + (lineHeight / 2);

    lines.forEach((line, idx) => {
      const lineY = startY + (idx * lineHeight);
      const textMetrics = ctx.measureText(line);
      const boxW = textMetrics.width + 40;
      const boxH = fontSize + 16;
      const boxX = (width - boxW) / 2;
      const boxY = lineY - (boxH / 2);

      if (state.subBgStyle === 'box') {
        // 반투명 배경 박스
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(boxX, boxY, boxW, boxH, 8);
          ctx.fill();
        } else {
          ctx.fillRect(boxX, boxY, boxW, boxH);
        }
      } else {
        // 외곽선 그림자
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 6;
        ctx.strokeText(line, width / 2, lineY);
      }

      ctx.fillStyle = state.subFontColor;
      ctx.fillText(line, width / 2, lineY);
    });

    ctx.restore();
  }

  function drawWaveformSimulation(ctx, width, height) {
    const waveH = state.waveHeight;
    let waveY = 0;
    if (state.classicPosition === 'center') {
      waveY = (height - waveH) / 2;
    } else if (state.classicPosition === 'top') {
      waveY = 100;
    } else {
      waveY = height - waveH - 100;
    }

    ctx.save();
    ctx.globalAlpha = state.opacity;
    ctx.strokeStyle = state.waveColor;
    ctx.fillStyle = state.waveColor;
    ctx.shadowColor = state.waveColor;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 3;

    const centerY = waveY + waveH / 2;
    const numPoints = 240;
    ctx.beginPath();
    for (let i = 0; i <= numPoints; i++) {
      const x = (i / numPoints) * width;
      const angle = (i / 15);
      const envelope = Math.sin((i / numPoints) * Math.PI);
      const amp = (Math.sin(angle * 1.8) * 0.4 + Math.cos(angle * 3.7) * 0.35 + Math.sin(angle * 5.5) * 0.25) * (waveH * 0.45) * envelope;
      const y = centerY + amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= numPoints; i++) {
      const x = (i / numPoints) * width;
      const angle = (i / 15) + 0.8;
      const envelope = Math.sin((i / numPoints) * Math.PI);
      const amp = (Math.cos(angle * 2.2) * 0.5 + Math.sin(angle * 4.1) * 0.3) * (waveH * 0.3) * envelope;
      const y = centerY - amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.restore();
  }

  // ==========================================
  // Common Features: Generate Action & API
  // ==========================================
  function initCommonFeatures() {
    window.addEventListener('resize', () => renderLivePreview());
    initLogToggle();
    initModal();

    el.btnGenerate.addEventListener('click', startGeneration);
    el.btnCancel.addEventListener('click', cancelCurrentJob);
  }

  function updateGenerateButtonState() {
    if (state.currentTab === 'scene') {
      if (!state.sceneAudioFile) {
        el.btnGenerate.disabled = true;
        el.btnGenerateText.textContent = '나레이션 오디오를 먼저 업로드하세요';
        return;
      }
      if (!state.scenes.length) {
        el.btnGenerate.disabled = true;
        el.btnGenerateText.textContent = '최소 1개 이상의 씬(미디어)을 추가하세요';
        return;
      }
      el.btnGenerate.disabled = false;
      el.btnGenerateText.textContent = `🎬 씬 & 자막 비디오 렌더링 시작 (총 ${state.scenes.length}개 씬)`;
    } else {
      if (!state.classicAudioFile) {
        el.btnGenerate.disabled = true;
        el.btnGenerateText.textContent = '오디오 파일을 먼저 업로드하세요';
        return;
      }
      const needImage = state.batchAll || state.selectedMode === 'waveform_overlay' || state.selectedMode === 'static';
      if (needImage && !state.classicImageFile) {
        el.btnGenerate.disabled = true;
        el.btnGenerateText.textContent = '배경 이미지를 먼저 업로드하세요';
        return;
      }
      el.btnGenerate.disabled = false;
      el.btnGenerateText.textContent = state.batchAll ? '⚡ 3종 비디오 일괄 렌더링 시작' : '비디오 렌더링 시작';
    }
  }

  async function startGeneration() {
    const fd = new FormData();

    if (state.currentTab === 'scene') {
      if (!state.sceneAudioFile || !state.scenes.length) return;

      fd.append('audio', state.sceneAudioFile);
      fd.append('tasks', 'scene_subtitles');

      const meta = state.scenes.map((s, idx) => ({
        id: idx,
        file_field: `scene_file_${idx}`,
        duration: s.duration,
        subtitle: s.subtitle,
        is_video: s.isVideo
      }));
      fd.append('scenes_meta', JSON.stringify(meta));

      state.scenes.forEach((s, idx) => {
        fd.append(`scene_file_${idx}`, s.file);
      });

      fd.append('font_size', state.subFontSize);
      fd.append('font_color', state.subFontColor);
      fd.append('bg_style', state.subBgStyle);
      fd.append('sub_position', state.subPosition);

      updateSteps('upload');
      updateProgress(5, `씬 ${state.scenes.length}개 및 자막 업로드 중...`);
    } else {
      if (!state.classicAudioFile) return;

      let tasks = state.batchAll ? ['waveform', 'waveform_overlay', 'static'] : [state.selectedMode];
      fd.append('audio', state.classicAudioFile);
      if (state.classicImageFile) fd.append('image', state.classicImageFile);
      fd.append('tasks', tasks.join(','));
      fd.append('wave_color', state.waveColor);
      fd.append('opacity', state.opacity);
      fd.append('wave_height', state.waveHeight);
      fd.append('position', state.classicPosition);

      updateSteps('upload');
      updateProgress(5, '파일 업로드 중...');
    }

    el.btnGenerate.disabled = true;
    el.monitorPanel.classList.add('active');
    el.resultsContainer.classList.remove('active');
    el.resultsList.innerHTML = '';
    el.terminalLog.textContent = '';

    try {
      const res = await fetch('/api/run', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '요청 실패');

      state.activeJobId = data.id;
      updateSteps('analyze');
      updateProgress(15, '미디어 신호 분석 및 타임라인 계산 중...');
      startPolling();
    } catch (err) {
      alert('오류: ' + err.message);
      resetMonitorUI();
    }
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(pollJobStatus, 600);
  }

  async function pollJobStatus() {
    if (!state.activeJobId) return;
    try {
      const res = await fetch(`/api/status?id=${state.activeJobId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '상태 조회 실패');

      if (data.log) {
        el.terminalLog.textContent = data.log;
        el.terminalLog.scrollTop = el.terminalLog.scrollHeight;
      }

      if (data.status === 'running') {
        updateSteps('encode');
        const pct = Math.max(20, Math.min(95, data.progress || 25));
        updateProgress(pct, `${data.current_task || 'FFmpeg 렌더링 중'} (${pct}%)`);
      } else if (data.status === 'done' || data.status === 'partial') {
        clearInterval(state.pollTimer);
        updateSteps('complete');
        updateProgress(100, data.status === 'done' ? '✨ 비디오 렌더링 완료!' : '⚠️ 일부 완료');
        renderResults(data.results || []);
        resetMonitorUI(false);
        fetchLibraryFiles();
      } else if (data.status === 'error' || data.status === 'cancelled') {
        clearInterval(state.pollTimer);
        updateProgress(0, data.status === 'cancelled' ? '작업 취소됨' : '렌더링 실패');
        alert((data.status === 'cancelled' ? '작업이 취소되었습니다.' : '오류 발생: ') + (data.error || ''));
        resetMonitorUI(true);
      }
    } catch (err) {
      console.warn('Poll error:', err);
    }
  }

  async function cancelCurrentJob() {
    if (!state.activeJobId) return;
    if (!confirm('현재 실행 중인 작업을 취소하시겠습니까?')) return;
    try {
      await fetch(`/api/cancel?id=${state.activeJobId}`, { method: 'POST' });
    } catch (e) {}
  }

  function updateProgress(percent, stageText) {
    el.progressBar.style.width = `${percent}%`;
    el.percentageText.textContent = `${percent}%`;
    el.stageBadge.innerHTML = `<span class="status-beacon"></span><span>${stageText}</span>`;
  }

  function updateSteps(currentStage) {
    const stages = ['upload', 'analyze', 'encode', 'complete'];
    const curIdx = stages.indexOf(currentStage);

    el.stepPills.forEach((pill, idx) => {
      pill.classList.remove('active', 'done');
      if (idx < curIdx) pill.classList.add('done');
      else if (idx === curIdx) pill.classList.add('active');
    });
  }

  function resetMonitorUI(fullReset = true) {
    el.btnGenerate.disabled = false;
    updateGenerateButtonState();
    if (fullReset) el.monitorPanel.classList.remove('active');
  }

  function renderResults(results) {
    el.resultsList.innerHTML = '';
    if (!results || !results.length) return;

    results.forEach(item => {
      const card = document.createElement('div');
      card.className = 'result-card';
      card.innerHTML = `
        <div class="result-info">
          <h4>${item.task}</h4>
          <p>${item.url.split('/').pop()}</p>
        </div>
        <div class="result-actions">
          <button class="btn-preview-video" data-url="${item.url}" data-title="${item.task}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            비디오 재생
          </button>
          <a href="${item.url}" download class="btn-download-video">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            다운로드
          </a>
        </div>
      `;

      card.querySelector('.btn-preview-video').addEventListener('click', () => {
        openModal(item.task, item.url);
      });

      el.resultsList.appendChild(card);
    });

    el.resultsContainer.classList.add('active');
    el.resultsContainer.scrollIntoView({ behavior: 'smooth' });
  }

  async function fetchLibraryFiles() {
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      if (!res.ok) return;

      el.libraryGrid.innerHTML = '';
      if (!data.files || !data.files.length) {
        el.libraryGrid.innerHTML = '<div class="empty-library-msg">생성된 비디오 파일이 아직 없습니다.</div>';
        return;
      }

      data.files.forEach(f => {
        const item = document.createElement('div');
        item.className = 'library-item';
        item.innerHTML = `
          <div class="library-item-left">
            <div class="lib-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18 3v2h-2V3H8v2H6V3H4v18h2v-2h2v2h8v-2h2v2h2V3h-2zM8 17H6v-2h2v2zm0-4H6v-2h2v2zm0-4H6V7h2v2zm10 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V7h2v2z"/></svg>
            </div>
            <div class="lib-meta">
              <h5 title="${f.name}">${f.name}</h5>
              <p>${f.formatted_size || formatBytes(f.size)} • ${f.created_time || ''}</p>
            </div>
          </div>
          <div class="library-item-actions">
            <button class="btn-lib-action btn-play" title="미리보기">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              재생
            </button>
            <a href="${f.url}" download class="btn-lib-action" title="다운로드">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
              다운로드
            </a>
            <button class="btn-lib-action btn-del" title="삭제">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
          </div>
        `;

        item.querySelector('.btn-play').addEventListener('click', () => openModal(f.name, f.url));
        item.querySelector('.btn-del').addEventListener('click', async () => {
          if (!confirm(`'${f.name}' 파일을 삭제하시겠습니까?`)) return;
          try {
            await fetch(`/api/files/${encodeURIComponent(f.name)}`, { method: 'DELETE' });
            fetchLibraryFiles();
          } catch (e) {
            alert('삭제 실패: ' + e.message);
          }
        });

        el.libraryGrid.appendChild(item);
      });
    } catch (e) {
      console.warn('Library load failed:', e);
    }
  }

  function initLogToggle() {
    el.btnToggleLog.addEventListener('click', () => {
      const isOpen = el.terminalDrawer.classList.toggle('open');
      el.btnToggleLog.textContent = isOpen ? '로그 닫기 ▲' : 'FFmpeg 로그 보기 ▼';
    });
  }

  function initModal() {
    el.btnCloseModal.addEventListener('click', closeModal);
    el.videoModal.addEventListener('click', (e) => {
      if (e.target === el.videoModal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  function openModal(title, url) {
    el.modalTitle.textContent = title;
    el.modalVideo.src = url;
    el.videoModal.classList.add('open');
    el.modalVideo.play().catch(() => {});
  }

  function closeModal() {
    el.modalVideo.pause();
    el.modalVideo.src = '';
    el.videoModal.classList.remove('open');
  }

  function setupDropzone(dropEl, inputEl, onFileSelected) {
    dropEl.addEventListener('click', () => inputEl.click());
    inputEl.addEventListener('change', () => {
      if (inputEl.files && inputEl.files[0]) onFileSelected(inputEl.files[0]);
    });

    ['dragenter', 'dragover'].forEach(name => {
      dropEl.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropEl.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      dropEl.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropEl.classList.remove('drag-over');
      });
    });

    dropEl.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files && files[0]) onFileSelected(files[0]);
    });
  }

  function isAudioFile(file) {
    return file.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(file.name);
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

})();

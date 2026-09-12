/**
 * remotion_editor.js
 * Remotion-like Multi-Track Timeline Video Editor (Images, Audio, Subtitles)
 */

(function () {
  'use strict';

  class RemotionEditor {
    constructor() {
      this.timeline = {
        duration: 15.0,
        visual_track: [],   // [{ id, file, url, media_path, is_video, start, duration, imgBitmap }]
        audio_track: [],    // [{ id, file, url, media_path, start, duration, volume, audioEl, peaks }]
        subtitle_track: [
          {
            id: 's_sample_1',
            start: 1.0,
            end: 6.0,
            text: 'WaveStudio Remotion 멀티트랙 스튜디오에 오신 것을 환영합니다!',
            font_size: 32,
            font_color: '#00f2fe',
            bg_style: 'box',
            position: 'bottom'
          },
          {
            id: 's_sample_2',
            start: 7.0,
            end: 13.0,
            text: '이미지, 오디오, 자막을 타임라인에 자유롭게 추가하고 편집하세요.',
            font_size: 30,
            font_color: '#ffffff',
            bg_style: 'box',
            position: 'bottom'
          }
        ],
        subtitle_style: {
          font_size: 32,
          font_color: '#ffffff',
          bg_style: 'box',
          position: 'bottom'
        }
      };

      this.currentTime = 0.0;
      this.isPlaying = false;
      this.pxPerSec = 35; // Zoom level: 35 pixels per second
      this.selectedClip = null; // { track: 'visual'|'audio'|'subtitle', item, index }
      this.activeAudioElement = null;

      this.lastFrameTime = 0;
      this.animFrameId = null;

      this.dom = {};
    }

    init() {
      this._bindDOMElements();
      this._bindEvents();
      this.renderTimeline();
      this.renderCanvas();
    }

    _bindDOMElements() {
      this.dom.canvas = document.getElementById('remotionCanvas');
      this.dom.ctx = this.dom.canvas ? this.dom.canvas.getContext('2d') : null;

      // Transport controls
      this.dom.btnPlay = document.getElementById('remBtnPlay');
      this.dom.btnStop = document.getElementById('remBtnStop');
      this.dom.timecode = document.getElementById('remTimecode');
      this.dom.zoomSlider = document.getElementById('remZoomSlider');

      // Timeline DOM
      this.dom.timelineRuler = document.getElementById('remTimelineRuler');
      this.dom.playhead = document.getElementById('remPlayhead');
      this.dom.tracksArea = document.getElementById('remTracksArea');
      this.dom.trackVisual = document.getElementById('remTrackVisual');
      this.dom.trackAudio = document.getElementById('remTrackAudio');
      this.dom.trackSubtitle = document.getElementById('remTrackSubtitle');

      // Quick Tools
      this.dom.btnAddImage = document.getElementById('remBtnAddImage');
      this.dom.inputAddImage = document.getElementById('remInputAddImage');
      this.dom.btnAddAudio = document.getElementById('remBtnAddAudio');
      this.dom.inputAddAudio = document.getElementById('remInputAddAudio');
      this.dom.btnAddSubtitle = document.getElementById('remBtnAddSubtitle');
      this.dom.btnExportSrt = document.getElementById('remBtnExportSrt');
      this.dom.btnExportTxt = document.getElementById('remBtnExportTxt');
      this.dom.btnSplit = document.getElementById('remBtnSplit');
      this.dom.btnDeleteClip = document.getElementById('remBtnDeleteClip');
      this.dom.btnExport = document.getElementById('remBtnExport');

      // Inspector
      this.dom.inspectorEmpty = document.getElementById('remInspectorEmpty');
      this.dom.inspectorContent = document.getElementById('remInspectorContent');
      this.dom.inspClipType = document.getElementById('remInspClipType');
      this.dom.inspStart = document.getElementById('remInspStart');
      this.dom.inspDuration = document.getElementById('remInspDuration');
      this.dom.inspSubSection = document.getElementById('remInspSubSection');
      this.dom.inspSubText = document.getElementById('remInspSubText');
      this.dom.inspSubSize = document.getElementById('remInspSubSize');
      this.dom.inspSubColor = document.getElementById('remInspSubColor');
      this.dom.inspSubBg = document.getElementById('remInspSubBg');
      this.dom.inspSubPos = document.getElementById('remInspSubPos');
      this.dom.inspAudioSection = document.getElementById('remInspAudioSection');
      this.dom.inspAudioVol = document.getElementById('remInspAudioVol');
      this.dom.inspAudioVolVal = document.getElementById('remInspAudioVolVal');
    }

    _bindEvents() {
      // Play / Pause
      if (this.dom.btnPlay) {
        this.dom.btnPlay.addEventListener('click', () => this.togglePlay());
      }
      if (this.dom.btnStop) {
        this.dom.btnStop.addEventListener('click', () => {
          this.pause();
          this.seekTo(0);
        });
      }

      // Spacebar to toggle play
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
          const remTab = document.getElementById('tabRemotionStudio');
          if (remTab && remTab.classList.contains('active')) {
            e.preventDefault();
            this.togglePlay();
          }
        }
      });

      // Zoom
      if (this.dom.zoomSlider) {
        this.dom.zoomSlider.addEventListener('input', (e) => {
          this.pxPerSec = parseInt(e.target.value, 10);
          this.renderTimeline();
          this._updatePlayheadPosition();
        });
      }

      // Timeline Ruler / Playhead Scrubbing
      if (this.dom.timelineRuler) {
        const scrub = (e) => {
          const rect = this.dom.timelineRuler.getBoundingClientRect();
          const scrollLeft = this.dom.tracksArea.scrollLeft;
          const x = e.clientX - rect.left + scrollLeft;
          const time = Math.max(0, Math.min(this.timeline.duration, x / this.pxPerSec));
          this.seekTo(time);
        };

        this.dom.timelineRuler.addEventListener('mousedown', (e) => {
          e.preventDefault();
          scrub(e);
          const onMove = (moveEvt) => scrub(moveEvt);
          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });
      }

      // Quick Tools
      if (this.dom.btnAddImage && this.dom.inputAddImage) {
        this.dom.btnAddImage.addEventListener('click', () => this.dom.inputAddImage.click());
        this.dom.inputAddImage.addEventListener('change', (e) => {
          if (e.target.files && e.target.files.length) {
            this.addVisualFiles(Array.from(e.target.files));
            this.dom.inputAddImage.value = '';
          }
        });
      }

      if (this.dom.btnAddAudio && this.dom.inputAddAudio) {
        this.dom.btnAddAudio.addEventListener('click', () => this.dom.inputAddAudio.click());
        this.dom.inputAddAudio.addEventListener('change', (e) => {
          if (e.target.files && e.target.files.length) {
            this.addAudioFiles(Array.from(e.target.files));
            this.dom.inputAddAudio.value = '';
          }
        });
      }

      if (this.dom.btnAddSubtitle) {
        this.dom.btnAddSubtitle.addEventListener('click', () => {
          this.addSubtitleAtPlayhead();
        });
      }

      if (this.dom.btnExportSrt) {
        this.dom.btnExportSrt.addEventListener('click', () => this.exportSrtSubtitles());
      }

      if (this.dom.btnExportTxt) {
        this.dom.btnExportTxt.addEventListener('click', () => this.exportTxtScript());
      }

      if (this.dom.btnSplit) {
        this.dom.btnSplit.addEventListener('click', () => this.splitSelectedClip());
      }

      if (this.dom.btnDeleteClip) {
        this.dom.btnDeleteClip.addEventListener('click', () => this.deleteSelectedClip());
      }

      if (this.dom.btnExport) {
        this.dom.btnExport.addEventListener('click', () => this.exportTimelineVideo());
      }

      // Inspector Property Changes
      if (this.dom.inspStart) {
        this.dom.inspStart.addEventListener('change', (e) => {
          if (!this.selectedClip) return;
          const val = Math.max(0, parseFloat(e.target.value) || 0);
          this.selectedClip.item.start = val;
          if (this.selectedClip.track === 'subtitle') {
            const dur = this.selectedClip.item.end - this.selectedClip.item.start;
            this.selectedClip.item.end = val + Math.max(0.5, dur);
          }
          this._recalculateTimelineDuration();
          this.renderTimeline();
          this.renderCanvas();
        });
      }

      if (this.dom.inspDuration) {
        this.dom.inspDuration.addEventListener('change', (e) => {
          if (!this.selectedClip) return;
          const val = Math.max(0.5, parseFloat(e.target.value) || 0.5);
          if (this.selectedClip.track === 'subtitle') {
            this.selectedClip.item.end = this.selectedClip.item.start + val;
          } else {
            this.selectedClip.item.duration = val;
          }
          this._recalculateTimelineDuration();
          this.renderTimeline();
          this.renderCanvas();
        });
      }

      if (this.dom.inspSubText) {
        this.dom.inspSubText.addEventListener('input', (e) => {
          if (this.selectedClip && this.selectedClip.track === 'subtitle') {
            this.selectedClip.item.text = e.target.value;
            this.renderTimeline();
            this.renderCanvas();
          }
        });
      }

      if (this.dom.inspSubSize) {
        this.dom.inspSubSize.addEventListener('input', (e) => {
          if (this.selectedClip && this.selectedClip.track === 'subtitle') {
            this.selectedClip.item.font_size = parseInt(e.target.value, 10);
            this.renderCanvas();
          }
        });
      }

      if (this.dom.inspSubColor) {
        this.dom.inspSubColor.addEventListener('input', (e) => {
          if (this.selectedClip && this.selectedClip.track === 'subtitle') {
            this.selectedClip.item.font_color = e.target.value;
            this.renderCanvas();
          }
        });
      }

      if (this.dom.inspSubBg) {
        this.dom.inspSubBg.addEventListener('change', (e) => {
          if (this.selectedClip && this.selectedClip.track === 'subtitle') {
            this.selectedClip.item.bg_style = e.target.value;
            this.renderCanvas();
          }
        });
      }

      if (this.dom.inspSubPos) {
        this.dom.inspSubPos.addEventListener('change', (e) => {
          if (this.selectedClip && this.selectedClip.track === 'subtitle') {
            this.selectedClip.item.position = e.target.value;
            this.renderCanvas();
          }
        });
      }

      if (this.dom.inspAudioVol) {
        this.dom.inspAudioVol.addEventListener('input', (e) => {
          if (this.selectedClip && this.selectedClip.track === 'audio') {
            this.selectedClip.item.volume = parseFloat(e.target.value);
            if (this.dom.inspAudioVolVal) {
              this.dom.inspAudioVolVal.textContent = `${Math.round(this.selectedClip.item.volume * 100)}%`;
            }
            if (this.selectedClip.item.audioEl) {
              this.selectedClip.item.audioEl.volume = Math.min(1.0, this.selectedClip.item.volume);
            }
          }
        });
      }
    }

    // ==========================================
    // Media Track Adders
    // ==========================================
    addVisualFiles(files) {
      let currentEnd = 0;
      this.timeline.visual_track.forEach(v => {
        currentEnd = Math.max(currentEnd, v.start + v.duration);
      });

      files.forEach((file) => {
        const isVideo = file.type.startsWith('video/');
        const url = URL.createObjectURL(file);
        const clip = {
          id: 'v_' + Date.now() + Math.random().toString(36).substring(2, 6),
          file: file,
          url: url,
          name: file.name,
          is_video: isVideo,
          start: currentEnd,
          duration: 4.0,
          imgBitmap: null
        };

        if (!isVideo) {
          const img = new Image();
          img.onload = () => {
            clip.imgBitmap = img;
            this.renderCanvas();
          };
          img.src = url;
        }

        this.timeline.visual_track.push(clip);
        currentEnd += clip.duration;
      });

      this._recalculateTimelineDuration();
      this.renderTimeline();
      this.renderCanvas();
    }

    addAudioFiles(files) {
      let currentEnd = 0;
      this.timeline.audio_track.forEach(a => {
        currentEnd = Math.max(currentEnd, a.start + a.duration);
      });

      files.forEach((file) => {
        const url = URL.createObjectURL(file);
        const audioEl = new Audio(url);
        const clip = {
          id: 'a_' + Date.now() + Math.random().toString(36).substring(2, 6),
          file: file,
          url: url,
          name: file.name,
          start: currentEnd,
          duration: 10.0,
          volume: 1.0,
          audioEl: audioEl
        };

        audioEl.addEventListener('loadedmetadata', () => {
          if (audioEl.duration && !isNaN(audioEl.duration)) {
            clip.duration = Math.round(audioEl.duration * 10) / 10;
            this._recalculateTimelineDuration();
            this.renderTimeline();
          }
        });

        this.timeline.audio_track.push(clip);
        currentEnd += clip.duration;
      });

      this._recalculateTimelineDuration();
      this.renderTimeline();
    }

    addSubtitleAtPlayhead() {
      const start = Math.round(this.currentTime * 10) / 10;
      const end = Math.min(this.timeline.duration, start + 3.0);
      const subItem = {
        id: 's_' + Date.now() + Math.random().toString(36).substring(2, 6),
        start: start,
        end: Math.max(start + 1.0, end),
        text: '새 자막 텍스트를 입력하세요',
        font_size: 32,
        font_color: '#00f2fe',
        bg_style: 'box',
        position: 'bottom'
      };

      this.timeline.subtitle_track.push(subItem);
      this.selectClip('subtitle', subItem);
      this.renderTimeline();
      this.renderCanvas();
    }

    splitSelectedClip() {
      if (!this.selectedClip) {
        alert('분할할 클립을 먼저 타임라인에서 선택하세요.');
        return;
      }
      const t = this.selectedClip.track;
      const item = this.selectedClip.item;

      if (this.currentTime <= item.start || this.currentTime >= (item.start + (t === 'subtitle' ? (item.end - item.start) : item.duration))) {
        alert('선택된 클립의 범위 내로 재생 헤드를 위치시키세요.');
        return;
      }

      const splitPoint = this.currentTime;
      if (t === 'visual') {
        const origDur = item.duration;
        item.duration = splitPoint - item.start;
        const newClip = Object.assign({}, item, {
          id: 'v_' + Date.now() + Math.random().toString(36).substring(2, 6),
          start: splitPoint,
          duration: origDur - item.duration
        });
        this.timeline.visual_track.push(newClip);
      } else if (t === 'subtitle') {
        const origEnd = item.end;
        item.end = splitPoint;
        const newSub = Object.assign({}, item, {
          id: 's_' + Date.now() + Math.random().toString(36).substring(2, 6),
          start: splitPoint,
          end: origEnd,
          text: item.text + ' (계속)'
        });
        this.timeline.subtitle_track.push(newSub);
      }

      this.renderTimeline();
      this.renderCanvas();
    }

    deleteSelectedClip() {
      if (!this.selectedClip) return;
      const { track, item } = this.selectedClip;
      if (track === 'visual') {
        this.timeline.visual_track = this.timeline.visual_track.filter(v => v.id !== item.id);
      } else if (track === 'audio') {
        if (item.audioEl) item.audioEl.pause();
        this.timeline.audio_track = this.timeline.audio_track.filter(a => a.id !== item.id);
      } else if (track === 'subtitle') {
        this.timeline.subtitle_track = this.timeline.subtitle_track.filter(s => s.id !== item.id);
      }

      this.selectedClip = null;
      this._updateInspector();
      this._recalculateTimelineDuration();
      this.renderTimeline();
      this.renderCanvas();
    }

    _recalculateTimelineDuration() {
      let maxT = 10.0;
      this.timeline.visual_track.forEach(v => maxT = Math.max(maxT, v.start + v.duration));
      this.timeline.audio_track.forEach(a => maxT = Math.max(maxT, a.start + a.duration));
      this.timeline.subtitle_track.forEach(s => maxT = Math.max(maxT, s.end));
      this.timeline.duration = Math.ceil(maxT);
    }

    // ==========================================
    // Playback & Scrubbing
    // ==========================================
    togglePlay() {
      if (this.isPlaying) this.pause();
      else this.play();
    }

    play() {
      if (this.currentTime >= this.timeline.duration) {
        this.currentTime = 0.0;
      }
      this.isPlaying = true;
      if (this.dom.btnPlay) {
        this.dom.btnPlay.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
      }
      this.lastFrameTime = performance.now();
      this._syncAudioPlayback();
      this._runAnimationLoop();
    }

    pause() {
      this.isPlaying = false;
      if (this.dom.btnPlay) {
        this.dom.btnPlay.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
      }
      if (this.animFrameId) {
        cancelAnimationFrame(this.animFrameId);
        this.animFrameId = null;
      }
      this.timeline.audio_track.forEach(a => {
        if (a.audioEl) a.audioEl.pause();
      });
    }

    seekTo(time) {
      this.currentTime = Math.max(0, Math.min(this.timeline.duration, time));
      this._updatePlayheadPosition();
      this._updateTimecodeDisplay();
      this._syncAudioPlayback();
      this.renderCanvas();
    }

    _runAnimationLoop() {
      if (!this.isPlaying) return;
      const now = performance.now();
      const dt = (now - this.lastFrameTime) / 1000.0;
      this.lastFrameTime = now;

      this.currentTime += dt;
      if (this.currentTime >= this.timeline.duration) {
        this.currentTime = this.timeline.duration;
        this.pause();
      }

      this._updatePlayheadPosition();
      this._updateTimecodeDisplay();
      this.renderCanvas();

      this.animFrameId = requestAnimationFrame(() => this._runAnimationLoop());
    }

    _syncAudioPlayback() {
      this.timeline.audio_track.forEach(a => {
        if (!a.audioEl) return;
        const clipStart = a.start;
        const clipEnd = a.start + a.duration;

        if (this.currentTime >= clipStart && this.currentTime < clipEnd) {
          const offset = this.currentTime - clipStart;
          if (this.isPlaying) {
            a.audioEl.currentTime = offset;
            a.audioEl.volume = Math.min(1.0, a.volume || 1.0);
            a.audioEl.play().catch(() => {});
          } else {
            a.audioEl.currentTime = offset;
            a.audioEl.pause();
          }
        } else {
          a.audioEl.pause();
        }
      });
    }

    _updatePlayheadPosition() {
      if (!this.dom.playhead) return;
      const leftPx = this.currentTime * this.pxPerSec;
      this.dom.playhead.style.left = `${leftPx}px`;
    }

    _updateTimecodeDisplay() {
      if (!this.dom.timecode) return;
      const cur = this.currentTime;
      const dur = this.timeline.duration;

      const formatTime = (t) => {
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60).toString().padStart(2, '0');
        const ms = Math.floor((t - Math.floor(t)) * 10);
        return `${m}:${s}.${ms}`;
      };

      this.dom.timecode.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
    }

    // ==========================================
    // Timeline DOM Rendering
    // ==========================================
    renderTimeline() {
      this._renderRuler();
      this._renderVisualTrack();
      this._renderAudioTrack();
      this._renderSubtitleTrack();
      this._updatePlayheadPosition();
      this._updateTimecodeDisplay();
    }

    _renderRuler() {
      if (!this.dom.timelineRuler) return;
      this.dom.timelineRuler.innerHTML = '';
      const totalSec = Math.ceil(this.timeline.duration);
      const rulerW = totalSec * this.pxPerSec + 200;
      this.dom.timelineRuler.style.width = `${rulerW}px`;

      for (let sec = 0; sec <= totalSec; sec++) {
        const mark = document.createElement('div');
        mark.className = `ruler-tick ${sec % 2 === 0 ? 'major' : 'minor'}`;
        mark.style.left = `${sec * this.pxPerSec}px`;

        if (sec % 2 === 0) {
          const m = Math.floor(sec / 60);
          const s = (sec % 60).toString().padStart(2, '0');
          mark.innerHTML = `<span class="ruler-time">${m}:${s}</span>`;
        }
        this.dom.timelineRuler.appendChild(mark);
      }
    }

    _renderVisualTrack() {
      if (!this.dom.trackVisual) return;
      this.dom.trackVisual.innerHTML = '';
      const trackW = this.timeline.duration * this.pxPerSec + 200;
      this.dom.trackVisual.style.width = `${trackW}px`;

      this.timeline.visual_track.forEach((v) => {
        const block = this._createClipBlock('visual', v, v.start, v.duration, v.name || '이미지 클립', '#3b82f6');
        this.dom.trackVisual.appendChild(block);
      });
    }

    _renderAudioTrack() {
      if (!this.dom.trackAudio) return;
      this.dom.trackAudio.innerHTML = '';
      const trackW = this.timeline.duration * this.pxPerSec + 200;
      this.dom.trackAudio.style.width = `${trackW}px`;

      this.timeline.audio_track.forEach((a) => {
        const block = this._createClipBlock('audio', a, a.start, a.duration, a.name || '오디오 클립', '#10b981');
        this.dom.trackAudio.appendChild(block);
      });
    }

    _renderSubtitleTrack() {
      if (!this.dom.trackSubtitle) return;
      this.dom.trackSubtitle.innerHTML = '';
      const trackW = this.timeline.duration * this.pxPerSec + 200;
      this.dom.trackSubtitle.style.width = `${trackW}px`;

      this.timeline.subtitle_track.forEach((s) => {
        const dur = s.end - s.start;
        const block = this._createClipBlock('subtitle', s, s.start, dur, s.text || '(빈 자막)', '#ec4899');
        this.dom.trackSubtitle.appendChild(block);
      });
    }

    _createClipBlock(trackType, item, start, duration, label, color) {
      const block = document.createElement('div');
      block.className = `timeline-clip-block track-${trackType} ${this.selectedClip && this.selectedClip.item.id === item.id ? 'selected' : ''}`;
      block.style.left = `${start * this.pxPerSec}px`;
      block.style.width = `${Math.max(14, duration * this.pxPerSec)}px`;
      block.style.setProperty('--clip-color', color);

      block.innerHTML = `
        <div class="clip-handle-left"></div>
        <div class="clip-label" title="${label}">${label}</div>
        <div class="clip-handle-right"></div>
      `;

      // Click to select
      block.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectClip(trackType, item);
      });

      // Drag to move clip
      block.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('clip-handle-left') || e.target.classList.contains('clip-handle-right')) {
          return;
        }
        e.stopPropagation();
        this.selectClip(trackType, item);

        const initialX = e.clientX;
        const origStart = item.start;

        const onMove = (moveEvt) => {
          const deltaX = moveEvt.clientX - initialX;
          const deltaSec = deltaX / this.pxPerSec;
          const newStart = Math.max(0, Math.round((origStart + deltaSec) * 10) / 10);
          item.start = newStart;
          if (trackType === 'subtitle') {
            item.end = newStart + duration;
          }
          block.style.left = `${item.start * this.pxPerSec}px`;
          this._updateInspector();
          this.renderCanvas();
        };

        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          this._recalculateTimelineDuration();
          this.renderTimeline();
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });

      // Right handle to resize duration
      const handleRight = block.querySelector('.clip-handle-right');
      if (handleRight) {
        handleRight.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this.selectClip(trackType, item);

          const initialX = e.clientX;
          const origDur = duration;

          const onMove = (moveEvt) => {
            const deltaX = moveEvt.clientX - initialX;
            const deltaSec = deltaX / this.pxPerSec;
            const newDur = Math.max(0.5, Math.round((origDur + deltaSec) * 10) / 10);
            if (trackType === 'subtitle') {
              item.end = item.start + newDur;
            } else {
              item.duration = newDur;
            }
            block.style.width = `${newDur * this.pxPerSec}px`;
            this._updateInspector();
            this.renderCanvas();
          };

          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            this._recalculateTimelineDuration();
            this.renderTimeline();
          };

          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });
      }

      return block;
    }

    // ==========================================
    // Inspector
    // ==========================================
    selectClip(track, item) {
      this.selectedClip = { track, item };
      document.querySelectorAll('.timeline-clip-block').forEach(b => b.classList.remove('selected'));
      this.renderTimeline();
      this._updateInspector();
      this.renderCanvas();
    }

    _updateInspector() {
      if (!this.selectedClip) {
        if (this.dom.inspectorEmpty) this.dom.inspectorEmpty.style.display = 'block';
        if (this.dom.inspectorContent) this.dom.inspectorContent.style.display = 'none';
        return;
      }

      if (this.dom.inspectorEmpty) this.dom.inspectorEmpty.style.display = 'none';
      if (this.dom.inspectorContent) this.dom.inspectorContent.style.display = 'block';

      const { track, item } = this.selectedClip;
      this.dom.inspClipType.textContent = track === 'visual' ? '비주얼/이미지 클립' : (track === 'audio' ? '오디오 클립' : '자막 텍스트 클립');
      this.dom.inspStart.value = item.start.toFixed(1);

      const dur = track === 'subtitle' ? (item.end - item.start) : item.duration;
      this.dom.inspDuration.value = dur.toFixed(1);

      // Toggle sections
      if (this.dom.inspSubSection) {
        this.dom.inspSubSection.style.display = track === 'subtitle' ? 'block' : 'none';
      }
      if (this.dom.inspAudioSection) {
        this.dom.inspAudioSection.style.display = track === 'audio' ? 'block' : 'none';
      }

      if (track === 'subtitle') {
        this.dom.inspSubText.value = item.text || '';
        this.dom.inspSubSize.value = item.font_size || 32;
        this.dom.inspSubColor.value = item.font_color || '#ffffff';
        this.dom.inspSubBg.value = item.bg_style || 'box';
        this.dom.inspSubPos.value = item.position || 'bottom';
      } else if (track === 'audio') {
        this.dom.inspAudioVol.value = item.volume || 1.0;
        if (this.dom.inspAudioVolVal) {
          this.dom.inspAudioVolVal.textContent = `${Math.round((item.volume || 1.0) * 100)}%`;
        }
      }
    }

    // ==========================================
    // Real-time Canvas Rendering
    // ==========================================
    renderCanvas() {
      if (!this.dom.ctx || !this.dom.canvas) return;
      const ctx = this.dom.ctx;
      const width = this.dom.canvas.width = 1920;
      const height = this.dom.canvas.height = 1080;

      // 1. Draw Active Visual Clip
      const curT = this.currentTime;
      let activeVisual = null;

      for (let i = 0; i < this.timeline.visual_track.length; i++) {
        const v = this.timeline.visual_track[i];
        if (curT >= v.start && curT < (v.start + v.duration)) {
          activeVisual = v;
          break;
        }
      }

      if (activeVisual && activeVisual.imgBitmap) {
        this._drawImageCover(ctx, activeVisual.imgBitmap, width, height);
      } else {
        // Dark Studio background
        const grad = ctx.createLinearGradient(0, 0, width, height);
        grad.addColorStop(0, '#0a0d16');
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

      // 2. Draw Active Subtitle Clip
      let activeSub = null;
      for (let i = 0; i < this.timeline.subtitle_track.length; i++) {
        const s = this.timeline.subtitle_track[i];
        if (curT >= s.start && curT <= s.end) {
          activeSub = s;
          break;
        }
      }

      if (activeSub && activeSub.text) {
        this._drawSubtitle(ctx, activeSub, width, height);
      }
    }

    _drawImageCover(ctx, img, width, height) {
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

    _drawSubtitle(ctx, sub, width, height) {
      ctx.save();
      const fontSize = (sub.font_size || 32) * 1.6;
      ctx.font = `600 ${fontSize}px 'Inter', system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const maxWidth = width * 0.82;
      const words = sub.text.split(' ');
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
      if (sub.position === 'top') {
        centerY = 100 + (totalTextHeight / 2);
      } else if (sub.position === 'center') {
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

        if (sub.bg_style !== 'shadow') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxW, boxH, 8);
            ctx.fill();
          } else {
            ctx.fillRect(boxX, boxY, boxW, boxH);
          }
        } else {
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 6;
          ctx.strokeText(line, width / 2, lineY);
        }

        ctx.fillStyle = sub.font_color || '#ffffff';
        ctx.fillText(line, width / 2, lineY);
      });

      ctx.restore();
    }

    // ==========================================
    // Export Timeline Video via Backend
    // ==========================================
    async exportTimelineVideo() {
      if (!this.timeline.visual_track.length && !this.timeline.audio_track.length) {
        alert('내보내기를 진행하려면 최소 1개 이상의 미디어 또는 오디오 클립이 필요합니다.');
        return;
      }

      const fd = new FormData();
      fd.append('tasks', 'remotion_render');

      // Timeline Data serialization
      const tlPayload = {
        duration: this.timeline.duration,
        visual_track: this.timeline.visual_track.map((v, i) => ({
          file_field: `visual_file_${i}`,
          is_video: v.is_video,
          start: v.start,
          duration: v.duration
        })),
        audio_track: this.timeline.audio_track.map((a, i) => ({
          file_field: `audio_file_${i}`,
          start: a.start,
          duration: a.duration,
          volume: a.volume || 1.0
        })),
        subtitle_track: this.timeline.subtitle_track.map(s => ({
          start: s.start,
          end: s.end,
          text: s.text,
          font_size: s.font_size || 32,
          font_color: s.font_color || '#ffffff',
          bg_style: s.bg_style || 'box',
          position: s.position || 'bottom'
        })),
        subtitle_style: this.timeline.subtitle_style
      };

      fd.append('timeline_data', JSON.stringify(tlPayload));

      // Append binary files
      this.timeline.visual_track.forEach((v, i) => {
        if (v.file) fd.append(`visual_file_${i}`, v.file);
      });
      this.timeline.audio_track.forEach((a, i) => {
        if (a.file) fd.append(`audio_file_${i}`, a.file);
      });

      // Show Monitor UI
      const monitor = document.getElementById('monitorPanel');
      if (monitor) monitor.classList.add('active');
      const progressBar = document.getElementById('progressBar');
      const stageBadge = document.getElementById('stageBadge');
      const percentageText = document.getElementById('percentageText');
      if (stageBadge) stageBadge.innerHTML = `<span class="status-beacon"></span><span>Remotion 타임라인 렌더링 시작...</span>`;
      if (progressBar) progressBar.style.width = '10%';
      if (percentageText) percentageText.textContent = '10%';

      try {
        const res = await fetch('/api/run', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '렌더링 시작 실패');

        const jid = data.id;
        const timer = setInterval(async () => {
          try {
            const sRes = await fetch(`/api/status?id=${jid}`);
            const sData = await sRes.json();
            if (progressBar && sData.progress) progressBar.style.width = `${sData.progress}%`;
            if (percentageText && sData.progress) percentageText.textContent = `${sData.progress}%`;
            if (stageBadge && sData.current_task) {
              stageBadge.innerHTML = `<span class="status-beacon"></span><span>${sData.current_task} (${sData.progress || 0}%)</span>`;
            }

            if (sData.status === 'done' || sData.status === 'error') {
              clearInterval(timer);
              if (sData.status === 'done') {
                if (stageBadge) stageBadge.innerHTML = `<span class="status-beacon"></span><span>✨ Remotion 비디오 렌더링 완료!</span>`;
                if (percentageText) percentageText.textContent = '100%';
                if (progressBar) progressBar.style.width = '100%';

                const resList = document.getElementById('resultsList');
                const resCont = document.getElementById('resultsContainer');
                if (resList && resCont) {
                  resList.innerHTML = '';
                  (sData.results || []).forEach(r => {
                    const c = document.createElement('div');
                    c.className = 'result-card';
                    c.innerHTML = `
                      <div class="result-info">
                        <h4>${r.task}</h4>
                        <p>${r.url.split('/').pop()}</p>
                      </div>
                      <div class="result-actions">
                        <a href="${r.url}" download class="btn-download-video">다운로드</a>
                      </div>
                    `;
                    resList.appendChild(c);
                  });
                  resCont.classList.add('active');
                  resCont.scrollIntoView({ behavior: 'smooth' });
                }
              } else {
                alert('렌더링 오류: ' + (sData.error || '알 수 없는 오류'));
              }
            }
          } catch (err) {
            clearInterval(timer);
          }
        }, 700);
      } catch (e) {
        alert('요청 오류: ' + e.message);
      }
    }

    exportSrtSubtitles() {
      if (!this.timeline.subtitle_track || this.timeline.subtitle_track.length === 0) {
        alert('내보낼 자막 클립이 타임라인에 없습니다.');
        return;
      }
      const sorted = [...this.timeline.subtitle_track].sort((a, b) => a.start - b.start);
      const formatT = (sec) => {
        const totalMs = Math.round(Math.max(0, sec || 0) * 1000);
        const ms = totalMs % 1000;
        const totalS = Math.floor(totalMs / 1000);
        const s = totalS % 60;
        const m = Math.floor(totalS / 60) % 60;
        const h = Math.floor(totalS / 3600);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
      };

      let srt = '';
      sorted.forEach((sub, idx) => {
        const s = sub.start || 0;
        const e = sub.end || (s + 3.0);
        srt += `${idx + 1}\n${formatT(s)} --> ${formatT(e)}\n${(sub.text || '').trim()}\n\n`;
      });

      const blob = new Blob(["\uFEFF" + srt.trim() + "\n"], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'remotion_subtitles.srt';
      a.click();
      URL.revokeObjectURL(a.href);
    }

    exportTxtScript() {
      if (!this.timeline.subtitle_track || this.timeline.subtitle_track.length === 0) {
        alert('내보낼 자막/대본 클립이 타임라인에 없습니다.');
        return;
      }
      const sorted = [...this.timeline.subtitle_track].sort((a, b) => a.start - b.start);
      let txt = '[Remotion 타임라인 나레이션 자막 전문]\n' + '='.repeat(50) + '\n\n';
      sorted.forEach((sub) => {
        const m = Math.floor((sub.start || 0) / 60);
        const s = Math.floor((sub.start || 0) % 60).toString().padStart(2, '0');
        txt += `[${m}:${s}] ${(sub.text || '').trim()}\n\n`;
      });

      const blob = new Blob(["\uFEFF" + txt.trim() + "\n"], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'remotion_narration_script.txt';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  window.RemotionEditor = RemotionEditor;

  document.addEventListener('DOMContentLoaded', () => {
    window.remotionApp = new RemotionEditor();
    window.remotionApp.init();
  });

})();

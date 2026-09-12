/**
 * audio_preview.js
 * In-browser Web Audio API waveform decoding & mini-player preview
 */

class AudioWavePreviewer {
  constructor(canvasId, playBtnId, timeLabelId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.playBtn = document.getElementById(playBtnId);
    this.timeLabel = document.getElementById(timeLabelId);
    this.audioCtx = null;
    this.audioBuffer = null;
    this.audioElement = new Audio();
    this.isPlaying = false;
    this.rawPeaks = [];

    this._bindEvents();
  }

  _bindEvents() {
    if (this.playBtn) {
      this.playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePlay();
      });
    }

    this.audioElement.addEventListener('timeupdate', () => {
      this._updateProgress();
    });

    this.audioElement.addEventListener('ended', () => {
      this.isPlaying = false;
      this._updatePlayButton();
      this.drawWaveform(0);
    });

    if (this.canvas) {
      this.canvas.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.audioBuffer) return;
        const rect = this.canvas.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        this.audioElement.currentTime = pos * this.audioElement.duration;
        this.drawWaveform(pos);
      });
    }
  }

  async loadFile(file) {
    this.reset();
    try {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContext();
      }

      const arrayBuffer = await file.arrayBuffer();
      this.audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
      this.audioElement.src = URL.createObjectURL(file);

      this._extractPeaks(this.audioBuffer);
      this.drawWaveform(0);

      const durSec = Math.round(this.audioBuffer.duration);
      const mins = Math.floor(durSec / 60);
      const secs = (durSec % 60).toString().padStart(2, '0');
      if (this.timeLabel) {
        this.timeLabel.textContent = `0:00 / ${mins}:${secs}`;
      }
      return this.audioBuffer.duration;
    } catch (err) {
      console.warn('Audio preview decode error:', err);
      return null;
    }
  }

  _extractPeaks(buffer) {
    const channelData = buffer.getChannelData(0);
    const numBars = 100;
    const step = Math.floor(channelData.length / numBars);
    this.rawPeaks = [];

    for (let i = 0; i < numBars; i++) {
      let sum = 0;
      const start = i * step;
      for (let j = 0; j < step; j++) {
        sum += Math.abs(channelData[start + j] || 0);
      }
      const avg = sum / step;
      this.rawPeaks.push(Math.min(1.0, avg * 3.5));
    }
  }

  drawWaveform(progress = 0) {
    if (!this.ctx || !this.rawPeaks.length) return;
    const w = this.canvas.width = this.canvas.offsetWidth * 2;
    const h = this.canvas.height = this.canvas.offsetHeight * 2;
    this.ctx.clearRect(0, 0, w, h);

    const barWidth = (w / this.rawPeaks.length) * 0.7;
    const barGap = (w / this.rawPeaks.length) * 0.3;

    for (let i = 0; i < this.rawPeaks.length; i++) {
      const peak = Math.max(0.1, this.rawPeaks[i]);
      const barH = peak * (h * 0.85);
      const x = i * (barWidth + barGap);
      const y = (h - barH) / 2;

      const isPlayed = (i / this.rawPeaks.length) <= progress;

      if (isPlayed) {
        this.ctx.fillStyle = '#00f2fe';
        this.ctx.shadowColor = 'rgba(0, 242, 254, 0.5)';
        this.ctx.shadowBlur = 6;
      } else {
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        this.ctx.shadowBlur = 0;
      }

      this.ctx.beginPath();
      if (this.ctx.roundRect) {
        this.ctx.roundRect(x, y, barWidth, barH, 4);
      } else {
        this.ctx.rect(x, y, barWidth, barH);
      }
      this.ctx.fill();
    }
  }

  togglePlay() {
    if (!this.audioElement.src) return;
    if (this.isPlaying) {
      this.audioElement.pause();
      this.isPlaying = false;
    } else {
      this.audioElement.play();
      this.isPlaying = true;
    }
    this._updatePlayButton();
  }

  _updatePlayButton() {
    if (!this.playBtn) return;
    if (this.isPlaying) {
      this.playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
    } else {
      this.playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    }
  }

  _updateProgress() {
    if (!this.audioElement.duration) return;
    const cur = this.audioElement.currentTime;
    const dur = this.audioElement.duration;
    const progress = cur / dur;

    const curMins = Math.floor(cur / 60);
    const curSecs = Math.floor(cur % 60).toString().padStart(2, '0');
    const totalMins = Math.floor(dur / 60);
    const totalSecs = Math.floor(dur % 60).toString().padStart(2, '0');

    if (this.timeLabel) {
      this.timeLabel.textContent = `${curMins}:${curSecs} / ${totalMins}:${totalSecs}`;
    }
    this.drawWaveform(progress);
  }

  reset() {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = '';
    }
    this.isPlaying = false;
    this.rawPeaks = [];
    this.audioBuffer = null;
    this._updatePlayButton();
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.timeLabel) {
      this.timeLabel.textContent = '0:00 / 0:00';
    }
  }
}

window.AudioWavePreviewer = AudioWavePreviewer;

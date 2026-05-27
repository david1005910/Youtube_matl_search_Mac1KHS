# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A **YouTube Content Material Discovery Tool** (유튜브 소재 발굴 도구) — a web app that finds high-viral-ratio YouTube videos, collects comments, and runs Gemini AI analysis to generate script outlines.

## Running the App

**Main app** (two modes):
```bash
# Mode 1: Local server (recommended — persists API keys via .env)
python3 server.py        # http://localhost:8765

# Mode 2: Direct browser (no server, no API key persistence)
open index.html
```

**Remotion subtitle renderer** (optional):
```bash
cd remotion && npm install && npm start    # http://localhost:8766
cd remotion && npm run studio              # Opens Remotion Studio GUI
```

## Architecture

### Core Files

| File | Purpose |
|------|---------|
| `index.html` | Main UI — Tailwind CSS (CDN), vanilla JS ES modules. Contains search, comment analysis, script generation, and 4 floating chat widgets |
| `app.js` | Utility library (~5,800 lines) — JSON parsing, API fetching, modal management, formatting helpers |
| `server.py` | Python HTTP server — `.env` CRUD, skill serving, API proxying (YouTube, Gemini, TranscriptAPI) |

### Additional Tools

| File | Purpose |
|------|---------|
| `remotion-editor.html` | Video editor UI for subtitle/image editing (connects to :8766) |
| `simple-video-generator.html` | Simplified video generation from images/subtitles |
| `check-remotion.html` | Health check utility for Remotion server |

### `index.html` — Frontend Architecture

1. **CSS block** — dark-mode styles, spinner, ratio bar, script-section cards
2. **HTML layout** — viral-ratio explainer → API key inputs → search filters → results grid
3. **JavaScript module**:
   - `loadConfig()` / `saveConfig()` — fetch from `GET/POST /api/config` with sessionStorage fallback
   - **Search pipeline**: keyword → `youtube.search.list` → batch video/channel lookups → compute `viralRatio = views/subs*100` → sort descending
   - **Comment analysis**: `youtube.commentThreads.list` (top 50) → Gemini prompt → reactions, pain points, keywords, viral-factor scores, 5 topic suggestions
   - **Script generation**: topic + word count → Gemini → structured outline with title candidates, thumbnail concept, hook, chapters, CTA
   - **Four chat widgets** (fixed-position, bottom-right, 66px spacing):
     - Purple `#scriptImgChatToggle` (right: 24px) — script→image prompt chat; triggers Imagen 4.0
     - Green `#ytChatToggle` (right: 90px) — YouTube Creator AI (claude-youtube-main, 14 sub-skills)
     - Blue `#ytApiChatToggle` (right: 156px) — TranscriptAPI chat (youtube-skills-main); uses `<ACTION>...</ACTION>` XML for API calls
     - Orange `#subtitleRenderToggle` (right: 222px) — subtitle burn-in via Remotion at :8766

### `server.py` — API Endpoints

**Config & Skills:**
| Route | Purpose |
|-------|---------|
| `GET /api/config` | Return `.env` key values |
| `POST /api/config` | Persist keys to `.env` |
| `GET /api/skills` | List claude-youtube-main sub-skills |
| `GET /api/skill/<name>` | Return SKILL.md content for a sub-skill |
| `GET /api/yt-skills` | List youtube-skills-main skills |
| `GET /api/yt-skill/<name>` | Return SKILL.md content |

**API Proxies:**
| Route | Purpose |
|-------|---------|
| `GET /api/proxy/youtube/<endpoint>` | Proxy YouTube Data API v3 calls |
| `POST /api/proxy/transcriptapi` | Proxy to transcriptapi.com |
| `POST /api/proxy/gemini` | Proxy Gemini text generation |
| `POST /api/proxy/gemini-image` | Proxy to Imagen 4.0 image generation |
| `POST /api/proxy/gemini-tts` | Gemini TTS (text-to-speech) |
| `POST /api/proxy/stability-image` | Stability AI (SD3.5) image generation |
| `POST /api/proxy/pollinations-image` | Pollinations.ai free image generation |

**Grok Video (requires `XAI_API_KEY`):**
| Route | Purpose |
|-------|---------|
| `POST /api/proxy/grok-video` | Start Grok video generation (text→video or image→video) |
| `GET /api/proxy/grok-video/<id>` | Poll Grok video generation status |
| `POST /api/proxy/grok-video-concat` | Concatenate multiple video URLs via ffmpeg |

**Video Processing (requires ffmpeg):**
| Route | Purpose |
|-------|---------|
| `POST /api/proxy/video-audio-merge` | Merge video + audio + SRT subtitles |
| `POST /api/proxy/imgbb-upload` | Upload base64 image to imgbb (requires `IMGBB_API_KEY`) |

### Skill Directories

- `claude-youtube-main/` — YouTube Creator AI (14 sub-skills: audit, seo, script, hook, thumbnail, strategy, calendar, shorts, analyze, repurpose, monetize, competitor, metadata, ideate)
- `youtube-skills-main/` — TranscriptAPI-based skills with two parallel directories: `skills/` (primary) and `clawhub/` (alias). Skills include: transcript, playlist, channel, search, subtitles, captions, youtube-api, youtube-data, youtube-full, yt

### `remotion/` — Subtitle Renderer

Express + Remotion 4.0.457 at `http://localhost:8766`.

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Health check |
| `POST /render` | Burns subtitles into video → returns MP4 |
| `POST /render-image` | Image + subtitle → MP4 slide video |

Key source files: `src/Root.tsx`, `src/SubtitleOverlay.tsx`, `src/ImageSlide.tsx`, `src/ImageSlideshow.tsx`

### Chrome Extensions

- `flow-bridge-extension/` — Bridges to Google Flow (labs.google) for automated AI video generation
- `grok-bridge-extension/` — Bridges to Grok.com for Grok AI integration

## Development Notes

- **No build system**: Frontend uses CDN-based Tailwind CSS; just edit and refresh
- **macOS SSL**: `server.py` handles SSL certificate issues; install `certifi` if needed (`pip3 install certifi`)
- **Port allocation**: Main server `:8765`, Remotion `:8766` — avoid conflicts
- **Large files**: `app.js` (~5,800 lines) and `index.html` (~1,200 lines) are monolithic; search carefully before editing
- **Health check**: Open `check-remotion.html` to verify Remotion server status
- **ffmpeg required**: Video merge/concat endpoints require ffmpeg (`brew install ffmpeg` on macOS)

## API Keys (stored in `.env`)

| Key | Used for |
|-----|----------|
| `YOUTUBE_API_KEY` | YouTube Data API v3 (search, videos, channels, comments) |
| `GEMINI_API_KEY` | Gemini AI (comment analysis, script generation, image chat) |
| `GEMINI_MODEL` | Model name, default `gemini-2.5-flash` |
| `TRANSCRIPT_API_KEY` | transcriptapi.com (TranscriptAPI chat widget) |
| `XAI_API_KEY` | Reserved for future X AI integration |
| `IMGBB_API_KEY` | imgbb image hosting (for Grok image→video workflow) |
| `STABILITY_API_KEY` | Stability AI (Stable Diffusion 3.5 image generation) |

## API Quota

YouTube Data API v3: 10,000 units/day free. One full search costs ~200–300 units (100 search + ~3/video + ~1/channel).

## Key Metrics

**Viral Ratio** = `(views ÷ subscribers) × 100`. The main sort key.

| Ratio | Interpretation |
|-------|----------------|
| ≥200% | Verified material |
| ≥500% | Strong viral |
| ≥1000% | Algorithm explosion |

import os
import re
import json
import sys
import time
import uuid
import threading
from datetime import datetime
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

from static_video import create_static_video
from waveform_video import create_waveform_video
from waveform_overlay_video import create_waveform_overlay_video
from scene_video import create_scene_video
from remotion_engine import render_timeline
from youtube_audio_overview import (
    process_youtube_urls,
    generate_korean_explainer_script_gemini,
    synthesize_explainer_audio_and_timeline,
    extract_video_id,
    fetch_youtube_metadata,
    format_duration_str,
    fetch_youtube_transcript_and_duration,
    generate_srt_content,
    generate_txt_content
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "outputs")
MAX_UPLOAD_BYTES = 512 * 1024 * 1024

TASKS = ("waveform", "waveform_overlay", "static", "scene_subtitles", "remotion_render")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(TEMPLATES_DIR, exist_ok=True)

JOBS = {}
JOBS_LOCK = threading.Lock()
RUN_LOCK = threading.Lock()

YT_JOBS = {}
YT_LOCK = threading.Lock()

MIME_MAP = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".txt": "text/plain; charset=utf-8",
    ".srt": "text/plain; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
}


def _normalize_color(color):
    color = (color or "").strip()
    if not color:
        return "0x00d2ff"
    if color.startswith("#"):
        return "0x" + color[1:].lower()
    if color.lower().startswith("0x"):
        return "0x" + color[2:].lower()
    if re.fullmatch(r"[0-9a-fA-F]{6}", color):
        return "0x" + color.lower()
    return color


def _out_path(prefix, job_id):
    path = os.path.join(OUTPUT_DIR, f"{prefix}_{job_id}.mp4")
    if os.path.exists(path):
        try:
            os.remove(path)
        except Exception:
            pass
    return path


def _append_log(job, text):
    if not text:
        return
    with JOBS_LOCK:
        job["log"] = (job["log"] + "\n" + text).strip()
        if len(job["log"]) > 25000:
            job["log"] = job["log"][-20000:]


def _format_size(size_bytes):
    if size_bytes < 1024:
        return f"{size_bytes} B"
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes / (1024 * 1024):.1f} MB"


def _run_job(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        return

    job["status"] = "running"
    cancel_event = job["cancel_event"]

    with RUN_LOCK:
        if cancel_event.is_set():
            job["status"] = "cancelled"
            return

        try:
            form = job["form"]
            tasks = [t.strip() for t in str(form.get("tasks") or "").split(",") if t.strip() in TASKS]
            if not tasks:
                raise ValueError("선택된 작업이 없습니다.")

            # 1. Remotion 타임라인 렌더링 작업
            if "remotion_render" in tasks:
                raw_tl = form.get("timeline_data")
                if not raw_tl:
                    raise ValueError("타임라인 데이터가 비어 있습니다.")
                timeline = json.loads(raw_tl) if isinstance(raw_tl, str) else raw_tl

                # 비주얼 파일들 디스크에 저장
                for idx, v in enumerate(timeline.get("visual_track", [])):
                    if v.get("file_path") and os.path.isfile(v.get("file_path")):
                        v["media_path"] = v["file_path"]
                        continue
                    field_name = v.get("file_field") or f"visual_file_{idx}"
                    file_obj = form.get(field_name)
                    if isinstance(file_obj, dict) and file_obj.get("data"):
                        ext = os.path.splitext(file_obj.get("filename") or "")[1].lower() or ".jpg"
                        saved_path = os.path.join(UPLOAD_DIR, f"{job_id}_v_{idx}{ext}")
                        with open(saved_path, "wb") as f:
                            f.write(file_obj["data"])
                        v["media_path"] = saved_path

                # 오디오 파일들 디스크에 저장
                for idx, a in enumerate(timeline.get("audio_track", [])):
                    if a.get("file_path") and os.path.isfile(a.get("file_path")):
                        a["media_path"] = a["file_path"]
                        continue
                    field_name = a.get("file_field") or f"audio_file_{idx}"
                    file_obj = form.get(field_name)
                    if isinstance(file_obj, dict) and file_obj.get("data"):
                        ext = os.path.splitext(file_obj.get("filename") or "")[1].lower() or ".mp3"
                        saved_path = os.path.join(UPLOAD_DIR, f"{job_id}_a_{idx}{ext}")
                        with open(saved_path, "wb") as f:
                            f.write(file_obj["data"])
                        a["media_path"] = saved_path

                out = _out_path("remotion", job_id)
                job["current_task"] = "Remotion 멀티트랙 비디오 렌더링 중"
                _append_log(job, "▶ [Remotion Studio] 이미지/오디오/자막 3개 트랙 컴파일 및 렌더링 시작...")

                def remotion_cb(pct, line):
                    if line:
                        _append_log(job, line)
                    if pct is not None:
                        job["progress"] = min(99, max(job["progress"], int(pct)))

                render_timeline(
                    timeline=timeline,
                    output_path=out,
                    progress_callback=remotion_cb,
                    cancel_event=cancel_event,
                    return_log=False
                )

                if cancel_event.is_set():
                    job["status"] = "cancelled"
                    return

                job["results"].append({
                    "task": "Remotion 멀티트랙 비디오 (Images·Audio·Subtitles)",
                    "url": f"/download/{os.path.basename(out)}"
                })
                job["status"] = "done"
                job["progress"] = 100
                _append_log(job, "✨ === Remotion 비디오 렌더링 완료 ===")
                return

            # 2. 오디오 필수 기반의 기존 작업들 (scene_subtitles, waveform, waveform_overlay, static)
            audio = form.get("audio")
            if not isinstance(audio, dict) or not audio.get("data"):
                raise ValueError("오디오 파일이 비어 있습니다.")

            ext = os.path.splitext(audio.get("filename") or "")[1].lower() or ".mp3"
            audio_path = os.path.join(UPLOAD_DIR, f"{job_id}{ext}")
            with open(audio_path, "wb") as f:
                f.write(audio["data"])

            # 단일 이미지 파싱
            image_path = None
            image = form.get("image")
            if isinstance(image, dict) and image.get("data"):
                iext = os.path.splitext(image.get("filename") or "")[1].lower() or ".jpg"
                image_path = os.path.join(UPLOAD_DIR, f"{job_id}_bg{iext}")
                with open(image_path, "wb") as f:
                    f.write(image["data"])

            wave_color = _normalize_color(form.get("wave_color"))
            try:
                opacity = float(form.get("opacity") or 0.7)
            except (TypeError, ValueError):
                opacity = 0.7
            try:
                wave_height = int(form.get("wave_height") or 320)
            except (TypeError, ValueError):
                wave_height = 320

            position = str(form.get("position") or "bottom").lower()
            if position not in ("top", "center", "bottom"):
                position = "bottom"

            failures = []
            total_tasks = len(tasks)

            for idx, task in enumerate(tasks):
                if cancel_event.is_set():
                    job["status"] = "cancelled"
                    _append_log(job, "✕ 사용자에 의해 작업이 취소되었습니다.")
                    return

                task_base_pct = int((idx / total_tasks) * 100)
                task_slice_pct = int(100 / total_tasks)

                def make_progress_cb(task_name):
                    def cb(pct, line):
                        if line:
                            _append_log(job, line)
                        if pct is not None:
                            calc = task_base_pct + int((pct / 100.0) * task_slice_pct)
                            job["progress"] = min(99, max(job["progress"], calc))
                    return cb

                try:
                    if task == "scene_subtitles":
                        raw_meta = form.get("scenes_meta") or "[]"
                        scenes_meta = json.loads(raw_meta) if isinstance(raw_meta, str) else raw_meta
                        if not scenes_meta:
                            raise ValueError("씬(Scene) 메타데이터가 비어 있습니다.")

                        scenes = []
                        for s_idx, sm in enumerate(scenes_meta):
                            field_name = sm.get("file_field") or f"scene_file_{s_idx}"
                            file_obj = form.get(field_name)
                            m_path = None
                            if isinstance(file_obj, dict) and file_obj.get("data"):
                                m_ext = os.path.splitext(file_obj.get("filename") or "")[1].lower() or ".jpg"
                                m_path = os.path.join(UPLOAD_DIR, f"{job_id}_scene_{s_idx}{m_ext}")
                                with open(m_path, "wb") as mf:
                                    mf.write(file_obj["data"])
                            elif image_path:
                                m_path = image_path
                            else:
                                raise ValueError(f"씬 {s_idx+1}의 미디어 파일이 제공되지 않았습니다.")

                            is_video = bool(sm.get("is_video", False)) or m_path.lower().endswith((".mp4", ".mov", ".webm"))
                            scenes.append({
                                "media_path": m_path,
                                "duration": float(sm.get("duration", 3.0)),
                                "subtitle": str(sm.get("subtitle", "")).strip(),
                                "is_video": is_video
                            })

                        font_size = int(form.get("font_size") or 30)
                        font_color = str(form.get("font_color") or "#ffffff")
                        bg_style = str(form.get("bg_style") or "box")
                        sub_pos = str(form.get("sub_position") or "bottom")

                        out = _out_path("scene", job_id)
                        job["current_task"] = "씬 & 나레이션 자막 비디오 렌더링 중"
                        _append_log(job, f"▶ [씬 스튜디오] 총 {len(scenes)}개 씬 결합 및 나레이션 자막 렌더링 시작...")
                        create_scene_video(
                            audio_path=audio_path,
                            scenes=scenes,
                            output_path=out,
                            font_size=font_size,
                            font_color=font_color,
                            bg_style=bg_style,
                            position=sub_pos,
                            progress_callback=make_progress_cb("scene_subtitles"),
                            cancel_event=cancel_event,
                            return_log=False
                        )
                        job["results"].append({
                            "task": "씬 & 나레이션 자막 비디오 (Multi-Scene Subtitles)",
                            "url": f"/download/{os.path.basename(out)}"
                        })
                    elif task == "waveform":
                        out = _out_path("waveform", job_id)
                        job["current_task"] = "파형 비디오 렌더링 중"
                        _append_log(job, "▶ [1/3] 파형 영상 (waveform) 렌더링 시작...")
                        create_waveform_video(
                            audio_path, out,
                            wave_color=wave_color,
                            progress_callback=make_progress_cb("waveform"),
                            cancel_event=cancel_event,
                            return_log=False
                        )
                        job["results"].append({
                            "task": "파형 비디오 (Waveform)",
                            "url": f"/download/{os.path.basename(out)}"
                        })
                    elif task == "waveform_overlay":
                        if not image_path:
                            raise ValueError("배경 이미지가 필요합니다.")
                        out = _out_path("overlay", job_id)
                        job["current_task"] = "웨이브 오버레이 렌더링 중"
                        _append_log(job, "▶ [2/3] 웨이브 오버레이 (waveform_overlay) 합성 시작...")
                        create_waveform_overlay_video(
                            audio_path, image_path, out,
                            wave_color=wave_color, opacity=opacity,
                            wave_height=wave_height, position=position,
                            progress_callback=make_progress_cb("waveform_overlay"),
                            cancel_event=cancel_event,
                            return_log=False
                        )
                        job["results"].append({
                            "task": "웨이브 오버레이 비디오 (Waveform Overlay)",
                            "url": f"/download/{os.path.basename(out)}"
                        })
                    elif task == "static":
                        if not image_path:
                            raise ValueError("배경 이미지가 필요합니다.")
                        out = _out_path("static", job_id)
                        job["current_task"] = "정지 이미지 비디오 렌더링 중"
                        _append_log(job, "▶ [3/3] 정지 이미지 영상 (static) 인코딩 시작...")
                        create_static_video(
                            audio_path, image_path, out,
                            progress_callback=make_progress_cb("static"),
                            cancel_event=cancel_event,
                            return_log=False
                        )
                        job["results"].append({
                            "task": "정지 이미지 비디오 (Static Video)",
                            "url": f"/download/{os.path.basename(out)}"
                        })
                except Exception as e:
                    if cancel_event.is_set():
                        job["status"] = "cancelled"
                        return
                    failures.append(f"✕ {task} 실패: {e}")
                    _append_log(job, failures[-1])

            if cancel_event.is_set():
                job["status"] = "cancelled"
            elif failures and not job["results"]:
                job["status"] = "error"
                job["error"] = " | ".join(failures)
            elif failures:
                job["status"] = "partial"
                job["error"] = "일부 작업 실패: " + " | ".join(failures)
                job["progress"] = 100
            else:
                job["status"] = "done"
                job["progress"] = 100
                _append_log(job, "✨ === 모든 비디오 렌더링 완료 ===")
        except Exception as e:
            if cancel_event.is_set():
                job["status"] = "cancelled"
            else:
                job["status"] = "error"
                job["error"] = str(e)
                _append_log(job, f"오류 발생: {e}")
        finally:
            job["finished"] = time.time()


def _run_youtube_job(job_id, urls, api_key, language, tone, voice=None, target_duration=180):
    with YT_LOCK:
        job = YT_JOBS.get(job_id)
    if not job:
        return
    job["status"] = "running"

    def progress_cb(pct, msg):
        with YT_LOCK:
            job["progress"] = pct
            job["stage"] = msg

    try:
        progress_cb(5, "YouTube 영상 목록 분석 및 소스 수집 준비 중...")
        job_dir = os.path.join(UPLOAD_DIR, f"yt_{job_id}")
        os.makedirs(job_dir, exist_ok=True)

        progress_cb(15, "YouTube 자막 및 메타데이터 수집 중...")
        sources = process_youtube_urls(urls, job_dir)
        if not sources:
            raise ValueError("입력된 YouTube URL에서 유효한 영상을 찾을 수 없습니다.")

        is_orig = False
        if str(target_duration).lower() in ("original", "auto", "0"):
            is_orig = True
            orig_dur = sources[0].get("duration") or 0
            actual_target = max(30, min(1800, orig_dur)) if orig_dur > 0 else 180
            dur_label = f"원본 영상 길이({actual_target}초)"
        else:
            try:
                actual_target = max(30, min(1800, int(target_duration or 180)))
            except (TypeError, ValueError):
                actual_target = 180
            dur_label = f"{actual_target}초"

        progress_cb(35, f"{len(sources)}개 영상 분석 완료. Gemini AI {dur_label} 맞춤형 1인칭 한국어 번역 대본 작성 중...")
        script = generate_korean_explainer_script_gemini(
            sources=sources,
            api_key=api_key,
            language=language,
            tone=tone,
            target_duration=actual_target
        )
        if not script:
            raise ValueError("한국어 해설 대본 생성에 실패했습니다.")

        progress_cb(50, f"한국어 전문 번역 나레이션 음성 합성 (Edge-TTS, 목표: {dur_label}) 진행 중...")
        out_mp3_path = os.path.join(OUTPUT_DIR, f"yt_explainer_{job_id}.mp3")

        result = synthesize_explainer_audio_and_timeline(
            script_sections=script,
            sources=sources,
            output_mp3_path=out_mp3_path,
            voice=voice or "ko-KR-InJoonNeural",
            language=language,
            target_duration=actual_target,
            progress_callback=progress_cb
        )

        # 나레이션 전문 대본(.txt) 및 SRT 자막 파일(.srt) 자동 생성
        out_txt_path = os.path.join(OUTPUT_DIR, f"yt_narration_{job_id}.txt")
        out_srt_path = os.path.join(OUTPUT_DIR, f"yt_subtitles_{job_id}.srt")

        video_title = sources[0].get("title", "YouTube 영상") if sources else "YouTube 영상"
        txt_content = generate_txt_content(result.get("script", []), title=video_title)
        srt_content = generate_srt_content(result.get("subtitles", []))

        # UTF-8 with BOM (utf-8-sig)으로 저장하여 윈도우 메모장 및 미디어 플레이어에서 한글 깨짐 방지
        with open(out_txt_path, "w", encoding="utf-8-sig") as f:
            f.write(txt_content)

        with open(out_srt_path, "w", encoding="utf-8-sig") as f:
            f.write(srt_content)

        with YT_LOCK:
            job["status"] = "done"
            job["progress"] = 100
            job["stage"] = f"✨ AI 한국어 충실 번역 나레이션 오디오 완성! (길이: {result['duration']}초)"
            job["result"] = {
                "audio_url": f"/download/{os.path.basename(out_mp3_path)}",
                "audio_file": out_mp3_path,
                "txt_url": f"/download/{os.path.basename(out_txt_path)}",
                "txt_file": out_txt_path,
                "srt_url": f"/download/{os.path.basename(out_srt_path)}",
                "srt_file": out_srt_path,
                "duration": result["duration"],
                "target_duration": result.get("target_duration", actual_target),
                "is_original_duration": is_orig,
                "original_duration": sources[0].get("duration", actual_target),
                "script": result["script"],
                "subtitles": result["subtitles"],
                "timeline_data": result["timeline_data"],
                "sources": [
                    {
                        "title": s.get("title"),
                        "author": s.get("author"),
                        "video_id": s.get("video_id"),
                        "url": s.get("url"),
                        "thumbnail_url": s.get("thumbnail_url"),
                        "thumbnail_file": s.get("thumbnail_file"),
                        "duration": s.get("duration", 0),
                        "duration_str": s.get("duration_str", "미확인")
                    } for s in sources
                ]
            }
    except Exception as e:
        with YT_LOCK:
            job["status"] = "error"
            job["error"] = str(e)
            job["stage"] = f"오류 발생: {e}"


def parse_multipart(body, content_type):
    m = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', content_type or "")
    if not m:
        raise ValueError("멀티파트 경계값(boundary)을 찾을 수 없습니다.")
    boundary = (m.group(1) or m.group(2)).strip()
    msg_headers = (
        "MIME-Version: 1.0\r\n"
        f"Content-Type: multipart/form-data; boundary={boundary}\r\n"
        "\r\n"
    ).encode("utf-8")
    msg = BytesParser(policy=policy.default).parsebytes(msg_headers + body)
    form = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if name is None:
            continue
        filename = part.get_filename()
        payload = part.get_payload(decode=True)
        if filename:
            form[name] = {"filename": filename, "data": payload}
        else:
            form[name] = payload.decode("utf-8", "replace") if payload else ""
    return form


class Handler(BaseHTTPRequestHandler):
    server_version = "WaveStudioPro/3.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("[webui] %s - %s\n" % (self.address_string(), fmt % args))

    def _send_json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, full, mime):
        try:
            size = os.path.getsize(full)
        except OSError:
            self._send_json(404, {"error": "파일을 찾을 수 없습니다."})
            return

        start, end = 0, size - 1
        rng = self.headers.get("Range")
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
            if m:
                if m.group(1):
                    start = int(m.group(1))
                if m.group(2):
                    end = int(m.group(2))
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return

        length = end - start + 1
        self.send_response(206 if rng else 200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(length))
        if rng:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.end_headers()

        with open(full, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # Main WebUI Page
        if path in ("/", "/index.html"):
            index_path = os.path.join(TEMPLATES_DIR, "index.html")
            if os.path.isfile(index_path):
                self._send_file(index_path, "text/html; charset=utf-8")
            else:
                self._send_json(404, {"error": "templates/index.html 파일을 찾을 수 없습니다."})
            return

        # Static Assets
        if path.startswith("/static/"):
            rel_path = path[len("/static/"):].lstrip("/")
            if ".." in rel_path or "\\" in rel_path:
                self._send_json(400, {"error": "잘못된 경로입니다."})
                return
            full_path = os.path.join(STATIC_DIR, rel_path)
            if os.path.isfile(full_path):
                ext = os.path.splitext(full_path)[1].lower()
                mime = MIME_MAP.get(ext, "application/octet-stream")
                self._send_file(full_path, mime)
                return
            self._send_json(404, {"error": "정적 파일을 찾을 수 없습니다."})
            return

        # API: Generated Files Library
        if path == "/api/files":
            files = []
            if os.path.isdir(OUTPUT_DIR):
                for name in sorted(os.listdir(OUTPUT_DIR), reverse=True):
                    full = os.path.join(OUTPUT_DIR, name)
                    if os.path.isfile(full) and name.lower().endswith(".mp4"):
                        st = os.stat(full)
                        files.append({
                            "name": name,
                            "size": st.st_size,
                            "formatted_size": _format_size(st.st_size),
                            "created_time": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M"),
                            "url": "/download/" + name
                        })
            self._send_json(200, {"files": files})
            return

        # API: Job Status
        if path == "/api/status":
            jid = (parse_qs(parsed.query).get("id") or [""])[0]
            with JOBS_LOCK:
                job = JOBS.get(jid)
            if not job:
                self._send_json(404, {"error": "작업을 찾을 수 없습니다."})
                return
            self._send_json(200, {
                "id": job["id"],
                "status": job["status"],
                "progress": job.get("progress", 0),
                "current_task": job.get("current_task", ""),
                "error": job["error"],
                "log": job["log"],
                "results": job["results"],
            })
            return

        # API: YouTube Audio Overview Job Status
        if path == "/api/youtube/status":
            jid = (parse_qs(parsed.query).get("id") or [""])[0]
            with YT_LOCK:
                job = YT_JOBS.get(jid)
            if not job:
                self._send_json(404, {"error": "작업을 찾을 수 없습니다."})
                return
            self._send_json(200, {
                "id": job["id"],
                "status": job["status"],
                "progress": job.get("progress", 0),
                "stage": job.get("stage", ""),
                "error": job.get("error"),
                "result": job.get("result")
            })
            return

        # API: YouTube Video Info & Duration Probe
        if path == "/api/youtube/info":
            url_param = (parse_qs(parsed.query).get("url") or [""])[0].strip()
            if not url_param:
                self._send_json(400, {"error": "URL 매개변수가 필요합니다."})
                return
            vid = extract_video_id(url_param)
            if not vid:
                self._send_json(400, {"error": "유효한 YouTube URL이 아닙니다."})
                return

            meta = fetch_youtube_metadata(vid, save_dir=UPLOAD_DIR)
            dur = meta.get("duration", 0)
            if dur <= 0:
                t, trans_dur = fetch_youtube_transcript_and_duration(vid)
                if trans_dur > 0:
                    dur = trans_dur
                    meta["duration"] = dur
                    meta["duration_str"] = format_duration_str(dur)

            self._send_json(200, {
                "success": True,
                "video_id": vid,
                "title": meta.get("title", ""),
                "author": meta.get("author", ""),
                "thumbnail_url": meta.get("thumbnail_url", ""),
                "duration": dur,
                "duration_str": meta.get("duration_str", f"{dur}초") if dur > 0 else "미확인"
            })
            return

        # Video / Audio Download / Streaming
        if path.startswith("/download/"):
            name = unquote(path[len("/download/"):])
            if not name or "/" in name or "\\" in name or ".." in name:
                self._send_json(400, {"error": "잘못된 파일 이름입니다."})
                return
            full = os.path.join(OUTPUT_DIR, name)
            if not os.path.isfile(full):
                full_up = os.path.join(UPLOAD_DIR, name)
                if os.path.isfile(full_up):
                    full = full_up
                else:
                    self._send_json(404, {"error": "파일을 찾을 수 없습니다."})
                    return
            ext = os.path.splitext(full)[1].lower()
            mime = MIME_MAP.get(ext, "application/octet-stream")
            self._send_file(full, mime)
            return

        self._send_json(404, {"error": "경로를 찾을 수 없습니다."})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # API: Generate YouTube AI Audio Overview
        if path == "/api/youtube/generate":
            try:
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length)
                data = json.loads(body.decode("utf-8"))
            except Exception as e:
                self._send_json(400, {"error": f"잘못된 JSON 요청입니다: {e}"})
                return

            urls = data.get("urls", [])
            if not isinstance(urls, list) or len(urls) == 0:
                self._send_json(400, {"error": "최소 1개 이상의 YouTube URL이 필요합니다."})
                return

            api_key = str(data.get("api_key") or "").strip() or None
            language = str(data.get("language") or "ko")
            tone = str(data.get("tone") or "faithful")
            voice = str(data.get("voice") or "ko-KR-InJoonNeural")
            raw_target = data.get("target_duration")
            if str(raw_target).lower() in ("original", "auto", "0"):
                target_duration = "original"
            else:
                try:
                    target_duration = int(raw_target or 180)
                    target_duration = max(30, min(1800, target_duration))
                except (TypeError, ValueError):
                    target_duration = 180

            job_id = uuid.uuid4().hex[:12]
            with YT_LOCK:
                YT_JOBS[job_id] = {
                    "id": job_id,
                    "status": "pending",
                    "progress": 0,
                    "stage": "대기 중...",
                    "error": None,
                    "result": None,
                    "created": time.time()
                }

            threading.Thread(
                target=_run_youtube_job,
                args=(job_id, urls, api_key, language, tone, voice, target_duration),
                daemon=True
            ).start()

            self._send_json(200, {"id": job_id})
            return

        # API: Start Rendering Job
        if path == "/api/run":
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except (TypeError, ValueError):
                length = 0

            if length <= 0 or length > MAX_UPLOAD_BYTES:
                self._send_json(400, {
                    "error": f"업로드 크기가 올바르지 않습니다. (최대 {MAX_UPLOAD_BYTES // (1024 * 1024)}MB)"
                })
                return

            body = self.rfile.read(length)
            try:
                form = parse_multipart(body, self.headers.get("Content-Type", ""))
            except ValueError as e:
                self._send_json(400, {"error": str(e)})
                return

            job_id = uuid.uuid4().hex[:12]
            job = {
                "id": job_id,
                "status": "pending",
                "progress": 0,
                "current_task": "대기 중...",
                "log": "",
                "results": [],
                "error": None,
                "created": time.time(),
                "form": form,
                "cancel_event": threading.Event()
            }
            with JOBS_LOCK:
                JOBS[job_id] = job

            threading.Thread(target=_run_job, args=(job_id,), daemon=True).start()
            self._send_json(200, {"id": job_id})
            return

        # API: Cancel Job
        if path == "/api/cancel":
            jid = (parse_qs(parsed.query).get("id") or [""])[0]
            with JOBS_LOCK:
                job = JOBS.get(jid)
            if not job:
                self._send_json(404, {"error": "작업을 찾을 수 없습니다."})
                return
            job["cancel_event"].set()
            job["status"] = "cancelled"
            self._send_json(200, {"ok": True, "message": "작업 취소 요청이 전달되었습니다."})
            return

        self._send_json(404, {"error": "경로를 찾을 수 없습니다."})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # API: Delete File
        if path.startswith("/api/files/"):
            name = unquote(path[len("/api/files/"):])
            if not name or "/" in name or "\\" in name or ".." in name:
                self._send_json(400, {"error": "잘못된 파일 이름입니다."})
                return
            full = os.path.join(OUTPUT_DIR, name)
            if not os.path.isfile(full):
                self._send_json(404, {"error": "삭제할 파일을 찾을 수 없습니다."})
                return
            try:
                os.remove(full)
                self._send_json(200, {"deleted": name})
            except Exception as e:
                self._send_json(500, {"error": f"파일 삭제 실패: {e}"})
            return

        self._send_json(404, {"error": "경로를 찾을 수 없습니다."})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"[webui] WaveStudio Pro 실행 중: http://127.0.0.1:{port} (종료: Ctrl+C)", flush=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[webui] 정상 종료됨")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
WanGP REST Sidecar
==================

A small standalone HTTP server that exposes WanGP's documented in-process
Python API (`shared/api.py`) as a clean JSON/REST contract so the
"YouTube 소재 발굴 도구" web app (server.py on the Mac) can drive remote
video generation over HTTP / Tailscale.

Run this ON THE GPU MACHINE, inside the same Python environment that runs
WanGP (so torch/CUDA and all model deps are importable):

    cd /path/to/Wan2GP-main
    python wangp_rest_server.py --host 0.0.0.0 --port 7861

Then set WANGP_API_URL in the Mac app's .env, e.g.:

    WANGP_API_URL=http://100.78.58.105:7861

The first /generate downloads/loads the model (can take minutes); later
requests reuse the warm model. Generation is serialized (single GPU) via
an internal worker queue.

Endpoints
---------
  GET  /health                 -> {ok, model_loaded, busy, queued, error}
  GET  /models                 -> {models: [{model_type, name, kind}]}
  POST /generate               -> {job_id}   (body: see _build_settings)
  GET  /job/<id>               -> {status, progress, files, error, ...}
  POST /cancel/<id>            -> {ok}
  GET  /file?name=<basename>   -> raw video/image bytes

This integration uses WanGP. Per the WanGP Terms & Conditions, any product
that integrates WanGP must clearly disclose that it uses WanGP.
"""

import argparse
import base64
import json
import os
import queue
import sys
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parent

# Curated fallback model list (filename stems under defaults/). Used when the
# live metadata scan is unavailable. Tuned for an RTX 3060 12GB.
FALLBACK_MODELS = [
    {"model_type": "t2v_1.3B",  "name": "Wan2.1 Text2video 1.3B (빠름, ~6GB)", "kind": "t2v"},
    {"model_type": "t2v",       "name": "Wan2.1 Text2video 14B (고화질, ~10GB)", "kind": "t2v"},
    {"model_type": "i2v",       "name": "Wan2.1 Image2video 480p 14B", "kind": "i2v"},
    {"model_type": "i2v_720p",  "name": "Wan2.1 Image2video 720p 14B", "kind": "i2v"},
]

# ── Global state ────────────────────────────────────────────────────────────
_session = None                 # WanGPSession (lazy-initialised)
_session_lock = threading.Lock()
_session_error = None           # str, if init() failed

_jobs = {}                      # job_id -> record dict
_jobs_lock = threading.Lock()
_files = {}                     # basename -> absolute path of produced media
_work_q = queue.Queue()         # job_ids queued for the worker
_current_job_id = None          # job_id being processed right now


def _log(*a):
    print("[wangp-rest]", *a, flush=True)


# ── WanGP session ─────────────────────────────────────────────────────────────
def get_session(cli_args=None):
    """Lazily create and cache the WanGP session. Raises on failure."""
    global _session, _session_error
    with _session_lock:
        if _session is not None:
            return _session
        if _session_error is not None:
            raise RuntimeError(_session_error)
        try:
            from shared.api import init  # imported here so import errors surface in /health
            _log("Initialising WanGP session (loading runtime)…")
            _session = init(
                root=ROOT,
                cli_args=list(cli_args or []),
                console_output=True,
            )
            _log("WanGP session ready.")
            return _session
        except Exception as e:
            _session_error = f"{type(e).__name__}: {e}"
            _log("WanGP init failed:\n" + traceback.format_exc())
            raise


def list_models():
    """Best-effort live model list; falls back to the curated set."""
    try:
        sess = get_session()
        records = sess.list_model_metadata()
        out = []
        for r in records or []:
            if not isinstance(r, dict):
                continue
            mt = r.get("model_type") or r.get("type") or r.get("id")
            if not mt:
                continue
            name = r.get("name") or r.get("label") or str(mt)
            arch = str(r.get("architecture") or r.get("arch") or "")
            main_output = str(r.get("main_output") or r.get("output") or "")
            # Keep only models that produce video.
            if main_output and "video" not in main_output.lower():
                continue
            kind = "i2v" if "i2v" in str(mt).lower() or "i2v" in arch.lower() else "t2v"
            out.append({"model_type": str(mt), "name": str(name), "kind": kind})
        if out:
            return out
    except Exception:
        _log("list_model_metadata unavailable, using fallback list:\n" + traceback.format_exc())
    return list(FALLBACK_MODELS)


# ── Settings builder ──────────────────────────────────────────────────────────
def _decode_image_to_file(data_url_or_b64, job_id):
    """Write a base64/data-URL image to a temp PNG and return its path."""
    raw = data_url_or_b64
    if "," in raw and raw.strip().lower().startswith("data:"):
        raw = raw.split(",", 1)[1]
    img_bytes = base64.b64decode(raw)
    tmp_dir = ROOT / "outputs" / "_api_inputs"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    path = tmp_dir / f"input_{job_id}.png"
    path.write_bytes(img_bytes)
    return str(path)


def _build_settings(body, job_id):
    """Turn the REST body into a WanGP settings dict.

    Starts from the model's default settings (so model-specific required
    fields are present) then applies the caller's overrides.
    """
    model_type = str(body.get("model_type") or "t2v_1.3B")

    settings = {}
    try:
        sess = get_session()
        defaults = sess.get_default_settings(model_type)
        if isinstance(defaults, dict):
            settings.update(defaults)
    except Exception:
        _log("get_default_settings failed (continuing with minimal settings):\n"
             + traceback.format_exc())

    settings["model_type"] = model_type
    settings["prompt"] = str(body.get("prompt") or "")

    if body.get("negative_prompt") is not None:
        settings["negative_prompt"] = str(body.get("negative_prompt"))
    if body.get("resolution"):
        settings["resolution"] = str(body.get("resolution"))
    if body.get("video_length") is not None:
        settings["video_length"] = int(body.get("video_length"))
    if body.get("num_inference_steps") is not None:
        settings["num_inference_steps"] = int(body.get("num_inference_steps"))
    if body.get("guidance_scale") is not None:
        settings["guidance_scale"] = float(body.get("guidance_scale"))
    if body.get("force_fps") is not None:
        settings["force_fps"] = int(body.get("force_fps"))
    # seed: -1 / missing => let WanGP randomise
    seed = body.get("seed")
    if seed is not None and str(seed) != "" and int(seed) >= 0:
        settings["seed"] = int(seed)

    # Image-to-video: decode the start frame and flag it.
    image_b64 = body.get("image_start") or body.get("image")
    if image_b64:
        settings["image_start"] = _decode_image_to_file(image_b64, job_id)
        settings["image_prompt_type"] = "S"

    return settings


# ── Worker ────────────────────────────────────────────────────────────────────
def _worker_loop():
    global _current_job_id
    while True:
        job_id = _work_q.get()
        if job_id is None:
            return
        _current_job_id = job_id
        rec = _jobs.get(job_id)
        if rec is None:
            _current_job_id = None
            continue
        try:
            _run_job(job_id, rec)
        except Exception as e:
            _log(f"job {job_id} crashed:\n" + traceback.format_exc())
            _set_job(job_id, status="error", error=f"{type(e).__name__}: {e}",
                     finished_at=time.time())
        finally:
            _current_job_id = None
            _work_q.task_done()


def _run_job(job_id, rec):
    _set_job(job_id, status="running", started_at=time.time())
    sess = get_session()
    settings = _build_settings(rec["body"], job_id)
    _log(f"job {job_id}: submit model={settings.get('model_type')} "
         f"res={settings.get('resolution')} len={settings.get('video_length')}")
    job = sess.submit_task(settings)
    rec["_job"] = job

    # Drain progress events until the stream closes (job complete).
    try:
        for event in job.events.iter(timeout=0.5):
            if rec.get("_cancel"):
                try:
                    job.cancel()
                except Exception:
                    pass
            kind = getattr(event, "kind", "")
            if kind == "progress":
                p = event.data
                _set_job(job_id, progress={
                    "phase": getattr(p, "phase", ""),
                    "progress": getattr(p, "progress", None),
                    "current_step": getattr(p, "current_step", None),
                    "total_steps": getattr(p, "total_steps", None),
                })
            elif kind == "stream":
                line = event.data
                txt = getattr(line, "text", "")
                if txt:
                    rec.setdefault("log", [])
                    rec["log"] = (rec["log"] + [txt])[-40:]
    except Exception:
        _log(f"job {job_id}: event drain error (continuing to result):\n"
             + traceback.format_exc())

    result = job.result()
    if getattr(result, "success", False) and result.generated_files:
        names = []
        for fp in result.generated_files:
            ap = os.path.abspath(str(fp))
            bn = os.path.basename(ap)
            _files[bn] = ap
            names.append(bn)
        _set_job(job_id, status="done", files=names, finished_at=time.time())
        _log(f"job {job_id}: done -> {names}")
    else:
        errs = [getattr(e, "message", str(e)) for e in getattr(result, "errors", [])]
        msg = "; ".join(errs) or "생성 실패 (출력 파일 없음)"
        cancelled = getattr(result, "cancelled", False)
        _set_job(job_id, status=("cancelled" if cancelled else "error"),
                 error=msg, finished_at=time.time())
        _log(f"job {job_id}: failed -> {msg}")


def _set_job(job_id, **fields):
    with _jobs_lock:
        rec = _jobs.get(job_id)
        if rec is None:
            return
        rec.update(fields)


def _public_job(rec):
    return {
        "job_id": rec["job_id"],
        "status": rec.get("status", "queued"),
        "progress": rec.get("progress", {}),
        "files": rec.get("files", []),
        "error": rec.get("error"),
        "model_type": rec.get("body", {}).get("model_type"),
        "log": rec.get("log", [])[-8:],
        "created_at": rec.get("created_at"),
        "finished_at": rec.get("finished_at"),
    }


# ── HTTP handler ───────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quieter logging
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, code, data, content_type):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self._cors()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/health":
            busy = _current_job_id is not None
            self._json(200, {
                "ok": _session_error is None,
                "model_loaded": _session is not None,
                "busy": busy,
                "queued": _work_q.qsize(),
                "current_job": _current_job_id,
                "error": _session_error,
            })
            return

        if path == "/models":
            self._json(200, {"models": list_models()})
            return

        if path.startswith("/job/"):
            job_id = path[len("/job/"):]
            with _jobs_lock:
                rec = _jobs.get(job_id)
                pub = _public_job(rec) if rec else None
            if pub is None:
                self._json(404, {"error": "job not found"})
            else:
                self._json(200, pub)
            return

        if path == "/file":
            qs = parse_qs(parsed.query)
            name = (qs.get("name") or [""])[0]
            ap = _files.get(os.path.basename(name))
            if not ap or not os.path.exists(ap):
                self._json(404, {"error": "file not found"})
                return
            ext = os.path.splitext(ap)[1].lower()
            ctype = {
                ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
                ".mkv": "video/x-matroska", ".gif": "image/gif",
                ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            }.get(ext, "application/octet-stream")
            with open(ap, "rb") as f:
                self._bytes(200, f.read(), ctype)
            return

        self._json(404, {"error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"

        if path == "/generate":
            try:
                body = json.loads(raw or b"{}")
            except Exception:
                self._json(400, {"error": "invalid JSON body"})
                return
            if not str(body.get("prompt") or "").strip():
                self._json(400, {"error": "prompt is required"})
                return
            if _session_error is not None:
                self._json(503, {"error": f"WanGP 세션 초기화 실패: {_session_error}"})
                return
            job_id = uuid.uuid4().hex[:12]
            rec = {
                "job_id": job_id,
                "body": body,
                "status": "queued",
                "progress": {},
                "files": [],
                "error": None,
                "created_at": time.time(),
            }
            with _jobs_lock:
                _jobs[job_id] = rec
            _work_q.put(job_id)
            self._json(200, {"job_id": job_id, "status": "queued",
                             "queued_ahead": max(0, _work_q.qsize() - 1)})
            return

        if path.startswith("/cancel/"):
            job_id = path[len("/cancel/"):]
            with _jobs_lock:
                rec = _jobs.get(job_id)
            if rec is None:
                self._json(404, {"error": "job not found"})
                return
            rec["_cancel"] = True
            job = rec.get("_job")
            if job is not None:
                try:
                    job.cancel()
                except Exception:
                    pass
            self._json(200, {"ok": True})
            return

        self._json(404, {"error": "not found"})


def main():
    ap = argparse.ArgumentParser(description="WanGP REST sidecar")
    ap.add_argument("--host", default=os.getenv("WANGP_API_HOST", "0.0.0.0"))
    ap.add_argument("--port", type=int, default=int(os.getenv("WANGP_API_PORT", "7861")))
    ap.add_argument("--eager", action="store_true",
                    help="Load the WanGP runtime at startup instead of on first request")
    # Anything after `--` is forwarded to WanGP init (e.g. -- --attention sdpa --profile 4)
    ap.add_argument("cli_args", nargs="*", help="WanGP cli_args (after --)")
    args = ap.parse_args()

    # Start the single generation worker.
    threading.Thread(target=_worker_loop, daemon=True).start()

    if args.eager:
        try:
            get_session(cli_args=args.cli_args)
        except Exception:
            _log("Eager init failed; server will still report status via /health.")

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    _log(f"Listening on http://{args.host}:{args.port}  (root={ROOT})")
    _log("Set WANGP_API_URL in the Mac app .env to reach this server.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        _log("Shutting down.")
        httpd.shutdown()


if __name__ == "__main__":
    sys.exit(main())

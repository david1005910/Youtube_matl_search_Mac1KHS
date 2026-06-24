#!/usr/bin/env python3
"""
로컬 서버 — .env 파일로 API 키를 관리합니다.
실행: python3 server.py
접속: http://localhost:8765
"""
import json, os, ssl, subprocess, tempfile, shutil, urllib.request, urllib.parse, urllib.error
from http.server import HTTPServer, ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# macOS Python SSL 인증서 문제 우회 (로컬 개발 서버용)
_ssl_ctx = ssl.create_default_context()
try:
    import certifi
    _ssl_ctx = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode = ssl.CERT_NONE

ENV_FILE   = Path(__file__).parent / '.env'
SKILLS_DIR = Path(__file__).parent / 'claude-youtube-main/skills/claude-youtube'
YT_SKILLS_DIR = Path(__file__).parent / 'youtube-skills-main/skills'

def load_env():
    keys = {
        'YOUTUBE_API_KEY': '',
        'GEMINI_API_KEY': '',
        'GEMINI_MODEL': 'gemini-2.5-flash',
        'TRANSCRIPT_API_KEY': '',
        'XAI_API_KEY': '',
        'IMGBB_API_KEY': '',
        'STABILITY_API_KEY': '',
        'COMFYUI_URL': 'http://127.0.0.1:8188',
        'WANGP_URL': 'http://127.0.0.1:7860',
        'WANGP_API_URL': 'http://127.0.0.1:7861',
        'PHOSPHENE_URL': 'http://127.0.0.1:8198',
    }
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                keys[k.strip()] = v.strip()
    return keys

def save_env(data):
    content = (
        f"YOUTUBE_API_KEY={data.get('YOUTUBE_API_KEY', '')}\n"
        f"GEMINI_API_KEY={data.get('GEMINI_API_KEY', '')}\n"
        f"GEMINI_MODEL={data.get('GEMINI_MODEL', 'gemini-2.5-flash')}\n"
        f"TRANSCRIPT_API_KEY={data.get('TRANSCRIPT_API_KEY', '')}\n"
        f"XAI_API_KEY={data.get('XAI_API_KEY', '')}\n"
        f"IMGBB_API_KEY={data.get('IMGBB_API_KEY', '')}\n"
        f"STABILITY_API_KEY={data.get('STABILITY_API_KEY', '')}\n"
        f"COMFYUI_URL={data.get('COMFYUI_URL', 'http://127.0.0.1:8188')}\n"
        f"WANGP_URL={data.get('WANGP_URL', 'http://127.0.0.1:7860')}\n"
        f"WANGP_API_URL={data.get('WANGP_API_URL', 'http://127.0.0.1:7861')}\n"
        f"PHOSPHENE_URL={data.get('PHOSPHENE_URL', 'http://127.0.0.1:8198')}\n"
    )
    ENV_FILE.write_text(content, encoding='utf-8')

def get_wangp_url():
    """WanGP 서버 URL 반환 (Tailscale 원격 연결 지원)"""
    env = load_env()
    return env.get('WANGP_URL', 'http://127.0.0.1:7860').rstrip('/')

def get_comfyui_url():
    """ComfyUI 서버 URL 반환 (Tailscale 등 원격 연결 지원)"""
    env = load_env()
    return env.get('COMFYUI_URL', 'http://127.0.0.1:8188').rstrip('/')

def get_wangp_api_url():
    """WanGP REST 사이드카 URL 반환 (wangp_rest_server.py, 기본 :7861)"""
    env = load_env()
    return env.get('WANGP_API_URL', 'http://127.0.0.1:7861').rstrip('/')

def get_phosphene_url():
    """Phosphene 패널(mlx_ltx_panel.py) URL 반환 (로컬 MLX 영상 생성, 기본 :8198)"""
    env = load_env()
    return env.get('PHOSPHENE_URL', 'http://127.0.0.1:8198').rstrip('/')

# ── claude-youtube-main 스킬 (YouTube Creator AI) ──
def get_skill_content(skill_name):
    parts = []
    main_md = SKILLS_DIR / 'SKILL.md'
    if main_md.exists():
        parts.append(main_md.read_text(encoding='utf-8'))
    sub_md = SKILLS_DIR / 'sub-skills' / f'{skill_name}.md'
    if sub_md.exists():
        parts.append(sub_md.read_text(encoding='utf-8'))
    return '\n\n---\n\n'.join(parts)

def list_skills():
    sub_dir = SKILLS_DIR / 'sub-skills'
    if not sub_dir.exists():
        return []
    return sorted(p.stem for p in sub_dir.glob('*.md'))

# ── youtube-skills-main 스킬 (TranscriptAPI) ──
def get_yt_skill_content(skill_name):
    skill_md = YT_SKILLS_DIR / skill_name / 'SKILL.md'
    if skill_md.exists():
        return skill_md.read_text(encoding='utf-8')
    return ''

def list_yt_skills():
    if not YT_SKILLS_DIR.exists():
        return []
    return sorted(
        p.name for p in YT_SKILLS_DIR.iterdir()
        if p.is_dir() and (p / 'SKILL.md').exists()
    )

def _ms_to_srt(ms):
    h = ms // 3600000; m = (ms % 3600000) // 60000
    s = (ms % 60000) // 1000; r = ms % 1000
    return f'{h:02d}:{m:02d}:{s:02d},{r:03d}'

def _send_json(handler, status, obj):
    body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', len(body))
    handler.end_headers()
    handler.wfile.write(body)

class Handler(SimpleHTTPRequestHandler):
    def guess_type(self, path):
        # 텍스트 정적 파일은 charset=utf-8 을 명시한다. (한국어 로케일에서
        # 외부 .js 가 UTF-8 이 아닌 인코딩으로 디코딩돼 깨지는 문제 방지)
        base = super().guess_type(path)
        ctype = base[0] if isinstance(base, tuple) else base
        if ctype in ('text/javascript', 'application/javascript',
                     'text/html', 'text/css') and 'charset' not in ctype:
            return f'{ctype}; charset=utf-8'
        return base

    def do_GET(self):
        if self.path == '/api/config':
            _send_json(self, 200, load_env())

        elif self.path == '/api/skills':
            _send_json(self, 200, {'skills': list_skills()})

        elif self.path.startswith('/api/skill/'):
            skill_name = self.path[len('/api/skill/'):]
            if not skill_name.replace('-', '').replace('_', '').isalnum():
                self.send_response(400); self.end_headers(); return
            content = get_skill_content(skill_name)
            if not content:
                self.send_response(404); self.end_headers(); return
            _send_json(self, 200, {'content': content})

        elif self.path == '/api/yt-skills':
            _send_json(self, 200, {'skills': list_yt_skills()})

        elif self.path.startswith('/api/yt-skill/'):
            skill_name = self.path[len('/api/yt-skill/'):]
            if not skill_name.replace('-', '').replace('_', '').isalnum():
                self.send_response(400); self.end_headers(); return
            content = get_yt_skill_content(skill_name)
            if not content:
                self.send_response(404); self.end_headers(); return
            _send_json(self, 200, {'content': content})

        elif self.path.startswith('/api/proxy/youtube'):
            # YouTube Data API v3 프록시
            qs_part = self.path[len('/api/proxy/youtube'):]  # e.g. /search?part=...
            api_key = load_env().get('YOUTUBE_API_KEY', '')
            if not api_key:
                _send_json(self, 400, {'error': 'YOUTUBE_API_KEY not set'}); return
            # qs_part starts with '/' then endpoint and query
            yt_url = f'https://www.googleapis.com/youtube/v3{qs_part}'
            # append key
            sep = '&' if '?' in yt_url else '?'
            yt_url = f'{yt_url}{sep}key={urllib.parse.quote(api_key, safe="")}'
            req = urllib.request.Request(
                yt_url,
                headers={'User-Agent': 'YouTubeContentTool/1.0'}
            )
            try:
                with urllib.request.urlopen(req, timeout=20, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})

        elif self.path.startswith('/api/proxy/grok-video/'):
            # Grok 비디오 생성 상태 폴링
            request_id = self.path[len('/api/proxy/grok-video/'):]
            if not all(c in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in request_id):
                self.send_response(400); self.end_headers(); return
            api_key = load_env().get('XAI_API_KEY', '')
            if not api_key:
                _send_json(self, 400, {'error': 'XAI_API_KEY not set'}); return
            req = urllib.request.Request(
                f'https://api.x.ai/v1/videos/{request_id}',
                headers={'Authorization': f'Bearer {api_key}', 'User-Agent': 'YouTubeContentTool/1.0'}
            )
            try:
                with urllib.request.urlopen(req, timeout=15, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})

        # ── ComfyUI 프록시 (GET) ────────────────────────────────
        elif self.path == '/api/comfyui/health':
            comfyui_base = get_comfyui_url()
            try:
                req = urllib.request.Request(f'{comfyui_base}/')
                with urllib.request.urlopen(req, timeout=5) as resp:
                    _send_json(self, 200, {'ok': True, 'status': 'ComfyUI 연결됨', 'url': comfyui_base})
            except Exception:
                _send_json(self, 200, {'ok': False, 'status': 'ComfyUI 오프라인', 'url': comfyui_base})

        # ── WanGP 프록시 (GET) ────────────────────────────────
        elif self.path == '/api/wangp/health':
            wangp_base = get_wangp_url()
            try:
                req = urllib.request.Request(f'{wangp_base}/')
                with urllib.request.urlopen(req, timeout=5) as resp:
                    _send_json(self, 200, {'ok': True, 'status': 'WanGP 연결됨', 'url': wangp_base})
            except Exception:
                _send_json(self, 200, {'ok': False, 'status': 'WanGP 오프라인', 'url': wangp_base})

        elif self.path.startswith('/api/proxy/wangp/'):
            # WanGP 프록시 (모든 GET 요청 전달)
            wangp_base = get_wangp_url()
            sub_path = self.path[len('/api/proxy/wangp'):]
            wangp_url = f'{wangp_base}{sub_path}'
            try:
                req = urllib.request.Request(wangp_url)
                with urllib.request.urlopen(req, timeout=60) as resp:
                    resp_body = resp.read()
                    content_type = resp.headers.get('Content-Type', 'application/json')
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except Exception as e:
                _send_json(self, 500, {'error': f'WanGP 요청 실패: {str(e)}'})

        elif self.path.startswith('/api/proxy/comfyui/history'):
            # ComfyUI 히스토리 조회
            qs = self.path[len('/api/proxy/comfyui/history'):]
            comfyui_url = f'{get_comfyui_url()}/history{qs}'
            try:
                req = urllib.request.Request(comfyui_url)
                with urllib.request.urlopen(req, timeout=30) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except Exception as e:
                _send_json(self, 500, {'error': f'ComfyUI history 조회 실패: {str(e)}'})

        elif self.path.startswith('/api/proxy/comfyui/view'):
            # ComfyUI 이미지/영상 조회
            qs = self.path[len('/api/proxy/comfyui/view'):]
            comfyui_url = f'{get_comfyui_url()}/view{qs}'
            try:
                req = urllib.request.Request(comfyui_url)
                with urllib.request.urlopen(req, timeout=60) as resp:
                    resp_body = resp.read()
                    content_type = resp.headers.get('Content-Type', 'application/octet-stream')
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except Exception as e:
                _send_json(self, 500, {'error': f'ComfyUI view 실패: {str(e)}'})

        # ── WanGP REST 사이드카 프록시 (영상 생성) ──────────────────
        elif self.path == '/api/wangp/api-health':
            # 사이드카(wangp_rest_server.py) 연결 상태 확인
            api_base = get_wangp_api_url()
            try:
                req = urllib.request.Request(f'{api_base}/health')
                with urllib.request.urlopen(req, timeout=5) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except Exception:
                _send_json(self, 200, {'ok': False, 'status': 'WanGP API 오프라인',
                                       'url': api_base})

        elif (self.path == '/api/wangp/models'
              or self.path.startswith('/api/wangp/job/')
              or self.path.startswith('/api/wangp/file')):
            # 모델 목록 / 작업 상태 / 결과 파일을 사이드카로 GET 전달
            api_base = get_wangp_api_url()
            sub_path = self.path[len('/api/wangp'):]
            target = f'{api_base}{sub_path}'
            try:
                req = urllib.request.Request(target)
                with urllib.request.urlopen(req, timeout=120) as resp:
                    resp_body = resp.read()
                    content_type = resp.headers.get('Content-Type', 'application/json')
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 502, {'error': f'WanGP API 요청 실패: {str(e)}'})

        # ── Phosphene (로컬 MLX 영상 생성) ──────────────────────────────
        elif self.path == '/api/phosphene/health':
            base = get_phosphene_url()
            try:
                with urllib.request.urlopen(f'{base}/status', timeout=5) as resp:
                    resp.read()
                _send_json(self, 200, {'ok': True, 'status': 'Phosphene 연결됨', 'url': base})
            except Exception:
                _send_json(self, 200, {'ok': False, 'status': 'Phosphene 오프라인', 'url': base})

        elif self.path.startswith('/api/phosphene/status'):
            base = get_phosphene_url()
            try:
                with urllib.request.urlopen(f'{base}/status', timeout=30) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except Exception as e:
                _send_json(self, 502, {'error': f'Phosphene status 실패: {str(e)}'})

        elif self.path.startswith('/api/phosphene/file'):
            # 생성된 mp4를 디스크에서 직접 읽어 스트리밍 (output_path는 이 맥의 절대경로).
            # 안전: 경로에 'mlx_outputs'가 포함된 mp4만 허용 (로컬 출력 폴더 한정).
            qs = urllib.parse.urlparse(self.path).query
            fpath = (urllib.parse.parse_qs(qs).get('path') or [''])[0]
            try:
                p = Path(fpath).resolve()
                if ('mlx_outputs' not in str(p)) or (p.suffix.lower() != '.mp4') \
                        or (not p.exists()) or (not p.is_file()):
                    _send_json(self, 404, {'error': 'file not found or not allowed'}); return
                vdata = p.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Content-Length', len(vdata))
                self.end_headers()
                self.wfile.write(vdata)
            except Exception as e:
                _send_json(self, 500, {'error': f'Phosphene file 실패: {str(e)}'})

        else:
            super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body_raw = self.rfile.read(length)

        if self.path == '/api/config':
            data = json.loads(body_raw)
            save_env(data)
            _send_json(self, 200, {'ok': True})

        elif self.path == '/api/proxy/transcriptapi':
            data = json.loads(body_raw)
            endpoint = data.get('endpoint', '')
            params   = data.get('params', {})

            allowed = [
                '/api/v2/youtube/transcript',
                '/api/v2/youtube/search',
                '/api/v2/youtube/channel/',
                '/api/v2/youtube/playlist/',
            ]
            if not any(endpoint.startswith(p) for p in allowed):
                _send_json(self, 400, {'error': 'invalid endpoint'}); return

            api_key = load_env().get('TRANSCRIPT_API_KEY', '')
            if not api_key:
                _send_json(self, 400, {'error': 'TRANSCRIPT_API_KEY not set'}); return

            qs  = urllib.parse.urlencode({k: v for k, v in params.items() if v not in ('', None)})
            url = f'https://transcriptapi.com{endpoint}?{qs}'
            req = urllib.request.Request(url, headers={
                'Authorization': f'Bearer {api_key}',
                'User-Agent': 'YouTubeContentTool/1.0',
            })
            try:
                with urllib.request.urlopen(req, timeout=20, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})

        elif self.path == '/api/proxy/gemini-image':
            data = json.loads(body_raw)
            api_key = data.get('geminiApiKey', '').strip() or load_env().get('GEMINI_API_KEY', '')
            if not api_key:
                _send_json(self, 400, {'error': 'GEMINI_API_KEY not set'}); return

            prompt = data.get('prompt', '')
            model  = data.get('model', 'imagen-4.0-fast-generate-001')
            req_body = json.dumps({
                'instances': [{'prompt': prompt}],
                'parameters': {'sampleCount': 1},
            }).encode('utf-8')
            url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:predict?key={api_key}'
            req = urllib.request.Request(
                url,
                data=req_body,
                headers={
                    'Content-Type': 'application/json',
                    'User-Agent': 'YouTubeContentTool/1.0',
                }
            )
            try:
                with urllib.request.urlopen(req, timeout=60, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})

        # ── Stable Diffusion (Stability AI) 이미지 생성 ──────────────────
        elif self.path == '/api/proxy/stability-image':
            data = json.loads(body_raw)
            api_key = load_env().get('STABILITY_API_KEY', '')
            if not api_key:
                _send_json(self, 400, {'error': 'STABILITY_API_KEY not set'}); return

            prompt = data.get('prompt', '')
            negative_prompt = data.get('negative_prompt', '')
            model = data.get('model', 'sd3.5-large')  # sd3.5-large, sd3.5-large-turbo, sd3.5-medium
            aspect_ratio = data.get('aspect_ratio', '16:9')
            output_format = data.get('output_format', 'png')

            # Stability AI API v2beta - SD3.5
            url = f'https://api.stability.ai/v2beta/stable-image/generate/sd3'

            # multipart/form-data 형식으로 전송
            boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
            body_parts = []

            def add_field(name, value):
                body_parts.append(f'--{boundary}\r\n'.encode())
                body_parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
                body_parts.append(f'{value}\r\n'.encode())

            add_field('prompt', prompt)
            add_field('model', model)
            add_field('aspect_ratio', aspect_ratio)
            add_field('output_format', output_format)
            if negative_prompt:
                add_field('negative_prompt', negative_prompt)

            body_parts.append(f'--{boundary}--\r\n'.encode())
            form_body = b''.join(body_parts)

            req = urllib.request.Request(
                url,
                data=form_body,
                headers={
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': f'multipart/form-data; boundary={boundary}',
                    'Accept': 'application/json',
                    'User-Agent': 'YouTubeContentTool/1.0',
                }
            )
            try:
                with urllib.request.urlopen(req, timeout=120, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})

        # ── Pollinations.ai 무료 이미지 생성 ──────────────────────────────
        elif self.path == '/api/proxy/pollinations-image':
            import base64 as _b64
            data = json.loads(body_raw)
            prompt = data.get('prompt', '')
            width = data.get('width', 1280)
            height = data.get('height', 720)
            model = data.get('model', 'flux')  # flux, turbo, etc.

            # URL 인코딩
            encoded_prompt = urllib.parse.quote(prompt)
            url = f'https://image.pollinations.ai/prompt/{encoded_prompt}?width={width}&height={height}&model={model}&nologo=true'

            req = urllib.request.Request(url, headers={'User-Agent': 'YouTubeContentTool/1.0'})
            try:
                with urllib.request.urlopen(req, timeout=120, context=_ssl_ctx) as resp:
                    img_data = resp.read()
                # base64로 인코딩하여 JSON으로 반환
                img_b64 = _b64.b64encode(img_data).decode('utf-8')
                _send_json(self, 200, {'image': img_b64})
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                _send_json(self, e.code, {'error': err_body.decode('utf-8', 'replace')})
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})

        elif self.path == '/api/proxy/gemini':
            # Gemini 텍스트 생성 프록시 (브라우저 직접 호출 시 네트워크 오류 우회)
            data    = json.loads(body_raw)
            api_key = load_env().get('GEMINI_API_KEY', '')
            model   = load_env().get('GEMINI_MODEL', 'gemini-2.5-flash')
            if not api_key:
                _send_json(self, 400, {'error': 'GEMINI_API_KEY not set'}); return

            url      = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}'
            req_body = json.dumps(data).encode('utf-8')
            req      = urllib.request.Request(url, data=req_body,
                           headers={'Content-Type': 'application/json',
                                    'User-Agent': 'YouTubeContentTool/1.0'})
            try:
                with urllib.request.urlopen(req, timeout=120, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})

        # ── Grok 비디오 생성 (텍스트→영상 / 이미지→영상) ──────────────────
        elif self.path == '/api/proxy/grok-video':
            data    = json.loads(body_raw)
            api_key = load_env().get('XAI_API_KEY', '')
            if not api_key:
                _send_json(self, 400, {'error': 'XAI_API_KEY not set'}); return

            payload = {
                'model': 'grok-imagine-video',
                'prompt': data.get('prompt', ''),
                'duration': data.get('duration', 10),
                'aspect_ratio': data.get('aspect_ratio', '16:9'),
                'resolution': data.get('resolution', '720p'),
            }
            # 이미지 URL이 있으면 image-to-video
            if data.get('image_url'):
                payload['image'] = {'url': data['image_url']}

            req_body = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(
                'https://api.x.ai/v1/videos/generations',
                data=req_body,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {api_key}',
                    'User-Agent': 'YouTubeContentTool/1.0',
                }
            )
            try:
                with urllib.request.urlopen(req, timeout=30, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})

        # ── imgbb 이미지 업로드 (base64 → 공개 URL) ─────────────────────
        elif self.path == '/api/proxy/imgbb-upload':
            data    = json.loads(body_raw)
            api_key = load_env().get('IMGBB_API_KEY', '')
            if not api_key:
                _send_json(self, 400, {'error': 'IMGBB_API_KEY not set'}); return

            b64 = data.get('image', '')  # pure base64 (no data: prefix)
            form = urllib.parse.urlencode({'key': api_key, 'image': b64}).encode('utf-8')
            req  = urllib.request.Request(
                'https://api.imgbb.com/1/upload',
                data=form,
                headers={'User-Agent': 'YouTubeContentTool/1.0'}
            )
            try:
                with urllib.request.urlopen(req, timeout=30, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})

        # ── Gemini TTS ───────────────────────────────────────────────
        elif self.path == '/api/proxy/gemini-tts':
            data    = json.loads(body_raw)
            api_key = load_env().get('GEMINI_API_KEY', '')
            if not api_key:
                _send_json(self, 400, {'error': 'GEMINI_API_KEY not set'}); return

            text  = data.get('text', '')
            voice = data.get('voice', 'Kore')
            model = 'gemini-2.5-flash-preview-tts'
            url   = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}'
            req_body = json.dumps({
                'contents': [{'parts': [{'text': text}], 'role': 'user'}],
                'generationConfig': {
                    'responseModalities': ['AUDIO'],
                    'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice}}}
                }
            }).encode('utf-8')
            req = urllib.request.Request(url, data=req_body,
                      headers={'Content-Type': 'application/json', 'User-Agent': 'YouTubeContentTool/1.0'})
            try:
                with urllib.request.urlopen(req, timeout=120, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})

        # ── 영상 + 음성 + 소프트 자막 병합 ──────────────────────────────
        elif self.path == '/api/proxy/video-audio-merge':
            import base64 as _b64
            data       = json.loads(body_raw)
            video_urls = data.get('video_urls', [])
            audio_b64  = data.get('audio_b64', '')
            subtitles  = data.get('subtitles', [])   # [{start_ms, end_ms, text}]

            if not video_urls: _send_json(self, 400, {'error': 'video_urls 필요'}); return
            if not audio_b64:  _send_json(self, 400, {'error': 'audio_b64 필요'}); return

            ffmpeg_path = shutil.which('ffmpeg') or '/usr/local/bin/ffmpeg'
            if not ffmpeg_path or not Path(ffmpeg_path).exists():
                _send_json(self, 500, {'error': 'ffmpeg 없음'}); return

            tmpdir = tempfile.mkdtemp(prefix='tts_merge_')
            try:
                # 비디오 다운로드
                clip_paths = []
                for i, url in enumerate(video_urls):
                    clip_path = os.path.join(tmpdir, f'clip_{i:03d}.mp4')
                    req = urllib.request.Request(url, headers={'User-Agent': 'YouTubeContentTool/1.0'})
                    with urllib.request.urlopen(req, timeout=60, context=_ssl_ctx) as resp:
                        with open(clip_path, 'wb') as f: f.write(resp.read())
                    clip_paths.append(clip_path)

                # concat (1개면 그대로)
                video_path = os.path.join(tmpdir, 'video.mp4')
                if len(clip_paths) == 1:
                    import shutil as _sh; _sh.copy(clip_paths[0], video_path)
                else:
                    list_path = os.path.join(tmpdir, 'cl.txt')
                    with open(list_path, 'w') as f:
                        for p in clip_paths: f.write(f"file '{p}'\n")
                    subprocess.run([ffmpeg_path, '-y', '-f', 'concat', '-safe', '0',
                                    '-i', list_path, '-c', 'copy', video_path],
                                   capture_output=True, timeout=120)

                # 오디오 저장 (WAV)
                audio_path = os.path.join(tmpdir, 'audio.wav')
                with open(audio_path, 'wb') as f:
                    f.write(_b64.b64decode(audio_b64))

                # SRT 자막 파일
                srt_path = os.path.join(tmpdir, 'subs.srt')
                with open(srt_path, 'w', encoding='utf-8') as f:
                    for i, sub in enumerate(subtitles):
                        f.write(f"{i+1}\n{_ms_to_srt(sub['start_ms'])} --> {_ms_to_srt(sub['end_ms'])}\n{sub['text']}\n\n")

                # 병합: video + audio + soft subtitle track
                out_path = os.path.join(tmpdir, 'output.mp4')
                cmd = [ffmpeg_path, '-y',
                       '-i', video_path, '-i', audio_path, '-i', srt_path,
                       '-c:v', 'copy', '-c:a', 'aac',
                       '-c:s', 'mov_text',
                       '-map', '0:v:0', '-map', '1:a:0', '-map', '2:s:0',
                       '-metadata:s:s:0', 'language=kor',
                       '-shortest', out_path]
                r = subprocess.run(cmd, capture_output=True, timeout=300)
                if r.returncode != 0:
                    # 자막 없이 재시도
                    cmd2 = [ffmpeg_path, '-y', '-i', video_path, '-i', audio_path,
                            '-c:v', 'copy', '-c:a', 'aac',
                            '-map', '0:v:0', '-map', '1:a:0', '-shortest', out_path]
                    r2 = subprocess.run(cmd2, capture_output=True, timeout=300)
                    if r2.returncode != 0:
                        _send_json(self, 500, {'error': r2.stderr.decode('utf-8','replace')[-400:]}); return

                with open(out_path, 'rb') as f: mp4_data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Content-Length', len(mp4_data))
                self.send_header('Content-Disposition', 'attachment; filename="narration_merged.mp4"')
                self.end_headers()
                self.wfile.write(mp4_data)

            except Exception as e:
                _send_json(self, 500, {'error': str(e)})
            finally:
                shutil.rmtree(tmpdir, ignore_errors=True)

        # ── Grok 영상 URL 목록 → ffmpeg concat → MP4 반환 ──────────────
        elif self.path == '/api/proxy/grok-video-concat':
            data = json.loads(body_raw)
            video_urls = data.get('video_urls', [])
            if not video_urls or len(video_urls) < 1:
                _send_json(self, 400, {'error': 'video_urls 필요'}); return

            # ffmpeg 경로 탐색
            ffmpeg_path = shutil.which('ffmpeg') or '/usr/local/bin/ffmpeg' or '/opt/homebrew/bin/ffmpeg'
            if not ffmpeg_path or not Path(ffmpeg_path).exists():
                _send_json(self, 500, {'error': 'ffmpeg를 찾을 수 없습니다. brew install ffmpeg 실행 필요'}); return

            tmpdir = tempfile.mkdtemp(prefix='grok_concat_')
            try:
                # 각 영상 URL 다운로드
                clip_paths = []
                for i, url in enumerate(video_urls):
                    clip_path = os.path.join(tmpdir, f'clip_{i:03d}.mp4')
                    req = urllib.request.Request(url, headers={'User-Agent': 'YouTubeContentTool/1.0'})
                    with urllib.request.urlopen(req, timeout=60, context=_ssl_ctx) as resp:
                        with open(clip_path, 'wb') as f:
                            f.write(resp.read())
                    clip_paths.append(clip_path)

                # ffmpeg concat list 파일 생성
                list_path = os.path.join(tmpdir, 'concat_list.txt')
                with open(list_path, 'w') as f:
                    for p in clip_paths:
                        f.write(f"file '{p}'\n")

                out_path = os.path.join(tmpdir, 'output.mp4')
                result = subprocess.run(
                    [ffmpeg_path, '-y', '-f', 'concat', '-safe', '0',
                     '-i', list_path, '-c', 'copy', out_path],
                    capture_output=True, timeout=300
                )
                if result.returncode != 0:
                    err = result.stderr.decode('utf-8', errors='replace')[-500:]
                    _send_json(self, 500, {'error': f'ffmpeg 오류: {err}'}); return

                with open(out_path, 'rb') as f:
                    mp4_data = f.read()

                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Content-Length', len(mp4_data))
                self.send_header('Content-Disposition', 'attachment; filename="grok_concat.mp4"')
                self.end_headers()
                self.wfile.write(mp4_data)

            except Exception as e:
                _send_json(self, 500, {'error': str(e)})
            finally:
                shutil.rmtree(tmpdir, ignore_errors=True)

        # ── Phosphene 로컬 mp4 경로 목록 → ffmpeg concat → MP4 반환 ──────
        elif self.path == '/api/phosphene/concat':
            data = json.loads(body_raw)
            paths = data.get('paths', [])
            if not paths:
                _send_json(self, 400, {'error': 'paths 필요'}); return

            ffmpeg_path = shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'
            if not ffmpeg_path or not Path(ffmpeg_path).exists():
                _send_json(self, 500, {'error': 'ffmpeg를 찾을 수 없습니다. brew install ffmpeg 실행 필요'}); return

            # 안전: mlx_outputs 하위의 실제 mp4만 허용
            safe_paths = []
            for raw in paths:
                p = Path(raw).resolve()
                if ('mlx_outputs' in str(p)) and (p.suffix.lower() == '.mp4') and p.exists() and p.is_file():
                    safe_paths.append(str(p))
            if not safe_paths:
                _send_json(self, 400, {'error': '유효한 mp4 경로가 없습니다'}); return

            tmpdir = tempfile.mkdtemp(prefix='phosphene_concat_')
            try:
                list_path = os.path.join(tmpdir, 'concat_list.txt')
                with open(list_path, 'w') as f:
                    for p in safe_paths:
                        f.write("file '%s'\n" % p.replace("'", "'\\''"))

                out_path = os.path.join(tmpdir, 'output.mp4')
                # 동일 옵션 클립은 -c copy 로 즉시 결합. 코덱/해상도가 달라 실패하면
                # libx264 재인코딩으로 재시도한다.
                result = subprocess.run(
                    [ffmpeg_path, '-y', '-f', 'concat', '-safe', '0',
                     '-i', list_path, '-c', 'copy', out_path],
                    capture_output=True, timeout=600
                )
                if result.returncode != 0:
                    result = subprocess.run(
                        [ffmpeg_path, '-y', '-f', 'concat', '-safe', '0',
                         '-i', list_path, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                         '-crf', '20', '-preset', 'veryfast', '-an', out_path],
                        capture_output=True, timeout=600
                    )
                if result.returncode != 0:
                    err = result.stderr.decode('utf-8', errors='replace')[-500:]
                    _send_json(self, 500, {'error': f'ffmpeg 오류: {err}'}); return

                with open(out_path, 'rb') as f:
                    mp4_data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Content-Length', len(mp4_data))
                self.send_header('Content-Disposition', 'attachment; filename="phosphene_concat.mp4"')
                self.end_headers()
                self.wfile.write(mp4_data)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})
            finally:
                shutil.rmtree(tmpdir, ignore_errors=True)

        # ── WanGP 프록시 (POST) ────────────────────────────────
        elif self.path.startswith('/api/proxy/wangp/'):
            wangp_base = get_wangp_url()
            sub_path = self.path[len('/api/proxy/wangp'):]
            wangp_url = f'{wangp_base}{sub_path}'
            content_type = self.headers.get('Content-Type', 'application/json')
            req = urllib.request.Request(
                wangp_url,
                data=body_raw,
                headers={'Content-Type': content_type},
                method='POST'
            )
            try:
                with urllib.request.urlopen(req, timeout=300) as resp:
                    resp_body = resp.read()
                    resp_content_type = resp.headers.get('Content-Type', 'application/json')
                self.send_response(200)
                self.send_header('Content-Type', resp_content_type)
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': f'WanGP 요청 실패: {str(e)}'})

        # ── WanGP REST 사이드카 프록시 (영상 생성 시작 / 취소) ──────
        elif self.path == '/api/wangp/generate' or self.path.startswith('/api/wangp/cancel/'):
            api_base = get_wangp_api_url()
            sub_path = self.path[len('/api/wangp'):]
            target = f'{api_base}{sub_path}'
            req = urllib.request.Request(
                target,
                data=body_raw,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 502, {'error': f'WanGP API 연결 실패 (사이드카 미실행?): {str(e)}'})

        # ── Phosphene 업로드 (base64 이미지 → 패널 /upload, multipart) ──
        elif self.path == '/api/phosphene/upload':
            import base64 as _b64
            data = json.loads(body_raw)
            b64 = data.get('image', '')
            if b64.strip().startswith('data:') and ',' in b64:
                b64 = b64.split(',', 1)[1]
            try:
                img_bytes = _b64.b64decode(b64)
            except Exception:
                _send_json(self, 400, {'error': 'invalid base64 image'}); return
            fname = data.get('filename', 'phosphene_input.png')
            boundary = '----PhospheneBoundary7MA4YWxkTrZu0gW'
            parts = [
                f'--{boundary}\r\n'.encode(),
                f'Content-Disposition: form-data; name="image"; filename="{fname}"\r\n'.encode(),
                b'Content-Type: image/png\r\n\r\n',
                img_bytes,
                f'\r\n--{boundary}--\r\n'.encode(),
            ]
            req = urllib.request.Request(
                f'{get_phosphene_url()}/upload',
                data=b''.join(parts),
                headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
                method='POST'
            )
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 502, {'error': f'Phosphene upload 실패 (패널 미실행?): {str(e)}'})

        # ── Phosphene 영상 생성 (JSON → 패널 /queue/add, form-encoded) ──
        elif self.path == '/api/phosphene/generate':
            data = json.loads(body_raw)
            form = {
                'mode':            data.get('mode', 'i2v'),
                'prompt':          data.get('prompt', ''),
                'negative_prompt': data.get('negative_prompt', ''),
                'width':           str(data.get('width', 1024)),
                'height':          str(data.get('height', 576)),
                'frames':          str(data.get('frames', 121)),   # 121=5s, 169=7s (frames%8==1)
                'frame_rate':      str(data.get('frame_rate', 24)),
                'seed':            str(data.get('seed', -1)),
                'quality':         data.get('quality', 'balanced'),
                'temporal_mode':   'native',
                'stage1_steps':    str(data.get('stage1_steps', 10)),
                'stage2_steps':    str(data.get('stage2_steps', 3)),
                'teacache_thresh': str(data.get('teacache_thresh', 1.8)),
                'cfg_scale':       str(data.get('cfg_scale', 3.0)),
                'bongmath_max_iter': str(data.get('bongmath_max_iter', 100)),
                'accel':           data.get('accel', 'off'),
                'upscale':         data.get('upscale', 'off'),
                'enhance':         'true' if data.get('enhance') else 'false',
            }
            if data.get('image'):
                form['image'] = data['image']   # i2v: 패널 서버상의 절대 경로 (/upload 반환값)
            if data.get('label'):
                form['label'] = data['label']
            body = urllib.parse.urlencode(form).encode('utf-8')
            req = urllib.request.Request(
                f'{get_phosphene_url()}/queue/add',
                data=body,
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                method='POST'
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 502, {'error': f'Phosphene generate 실패 (패널 미실행?): {str(e)}'})

        # ── ComfyUI 프록시 (영상 생성) ────────────────────────────
        elif self.path == '/api/proxy/comfyui/prompt':
            data = json.loads(body_raw)
            comfyui_url = f'{get_comfyui_url()}/prompt'
            req_body = json.dumps(data).encode('utf-8')
            req = urllib.request.Request(
                comfyui_url,
                data=req_body,
                headers={'Content-Type': 'application/json'}
            )
            try:
                with urllib.request.urlopen(req, timeout=30, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': f'ComfyUI 연결 실패: {str(e)}'})

        elif self.path == '/api/proxy/comfyui/upload/image':
            # ComfyUI 이미지 업로드 프록시
            comfyui_url = f'{get_comfyui_url()}/upload/image'
            req = urllib.request.Request(
                comfyui_url,
                data=body_raw,
                headers={
                    'Content-Type': self.headers.get('Content-Type', 'application/octet-stream')
                }
            )
            try:
                with urllib.request.urlopen(req, timeout=60, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except Exception as e:
                _send_json(self, 500, {'error': f'ComfyUI 이미지 업로드 실패: {str(e)}'})

        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *args):
        pass  # 로그 출력 끄기

if __name__ == '__main__':
    port = 8765
    os.chdir(Path(__file__).parent)
    # ThreadingHTTPServer: 요청을 스레드별로 처리해, 느린 외부 호출(WanGP 오프라인
    # 헬스체크 등)이 다른 요청(정적 파일·API)을 막지 않도록 한다.
    server = ThreadingHTTPServer(('localhost', port), Handler)
    print(f'✅ 서버 실행 중 → http://localhost:{port}')
    print('   종료: Ctrl+C')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n서버 종료')

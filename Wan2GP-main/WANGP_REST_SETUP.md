# WanGP REST 사이드카 설정 가이드

`wangp_rest_server.py` 는 WanGP(Wan2.x) 영상 생성을 **유튜브 소재 발굴 도구** 웹앱에서
바로 사용할 수 있도록 깔끔한 HTTP/REST API 로 감싼 작은 보조 서버입니다.

WanGP 의 Gradio 화면에는 안정적인 REST API 가 없기 때문에, 이 사이드카가 WanGP 공식
in-process Python API(`shared/api.py`)를 호출해서 영상 생성을 대신 처리합니다.

```
[Mac 웹앱 :8765]  ──(HTTP, Tailscale)──▶  [GPU PC: wangp_rest_server.py :7861]  ──▶  WanGP(shared/api.py) ──▶  GPU
```

---

## 1. GPU PC(데스크톱)에서 사이드카 실행

WanGP 가 설치된 그 Python 환경(= torch/CUDA 와 모델 의존성이 import 되는 환경)에서 실행해야 합니다.
Pinokio 로 WanGP 를 쓰는 경우 Pinokio 의 터미널/콘다 환경에서 실행하세요.

```bash
cd <WanGP 설치 폴더>/Wan2GP-main
python wangp_rest_server.py --host 0.0.0.0 --port 7861
```

- `--host 0.0.0.0` : Tailscale/LAN 의 다른 기기(맥)에서 접속하려면 반드시 필요합니다.
- `--port 7861`    : 기본 포트. WanGP 웹UI(7860)와 겹치지 않습니다.
- `--eager`        : (선택) 시작할 때 미리 런타임을 로딩합니다. 생략하면 첫 생성 요청 때 로딩됩니다.
- `-- <WanGP 인자>` : (선택) `--` 뒤의 값은 WanGP `init()` 에 전달됩니다.
  예) `python wangp_rest_server.py --port 7861 -- --attention sdpa --profile 4`

> WanGP 웹UI 와 **동시에** 실행해도 됩니다(둘은 별개 포트). 사이드카는 WanGP 의
> in-process API 를 직접 호출하므로 웹UI 를 켤 필요는 없습니다.

정상 실행되면 다음 로그가 보입니다:
```
[wangp-rest] Listening on http://0.0.0.0:7861  (root=...)
```

빠른 확인:
```bash
curl http://localhost:7861/health
# {"ok": true, "model_loaded": false, "busy": false, ...}
```

---

## 2. Mac 웹앱 `.env` 설정

맥의 프로젝트 `.env` 에 사이드카 주소를 넣습니다(Tailscale IP 사용).

```
WANGP_API_URL=http://100.78.58.105:7861
```

`server.py` 를 재시작한 뒤 웹앱(http://localhost:8765)을 새로고침하고, 우측 상단의
**🎬 (보라색) WanGP 영상 생성** 버튼을 누르면 됩니다. 배지가 `● 연결됨` 이면 준비 완료입니다.

---

## 3. 사용법 (웹앱 위젯)

1. **텍스트→영상** 또는 **이미지→영상** 탭 선택
2. 모델 선택 (RTX 3060 12GB 기준 권장: `Wan2.1 Text2video 1.3B` 가 가장 빠름)
3. 프롬프트(영문 권장), 해상도/길이/스텝 선택
4. (이미지→영상) 시작 이미지를 업로드하거나 페이지의 생성된 카드 이미지를 클릭
5. **🎬 영상 생성 시작** → 큐 카드에서 진행률이 표시되고, 완료되면 영상이 바로 재생/다운로드됩니다

> 첫 생성은 모델 다운로드/로딩 때문에 수 분이 걸릴 수 있습니다. 이후 요청은 모델이
> 메모리에 남아 빨라집니다. 한 번에 하나씩 순차 처리됩니다(단일 GPU).

---

## REST 계약 (디버깅용)

| Method | Path | 설명 |
|--------|------|------|
| `GET`  | `/health` | 상태(`ok`, `model_loaded`, `busy`, `queued`, `error`) |
| `GET`  | `/models` | 영상 모델 목록 (`shared/api.py` 메타데이터, 실패 시 기본 목록) |
| `POST` | `/generate` | 생성 시작. body: `{model_type, prompt, negative_prompt, resolution, video_length, num_inference_steps, seed, image_start(base64)}` → `{job_id}` |
| `GET`  | `/job/<id>` | 상태/진행률/결과 파일명 |
| `POST` | `/cancel/<id>` | 실행 중 작업 취소 |
| `GET`  | `/file?name=<basename>` | 생성된 영상/이미지 바이트 반환 |

맥 웹앱에서는 `server.py` 가 위 경로를 `/api/wangp/*` 로 프록시합니다.

---

## 문제 해결

- **위젯 배지가 `● 오프라인`**: GPU PC 에서 사이드카가 실행 중인지, `.env` 의 `WANGP_API_URL`
  이 올바른 Tailscale IP:7861 인지, 방화벽이 7861 을 막지 않는지 확인하세요.
- **`/health` 의 `error` 에 import 오류**: WanGP 환경이 아닌 곳에서 실행했을 가능성이 높습니다
  (torch/numpy 미설치). WanGP 가 정상 동작하는 그 Python 환경에서 실행하세요.
- **생성이 계속 `error`**: GPU PC 콘솔의 `[wangp-rest]` 로그와 `/job/<id>` 의 `error` 메시지를 확인하세요.

> 본 통합은 WanGP 를 사용합니다. WanGP 이용약관에 따라 WanGP 를 통합한 제품은 UI 와 문서에
> WanGP 사용 사실을 명시해야 합니다.

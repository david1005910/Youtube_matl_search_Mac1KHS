#!/bin/bash
# ComfyUI 실행 스크립트 (Apple Silicon MPS 가속)
COMFY_DIR="/Users/david/ComfyUI"

if [ ! -d "$COMFY_DIR" ]; then
    echo "❌ ComfyUI 디렉토리를 찾을 수 없습니다: $COMFY_DIR"
    exit 1
fi

cd "$COMFY_DIR"
echo "🚀 ComfyUI 시작 중... (http://127.0.0.1:8188)"
"$COMFY_DIR/venv/bin/python" main.py --listen 0.0.0.0 --port 8188 --enable-cors-header "$@"

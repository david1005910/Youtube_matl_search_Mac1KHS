#!/bin/bash
# YouTube Search & Video Generator 통합 실행 스크립트

echo "=========================================="
echo "🚀 YouTube Search & AI Studio 시작 중..."
echo "=========================================="

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# 1. Local Stable Diffusion Server 시작 (포트 7865)
if pgrep -f "local_sd_server.py" > /dev/null; then
    echo "✅ Local Stable Diffusion 서버가 이미 실행 중입니다. (포트 7865)"
else
    echo "🎨 Local Stable Diffusion (Apple MPS GPU) 서버 시작 중..."
    if [ -d "$DIR/local_sd_env" ]; then
        "$DIR/local_sd_env/bin/python" "$DIR/local_sd_server.py" 7865 > "$DIR/local_sd.log" 2>&1 &
        echo "✅ Local SD 서버 백그라운드 시작 완료 (PID: $!)"
    else
        python3 "$DIR/local_sd_server.py" 7865 > "$DIR/local_sd.log" 2>&1 &
        echo "✅ Local SD 서버 백그라운드 시작 완료 (PID: $!)"
    fi
fi

# 2. Remotion Render Server 시작 (포트 8766)
if pgrep -f "render-server.mjs" > /dev/null; then
    echo "✅ Remotion 렌더 서버가 이미 실행 중입니다. (포트 8766)"
else
    echo "🎬 Remotion 렌더 서버 시작 중... (포트 8766)"
    if [ -d "$DIR/remotion" ]; then
        (cd "$DIR/remotion" && node render-server.mjs > "$DIR/remotion_server.log" 2>&1 &)
        echo "✅ Remotion 서버 백그라운드 시작 완료 (PID: $!)"
    fi
fi

# 3. ComfyUI Server 시작 (포트 8188)
COMFY_DIR="/Users/david/ComfyUI"
if [ -d "$COMFY_DIR" ]; then
    if lsof -i :8188 > /dev/null 2>&1 || pgrep -f "ComfyUI/main.py" > /dev/null; then
        echo "✅ ComfyUI 서버가 이미 실행 중입니다. (포트 8188)"
    else
        echo "⚙️ ComfyUI (Apple MPS GPU) 서버 시작 중... (포트 8188)"
        "$COMFY_DIR/venv/bin/python" "$COMFY_DIR/main.py" --listen 0.0.0.0 --port 8188 --enable-cors-header > "$DIR/comfyui.log" 2>&1 &
        echo "✅ ComfyUI 서버 백그라운드 시작 완료 (PID: $!)"
    fi
fi

# 4. Main Web Server 시작 (포트 8765)
echo "🌐 메인 웹 서버 시작 중... (http://localhost:8765)"
python3 "$DIR/server.py"

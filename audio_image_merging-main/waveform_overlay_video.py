import subprocess
import os
import threading

def _get_audio_duration(audio_path: str) -> float:
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            audio_path
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return float(res.stdout.strip())
    except Exception:
        return 0.0

def create_waveform_overlay_video(
    audio_path: str,
    bg_image_path: str,
    output_path: str,
    wave_color: str = "0x00d2ff",   # 파형 색상 (Hex 또는 색상명)
    opacity: float = 0.7,           # 파형 투명도 (0.0 투명 ~ 1.0 완전 불투명)
    wave_height: int = 320,         # 파형 영역 높이 (px)
    position: str = "bottom",       # "top", "center" 또는 "bottom"
    progress_callback=None,         # 진행률 콜백 (percent, line)
    cancel_event=None,              # 취소 이벤트 (threading.Event)
    return_log=False                # True면 ffmpeg 출력을 문자열로 반환
):
    """
    배경 이미지 위에 반투명 오디오 파형을 오버레이하여 MP4 영상을 생성합니다.
    """
    if not os.path.exists(audio_path) or not os.path.exists(bg_image_path):
        raise FileNotFoundError("오디오 또는 배경 이미지 파일 경로를 확인해주세요.")

    # 파형 세로 위치 계산 (center: 화면 중앙, top: 상단 100px, bottom: 하단 100px 여백)
    if position == "center":
        y_pos = "(H-h)/2"
    elif position == "top":
        y_pos = "100"
    else:
        y_pos = "H-h-100"

    # 복합 필터 그래프 구성
    # 1. 배경 이미지 1080p 비율 유지 스케일링 & 패딩
    # 2. 오디오 스트림에서 파형 생성 -> 검은 배경 크로마키 투명화 -> 알파 투명도 적용
    # 3. 배경 위에 파형 오버레이
    filter_complex = (
        f"[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
        f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2[bg];"
        f"[0:a]showwaves=s=1920x{wave_height}:mode=cline:colors={wave_color}:rate=30:scale=sqrt,"
        f"colorkey=0x000000:0.01:0.1,format=yuva420p,"
        f"colorchannelmixer=aa={opacity}[wave];"
        f"[bg][wave]overlay=(W-w)/2:{y_pos}[outv]"
    )

    command = [
        "ffmpeg",
        "-y",
        "-i", audio_path,          # [0] 오디오 입력
        "-loop", "1",
        "-i", bg_image_path,       # [1] 정적 배경 이미지 입력
        "-filter_complex", filter_complex,
        "-map", "[outv]",          # 합성된 비디오 스트림 매핑
        "-map", "0:a",             # 원본 오디오 매핑
        "-c:v", "libx264",
        "-tune", "stillimage",
        "-c:a", "aac",
        "-b:a", "192k",
        "-pix_fmt", "yuv420p",
        "-shortest",               # 오디오가 끝나면 렌더링 종료
        "-progress", "pipe:1",
        output_path
    ]

    duration = _get_audio_duration(audio_path)
    proc = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        universal_newlines=True
    )

    logs = []
    def drain_stderr():
        for line in proc.stderr:
            clean = line.rstrip()
            logs.append(clean)
            if progress_callback:
                progress_callback(None, clean)

    stderr_thread = threading.Thread(target=drain_stderr, daemon=True)
    stderr_thread.start()

    for line in proc.stdout:
        line = line.strip()
        if cancel_event and cancel_event.is_set():
            proc.terminate()
            break
        if line.startswith("out_time_us=") and duration > 0:
            try:
                us = int(line.split("=")[1])
                sec = us / 1_000_000.0
                pct = min(99, max(1, int((sec / duration) * 100)))
                if progress_callback:
                    progress_callback(pct, None)
            except Exception:
                pass
        elif line == "progress=end":
            if progress_callback:
                progress_callback(100, None)

    proc.wait()
    stderr_thread.join(timeout=2)

    if cancel_event and cancel_event.is_set():
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
            except Exception:
                pass
        raise RuntimeError("사용자에 의해 렌더링이 취소되었습니다.")

    if proc.returncode != 0:
        tail = "\n".join(logs[-15:])
        raise RuntimeError(f"FFmpeg 실행 실패 (코드 {proc.returncode}):\n{tail}")

    if return_log:
        return "\n".join(logs)
    print(f"웨이브 오버레이 합성 완료: {output_path}")

if __name__ == "__main__":
    create_waveform_overlay_video(
        audio_path="input.mp3",
        bg_image_path="background.jpg",
        output_path="overlay_output.mp4",
        wave_color="0xffffff",      # 화이트 파형
        opacity=0.65,               # 65% 불투명도
        wave_height=300,
        position="bottom"           # 하단 배치
    )
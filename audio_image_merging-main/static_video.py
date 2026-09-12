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

def create_static_video(
    audio_path: str,
    image_path: str,
    output_path: str,
    progress_callback=None,
    cancel_event=None,
    return_log=False
):
    """
    단일 이미지와 오디오를 합성하여 1080p MP4 비디오를 생성합니다.
    progress_callback, cancel_event 지원.
    """
    if not os.path.exists(audio_path) or not os.path.exists(image_path):
        raise FileNotFoundError("오디오 또는 이미지 파일 경로를 확인해주세요.")

    command = [
        "ffmpeg",
        "-y",                       # 기존 파일 덮어쓰기
        "-loop", "1",               # 이미지 반복
        "-i", image_path,           # 비디오 입력 (이미지)
        "-i", audio_path,           # 오디오 입력
        "-c:v", "libx264",          # H.264 비디오 코덱
        "-tune", "stillimage",      # 정적 이미지 압축 최적화
        "-c:a", "aac",              # AAC 오디오 코덱
        "-b:a", "192k",             # 오디오 비트레이트
        "-pix_fmt", "yuv420p",      # 플레이어 호환성 확보
        "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2", # 16:9 비율 맞춤 & 여백 처리
        "-shortest",                # 오디오 길이에 맞춰 인코딩 종료
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
    print(f"정지 이미지 비디오 생성 완료: {output_path}")

if __name__ == "__main__":
    create_static_video(
        audio_path="input.mp3",
        image_path="background.jpg",
        output_path="output.mp4"
    )

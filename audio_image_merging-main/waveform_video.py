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

def create_waveform_video(
    audio_path: str,
    output_path: str,
    width: int = 1920,
    height: int = 1080,
    wave_color: str = "0x00d2ff",
    progress_callback=None,
    cancel_event=None,
    return_log=False
):
    """
    오디오 신호를 분석하여 파형 시각화(showwaves) 비디오를 생성합니다.
    wave_color, progress_callback, cancel_event 지원.
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"오디오 파일을 찾을 수 없습니다: {audio_path}")

    # libx264 requires even dimensions
    if width % 2 != 0:
        width += 1
    if height % 2 != 0:
        height += 1

    command = [
        "ffmpeg",
        "-y",
        "-i", audio_path,
        "-filter_complex",
        f"[0:a]showwaves=s={width}x{height}:mode=cline:colors={wave_color}:rate=25[v]",
        "-map", "[v]",
        "-map", "0:a",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
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
        raise RuntimeError(f"FFmpeg 실행 실패 (종료 코드 {proc.returncode}):\n{tail}")

    if return_log:
        return "\n".join(logs)
    print(f"파형 영상 생성 완료: {output_path}")

if __name__ == "__main__":
    create_waveform_video(
        audio_path="input.mp3",
        output_path="waveform_output.mp4"
    )

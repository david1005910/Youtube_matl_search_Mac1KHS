import subprocess
import os
import threading
import json

def _format_time_srt(seconds: float) -> str:
    """초 단위를 SRT 타임스탬프 형식(00:00:00,000)으로 변환합니다."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    if millis >= 1000:
        millis = 999
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

def _hex_to_ass_color(hex_color: str) -> str:
    """Hex 색상(#RRGGBB)을 ASS 색상(&H00BBGGRR) 형식으로 변환합니다."""
    hex_color = (hex_color or "").strip().lstrip("#")
    if hex_color.lower().startswith("0x"):
        hex_color = hex_color[2:]
    if len(hex_color) == 6:
        r, g, b = hex_color[0:2], hex_color[2:4], hex_color[4:6]
        return f"&H00{b}{g}{r}".upper()
    return "&H00FFFFFF"

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

def create_scene_video(
    audio_path: str,
    scenes: list,
    output_path: str,
    font_size: int = 30,
    font_color: str = "#ffffff",
    bg_style: str = "box",       # "box" (반투명 배경 박스) or "shadow" (그림자 외곽선)
    position: str = "bottom",    # "bottom", "center", "top"
    margin_v: int = 55,
    progress_callback=None,
    cancel_event=None,
    return_log=False
):
    """
    여러 이미지/동영상 씬(Scene)을 오디오 타임라인에 맞추어 결합하고,
    씬별 나레이션 자막을 비디오에 직접 번인(Burn-in) 렌더링합니다.
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"오디오 파일을 찾을 수 없습니다: {audio_path}")
    if not scenes:
        raise ValueError("최소 1개 이상의 씬(Scene)이 필요합니다.")

    audio_duration = _get_audio_duration(audio_path)
    total_scene_duration = sum(float(s.get("duration", 0)) for s in scenes)

    # 씬 지속 시간이 0 이하이거나 비정상일 경우 오디오 길이에 맞춰 균등 배분
    if total_scene_duration <= 0.1 and audio_duration > 0:
        slice_dur = audio_duration / len(scenes)
        for s in scenes:
            s["duration"] = slice_dur
        total_scene_duration = audio_duration

    # 1. SRT 자막 파일 생성
    srt_path = output_path + ".srt"
    srt_lines = []
    current_time = 0.0
    sub_index = 1

    for s in scenes:
        dur = float(s.get("duration", 3.0))
        end_time = current_time + dur
        sub_text = str(s.get("subtitle", "")).strip()

        if sub_text:
            srt_lines.append(f"{sub_index}")
            srt_lines.append(f"{_format_time_srt(current_time)} --> {_format_time_srt(end_time)}")
            srt_lines.append(sub_text)
            srt_lines.append("")
            sub_index += 1

        current_time = end_time

    # 자막이 하나도 없으면 빈 자막 파일 방지를 위해 더미 공백 한 줄 작성
    if not srt_lines:
        srt_lines.append("1\n00:00:00,000 --> 00:00:01,000\n \n")

    with open(srt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(srt_lines))

    # 2. FFmpeg 커맨드 및 필터 그래프 구성
    cmd = ["ffmpeg", "-y"]
    video_filters = []

    for i, s in enumerate(scenes):
        media_path = s.get("media_path")
        if not media_path or not os.path.exists(media_path):
            raise FileNotFoundError(f"씬 {i+1}의 미디어 파일을 찾을 수 없습니다: {media_path}")

        dur = float(s.get("duration", 3.0))
        is_video = bool(s.get("is_video", False))

        if is_video:
            cmd.extend(["-t", f"{dur:.3f}", "-i", media_path])
        else:
            cmd.extend(["-loop", "1", "-t", f"{dur:.3f}", "-i", media_path])

        video_filters.append(
            f"[{i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
            f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v{i}]"
        )

    # 오디오 입력 추가
    audio_idx = len(scenes)
    cmd.extend(["-i", audio_path])

    # Concat 필터
    concat_inputs = "".join(f"[v{i}]" for i in range(len(scenes)))
    concat_filter = f"{concat_inputs}concat=n={len(scenes)}:v=1:a=0[vconcat]"

    # 자막 스타일 구성
    try:
        srt_target = os.path.relpath(srt_path).replace("\\", "/")
    except ValueError:
        srt_target = srt_path.replace("\\", "/").replace(":", r"\:")

    ass_color = _hex_to_ass_color(font_color)

    if position == "top":
        alignment = 8  # Top-center
    elif position == "center":
        alignment = 5  # Middle-center
    else:
        alignment = 2  # Bottom-center

    if bg_style == "box":
        border_style = 3
        back_color = "&H80000000"   # 50% 반투명 검정 배경 박스
        outline_color = "&H00000000"
        outline = 2
    else:
        border_style = 1
        back_color = "&H00000000"
        outline_color = "&H00000000" # 짙은 검정 외곽선 + 그림자
        outline = 3

    force_style = (
        f"FontSize={font_size},"
        f"PrimaryColour={ass_color},"
        f"OutlineColour={outline_color},"
        f"BackColour={back_color},"
        f"BorderStyle={border_style},"
        f"Outline={outline},"
        f"Alignment={alignment},"
        f"MarginV={margin_v}"
    )

    subtitles_filter = f"[vconcat]subtitles='{srt_target}':force_style='{force_style}'[vout]"

    full_filter = ";".join(video_filters) + ";" + concat_filter + ";" + subtitles_filter

    cmd.extend([
        "-filter_complex", full_filter,
        "-map", "[vout]",
        "-map", f"{audio_idx}:a",
        "-c:v", "libx264",
        "-tune", "stillimage",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        "-progress", "pipe:1",
        output_path
    ])

    # 3. 프로세스 실행 및 진행률 추적
    duration_to_track = audio_duration if audio_duration > 0 else total_scene_duration
    proc = subprocess.Popen(
        cmd,
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
        if line.startswith("out_time_us=") and duration_to_track > 0:
            try:
                us = int(line.split("=")[1])
                sec = us / 1_000_000.0
                pct = min(99, max(1, int((sec / duration_to_track) * 100)))
                if progress_callback:
                    progress_callback(pct, None)
            except Exception:
                pass
        elif line == "progress=end":
            if progress_callback:
                progress_callback(100, None)

    proc.wait()
    stderr_thread.join(timeout=2)

    # 임시 SRT 정리
    if os.path.exists(srt_path):
        try:
            os.remove(srt_path)
        except Exception:
            pass

    if cancel_event and cancel_event.is_set():
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
            except Exception:
                pass
        raise RuntimeError("사용자에 의해 렌더링이 취소되었습니다.")

    if proc.returncode != 0:
        tail = "\n".join(logs[-15:])
        raise RuntimeError(f"FFmpeg 씬 렌더링 실패 (코드 {proc.returncode}):\n{tail}")

    if return_log:
        return "\n".join(logs)
    print(f"씬 & 자막 비디오 생성 완료: {output_path}")

if __name__ == "__main__":
    test_scenes = [
        {"media_path": "background.jpg", "duration": 5.0, "subtitle": "첫 번째 씬: 배경 이미지와 나레이션 자막", "is_video": False},
        {"media_path": "background.jpg", "duration": 5.0, "subtitle": "두 번째 씬: 씬별로 편집된 개별 자막", "is_video": False},
    ]
    create_scene_video(
        audio_path="input.mp3",
        scenes=test_scenes,
        output_path="test_scene_output.mp4"
    )

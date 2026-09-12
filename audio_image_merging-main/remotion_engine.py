"""
remotion_engine.py
Remotion 스타일 멀티트랙 타임라인(비주얼 트랙, 오디오 트랙, 자막 트랙) 데이터를
1080p 고화질 MP4 비디오로 컴파일 및 렌더링하는 핵심 엔진입니다.
"""

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

def render_timeline(
    timeline: dict,
    output_path: str,
    progress_callback=None,
    cancel_event=None,
    return_log=False
):
    """
    멀티트랙 타임라인 딕셔너리를 입력받아 1080p MP4 비디오를 렌더링합니다.
    """
    total_duration = float(timeline.get("duration", 10.0))
    visual_track = timeline.get("visual_track", [])
    audio_track = timeline.get("audio_track", [])
    subtitle_track = timeline.get("subtitle_track", [])

    if not visual_track and not audio_track and not subtitle_track:
        raise ValueError("타임라인에 최소 1개 이상의 트랙 요소가 필요합니다.")

    # 1. SRT 자막 파일 생성
    srt_path = output_path + ".srt"
    srt_lines = []
    sub_idx = 1
    # 시작 시간 순으로 정렬
    sorted_subs = sorted(subtitle_track, key=lambda s: float(s.get("start", 0)))

    for s in sorted_subs:
        st = float(s.get("start", 0))
        et = float(s.get("end", st + 3.0))
        text = str(s.get("text", "")).strip()
        if text and et > st:
            srt_lines.append(f"{sub_idx}")
            srt_lines.append(f"{_format_time_srt(st)} --> {_format_time_srt(et)}")
            srt_lines.append(text)
            srt_lines.append("")
            sub_idx += 1

    has_subtitles = len(srt_lines) > 0
    if has_subtitles:
        with open(srt_path, "w", encoding="utf-8") as f:
            f.write("\n".join(srt_lines))

    # 2. FFmpeg 커맨드 및 필터 그래프 구축
    cmd = ["ffmpeg", "-y"]
    input_index = 0

    # (A) 비주얼 트랙 입력 처리
    visual_inputs = []
    filter_lines = []

    # visual_track을 시작 시각 순으로 정렬
    sorted_visuals = sorted(visual_track, key=lambda v: float(v.get("start", 0)))
    
    current_time = 0.0
    v_segments = []

    for idx, v in enumerate(sorted_visuals):
        v_start = float(v.get("start", 0))
        v_dur = float(v.get("duration", 3.0))
        media_path = v.get("media_path")
        is_video = bool(v.get("is_video", False))

        # 만약 이전 클립과 현재 클립 사이에 틈(Gap)이 있으면 블랙 프레임 삽입
        gap = v_start - current_time
        if gap > 0.05:
            cmd.extend(["-f", "lavfi", "-t", f"{gap:.3f}", "-i", "color=c=black:s=1920x1080:r=30"])
            filter_lines.append(f"[{input_index}:v]setsar=1,fps=30[v_gap_{idx}]")
            v_segments.append(f"[v_gap_{idx}]")
            input_index += 1

        if not media_path or not os.path.exists(media_path):
            # 미디어 파일이 없을 경우 단색 배경 처리
            cmd.extend(["-f", "lavfi", "-t", f"{v_dur:.3f}", "-i", "color=c=#0f1420:s=1920x1080:r=30"])
        elif is_video:
            cmd.extend(["-t", f"{v_dur:.3f}", "-i", media_path])
        else:
            cmd.extend(["-loop", "1", "-t", f"{v_dur:.3f}", "-i", media_path])

        filter_lines.append(
            f"[{input_index}:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
            f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v_seg_{idx}]"
        )
        v_segments.append(f"[v_seg_{idx}]")
        input_index += 1
        current_time = v_start + v_dur

    # 전체 타임라인 길이보다 비주얼이 짧으면 마지막에 블랙 패딩
    if current_time < total_duration - 0.05:
        tail_gap = total_duration - current_time
        cmd.extend(["-f", "lavfi", "-t", f"{tail_gap:.3f}", "-i", "color=c=black:s=1920x1080:r=30"])
        filter_lines.append(f"[{input_index}:v]setsar=1,fps=30[v_tail]")
        v_segments.append("[v_tail]")
        input_index += 1

    # 만약 비주얼 트랙이 완전히 비어있다면 기본 블랙 스크린 생성
    if not v_segments:
        cmd.extend(["-f", "lavfi", "-t", f"{total_duration:.3f}", "-i", "color=c=#0b0e17:s=1920x1080:r=30"])
        filter_lines.append(f"[{input_index}:v]setsar=1,fps=30[v_base]")
        v_segments.append("[v_base]")
        input_index += 1

    # 비주얼 세그먼트들을 Concat
    concat_input_str = "".join(v_segments)
    filter_lines.append(f"{concat_input_str}concat=n={len(v_segments)}:v=1:a=0[vconcat]")

    # (B) 자막 필터 적용
    if has_subtitles:
        try:
            srt_target = os.path.relpath(srt_path).replace("\\", "/")
        except ValueError:
            srt_target = srt_path.replace("\\", "/").replace(":", r"\:")

        sub_opts = timeline.get("subtitle_style", {})
        font_size = int(sub_opts.get("font_size", 30))
        font_color = _hex_to_ass_color(sub_opts.get("font_color", "#ffffff"))
        bg_style = str(sub_opts.get("bg_style", "box"))
        sub_pos = str(sub_opts.get("position", "bottom"))

        alignment = 2 if sub_pos == "bottom" else (8 if sub_pos == "top" else 5)
        border_style = 3 if bg_style == "box" else 1
        back_color = "&H80000000" if bg_style == "box" else "&H00000000"

        force_style = (
            f"FontSize={font_size},"
            f"PrimaryColour={font_color},"
            f"OutlineColour=&H00000000,"
            f"BackColour={back_color},"
            f"BorderStyle={border_style},"
            f"Outline=2,"
            f"Alignment={alignment},"
            f"MarginV=55"
        )
        filter_lines.append(f"[vconcat]subtitles='{srt_target}':force_style='{force_style}'[vout]")
    else:
        filter_lines.append("[vconcat]copy[vout]")

    # (C) 오디오 트랙 처리
    audio_segments = []
    for a_idx, a in enumerate(audio_track):
        a_path = a.get("media_path")
        a_start = float(a.get("start", 0))
        a_dur = float(a.get("duration", 0))
        a_vol = float(a.get("volume", 1.0))

        if a_path and os.path.exists(a_path):
            cmd.extend(["-i", a_path])
            delay_ms = int(a_start * 1000)
            trim_filter = f"atrim=0:{a_dur}," if a_dur > 0 else ""
            filter_lines.append(
                f"[{input_index}:a]{trim_filter}asetpts=PTS-STARTPTS,volume={a_vol},"
                f"adelay={delay_ms}|{delay_ms}[a_clip_{a_idx}]"
            )
            audio_segments.append(f"[a_clip_{a_idx}]")
            input_index += 1

    if len(audio_segments) == 1:
        filter_lines.append(f"{audio_segments[0]}anull[aout]")
    elif len(audio_segments) > 1:
        mix_inputs = "".join(audio_segments)
        filter_lines.append(f"{mix_inputs}amix=inputs={len(audio_segments)}:normalize=0[aout]")
    else:
        # 오디오가 없을 경우 무음 트랙 생성
        cmd.extend(["-f", "lavfi", "-t", f"{total_duration:.3f}", "-i", "anullsrc=r=44100:cl=stereo"])
        filter_lines.append(f"[{input_index}:a]anull[aout]")
        input_index += 1

    # 최종 필터 컴플렉스 결합
    full_filter_str = ";".join(filter_lines)

    cmd.extend([
        "-filter_complex", full_filter_str,
        "-map", "[vout]",
        "-map", "[aout]",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-t", f"{total_duration:.3f}",
        "-progress", "pipe:1",
        output_path
    ])

    # 3. FFmpeg 프로세스 실행 및 진행률 모니터링
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
        if line.startswith("out_time_us=") and total_duration > 0:
            try:
                us = int(line.split("=")[1])
                sec = us / 1_000_000.0
                pct = min(99, max(1, int((sec / total_duration) * 100)))
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
        raise RuntimeError(f"Remotion 타임라인 렌더링 실패 (코드 {proc.returncode}):\n{tail}")

    if return_log:
        return "\n".join(logs)
    print(f"Remotion 타임라인 비디오 생성 완료: {output_path}")

if __name__ == "__main__":
    # 테스트 타임라인
    sample_timeline = {
        "duration": 8.0,
        "visual_track": [
            {"media_path": "background.jpg", "start": 0.0, "duration": 4.0, "is_video": False},
            {"media_path": "background.jpg", "start": 4.0, "duration": 4.0, "is_video": False}
        ],
        "audio_track": [
            {"media_path": "input.mp3", "start": 0.0, "duration": 8.0, "volume": 1.0}
        ],
        "subtitle_track": [
            {"start": 0.5, "end": 3.5, "text": "Remotion 스타일 멀티트랙 렌더링"},
            {"start": 4.2, "end": 7.5, "text": "이미지, 오디오, 자막의 완벽한 결합"}
        ],
        "subtitle_style": {
            "font_size": 32,
            "font_color": "#00f2fe",
            "bg_style": "box",
            "position": "bottom"
        }
    }
    render_timeline(sample_timeline, "test_remotion_output.mp4")

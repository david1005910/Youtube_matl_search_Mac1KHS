"""
batch_convert.py
디렉터리 내의 오디오 및 이미지 파일들을 일괄(Batch)로 비디오 변환하는 CLI 유틸리티입니다.
"""

import argparse
import os
import sys
from waveform_video import create_waveform_video
from waveform_overlay_video import create_waveform_overlay_video
from static_video import create_static_video

AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

def scan_files(directory, valid_exts):
    files = []
    if not os.path.isdir(directory):
        return files
    for entry in sorted(os.listdir(directory)):
        full = os.path.join(directory, entry)
        if os.path.isfile(full) and os.path.splitext(entry)[1].lower() in valid_exts:
            files.append(full)
    return files

def run_batch(audio_dir, image_path, output_dir, mode="waveform_overlay", wave_color="0x00d2ff", opacity=0.7, wave_height=320, position="bottom"):
    os.makedirs(output_dir, exist_ok=True)
    audio_files = scan_files(audio_dir, AUDIO_EXTS)
    if not audio_files:
        print(f"오디오 파일이 '{audio_dir}' 디렉터리에 없습니다.")
        return

    print(f"총 {len(audio_files)}개의 오디오 파일 일괄 변환 시작 (모드: {mode})...")

    success_count = 0
    fail_count = 0

    for idx, audio in enumerate(audio_files, 1):
        base_name = os.path.splitext(os.path.basename(audio))[0]
        out_name = f"{base_name}_{mode}.mp4"
        out_path = os.path.join(output_dir, out_name)

        print(f"[{idx}/{len(audio_files)}] 처리 중: {os.path.basename(audio)} -> {out_name}")

        try:
            if mode == "waveform":
                create_waveform_video(audio, out_path, wave_color=wave_color)
            elif mode == "waveform_overlay":
                if not image_path or not os.path.isfile(image_path):
                    raise ValueError("배경 이미지가 유효하지 않습니다.")
                create_waveform_overlay_video(
                    audio, image_path, out_path,
                    wave_color=wave_color, opacity=opacity,
                    wave_height=wave_height, position=position
                )
            elif mode == "static":
                if not image_path or not os.path.isfile(image_path):
                    raise ValueError("배경 이미지가 유효하지 않습니다.")
                create_static_video(audio, image_path, out_path)
            else:
                raise ValueError(f"지원하지 않는 모드입니다: {mode}")

            success_count += 1
        except Exception as err:
            print(f"  ✕ 실패: {err}")
            fail_count += 1

    print(f"\n일괄 변환 완료! 성공: {success_count}, 실패: {fail_count}")

def main():
    parser = argparse.ArgumentParser(description="오디오/이미지 일괄 비디오 변환 CLI")
    parser.add_argument("--audio-dir", "-a", default=".", help="오디오 파일 디렉터리 (기본값: 현재 디렉터리)")
    parser.add_argument("--image", "-i", default="background.jpg", help="배경 이미지 경로")
    parser.add_argument("--output-dir", "-o", default="outputs", help="출력 디렉터리 (기본값: outputs)")
    parser.add_argument("--mode", "-m", choices=["waveform", "waveform_overlay", "static"], default="waveform_overlay", help="변환 모드")
    parser.add_argument("--color", "-c", default="0x00d2ff", help="파형 색상 (예: 0x00d2ff)")
    parser.add_argument("--opacity", type=float, default=0.7, help="파형 투명도 (0.0~1.0)")
    parser.add_argument("--height", type=int, default=320, help="파형 높이 (px)")
    parser.add_argument("--position", choices=["top", "center", "bottom"], default="bottom", help="파형 위치")

    args = parser.parse_args()
    run_batch(
        audio_dir=args.audio_dir,
        image_path=args.image,
        output_dir=args.output_dir,
        mode=args.mode,
        wave_color=args.color,
        opacity=args.opacity,
        wave_height=args.height,
        position=args.position
    )

if __name__ == "__main__":
    main()

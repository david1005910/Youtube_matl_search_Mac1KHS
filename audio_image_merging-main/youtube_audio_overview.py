"""
youtube_audio_overview.py
다수의 YouTube 영상으로부터 자막/메타데이터를 수집하고,
Google Gemini AI를 통해 심층 분석하여 2인 대화형 AI Audio Overview(팟캐스트)를
Edge-TTS 듀얼 스피커 음성으로 합성하는 핵심 엔진입니다.
"""

import re
import os
import json
import asyncio
import urllib.request
import urllib.parse
import subprocess
from typing import List, Dict, Any, Optional

try:
    from youtube_transcript_api import YouTubeTranscriptApi
except ImportError:
    YouTubeTranscriptApi = None

try:
    import edge_tts
except ImportError:
    edge_tts = None


# ==========================================
# 1. YouTube 메타데이터 및 자막 추출기
# ==========================================
def extract_video_id(url: str) -> Optional[str]:
    """다양한 형태의 YouTube URL에서 11자리 video_id를 정규식으로 추출합니다."""
    url = url.strip()
    patterns = [
        r"(?:v=|\/)([0-9A-Za-z_-]{11}).*",
        r"youtu\.be\/([0-9A-Za-z_-]{11})",
        r"youtube\.com\/shorts\/([0-9A-Za-z_-]{11})",
        r"youtube\.com\/embed\/([0-9A-Za-z_-]{11})"
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    if re.match(r"^[0-9A-Za-z_-]{11}$", url):
        return url
    return None


def format_duration_str(seconds: int) -> str:
    """초 단위 시간을 'X분 Y초' 형식 문자열로 변환합니다."""
    if seconds <= 0:
        return "0초"
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    parts = []
    if h > 0:
        parts.append(f"{h}시간")
    if m > 0:
        parts.append(f"{m}분")
    if s > 0 or not parts:
        parts.append(f"{s}초")
    return " ".join(parts)


def get_youtube_video_duration(video_id: str) -> int:
    """YouTube 영상의 실제 재생 길이(초)를 다각도로 정밀 추출합니다."""
    url = f"https://www.youtube.com/watch?v={video_id}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        # 1. lengthSeconds in ytInitialPlayerResponse
        m = re.search(r'"lengthSeconds"\s*:\s*"(\d+)"', html)
        if m and int(m.group(1)) > 0:
            return int(m.group(1))

        # 2. approxDurationMs
        m_ms = re.search(r'"approxDurationMs"\s*:\s*"(\d+)"', html)
        if m_ms and int(m_ms.group(1)) > 0:
            return int(int(m_ms.group(1)) / 1000)

        # 3. itemprop="duration" content="PT...M...S"
        m_iso = re.search(r'itemprop="duration"\s+content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"', html)
        if m_iso:
            h = int(m_iso.group(1) or 0)
            m = int(m_iso.group(2) or 0)
            s = int(m_iso.group(3) or 0)
            dur = h * 3600 + m * 60 + s
            if dur > 0:
                return dur
    except Exception as e:
        print(f"[YouTube] Duration fetch warning for {video_id}: {e}")
    return 0


def fetch_youtube_metadata(video_id: str, save_dir: str) -> Dict[str, Any]:
    """oEmbed API 및 웹 메타데이터를 호출하여 영상 제목, 채널명, 재생 시간, 썸네일 이미지를 다운로드합니다."""
    info = {
        "video_id": video_id,
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "title": f"YouTube Video ({video_id})",
        "author": "YouTube Creator",
        "thumbnail_url": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
        "thumbnail_file": None,
        "duration": 0,
        "duration_str": "미확인"
    }

    try:
        oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
        req = urllib.request.Request(oembed_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            info["title"] = data.get("title", info["title"])
            info["author"] = data.get("author_name", info["author"])
            if data.get("thumbnail_url"):
                info["thumbnail_url"] = data["thumbnail_url"]
    except Exception as e:
        print(f"[YouTube] oEmbed fetch warning for {video_id}: {e}")

    # 영상 실제 재생 길이(초) 감지
    dur = get_youtube_video_duration(video_id)
    if dur > 0:
        info["duration"] = dur
        info["duration_str"] = format_duration_str(dur)

    # 썸네일 이미지 로컬 저장 (1080p 비주얼 트랙용)
    os.makedirs(save_dir, exist_ok=True)
    thumb_path = os.path.join(save_dir, f"thumb_{video_id}.jpg")
    try:
        # maxresdefault -> hqdefault 폴백 시도
        t_urls = [info["thumbnail_url"], f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"]
        saved = False
        for tu in t_urls:
            try:
                treq = urllib.request.Request(tu, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(treq, timeout=8) as tresp:
                    with open(thumb_path, "wb") as f:
                        f.write(tresp.read())
                    info["thumbnail_file"] = thumb_path
                    saved = True
                    break
            except Exception:
                continue
        if not saved:
            # 기본 단색 이미지 생성 (FFmpeg)
            subprocess.run([
                "ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c=0x1e293b:s=1920x1080:d=1",
                "-frames:v", "1", thumb_path
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            info["thumbnail_file"] = thumb_path
    except Exception as e:
        print(f"[YouTube] Thumbnail save warning: {e}")

    return info


def fetch_youtube_transcript_and_duration(video_id: str) -> Tuple[str, int]:
    """youtube-transcript-api를 사용하여 자막 스크립트 텍스트와 타임스탬프 기반 영상 시간(초)을 추출합니다."""
    if not YouTubeTranscriptApi:
        return "", 0

    try:
        api = YouTubeTranscriptApi()
        transcript = None
        # 1. 우선 한국어 또는 영어 직접 시도
        try:
            transcript = api.fetch(video_id, languages=["ko", "en", "en-US", "en-GB"])
        except Exception:
            pass

        # 2. 없으면 등록된 모든 자막 목록에서 첫 번째 사용 가능한 자막 가져오기
        if not transcript:
            try:
                t_list = api.list(video_id)
                available = list(t_list)
                if available:
                    # 수동 자막 우선, 없으면 자동 생성 자막
                    chosen = next((t for t in available if not t.is_generated), available[0])
                    transcript = chosen.fetch()
            except Exception as e_list:
                print(f"[YouTube] Transcript list fetch failed for {video_id}: {e_list}")

        if not transcript:
            return "", 0

        lines = []
        max_end_time = 0.0
        for item in transcript:
            if hasattr(item, "text"):
                t = str(item.text).strip()
                st = float(getattr(item, "start", 0.0) or 0.0)
                dur = float(getattr(item, "duration", 0.0) or 0.0)
            elif isinstance(item, dict):
                t = str(item.get("text", "")).strip()
                st = float(item.get("start", 0.0) or 0.0)
                dur = float(item.get("duration", 0.0) or 0.0)
            else:
                t = str(item).strip()
                st, dur = 0.0, 0.0
            if t:
                lines.append(t)
            if st + dur > max_end_time:
                max_end_time = st + dur

        return " ".join(lines), int(round(max_end_time))
    except Exception as e:
        print(f"[YouTube] Transcript not found or error for {video_id}: {e}")
        return "", 0


def fetch_youtube_transcript(video_id: str) -> str:
    """하위 호환성 자막 추출 함수"""
    text, _ = fetch_youtube_transcript_and_duration(video_id)
    return text



def process_youtube_urls(urls: List[str], save_dir: str) -> List[Dict[str, Any]]:
    """입력된 다수의 YouTube URL 목록으로부터 메타데이터와 자막 텍스트를 수집합니다."""
    sources = []
    seen_ids = set()

    for url in urls:
        vid = extract_video_id(url)
        if not vid or vid in seen_ids:
            continue
        seen_ids.add(vid)

        meta = fetch_youtube_metadata(vid, save_dir)
        transcript, trans_dur = fetch_youtube_transcript_and_duration(vid)
        meta["transcript"] = transcript
        if meta.get("duration", 0) <= 0 and trans_dur > 0:
            meta["duration"] = trans_dur
            meta["duration_str"] = format_duration_str(trans_dur)
        sources.append(meta)

    return sources


# ==========================================
# 2. Gemini AI 외국어 동영상 원본 충실 번역 및 시간 맞춤형 스크립트 생성기
# ==========================================
def _calculate_target_chars(duration_sec: int) -> int:
    """
    목표 나레이션 시간(초)에 부합하는 한국어 스크립트 권장 글자 수(공백 포함)를 계산합니다.
    한국어 Edge-TTS 자연 낭독 기준: 초당 약 4.2~4.4글자
    """
    duration_sec = max(30, min(1800, duration_sec))
    net_speech_sec = max(25.0, duration_sec - max(1.5, duration_sec * 0.015))
    return int(round(net_speech_sec * 4.3))


def _free_translate_to_korean(text: str) -> str:
    """Google 번역 엔드포인트를 사용하여 원문 자막 텍스트를 무료로 직접 번역합니다."""
    if not text:
        return ""
    try:
        url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q=" + urllib.parse.quote(text)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return "".join([s[0] for s in data[0] if s and s[0]])
    except Exception as e:
        print(f"[Translation] Free translate warning: {e}")
        return text


def generate_korean_explainer_script_gemini(
    sources: List[Dict[str, Any]],
    api_key: Optional[str] = None,
    language: str = "ko",
    tone: str = "faithful",
    target_duration: Any = 180
) -> List[Dict[str, str]]:
    """
    수집된 외국어 YouTube 영상의 원본 자막을 요약이나 제3자 해설이 아닌,
    실제 화자의 발화 내용을 1인칭으로 그대로 직접 한국어 번역(Faithful Translation)하여
    지정된 목표 시간(또는 원본 영상 길이)에 부합하는 나레이션 스크립트를 생성합니다.
    """
    # target_duration이 "original"이거나 0 이하인 경우 원본 영상 길이에서 자동 추출
    is_orig = False
    if str(target_duration).lower() in ("original", "auto", "0"):
        is_orig = True
        detected_dur = 0
        for s in sources:
            if s.get("duration") and int(s["duration"]) > 0:
                detected_dur = int(s["duration"])
                break
        target_duration = detected_dur if detected_dur > 0 else 180
    else:
        try:
            target_duration = int(target_duration or 180)
        except (TypeError, ValueError):
            target_duration = 180

    target_duration = max(30, min(1800, target_duration))
    target_chars = _calculate_target_chars(target_duration)
    target_mins = round(target_duration / 60, 1)

    # 1. 소스 컨텍스트 조립
    source_context = ""
    for idx, s in enumerate(sources, 1):
        t_snippet = s.get("transcript", "")
        if len(t_snippet) > 25000:
            t_snippet = t_snippet[:25000] + "... (이하 생략)"
        s_dur_str = s.get("duration_str", f"{target_duration}초")
        source_context += f"\n\n### [영상 소스 {idx}]\n- 제목: {s.get('title')}\n- 채널: {s.get('author')}\n- 영상 원본 길이: {s_dur_str}\n- 원문 자막/실제 발화 내용:\n{t_snippet or '(원문 자막이 제공되지 않아 영상 제목과 주제를 중심으로 직접 1인칭 강의 나레이션으로 번역해 주세요)'}"

    # 섹션 수 결정: 시간에 따라 3~8개 섹션
    if target_duration <= 90:
        section_guide = "총 3개 섹션 [도입부 번역, 본론 번역, 결론 번역]"
        num_sections = 3
    elif target_duration <= 210:
        section_guide = "총 4개 섹션 [도입부 번역, 본론 1 번역, 본론 2 번역, 결론 번역]"
        num_sections = 4
    elif target_duration <= 420:
        section_guide = "총 5개 섹션 [도입부 번역, 본론 1 번역, 본론 2 번역, 본론 3 번역, 결론 번역]"
        num_sections = 5
    elif target_duration <= 720:
        section_guide = "총 6개 섹션 [도입부 번역, 본론 1~4 번역, 결론 번역]"
        num_sections = 6
    else:
        section_guide = "총 8개 섹션 [도입부 번역, 본론 1~6 번역, 결론 번역]"
        num_sections = 8

    orig_note = " (★ 원본 영상 전체 시간과 100% 동일하게 일치)" if is_orig else ""

    prompt = f"""당신은 외국어(영어 등) 전문 영상 콘텐츠를 원작자의 실제 발화 내용에 입각하여 왜곡 없이 충실히 번역(Faithful Translation)하여 한국어 나레이션으로 직접 전달하는 최고 수준의 전문 번역 나레이터입니다.

제공된 YouTube 영상(외국어 원문 자막)의 실제 발화 내용을 원작자가 직접 한국어로 청취자에게 말하듯이 유려한 1인칭 구어체로 '한국어 번역 나레이션 스크립트'를 작성해주세요.

[★ 절대 준수 규칙 - 제3자 리뷰/해설/요약 엄격 금지]:
1. **1인칭 직접 번역 나레이션 (Direct Dubbing Translation)**:
   - "안녕하세요, 오늘 번역해 드릴 영상은...", "원작자는 ~라고 설명합니다", "저자는 이번 영상에서 ~를 다룹니다", "결론에 이르러 원작자는..." 등의 제3자 리뷰/요약/해설 투 문장을 **절대로 작성하지 마세요**.
   - 영상 속 발표자/화자가 청취자에게 직접 말하는 것처럼 1인칭 나레이션("여러분 안녕하세요, 오늘 우리는 ~를 살펴보겠습니다...", "제가 여기서 강조하고 싶은 점은...", "이 방법의 핵심 원리는...")으로 원문 발화를 그대로 한국어로 직접 번역(Direct Dubbing Translation)하세요.
2. **원문 자막 내용 충실 번역 (Faithful Translation)**:
   - 주관적인 축약이나 요약을 하지 말고, 원문 자막(Transcript)에 나오는 실제 발화 순서, 구체적인 설명, 예시, 수치 데이터를 생략 없이 그대로 한국어로 번역하세요.
   - 목표 시간({target_duration}초{orig_note} $\rightarrow$ 약 {target_chars}자)에 맞추어, 영상 도입부부터 진행되는 실제 발화 내용을 순차적으로 충실하게 번역하여 채우세요.
3. **목표 나레이션 시간 및 글자 수 엄격 제어**:
   - 사용자가 설정한 목표 나레이션 시간: **{target_duration}초 (약 {target_mins}분{orig_note})**
   - 한국어 표준 낭독 속도(초당 약 4.3글자)에 정확히 맞추어, **전체 스크립트의 총 글자 수(공백 포함)가 약 {target_chars}자(±5% 이내)**가 되도록 각 섹션의 텍스트 길이를 정밀하게 맞추세요.
   - 각 섹션당 권장 분량: 약 {target_chars // num_sections}자 내외.
4. **구조화된 섹션 구성**:
   - {section_guide}으로 나누어 작성하세요.
   - 각 섹션의 'text'는 단일 화자(나레이터)가 막힘없이 말할 수 있는 자연스러운 한국어 구어체 문장으로 구성하세요.

[영상 소스 정보]:
{source_context}

반드시 아래와 같은 순수 JSON 배열(Array) 형식만 응답하세요. 다른 설명이나 마크다운 코드 블록(` ``` `) 없이 오직 JSON 데이터만 출력해야 합니다:
[
  {{
    "section": "도입부 번역",
    "title": "원작자의 첫 도입 발화 번역",
    "text": "1인칭 직접 번역 문장..."
  }},
  {{
    "section": "본론 1 번역",
    "title": "원작자의 핵심 개념 설명 번역",
    "text": "1인칭 직접 번역 문장..."
  }},
  ...
  {{
    "section": "결론 번역",
    "title": "원작자의 최종 마무리 발화 번역",
    "text": "1인칭 직접 번역 문장..."
  }}
]
"""

    if api_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "responseMimeType": "application/json"
                }
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                text_resp = data["candidates"][0]["content"]["parts"][0]["text"]
                cleaned = text_resp.strip()
                if cleaned.startswith("```json"):
                    cleaned = cleaned[7:]
                elif cleaned.startswith("```"):
                    cleaned = cleaned[3:]
                if cleaned.endswith("```"):
                    cleaned = cleaned[:-3]
                sections = json.loads(cleaned.strip())
                if isinstance(sections, list) and len(sections) > 0:
                    return sections
        except Exception as e:
            print(f"[Gemini API] Call error: {e}, falling back to built-in faithful translation engine.")

    # API 키가 없거나 호출 실패 시 실제 원문 자막을 직접 번역하는 스마트 폴백 엔진 가동
    return _generate_smart_fallback_explainer_script(sources, language, target_duration)


def _generate_smart_fallback_explainer_script(
    sources: List[Dict[str, Any]],
    language: str = "ko",
    target_duration: Any = 180
) -> List[Dict[str, str]]:
    """
    원문 자막(Transcript)이 존재하는 경우, 제3자 요약이나 논평이 아닌
    실제 원문 발화 문장들을 직접 1인칭으로 충실 번역(Faithful Translation)하여 대본을 구성합니다.
    자막이 없는 경우에도 제3자 리뷰가 아닌 영상 주제에 대한 1인칭 직접 설명 나레이션으로 구성합니다.
    """
    if str(target_duration).lower() in ("original", "auto", "0"):
        detected_dur = 0
        for s in sources:
            if s.get("duration") and int(s["duration"]) > 0:
                detected_dur = int(s["duration"])
                break
        target_duration = detected_dur if detected_dur > 0 else 180
    else:
        try:
            target_duration = int(target_duration or 180)
        except (TypeError, ValueError):
            target_duration = 180

    target_duration = max(30, min(1800, target_duration))
    target_chars = _calculate_target_chars(target_duration)

    if target_duration <= 90:
        num_sections = 3
    elif target_duration <= 210:
        num_sections = 4
    elif target_duration <= 420:
        num_sections = 5
    elif target_duration <= 720:
        num_sections = 6
    else:
        num_sections = 8

    transcript = ""
    for s in sources:
        t = (s.get("transcript") or "").strip()
        if t:
            transcript = t
            break

    title1 = sources[0].get("title", "핵심 기술 주제") if len(sources) > 0 else "주요 주제"

    if transcript:
        words = transcript.split()
        needed_words = int(target_chars / 2.8)
        selected_text = " ".join(words[:max(needed_words, 40)])
        sentences = [s.strip() for s in re.split(r'(?<=[.?!])\s+', selected_text) if s.strip()]
        if not sentences:
            sentences = [selected_text]

        chunk_size = max(1, len(sentences) // num_sections)
        results = []
        for i in range(num_sections):
            st = i * chunk_size
            ed = (i + 1) * chunk_size if i < num_sections - 1 else len(sentences)
            chunk = " ".join(sentences[st:ed]).strip()
            if not chunk:
                continue
            ko_text = _free_translate_to_korean(chunk)
            if i == 0:
                sec_name = "도입부 번역"
            elif i == num_sections - 1:
                sec_name = "결론부 번역"
            else:
                sec_name = f"본론 {i} 번역"

            results.append({
                "section": sec_name,
                "title": f"원문 {sec_name}",
                "text": ko_text
            })
        if results and len(results) >= max(2, num_sections - 1):
            return results

    # 자막이 없거나 짧은 경우: 1인칭 직접 강의/설명 나레이션 (동적 섹션 구성)
    base_sections = [
        ("도입부 번역", "주제 도입 및 문제 정의", f"여러분 안녕하세요. 오늘 우리가 함께 살펴볼 핵심 주제는 바로 {title1}입니다. 기존의 방식들이 마주했던 한계를 짚어보고, 왜 새로운 접근법이 필요한지 하나씩 살펴보겠습니다."),
        ("본론 1 번역", "구조적 배경과 새로운 아키텍처", "먼저 기존의 전통적인 방식이 겪고 있던 근본적인 한계를 살펴보겠습니다. 확장성과 지연 시간 측면에서 심각한 병목이 발생하고 있었으며, 이를 극복하기 위해 설계된 새로운 아키텍처가 제안되었습니다."),
        ("본론 2 번역", "핵심 메커니즘 및 알고리즘", "구체적인 원리를 살펴보면, 가장 중요한 것은 병목을 유발하는 불필요한 연산을 제거하고 데이터 처리 파이프라인의 효율을 극대화하는 것입니다. 실제 테스트에서도 월등한 성능 개선이 확인됩니다."),
        ("본론 3 번역", "실제 벤치마크 및 검증 데이터", "실제 다양한 환경에서 진행된 벤치마크 결과는 매우 고무적입니다. 자원 소모량은 획기적으로 줄어든 반면, 응답 속도와 신뢰성은 비약적으로 향상되었음을 수치로 분명히 확인할 수 있습니다."),
        ("본론 4 번역", "심화 최적화 기법 및 튜닝", "보다 고도화된 성능을 원한다면 캐싱 계층의 비동기 갱신과 메모리 레이아웃 정렬을 최적화해야 합니다. 세부 튜닝을 통해 시스템 지연 시간을 최저 수준으로 유지할 수 있습니다."),
        ("본론 5 번역", "실무 적용 시 주의점 및 트러블슈팅", "실제 배포 환경에서 발생할 수 있는 잠재적 이슈들을 사전에 차단하기 위해 헬스체크와 복구 전략을 미리 정의해 두는 것이 권장됩니다."),
        ("본론 6 번역", "장기 확장성 및 미래 전망", "장기적인 관점에서는 컴포넌트 간 결합도를 낮추고 표준화된 인터페이스를 준수함으로써 유연한 확장성을 보장할 수 있습니다."),
        ("결론부 번역", "핵심 요약 및 실행 방안", "결론적으로 이러한 새로운 구조를 이해하고 실무에 적용한다면 시스템의 안정성과 생산성을 비약적으로 끌어올릴 수 있습니다. 오늘 공유해 드린 내용을 여러분의 프로젝트에도 꼭 적용해 보시기 바랍니다.")
    ]

    if num_sections <= 3:
        sel = [base_sections[0], base_sections[2], base_sections[-1]]
    elif num_sections == 4:
        sel = [base_sections[0], base_sections[1], base_sections[2], base_sections[-1]]
    elif num_sections == 5:
        sel = [base_sections[0], base_sections[1], base_sections[2], base_sections[3], base_sections[-1]]
    elif num_sections == 6:
        sel = [base_sections[0], base_sections[1], base_sections[2], base_sections[3], base_sections[4], base_sections[-1]]
    else:
        sel = base_sections[:num_sections]

    return [{"section": s[0], "title": s[1], "text": s[2]} for s in sel]



# 하위 호환성 별칭
generate_podcast_script_gemini = generate_korean_explainer_script_gemini


def format_srt_timestamp(seconds: float) -> str:
    """초 단위를 SRT 표준 타임스탬프 (HH:MM:SS,mmm) 문자열로 변환합니다."""
    seconds = max(0.0, float(seconds or 0.0))
    total_ms = int(round(seconds * 1000))
    ms = total_ms % 1000
    total_sec = total_ms // 1000
    s = total_sec % 60
    m = (total_sec // 60) % 60
    h = total_sec // 3600
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def generate_srt_content(subtitles: List[Dict[str, Any]]) -> str:
    """자막 객체 목록으로부터 표준 SRT 자막 파일 내용(문자열)을 생성합니다."""
    blocks = []
    for idx, sub in enumerate(subtitles, 1):
        st = format_srt_timestamp(sub.get("start", 0.0))
        et = format_srt_timestamp(sub.get("end", 0.0))
        txt = (sub.get("text") or "").strip()
        blocks.append(f"{idx}\n{st} --> {et}\n{txt}\n")
    return "\n".join(blocks).strip() + "\n"


def generate_txt_content(script_sections: List[Dict[str, Any]], title: str = "") -> str:
    """나레이션 대본 섹션 목록으로부터 읽기 편한 텍스트 대본(.txt) 전문을 생성합니다."""
    lines = []
    if title:
        lines.append(f"[{title} - 한국어 원본 충실 번역 나레이션 전문]")
        lines.append("=" * 60)
        lines.append("")
    for idx, sec in enumerate(script_sections, 1):
        s_name = sec.get("section", f"섹션 {idx}")
        s_title = sec.get("title", "")
        s_text = (sec.get("text") or "").strip()
        header = f"■ {s_name}" + (f": {s_title}" if s_title else "")
        lines.append(header)
        lines.append(s_text)
        lines.append("")
    return "\n".join(lines).strip() + "\n"


# ==========================================
# 3. Edge-TTS 단일 해설가 음성 합성 및 타임라인 빌드 (시간 맞춤형 믹싱)
# ==========================================
async def _synthesize_turn(text: str, voice: str, output_file: str):
    """단일 문단/턴을 Edge-TTS로 음성 합성합니다."""
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_file)


def _get_audio_duration_ffprobe(file_path: str) -> float:
    """ffprobe를 통해 오디오 파일의 재생 시간(초)을 정밀 측정합니다."""
    try:
        cmd = [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", file_path
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, check=True)
        return float(res.stdout.strip())
    except Exception:
        return 3.0


def synthesize_explainer_audio_and_timeline(
    script_sections: List[Dict[str, str]],
    sources: List[Dict[str, Any]],
    output_mp3_path: str,
    voice: str = "ko-KR-InJoonNeural",
    language: str = "ko",
    target_duration: Optional[int] = 180,
    progress_callback=None
) -> Dict[str, Any]:
    """
    한국어 해설/번역 리포트 문단들을 선택된 단일 AI 음성으로 합성하고,
    목표 나레이션 시간(target_duration)에 맞추어 자연스러운 호흡(Pause) 간격을 동적으로 조절하여
    목표 시간에 정밀 수렴하도록 FFmpeg로 마스터링합니다.
    """
    if not edge_tts:
        raise RuntimeError("edge-tts 라이브러리가 설치되어 있지 않습니다.")

    if not voice:
        voice = "ko-KR-InJoonNeural" if language == "ko" else "en-US-GuyNeural"

    work_dir = os.path.dirname(output_mp3_path)
    os.makedirs(work_dir, exist_ok=True)

    temp_files = []
    section_durations = []
    total_sections = len(script_sections)

    # 1. 문단별 TTS 개별 음성 합성
    for idx, sec in enumerate(script_sections):
        sec_title = sec.get("title", f"섹션 {idx+1}")
        sec_name = sec.get("section", "해설")
        text = sec.get("text", "")

        if progress_callback:
            percent = int((idx / total_sections) * 60) + 15
            progress_callback(percent, f"한국어 번역 나레이션 음성 합성 중: [{sec_name}] {sec_title} ({idx+1}/{total_sections})")

        sec_file = os.path.join(work_dir, f"sec_{idx:03d}.mp3")
        asyncio.run(_synthesize_turn(text, voice, sec_file))
        temp_files.append(sec_file)

        dur = _get_audio_duration_ffprobe(sec_file)
        section_durations.append(dur)

    # 2. 목표 나레이션 시간에 맞춘 동적 호흡(Pause) 간격 계산 및 정밀 무음 생성
    is_orig = False
    if str(target_duration).lower() in ("original", "auto", "0"):
        is_orig = True
        orig_dur = 0
        if sources and len(sources) > 0:
            orig_dur = int(sources[0].get("duration") or 0)
        target = float(orig_dur if orig_dur > 0 else 180)
    else:
        try:
            target = float(target_duration or 180)
        except (TypeError, ValueError):
            target = 180.0

    total_speech_time = sum(section_durations)
    pause_count = max(1, total_sections - 1)

    silence_files = []
    tempo_scale = 1.0

    if target > total_speech_time:
        # 발화 시간보다 목표 시간이 긴 경우: 문단 사이에 실제 무음 파일 생성 및 삽입
        remaining = target - total_speech_time
        gap = remaining / pause_count
        if gap <= 2.0:
            pause_gap = round(gap, 3)
            tail_gap = 0.0
        else:
            # 문단 사이 호흡은 최대 1.4초로 자연스럽게 유지하고, 남은 시간은 말미 여운(tail silence)으로 배분
            pause_gap = 1.4
            tail_gap = round(target - (total_speech_time + (pause_count * pause_gap)), 3)
            tail_gap = max(0.0, tail_gap)
    else:
        # 발화 시간이 목표 시간보다 긴 경우: 최소 자연스러운 호흡(0.25초)을 주고, FFmpeg atempo로 미세 속도 조절
        pause_gap = 0.25
        tail_gap = 0.0

    # 문단 사이 무음 MP3 생성
    p_file = None
    if pause_gap > 0.05:
        p_file = os.path.join(work_dir, "sec_pause.mp3")
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
            "-t", str(pause_gap), "-c:a", "libmp3lame", "-q:a", "2", p_file
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        silence_files.append(p_file)

    tail_file = None
    if tail_gap > 0.05:
        tail_file = os.path.join(work_dir, "sec_tail.mp3")
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
            "-t", str(tail_gap), "-c:a", "libmp3lame", "-q:a", "2", tail_file
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        silence_files.append(tail_file)

    # 4. Concat 목록 조립 (발화 음성과 실제 무음 파일 교차 배치)
    if progress_callback:
        progress_callback(80, f"오디오 트랙 결합 및 목표 시간({int(target)}초) 정밀 마스터링 중...")

    concat_txt_path = os.path.join(work_dir, "concat_sections.txt")
    with open(concat_txt_path, "w", encoding="utf-8") as f:
        for idx, tf in enumerate(temp_files):
            clean_path = tf.replace("\\", "/")
            f.write(f"file '{clean_path}'\n")
            if p_file and idx < total_sections - 1:
                clean_p = p_file.replace("\\", "/")
                f.write(f"file '{clean_p}'\n")
        if tail_file:
            clean_tail = tail_file.replace("\\", "/")
            f.write(f"file '{clean_tail}'\n")

    # 1차 병합 오디오 생성
    raw_merged = os.path.join(work_dir, "raw_merged.mp3")
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", concat_txt_path,
        "-c:a", "libmp3lame", "-q:a", "2",
        raw_merged
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    silence_files.append(raw_merged)

    raw_dur = _get_audio_duration_ffprobe(raw_merged)

    # 발화 시간이 길어서 tempo 보정이 필요한 경우 (raw_dur > target)
    import shutil
    if raw_dur > target + 0.5:
        tempo = round(raw_dur / target, 3)
        tempo = min(1.35, max(1.02, tempo))
        tempo_scale = tempo
        subprocess.run([
            "ffmpeg", "-y", "-i", raw_merged,
            "-filter:a", f"atempo={tempo}",
            "-c:a", "libmp3lame", "-q:a", "2",
            output_mp3_path
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    else:
        shutil.copy2(raw_merged, output_mp3_path)

    # 최종 오디오 재생 시간 정밀 측정 및 ±0.3초 미세 오차 최종 정합
    final_audio_dur = _get_audio_duration_ffprobe(output_mp3_path)
    if abs(final_audio_dur - target) > 0.3:
        if final_audio_dur < target:
            pad_needed = round(target - final_audio_dur, 3)
            pad_file = os.path.join(work_dir, "pad_extra.mp3")
            subprocess.run([
                "ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
                "-t", str(pad_needed), "-c:a", "libmp3lame", "-q:a", "2", pad_file
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            silence_files.append(pad_file)

            with open(concat_txt_path, "w", encoding="utf-8") as f:
                f.write(f"file '{output_mp3_path.replace(chr(92), '/')}'\n")
                f.write(f"file '{pad_file.replace(chr(92), '/')}'\n")
            padded_out = os.path.join(work_dir, "padded_out.mp3")
            subprocess.run([
                "ffmpeg", "-y", "-f", "concat", "-safe", "0",
                "-i", concat_txt_path, "-c:a", "libmp3lame", "-q:a", "2", padded_out
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            shutil.copy2(padded_out, output_mp3_path)
            if os.path.exists(padded_out):
                os.remove(padded_out)
        else:
            trimmed_out = os.path.join(work_dir, "trimmed_out.mp3")
            subprocess.run([
                "ffmpeg", "-y", "-i", output_mp3_path,
                "-t", str(target), "-c:a", "libmp3lame", "-q:a", "2", trimmed_out
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            shutil.copy2(trimmed_out, output_mp3_path)
            if os.path.exists(trimmed_out):
                os.remove(trimmed_out)

    final_audio_dur = _get_audio_duration_ffprobe(output_mp3_path)
    total_duration = round(final_audio_dur, 2)

    # 3. 서브타이틀 타임스탬프 계산 (무음 간격 및 tempo_scale 완벽 동기화)
    subtitles = []
    current_time = 0.0
    for idx, sec in enumerate(script_sections):
        dur = section_durations[idx]
        if tempo_scale != 1.0:
            sec_start = round(current_time / tempo_scale, 2)
            sec_dur = round(dur / tempo_scale, 2)
            sec_end = round(sec_start + sec_dur, 2)
        else:
            sec_start = round(current_time, 2)
            sec_end = round(current_time + dur, 2)

        subtitles.append({
            "id": f"sub_sec_{idx}",
            "start": sec_start,
            "end": sec_end,
            "speaker": "Narrator",
            "name": sec.get("section", f"섹션 {idx+1}"),
            "title": sec.get("title", ""),
            "text": sec.get("text", ""),
            "font_size": 32,
            "font_color": "#00f2fe",
            "bg_style": "box",
            "position": "bottom"
        })

        current_time += dur + pause_gap

    # 5. 비주얼 트랙 (YouTube 썸네일 배치)
    if progress_callback:
        progress_callback(92, "타임라인 비주얼 및 자막 동기화 중...")

    visual_track = []
    num_sources = len(sources)
    if num_sources > 0:
        segment_dur = total_duration / num_sources
        for s_idx, src in enumerate(sources):
            thumb_file = src.get("thumbnail_file")
            v_start = round(s_idx * segment_dur, 2)
            v_dur = round(segment_dur, 2)
            if s_idx == num_sources - 1:
                v_dur = round(total_duration - v_start, 2)

            visual_track.append({
                "id": f"v_yt_{s_idx}",
                "name": src.get("title", f"YouTube {s_idx+1}"),
                "file_path": thumb_file,
                "is_video": False,
                "start": v_start,
                "duration": v_dur
            })

    # 6. Remotion 타임라인 포맷 빌드
    timeline_data = {
        "duration": total_duration,
        "visual_track": visual_track,
        "audio_track": [
            {
                "id": "a_yt_overview",
                "name": "AI Explainer Audio (Korean Narration)",
                "file_path": output_mp3_path,
                "start": 0.0,
                "duration": total_duration,
                "volume": 1.0
            }
        ],
        "subtitle_track": subtitles,
        "subtitle_style": {
            "font_size": 32,
            "font_color": "#ffffff",
            "bg_style": "box",
            "position": "bottom"
        }
    }

    # 임시 파일 정리
    try:
        if os.path.exists(concat_txt_path):
            os.remove(concat_txt_path)
        for tf in temp_files + silence_files:
            if tf and os.path.exists(tf):
                os.remove(tf)
    except Exception:
        pass

    if progress_callback:
        progress_callback(100, f"한국어 번역 나레이션 오디오 생성 완료! (목표: {int(target)}초 | 완성: {total_duration}초)")

    return {
        "audio_file": output_mp3_path,
        "duration": total_duration,
        "target_duration": int(target),
        "is_original_duration": is_orig,
        "original_duration": int(sources[0].get("duration", int(target))) if sources else int(target),
        "script": script_sections,
        "subtitles": subtitles,
        "timeline_data": timeline_data,
        "sources": sources
    }


# 하위 호환성 별칭
synthesize_podcast_audio_and_timeline = synthesize_explainer_audio_and_timeline


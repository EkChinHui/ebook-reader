import io
import numpy as np
import soundfile as sf

SAMPLE_RATE = 24000

VOICES = [
    "af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky",
    "am_adam", "am_michael",
    "bf_emma", "bf_isabella", "bm_george", "bm_lewis",
]

_pipeline = None


def get_pipeline():
    global _pipeline
    if _pipeline is None:
        from kokoro import KPipeline
        _pipeline = KPipeline(lang_code="a")
    return _pipeline


def audio_array_to_wav_bytes(audio_np: np.ndarray) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, audio_np, SAMPLE_RATE, format="WAV")
    return buf.getvalue()


def stream_audio(text: str, voice: str, speed: float):
    if not text or not text.strip():
        return

    pipeline = get_pipeline()
    lang = "b" if voice.startswith("b") else "a"
    pipeline.lang_code = lang

    buffer = np.array([], dtype=np.float32)
    min_samples = SAMPLE_RATE * 2

    for _gs, _ps, audio in pipeline(text, voice=voice, speed=speed):
        if audio is not None:
            audio_np = audio.numpy() if hasattr(audio, "numpy") else np.array(audio)
            buffer = np.concatenate([buffer, audio_np])
            if len(buffer) >= min_samples:
                yield audio_array_to_wav_bytes(buffer)
                buffer = np.array([], dtype=np.float32)

    if len(buffer) > 0:
        yield audio_array_to_wav_bytes(buffer)


def generate_audio_chunks_with_timing(text: str, voice: str, speed: float):
    """Yield (wav_bytes, segments) for each pipeline chunk with cumulative timing."""
    if not text or not text.strip():
        return

    pipeline = get_pipeline()
    lang = "b" if voice.startswith("b") else "a"
    pipeline.lang_code = lang

    cumulative_samples = 0

    for result in pipeline(text, voice=voice, speed=speed):
        if result.audio is not None:
            audio_np = result.audio.numpy() if hasattr(result.audio, "numpy") else np.array(result.audio)
            chunk_offset = cumulative_samples / SAMPLE_RATE
            cumulative_samples += len(audio_np)

            chunk_segments = []
            if result.tokens:
                group_text = ""
                group_start = None
                group_end = 0.0
                group_count = 0
                for token in result.tokens:
                    if not token.text:
                        continue
                    word = token.text + token.whitespace
                    start = chunk_offset + (token.start_ts or 0)
                    end = chunk_offset + (token.end_ts or 0)
                    if group_start is None:
                        group_start = start
                    group_text += word
                    group_end = end
                    group_count += 1
                    if group_count >= 4:
                        chunk_segments.append({"text": group_text, "start": round(group_start, 3), "end": round(group_end, 3)})
                        group_text = ""
                        group_start = None
                        group_count = 0
                if group_text:
                    chunk_segments.append({"text": group_text, "start": round(group_start, 3), "end": round(group_end, 3)})
            else:
                start_time = chunk_offset
                end_time = cumulative_samples / SAMPLE_RATE
                chunk_segments.append({"text": result.graphemes, "start": round(start_time, 3), "end": round(end_time, 3)})

            yield audio_array_to_wav_bytes(audio_np), chunk_segments


def generate_audio_with_timing(text: str, voice: str, speed: float) -> tuple[bytes, list[dict]]:
    """Generate full audio and return (wav_bytes, segments) with word-level timing."""
    if not text or not text.strip():
        return audio_array_to_wav_bytes(np.array([], dtype=np.float32)), []

    pipeline = get_pipeline()
    lang = "b" if voice.startswith("b") else "a"
    pipeline.lang_code = lang

    all_audio = np.array([], dtype=np.float32)
    segments = []

    for result in pipeline(text, voice=voice, speed=speed):
        if result.audio is not None:
            audio_np = result.audio.numpy() if hasattr(result.audio, "numpy") else np.array(result.audio)
            chunk_offset = len(all_audio) / SAMPLE_RATE
            all_audio = np.concatenate([all_audio, audio_np])

            if result.tokens:
                group_text = ""
                group_start = None
                group_end = 0.0
                group_count = 0
                for token in result.tokens:
                    if not token.text:
                        continue
                    word = token.text + token.whitespace
                    start = chunk_offset + (token.start_ts or 0)
                    end = chunk_offset + (token.end_ts or 0)
                    if group_start is None:
                        group_start = start
                    group_text += word
                    group_end = end
                    group_count += 1
                    if group_count >= 4:
                        segments.append({"text": group_text, "start": round(group_start, 3), "end": round(group_end, 3)})
                        group_text = ""
                        group_start = None
                        group_count = 0
                if group_text:
                    segments.append({"text": group_text, "start": round(group_start, 3), "end": round(group_end, 3)})
            else:
                start_time = chunk_offset
                end_time = len(all_audio) / SAMPLE_RATE
                segments.append({"text": result.graphemes, "start": round(start_time, 3), "end": round(end_time, 3)})

    return audio_array_to_wav_bytes(all_audio), segments

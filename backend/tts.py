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

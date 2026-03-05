import gradio as gr
import numpy as np
import soundfile as sf
import io
import re
from pathlib import Path

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
import fitz  # PyMuPDF

# --- Text Extraction ---

def extract_epub_chapters(file_path: str) -> list[tuple[str, str]]:
    book = epub.read_epub(file_path)
    chapters = []
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        soup = BeautifulSoup(item.get_content(), "html.parser")
        text = soup.get_text(separator="\n", strip=True)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        if len(text) > 50:
            title = soup.find(["h1", "h2", "h3"])
            name = title.get_text(strip=True) if title else item.get_name()
            chapters.append((name, text))
    return chapters


def extract_pdf_pages(file_path: str) -> list[tuple[str, str]]:
    doc = fitz.open(file_path)
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text().strip()
        text = re.sub(r"\n{3,}", "\n\n", text)
        if len(text) > 20:
            pages.append((f"Page {i + 1}", text))
    doc.close()
    return pages


# --- TTS ---

_pipeline = None

VOICES = [
    "af_heart",
    "af_bella",
    "af_nicole",
    "af_sarah",
    "af_sky",
    "am_adam",
    "am_michael",
    "bf_emma",
    "bf_isabella",
    "bm_george",
    "bm_lewis",
]


def get_pipeline():
    global _pipeline
    if _pipeline is None:
        from kokoro import KPipeline
        _pipeline = KPipeline(lang_code="a")
    return _pipeline


SAMPLE_RATE = 24000


def audio_array_to_wav_bytes(audio_np: np.ndarray) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, audio_np, SAMPLE_RATE, format="WAV")
    return buf.getvalue()


def stream_audio(text: str, voice: str, speed: float):
    """Generator that yields wav bytes for each sentence as Kokoro produces them."""
    if not text or not text.strip():
        return

    pipeline = get_pipeline()

    lang = "a"
    if voice.startswith("b"):
        lang = "b"
    pipeline.lang_code = lang

    # Buffer small chunks together for smoother playback (aim for ~2s minimum)
    buffer = np.array([], dtype=np.float32)
    min_samples = SAMPLE_RATE * 2  # 2 seconds

    for gs, ps, audio in pipeline(text, voice=voice, speed=speed):
        if audio is not None:
            audio_np = audio.numpy() if hasattr(audio, "numpy") else np.array(audio)
            buffer = np.concatenate([buffer, audio_np])

            if len(buffer) >= min_samples:
                yield audio_array_to_wav_bytes(buffer)
                buffer = np.array([], dtype=np.float32)

    # Yield remaining audio
    if len(buffer) > 0:
        yield audio_array_to_wav_bytes(buffer)


# --- App State ---

class BookState:
    def __init__(self):
        self.chapters: list[tuple[str, str]] = []

book_state = BookState()


def load_book(file):
    if file is None:
        book_state.chapters = []
        return gr.update(choices=[], value=None), "", gr.update(visible=False)

    path = file if isinstance(file, str) else file.name
    ext = Path(path).suffix.lower()

    if ext == ".epub":
        chapters = extract_epub_chapters(path)
    elif ext == ".pdf":
        chapters = extract_pdf_pages(path)
    else:
        book_state.chapters = []
        return gr.update(choices=[], value=None), "Unsupported file format. Use EPUB or PDF.", gr.update(visible=False)

    book_state.chapters = chapters
    if not chapters:
        return gr.update(choices=[], value=None), "No readable text found.", gr.update(visible=False)

    names = [c[0] for c in chapters]
    first_text = chapters[0][1]
    return gr.update(choices=names, value=names[0]), first_text[:3000], gr.update(visible=True)


def select_chapter(chapter_name):
    for name, text in book_state.chapters:
        if name == chapter_name:
            return text[:3000]
    return ""


def get_full_chapter_text(chapter_name):
    for name, text in book_state.chapters:
        if name == chapter_name:
            return text
    return ""


def narrate(chapter_name, voice, speed):
    text = get_full_chapter_text(chapter_name)
    if not text:
        gr.Warning("No text to narrate.")
        return
    yield from stream_audio(text, voice, speed)


# --- UI ---

CUSTOM_CSS = """
.main-title { text-align: center; margin-bottom: 0.5em; }
.controls-row { gap: 1em; }
"""

with gr.Blocks(title="Ebook Narrator") as app:
    gr.Markdown("# Ebook Narrator", elem_classes="main-title")
    gr.Markdown("Upload an EPUB or PDF, pick a chapter, and listen.", elem_classes="main-title")

    with gr.Row():
        with gr.Column(scale=1):
            file_input = gr.File(
                label="Upload Ebook",
                file_types=[".epub", ".pdf"],
                type="filepath",
            )
            chapter_dropdown = gr.Dropdown(label="Chapter / Page", choices=[], interactive=True)

            with gr.Group(visible=False) as controls_group:
                voice_dropdown = gr.Dropdown(
                    label="Voice",
                    choices=VOICES,
                    value="af_heart",
                    interactive=True,
                )
                speed_slider = gr.Slider(
                    minimum=0.5, maximum=2.5, value=1.0, step=0.1, label="Speed"
                )
                narrate_btn = gr.Button("Play", variant="primary", size="lg")
                audio_output = gr.Audio(label="Narration", streaming=True, autoplay=True)

        with gr.Column(scale=2):
            text_display = gr.Textbox(
                label="Chapter Text (preview)",
                lines=28,
                max_lines=28,
                interactive=False,
            )

    # Events
    file_input.change(
        load_book,
        inputs=[file_input],
        outputs=[chapter_dropdown, text_display, controls_group],
    )
    chapter_dropdown.change(
        select_chapter,
        inputs=[chapter_dropdown],
        outputs=[text_display],
    )
    narrate_btn.click(
        narrate,
        inputs=[chapter_dropdown, voice_dropdown, speed_slider],
        outputs=[audio_output],
    )

if __name__ == "__main__":
    app.launch(inbrowser=True, css=CUSTOM_CSS, theme=gr.themes.Soft())

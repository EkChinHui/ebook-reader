# Vite + Svelte UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Gradio UI with a Svelte + Vite frontend and FastAPI backend for the ebook narrator app.

**Architecture:** FastAPI backend exposes REST endpoints for book upload, chapter retrieval, and streaming TTS audio. Svelte + Vite SPA consumes these endpoints. In dev, Vite proxies `/api` to FastAPI. In production, FastAPI serves the built static files.

**Tech Stack:** Python 3 + FastAPI + uvicorn (backend), Svelte 5 + Vite + TypeScript + Tailwind CSS v4 (frontend), Kokoro TTS (existing)

---

### Task 1: Refactor Backend — Extract Core Logic

**Files:**
- Create: `backend/__init__.py`
- Create: `backend/book.py`
- Create: `backend/tts.py`
- Existing reference: `app.py`

**Step 1: Create `backend/__init__.py`**

```python
# empty
```

**Step 2: Create `backend/book.py`** — move extraction functions

```python
import re
from pathlib import Path

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
import fitz


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


def extract_chapters(file_path: str) -> list[tuple[str, str]]:
    ext = Path(file_path).suffix.lower()
    if ext == ".epub":
        return extract_epub_chapters(file_path)
    elif ext == ".pdf":
        return extract_pdf_pages(file_path)
    else:
        raise ValueError(f"Unsupported format: {ext}")
```

**Step 3: Create `backend/tts.py`** — move TTS functions

```python
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
```

**Step 4: Verify imports work**

Run: `.venv/bin/python -c "from backend.book import extract_chapters; from backend.tts import VOICES, stream_audio; print('OK')"`
Expected: `OK`

**Step 5: Commit**

```bash
git add backend/
git commit -m "refactor: extract book and tts logic into backend package"
```

---

### Task 2: Create FastAPI Server

**Files:**
- Create: `backend/server.py`
- Modify: `requirements.txt` — add `uvicorn`, `python-multipart`

**Step 1: Add dependencies to `requirements.txt`**

Append:
```
fastapi
uvicorn
python-multipart
```

**Step 2: Install new deps**

Run: `.venv/bin/pip install fastapi uvicorn python-multipart`

**Step 3: Create `backend/server.py`**

```python
import os
import tempfile
import uuid
from pathlib import Path

from fastapi import FastAPI, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from .book import extract_chapters
from .tts import VOICES, stream_audio

app = FastAPI()

# In-memory book storage keyed by session id
_books: dict[str, list[tuple[str, str]]] = {}


@app.post("/api/upload")
async def upload_book(file: UploadFile):
    if not file.filename:
        raise HTTPException(400, "No file provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in (".epub", ".pdf"):
        raise HTTPException(400, "Unsupported format. Use EPUB or PDF.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        chapters = extract_chapters(tmp_path)
    finally:
        os.unlink(tmp_path)

    if not chapters:
        raise HTTPException(400, "No readable text found.")

    book_id = uuid.uuid4().hex[:8]
    _books[book_id] = chapters

    return {
        "book_id": book_id,
        "chapters": [{"index": i, "title": name} for i, (name, _) in enumerate(chapters)],
    }


@app.get("/api/books/{book_id}/chapters/{index}")
async def get_chapter(book_id: str, index: int):
    chapters = _books.get(book_id)
    if not chapters:
        raise HTTPException(404, "Book not found")
    if index < 0 or index >= len(chapters):
        raise HTTPException(404, "Chapter not found")

    name, text = chapters[index]
    return {"title": name, "text": text}


@app.get("/api/voices")
async def get_voices():
    return {"voices": VOICES}


@app.get("/api/narrate/{book_id}/{index}")
async def narrate_chapter(book_id: str, index: int, voice: str = "af_heart", speed: float = 1.0):
    chapters = _books.get(book_id)
    if not chapters:
        raise HTTPException(404, "Book not found")
    if index < 0 or index >= len(chapters):
        raise HTTPException(404, "Chapter not found")

    if voice not in VOICES:
        raise HTTPException(400, f"Unknown voice: {voice}")
    if not (0.5 <= speed <= 2.5):
        raise HTTPException(400, "Speed must be between 0.5 and 2.5")

    _, text = chapters[index]
    return StreamingResponse(
        stream_audio(text, voice, speed),
        media_type="audio/wav",
    )


# Serve frontend static files in production
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
```

**Step 4: Test the server starts**

Run: `cd /Users/ecq964/projects/ebook-reader && .venv/bin/uvicorn backend.server:app --host 0.0.0.0 --port 8000` (then Ctrl+C)
Expected: Server starts without import errors

**Step 5: Commit**

```bash
git add backend/server.py requirements.txt
git commit -m "feat: add FastAPI server with upload, chapter, and narration endpoints"
```

---

### Task 3: Scaffold Svelte + Vite Frontend

**Step 1: Create Vite project with Svelte template**

Run:
```bash
cd /Users/ecq964/projects/ebook-reader
npm create vite@latest frontend -- --template svelte-ts
```

**Step 2: Install dependencies**

Run:
```bash
cd /Users/ecq964/projects/ebook-reader/frontend
npm install
npm install -D tailwindcss @tailwindcss/vite
```

**Step 3: Configure Vite proxy — edit `frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
```

**Step 4: Add Tailwind to CSS — replace `frontend/src/app.css`**

```css
@import "tailwindcss";
```

**Step 5: Verify dev server starts**

Run: `cd /Users/ecq964/projects/ebook-reader/frontend && npm run dev` (then Ctrl+C)
Expected: Vite dev server starts on port 5173

**Step 6: Commit**

```bash
git add frontend/
git commit -m "feat: scaffold Svelte + Vite + Tailwind frontend"
```

---

### Task 4: Implement API Client and Stores

**Files:**
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/stores.ts`

**Step 1: Create `frontend/src/lib/api.ts`**

```typescript
export interface ChapterInfo {
  index: number
  title: string
}

export interface UploadResult {
  book_id: string
  chapters: ChapterInfo[]
}

export interface ChapterContent {
  title: string
  text: string
}

export async function uploadBook(file: File): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload failed' }))
    throw new Error(err.detail || 'Upload failed')
  }
  return res.json()
}

export async function fetchChapter(bookId: string, index: number): Promise<ChapterContent> {
  const res = await fetch(`/api/books/${bookId}/chapters/${index}`)
  if (!res.ok) throw new Error('Failed to load chapter')
  return res.json()
}

export async function fetchVoices(): Promise<string[]> {
  const res = await fetch('/api/voices')
  const data = await res.json()
  return data.voices
}

export function narrateUrl(bookId: string, index: number, voice: string, speed: number): string {
  return `/api/narrate/${bookId}/${index}?voice=${encodeURIComponent(voice)}&speed=${speed}`
}
```

**Step 2: Create `frontend/src/lib/stores.ts`**

```typescript
import { writable } from 'svelte/store'
import type { ChapterInfo } from './api'

export const bookId = writable<string | null>(null)
export const chapters = writable<ChapterInfo[]>([])
export const currentChapterIndex = writable<number>(-1)
export const chapterText = writable<string>('')
export const fileName = writable<string>('')
export const isPlaying = writable<boolean>(false)
export const selectedVoice = writable<string>('af_heart')
export const playbackSpeed = writable<number>(1.0)
```

**Step 3: Commit**

```bash
git add frontend/src/lib/
git commit -m "feat: add API client and Svelte stores"
```

---

### Task 5: Build Sidebar Component

**Files:**
- Create: `frontend/src/components/Sidebar.svelte`

**Step 1: Create Sidebar component**

```svelte
<script lang="ts">
  import { uploadBook, fetchChapter } from '../lib/api'
  import { bookId, chapters, currentChapterIndex, chapterText, fileName } from '../lib/stores'

  let uploading = false
  let error = ''

  async function handleFile(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    error = ''
    uploading = true
    try {
      const result = await uploadBook(file)
      $bookId = result.book_id
      $chapters = result.chapters
      $fileName = file.name
      if (result.chapters.length > 0) {
        await selectChapter(0)
      }
    } catch (err: any) {
      error = err.message || 'Upload failed'
    } finally {
      uploading = false
    }
  }

  async function selectChapter(index: number) {
    if (!$bookId) return
    $currentChapterIndex = index
    const content = await fetchChapter($bookId, index)
    $chapterText = content.text
  }
</script>

<aside class="w-72 bg-zinc-900 text-zinc-100 flex flex-col h-full border-r border-zinc-800">
  <div class="p-4 border-b border-zinc-800">
    <h1 class="text-lg font-semibold mb-3">Ebook Narrator</h1>
    <label
      class="block w-full cursor-pointer rounded-lg border-2 border-dashed border-zinc-600 p-4 text-center text-sm text-zinc-400 transition hover:border-zinc-400 hover:text-zinc-200"
      class:opacity-50={uploading}
    >
      {#if uploading}
        Uploading...
      {:else if $fileName}
        {$fileName} — click to replace
      {:else}
        Drop EPUB/PDF or click to upload
      {/if}
      <input type="file" accept=".epub,.pdf" class="hidden" on:change={handleFile} disabled={uploading} />
    </label>
    {#if error}
      <p class="mt-2 text-sm text-red-400">{error}</p>
    {/if}
  </div>

  <nav class="flex-1 overflow-y-auto">
    {#each $chapters as chapter (chapter.index)}
      <button
        class="w-full text-left px-4 py-2.5 text-sm transition hover:bg-zinc-800"
        class:bg-zinc-800={$currentChapterIndex === chapter.index}
        class:text-white={$currentChapterIndex === chapter.index}
        class:text-zinc-400={$currentChapterIndex !== chapter.index}
        on:click={() => selectChapter(chapter.index)}
      >
        {chapter.title}
      </button>
    {/each}
  </nav>
</aside>
```

**Step 2: Commit**

```bash
git add frontend/src/components/Sidebar.svelte
git commit -m "feat: add Sidebar component with file upload and chapter list"
```

---

### Task 6: Build Reader Component

**Files:**
- Create: `frontend/src/components/Reader.svelte`

**Step 1: Create Reader component**

```svelte
<script lang="ts">
  import { chapterText, chapters, currentChapterIndex } from '../lib/stores'

  $: currentTitle = $chapters.find(c => c.index === $currentChapterIndex)?.title ?? ''
</script>

<main class="flex-1 overflow-y-auto bg-zinc-950 p-8">
  {#if $chapterText}
    <div class="mx-auto max-w-2xl">
      <h2 class="mb-6 text-2xl font-semibold text-zinc-100">{currentTitle}</h2>
      <div class="prose prose-invert prose-zinc max-w-none leading-relaxed text-zinc-300 whitespace-pre-wrap">
        {$chapterText}
      </div>
    </div>
  {:else}
    <div class="flex h-full items-center justify-center text-zinc-600">
      <p class="text-lg">Upload an ebook to start reading</p>
    </div>
  {/if}
</main>
```

**Step 2: Commit**

```bash
git add frontend/src/components/Reader.svelte
git commit -m "feat: add Reader component for chapter text display"
```

---

### Task 7: Build AudioPlayer Component

**Files:**
- Create: `frontend/src/components/AudioPlayer.svelte`

**Step 1: Create AudioPlayer component**

```svelte
<script lang="ts">
  import { bookId, currentChapterIndex, isPlaying, selectedVoice, playbackSpeed } from '../lib/stores'
  import { narrateUrl } from '../lib/api'

  const VOICES = [
    'af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky',
    'am_adam', 'am_michael',
    'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis',
  ]

  let audioEl: HTMLAudioElement

  function play() {
    if (!$bookId || $currentChapterIndex < 0) return
    const url = narrateUrl($bookId, $currentChapterIndex, $selectedVoice, $playbackSpeed)
    audioEl.src = url
    audioEl.play()
    $isPlaying = true
  }

  function stop() {
    audioEl.pause()
    audioEl.src = ''
    $isPlaying = false
  }

  function handleEnded() {
    $isPlaying = false
  }
</script>

<footer class="border-t border-zinc-800 bg-zinc-900 px-6 py-3">
  <div class="mx-auto flex max-w-4xl items-center gap-4">
    <button
      class="rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-40"
      disabled={!$bookId || $currentChapterIndex < 0}
      on:click={() => $isPlaying ? stop() : play()}
    >
      {$isPlaying ? 'Stop' : 'Play'}
    </button>

    <label class="flex items-center gap-2 text-sm text-zinc-400">
      Voice
      <select
        bind:value={$selectedVoice}
        class="rounded bg-zinc-800 px-2 py-1 text-zinc-200 text-sm border border-zinc-700"
      >
        {#each VOICES as v}
          <option value={v}>{v}</option>
        {/each}
      </select>
    </label>

    <label class="flex items-center gap-2 text-sm text-zinc-400">
      Speed
      <input
        type="range"
        min="0.5"
        max="2.5"
        step="0.1"
        bind:value={$playbackSpeed}
        class="w-24"
      />
      <span class="w-8 text-zinc-200">{$playbackSpeed.toFixed(1)}</span>
    </label>
  </div>

  <audio bind:this={audioEl} on:ended={handleEnded} class="hidden" />
</footer>
```

**Step 2: Commit**

```bash
git add frontend/src/components/AudioPlayer.svelte
git commit -m "feat: add AudioPlayer component with voice and speed controls"
```

---

### Task 8: Wire Up App.svelte and Clean Up

**Files:**
- Modify: `frontend/src/App.svelte`
- Modify: `frontend/src/main.ts`
- Delete: Scaffolded demo files (`frontend/src/lib/Counter.svelte`, etc.)

**Step 1: Replace `frontend/src/App.svelte`**

```svelte
<script lang="ts">
  import Sidebar from './components/Sidebar.svelte'
  import Reader from './components/Reader.svelte'
  import AudioPlayer from './components/AudioPlayer.svelte'
</script>

<div class="flex h-screen flex-col bg-zinc-950 text-zinc-100">
  <div class="flex flex-1 overflow-hidden">
    <Sidebar />
    <Reader />
  </div>
  <AudioPlayer />
</div>
```

**Step 2: Ensure `frontend/src/main.ts` imports app.css**

```typescript
import './app.css'
import App from './App.svelte'

const app = new App({
  target: document.getElementById('app')!,
})

export default app
```

**Step 3: Delete scaffolded demo files**

Run:
```bash
rm -f frontend/src/lib/Counter.svelte frontend/src/assets/svelte.svg
```

**Step 4: Verify build works**

Run:
```bash
cd /Users/ecq964/projects/ebook-reader/frontend && npm run build
```
Expected: Build succeeds, output in `frontend/dist/`

**Step 5: Commit**

```bash
git add -A frontend/
git commit -m "feat: wire up App layout with Sidebar, Reader, and AudioPlayer"
```

---

### Task 9: Add Run Script and Test End-to-End

**Files:**
- Create: `run.sh`

**Step 1: Create `run.sh`**

```bash
#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "Building frontend..."
cd frontend && npm run build && cd ..

echo "Starting server on http://localhost:8000"
.venv/bin/uvicorn backend.server:app --host 0.0.0.0 --port 8000
```

**Step 2: Make it executable**

Run: `chmod +x /Users/ecq964/projects/ebook-reader/run.sh`

**Step 3: Create dev run script `dev.sh`**

```bash
#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Start FastAPI backend
.venv/bin/uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Start Vite dev server
cd frontend && npm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
echo "Backend: http://localhost:8000  |  Frontend: http://localhost:5173"
wait
```

**Step 4: Make it executable**

Run: `chmod +x /Users/ecq964/projects/ebook-reader/dev.sh`

**Step 5: Commit**

```bash
git add run.sh dev.sh
git commit -m "feat: add run and dev scripts"
```

---

### Task 10: Final Cleanup

**Step 1: Remove old `app.py`** (Gradio version is fully replaced)

Run: `rm /Users/ecq964/projects/ebook-reader/app.py`

**Step 2: Update `requirements.txt`** — remove gradio, add new deps

```
ebooklib
PyMuPDF
beautifulsoup4
soundfile
numpy
kokoro>=0.9
misaki[en]
fastapi
uvicorn
python-multipart
```

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove Gradio app, finalize requirements"
```

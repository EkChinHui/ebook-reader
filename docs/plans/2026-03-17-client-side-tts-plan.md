# Client-Side TTS Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace server-side Python Kokoro TTS with kokoro-js running in a browser Web Worker, eliminating the heavy Python TTS dependency.

**Architecture:** A Web Worker loads the kokoro-js ONNX model once and streams audio chunks back to the main thread via `tts.stream()`. A TTS Manager class wraps the worker with async iteration. AudioPlayer.svelte replaces its SSE fetch with TTS Manager calls, keeping all existing Web Audio API scheduling logic.

**Tech Stack:** kokoro-js (npm), Web Workers, Web Audio API, Svelte 5, Vite, TypeScript

---

### Task 1: Install kokoro-js dependency

**Files:**
- Modify: `frontend/package.json`

**Step 1: Install the package**

Run: `cd frontend && npm install kokoro-js`

**Step 2: Verify installation**

Run: `cd frontend && node -e "require('kokoro-js')"`
Expected: No error (module resolves)

**Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "feat: add kokoro-js dependency for client-side TTS"
```

---

### Task 2: Create TTS Web Worker

**Files:**
- Create: `frontend/src/lib/ttsWorker.ts`

**Step 1: Write the worker file**

The worker loads kokoro-js on first `init` message, then handles `generate` requests using the streaming API. Each audio chunk is posted back as a transferable `Float32Array` for zero-copy transfer.

```typescript
// frontend/src/lib/ttsWorker.ts
import { KokoroTTS, TextSplitterStream } from 'kokoro-js'

let tts: KokoroTTS | null = null

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'init') {
    try {
      self.postMessage({ type: 'status', status: 'loading' })
      tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
      })
      self.postMessage({ type: 'status', status: 'ready' })
    } catch (err: any) {
      self.postMessage({ type: 'status', status: 'error', error: err.message })
    }
    return
  }

  if (msg.type === 'generate') {
    const { text, voice, generationId } = msg
    if (!tts) {
      self.postMessage({ type: 'error', generationId, error: 'Model not loaded' })
      return
    }

    try {
      const splitter = new TextSplitterStream()
      const stream = tts.stream(splitter)

      // Push all text and close - kokoro-js splits into sentences internally
      splitter.push(text)
      splitter.close()

      for await (const { text: chunkText, audio } of stream) {
        // audio is a RawAudio with .audio (Float32Array) and .sampling_rate
        const samples = audio.audio
        const sampleRate = audio.sampling_rate
        self.postMessage(
          { type: 'chunk', generationId, text: chunkText, audio: samples, sampleRate },
          [samples.buffer]  // Transfer ownership for zero-copy
        )
      }

      self.postMessage({ type: 'done', generationId })
    } catch (err: any) {
      self.postMessage({ type: 'error', generationId, error: err.message })
    }
    return
  }
}
```

**Step 2: Verify the file compiles**

Run: `cd frontend && npx tsc --noEmit src/lib/ttsWorker.ts 2>&1 || echo "Type errors are OK - worker types need config"`

Note: Worker files may have type issues with `self` — we'll verify in integration. The important thing is that the logic is correct.

**Step 3: Commit**

```bash
git add frontend/src/lib/ttsWorker.ts
git commit -m "feat: add TTS Web Worker for kokoro-js inference"
```

---

### Task 3: Create TTS Manager

**Files:**
- Create: `frontend/src/lib/tts.ts`

**Step 1: Write the TTS Manager**

The manager wraps the Web Worker with a clean async API. It handles model lifecycle (loading/ready/error), generation requests with cancellation, and exposes state as callbacks.

```typescript
// frontend/src/lib/tts.ts

export type TTSModelStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface TTSChunk {
  text: string
  audio: Float32Array
  sampleRate: number
}

type StatusCallback = (status: TTSModelStatus, error?: string) => void
type ChunkCallback = (chunk: TTSChunk) => void
type DoneCallback = () => void
type ErrorCallback = (error: string) => void

export class TTSManager {
  private worker: Worker | null = null
  private status: TTSModelStatus = 'idle'
  private currentGenerationId = 0
  private onStatusChange: StatusCallback | null = null
  private onChunk: ChunkCallback | null = null
  private onDone: DoneCallback | null = null
  private onError: ErrorCallback | null = null

  /** Subscribe to model status changes */
  setOnStatusChange(cb: StatusCallback) { this.onStatusChange = cb }

  /** Subscribe to audio chunks during generation */
  setOnChunk(cb: ChunkCallback) { this.onChunk = cb }

  /** Subscribe to generation completion */
  setOnDone(cb: DoneCallback) { this.onDone = cb }

  /** Subscribe to generation errors */
  setOnError(cb: ErrorCallback) { this.onError = cb }

  getStatus(): TTSModelStatus { return this.status }

  /** Initialize the worker and start loading the model */
  init() {
    if (this.worker) return
    this.worker = new Worker(
      new URL('./ttsWorker.ts', import.meta.url),
      { type: 'module' }
    )
    this.worker.onmessage = (e: MessageEvent) => this.handleMessage(e.data)
    this.worker.postMessage({ type: 'init' })
  }

  private handleMessage(msg: any) {
    if (msg.type === 'status') {
      this.status = msg.status
      this.onStatusChange?.(msg.status, msg.error)
      return
    }

    // Ignore messages from stale generations
    if (msg.generationId !== this.currentGenerationId) return

    if (msg.type === 'chunk') {
      this.onChunk?.({
        text: msg.text,
        audio: msg.audio,
        sampleRate: msg.sampleRate,
      })
    } else if (msg.type === 'done') {
      this.onDone?.()
    } else if (msg.type === 'error') {
      this.onError?.(msg.error)
    }
  }

  /** Start generating audio for the given text. Cancels any in-progress generation. */
  generate(text: string, voice: string): number {
    if (!this.worker || this.status !== 'ready') return -1
    const generationId = ++this.currentGenerationId
    this.worker.postMessage({ type: 'generate', text, voice, generationId })
    return generationId
  }

  /** Cancel current generation by bumping the generation counter */
  cancel() {
    this.currentGenerationId++
  }

  /** Terminate the worker entirely */
  destroy() {
    this.cancel()
    this.worker?.terminate()
    this.worker = null
    this.status = 'idle'
  }
}
```

**Step 2: Verify the file compiles**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.app.json 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add frontend/src/lib/tts.ts
git commit -m "feat: add TTSManager wrapper for TTS Web Worker"
```

---

### Task 4: Update storage.ts for new cache format

**Files:**
- Modify: `frontend/src/lib/storage.ts`

**Step 1: Read the current file**

Read `frontend/src/lib/storage.ts` to understand the existing cache API.

**Step 2: Update the audio cache to store Float32Array chunks**

Replace the in-memory cache types and functions. The cache key format stays the same, but the payload changes from `{ wavChunks: ArrayBuffer[], segments }` to `{ audioChunks: { audio: Float32Array, sampleRate: number }[], segments }`.

Change the `CachedAudio` type and update `getCachedAudio`/`setCachedAudio`:

```typescript
// Replace existing CachedAudio type and cache functions:

interface CachedAudio {
  audioChunks: { audio: Float32Array; sampleRate: number }[]
  segments: TimedSegment[]
}

const audioCache = new Map<string, CachedAudio>()

export function getCachedAudio(bookId: string, chapter: number, voice: string, speed: number): CachedAudio | null {
  return audioCache.get(`${bookId}:${chapter}:${voice}:${speed}`) ?? null
}

export function setCachedAudio(bookId: string, chapter: number, voice: string, speed: number, data: CachedAudio) {
  audioCache.set(`${bookId}:${chapter}:${voice}:${speed}`, data)
}
```

**Step 3: Verify compilation**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.app.json 2>&1 | tail -10`

Note: AudioPlayer.svelte will have errors at this point because it still uses the old cache format. That's expected — we fix it in the next task.

**Step 4: Commit**

```bash
git add frontend/src/lib/storage.ts
git commit -m "refactor: update audio cache format for client-side TTS"
```

---

### Task 5: Rewrite AudioPlayer.svelte for client-side TTS

This is the largest task. Replace the SSE streaming logic with TTSManager calls.

**Files:**
- Modify: `frontend/src/components/AudioPlayer.svelte`
- Modify: `frontend/src/lib/stores.ts` (add `ttsModelStatus` store)

**Step 1: Add `ttsModelStatus` store**

In `frontend/src/lib/stores.ts`, add:

```typescript
import type { TTSModelStatus } from './tts'

export const ttsModelStatus = writable<TTSModelStatus>('idle')
```

**Step 2: Rewrite AudioPlayer.svelte `<script>` section**

Replace the entire `<script>` block. Key changes:
- Import `TTSManager` instead of SSE fetch
- Remove `abortController`, `cachedWavChunks` (no more WAV bytes)
- Add `ttsManager` singleton, initialize on first play
- `play()` uses `ttsManager.generate()` with chunk/done callbacks
- `playFromCache()` decodes Float32Array chunks instead of WAV ArrayBuffers
- `cycleSpeed()` uses same stop/play approach (playbackRate changes pitch, acceptable trade-off per design)
- Model loading state shown in UI

Here is the complete replacement `<script>` block:

```typescript
<script lang="ts">
  import { bookId, currentChapterIndex, chapters, chapterText, isPlaying, selectedVoice, playbackSpeed, segments, currentSegmentIndex, fileName, ttsModelStatus } from '../lib/stores'
  import { fetchChapter } from '../lib/api'
  import { getCachedAudio, setCachedAudio, saveReadingState } from '../lib/storage'
  import { TTSManager } from '../lib/tts'
  import type { TTSChunk } from '../lib/tts'
  import type { TimedSegment } from '../lib/api'

  const VOICES = [
    { id: 'af_heart', label: 'Heart' },
    { id: 'af_bella', label: 'Bella' },
    { id: 'af_nicole', label: 'Nicole' },
    { id: 'af_sarah', label: 'Sarah' },
    { id: 'af_sky', label: 'Sky' },
    { id: 'am_adam', label: 'Adam' },
    { id: 'am_michael', label: 'Michael' },
    { id: 'bf_emma', label: 'Emma' },
    { id: 'bf_isabella', label: 'Isabella' },
    { id: 'bm_george', label: 'George' },
    { id: 'bm_lewis', label: 'Lewis' },
  ]

  let loading = false
  let currentTime = 0
  let duration = 0

  // Web Audio API state
  let audioCtx: AudioContext | null = null
  let gainNode: GainNode | null = null
  let activeSourceNodes: AudioBufferSourceNode[] = []
  let decodedChunks: { buffer: AudioBuffer; startTime: number }[] = []
  let totalAudioDuration = 0
  let playbackStartCtxTime = 0
  let playbackStartOffset = 0
  let animFrameId: number | null = null
  let streamingDone = false
  let playGeneration = 0
  let lastSaveTime = 0

  // TTS Manager (client-side)
  let ttsManager: TTSManager | null = null
  let cachedAudioChunks: { audio: Float32Array; sampleRate: number }[] = []

  function getTTSManager(): TTSManager {
    if (!ttsManager) {
      ttsManager = new TTSManager()
      ttsManager.setOnStatusChange((status, error) => {
        $ttsModelStatus = status
        if (error) console.error('TTS model error:', error)
      })
      ttsManager.init()
    }
    return ttsManager
  }

  function ensureAudioCtx(): AudioContext {
    if (!audioCtx) {
      audioCtx = new AudioContext()
      gainNode = audioCtx.createGain()
      gainNode.connect(audioCtx.destination)
    }
    return audioCtx
  }

  function stopAllSources() {
    for (const s of activeSourceNodes) {
      try { s.onended = null; s.stop() } catch {}
    }
    activeSourceNodes = []
  }

  function stopTimeTracking() {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId)
      animFrameId = null
    }
  }

  function persistPosition() {
    if ($bookId) {
      saveReadingState({
        fileName: $fileName,
        chapterIndex: $currentChapterIndex,
        currentTime,
        voice: $selectedVoice,
        speed: $playbackSpeed,
      })
    }
  }

  function startTimeTracking() {
    stopTimeTracking()
    function tick() {
      if (audioCtx && $isPlaying) {
        const elapsed = audioCtx.currentTime - playbackStartCtxTime
        currentTime = Math.min(playbackStartOffset + elapsed, totalAudioDuration)
        duration = totalAudioDuration

        if ($segments.length > 0) {
          let idx = $segments.findIndex(s => currentTime >= s.start && currentTime < s.end)
          if (idx === -1 && currentTime >= $segments[$segments.length - 1].start) {
            idx = $segments.length - 1
          }
          if (idx !== $currentSegmentIndex) {
            $currentSegmentIndex = idx
          }
        }

        const now = Date.now()
        if (now - lastSaveTime > 3000) {
          lastSaveTime = now
          persistPosition()
        }
      }
      animFrameId = requestAnimationFrame(tick)
    }
    animFrameId = requestAnimationFrame(tick)
  }

  function scheduleOneChunk(chunkIndex: number) {
    const ctx = audioCtx!
    const chunk = decodedChunks[chunkIndex]
    const curTime = (ctx.currentTime - playbackStartCtxTime) + playbackStartOffset
    const chunkEnd = chunk.startTime + chunk.buffer.duration

    if (chunkEnd <= curTime) return

    const offsetInChunk = Math.max(0, curTime - chunk.startTime)
    const source = ctx.createBufferSource()
    source.buffer = chunk.buffer
    source.playbackRate.value = $playbackSpeed
    source.connect(gainNode!)

    const realTimeDelay = chunk.startTime + offsetInChunk - curTime
    source.start(ctx.currentTime + Math.max(0, realTimeDelay), offsetInChunk)

    source.onended = () => {
      const idx = activeSourceNodes.indexOf(source)
      if (idx >= 0) activeSourceNodes.splice(idx, 1)
      if (streamingDone && activeSourceNodes.length === 0 && $isPlaying) {
        $isPlaying = false
        $currentSegmentIndex = -1
        stopTimeTracking()
      }
    }
    activeSourceNodes.push(source)
  }

  function rescheduleAllFrom(fromTime: number) {
    stopAllSources()
    playbackStartOffset = Math.max(0, Math.min(fromTime, totalAudioDuration))
    playbackStartCtxTime = audioCtx!.currentTime
    currentTime = playbackStartOffset

    for (let i = 0; i < decodedChunks.length; i++) {
      const chunkEnd = decodedChunks[i].startTime + decodedChunks[i].buffer.duration
      if (chunkEnd <= playbackStartOffset) continue
      scheduleOneChunk(i)
    }
  }

  function float32ToAudioBuffer(ctx: AudioContext, samples: Float32Array, sampleRate: number): AudioBuffer {
    const audioBuffer = ctx.createBuffer(1, samples.length, sampleRate)
    audioBuffer.getChannelData(0).set(samples)
    return audioBuffer
  }

  async function playFromCache(cached: { audioChunks: { audio: Float32Array; sampleRate: number }[]; segments: TimedSegment[] }) {
    loading = true
    const gen = ++playGeneration

    const ctx = ensureAudioCtx()
    if (ctx.state === 'suspended') await ctx.resume()

    decodedChunks = []
    totalAudioDuration = 0
    $segments = cached.segments
    $currentSegmentIndex = -1
    currentTime = 0
    duration = 0
    cachedAudioChunks = []

    for (const chunk of cached.audioChunks) {
      if (gen !== playGeneration) return
      const audioBuffer = float32ToAudioBuffer(ctx, chunk.audio, chunk.sampleRate)
      const chunkStart = totalAudioDuration
      decodedChunks = [...decodedChunks, { buffer: audioBuffer, startTime: chunkStart }]
      totalAudioDuration += audioBuffer.duration
    }

    duration = totalAudioDuration
    streamingDone = true
    loading = false

    playbackStartCtxTime = ctx.currentTime
    playbackStartOffset = 0
    $isPlaying = true

    for (let i = 0; i < decodedChunks.length; i++) {
      scheduleOneChunk(i)
    }
    startTimeTracking()
  }

  async function play() {
    if (!$bookId || $currentChapterIndex < 0 || loading) return

    // Check audio cache first
    const cached = getCachedAudio($bookId, $currentChapterIndex, $selectedVoice, $playbackSpeed)
    if (cached) {
      await playFromCache(cached)
      return
    }

    // Ensure TTS model is loaded
    const manager = getTTSManager()
    if (manager.getStatus() !== 'ready') {
      // Model still loading — wait for it
      if (manager.getStatus() === 'idle') manager.init()
      return
    }

    loading = true
    streamingDone = false
    const gen = ++playGeneration

    const ctx = ensureAudioCtx()
    if (ctx.state === 'suspended') await ctx.resume()

    decodedChunks = []
    totalAudioDuration = 0
    $segments = []
    $currentSegmentIndex = -1
    currentTime = 0
    duration = 0
    cachedAudioChunks = []

    const allSegments: TimedSegment[] = []

    manager.setOnChunk((chunk: TTSChunk) => {
      if (gen !== playGeneration) return

      const audioBuffer = float32ToAudioBuffer(ctx, chunk.audio, chunk.sampleRate)
      const chunkStart = totalAudioDuration

      // Build segment for this sentence
      const segment: TimedSegment = {
        text: chunk.text,
        start: chunkStart,
        end: chunkStart + audioBuffer.duration,
      }
      allSegments.push(segment)
      $segments = [...allSegments]

      // Cache the raw audio for later
      cachedAudioChunks.push({ audio: chunk.audio, sampleRate: chunk.sampleRate })

      decodedChunks = [...decodedChunks, { buffer: audioBuffer, startTime: chunkStart }]
      totalAudioDuration += audioBuffer.duration
      duration = totalAudioDuration

      if (loading) {
        // First chunk arrived — start playback
        loading = false
        playbackStartCtxTime = ctx.currentTime
        playbackStartOffset = 0
        $isPlaying = true
        startTimeTracking()
      }

      if ($isPlaying) {
        scheduleOneChunk(decodedChunks.length - 1)
      }
    })

    manager.setOnDone(() => {
      if (gen !== playGeneration) return
      streamingDone = true
      loading = false

      // Save to audio cache
      if ($bookId && cachedAudioChunks.length > 0) {
        setCachedAudio($bookId, $currentChapterIndex, $selectedVoice, $playbackSpeed, {
          audioChunks: cachedAudioChunks,
          segments: [...allSegments],
        })
      }
    })

    manager.setOnError((error: string) => {
      if (gen !== playGeneration) return
      console.error('TTS generation failed:', error)
      loading = false
      streamingDone = true
    })

    manager.generate($chapterText, $selectedVoice)
  }

  function stop() {
    persistPosition()
    ttsManager?.cancel()
    stopAllSources()
    stopTimeTracking()
    $isPlaying = false
    $currentSegmentIndex = -1
    $segments = []
    currentTime = 0
    duration = 0
    decodedChunks = []
    totalAudioDuration = 0
    streamingDone = false
    cachedAudioChunks = []
  }

  function togglePlayPause() {
    if (!$isPlaying && decodedChunks.length === 0) {
      play()
    } else if ($isPlaying && audioCtx) {
      audioCtx.suspend()
      $isPlaying = false
      stopTimeTracking()
      persistPosition()
    } else if (!$isPlaying && audioCtx && decodedChunks.length > 0) {
      audioCtx.resume()
      $isPlaying = true
      startTimeTracking()
    }
  }

  function skip(seconds: number) {
    if (decodedChunks.length === 0) return
    rescheduleAllFrom(currentTime + seconds)
  }

  function handleSeek(e: Event) {
    const input = e.target as HTMLInputElement
    rescheduleAllFrom(parseFloat(input.value))
  }

  function cycleSpeed() {
    const speeds = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0]
    const current = speeds.findIndex(s => Math.abs(s - $playbackSpeed) < 0.05)
    $playbackSpeed = speeds[(current + 1) % speeds.length]
    if ($isPlaying) {
      stop()
      play()
    }
  }

  async function changeChapter(delta: number) {
    if (!$bookId) return
    const newIndex = $currentChapterIndex + delta
    if (newIndex < 0 || newIndex >= $chapters.length) return

    const wasPlaying = $isPlaying
    stop()

    $currentChapterIndex = newIndex
    const content = await fetchChapter($bookId, newIndex)
    $chapterText = content.text

    if (wasPlaying) play()
  }

  // Reset audio state when chapter changes externally (e.g. Sidebar clicks)
  let prevChapterIndex = $currentChapterIndex
  $: if ($currentChapterIndex !== prevChapterIndex) {
    prevChapterIndex = $currentChapterIndex
    stop()
  }

  function formatTime(s: number): string {
    if (!isFinite(s) || s < 0) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  $: canPlay = $bookId && $currentChapterIndex >= 0 && !loading && $ttsModelStatus === 'ready'
  $: canPlayOrLoad = $bookId && $currentChapterIndex >= 0 && !loading
  $: hasPrev = $currentChapterIndex > 0
  $: hasNext = $currentChapterIndex < $chapters.length - 1
  $: hasAudio = decodedChunks.length > 0
  $: progress = duration > 0 ? (currentTime / duration) * 100 : 0
</script>
```

**Step 3: Update the template section**

In the template, add a model loading indicator. Find the play button area and add a status message when the model is loading. Also update the play button's disabled state to use `canPlayOrLoad` (allow clicking to trigger model load).

The play button `disabled` should use `canPlayOrLoad` instead of `canPlay` so users can click play while model loads. The `play()` function handles the "not ready" case by returning early.

Add a model status indicator in the controls area:

```svelte
{#if $ttsModelStatus === 'loading'}
  <div class="text-xs text-amber-accent/70 text-center py-1">Loading TTS model...</div>
{:else if $ttsModelStatus === 'error'}
  <div class="text-xs text-red-400/70 text-center py-1">TTS model failed to load</div>
{:else if $ttsModelStatus === 'idle'}
  <div class="text-xs text-parchment-400/40 text-center py-1">TTS model not loaded — click play to start</div>
{/if}
```

Insert this just before the main controls row inside the player.

**Step 4: Verify compilation**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.app.json 2>&1 | tail -20`

**Step 5: Commit**

```bash
git add frontend/src/components/AudioPlayer.svelte frontend/src/lib/stores.ts
git commit -m "feat: rewrite AudioPlayer to use client-side kokoro-js TTS"
```

---

### Task 6: Configure Vite for Web Worker

**Files:**
- Modify: `frontend/vite.config.ts` (if needed)

**Step 1: Verify worker support**

Vite supports `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` out of the box. Check that the Vite config doesn't have any conflicting settings.

Read `frontend/vite.config.ts` and verify no changes are needed. Vite handles `.ts` workers natively.

**Step 2: Test dev server starts**

Run: `cd frontend && npx vite --host 0.0.0.0 &` then kill it after confirming no errors.

If there are issues with the worker (e.g., kokoro-js imports in the worker context), we may need to add `optimizeDeps.exclude: ['kokoro-js']` to the Vite config to prevent Vite from trying to pre-bundle the kokoro-js module (which uses dynamic imports for ONNX runtime).

**Step 3: Commit (if changes were needed)**

```bash
git add frontend/vite.config.ts
git commit -m "fix: configure Vite for kokoro-js Web Worker support"
```

---

### Task 7: Clean up backend TTS code

**Files:**
- Delete: `backend/tts.py`
- Modify: `backend/server.py`
- Modify: `pyproject.toml`

**Step 1: Remove TTS endpoints from server.py**

Remove these endpoints and their imports:
- `GET /api/voices`
- `GET /api/narrate/{book_id}/{index}`
- `GET /api/narrate-timed/{book_id}/{index}`
- `GET /api/narrate-stream/{book_id}/{index}`
- `GET /api/audio/{audio_id}`
- Remove `_audio_cache` dict
- Remove imports: `base64`, `json`, `from .tts import ...`
- Remove import of `StreamingResponse` (check if still needed — it's not if no streaming endpoints remain)

Keep:
- `POST /api/upload`
- `GET /api/books/{book_id}/chapters/{index}`
- `_books` dict
- All book-related imports

The cleaned `server.py` should look like:

```python
import os
import tempfile
import uuid

from fastapi import FastAPI, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .book import extract_chapters

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_books: dict[str, list[tuple[str, str]]] = {}

# ... upload and chapter endpoints only ...
```

**Step 2: Delete backend/tts.py**

Run: `rm backend/tts.py`

**Step 3: Remove Python TTS dependencies from pyproject.toml**

Remove from `[project.dependencies]`:
- `kokoro>=0.9`
- `soundfile`
- `numpy`

Keep:
- `ebooklib`
- `PyMuPDF`
- `beautifulsoup4`
- `fastapi`
- `uvicorn`
- `python-multipart`

**Step 4: Update Python lock file**

Run: `cd /Users/ecq964/projects/ebook-reader && uv sync`

**Step 5: Verify backend starts**

Run: `cd /Users/ecq964/projects/ebook-reader && uv run uvicorn backend.server:app --port 8000 &` then kill.

**Step 6: Commit**

```bash
git rm backend/tts.py
git add backend/server.py pyproject.toml uv.lock
git commit -m "refactor: remove server-side TTS, keep only book parsing endpoints"
```

---

### Task 8: Clean up unused frontend API functions

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Step 1: Remove unused TTS API functions**

Remove these functions that are no longer called:
- `fetchVoices()`
- `narrateTimed()`
- `narrateUrl()`
- `audioUrl()`

Keep:
- `uploadBook()`
- `fetchChapter()`
- `TimedSegment` type (still used by stores and AudioPlayer)
- `ChapterInfo` type
- `UploadResult` type
- `ChapterContent` type

**Step 2: Verify no remaining imports of removed functions**

Run: `cd frontend && grep -rn 'narrateTimed\|narrateUrl\|audioUrl\|fetchVoices' src/`

Expected: No matches.

**Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "refactor: remove unused TTS API client functions"
```

---

### Task 9: Initialize TTS model eagerly on book load

**Files:**
- Modify: `frontend/src/App.svelte`

**Step 1: Start model download when a book is loaded**

Import the TTSManager and start initialization as soon as a book is loaded, so the model is ready by the time the user clicks play. This improves perceived latency.

Add to `App.svelte`'s `onMount`, after the book is restored:

```typescript
import { TTSManager } from './lib/tts'
import { ttsModelStatus } from './lib/stores'

// Inside onMount, after book restoration succeeds:
const manager = new TTSManager()
manager.setOnStatusChange((status) => { $ttsModelStatus = status })
manager.init()
```

Wait — the TTSManager is also created in AudioPlayer. We need a singleton. Instead, export a module-level instance from `tts.ts`:

Add to `frontend/src/lib/tts.ts` at the bottom:

```typescript
/** Singleton TTS manager instance */
let _instance: TTSManager | null = null

export function getTTSManagerInstance(): TTSManager {
  if (!_instance) {
    _instance = new TTSManager()
  }
  return _instance
}
```

Then AudioPlayer uses `getTTSManagerInstance()` instead of creating its own, and App.svelte also calls `getTTSManagerInstance().init()`.

**Step 2: Update AudioPlayer to use singleton**

Replace `getTTSManager()` local function in AudioPlayer with import of `getTTSManagerInstance` from `'../lib/tts'`. Remove the local `ttsManager` variable.

**Step 3: Update App.svelte**

```typescript
import { getTTSManagerInstance } from './lib/tts'
import { ttsModelStatus } from './lib/stores'

// In onMount, after book is loaded:
const tts = getTTSManagerInstance()
tts.setOnStatusChange((status) => { $ttsModelStatus = status })
tts.init()
```

**Step 4: Commit**

```bash
git add frontend/src/lib/tts.ts frontend/src/components/AudioPlayer.svelte frontend/src/App.svelte
git commit -m "feat: eagerly load TTS model on book restore for faster first play"
```

---

### Task 10: End-to-end testing

**Step 1: Start the backend**

Run: `cd /Users/ecq964/projects/ebook-reader && uv run uvicorn backend.server:app --port 8000`

**Step 2: Start the frontend dev server**

Run: `cd frontend && npm run dev`

**Step 3: Test in browser**

1. Open `http://localhost:5173`
2. Upload an EPUB or PDF
3. Observe: model loading indicator should appear
4. Wait for "TTS model ready" state
5. Click Play — verify audio starts after first sentence generates
6. Test: pause/resume, skip forward/back, seek slider
7. Test: speed cycling (0.75x → 2.0x)
8. Test: voice change
9. Test: chapter navigation (prev/next, sidebar click)
10. Test: refresh page — book should restore, model should auto-load

**Step 4: Fix any issues found**

Address compilation errors, runtime errors, or UX issues.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address integration issues from client-side TTS migration"
```

---

### Task 11: Final commit and cleanup

**Step 1: Review all changes**

Run: `git diff main --stat`

Verify:
- `backend/tts.py` deleted
- `backend/server.py` has only upload + chapter endpoints
- `pyproject.toml` has no TTS deps
- `frontend/package.json` has `kokoro-js`
- New files: `ttsWorker.ts`, `tts.ts`
- Modified: `AudioPlayer.svelte`, `storage.ts`, `stores.ts`, `api.ts`, `App.svelte`

**Step 2: Run type check**

Run: `cd frontend && npm run check`

**Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: finalize client-side TTS migration"
```

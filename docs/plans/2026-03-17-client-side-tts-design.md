# Client-side TTS Migration Design

## Goal

Replace server-side Kokoro Python TTS with client-side kokoro-js running in the browser via Web Worker. Eliminates the heavy Python TTS dependency, reduces backend to just EPUB/PDF parsing.

## Architecture

```
Current:  Browser -> SSE stream -> FastAPI -> Kokoro Python -> WAV chunks -> Browser Web Audio API
New:      Browser -> kokoro-js (Web Worker) -> AudioBuffers -> Browser Web Audio API
```

## Components

### 1. TTS Web Worker (`frontend/src/lib/ttsWorker.ts`)

- Loads `KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "webgpu" })` on first use, falls back to `wasm`
- Accepts messages: `{ type: 'generate', text, voice, chapterKey }`
- Uses `tts.generate(text, { voice })` per sentence
- Posts back: `{ type: 'chunk', audio: Float32Array, sampleRate, text }` and `{ type: 'done' }`
- Posts `{ type: 'ready' }` after model loads, `{ type: 'progress', ... }` during download

### 2. TTS Manager (`frontend/src/lib/tts.ts`)

- Wraps the Web Worker with a clean async API
- Manages model loading state (downloading, ready, error)
- Splits chapter text into sentences before sending to worker
- Returns async iterator of audio chunks
- Handles cancellation via generation counter (new chapter/stop aborts current)

### 3. AudioPlayer.svelte changes

- Replace SSE fetch with TTS manager calls
- Same Web Audio API scheduling (AudioBufferSourceNode)
- Segments become sentence-level: each chunk's text + cumulative audio duration
- Audio cache stores Float32Array chunks instead of WAV ArrayBuffers
- Speed handled by AudioBufferSourceNode.playbackRate (kokoro-js has no speed param)
- Progress bar, seek, pause/resume all work the same way

### 4. Reader.svelte

- No changes needed. Highlighting logic works with any segment granularity.

### 5. Backend cleanup

- Remove `tts.py` entirely
- Remove `/api/narrate*`, `/api/audio/*` endpoints from `server.py`
- Remove TTS-related imports (`base64`, `json` for TTS, `generate_audio_*`, `stream_audio`)
- Keep: `/api/upload`, `/api/books/{id}/chapters/{index}`
- Move voice list to frontend (hardcoded in AudioPlayer already)
- Remove Python deps: `kokoro`, `soundfile`, `numpy`, `torch`

### 6. Model loading UX

- First visit: show download progress in AudioPlayer area (~165 MB for q8)
- Model cached by browser after first download (Transformers.js Cache API)
- Subsequent visits: near-instant load from cache

### 7. Storage changes

- Audio cache in `storage.ts`: store `Float32Array` + `sampleRate` per chunk instead of WAV `ArrayBuffer`
- Reading position and book file persistence unchanged

## Data Flow

```
1. User clicks Play
2. AudioPlayer calls ttsManager.generate(chapterText, voice)
3. TTS Manager splits text into sentences
4. Web Worker runs tts.generate() per sentence
5. Each sentence -> Float32Array posted back to main thread
6. AudioPlayer creates AudioBuffer, schedules playback immediately
7. Segments accumulated: [{text: "sentence", start: 0, end: 2.3}, ...]
8. Reader highlights current sentence
9. After all sentences done -> cache in storage.ts
```

## Config

- Quantization: `q8` (165 MB, balanced quality/size)
- Device: `webgpu` preferred, `wasm` fallback
- Speed: `AudioBufferSourceNode.playbackRate` (pitch shifts slightly, acceptable trade-off)

## What stays the same

- Book upload/parsing (backend)
- IndexedDB file persistence
- localStorage reading position
- In-memory audio cache (different payload format)
- Web Audio API playback scheduling
- All UI/template code
- Voice list (already hardcoded in AudioPlayer)

## Trade-offs

- Highlighting is sentence-level instead of 4-word groups (kokoro-js lacks word timestamps)
- First visit requires ~165 MB model download (cached after)
- WebGPU required for best performance (WASM fallback is slower)
- Speed changes affect pitch slightly (AudioBufferSourceNode.playbackRate vs Kokoro native speed)
- Eliminates: Python TTS deps, server-side GPU/CPU load, SSE streaming complexity

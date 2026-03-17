# CLAUDE.md

## Project Overview

Fully client-side ebook reader with TTS narration. No backend — everything runs in the browser.

## Commands

- `npm run dev` — Start Vite dev server (http://localhost:5173)
- `npm run build` — Production build to `dist/`
- `npm run check` — Run svelte-check and tsc type checking

## Architecture

```
src/
├── components/
│   ├── AudioPlayer.svelte  — Playback controls, Web Audio API scheduling, TTS integration
│   ├── Reader.svelte       — Chapter text display with sentence highlighting
│   └── Sidebar.svelte      — Book upload, chapter navigation
├── lib/
│   ├── book.ts             — EPUB (epubjs) and PDF (pdfjs-dist) parsing
│   ├── storage.ts          — IndexedDB (book file), localStorage (position), in-memory audio cache
│   ├── stores.ts           — Svelte writable stores (shared state)
│   ├── tts.ts              — TTSManager class wrapping the Web Worker (singleton)
│   └── ttsWorker.ts        — Web Worker: loads kokoro-js ONNX model, streams audio chunks
├── App.svelte              — Root component, restores saved book on mount
└── main.ts                 — Entry point
```

## Key Patterns

- **Generation counter**: `playGeneration` in AudioPlayer and `currentGenerationId` in TTSManager prevent race conditions when the user changes chapters during active TTS generation. Bumping the counter causes stale callbacks/messages to be silently ignored.
- **Transferable objects**: The Web Worker posts `Float32Array` audio with `{ transfer: [samples.buffer] }` for zero-copy data transfer.
- **Singleton TTSManager**: `getTTSManagerInstance()` ensures one model load shared between App.svelte (eager init) and AudioPlayer (playback).
- **Svelte reactivity**: Arrays must be reassigned (`arr = [...arr, item]`) not mutated (`arr.push(item)`) to trigger reactivity.

## TTS Model

- Package: `kokoro-js`
- Model: `onnx-community/Kokoro-82M-v1.0-ONNX`
- Quantization: `q8` (~165 MB)
- Device: `wasm` (WebAssembly)
- Cached by browser via Transformers.js Cache API after first download
- Streaming: `TextSplitterStream` + `tts.stream()` yields sentence-by-sentence audio

## Style

- Tailwind CSS with custom theme colors: `parchment-*`, `spine-*`, `amber-accent`, `amber-warm`, `amber-glow`
- Book-inspired UI: dark sidebar (spine), light reading area (parchment), amber accents
